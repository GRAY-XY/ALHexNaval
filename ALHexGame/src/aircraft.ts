import { cellCenter, fromAxial, hexDistance, hexLine, toAxial, worldToCell } from './hex.ts';
import { arrivalAnchor, translateCell } from './arrival.ts';
import { findRoute, sameCell } from './pathfinding.ts';
import type { Match, CombatEvent, CarrierLaunchOrder } from './match.ts';
import type { Cell, Point } from './types.ts';

export const AIR_NATIONS = [
  { id: 'us', name: '白鹰 / 美国', faction: 1 }, { id: 'uk', name: '皇家 / 英国', faction: 2 },
  { id: 'jp', name: '重樱 / 日本', faction: 3 }, { id: 'de', name: '铁血 / 德国', faction: 4 },
] as const;
export type AirNation = typeof AIR_NATIONS[number]['id'];
export type AirRole = 'fighter' | 'bomber' | 'torpedo';
export const AIR_ROLES: Record<AirRole,string> = { fighter: '战斗机', bomber: '轰炸机', torpedo: '鱼雷机' };
const MODEL_NAMES: Record<AirNation,Record<AirRole,string>> = {
  us: { fighter: 'F4F 野猫', bomber: 'SBD 无畏', torpedo: 'TBD 蹂躏者' },
  uk: { fighter: '海喷火', bomber: '海燕', torpedo: '剑鱼' },
  jp: { fighter: '零战二一型', bomber: '九九式舰爆', torpedo: '九七式舰攻' },
  de: { fighter: 'BF-109T', bomber: 'Ju-87C', torpedo: 'Ju-87 D-4' },
};
export function planeName(nation: AirNation, role: AirRole): string { return MODEL_NAMES[nation][role]; }
export function planeTexture(nation: AirNation, role: AirRole): string { return `assets/combat/${nation}-${role}.png`; }
export const CARRIER_STATS: Record<string,{ roles: AirRole[]; planes: number; endurance: number; actionPoints: number }> = {
  CV: { roles: ['fighter','bomber','torpedo'], planes: 4, endurance: 4, actionPoints: 20 },
  CVL: { roles: ['fighter','torpedo'], planes: 3, endurance: 3, actionPoints: 15 },
};
export const LAUNCH_OIL = 3;
export const FIGHTER_RANGE = 2;
export interface Squadron extends Point {
  id: string; carrierId: string; ownerId: number; nation: AirNation; role: AirRole; slot: number;
  planes: number; hp: number; maxHp: number; fuelTurns: number; actionPoints: number; ammo: number; cooldown: number;
  heading: number; order: 'patrol' | 'move' | 'attack' | 'return'; destination?: Point; targetId?: string;
  flight?: { next: Cell; progress: number };
}
export interface AircraftMoveEvent { id:string; from:Point; to:Point }
export interface AviationTurnResolution { combatEvents:CombatEvent[]; moves:AircraftMoveEvent[] }
export type DeckSquadronStatus='ready'|'reserve'|'airborne'|'turnaround'|'lost';
export interface DeckSquadron {slot:number;role:AirRole;planes:number;hp:number;status:DeckSquadronStatus;readyRound?:number}
export interface CarrierDeck {carrierId:string;ownerId:number;operationRound:number;operationsUsed:number;squadrons:DeckSquadron[]}
export interface AviationState {
  serial: number; squadrons: Squadron[];
  launched: Record<string,number>; aa: Record<string,number>;
  decks:Record<string,CarrierDeck>;
}
export function emptyAviation(): AviationState { return { serial: 0, squadrons: [], launched: {}, aa: {},decks:{} }; }
export function squadronName(s: Squadron): string { return `${AIR_ROLES[s.role]}-${Math.ceil(s.hp/2)}机`; }
export function aircraftActionLimit(s: Pick<Squadron,'planes'>): number { return s.planes * 5; }
export function aircraftActionText(s: Squadron): string { return `${s.actionPoints} / ${aircraftActionLimit(s)}`; }
// Rules use the last reached hex center; interpolation is only used for drawing and picking.
export function aircraftPosition(s: Squadron): Point {
  if (!s.flight) return { x:s.x, y:s.y };
  const next=cellCenter(s.flight.next), t=s.flight.progress;
  return { x:s.x+(next.x-s.x)*t, y:s.y+(next.y-s.y)*t };
}
export function aircraftRoute(match: Match, start: Cell, target: Cell): Cell[] | undefined {
  if (!match.world.contains(start) || !match.world.contains(target)) return;
  const line=hexLine(start,target);
  if (line.every(cell=>match.world.contains(cell))) return line;
  return findRoute(match.world,start,target,()=>1,()=>true)?.cells;
}
function returnHome(s: Squadron): void { s.order='return'; s.targetId=undefined; s.destination=undefined; }
function deckOperationLimit(carrier:Match['units'][number]):number{return carrier.asset.ship_type.code==='CV'?2:1;}
function deckReadyLimit(carrier:Match['units'][number]):number{return carrier.asset.ship_type.code==='CV'?2:1;}
function createDeck(match:Match,carrierId:string):CarrierDeck {
  const carrier=match.unit(carrierId),stats=CARRIER_STATS[carrier.asset.ship_type.code];if(!stats)throw Error('该舰不是航母');
  const ready=deckReadyLimit(carrier),destroyed=carrier.status==='sunk';
  return {carrierId,ownerId:carrier.ownerId,operationRound:match.round,operationsUsed:0,squadrons:stats.roles.map((role,slot)=>({slot,role,planes:stats.planes,hp:destroyed?0:stats.planes*2,status:destroyed?'lost':slot<ready?'ready':'reserve'}))};
}
function deckFor(match:Match,carrierId:string,create=false):CarrierDeck|undefined {
  let deck=match.aviation.decks[carrierId];if(!deck&&create){deck=createDeck(match,carrierId);match.aviation.decks[carrierId]=deck;}
  if(deck&&deck.operationRound!==match.round){deck.operationRound=match.round;deck.operationsUsed=0;}
  return deck;
}
export function initializeAviationDecks(match:Match):void {
  if(match.rulesetId!=='naval-v2')return;
  for(const carrier of match.units.filter(unit=>!!CARRIER_STATS[unit.asset.ship_type.code]))deckFor(match,carrier.instanceId,true);
  for(const deck of Object.values(match.aviation.decks))for(const slot of deck.squadrons){
    if(slot.status==='airborne'&&!match.aviation.squadrons.some(squadron=>squadron.carrierId===deck.carrierId&&squadron.slot===slot.slot)){slot.status='lost';slot.hp=0;delete slot.readyRound;}
  }
  for(const squadron of match.aviation.squadrons){const slot=match.aviation.decks[squadron.carrierId]?.squadrons.find(item=>item.slot===squadron.slot);if(slot&&slot.status!=='lost'){slot.status='airborne';slot.hp=squadron.hp;}}
}
export function beginAviationRound(match:Match):void {
  if(match.rulesetId!=='naval-v2')return;
  for(const deck of Object.values(match.aviation.decks)){
    const carrier=match.units.find(unit=>unit.instanceId===deck.carrierId);if(!carrier)continue;
    deck.operationRound=match.round;deck.operationsUsed=0;
    for(const squadron of deck.squadrons)if(squadron.status==='turnaround'&&squadron.readyRound!==undefined&&squadron.readyRound<=match.round){squadron.status='reserve';delete squadron.readyRound;}
    let ready=deck.squadrons.filter(squadron=>squadron.status==='ready').length;
    for(const squadron of deck.squadrons.filter(squadron=>squadron.status==='reserve').sort((a,b)=>a.slot-b.slot))if(ready<deckReadyLimit(carrier)){squadron.status='ready';ready++;}
  }
}
export function loseCarrierDeck(match:Match,carrierId:string):void {
  const deck=match.aviation.decks[carrierId];if(!deck)return;
  for(const squadron of deck.squadrons){squadron.status='lost';squadron.hp=0;delete squadron.readyRound;}
}
function loseAirSquadron(match:Match,s:Squadron):void {
  const deck=match.aviation.decks[s.carrierId],slot=deck?.squadrons.find(item=>item.slot===s.slot);
  if(slot){slot.status='lost';slot.hp=0;delete slot.readyRound;}
}
function recoverAirSquadron(match:Match,s:Squadron):boolean {
  if(match.rulesetId!=='naval-v2')return true;
  const deck=deckFor(match,s.carrierId,true),slot=deck!.squadrons.find(item=>item.slot===s.slot);
  if(!slot||slot.status!=='airborne'||deck!.operationsUsed>=deckOperationLimit(match.unit(s.carrierId)))return false;
  deck!.operationsUsed++;slot.status='turnaround';slot.hp=s.hp;slot.readyRound=match.round+2;return true;
}
function clearLostTargets(match: Match): void {
  for (const s of match.aviation.squadrons) if (s.targetId) {
    const ship=match.units.find(u=>u.instanceId===s.targetId&&u.status!=='sunk'),air=match.aviation.squadrons.find(a=>a.id===s.targetId);
    if(!ship&&!air||ship&&!match.unitVisible(ship,s.ownerId)||air&&!match.airVisible(air,s.ownerId)){s.order='patrol';s.targetId=undefined;}
  }
}
export function endAviationTurn(match: Match, ownerId: number, skipFuelIds: ReadonlySet<string> = new Set()): void {
  for (const s of match.aviation.squadrons) if (s.ownerId===ownerId) {
    if(!skipFuelIds.has(s.id)){
      s.fuelTurns=Math.max(0,s.fuelTurns-1);
      if (s.fuelTurns<=1) { s.order='return'; s.targetId=undefined; s.destination=undefined; }
    }
    if(s.fuelTurns===0||s.hp<=0)loseAirSquadron(match,s);
  }
  match.aviation.squadrons=match.aviation.squadrons.filter(s=>s.hp>0 && s.fuelTurns>0);
  clearLostTargets(match);
}
export function nationFor(match: Match, carrierId: string): AirNation {
  const carrier = match.unit(carrierId);
  const nation = AIR_NATIONS.find(n => n.faction === carrier.asset.faction.id);
  if (!nation) throw Error('尚未准备该国家的舰载机素材');
  return nation.id;
}
export function launchPreview(match: Match, carrierId: string): { valid: boolean; reason: string; oil: number; slots: number[];operationsUsed:number;operationsLimit:number } {
  const carrier = match.unit(carrierId), stats = CARRIER_STATS[carrier.asset.ship_type.code];
  const deck=match.rulesetId==='naval-v2'&&stats?deckFor(match,carrierId,true):undefined,operationsLimit=match.rulesetId==='naval-v2'&&stats?deckOperationLimit(carrier):0,operationsUsed=deck?.operationsUsed??0;
  const available=stats?.roles.map((_,i)=>i).filter(i=>!match.aviation.squadrons.some(s=>s.carrierId===carrierId&&s.slot===i))??[];
  const slots=match.rulesetId==='naval-v2'&&deck?deck.squadrons.filter(s=>s.status==='ready').map(s=>s.slot).sort((a,b)=>a-b).slice(0,Math.max(0,operationsLimit-operationsUsed)):available;
  const oil = match.rulesetId==='naval-v2'?0:slots.length * LAUNCH_OIL;
  const pending=match.rulesetId==='naval-v2'&&match.aviationOrders.some(order=>order.carrierId===carrierId);
  const reason = match.result?'战局已结束':match.rulesetId==='naval-v2'&&match.phase!=='aviation'?'只能在本方回合安排航母起飞':!stats ? '该舰不是航母' : carrier.ownerId !== match.active.id ? '只能指挥本方航母' :
    carrier.status !== 'ready' ? '航母必须处于可行动状态' : !carrier.action ? '本舰作战行动已用' :
    pending?'起飞计划已安排':match.aviation.launched[carrierId] === match.round ? '本全局回合已经出动一波' : !slots.length ? match.rulesetId==='naval-v2'&&deck?.squadrons.some(s=>s.status==='turnaround')?'中队正在整备，至少一个完整回合后重新待发':match.rulesetId==='naval-v2'&&operationsUsed>=operationsLimit?'本全局回合甲板操作已用完':'没有可出动的待发中队' :
    match.active.oil < oil ? `起飞需要 ${oil} 点石油` : '';
  return { valid: !reason, reason, oil, slots,operationsUsed,operationsLimit };
}
export function orderCarrierLaunch(match:Match,carrierId:string):number[]{
  match.assertPlayable();
  if(match.rulesetId!=='naval-v2'||match.phase!=='aviation')throw Error('只能在本方回合安排舰载机起飞');
  const preview=launchPreview(match,carrierId);if(!preview.valid)throw Error(preview.reason);
  const order:CarrierLaunchOrder={ownerId:match.active.id,carrierId,slots:[...preview.slots]};match.aviationOrders.push(order);match.unit(carrierId).action=0;match.campaignRevision++;
  return [...order.slots];
}
export function cancelCarrierLaunch(match:Match,carrierId:string):void{
  match.assertPlayable();
  if(match.rulesetId!=='naval-v2'||match.phase!=='aviation')throw Error('起飞计划只能在本方规划时撤回');
  const index=match.aviationOrders.findIndex(order=>order.carrierId===carrierId&&order.ownerId===match.active.id);if(index<0)throw Error('本舰没有可撤回的起飞计划');
  match.aviationOrders.splice(index,1);match.unit(carrierId).action=1;match.campaignRevision++;
}
function launchWingImmediately(match: Match, carrierId: string): Squadron[] {
  const preview = launchPreview(match,carrierId); if (!preview.valid) throw Error(preview.reason);
  const carrier = match.unit(carrierId), stats = CARRIER_STATS[carrier.asset.ship_type.code], origin=toAxial(carrier), nation = nationFor(match,carrierId),deck=match.rulesetId==='naval-v2'?deckFor(match,carrierId,true):undefined;
  const launched = preview.slots.map(slot => {
    const staged=deck?.squadrons.find(item=>item.slot===slot);
    const preferred=fromAxial(origin.q+slot-1,origin.r-1), spawn=match.world.contains(preferred) ? preferred : carrier;
    return { id: `air-${++match.aviation.serial}`, carrierId, ownerId: carrier.ownerId,
    nation, role: stats.roles[slot], slot, ...cellCenter(spawn),
    planes: stats.planes, hp: staged?.hp??stats.planes * 2, maxHp: stats.planes * 2, fuelTurns: stats.endurance, actionPoints: stats.actionPoints, ammo: 3, cooldown: 0,
    heading: -Math.PI / 2, order: 'patrol' as const }; });
  carrier.action = 0;if(match.rulesetId!=='naval-v2')match.active.oil -= preview.oil;else{for(const squadron of launched){const staged=deck!.squadrons.find(item=>item.slot===squadron.slot)!;staged.status='airborne';}deck!.operationsUsed+=launched.length;}
  match.aviation.launched[carrierId] = match.round;
  match.aviation.squadrons.push(...launched); return launched;
}
export function launchWing(match:Match,carrierId:string):Squadron[]{
  if(match.rulesetId==='naval-v2')throw Error('V2航母必须先安排起飞，再在实施回合时执行');
  return launchWingImmediately(match,carrierId);
}
export function resolveQueuedCarrierLaunch(match:Match,order:CarrierLaunchOrder):Squadron[]{
  const carrier=match.unit(order.carrierId);if(match.rulesetId!=='naval-v2'||carrier.ownerId!==order.ownerId)throw Error('起飞计划所有权无效');
  const activeIndex=match.activeIndex;match.activeIndex=order.ownerId-1;
  try{
    carrier.action=1;
    const preview=launchPreview(match,order.carrierId);if(!preview.valid||preview.slots.length!==order.slots.length||preview.slots.some((slot,index)=>slot!==order.slots[index]))throw Error(preview.reason||'起飞计划与当前甲板状态不一致');
    return launchWingImmediately(match,order.carrierId);
  }catch(error){carrier.action=0;throw error;}finally{match.activeIndex=activeIndex;}
}
export function commandSquadron(match: Match, id: string, destination?: Point, targetId?: string): void {
  match.assertPlayable();
  if(match.rulesetId==='naval-v2'&&match.phase!=='aviation')throw Error('本回合行动已锁定');
  const squadron = match.aviation.squadrons.find(s => s.id === id);
  if (!squadron || squadron.ownerId !== match.active.id) throw Error('只能指挥本方飞行中队');
  if ((destination || targetId) && squadron.actionPoints <= 0) throw Error('该中队行动力已耗尽，正在返航；本次出动不会自动恢复行动力');
  if (targetId) {
    const enemyAir = match.aviation.squadrons.find(s => s.id === targetId), enemyShip = match.units.find(u => u.instanceId === targetId && u.status !== 'sunk');
    if (!enemyAir && !enemyShip || (enemyAir ?? enemyShip)!.ownerId === squadron.ownerId) throw Error('请选择敌方目标');
    if(enemyAir&&!match.airVisible(enemyAir,squadron.ownerId)||enemyShip&&!match.unitVisible(enemyShip,squadron.ownerId))throw Error('目标不在本方当前视野内');
    if (enemyAir && squadron.role !== 'fighter') throw Error('只有战斗机可以执行空中拦截');
    if (match.rulesetId==='naval-v2'&&enemyShip&&squadron.role==='fighter') throw Error('战斗机不能攻击舰船');
    if (match.rulesetId==='naval-v2'&&enemyShip&&enemyShip.asset.ship_type.code==='SS'&&enemyShip.submerged&&squadron.role!=='bomber') throw Error('只有轰炸机可以攻击潜航潜艇');
    if (!squadron.ammo) throw Error('弹药耗尽，请返航');
    squadron.order = 'attack'; squadron.targetId = targetId; squadron.destination = undefined;
  } else if (destination) {
    if (!Number.isFinite(destination.x) || !Number.isFinite(destination.y) || !match.world.contains(worldToCell(destination))) throw Error('目标超出有效海域');
    const target=worldToCell(destination), start=squadron.flight?.next ?? worldToCell(squadron);
    if (!aircraftRoute(match,start,target)) throw Error('飞机无法沿有效六角格抵达目标');
    squadron.order = 'move'; squadron.destination = cellCenter(target); squadron.targetId = undefined;
  } else { squadron.order = 'return'; squadron.destination = undefined; squadron.targetId = undefined; }
}
export function cancelSquadronOrder(match:Match,id:string):void{
  match.assertPlayable();if(match.rulesetId==='naval-v2'&&match.phase!=='aviation')throw Error('本回合行动已锁定');
  const squadron=match.aviation.squadrons.find(item=>item.id===id);if(!squadron||squadron.ownerId!==match.active.id)throw Error('只能取消本方中队的命令');
  squadron.order='patrol';squadron.destination=undefined;squadron.targetId=undefined;squadron.flight=undefined;
}
export function planSquadronTranslation(match: Match, ids: string[], delta: Point): { id: string; destination: Point }[] {
  match.assertPlayable();
  if (!Number.isFinite(delta.x) || !Number.isFinite(delta.y)) throw Error('目标超出有效海域');
  const selected=[...new Set(ids)].map(id => {
    const s = match.aviation.squadrons.find(squadron => squadron.id === id);
    if (!s || s.ownerId !== match.active.id) throw Error('只能指挥本方飞行中队');
    if (s.actionPoints <= 0) throw Error('所选中队行动力已耗尽，正在返航');
    return s;
  });
  if (!selected.length) return [];
  const source=arrivalAnchor(selected), center=cellCenter(source), target=worldToCell({x:center.x+delta.x,y:center.y+delta.y});
  return selected.map(s=>{
    const cell=translateCell(worldToCell(s),source,target);
    if (!aircraftRoute(match,s.flight?.next ?? worldToCell(s),cell)) throw Error('目标无法容纳完整飞机队形，请选择更靠近地图内部的位置');
    return {id:s.id,destination:cellCenter(cell)};
  });
}
const distance = (a: Point,b: Point) => Math.hypot(a.x-b.x,a.y-b.y);
export function fighterInRange(a: Point, b: Point): boolean { return hexDistance(worldToCell(a),worldToCell(b)) <= FIGHTER_RANGE; }
function fireAtAircraft(fighter: Squadron, target: Squadron, removed: Set<string>): void {
  fighter.cooldown = 7; fighter.ammo--; target.hp = Math.max(0,target.hp-3);
  if (!target.hp) removed.add(target.id);
}
function fly(match: Match, s: Squadron, point: Point, speed: number, dt: number, stop = 0): boolean {
  const target=worldToCell(point);
  let remaining=dt*speed;
  while (remaining>1e-9) {
    if (!s.flight) {
      const current=worldToCell(s);
      if (hexDistance(current,target)<=stop) return true;
      if (s.actionPoints<=0 && s.order!=='return') return false;
      const next=aircraftRoute(match,current,target)?.[1];
      if (!next) return false;
      s.flight={next,progress:0};
      const center=cellCenter(next);s.heading=Math.atan2(center.y-s.y,center.x-s.x);
    }
    const advance=Math.min(remaining,1-s.flight.progress);
    s.flight.progress+=advance;remaining-=advance;
    if (s.flight.progress<1-1e-9) return false;
    Object.assign(s,cellCenter(s.flight.next));s.flight=undefined;
    if (s.actionPoints>0) {
      s.actionPoints--;
      if (s.actionPoints===0) { returnHome(s);return sameCell(worldToCell(s),target); }
    }
  }
  return !s.flight && hexDistance(worldToCell(s),target)<=stop;
}
export function tickAviation(match: Match, seconds: number): CombatEvent[] {
  if (match.rulesetId==='naval-v2'||match.result||!Number.isFinite(seconds) || seconds <= 0) return [];
  const dt = Math.min(seconds,.1), events: CombatEvent[] = [], removed = new Set<string>(),recovered=new Set<string>();
  for (const id of Object.keys(match.aviation.aa)) { match.aviation.aa[id] = Math.max(0,match.aviation.aa[id]-dt); if (!match.aviation.aa[id]) delete match.aviation.aa[id]; }
  for (const s of match.aviation.squadrons) {
    if (s.hp <= 0 || s.fuelTurns<=0) { loseAirSquadron(match,s);removed.add(s.id); continue; }
    // Inactive fighters remain stationary but can react defensively to nearby aircraft.
    if (s.ownerId !== match.active.id) { if (s.role === 'fighter') s.cooldown = Math.max(0,s.cooldown-dt); continue; }
    let carrier = match.units.find(u => u.instanceId === s.carrierId && u.status !== 'sunk');
    if (!carrier) {
      carrier = match.units.filter(u => u.ownerId === s.ownerId && u.status !== 'sunk' && CARRIER_STATS[u.asset.ship_type.code])
        .filter(u => nationFor(match,u.instanceId) === s.nation&&deckFor(match,u.instanceId,true)?.squadrons.some(slot=>slot.role===s.role&&slot.status==='lost'))
        .sort((a,b) => distance(s,cellCenter(a))-distance(s,cellCenter(b)))[0];
      if (!carrier) { removed.add(s.id); continue; }
      const slot=deckFor(match,carrier.instanceId,true)!.squadrons.find(item=>item.role===s.role&&item.status==='lost')!;s.carrierId = carrier.instanceId;s.slot=slot.slot;slot.status='airborne';slot.hp=s.hp;s.order = 'return'; s.targetId = undefined; s.destination = undefined;
    }
    const home = cellCenter(carrier), speed = s.role === 'fighter' ? 4.6 : 3.5;
    s.cooldown = Math.max(0,s.cooldown-dt);
    if (s.fuelTurns<=1 || !s.ammo || s.actionPoints<=0) returnHome(s);
    if (s.order === 'return') { if (fly(match,s,home,speed,dt)&&recoverAirSquadron(match,s)) {removed.add(s.id);recovered.add(s.id);} }
    else if (s.order === 'move' && s.destination) { if (fly(match,s,s.destination,speed,dt) && s.actionPoints>0) { s.order = 'patrol'; s.destination = undefined; } }
    else if (s.order === 'patrol' && s.flight) fly(match,s,cellCenter(s.flight.next),speed,dt);
    else if (s.order === 'attack') {
      const air = match.aviation.squadrons.find(a => a.id === s.targetId && a.hp > 0 && !removed.has(a.id)), ship = match.units.find(u => u.instanceId === s.targetId && u.status !== 'sunk');
      const target = air ?? (ship ? cellCenter(ship) : undefined);
      if (!target || air&&!match.airVisible(air,s.ownerId) || ship&&!match.unitVisible(ship,s.ownerId)) { s.order = 'patrol'; s.targetId = undefined; }
      else if (air) {
        if (s.flight || !fighterInRange(s,air)) fly(match,s,air,speed,dt,FIGHTER_RANGE);
        if (s.actionPoints>0 && fighterInRange(s,air) && !s.cooldown) fireAtAircraft(s,air,removed);
      } else if (ship && fly(match,s,target,speed,dt,1) && s.actionPoints>0 && !s.cooldown) {
        s.cooldown = 7; s.ammo--; events.push(match.airDamage(s,ship.instanceId));if(s.hp<=0)removed.add(s.id);
      }
    }
    if (s.actionPoints<=0) returnHome(s);
    if(match.result)break;
    // All enemy ships can react with defensive AA, once every four real seconds.
    if (!removed.has(s.id)) for (const ship of match.units) {
      if (ship.ownerId === s.ownerId || ship.status === 'sunk' || match.aviation.aa[ship.instanceId] || hexDistance(worldToCell(s),ship) > 2) continue;
      s.hp = Math.max(0,s.hp-1); match.aviation.aa[ship.instanceId] = 4; if (!s.hp) { removed.add(s.id); break; }
    }
  }
  // Automatic fire never rewrites a move/patrol order or pursues aircraft outside two hex rings.
  for (const fighter of match.aviation.squadrons) {
    if(match.result)break;
    if (fighter.role !== 'fighter' || fighter.hp <= 0 || removed.has(fighter.id) || fighter.order === 'return' || !fighter.ammo || fighter.cooldown || fighter.fuelTurns <= 0 || fighter.actionPoints<=0) continue;
    const enemies = match.aviation.squadrons.filter(target => target.ownerId !== fighter.ownerId && target.hp > 0 && !removed.has(target.id) && fighterInRange(fighter,target)&&match.airVisible(target,fighter.ownerId));
    enemies.sort((a,b) => distance(fighter,a)-distance(fighter,b) || a.id.localeCompare(b.id));
    const target = enemies.find(enemy => enemy.id === fighter.targetId) ?? enemies[0];
    if (target) fireAtAircraft(fighter,target,removed);
  }
  for(const squadron of match.aviation.squadrons)if(removed.has(squadron.id)&&!recovered.has(squadron.id))loseAirSquadron(match,squadron);
  match.aviation.squadrons = match.aviation.squadrons.filter(s => !removed.has(s.id) && s.hp > 0);
  clearLostTargets(match);
  match.refreshVision();
  return events;
}

const AIR_STEPS_PER_TURN:Record<AirRole,number>={fighter:4,bomber:3,torpedo:3};
function moveForTurn(match:Match,s:Squadron,destination:Point,stop:number,afterStep?:(cell:Cell)=>boolean):boolean{
  const target=worldToCell(destination),route=aircraftRoute(match,worldToCell(s),target);
  if(!route)return false;
  let moved=0;
  for(const next of route.slice(1)){
    if(moved>=AIR_STEPS_PER_TURN[s.role]||hexDistance(worldToCell(s),target)<=stop||(s.actionPoints<=0&&s.order!=='return'))break;
    const previous=cellCenter(worldToCell(s)),center=cellCenter(next);Object.assign(s,center);s.heading=Math.atan2(center.y-previous.y,center.x-previous.x);
    if(s.actionPoints>0)s.actionPoints--;moved++;
    if(afterStep&&!afterStep(next))break;
    if(hexDistance(next,target)<=stop)break;
  }
  return hexDistance(worldToCell(s),target)<=stop;
}
function airCombatEvent(attacker:Squadron,target:Squadron,hpBefore:number):CombatEvent{
  const damage=hpBefore-target.hp;
  return {attackerId:attacker.id,attackerLabel:squadronName(attacker),targetId:target.id,targetLabel:squadronName(target),weaponId:'fighter-intercept',kind:'air',damage,hpBefore,hpAfter:target.hp,sunk:target.hp===0,hit:damage>0,targetIsAircraft:true,origin:{x:attacker.x,y:attacker.y}};
}
function intercept(match:Match,attacker:Squadron,target:Squadron,removed:Set<string>,events:CombatEvent[]):boolean{
  if(attacker.role!=='fighter'||!attacker.ammo||attacker.cooldown||attacker.fuelTurns<=0||attacker.actionPoints<=0||!fighterInRange(attacker,target))return false;
  const hpBefore=target.hp;attacker.cooldown=7;attacker.ammo--;target.hp=Math.max(0,target.hp-3);if(!target.hp)removed.add(target.id);events.push(airCombatEvent(attacker,target,hpBefore));return true;
}
function fighterScreen(match:Match,attacker:Squadron,events:CombatEvent[],removed:Set<string>):boolean{
  const screen=match.aviation.squadrons.filter(target=>target.ownerId!==attacker.ownerId&&target.role==='fighter'&&target.hp>0&&!removed.has(target.id)&&!target.cooldown&&target.ammo>0&&target.fuelTurns>0&&target.actionPoints>0&&target.order!=='return'&&fighterInRange(attacker,target)&&match.airVisible(attacker,target.ownerId))
    .sort((a,b)=>distance(attacker,a)-distance(attacker,b)||a.id.localeCompare(b.id))[0];
  return screen?intercept(match,screen,attacker,removed,events):false;
}
export function resolveAviationTurn(match:Match,ownerId:number,eligibleIds?:ReadonlySet<string>):AviationTurnResolution{
  if(match.rulesetId!=='naval-v2'||match.result)return {combatEvents:[],moves:[]};
  const events:CombatEvent[]=[],moves:AircraftMoveEvent[]=[],removed=new Set<string>(),recovered=new Set<string>();
  const squadrons=match.aviation.squadrons.filter(s=>s.ownerId===ownerId&&(!eligibleIds||eligibleIds.has(s.id))).slice().sort((a,b)=>a.id.localeCompare(b.id));
  for(const s of squadrons){
    if(s.hp<=0||s.fuelTurns<=0){loseAirSquadron(match,s);removed.add(s.id);continue;}
    const from=aircraftPosition(s);if(s.flight){Object.assign(s,cellCenter(s.flight.next));s.flight=undefined;}
    const initial={x:from.x,y:from.y};
    if(s.fuelTurns<=1||!s.ammo||s.actionPoints<=0)returnHome(s);
    if(s.order==='return'){
      let carrier=match.units.find(unit=>unit.instanceId===s.carrierId&&unit.status!=='sunk');
      if(!carrier){
        carrier=match.units.filter(unit=>unit.ownerId===s.ownerId&&unit.status!=='sunk'&&CARRIER_STATS[unit.asset.ship_type.code])
          .filter(unit=>nationFor(match,unit.instanceId)===s.nation&&deckFor(match,unit.instanceId,true)?.squadrons.some(slot=>slot.role===s.role&&slot.status==='lost'))
          .sort((a,b)=>distance(s,cellCenter(a))-distance(s,cellCenter(b))||a.instanceId.localeCompare(b.instanceId))[0];
        if(!carrier){removed.add(s.id);continue;}
        const slot=deckFor(match,carrier.instanceId,true)!.squadrons.find(item=>item.role===s.role&&item.status==='lost')!;s.carrierId=carrier.instanceId;s.slot=slot.slot;slot.status='airborne';slot.hp=s.hp;
      }
      if(moveForTurn(match,s,cellCenter(carrier),0)&&recoverAirSquadron(match,s)){removed.add(s.id);recovered.add(s.id);}
    }else if(s.order==='move'&&s.destination){
      const previous={x:s.x,y:s.y};
      if(moveForTurn(match,s,s.destination,0)){s.order='patrol';s.destination=undefined;}
      if(s.x!==previous.x||s.y!==previous.y)match.refreshVision();
    }else if(s.order==='attack'){
      const air=match.aviation.squadrons.find(item=>item.id===s.targetId&&item.hp>0&&!removed.has(item.id)),ship=match.units.find(unit=>unit.instanceId===s.targetId&&unit.status!=='sunk');
      if(air&&s.role==='fighter'&&match.airVisible(air,s.ownerId)){
        moveForTurn(match,s,air,FIGHTER_RANGE);
        match.refreshVision();
        if(s.ammo&&!s.cooldown&&fighterInRange(s,air)&&intercept(match,s,air,removed,events)){s.order='patrol';s.targetId=undefined;}
      }else if(ship&&s.role!=='fighter'&&(!(ship.asset.ship_type.code==='SS'&&ship.submerged)||s.role==='bomber')&&match.unitVisible(ship,s.ownerId)){
        let screened=false;
        const screenAtStep=()=>{
          if(!screened&&fighterScreen(match,s,events,removed))screened=true;
          return s.hp>0;
        };
        const survivesInitialScreen=screenAtStep();
        const inRange=survivesInitialScreen&&moveForTurn(match,s,cellCenter(ship),1,screenAtStep);match.refreshVision();
        if(inRange&&match.unitVisible(ship,s.ownerId)){
          if(!screened)screenAtStep();
          if(s.hp>0&&s.ammo&&!s.cooldown){s.ammo--;s.cooldown=7;events.push(match.airDamage(s,ship.instanceId));if(s.hp<=0)removed.add(s.id);}
          s.order='patrol';s.targetId=undefined;
        }
      }else{s.order='patrol';s.targetId=undefined;}
    }
    if(s.order!=='return'&&s.role==='fighter'&&!s.cooldown&&s.ammo&&s.actionPoints>0){
      const enemy=match.aviation.squadrons.filter(target=>target.ownerId!==s.ownerId&&target.hp>0&&!removed.has(target.id)&&fighterInRange(s,target)&&match.airVisible(target,s.ownerId))
        .sort((a,b)=>distance(s,a)-distance(s,b)||a.id.localeCompare(b.id))[0];
      if(enemy)intercept(match,s,enemy,removed,events);
    }
    if(s.ammo<=0&&s.order!=='return')returnHome(s);
    if(s.actionPoints<=0&&s.order!=='return')returnHome(s);
    if(s.x!==initial.x||s.y!==initial.y)moves.push({id:s.id,from,to:{x:s.x,y:s.y}});
    if(match.result)break;
  }
  for(const squadron of match.aviation.squadrons)if(removed.has(squadron.id)&&!recovered.has(squadron.id))loseAirSquadron(match,squadron);
  match.aviation.squadrons=match.aviation.squadrons.filter(s=>!removed.has(s.id)&&s.hp>0);
  for(const squadron of match.aviation.squadrons)if(squadron.targetId&&removed.has(squadron.targetId)){squadron.order='patrol';squadron.targetId=undefined;}
  match.refreshVision();return {combatEvents:events,moves};
}

export function advanceAviation(match: Match, elapsedSeconds: number): CombatEvent[] {
  if (!Number.isFinite(elapsedSeconds) || elapsedSeconds <= 0) return [];
  // Ordinary background/low-FPS frames catch up; long suspension never replays a whole battle.
  const elapsed = Math.min(1,elapsedSeconds), steps = Math.ceil(elapsed/.05), dt = elapsed/steps, events: CombatEvent[] = [];
  for (let i=0;i<steps;i++) events.push(...tickAviation(match,dt));
  return events;
}

export function validateAviation(input: unknown, match: Match, version: 5|6|7|8|9|10|11|12|13|14|15|16|17|18|19|20|21|22|23|24|25|26|27|28|29 = 29): AviationState {
  const state = input as AviationState & { nations?: Record<string,AirNation> };
  const migrateCountry=version===5, migrateEndurance=version<7;
  const fail = (): never => { throw Error('存档航空数据无效，当前战局未改变'); };
  const finite = (n: unknown,lo: number,hi: number) => typeof n === 'number' && Number.isFinite(n) && n >= lo && n <= hi;
  const integer = (n: unknown,lo: number,hi: number) => finite(n,lo,hi) && Number.isInteger(n);
  const record = (n: unknown) => !!n && typeof n === 'object' && !Array.isArray(n);
  const nation = (n: unknown) => AIR_NATIONS.some(item => item.id === n);
  if (!state || !integer(state.serial,0,1_000_000) || !Array.isArray(state.squadrons) || state.squadrons.length > match.units.length*3 || !record(state.launched) || !record(state.aa)) fail();
  if(version>=21&&!record(state.decks))fail();
  if (migrateCountry) {
    if (!record(state.nations)) fail();
    for (const [id,n] of Object.entries(state.nations!)) if (!match.units.some(u => u.instanceId === id && CARRIER_STATS[u.asset.ship_type.code]) || !nation(n)) fail();
  } else if ('nations' in state) fail();
  for (const [id,r] of Object.entries(state.launched)) if (!match.units.some(u => u.instanceId === id && CARRIER_STATS[u.asset.ship_type.code]) || !integer(r,1,match.round)) fail();
  for (const [id,t] of Object.entries(state.aa)) if (!match.units.some(u => u.instanceId === id) || !finite(t,0,4)) fail();
  const ids = new Set<string>(), slots = new Set<string>();
  for (const s of state.squadrons) {
    const carrier = match.units.find(u => u.instanceId === s?.carrierId), stats = carrier && CARRIER_STATS[carrier.asset.ship_type.code];
    if (!s || !stats || !/^air-[1-9]\d*$/.test(s.id) || Number(s.id.slice(4)) > state.serial || ids.has(s.id) || !integer(s.slot,0,stats.roles.length-1) || slots.has(`${s.carrierId}:${s.slot}`) || s.ownerId !== carrier!.ownerId || !nation(s.nation) || !['fighter','bomber','torpedo'].includes(s.role)) fail();
    if (!migrateCountry && s.nation !== nationFor(match,s.carrierId)) fail();
    // Rebased squadrons may keep their original role and size.
    const legacy=s as Squadron & {fuel?:number};
    if (migrateEndurance ? !finite(legacy.fuel,0,120) || 'fuelTurns' in s : !integer(s.fuelTurns,1,s.planes) || 'fuel' in s) fail();
    if (!integer(s.planes,3,4) || s.maxHp !== s.planes*2 || !integer(s.hp,1,s.maxHp) || !integer(s.ammo,0,3) || !(version>=26&&match.rulesetId==='naval-v2'?(s.cooldown===0||s.cooldown===7):finite(s.cooldown,0,7)) || !finite(s.heading,-Math.PI,Math.PI) || !finite(s.x,0,match.world.bounds.width) || !finite(s.y,0,match.world.bounds.height) || !match.world.contains(worldToCell(s))) fail();
    if (version>=9 && (!finite(s.actionPoints,0,aircraftActionLimit(s)) || s.actionPoints===0 && s.order!=='return')) fail();
    if (version>=10) {
      const center=cellCenter(worldToCell(s));
      if (!integer(s.actionPoints,0,aircraftActionLimit(s)) || Math.abs(s.x-center.x)>1e-7 || Math.abs(s.y-center.y)>1e-7) fail();
      if (s.flight && (!record(s.flight) || !record(s.flight.next) || !match.world.contains(s.flight.next) || hexDistance(worldToCell(s),s.flight.next)!==1 || !finite(s.flight.progress,0,1) || s.flight.progress>=1)) fail();
    } else if (s.flight!==undefined) fail();
    if (!['patrol','move','attack','return'].includes(s.order) || (s.order === 'move') !== !!s.destination || (s.order === 'attack') !== !!s.targetId) fail();
    if (s.destination && (!finite(s.destination.x,0,match.world.bounds.width) || !finite(s.destination.y,0,match.world.bounds.height) || !match.world.contains(worldToCell(s.destination)))) fail();
    if (version>=10 && s.destination) { const center=cellCenter(worldToCell(s.destination));if(Math.abs(center.x-s.destination.x)>1e-7||Math.abs(center.y-s.destination.y)>1e-7)fail(); }
    if (s.targetId) { const target = match.units.find(u => u.instanceId === s.targetId) ?? state.squadrons.find(a => a.id === s.targetId); if (!target || target.ownerId === s.ownerId || 'role' in target && s.role !== 'fighter') fail(); }
    ids.add(s.id); slots.add(`${s.carrierId}:${s.slot}`);
  }
  const restored: AviationState & { nations?: Record<string,AirNation> } = JSON.parse(JSON.stringify(state));
  delete restored.nations;
  restored.decks=restored.decks&&typeof restored.decks==='object'?restored.decks:{};
  if (migrateCountry) for (const s of restored.squadrons) s.nation = nationFor(match,s.carrierId);
  if (migrateEndurance) for (const s of restored.squadrons) {
    const legacy=s as Squadron & {fuel?:number}; s.fuelTurns=Math.min(s.planes,Math.ceil(legacy.fuel!/30)); delete legacy.fuel;
  }
  restored.squadrons=restored.squadrons.filter(s=>s.fuelTurns>0);
  if(match.rulesetId==='naval-v2'&&version<26)for(const squadron of restored.squadrons){squadron.cooldown=0;delete squadron.flight;}
  if (version<9) for (const s of restored.squadrons) s.actionPoints=aircraftActionLimit(s)*s.fuelTurns/s.planes;
  if (version<10) for (const s of restored.squadrons) {
    Object.assign(s,cellCenter(worldToCell(s)));s.actionPoints=Math.floor(s.actionPoints);
    if (s.destination) s.destination=cellCenter(worldToCell(s.destination));
    if (s.actionPoints===0) returnHome(s);
  }
  const restoredIds=new Set(restored.squadrons.map(s=>s.id));
  for (const s of restored.squadrons) if (s.targetId) {
    const shipTarget=match.units.find(unit=>unit.instanceId===s.targetId);
    if((!shipTarget&&!restoredIds.has(s.targetId))||(match.rulesetId==='naval-v2'&&s.role==='fighter'&&!!shipTarget)){s.order='patrol';s.targetId=undefined;}
  }
  const carriers=match.units.filter(unit=>!!CARRIER_STATS[unit.asset.ship_type.code]);
  if(version<21){
    restored.decks={};
    if(match.rulesetId==='naval-v2')for(const carrier of carriers){
      const deck=createDeck(match,carrier.instanceId);for(const air of restored.squadrons.filter(item=>item.carrierId===carrier.instanceId)){const slot=deck.squadrons.find(item=>item.slot===air.slot);if(slot&&slot.status!=='lost'){slot.status='airborne';slot.hp=air.hp;}}
      restored.decks[carrier.instanceId]=deck;
    }
  }else if(match.rulesetId==='classic-v1'){
    if(Object.keys(restored.decks).length)fail();
  }else{
    if(Object.keys(restored.decks).length!==carriers.length)fail();
    for(const carrier of carriers){
      const deck=restored.decks[carrier.instanceId],stats=CARRIER_STATS[carrier.asset.ship_type.code];
      if(!deck||deck.carrierId!==carrier.instanceId||deck.ownerId!==carrier.ownerId||deck.operationRound!==match.round||!integer(deck.operationsUsed,0,deckOperationLimit(carrier))||!Array.isArray(deck.squadrons)||deck.squadrons.length!==stats.roles.length)fail();
      const seenSlots=new Set<number>();
      for(const slot of deck.squadrons){
        if(!integer(slot.slot,0,stats.roles.length-1)||seenSlots.has(slot.slot)||slot.role!==stats.roles[slot.slot]||!integer(slot.planes,3,4)||slot.planes!==stats.planes||!integer(slot.hp,0,slot.planes*2)||!['ready','reserve','airborne','turnaround','lost'].includes(slot.status))fail();
        if((slot.status==='lost'&&slot.hp!==0)||(slot.status!=='lost'&&slot.hp===0)||(slot.status==='turnaround'&&slot.readyRound!==match.round+2)||(slot.status!=='turnaround'&&slot.readyRound!==undefined))fail();
        const airKey=`${carrier.instanceId}:${slot.slot}`,air=restored.squadrons.find(item=>`${item.carrierId}:${item.slot}`===airKey);
        if(carrier.status==='sunk'&&slot.status!=='lost'||slot.status==='airborne'&&!air&&carrier.status!=='sunk'||slot.status!=='airborne'&&air&&carrier.status!=='sunk')fail();
        seenSlots.add(slot.slot);
      }
      if(deck.squadrons.filter(slot=>slot.status==='ready').length>deckReadyLimit(carrier))fail();
    }
  }
  return restored;
}
