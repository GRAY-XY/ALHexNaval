import { cellCenter, fromAxial, hexDistance, hexLine, neighbors, toAxial, worldToCell } from './hex.ts';
import {FogOfWar,type SavedFog} from './fog.ts';
import {createPorts,createLegacyPorts,PORT_OIL_BONUS,STARTING_CREDITS,PORT_INCOME,MAX_CREDITS,REPAIR_LIMIT,REPAIR_PRICE,REINFORCEMENT_COST,type Port,type PortView,type MatchResult,type SavedCampaign} from './ports.ts';
import { arrivalAnchor, translateCell } from './arrival.ts';
import { cellKey, findRoute, sameCell, type Route } from './pathfinding.ts';
import { HexWorld } from './world.ts';
import { Terrain, type Cell, type DeployedShip, type ShipAsset } from './types.ts';
import { emptyAviation, endAviationTurn, validateAviation, type AviationState, type Squadron } from './aircraft.ts';

export const TEAM_NAMES = ['湛蓝舰队', '翠绿舰队', '琥珀舰队', '紫罗兰舰队', '珊瑚舰队', '银白舰队', '金辉舰队', '绯红舰队'];
export const TEAM_COLORS = [0x89d8e3, 0x9ae4c6, 0xf2c39c, 0xc8b7e8, 0xf29db4, 0xdde8f4, 0xe8d777, 0xf08476];
export const OIL_PER_TURN = 50;
export const BASE_OIL_CAP=OIL_PER_TURN-PORT_OIL_BONUS;
const LEGACY_MOVEMENT: Record<string, number> = { DD: 4, CL: 3, CA: 2, BB: 2, CV: 2, CVL: 2 };
export type Armor = 'light' | 'medium' | 'heavy';
export interface CombatProfile { maxHp: number; armor: Armor; armorName: string }
export const COMBAT_STATS: Record<string, CombatProfile> = {
  DD: { maxHp: 6, armor: 'light', armorName: '轻型装甲' }, CL: { maxHp: 8, armor: 'light', armorName: '轻型装甲' },
  CA: { maxHp: 11, armor: 'medium', armorName: '中型装甲' }, BB: { maxHp: 16, armor: 'heavy', armorName: '重型装甲' },
  CV: { maxHp: 10, armor: 'medium', armorName: '中型装甲' }, CVL: { maxHp: 9, armor: 'medium', armorName: '中型装甲' },
};
export type WeaponKind = 'gun' | 'torpedo' | 'air';
export interface WeaponDefinition {
  id: string; name: string; kind: WeaponKind; minRange: number; maxRange: number; cooldown: number;
  damage: Record<Armor, number>;
}
export const WEAPONS: Record<string, WeaponDefinition[]> = {
  DD: [{ id: 'light-gun', name: '轻型舰炮', kind: 'gun', minRange: 1, maxRange: 3, cooldown: 0, damage: { light: 2, medium: 1, heavy: 1 } },
    { id: 'torpedo', name: '鱼雷齐射', kind: 'torpedo', minRange: 2, maxRange: 5, cooldown: 1, damage: { light: 4, medium: 4, heavy: 4 } }],
  CL: [{ id: 'medium-gun', name: '巡洋舰炮', kind: 'gun', minRange: 1, maxRange: 4, cooldown: 0, damage: { light: 3, medium: 2, heavy: 2 } },
    { id: 'torpedo', name: '鱼雷齐射', kind: 'torpedo', minRange: 2, maxRange: 5, cooldown: 1, damage: { light: 3, medium: 3, heavy: 3 } }],
  CA: [{ id: 'heavy-gun', name: '重巡主炮', kind: 'gun', minRange: 1, maxRange: 5, cooldown: 0, damage: { light: 3, medium: 4, heavy: 3 } },
    { id: 'torpedo', name: '鱼雷齐射', kind: 'torpedo', minRange: 2, maxRange: 5, cooldown: 1, damage: { light: 4, medium: 4, heavy: 4 } }],
  BB: [{ id: 'main-gun', name: '战列主炮', kind: 'gun', minRange: 2, maxRange: 7, cooldown: 0, damage: { light: 3, medium: 4, heavy: 5 } }],
  CV: [], CVL: [],
};

export interface MatchUnit extends DeployedShip {
  ownerId: number; action: number; status: 'ready' | 'wait' | 'hold' | 'sunk';
  hp: number; maxHp: number; guard: boolean; cooldowns: Record<string, number>;
  notice?: string;
  availableRound?:number;
}
export interface GroupMovePlan { source: Cell; target: Cell; orders: { instanceId: string; target: Cell; route: Route }[]; skipped: string[] }
export interface GroupMoveOptions { source?: Cell; fits?: (source: Cell, target: Cell) => boolean }
export interface MoveEvent { instanceId: string; cells: Cell[] }
export interface CombatEvent { attackerId: string; targetId: string; weaponId: string; kind: WeaponKind; damage: number; hpBefore: number; hpAfter: number; sunk: boolean; origin?: { x: number; y: number } }
export interface AttackPreview { valid: boolean; reason?: string; distance: number; damage: number; hpAfter: number; sunk: boolean; blocked: Cell[]; weapon?: WeaponDefinition }
export type TeamController = 'human' | 'ai';
export interface Team { id: number; name: string; oil: number; credits:number; eliminated:boolean; controller:TeamController }
export interface SavedMatch {
  format: 'al-hex-match'; version: 15; mapVersion: 1; size: number; mapHash: string;
  round: number; activeIndex: number; teams: Team[];
  units: (Omit<MatchUnit, 'asset'> & { assetId: string })[];
  aviation: AviationState;
  fog:SavedFog;
  campaign:SavedCampaign;
}
function profile(code: string): CombatProfile { return COMBAT_STATS[code] ?? COMBAT_STATS.CA; }
export function mapHash(world: HexWorld): string {
  let hash = 2166136261; for (const data of [world.terrain, world.valid]) for (const byte of data) hash = Math.imul(hash ^ byte, 16777619);
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export class Match {
  teams: Team[]; units: MatchUnit[];
  aviation = emptyAviation();
  round = 1; activeIndex = 0;
  readonly hash: string;
  readonly world: HexWorld;
  readonly fog:FogOfWar;
  ports:Port[]=[];
  portIntel:number[][]=[];
  result?:MatchResult;
  campaignRevision=0;
  constructor(world: HexWorld, assets: ShipAsset[], teamCount = 4, controllers?:TeamController[]) {
    this.world = world;
    if (!Number.isInteger(teamCount) || teamCount < 2 || teamCount > 8 || !assets.length || new Set(assets.map(asset => asset.id)).size !== assets.length) throw Error('势力数应为 2～8，舰船池不能为空或重复');
    if(controllers&&(controllers.length!==teamCount||controllers.some(controller=>!['human','ai'].includes(controller))))throw Error('席位设置无效');
    this.teams = Array.from({ length: teamCount }, (_, i) => ({ id: i + 1, name: TEAM_NAMES[i], oil: OIL_PER_TURN,credits:STARTING_CREDITS,eliminated:false,controller:controllers?.[i]??'human' }));
    const occupied = new Set<string>(), starts = [[.12,.13],[.82,.15],[.82,.82],[.15,.82],[.48,.10],[.90,.50],[.50,.90],[.10,.50]];
    this.units = this.teams.flatMap((team,index) => {
      const origin = { col: Math.round(world.width * starts[index][0]), row: Math.round(world.height * starts[index][1]) };
      return world.deploy(assets, origin, team.id, occupied).map(unit => { const combat = profile(unit.asset.ship_type.code); return { ...unit, ownerId: team.id,
        action: 1, status: 'ready' as const,
        hp: combat.maxHp, maxHp: combat.maxHp, guard: false, cooldowns: {} }; });
    });
    this.hash = mapHash(world);
    this.ports=createPorts(world,this.units,teamCount);
    this.portIntel=this.teams.map(t=>this.ports.map(p=>p.ownerId===t.id?t.id:-1));
    this.fog=new FogOfWar(world,teamCount);this.refreshVision();
  }
  refreshVision():boolean {
    const changed=this.fog.refresh(this.units,this.aviation.squadrons);
    if(changed)this.syncPortIntel();
    return changed;
  }
  private syncPortIntel():void {
    for(const t of this.teams)for(let i=0;i<this.ports.length;i++){
      const p=this.ports[i];if((p.ownerId===t.id||this.fog.state(t.id,p)===2)&&this.portIntel[t.id-1][i]!==p.ownerId){this.portIntel[t.id-1][i]=p.ownerId;this.campaignRevision++;}
    }
  }
  canSee(owner:number,cell:Cell):boolean {this.refreshVision();return this.fog.state(owner,cell)===2;}
  isExplored(owner:number,cell:Cell):boolean {this.refreshVision();return this.fog.state(owner,cell)>0;}
  unitVisible(unit:MatchUnit,owner=this.active.id):boolean {return unit.ownerId===owner||this.canSee(owner,unit);}
  airVisible(air:Squadron,owner=this.active.id):boolean {return air.ownerId===owner||this.canSee(owner,worldToCell(air));}
  get active(): Team { return this.teams[this.activeIndex]; }
  unit(id: string): MatchUnit { const unit = this.units.find(u => u.instanceId === id); if (!unit) throw Error('找不到舰船'); return unit; }
  team(ownerId: number): Team { const team = this.teams.find(item => item.id === ownerId); if (!team) throw Error('找不到势力'); return team; }
  budget(unit: MatchUnit): number { return this.team(unit.ownerId).oil; }
  oilCap(owner=this.active.id):number {return BASE_OIL_CAP+PORT_OIL_BONUS*this.ports.filter(p=>p.ownerId===owner).length;}
  weapons(unitOrId: MatchUnit | string): WeaponDefinition[] { const unit = typeof unitOrId === 'string' ? this.unit(unitOrId) : unitOrId; return WEAPONS[unit.asset.ship_type.code] ?? []; }
  cooldown(unit: MatchUnit, weaponId: string): number { return Math.max(0, unit.cooldowns[weaponId] ?? 0); }
  assertPlayable():void {if(this.result)throw Error('战局已结束，可查看海图或建立新战局');}
  private requireActive(unit: MatchUnit): void {this.assertPlayable(); if (unit.ownerId !== this.active.id) throw Error('只能指挥当前势力的舰船'); if (unit.status === 'sunk') throw Error('该舰船已经沉没');if(unit.availableRound&&unit.availableRound>this.round)throw Error('增援舰船在下次本方回合投入使用'); }
  port(id:string):Port {const p=this.ports.find(p=>p.id===id);if(!p)throw Error('找不到港口');return p;}
  knownPorts(owner=this.active.id):PortView[]{return this.ports.flatMap((port,i)=>{const ownerId=this.portIntel[owner-1][i];return ownerId<0?[]:[{port,ownerId,visible:this.fog.state(owner,port)===2}];});}
  income(owner=this.active.id):number{return this.ports.filter(p=>p.ownerId===owner).length*PORT_INCOME;}
  capturePreview(id:string,portId:string):{valid:boolean;reason:string} {
    const u=this.unit(id),p=this.port(portId);
    const reason=this.result?'战局已结束':u.ownerId!==this.active.id?'只能使用本方舰船':u.status!=='ready'||u.availableRound&&u.availableRound>this.round?'舰船当前无法作战':!u.action?'本舰作战行动已用':hexDistance(u,p)>1?'舰船需进入港口1格内':p.ownerId===u.ownerId?'已经是本方港口':this.units.some(v=>v.status!=='sunk'&&v.ownerId!==u.ownerId&&hexDistance(v,p)<=1)?'先清除港口1格内敌舰':'';
    return {valid:!reason,reason};
  }
  capturePort(id:string,portId:string):void {
    const preview=this.capturePreview(id,portId);if(!preview.valid)throw Error(preview.reason);
    const u=this.unit(id),p=this.port(portId),old=p.ownerId,index=this.ports.indexOf(p);p.ownerId=u.ownerId;u.action=0;u.notice=`已占领${p.name}`;
    this.portIntel[u.ownerId-1][index]=u.ownerId;if(old)this.portIntel[old-1][index]=u.ownerId;
    for(const t of this.teams)if(this.fog.state(t.id,p)===2)this.portIntel[t.id-1][index]=u.ownerId;
    if(old)this.team(old).oil=Math.min(this.team(old).oil,this.oilCap(old));
    this.campaignRevision++;this.resolveOutcome();
  }
  repairPreview(id:string,portId:string):{valid:boolean;reason:string;hp:number;cost:number} {
    const u=this.unit(id),p=this.port(portId),hp=Math.min(REPAIR_LIMIT,u.maxHp-u.hp),cost=hp*REPAIR_PRICE;
    const reason=this.result?'战局已结束':u.ownerId!==this.active.id||p.ownerId!==u.ownerId?'需要本方舰船与本方港口':u.status!=='ready'||u.availableRound&&u.availableRound>this.round?'舰船当前无法作战':!u.action?'本舰作战行动已用':hexDistance(u,p)>1?'舰船需进入港口1格内':!hp?'舰体耐久已经全满':this.active.credits<cost?`维修需要${cost}资金`:'';
    return {valid:!reason,reason,hp,cost};
  }
  repairShip(id:string,portId:string):void {
    const preview=this.repairPreview(id,portId);if(!preview.valid)throw Error(preview.reason);
    const u=this.unit(id);this.active.credits-=preview.cost;u.hp+=preview.hp;u.action=0;u.notice=`港口维修恢复${preview.hp}耐久`;
    this.campaignRevision++;
  }
  reinforcementPreview(portId:string,id:string):{valid:boolean;reason:string;cost:number;cell?:Cell} {
    const p=this.port(portId),u=this.unit(id),cost=REINFORCEMENT_COST[u.asset.ship_type.code]??40;
    let reason=this.result?'战局已结束':p.ownerId!==this.active.id||u.ownerId!==this.active.id?'只能在本方港口补充本方舰船':u.status!=='sunk'?'只能补充已损失的舰型':p.usedRound===this.round?'该港口本轮已提供增援':this.active.credits<cost?`增援需要${cost}资金`:'';
    const occupied=new Set(this.units.filter(v=>v.status!=='sunk').map(cellKey));
    const cell=[p,...neighbors(p)].find(c=>this.world.isSea(c)&&!occupied.has(cellKey(c)));
    if(!reason&&!cell)reason='港口附近没有空闲泊位';
    return {valid:!reason,reason,cost,cell};
  }
  reinforce(portId:string,id:string):MatchUnit {
    const preview=this.reinforcementPreview(portId,id);if(!preview.valid||!preview.cell)throw Error(preview.reason);
    const p=this.port(portId),u=this.unit(id);this.active.credits-=preview.cost;p.usedRound=this.round;
    // This is a replacement hull. Aircraft still attached to the destroyed hull cannot be inherited.
    this.aviation.squadrons=this.aviation.squadrons.filter(s=>s.carrierId!==id);delete this.aviation.launched[id];delete this.aviation.aa[id];
    Object.assign(u,preview.cell,{hp:u.maxHp,status:'wait',action:0,guard:false,cooldowns:{},availableRound:this.round+1,notice:'港口增援已抵达，下次本方回合投入使用'});
    this.refreshVision();this.campaignRevision++;return u;
  }
  resolveOutcome():void {
    for(const t of this.teams){const cap=this.oilCap(t.id);if(t.oil>cap){t.oil=cap;this.campaignRevision++;}}
    if(this.result)return;
    for(const t of this.teams){const eliminated=!this.units.some(u=>u.ownerId===t.id&&u.status!=='sunk')&&!this.ports.some(p=>p.ownerId===t.id);if(t.eliminated!==eliminated){t.eliminated=eliminated;this.campaignRevision++;}}
    const surviving=this.teams.filter(t=>!t.eliminated),homes=this.ports.filter(p=>p.homeForId);
    if(surviving.length<=1)this.result={winnerId:surviving[0]?.id??null,reason:surviving.length?'elimination':'draw',round:this.round};
    else if(homes.length&&homes[0].ownerId&&homes.every(p=>p.ownerId===homes[0].ownerId))this.result={winnerId:homes[0].ownerId,reason:'headquarters',round:this.round};
    if(this.result)this.campaignRevision++;
  }
  private navigation(unit: MatchUnit, moving = new Set<string>()) {
    const occupied = new Map(this.units.filter(u => u.status !== 'sunk' && u.instanceId !== unit.instanceId).map(u => [cellKey(u), u]));
    const cost = (cell: Cell): number => {
      if (!this.canSee(unit.ownerId,cell)||!this.world.isSea(cell)) return Infinity;
      const blocker = occupied.get(cellKey(cell)); if (blocker && blocker.ownerId !== unit.ownerId) return Infinity;
      return this.world.at(cell) === Terrain.Shallow && !['DD', 'CL'].includes(unit.asset.ship_type.code) ? 2 : 1;
    };
    const stop = (cell: Cell): boolean => this.canSee(unit.ownerId,cell)&&this.world.isSea(cell) && (!occupied.has(cellKey(cell)) || moving.has(occupied.get(cellKey(cell))!.instanceId));
    return { cost, stop };
  }
  route(id: string, target: Cell): Route | undefined {
    const unit = this.unit(id); if (unit.status === 'sunk') return; const nav = this.navigation(unit);
    return findRoute(this.world, unit, target, nav.cost, nav.stop);
  }
  reachable(id: string): Cell[] {
    const unit = this.unit(id); if (this.result||unit.ownerId !== this.active.id || unit.status !== 'ready') return [];
    const start = unit, nav = this.navigation(unit), budget = this.budget(unit), queue = [{ cell: start as Cell, cost: 0 }], costs = new Map([[cellKey(start), 0]]), result = new Map<string, Cell>();
    for (let i = 0; i < queue.length; i++) { const item = queue[i]; if (item.cost !== costs.get(cellKey(item.cell))) continue;
      if (nav.stop(item.cell)) result.set(cellKey(item.cell), item.cell);
      for (const cell of neighbors(item.cell)) { if (!this.world.contains(cell)) continue; const cost = item.cost + nav.cost(cell), key = cellKey(cell);
        if (cost <= budget && cost < (costs.get(key) ?? Infinity)) { costs.set(key, cost); queue.push({ cell, cost }); } }
    } return [...result.values()];
  }
  issueMove(id: string, target: Cell): MoveEvent[] {
    const unit = this.unit(id); this.requireActive(unit);
    if(!this.canSee(unit.ownerId,target))throw Error('目标不在本方当前视野内，请分段移动或派飞机侦察');
    if (unit.status !== 'ready') throw Error('先唤醒或取消本回合待命，再安排航行');
    const route = this.route(id, target); if (!route) throw Error('目标无法抵达：岛屿、无效海域或舰船阻挡');
    if (route.cost > this.budget(unit)) throw Error(`石油不足：本次移动需要 ${route.cost} 点，当前剩余 ${this.budget(unit)} 点，请选择本回合可抵达的海格`);
    unit.notice = undefined;
    if (sameCell(unit,target)) return [];
    const cells = route.cells, end = cells[cells.length-1];
    unit.facing = end.col < unit.col ? 'left' : 'right'; unit.col = end.col; unit.row = end.row;
    this.team(unit.ownerId).oil -= route.cost;
    return [{ instanceId: unit.instanceId, cells }];
  }
  // Freeze only the arrival layout. Each member still follows an independent route.
  planGroupMove(ids: string[], target: Cell, options: GroupMoveOptions = {}): GroupMovePlan {
    if(!this.canSee(this.active.id,target))throw Error('目标不在本方当前视野内，请分段移动或派飞机侦察');
    if (!this.world.isSea(target)) throw Error('请在有效海格下达移动指令');
    const units = [...new Set(ids)].map(id => this.unit(id));
    if (!units.length) throw Error('先框选本方舰船');
    for (const unit of units) this.requireActive(unit);
    const ready = units.filter(unit => unit.status === 'ready'), skipped = units.filter(unit => unit.status !== 'ready').map(unit => unit.instanceId);
    if (!ready.length) throw Error('选中的舰船暂无可用航线；请先唤醒舰船');
    const source = options.source ?? arrivalAnchor(ready.map(cellCenter));
    const radius = Math.max(4, Math.ceil(Math.sqrt(ready.length))*2 + 3), candidates: Cell[] = [], axial = toAxial(target);
    for (let q = -radius; q <= radius; q++) for (let r = -radius; r <= radius; r++) {
      const cell = fromAxial(axial.q + q, axial.r + r);
      if (hexDistance(target, cell) <= radius && this.world.isSea(cell)) candidates.push(cell);
    }
    candidates.sort((a,b) => hexDistance(a,target)-hexDistance(b,target) || a.row-b.row || a.col-b.col);
    const moving = new Set(ready.map(unit => unit.instanceId)), navigations = ready.map(unit => this.navigation(unit,moving));
    const components = new Map<string,number>(); let componentSerial=0;
    for (const anchor of candidates) {
      if (options.fits && !options.fits(source,anchor)) continue;
      const targets = ready.map(unit => translateCell(unit,source,anchor));
      if (!targets.every((cell,i) => navigations[i].stop(cell))) continue;
      const orders: GroupMovePlan['orders'] = [];
      for (let i = 0; i < ready.length; i++) {
        const unit = ready[i], cell = targets[i], nav = navigations[i], component = components.get(cellKey(unit));
        if (component !== undefined && components.get(cellKey(cell)) !== component) break;
        const route = findRoute(this.world,unit,cell,nav.cost,nav.stop);
        if (!route) {
          // A failed search labels this sea region once, avoiding repeated full-map searches for nearby berths.
          if (component===undefined) {
            const serial=++componentSerial, queue: Cell[]=[unit];components.set(cellKey(unit),serial);
            for(let i=0;i<queue.length;i++) for(const next of neighbors(queue[i])) if(this.world.contains(next) && Number.isFinite(nav.cost(next)) && !components.has(cellKey(next))) {components.set(cellKey(next),serial);queue.push(next);}
          }
          break;
        }
        orders.push({ instanceId: unit.instanceId, target: cell, route });
      }
      if (orders.length === ready.length) return { source, target: anchor, orders, skipped };
    }
    throw Error('目标附近无法完整保留出发队形，请选择更开阔且连通的海域');
  }
  issueGroupMove(ids: string[], target: Cell, options: GroupMoveOptions = {}): { events: MoveEvent[]; assigned: number; skipped: number; source: Cell; target: Cell } {
    const plan = this.planGroupMove(ids,target,options);
    if (!plan.orders.length) throw Error('选中的舰船暂无可用航线；请唤醒舰船或选择其他海格');
    const cost = plan.orders.reduce((sum,order) => sum + order.route.cost,0);
    if (cost > this.active.oil) throw Error(`石油不足：整组移动需要 ${cost} 点，当前剩余 ${this.active.oil} 点，请选择更近的目标`);
    const snapshots = plan.orders.map(order => { const unit=this.unit(order.instanceId);return {unit,col:unit.col,row:unit.row,facing:unit.facing,notice:unit.notice}; }), oil=this.active.oil;
    try {
      const events=this.moveTogether(plan.orders);
      return { events, assigned: plan.orders.length, skipped: plan.skipped.length, source: plan.source, target: plan.target };
    } catch(error) {
      this.active.oil=oil;for(const {unit,...snapshot} of snapshots)Object.assign(unit,snapshot);throw error;
    }
  }
  private moveTogether(orders: GroupMovePlan['orders']): MoveEvent[] {
    // Targets exist only during this command; no ship retains a future movement order.
    const entries = orders.map(order => {
      const unit=this.unit(order.instanceId);unit.notice=undefined;
      return {unit,target:order.target,route:{...order.route,cells:[...order.route.cells],costs:[...order.route.costs]},cells:[{col:unit.col,row:unit.row}]};
    });
    let progressed: boolean;
    do {
      progressed = false;
      // Let the nearest free step go first so adjacent ships vacate cells rather than leap past each other.
      const stepCosts = new Map<string,number>();
      for (const entry of entries) {
        if (sameCell(entry.unit,entry.target)) continue;
        const nav=this.navigation(entry.unit); let cost=0, first=Infinity;
        if (entry.route) for (let i=1;i<entry.route.cells.length;i++) {
          cost+=entry.route.costs[i]; if(cost>this.budget(entry.unit)) break;
          if(nav.stop(entry.route.cells[i])) {first=cost;break;}
        }
        stepCosts.set(entry.unit.instanceId,first);
      }
      entries.sort((a,b)=>(stepCosts.get(a.unit.instanceId)??Infinity)-(stepCosts.get(b.unit.instanceId)??Infinity));
      for (const entry of entries) {
        const { unit } = entry; if (sameCell(unit,entry.target)) continue;
        const route = entry.route; if (!route) continue;
        const nav = this.navigation(unit); let cost = 0;
        for (let i = 1; i < route.cells.length; i++) {
          cost += route.costs[i]; if (cost > this.budget(unit)) break;
          if (!nav.stop(route.cells[i])) continue;
          const end = route.cells[i]; entry.cells.push(...route.cells.slice(1,i+1));
          unit.facing = end.col < unit.col ? 'left' : 'right'; unit.col = end.col; unit.row = end.row;
          this.team(unit.ownerId).oil -= cost;
          route.cells = route.cells.slice(i); route.costs = [0,...route.costs.slice(i+1)]; route.cost -= cost;
          progressed = true; break;
        }
      }
    } while (progressed);
    if (entries.some(entry => !sameCell(entry.unit,entry.target))) throw Error('所选舰船途中互相阻挡，本次移动未执行，请选择其他目标');
    return entries.filter(entry => entry.cells.length > 1).map(entry => ({ instanceId: entry.unit.instanceId, cells: entry.cells }));
  }
  attackPreview(attackerId: string, targetId: string, weaponId: string): AttackPreview {
    const attacker = this.unit(attackerId), target = this.unit(targetId), weapon = this.weapons(attacker).find(item => item.id === weaponId);
    if(!this.unitVisible(target,attacker.ownerId))return {valid:false,reason:'目标不在本方当前视野内',distance:0,damage:0,hpAfter:0,sunk:false,blocked:[],weapon};
    const distance = hexDistance(attacker, target), blocked = weapon?.kind === 'air' ? [] : hexLine(attacker, target).slice(1, -1).filter(cell => this.world.at(cell) === Terrain.Land);
    const armor = profile(target.asset.ship_type.code).armor, base = weapon?.damage[armor] ?? 0, damage = target.guard ? Math.max(1, base - 2) : base;
    const result = (reason?: string): AttackPreview => ({ valid: !reason, reason, distance, damage, hpAfter: Math.max(0, target.hp - damage), sunk: damage >= target.hp, blocked, weapon });
    if (!weapon) return result('该舰种没有这种武器');
    if(this.result)return result('战局已结束');
    if (attacker.ownerId !== this.active.id) return result('只能由当前势力发动攻击');
    if (attacker.status === 'sunk') return result('攻击舰已经沉没');
    if (target.status === 'sunk') return result('目标已经沉没');
    if (attacker.ownerId === target.ownerId) return result('不能攻击本方舰船');
    if (attacker.status !== 'ready') return result('待命或驻留舰船本回合无法攻击');
    if (!attacker.action) return result('本回合作战行动已使用');
    if (this.cooldown(attacker, weapon.id)) return result(`${weapon.name}冷却中：${this.cooldown(attacker, weapon.id)} 回合`);
    if (distance < weapon.minRange || distance > weapon.maxRange) return result(`超出射程：需要 ${weapon.minRange}～${weapon.maxRange} 格`);
    if (blocked.length) return result('射线被岛屿阻挡');
    return result();
  }
  attack(attackerId: string, targetId: string, weaponId: string): CombatEvent {
    const attacker = this.unit(attackerId), target = this.unit(targetId), preview = this.attackPreview(attackerId, targetId, weaponId);
    if (!preview.valid || !preview.weapon) throw Error(preview.reason ?? '无法发动攻击');
    const hpBefore = target.hp; target.hp = preview.hpAfter; attacker.action = 0;
    if (preview.weapon.cooldown) attacker.cooldowns[preview.weapon.id] = preview.weapon.cooldown + 1;
    attacker.facing = target.col < attacker.col ? 'left' : 'right';
    if (!target.hp) this.sink(target); else target.notice = target.guard ? `防御姿态吸收伤害，剩余耐久 ${target.hp}/${target.maxHp}` : `遭到攻击，剩余耐久 ${target.hp}/${target.maxHp}`;
    this.resolveOutcome();
    return { attackerId, targetId, weaponId, kind: preview.weapon.kind, damage: preview.damage, hpBefore, hpAfter: target.hp, sunk: target.status === 'sunk' };
  }
  defend(id: string): void {
    const unit = this.unit(id); this.requireActive(unit);
    if (unit.status !== 'ready') throw Error('待命或驻留舰船本回合无法防御');
    if (!unit.action) throw Error('本回合作战行动已使用');
    unit.action = 0; unit.guard = true; unit.notice = '防御姿态生效：受到的每次伤害减少 2 点，持续至下次本方回合';
  }
  airDamage(squadron: Squadron, targetId: string): CombatEvent {
    this.assertPlayable();
    const target = this.unit(targetId), armor = profile(target.asset.ship_type.code).armor;
    if(!this.unitVisible(target,squadron.ownerId))throw Error('目标不在本方当前视野内');
    const base = squadron.role === 'fighter' ? 1 : squadron.role === 'torpedo' ? 4 : armor === 'heavy' ? 3 : 4;
    const strength = Math.ceil(squadron.hp / 2) / squadron.planes;
    const damage = Math.max(1,Math.ceil(base*strength) - (target.guard ? 2 : 0)), hpBefore = target.hp;
    target.hp = Math.max(0,target.hp-damage); if (!target.hp) this.sink(target);
    this.resolveOutcome();
    return { attackerId: squadron.id, targetId, weaponId: squadron.role, kind: squadron.role === 'torpedo' ? 'torpedo' : 'air',
      damage, hpBefore, hpAfter: target.hp, sunk: !target.hp, origin: { x: squadron.x, y: squadron.y } };
  }
  private sink(unit: MatchUnit): void {
    unit.hp = 0; unit.action = 0; unit.status = 'sunk'; unit.guard = false; unit.notice = '已被击沉';
  }
  wait(id: string, hold = false): void {
    const unit = this.unit(id); this.requireActive(unit); unit.notice=undefined;
    unit.status = hold ? 'hold' : 'wait'; unit.action = 0; unit.guard = false;
  }
  wake(id: string): void { const unit = this.unit(id); this.requireActive(unit); unit.status = 'ready'; }
  nextPending(after?: string): MatchUnit | undefined {
    const own = this.units.filter(u => u.ownerId === this.active.id && u.status === 'ready' && (this.active.oil > 0 || u.action > 0));
    if (!own.length) return;
    const index = own.findIndex(u => u.instanceId === after); return own[(index + 1) % own.length];
  }
  endTurn(): MoveEvent[] {
    this.assertPlayable();this.resolveOutcome();if(this.result)return [];
    endAviationTurn(this,this.active.id);
    do {this.activeIndex = (this.activeIndex + 1) % this.teams.length; if (!this.activeIndex) this.round++;}while(this.active.eliminated);
    this.active.oil = this.oilCap();
    this.active.credits=Math.min(MAX_CREDITS,this.active.credits+this.income());this.campaignRevision++;
    const own = this.units.filter(u => u.ownerId === this.active.id);
    for (const unit of own) {
      if (unit.status === 'sunk') continue;
      for (const [weapon, turns] of Object.entries(unit.cooldowns)) { const next = Math.max(0, turns - 1); if (next) unit.cooldowns[weapon] = next; else delete unit.cooldowns[weapon]; }
      unit.guard = false; if (unit.status === 'wait') unit.status = 'ready';
      if(unit.availableRound&&unit.availableRound<=this.round){delete unit.availableRound;unit.notice=undefined;}
      unit.action = unit.status === 'hold' ? 0 : 1;
    }
    return [];
  }
  save(): SavedMatch {
    this.refreshVision();this.resolveOutcome();
    return JSON.parse(JSON.stringify({ format: 'al-hex-match', version: 15, mapVersion: 1, size: this.world.width, mapHash: this.hash,
      round: this.round, activeIndex: this.activeIndex, teams: this.teams,
      units: this.units.map(({ asset, ...unit }) => ({ ...unit, assetId: asset.id })), aviation: this.aviation,fog:this.fog.save(),campaign:{ports:this.ports,intel:this.portIntel,result:this.result} }));
  }
  static load(input: unknown, assets: ShipAsset[]): Match {
    const data = input as any;
    const fail = (): never => { throw Error('存档格式或战局数据无效，当前战局未改变'); };
    const integer = (n: unknown, low: number, high: number) => Number.isInteger(n) && Number(n) >= low && Number(n) <= high;
    if (!data || data.format !== 'al-hex-match' || ![1,2,3,4,5,6,7,8,9,10,11,12,13,14,15].includes(data.version) || data.mapVersion !== 1 || ![128,256,512].includes(data.size)) fail();
    if (!Array.isArray(data.teams) || !integer(data.teams.length, 2, 8) || !integer(data.activeIndex, 0, data.teams.length - 1) || !integer(data.round, 1, 1_000_000)) fail();
    if (data.version < 8 ? !integer(data.fleetSerial,0,1_000_000) || !Array.isArray(data.fleets) : data.fleets !== undefined || data.fleetSerial !== undefined) fail();
    if (data.teams.some((team: Team, i: number) => !team || team.id !== i + 1 || team.name !== TEAM_NAMES[i] || data.version >= 4 && !integer(team.oil, 0, data.version>=14?MAX_CREDITS:OIL_PER_TURN))) fail();
    if(data.version>=13&&data.teams.some((t:Team)=>!integer(t.credits,0,MAX_CREDITS)||typeof t.eliminated!=='boolean'))fail();
    if(data.version>=15&&data.teams.some((t:Team)=>!['human','ai'].includes(t.controller)))fail();
    const expectedUnits = assets.length * (data.version === 1 ? 1 : data.teams.length);
    if (!Array.isArray(data.units) || data.units.length !== expectedUnits || data.version < 8 && data.fleets.length > Math.floor(expectedUnits / 2)) fail();
    const match = new Match(new HexWorld(data.size), assets, data.teams.length); if (match.hash !== data.mapHash) throw Error('存档地图与当前生成规则不同，当前战局未改变');
    match.teams = data.teams.map((team: Team,i: number) => ({ id: i + 1, name: TEAM_NAMES[i], oil: data.version >= 4 ? team.oil : OIL_PER_TURN,credits:data.version>=13?team.credits:STARTING_CREDITS,eliminated:false,controller:data.version>=15?team.controller:'human' }));
    const freshUnits = match.units;
    const identities = new Set<string>(), occupied = new Set<string>(), assetIds = new Set<string>(), legacyMembership = new Map<string,string>();
    const validCell = (cell: Cell | undefined): boolean => !!cell && integer(cell.col, 0, data.size - 1) && integer(cell.row, 0, data.size - 1) && match.world.isSea(cell);
    const validNotice = (notice?: string) => notice === undefined || typeof notice === 'string' && notice.length < 160;
    match.units = data.units.map((raw: any) => {
      const saved = raw as any, expectedId = data.version === 1 ? `preview-${saved?.assetId}` : `team-${saved?.ownerId}-${saved?.assetId}`, assetKey = data.version === 1 ? saved?.assetId : `${saved?.ownerId}:${saved?.assetId}`;
      if (!saved || typeof saved.instanceId !== 'string' || saved.instanceId !== expectedId || identities.has(saved.instanceId) || assetIds.has(assetKey)) return fail();
      const asset = assets.find(a => a.id === saved.assetId); if (!asset || !validCell(saved) || !integer(saved.ownerId, 1, data.teams.length) || !['left','right'].includes(saved.facing)) return fail();
      const combat = profile(asset.ship_type.code), status = saved.status as MatchUnit['status'];
      if (!integer(saved.action, 0, 1) || data.version < 4 && !integer(saved.movement, 0, LEGACY_MOVEMENT[asset.ship_type.code] ?? 2) || data.version >= 4 && saved.movement !== undefined || !['ready','wait','hold',...(data.version >= 3 ? ['sunk'] : [])].includes(status)) return fail();
      const hp = data.version >= 3 ? saved.hp : combat.maxHp, maxHp = data.version >= 3 ? saved.maxHp : combat.maxHp;
      if (maxHp !== combat.maxHp || !integer(hp, 0, maxHp) || (status === 'sunk') !== (hp === 0)) return fail();
      if ((status !== 'ready' && status !== 'sunk' && (saved.action || saved.order || data.version < 4 && saved.movement)) || status === 'sunk' && (saved.action || saved.order || saved.guard || data.version < 4 && saved.movement)) return fail();
      if (data.version >= 11 && saved.order !== undefined || saved.order && !validCell(saved.order) || !validNotice(saved.notice)) return fail();
      if(saved.availableRound!==undefined&&(data.version<13||!integer(saved.availableRound,data.round,data.round+1)||status!=='wait'||saved.action))return fail();
      if (saved.fleetId !== undefined && (data.version >= 8 || typeof saved.fleetId !== 'string' || saved.order || status === 'sunk')) return fail();
      if (saved.fleetId !== undefined) legacyMembership.set(saved.instanceId,saved.fleetId);
      const guard = data.version >= 3 ? saved.guard : false, cooldowns = data.version >= 3 ? saved.cooldowns : {};
      if (typeof guard !== 'boolean' || guard && (status !== 'ready' || saved.action !== 0) || !cooldowns || typeof cooldowns !== 'object' || Array.isArray(cooldowns)) return fail();
      const weaponIds = new Set((WEAPONS[asset.ship_type.code] ?? []).map(weapon => weapon.id));
      if (data.version < 5 && ['CV','CVL'].includes(asset.ship_type.code)) weaponIds.add('airstrike');
      if (Object.entries(cooldowns).some(([id, turns]) => !weaponIds.has(id) || !integer(turns, 1, 9))) return fail();
      if (status !== 'sunk') { if (occupied.has(cellKey(saved))) return fail(); occupied.add(cellKey(saved)); }
      identities.add(saved.instanceId); assetIds.add(assetKey);
      return { instanceId: saved.instanceId, asset, col: saved.col, row: saved.row, facing: saved.facing, ownerId: saved.ownerId,
        action: saved.action, status, hp, maxHp, guard, cooldowns: ['CV','CVL'].includes(asset.ship_type.code) ? {} : { ...cooldowns },
        notice: saved.order || /航线|自动航行|计划航行/.test(saved.notice ?? '') ? undefined : saved.notice,...(saved.availableRound!==undefined?{availableRound:saved.availableRound}:{}) };
    });
    if (data.teams.some((team: Team) => !match.units.some(u => u.ownerId === team.id))) fail();
    const fleets = new Set<string>(), members = new Set<string>();
    for (const saved of data.version < 8 ? data.fleets : []) {
      if (!saved || typeof saved.id !== 'string' || !/^fleet-[1-9]\d*$/.test(saved.id) || Number(saved.id.slice(6)) > data.fleetSerial || fleets.has(saved.id) || !integer(saved.ownerId, 1, data.teams.length)) return fail();
      const minimum = data.version >= 3 ? 2 : 3;
      if (typeof saved.name !== 'string' || saved.name.length > 80 || !Array.isArray(saved.members) || !integer(saved.members.length, minimum, 6) || !saved.members.includes(saved.leaderId) || !validNotice(saved.notice)) return fail();
      if (saved.order && !validCell(saved.order)) return fail(); fleets.add(saved.id);
      for (const id of saved.members) { const unit = match.units.find(u => u.instanceId === id);
        if (!unit || members.has(id) || unit.ownerId !== saved.ownerId || legacyMembership.get(id) !== saved.id || unit.status === 'sunk' || saved.order && unit.status !== 'ready') return fail(); members.add(id); }
      // Legacy fleets and their future destinations are validated then discarded.
    }
    if ([...legacyMembership.keys()].some(id => !members.has(id))) fail();
    match.round = data.round; match.activeIndex = data.activeIndex;
    if (data.version >= 5) match.aviation = validateAviation(data.aviation,match,data.version as 5|6|7|8|9|10|11|12|13|14|15);
    if (data.version === 1) {
      const ownerId = match.active.id;
      for (const unit of match.units) { unit.instanceId = `team-${ownerId}-${unit.asset.id}`; unit.ownerId = ownerId; }
      for (const unit of freshUnits.filter(unit => unit.ownerId !== ownerId)) {
        const cell = match.world.nearbySea(unit,occupied); Object.assign(unit,cell); occupied.add(cellKey(cell)); match.units.push(unit);
      }
    }
    if(data.version>=12){try{match.fog.load(data.fog);}catch{fail();}}
    else match.fog.load({explored:Array(match.teams.length).fill(btoa('\0'.repeat(Math.ceil(match.world.width*match.world.height/8))))});
    if(data.version>=13){
      const c=data.campaign;
      if(data.version===13)match.ports=createLegacyPorts(match.world,freshUnits,match.teams.length);
      if(!c||!Array.isArray(c.ports)||c.ports.length!==match.ports.length||!Array.isArray(c.intel)||c.intel.length!==match.teams.length)fail();
      match.ports=match.ports.map((p,i)=>{
        const raw=c.ports[i];if(!raw||raw.id!==p.id||raw.name!==p.name||raw.col!==p.col||raw.row!==p.row||raw.homeForId!==p.homeForId||!integer(raw.ownerId,0,match.teams.length)||!integer(raw.usedRound,0,data.round))fail();
        return {...p,ownerId:raw.ownerId,usedRound:raw.usedRound};
      });
      if(c.intel.some((row:unknown)=>!Array.isArray(row)||row.length!==match.ports.length||row.some(v=>!integer(v,-1,match.teams.length))))fail();
      match.portIntel=c.intel.map((row:number[])=>[...row]);
    }else match.portIntel=match.teams.map(t=>match.ports.map(p=>p.ownerId===t.id?t.id:-1));
    if(data.version>=14&&match.teams.some(t=>t.oil>match.oilCap(t.id)))fail();
    match.refreshVision();match.resolveOutcome();
    if(data.version>=13){
      const r=data.campaign.result;
      if(data.teams.some((t:Team)=>t.eliminated!==match.team(t.id).eliminated)||!!r!==!!match.result)fail();
      if(r&&(r.winnerId!==match.result!.winnerId||r.reason!==match.result!.reason||r.round!==match.result!.round))fail();
      if(data.campaign.intel.some((row:number[],i:number)=>row.some((owner,j)=>match.portIntel[i][j]!==owner)))fail();
    }
    if(data.version===13){
      const coastal=createPorts(match.world,freshUnits,match.teams.length);
      match.ports=coastal.map((p,i)=>({...p,ownerId:match.ports[i].ownerId,usedRound:match.ports[i].usedRound}));
      match.syncPortIntel();match.campaignRevision++;
    }
    for(const t of match.teams){if(data.version>=14&&t.oil>match.oilCap(t.id))fail();else if(data.version<14)t.oil=Math.min(t.oil,match.oilCap(t.id));}
    return match;
  }
}
