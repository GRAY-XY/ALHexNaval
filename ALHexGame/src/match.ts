import { cellCenter, fromAxial, hexDistance, hexLine, neighbors, toAxial, worldToCell } from './hex.ts';
import {AIR_VISION,FogOfWar,type SavedFog} from './fog.ts';
import {createPorts,createLegacyPorts,PORT_OIL_BONUS,STARTING_CREDITS,PORT_INCOME,MAX_CREDITS,REPAIR_LIMIT,REPAIR_PRICE,REINFORCEMENT_COST,MAX_SUPPLY,STARTING_SUPPLY,type Port,type PortView,type MatchResult,type SavedCampaign} from './ports.ts';
import { arrivalAnchor, translateCell } from './arrival.ts';
import { cellKey, findRoute, sameCell, type Route } from './pathfinding.ts';
import { HexWorld } from './world.ts';
import { campaignBattle, isCampaignBattleId, type WorldScenario } from './historical-battles.ts';
import { Terrain, type Cell, type DeployedShip, type ShipAsset } from './types.ts';
import { beginAviationRound, CARRIER_STATS, emptyAviation, endAviationTurn, initializeAviationDecks, loseCarrierDeck, resolveAviationTurn, resolveQueuedCarrierLaunch, squadronName, validateAviation, type AircraftMoveEvent, type AviationState, type Squadron } from './aircraft.ts';
import { SHIP_RULES_V2, WEAPONS_V2, damageOnHitV2, hitChanceV2, rollDieV2, shipRulesV2, shipSpeedV2, shipVisionV2 } from './naval-rules-v2.ts';

export const TEAM_NAMES = ['湛蓝舰队', '翠绿舰队', '琥珀舰队', '紫罗兰舰队', '珊瑚舰队', '银白舰队', '金辉舰队', '绯红舰队'];
export const TEAM_COLORS = [0x89d8e3, 0x9ae4c6, 0xf2c39c, 0xc8b7e8, 0xf29db4, 0xdde8f4, 0xe8d777, 0xf08476];
export const OIL_PER_TURN = 50;
export const BASE_OIL_CAP=OIL_PER_TURN-PORT_OIL_BONUS;
const LEGACY_MOVEMENT: Record<string, number> = { DD: 4, CL: 3, CA: 2, BB: 2, CV: 2, CVL: 2, SS: 4 };
export type Armor = 'light' | 'medium' | 'heavy';
export interface CombatProfile { maxHp: number; armor: Armor; armorName: string }
export const COMBAT_STATS: Record<string, CombatProfile> = {
  DD: { maxHp: 6, armor: 'light', armorName: '轻型装甲' }, CL: { maxHp: 8, armor: 'light', armorName: '轻型装甲' },
  SS: { maxHp: 5, armor: 'light', armorName: '轻型装甲' },
  CA: { maxHp: 11, armor: 'medium', armorName: '中型装甲' }, BB: { maxHp: 16, armor: 'heavy', armorName: '重型装甲' },
  CV: { maxHp: 10, armor: 'medium', armorName: '中型装甲' }, CVL: { maxHp: 9, armor: 'medium', armorName: '中型装甲' },
};
export type WeaponKind = 'gun' | 'torpedo' | 'air' | 'asw';
export interface WeaponDefinition {
  id: string; name: string; kind: WeaponKind; minRange: number; maxRange: number; cooldown: number;
  damage: Record<Armor, number>;
  power?: number; penetration?: number;
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
  SS: [{ id: 'sub-torpedo', name: '潜艇鱼雷', kind: 'torpedo', minRange: 2, maxRange: 4, cooldown: 1, damage: { light: 4, medium: 4, heavy: 4 } }],
};

export interface MatchUnit extends DeployedShip {
  ownerId: number; action: number; status: 'ready' | 'wait' | 'hold' | 'sunk';
  hp: number; maxHp: number; guard: boolean; cooldowns: Record<string, number>;
  movementUsed?: number; movedThisTurn?: boolean; torpedoes?: number; firedThisTurn?:boolean;
  notice?: string;
  availableRound?:number;
  submerged?:boolean;
}
export interface GroupMovePlan { source: Cell; target: Cell; orders: { instanceId: string; target: Cell; route: Route }[]; skipped: string[] }
export interface GroupMoveOptions { source?: Cell; fits?: (source: Cell, target: Cell) => boolean }
export interface MoveEvent { instanceId: string; cells: Cell[] }
export interface NavalMoveOrder { ownerId:number;unitId:string;target:Cell;cells:Cell[];costs:number[];groupId?:string;groupAnchor?:boolean }
export interface NavalAttackOrder { ownerId:number;attackerId:string;targetId:string;weaponId:string;distance:number }
export interface CarrierLaunchOrder {ownerId:number;carrierId:string;slots:number[]}
export interface CombatEvent { attackerId: string; attackerLabel?:string; targetId: string; targetLabel?:string; weaponId: string; kind: WeaponKind; damage: number; hpBefore: number; hpAfter: number; sunk: boolean; hit?: boolean; dice?: [number, number]; aa?: { dice:number[]; aircraftLost:number; suppression:number; escortIds:string[] }; targetIsAircraft?:boolean; origin?: { x: number; y: number } }
export interface AttackModifier { label: string; value: number }
export interface AttackPreview { valid: boolean; reason?: string; distance: number; damage: number; hpAfter: number; sunk: boolean; blocked: Cell[]; weapon?: WeaponDefinition; hitChance?: number; hitModifier?:number; hitTarget?:number; modifiers?:AttackModifier[] }
export type TeamController = 'human' | 'ai';
export interface Team { id: number; name: string; oil: number; credits:number; supply:number; eliminated:boolean; controller:TeamController }
export type ContactLevel=1|2|3;
export interface NavalContact {unitId:string;ownerId:number;col:number;row:number;level:ContactLevel;age:number;seenThisTurn:boolean;sizeClass?:'large'|'small';shipType?:string;assetId?:string;hpBand?:'intact'|'damaged'|'critical'}
export interface ContactReport {key:string;col:number;row:number;level:ContactLevel;age:number;sizeClass?:'large'|'small';shipType?:string;assetId?:string;hpBand?:'intact'|'damaged'|'critical'}
const TEST_ARENA_SHIP_TYPES=['DD','CL','CA','BB','CV','CVL','SS'] as const;
const INITIAL_ROSTER_IDS=new Set(['lafei','biaoqiang','lingbo','z23','hailunna','beierfasite','gaoxiong','ougen','yanzhan','bisimai','qiye','dujiaoshou']);
export function testArenaFleetAssets(assets:ShipAsset[]):ShipAsset[] {
  const fleet=TEST_ARENA_SHIP_TYPES.map(code=>assets.find(asset=>asset.ship_type.code===code));
  if(fleet.some(asset=>!asset))throw Error('测试海图需要驱逐舰、轻巡、重巡、战列舰、航母、轻航和潜艇各一艘');
  return fleet as ShipAsset[];
}
const TEST_ARENA_SPAWNS:Cell[][]=[
  [{col:0,row:0},{col:2,row:0},{col:4,row:0},{col:1,row:1},{col:3,row:1},{col:0,row:2},{col:2,row:1}],
  [{col:4,row:9},{col:2,row:9},{col:0,row:9},{col:3,row:8},{col:1,row:8},{col:4,row:7},{col:2,row:8}],
];
export interface SavedMatch {
  format: 'al-hex-match'; version: 28; mapVersion: 1; size: number; height:number; mapKind:WorldScenario; mapHash: string; rulesetId: 'naval-v2' | 'classic-v1'; combatState: number;
  submarineRosterLegacy?:true;
  phase:'classic'|'aviation';initiativeIndex:number;phaseSubmitted:number[];aviationOrders:CarrierLaunchOrder[];movementOrders:NavalMoveOrder[];combatOrders:NavalAttackOrder[];
  round: number; activeIndex: number; teams: Team[];
  units: (Omit<MatchUnit, 'asset'> & { assetId: string })[];
  contacts:NavalContact[][];
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
  rulesetId: 'naval-v2' | 'classic-v1' = 'naval-v2';
  phase:'classic'|'aviation'='aviation';initiativeIndex=0;phaseSubmitted:number[]=[];aviationOrders:CarrierLaunchOrder[]=[];movementOrders:NavalMoveOrder[]=[];combatOrders:NavalAttackOrder[]=[];
  private resolvedCombatEvents:CombatEvent[]=[];
  private resolvedAviationLaunches:string[]=[];
  private resolvedAviationMoves:AircraftMoveEvent[]=[];
  combatState = 1;
  readonly hash: string;
  readonly world: HexWorld;
  readonly fog:FogOfWar;
  ports:Port[]=[];
  portIntel:number[][]=[];
  contacts:NavalContact[][]=[];
  private currentContactIds:Set<string>[]=[];
  result?:MatchResult;
  campaignRevision=0;
  submarineRosterLegacy=false;
  constructor(world: HexWorld, assets: ShipAsset[], teamCount = 4, controllers?:TeamController[]) {
    this.world = world;
    if (!Number.isInteger(teamCount) || teamCount < 2 || teamCount > 8 || !assets.length || new Set(assets.map(asset => asset.id)).size !== assets.length) throw Error('势力数应为 2～8，舰船池不能为空或重复');
    if(world.scenarioId==='test-5x10'&&teamCount!==2)throw Error('5 × 10 测试海图只支持双方对战');
    if(controllers&&(controllers.length!==teamCount||controllers.some(controller=>!['human','ai'].includes(controller))))throw Error('席位设置无效');
    const battle=campaignBattle(world.scenarioId);
    if(battle&&teamCount!==2)throw Error('历史战役只支持双方对战');
    if(battle)this.activeIndex=battle.firstMoverIndex;
    this.teams = Array.from({ length: teamCount }, (_, i) => ({ id: i + 1, name: battle?.sides[i]??TEAM_NAMES[i], oil: 0,credits:STARTING_CREDITS,supply:STARTING_SUPPLY,eliminated:false,controller:controllers?.[i]??'human' }));
    const fleetAssetsByTeam:ShipAsset[][]=world.scenarioId==='test-5x10'
      ?this.teams.map(()=>testArenaFleetAssets(assets))
      :battle?battle.startingFleetIds.map(ids=>ids.map(id=>{
        const asset=assets.find(item=>item.id===id);if(!asset)throw Error(`战役舰船素材缺失：${id}`);return asset;
      }))
      :this.teams.map(()=>assets);
    const occupied = new Set<string>(), starts = [[.12,.13],[.82,.15],[.82,.82],[.15,.82],[.48,.10],[.90,.50],[.50,.90],[.10,.50]];
    this.units = this.teams.flatMap((team,index) => {
      const fleetAssets=fleetAssetsByTeam[index];
      if(world.scenarioId==='test-5x10')return TEST_ARENA_SPAWNS[index].map((cell,shipIndex)=>{
        const asset=fleetAssets[shipIndex];occupied.add(`${cell.col},${cell.row}`);
        const combat=profile(asset.ship_type.code);
        return { ...cell,instanceId:`team-${team.id}-${asset.id}`,asset,ownerId:team.id,facing:shipIndex%2?'left' as const:'right' as const,
          action:1,status:'ready' as const,hp:combat.maxHp,maxHp:combat.maxHp,guard:false,cooldowns:{},movementUsed:0,
          movedThisTurn:false,firedThisTurn:false,torpedoes:SHIP_RULES_V2[asset.ship_type.code]?.torpedoes??0,...(asset.ship_type.code==='SS'?{submerged:true}:{}) };
      });
      const origin = world.startPositions[index]??{ col: Math.round(world.width * starts[index][0]), row: Math.round(world.height * starts[index][1]) };
      return world.deploy(fleetAssets, origin, team.id, occupied).map(unit => { const combat = profile(unit.asset.ship_type.code); return { ...unit, ownerId: team.id,
        action: 1, status: 'ready' as const,
        hp: combat.maxHp, maxHp: combat.maxHp, guard: false, cooldowns: {}, movementUsed: 0,
        movedThisTurn:false,firedThisTurn:false,torpedoes: SHIP_RULES_V2[unit.asset.ship_type.code]?.torpedoes ?? 0,
        ...(unit.asset.ship_type.code==='SS'?{submerged:true}:{}) }; });
    });
    this.hash = mapHash(world);
    this.combatState = globalThis.crypto.getRandomValues(new Uint32Array(1))[0];
    this.ports=createPorts(world,this.units,teamCount);
    this.portIntel=this.teams.map(t=>this.ports.map(p=>p.ownerId===t.id?t.id:-1));
    this.contacts=this.teams.map(()=>[]);this.currentContactIds=this.teams.map(()=>new Set());
    this.fog=new FogOfWar(world,teamCount);this.refreshVision();
  }
  refreshVision():boolean {
    const changed=this.fog.refresh(this.units,this.aviation.squadrons,this.rulesetId);
    if(changed)this.syncPortIntel();
    const contactsChanged=this.rulesetId==='naval-v2'?this.refreshContacts():false;
    if(this.rulesetId!=='naval-v2')this.currentContactIds=this.teams.map(()=>new Set());
    return changed||contactsChanged;
  }
  private syncPortIntel():void {
    for(const t of this.teams)for(let i=0;i<this.ports.length;i++){
      const p=this.ports[i];if((p.ownerId===t.id||this.fog.state(t.id,p)===2)&&this.portIntel[t.id-1][i]!==p.ownerId){this.portIntel[t.id-1][i]=p.ownerId;this.campaignRevision++;}
    }
  }
  canSee(owner:number,cell:Cell):boolean {this.refreshVision();return this.fog.state(owner,cell)===2;}
  isExplored(owner:number,cell:Cell):boolean {this.refreshVision();return this.fog.state(owner,cell)>0;}
  unitVisible(unit:MatchUnit,owner=this.active.id):boolean {
    if(unit.ownerId===owner)return true;
    if(this.rulesetId==='naval-v2'){this.refreshVision();return this.currentContactIds[owner-1]?.has(unit.instanceId)??false;}
    return this.canSee(owner,unit);
  }
  airVisible(air:Squadron,owner=this.active.id):boolean {return air.ownerId===owner||this.canSee(owner,worldToCell(air));}
  contactsFor(owner=this.active.id):ContactReport[] {
    if(this.rulesetId!=='naval-v2')return [];
    this.refreshVision();
    return this.contacts[owner-1].map(contact=>({key:contact.unitId,col:contact.col,row:contact.row,level:contact.level,age:contact.age,
      ...(contact.level>=2?{sizeClass:contact.sizeClass}:{}),...(contact.shipType?{shipType:contact.shipType}:{}),...(contact.assetId?{assetId:contact.assetId}:{}),...(contact.level===3?{hpBand:contact.hpBand}:{})}));
  }
  private canObserveShip(ownerId:number,unit:MatchUnit):ContactLevel|undefined {
    let best:ContactLevel=0 as ContactLevel;
    for(const observer of this.units){
      if(observer.ownerId!==ownerId||observer.status==='sunk')continue;
      const distance=hexDistance(observer,unit);if(distance>shipVisionV2(observer.asset.ship_type.code,observer.submerged))continue;
      if(hexLine(observer,unit).slice(1,-1).some(cell=>this.world.at(cell)===Terrain.Land))continue;
      if(unit.asset.ship_type.code==='SS'&&unit.submerged&&(!['DD','CL'].includes(observer.asset.ship_type.code)||distance>1))continue;
      const level:ContactLevel=distance<=2?3:2;
      if(level>best)best=level;
    }
    for(const scout of this.aviation.squadrons){
      if(scout.ownerId!==ownerId||scout.hp<=0||scout.fuelTurns<=0)continue;
      const distance=hexDistance(worldToCell(scout),unit);if(distance>(unit.asset.ship_type.code==='SS'&&unit.submerged?2:AIR_VISION))continue;
      // Aircraft spot over islands and reveal a contact without requiring a ship's line of sight.
      const level:ContactLevel=distance<=2?3:2;
      if(level>best)best=level;
    }
    return best||undefined;
  }
  private refreshContacts():boolean {
    const current=this.teams.map(()=>new Set<string>()),before=JSON.stringify(this.contacts);
    for(const owner of this.teams){
      const records=new Map(this.contacts[owner.id-1].map(contact=>[contact.unitId,contact]));
      for(const target of this.units){
        if(target.ownerId===owner.id)continue;
        const old=records.get(target.instanceId),observed=this.canObserveShip(owner.id,target);
        if(!observed){
          if(old?.level===3){old.level=2;delete old.hpBand;}
          continue;
        }
        const code=target.asset.ship_type.code,level=observed;
        const ratio=target.hp/target.maxHp,hpBand:NavalContact['hpBand']=ratio<=.25?'critical':ratio<=.5?'damaged':'intact';
        records.set(target.instanceId,{unitId:target.instanceId,ownerId:target.ownerId,col:target.col,row:target.row,level,age:0,seenThisTurn:true,
          ...(level>=2?{sizeClass:['BB','CV'].includes(code)?'large' as const:'small' as const}:{}),
          ...(level===3?{shipType:code,assetId:target.asset.id,hpBand}:old?.shipType?{shipType:old.shipType,...(old.assetId?{assetId:old.assetId}:{})}:{})});
        if(level===3)current[owner.id-1].add(target.instanceId);
      }
      for(const [id,contact] of records){
        if(current[owner.id-1].has(id))continue;
        if(contact.level===3){contact.level=2;delete contact.hpBand;}
      }
      this.contacts[owner.id-1]=[...records.values()].sort((a,b)=>a.unitId.localeCompare(b.unitId));
    }
    this.currentContactIds=current;
    return before!==JSON.stringify(this.contacts);
  }
  private ageContacts(ownerId:number):void {
    if(this.rulesetId!=='naval-v2')return;
    const reports=this.contacts[ownerId-1];let changed=false;
    this.contacts[ownerId-1]=reports.map(contact=>{
      if(contact.seenThisTurn){contact.seenThisTurn=false;return contact;}
      if(contact.age<100){contact.age++;changed=true;}
      if(contact.level===3){contact.level=2;delete contact.hpBand;}
      return contact;
    });
    if(changed)this.campaignRevision++;
  }
  get active(): Team { return this.teams[this.activeIndex]; }
  unit(id: string): MatchUnit { const unit = this.units.find(u => u.instanceId === id); if (!unit) throw Error('找不到舰船'); return unit; }
  team(ownerId: number): Team { const team = this.teams.find(item => item.id === ownerId); if (!team) throw Error('找不到势力'); return team; }
  budget(unit: MatchUnit): number {
    if(this.rulesetId==='naval-v2'){
      const hasPlannedMove=this.movementOrders.some(order=>order.unitId===unit.instanceId);
      return unit.movedThisTurn&&!hasPlannedMove?0:Math.max(0,this.movementLimit(unit)-this.movementUsed(unit));
    }
    return this.team(unit.ownerId).oil;
  }
  movementUsed(unit:MatchUnit):number{return this.rulesetId==='naval-v2'?(unit.movementUsed??0):0;}
  setSubmarineDepth(id:string,submerged:boolean):void {
    this.requireV2Phase();const unit=this.unit(id);this.requireActive(unit);
    if(this.rulesetId!=='naval-v2'||unit.asset.ship_type.code!=='SS')throw Error('只有 V2 潜艇可以改变深度');
    if(typeof submerged!=='boolean'||unit.submerged===submerged)throw Error('潜艇已经处于该深度');
    if(unit.status!=='ready'||!unit.action)throw Error('改变深度需要本回合尚未使用的作战行动');
    if(this.movementOrders.some(order=>order.unitId===id)||this.movementUsed(unit)>0)throw Error('请在规划航线前改变深度');
    if(this.combatOrders.some(order=>order.attackerId===id))throw Error('取消攻击计划后才能改变深度');
    if(!submerged&&this.units.some(other=>other!==unit&&other.status!=='sunk'&&sameCell(other,unit)&&!(other.asset.ship_type.code==='SS'&&other.submerged)))throw Error('该海格有水面舰船，潜艇不能在此上浮');
    unit.submerged=submerged;unit.action=0;unit.guard=false;unit.notice=submerged?'潜艇已下潜：航速 2，普通舰艇难以发现':'潜艇已上浮：航速 4，可被常规舰艇发现';
    this.refreshVision();this.campaignRevision++;
  }
  movementLimit(unit:MatchUnit):number {
    if(this.rulesetId!=='naval-v2')return this.team(unit.ownerId).oil;
    const speed=shipSpeedV2(unit.asset.ship_type.code,unit.submerged),damagePenalty=unit.hp<=unit.maxHp/4?speed-1:unit.hp<=unit.maxHp/2?1:0;
    return Math.max(1,Math.min(unit.guard?1:speed,speed-damagePenalty));
  }
  movementSpent(unit:MatchUnit,cost:number):void {if(this.rulesetId==='naval-v2')unit.movementUsed=(unit.movementUsed??0)+cost;}
  private rollDie():number {const roll=rollDieV2(this.combatState);this.combatState=roll.state;return roll.die;}
  oilCap(owner=this.active.id):number {return BASE_OIL_CAP+PORT_OIL_BONUS*this.ports.filter(p=>p.ownerId===owner).length;}
  weapons(unitOrId: MatchUnit | string): WeaponDefinition[] { const unit = typeof unitOrId === 'string' ? this.unit(unitOrId) : unitOrId; return (this.rulesetId==='naval-v2'?WEAPONS_V2:WEAPONS)[unit.asset.ship_type.code] ?? []; }
  cooldown(unit: MatchUnit, weaponId: string): number { return Math.max(0, unit.cooldowns[weaponId] ?? 0); }
  assertPlayable():void {if(this.result)throw Error('战局已结束，可查看海图或建立新战局');}
  private requireV2Phase():void {if(this.rulesetId==='naval-v2'&&this.phase!=='aviation')throw Error('本方本回合已行动，请等待下一次交接');}
  private plannedCell(unit:MatchUnit):Cell {
    const order=this.movementOrders.find(item=>item.unitId===unit.instanceId);
    return order?.target??unit;
  }
  private plannedMovementCost(unit:MatchUnit):number {
    const order=this.movementOrders.find(item=>item.unitId===unit.instanceId);
    return order?.costs.slice(1).reduce((total,cost)=>total+cost,0)??0;
  }
  displayMovementOrders(ownerId=this.active.id):NavalMoveOrder[] {
    return this.movementOrders.filter(order=>order.ownerId===ownerId&&(!order.groupId||order.groupAnchor));
  }
  private requireActive(unit: MatchUnit): void {this.assertPlayable(); if (unit.ownerId !== this.active.id) throw Error('只能指挥当前势力的舰船'); if (unit.status === 'sunk') throw Error('该舰船已经沉没');if(unit.availableRound&&unit.availableRound>this.round)throw Error('增援舰船在下次本方回合投入使用'); }
  port(id:string):Port {const p=this.ports.find(p=>p.id===id);if(!p)throw Error('找不到港口');return p;}
  knownPorts(owner=this.active.id):PortView[]{return this.ports.flatMap((port,i)=>{const ownerId=this.portIntel[owner-1][i];return ownerId<0?[]:[{port,ownerId,visible:this.fog.state(owner,port)===2}];});}
  income(owner=this.active.id):number{return this.ports.filter(p=>p.ownerId===owner).length*PORT_INCOME;}
  capturePreview(id:string,portId:string):{valid:boolean;reason:string} {
    const u=this.unit(id),p=this.port(portId);
    const range=this.rulesetId==='naval-v2'?0:1,eligible=this.rulesetId!=='naval-v2'||['DD','CL','CA'].includes(u.asset.ship_type.code);
    const reason=this.result?'战局已结束':u.ownerId!==this.active.id?'只能使用本方舰船':u.status!=='ready'||u.availableRound&&u.availableRound>this.round?'舰船当前无法作战':!u.action?'本舰作战行动已用':!eligible?'只有驱逐舰和巡洋舰可以占领港口':hexDistance(u,p)>range?`舰船需进入港口${range?`${range}格内`:'所在海格'}`:p.ownerId===u.ownerId?'已经是本方港口':this.rulesetId==='naval-v2'&&p.occupationOwnerId===u.ownerId?'我方正在持续夺取该港口':this.units.some(v=>v.status!=='sunk'&&v.ownerId!==u.ownerId&&hexDistance(v,p)<=1)?'先清除港口1格内敌舰':'';
    return {valid:!reason,reason};
  }
  capturePort(id:string,portId:string):void {
    const preview=this.capturePreview(id,portId);if(!preview.valid)throw Error(preview.reason);
    const u=this.unit(id),p=this.port(portId),old=p.ownerId,index=this.ports.indexOf(p);u.action=0;
    if(this.rulesetId==='naval-v2'&&old!==0){p.occupationOwnerId=u.ownerId;p.occupationProgress=0;u.notice=`开始夺取${p.name}，守住港口直至两个回合结算`;this.campaignRevision++;return;}
    p.ownerId=u.ownerId;p.occupationOwnerId=undefined;p.occupationProgress=0;u.notice=`已占领${p.name}`;
    this.portIntel[u.ownerId-1][index]=u.ownerId;if(old)this.portIntel[old-1][index]=u.ownerId;
    for(const t of this.teams)if(this.fog.state(t.id,p)===2)this.portIntel[t.id-1][index]=u.ownerId;
    if(old)this.team(old).oil=Math.min(this.team(old).oil,this.oilCap(old));
    this.campaignRevision++;this.resolveOutcome();
  }
  repairPreview(id:string,portId:string):{valid:boolean;reason:string;hp:number;cost:number} {
    const u=this.unit(id),p=this.port(portId),v2=this.rulesetId==='naval-v2',limit=v2?2:REPAIR_LIMIT;
    const hp=Math.min(limit,u.maxHp-u.hp,v2?this.active.supply:Infinity),cost=v2?hp:hp*REPAIR_PRICE;
    const enemiesNear=v2&&this.units.some(v=>v.status!=='sunk'&&v.ownerId!==u.ownerId&&hexDistance(v,p)<=2);
    const reason=this.result?'战局已结束':u.ownerId!==this.active.id||p.ownerId!==u.ownerId?'需要本方舰船与本方港口':u.status!=='ready'||u.availableRound&&u.availableRound>this.round?'舰船当前无法作战':!u.action?'本舰作战行动已用':hexDistance(u,p)>(v2?0:1)?`舰船需进入港口${v2?'所在海格':'1格内'}`:p.serviceRound===this.round&&v2?'本港本回合已完成服务':enemiesNear?'港口2格内有敌舰，暂不能提供服务':!hp?'舰体耐久已经全满或补给不足':!v2&&this.active.credits<cost?`维修需要${cost}资金`:'';
    return {valid:!reason,reason,hp,cost};
  }
  repairShip(id:string,portId:string):void {
    const preview=this.repairPreview(id,portId);if(!preview.valid)throw Error(preview.reason);
    const u=this.unit(id),p=this.port(portId);if(this.rulesetId==='naval-v2'){this.active.supply-=preview.cost;p.serviceRound=this.round;}else this.active.credits-=preview.cost;
    u.hp+=preview.hp;u.action=0;u.notice=`港口维修恢复${preview.hp}耐久`;
    this.campaignRevision++;
  }
  torpedoReloadPreview(id:string,portId:string):{valid:boolean;reason:string;cost:number} {
    const u=this.unit(id),p=this.port(portId),v2=this.rulesetId==='naval-v2',cost=2,max=shipRulesV2(u.asset.ship_type.code).torpedoes;
    const enemiesNear=this.units.some(v=>v.status!=='sunk'&&v.ownerId!==u.ownerId&&hexDistance(v,p)<=2);
    const reason=this.result?'战局已结束':!v2?'当前规则不支持此服务':u.ownerId!==this.active.id||p.ownerId!==u.ownerId?'需要本方舰船与本方港口':u.status!=='ready'||u.availableRound&&u.availableRound>this.round?'舰船当前无法作战':!u.action?'本舰作战行动已用':hexDistance(u,p)!==0?'舰船必须停泊在港口格':!max?'该舰种不携带鱼雷':(u.torpedoes??0)>=max?'鱼雷已经装满':p.serviceRound===this.round?'本港本回合已完成服务':enemiesNear?'港口2格内有敌舰，暂不能提供服务':this.active.supply<cost?`装填鱼雷需要${cost}补给点`:'';
    return {valid:!reason,reason,cost};
  }
  reloadTorpedo(id:string,portId:string):void {
    const preview=this.torpedoReloadPreview(id,portId);if(!preview.valid)throw Error(preview.reason);
    const u=this.unit(id),p=this.port(portId);this.active.supply-=preview.cost;u.torpedoes=(u.torpedoes??0)+1;u.action=0;p.serviceRound=this.round;u.notice='港口补给装填了1发鱼雷';this.campaignRevision++;
  }
  reinforcementPreview(portId:string,id:string):{valid:boolean;reason:string;cost:number;cell?:Cell} {
    const p=this.port(portId),u=this.unit(id),cost=REINFORCEMENT_COST[u.asset.ship_type.code]??40;
    let reason=this.rulesetId==='naval-v2'?'V2标准战局不提供沉船增援':this.result?'战局已结束':p.ownerId!==this.active.id||u.ownerId!==this.active.id?'只能在本方港口补充本方舰船':u.status!=='sunk'?'只能补充已损失的舰型':p.usedRound===this.round?'该港口本轮已提供增援':this.active.credits<cost?`增援需要${cost}资金`:'';
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
    if(this.rulesetId==='naval-v2'){
      this.phaseSubmitted=this.phaseSubmitted.filter(id=>!this.team(id).eliminated);
      if(this.active.eliminated){const next=this.initiativeOrder().find(index=>!this.phaseSubmitted.includes(this.teams[index].id));if(next!==undefined)this.activeIndex=next;}
    }
    const surviving=this.teams.filter(t=>!t.eliminated),homes=this.ports.filter(p=>p.homeForId),battle=campaignBattle(this.world.scenarioId);
    if(surviving.length<=1)this.result={winnerId:surviving[0]?.id??null,reason:surviving.length?'elimination':'draw',round:this.round};
    else if(battle){
      const deadline=this.round>battle.mission.roundLimit,score=(ownerId:number)=>{
        const objective=battle.mission.objectives[ownerId-1],enemy=3-ownerId;
        if(objective.kind==='sink-ships'){
          const sunk=this.units.filter(unit=>unit.ownerId===enemy&&unit.status==='sunk'&&(!objective.targetTypes||objective.targetTypes.includes(unit.asset.ship_type.code))).length;
          return {value:sunk,target:objective.count,complete:sunk>=objective.count};
        }
        if(objective.kind==='preserve-fleet'){
          const afloat=this.units.filter(unit=>unit.ownerId===ownerId&&unit.status!=='sunk').length;
          return {value:afloat,target:objective.minimumShips,complete:deadline&&afloat>=objective.minimumShips};
        }
        const held=this.ports[objective.portIndex]?.ownerId===ownerId;
        return {value:Number(held),target:1,complete:objective.kind==='capture-port'?held:deadline&&held};
      };
      const scores=this.teams.map(team=>score(team.id)),finished=scores.map((item,index)=>item.complete?index:-1).filter(index=>index>=0);
      if(finished.length===1)this.result={winnerId:this.teams[finished[0]].id,reason:deadline?'time-limit':'objective',round:deadline?battle.mission.roundLimit:this.round};
      else if(finished.length>1||deadline){
        const ratios=scores.map(item=>Math.min(1,item.value/Math.max(1,item.target))),delta=ratios[0]-ratios[1];
        const winner=Math.abs(delta)<.001?null:delta>0?1:2;
        this.result={winnerId:winner,reason:deadline?'time-limit':'draw',round:deadline?battle.mission.roundLimit:this.round};
      }
    }
    else if(homes.length&&homes[0].ownerId&&homes.every(p=>p.ownerId===homes[0].ownerId))this.result={winnerId:homes[0].ownerId,reason:'headquarters',round:this.round};
    if(this.result)this.campaignRevision++;
  }
  campaignObjectiveStatus(ownerId:number):{description:string;current:number;target:number;complete:boolean}|undefined {
    const battle=campaignBattle(this.world.scenarioId);if(!battle||!Number.isInteger(ownerId)||ownerId<1||ownerId>2)return;
    const objective=battle.mission.objectives[ownerId-1],deadline=this.round>battle.mission.roundLimit,enemy=3-ownerId;
    if(objective.kind==='sink-ships'){
      const current=this.units.filter(unit=>unit.ownerId===enemy&&unit.status==='sunk'&&(!objective.targetTypes||objective.targetTypes.includes(unit.asset.ship_type.code))).length;
      return {description:objective.description,current:Math.min(current,objective.count),target:objective.count,complete:current>=objective.count};
    }
    if(objective.kind==='preserve-fleet'){
      const current=this.units.filter(unit=>unit.ownerId===ownerId&&unit.status!=='sunk').length;
      return {description:objective.description,current:Math.min(current,objective.minimumShips),target:objective.minimumShips,complete:deadline&&current>=objective.minimumShips};
    }
    const current=Number(this.ports[objective.portIndex]?.ownerId===ownerId);
    return {description:objective.description,current,target:1,complete:objective.kind==='capture-port'?!!current:deadline&&!!current};
  }
  private navigation(unit: MatchUnit, moving = new Set<string>()) {
    const occupied = new Map<string,MatchUnit[]>();
    for(const other of this.units.filter(u=>u.status!=='sunk'&&u.instanceId!==unit.instanceId)){
      const key=cellKey(other),items=occupied.get(key)??[];items.push(other);occupied.set(key,items);
    }
    const blocksFor=(other:MatchUnit)=>!(this.rulesetId==='naval-v2'&&other.asset.ship_type.code==='SS'&&other.submerged);
    const cost = (cell: Cell): number => {
      if(this.rulesetId==='naval-v2'){
        if(this.fog.state(unit.ownerId,cell)===0||!this.world.isSea(cell))return Infinity;
        const blockers=(occupied.get(cellKey(cell))??[]).filter(blocksFor);
        return blockers.some(blocker=>blocker.ownerId!==unit.ownerId||!moving.has(blocker.instanceId))?Infinity:1;
      }
      if (!this.canSee(unit.ownerId,cell)||!this.world.isSea(cell)) return Infinity;
      const blocker = occupied.get(cellKey(cell))?.[0]; if (blocker && blocker.ownerId !== unit.ownerId) return Infinity;
      return this.world.at(cell) === Terrain.Shallow && !['DD', 'CL'].includes(unit.asset.ship_type.code) ? 2 : 1;
    };
    const stop = (cell: Cell): boolean => this.rulesetId==='naval-v2'
      ? this.fog.state(unit.ownerId,cell)>0&&this.world.isSea(cell)&&!(occupied.get(cellKey(cell))??[]).filter(blocksFor).some(blocker=>blocker.ownerId!==unit.ownerId||!moving.has(blocker.instanceId))
      : this.canSee(unit.ownerId,cell)&&this.world.isSea(cell)&&(!occupied.has(cellKey(cell))||moving.has(occupied.get(cellKey(cell))![0].instanceId));
    return { cost, stop };
  }
  private movementRoutes(unit:MatchUnit,budget:number,moving:Set<string>):Route[]{
    if(budget<0)return [];
    this.refreshVision();
    const navigation=this.navigation(unit,moving),start={col:unit.col,row:unit.row},startKey=cellKey(start),costs=new Map<string,number>([[startKey,0]]),previous=new Map<string,string>(),queue:Cell[]=[start],routes:Route[]=[];
    for(let cursor=0;cursor<queue.length;cursor++){
      const cell=queue[cursor],key=cellKey(cell),cost=costs.get(key)!;
      if(navigation.stop(cell)){
        const cells:Cell[]=[cell];let current=key;
        while(current!==startKey){current=previous.get(current)!;const [col,row]=current.split(',').map(Number);cells.push({col,row});}
        cells.reverse();routes.push({cells,costs:cells.map((_,index)=>index?1:0),cost,visited:queue.length});
      }
      if(cost>=budget)continue;
      for(const next of neighbors(cell)){
        if(!this.world.contains(next)||navigation.cost(next)!==1)continue;
        const nextKey=cellKey(next);if(costs.has(nextKey))continue;
        costs.set(nextKey,cost+1);previous.set(nextKey,key);queue.push(next);
      }
    }
    return routes;
  }
  route(id: string, target: Cell): Route | undefined {
    const unit = this.unit(id); if (unit.status === 'sunk') return;
    if(this.rulesetId==='naval-v2'){
      if(!this.world.contains(target)||this.isExplored(unit.ownerId,target)&&!this.world.isSea(target))return;
      const moving=new Set(this.movementOrders.filter(order=>order.ownerId===unit.ownerId).map(order=>order.unitId));moving.add(unit.instanceId);
      const routes=this.movementRoutes(unit,this.budget(unit),moving);
      if(sameCell(unit,target))return routes.find(route=>route.cost===0);
      const moves=routes.filter(route=>route.cost>0);
      moves.sort((a,b)=>hexDistance(a.cells[a.cells.length-1],target)-hexDistance(b.cells[b.cells.length-1],target)||b.cost-a.cost||a.cells[a.cells.length-1].row-b.cells[b.cells.length-1].row||a.cells[a.cells.length-1].col-b.cells[b.cells.length-1].col);
      return moves[0];
    }
    const moving=new Set<string>();
    const nav = this.navigation(unit,moving);
    return findRoute(this.world, unit, target, nav.cost, nav.stop);
  }
  reachable(id: string): Cell[] {
    const unit = this.unit(id); if (this.result||unit.ownerId !== this.active.id || unit.status !== 'ready') return [];
    if(this.rulesetId==='naval-v2'&&this.phase!=='aviation')return [];
    const hasPlannedMove=this.movementOrders.some(order=>order.unitId===unit.instanceId);
    if(this.rulesetId==='naval-v2'&&unit.movedThisTurn&&!hasPlannedMove)return [];
    if(this.rulesetId==='naval-v2'){
      const moving=new Set(this.movementOrders.filter(order=>order.ownerId===unit.ownerId).map(order=>order.unitId));moving.add(unit.instanceId);
      return this.movementRoutes(unit,this.budget(unit),moving).map(route=>route.cells[route.cells.length-1]);
    }
    const start = unit, nav = this.navigation(unit), budget = this.budget(unit), queue = [{ cell: start as Cell, cost: 0 }], costs = new Map([[cellKey(start), 0]]), result = new Map<string, Cell>();
    for (let i = 0; i < queue.length; i++) { const item = queue[i]; if (item.cost !== costs.get(cellKey(item.cell))) continue;
      if (nav.stop(item.cell)) result.set(cellKey(item.cell), item.cell);
      for (const cell of neighbors(item.cell)) { if (!this.world.contains(cell)) continue; const cost = item.cost + nav.cost(cell), key = cellKey(cell);
        if (cost <= budget && cost < (costs.get(key) ?? Infinity)) { costs.set(key, cost); queue.push({ cell, cost }); } }
    } return [...result.values()];
  }
  issueMove(id: string, target: Cell): MoveEvent[] {
    this.requireV2Phase();
    const unit = this.unit(id); this.requireActive(unit);
    if(this.rulesetId==='naval-v2'){
      if(!this.world.contains(target))throw Error('目标超出海图范围');
      if(this.isExplored(unit.ownerId,target)&&!this.world.isSea(target))throw Error('目标是陆地，请选择海格');
    }else if(!this.canSee(unit.ownerId,target))throw Error('目标不在本方当前视野内，请分段移动或派飞机侦察');
    if (unit.status !== 'ready') throw Error('先唤醒或取消本回合待命，再安排航行');
    const previousOrder=this.rulesetId==='naval-v2'?this.movementOrders.find(order=>order.unitId===unit.instanceId):undefined;
    if(this.rulesetId==='naval-v2'&&unit.movedThisTurn&&!previousOrder)throw Error('本舰本回合已经完成机动');
    const route = this.route(id, target); if (!route) throw Error(this.rulesetId==='naval-v2'?'没有通向目标的已知海路；请先探索附近海域':'目标无法抵达：岛屿、无效海域或舰船阻挡');
    if (route.cost > this.budget(unit)) throw Error(this.rulesetId==='naval-v2'
      ? `超出本舰剩余航速：本次需要 ${route.cost} 格，本舰剩余 ${this.budget(unit)} 格`
      : `石油不足：本次移动需要 ${route.cost} 点，当前剩余 ${this.budget(unit)} 点，请选择本回合可抵达的海格`);
    unit.notice = undefined;
    const destination=route.cells[route.cells.length-1];
    if (sameCell(unit,destination)) {
      if(previousOrder)this.replacePlannedMove(unit);
      return [];
    }
    if(this.rulesetId==='naval-v2'){
      this.replacePlannedMove(unit,{ownerId:unit.ownerId,unitId:unit.instanceId,target:{...destination},cells:route.cells.map(cell=>({...cell})),costs:[...route.costs]});
      return [];
    }
    const cells = route.cells, end = cells[cells.length-1];
    unit.facing = end.col < unit.col ? 'left' : 'right'; unit.col = end.col; unit.row = end.row;
    this.team(unit.ownerId).oil -= route.cost;
    this.updatePortOccupations();
    this.refreshVision();
    return [{ instanceId: unit.instanceId, cells }];
  }
  plannedMove(id:string):Cell|undefined {return this.movementOrders.find(order=>order.unitId===id)?.target;}
  private replacePlannedMove(unit:MatchUnit,replacement?:NavalMoveOrder):void {
    const previous=this.movementOrders.find(order=>order.unitId===unit.instanceId);
    if(previous?.groupId){
      const independent=this.movementOrders.filter(order=>order.groupId===previous.groupId&&order.unitId!==unit.instanceId).map(order=>{
        return {ownerId:order.ownerId,unitId:order.unitId,target:order.target,cells:order.cells,costs:order.costs};
      });
      this.movementOrders=this.movementOrders.filter(order=>order.groupId!==previous.groupId&&order.unitId!==unit.instanceId);
      this.movementOrders.push(...independent);
    }else this.movementOrders=this.movementOrders.filter(order=>order.unitId!==unit.instanceId);
    if(replacement)this.movementOrders.push(replacement);
    unit.movedThisTurn=!!replacement;this.campaignRevision++;
  }
  cancelMove(id:string):void {
    this.requireV2Phase();const unit=this.unit(id);this.requireActive(unit);
    const order=this.movementOrders.find(item=>item.unitId===id);if(!order)throw Error('本舰尚未提交机动计划');
    const cancelled=order.groupId?this.movementOrders.filter(item=>item.groupId===order.groupId):[order];
    const ids=new Set(cancelled.map(item=>item.unitId));
    this.movementOrders=this.movementOrders.filter(item=>!ids.has(item.unitId));
    for(const unitId of ids)this.unit(unitId).movedThisTurn=false;
    this.campaignRevision++;
  }
  // Freeze only the arrival layout. Each member still follows an independent route.
  planGroupMove(ids: string[], target: Cell, options: GroupMoveOptions = {}): GroupMovePlan {
    this.requireV2Phase();
    if(this.rulesetId==='naval-v2')return this.planGroupMoveV2(ids,target,options);
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
  private planGroupMoveV2(ids:string[],target:Cell,options:GroupMoveOptions):GroupMovePlan{
    if(!this.world.contains(target)||this.isExplored(this.active.id,target)&&!this.world.isSea(target))throw Error('请在海图内选择目标海域');
    const units=[...new Set(ids)].map(id=>this.unit(id));if(!units.length)throw Error('先框选本方舰船');
    for(const unit of units)this.requireActive(unit);
    const planned=new Set(this.movementOrders.map(order=>order.unitId));
    const ready=units.filter(unit=>unit.status==='ready'&&(!unit.movedThisTurn||planned.has(unit.instanceId)));
    const skipped=units.filter(unit=>!ready.includes(unit)).map(unit=>unit.instanceId);
    if(!ready.length)throw Error('选中的舰船暂无可用航线；请先唤醒舰船');
    const source=options.source??arrivalAnchor(ready.map(cellCenter));
    if(options.fits&&!options.fits(source,target))throw Error('所选飞机无法抵达对应目标格，请调整选择范围');
    const moving=new Set(ready.map(unit=>unit.instanceId)),occupied=new Set(this.units.filter(unit=>unit.status!=='sunk').map(cellKey));
    const choices=ready.map(unit=>{
      const currentDistance=hexDistance(unit,target),candidates=this.movementRoutes(unit,this.budget(unit),moving)
        .filter(route=>route.cost>0&&!occupied.has(cellKey(route.cells[route.cells.length-1])))
        .sort((a,b)=>hexDistance(a.cells[a.cells.length-1],target)-hexDistance(b.cells[b.cells.length-1],target)||b.cost-a.cost||a.cells[a.cells.length-1].row-b.cells[b.cells.length-1].row||a.cells[a.cells.length-1].col-b.cells[b.cells.length-1].col);
      return {unit,currentDistance,candidates};
    }).sort((a,b)=>a.candidates.length-b.candidates.length||a.unit.instanceId.localeCompare(b.unit.instanceId));
    const reserved=new Set<string>(),orders:GroupMovePlan['orders']=[];
    for(const choice of choices){
      const route=choice.candidates.find(candidate=>{
        const endpoint=candidate.cells[candidate.cells.length-1],key=cellKey(endpoint);
        return !reserved.has(key)&&hexDistance(endpoint,target)<choice.currentDistance;
      });
      if(!route){skipped.push(choice.unit.instanceId);continue;}
      reserved.add(cellKey(route.cells[route.cells.length-1]));orders.push({instanceId:choice.unit.instanceId,target:route.cells[route.cells.length-1],route});
    }
    if(!orders.length)throw Error('没有可行的移动路线；请探索附近海域或选择其他目标');
    return {source,target:{...target},orders,skipped};
  }
  issueGroupMove(ids: string[], target: Cell, options: GroupMoveOptions = {}): { events: MoveEvent[]; assigned: number; skipped: number; source: Cell; target: Cell } {
    const plan = this.planGroupMove(ids,target,options);
    if (!plan.orders.length) throw Error('选中的舰船暂无可用航线；请唤醒舰船或选择其他海格');
    if(this.rulesetId==='naval-v2'){
      const movingOrders=plan.orders.filter(order=>order.route.cells.length>1);
      if(!movingOrders.length)throw Error('所选编队已经位于目标位置');
      const groupId=`${this.round}:${this.active.id}:${this.campaignRevision}:${movingOrders.map(order=>order.instanceId).sort().join('|')}`;
      for(const order of movingOrders)this.replacePlannedMove(this.unit(order.instanceId));
      const anchor=movingOrders.map(order=>this.unit(order.instanceId)).sort((a,b)=>hexDistance(a,plan.source)-hexDistance(b,plan.source)||a.instanceId.localeCompare(b.instanceId))[0];
      for(const order of movingOrders){const unit=this.unit(order.instanceId);unit.notice=undefined;unit.movedThisTurn=true;this.movementOrders.push({ownerId:unit.ownerId,unitId:unit.instanceId,target:{...order.target},cells:order.route.cells.map(cell=>({...cell})),costs:[...order.route.costs],groupId,groupAnchor:unit.instanceId===anchor.instanceId});}
      this.campaignRevision++;return {events:[],assigned:movingOrders.length,skipped:plan.skipped.length,source:plan.source,target:plan.target};
    }
    const cost = plan.orders.reduce((sum,order) => sum + order.route.cost,0);
    if (cost > this.active.oil) throw Error(`石油不足：整组移动需要 ${cost} 点，当前剩余 ${this.active.oil} 点，请选择更近的目标`);
    const snapshots = plan.orders.map(order => { const unit=this.unit(order.instanceId);return {unit,col:unit.col,row:unit.row,facing:unit.facing,notice:unit.notice,movementUsed:unit.movementUsed,movedThisTurn:unit.movedThisTurn}; }), oil=this.active.oil;
    try {
      const events=this.moveTogether(plan.orders);
      this.updatePortOccupations();
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
          if(this.rulesetId==='naval-v2')this.movementSpent(unit,cost);else this.team(unit.ownerId).oil -= cost;
          route.cells = route.cells.slice(i); route.costs = [0,...route.costs.slice(i+1)]; route.cost -= cost;
          progressed = true; break;
        }
      }
    } while (progressed);
    if (entries.some(entry => !sameCell(entry.unit,entry.target))) throw Error('所选舰船途中互相阻挡，本次移动未执行，请选择其他目标');
    this.refreshVision();
    return entries.filter(entry => entry.cells.length > 1).map(entry => ({ instanceId: entry.unit.instanceId, cells: entry.cells }));
  }
  attackPreview(attackerId: string, targetId: string, weaponId: string): AttackPreview {
    const attacker = this.unit(attackerId), target = this.unit(targetId), weapon = this.weapons(attacker).find(item => item.id === weaponId);
    if(this.rulesetId==='naval-v2'&&this.phase!=='aviation')return {valid:false,reason:'本回合行动已锁定',distance:0,damage:0,hpAfter:0,sunk:false,blocked:[],weapon};
    if(!this.unitVisible(target,attacker.ownerId))return {valid:false,reason:'目标不在本方当前视野内',distance:0,damage:0,hpAfter:0,sunk:false,blocked:[],weapon};
    const shooter=this.rulesetId==='naval-v2'?this.plannedCell(attacker):attacker;
    const distance = hexDistance(shooter, target), blocked = weapon?.kind === 'air' ? [] : hexLine(shooter, target).slice(1, -1).filter(cell => this.world.at(cell) === Terrain.Land);
    const v2=this.rulesetId==='naval-v2',armor = profile(target.asset.ship_type.code).armor;
    const v2Damage=weapon?damageOnHitV2(weapon,shipRulesV2(target.asset.ship_type.code).armor,false):0;
    const base = weapon?(v2?v2Damage:weapon.damage[armor]??0):0, damage = !v2&&target.guard ? Math.max(1, base - 2) : base;
    let hitChance=100,hitModifier:number|undefined,hitTarget:number|undefined,modifiers:AttackModifier[]|undefined;
    if(v2&&weapon){
      modifiers=this.attackModifiersV2(attacker,target,weapon,distance,this.movementUsed(attacker)+this.plannedMovementCost(attacker));
      hitModifier=modifiers.reduce((sum,item)=>sum+item.value,0);hitTarget=weapon.kind==='torpedo'?8:7;
      hitChance=hitChanceV2(hitModifier,hitTarget);
    }
    const result = (reason?: string): AttackPreview => ({ valid: !reason, reason, distance, damage, hpAfter: Math.max(0, target.hp - damage), sunk: damage >= target.hp, blocked, weapon,hitChance,hitModifier,hitTarget,modifiers });
    if (!weapon) return result('该舰种没有这种武器');
    if(this.result)return result('战局已结束');
    if (attacker.ownerId !== this.active.id) return result('只能由当前势力发动攻击');
    if (attacker.status === 'sunk') return result('攻击舰已经沉没');
    if (target.status === 'sunk') return result('目标已经沉没');
    if (attacker.ownerId === target.ownerId) return result('不能攻击本方舰船');
    if (attacker.status !== 'ready') return result('待命或驻留舰船本回合无法攻击');
    if (!attacker.action) return result('本回合作战行动已使用');
    if(v2&&target.asset.ship_type.code==='SS'&&target.submerged&&weapon.kind!=='asw')return result('潜航潜艇只能以反潜武器攻击');
    if(v2&&weapon.kind==='asw'&&(!['DD','CL'].includes(attacker.asset.ship_type.code)||target.asset.ship_type.code!=='SS'||!target.submerged))return result('反潜深弹只能由驱逐舰或轻巡攻击潜航潜艇');
    if(v2&&weapon.kind==='torpedo'&&(attacker.torpedoes??0)<=0)return result('鱼雷已耗尽，请在港口补给');
    if (this.cooldown(attacker, weapon.id)) return result(`${weapon.name}冷却中：${this.cooldown(attacker, weapon.id)} 回合`);
    if (distance < weapon.minRange || distance > weapon.maxRange) return result(`超出射程：需要 ${weapon.minRange}～${weapon.maxRange} 格`);
    if (blocked.length) return result('射线被岛屿阻挡');
    return result();
  }
  private attackModifiersV2(attacker:MatchUnit,target:MatchUnit,weapon:WeaponDefinition,distance:number,movementSpent=this.movementUsed(attacker)):AttackModifier[] {
    const modifiers:AttackModifier[]=[];
    if(distance<=2)modifiers.push({label:'近距',value:1});
    if(['DD','CL'].includes(target.asset.ship_type.code))modifiers.push({label:'目标机动',value:-1});
    if(movementSpent>Math.floor(this.movementLimit(attacker)/2))modifiers.push({label:'移动射击',value:-1});
    if(weapon.kind==='torpedo'?distance===4:distance>Math.ceil(weapon.maxRange/2))modifiers.push({label:'远距',value:-1});
    if(weapon.kind==='gun'&&target.guard)modifiers.push({label:'目标警戒',value:-1});
    if(weapon.kind==='torpedo'&&distance===2)modifiers.push({label:'鱼雷近射',value:1});
    return modifiers;
  }
  private attackModifierV2(attacker:MatchUnit,target:MatchUnit,weapon:WeaponDefinition,distance:number,movementSpent=this.movementUsed(attacker)):number {
    return this.attackModifiersV2(attacker,target,weapon,distance,movementSpent).reduce((sum,item)=>sum+item.value,0);
  }
  private markSubmarineLaunch(attacker:MatchUnit):void {
    for(const team of this.teams){
      if(team.id===attacker.ownerId)continue;
      const records=this.contacts[team.id-1],previous=records.find(contact=>contact.unitId===attacker.instanceId);
      const report:NavalContact={unitId:attacker.instanceId,ownerId:attacker.ownerId,col:attacker.col,row:attacker.row,level:2,age:0,seenThisTurn:false,sizeClass:'small'};
      if(previous){Object.assign(previous,report);delete previous.shipType;delete previous.assetId;delete previous.hpBand;}
      else records.push(report);
      records.sort((a,b)=>a.unitId.localeCompare(b.unitId));
    }
  }
  orderAttack(attackerId:string,targetId:string,weaponId:string):NavalAttackOrder {
    this.requireV2Phase();
    const attacker=this.unit(attackerId),target=this.unit(targetId),preview=this.attackPreview(attackerId,targetId,weaponId);
    if(!preview.valid||!preview.weapon)throw Error(preview.reason??'无法发动攻击');
    const order:NavalAttackOrder={ownerId:attacker.ownerId,attackerId,targetId,weaponId,distance:preview.distance};
    this.combatOrders.push(order);attacker.action=0;
    if(preview.weapon.kind==='torpedo')attacker.torpedoes=Math.max(0,(attacker.torpedoes??0)-1);
    if(preview.weapon.cooldown)attacker.cooldowns[preview.weapon.id]=preview.weapon.cooldown+1;
    attacker.notice=undefined;
    this.campaignRevision++;
    return {...order};
  }
  plannedAttack(attackerId:string):NavalAttackOrder|undefined {
    const order=this.combatOrders.find(item=>item.attackerId===attackerId);return order?{...order}:undefined;
  }
  cancelAttack(attackerId:string):NavalAttackOrder {
    this.requireV2Phase();
    const index=this.combatOrders.findIndex(order=>order.attackerId===attackerId&&order.ownerId===this.active.id);
    if(index<0)throw Error('没有可取消的攻击计划');
    const [order]=this.combatOrders.splice(index,1),attacker=this.unit(order.attackerId),weapon=this.weapons(attacker).find(item=>item.id===order.weaponId);
    if(!weapon)throw Error('锁定的武器已不存在');
    attacker.action=1;attacker.firedThisTurn=false;attacker.notice='攻击计划已取消';
    if(weapon.kind==='torpedo')attacker.torpedoes=Math.min(shipRulesV2(attacker.asset.ship_type.code).torpedoes,(attacker.torpedoes??0)+1);
    delete attacker.cooldowns[weapon.id];
    this.updatePortOccupations();this.campaignRevision++;
    return {...order};
  }
  takeResolvedCombatEvents():CombatEvent[] {
    const events=this.resolvedCombatEvents;this.resolvedCombatEvents=[];return events;
  }
  takeResolvedAviationMoves():AircraftMoveEvent[]{const moves=this.resolvedAviationMoves;this.resolvedAviationMoves=[];return moves;}
  takeResolvedAviationLaunches():string[]{const carriers=this.resolvedAviationLaunches;this.resolvedAviationLaunches=[];return carriers;}
  attack(attackerId: string, targetId: string, weaponId: string): CombatEvent {
    if(this.rulesetId==='naval-v2')throw Error('V2 水面攻击须先规划，点击“实施并交接”执行');
    const attacker = this.unit(attackerId), target = this.unit(targetId), preview = this.attackPreview(attackerId, targetId, weaponId);
    if (!preview.valid || !preview.weapon) throw Error(preview.reason ?? '无法发动攻击');
    const hpBefore = target.hp;let damage=preview.damage,hit=true,dice:[number,number]|undefined;
    target.hp = Math.max(0,target.hp-damage); attacker.action = 0;
    if (preview.weapon.cooldown) attacker.cooldowns[preview.weapon.id] = preview.weapon.cooldown + 1;
    attacker.facing = target.col < attacker.col ? 'left' : 'right';
    if (!target.hp) this.sink(target); else target.notice = damage ? target.guard ? `受到攻击，剩余耐久 ${target.hp}/${target.maxHp}` : `受到攻击，剩余耐久 ${target.hp}/${target.maxHp}` : '炮弹未命中';
    this.updatePortOccupations();this.resolveOutcome();
    return { attackerId, targetId, weaponId, kind: preview.weapon.kind, damage, hpBefore, hpAfter: target.hp, sunk: target.status === 'sunk',hit,dice };
  }
  defend(id: string): void {
    this.requireV2Phase();
    const unit = this.unit(id); this.requireActive(unit);
    if (unit.status !== 'ready') throw Error('待命或驻留舰船本回合无法防御');
    if (!unit.action) throw Error('本回合作战行动已使用');
    if(this.rulesetId==='naval-v2'&&this.movementUsed(unit)+this.plannedMovementCost(unit)>1)throw Error('进入警戒姿态前最多移动1格');
    unit.action = 0; unit.guard = true; unit.notice = this.rulesetId==='naval-v2'
      ? '警戒姿态生效：本舰最多移动1格，敌方舰炮命中 -1，本舰对空值 +1，持续至下次本方回合'
      : '防御姿态生效：受到的每次伤害减少 2 点，持续至下次本方回合';
  }
  airDamage(squadron: Squadron, targetId: string): CombatEvent {
    this.assertPlayable();
    const target = this.unit(targetId), armor = profile(target.asset.ship_type.code).armor;
    if(!this.unitVisible(target,squadron.ownerId))throw Error('目标不在本方当前视野内');
    const submergedTarget=this.rulesetId==='naval-v2'&&target.asset.ship_type.code==='SS'&&target.submerged;
    if(submergedTarget&&squadron.role!=='bomber')throw Error('只有轰炸机可以攻击潜航潜艇');
    let aa:CombatEvent['aa'];
    if(this.rulesetId==='naval-v2'){
      const escorts=this.units.filter(unit=>unit.instanceId!==target.instanceId&&unit.ownerId===target.ownerId&&unit.status!=='sunk'&&hexDistance(unit,target)<=1)
        .sort((a,b)=>hexDistance(a,target)-hexDistance(b,target)||a.instanceId.localeCompare(b.instanceId)).slice(0,2);
      const baseAA=shipRulesV2(target.asset.ship_type.code).aa-(target.hp<=target.maxHp/2?1:0);
      const diceCount=target.asset.ship_type.code==='SS'?0:Math.min(5,Math.max(1,baseAA)+escorts.length+Number(target.guard));
      const dice=Array.from({length:diceCount},()=>this.rollDie()),aircraftLost=Math.min(Math.ceil(squadron.hp/2),dice.filter(value=>value===6).length),suppression=Math.min(2,dice.filter(value=>value===5).length);
      squadron.hp=Math.max(0,squadron.hp-aircraftLost*2);
      aa={dice,aircraftLost,suppression,escortIds:escorts.map(unit=>unit.instanceId)};
    }
    const base = submergedTarget?3:squadron.role === 'fighter' ? 1 : squadron.role === 'torpedo' ? 4 : armor === 'heavy' ? 3 : 4;
    const strength = Math.ceil(squadron.hp / 2) / squadron.planes;
    const damage = this.rulesetId==='naval-v2'
      ? Math.max(0,Math.ceil(base*strength)-(aa?.suppression??0))
      : Math.max(1,Math.ceil(base*strength) - (target.guard ? 2 : 0)), hpBefore = target.hp;
    target.hp = Math.max(0,target.hp-damage); if (!target.hp) this.sink(target);
    if(aa)target.notice=`防空骰 ${aa.dice.length?aa.dice.join('+'):'无'} · 击落 ${aa.aircraftLost} 架 · 压制 ${aa.suppression} · 受到 ${damage} 点空袭伤害`;
    this.resolveOutcome();
    return { attackerId: squadron.id, targetId, weaponId: submergedTarget?'air-asw':squadron.role, kind: submergedTarget?'asw':squadron.role === 'torpedo' ? 'torpedo' : 'air',
      damage, hpBefore, hpAfter: target.hp, sunk: !target.hp,hit:damage>0,aa,attackerLabel:squadronName(squadron), origin: { x: squadron.x, y: squadron.y } };
  }
  private portOccupationHeld(port:Port,ownerId:number):boolean {
    const occupying=this.units.some(u=>u.ownerId===ownerId&&u.status==='ready'&&!u.firedThisTurn&&['DD','CL','CA'].includes(u.asset.ship_type.code)&&u.col===port.col&&u.row===port.row);
    const contested=this.units.some(u=>u.ownerId!==ownerId&&u.status!=='sunk'&&hexDistance(u,port)<=1);
    return occupying&&!contested;
  }
  private updatePortOccupations(advancingOwner?:number):void {
    if(this.rulesetId!=='naval-v2')return;
    let changed=false;
    for(const port of this.ports){
      const owner=port.occupationOwnerId;if(!owner)continue;
      if(owner===port.ownerId||!this.portOccupationHeld(port,owner)){
        port.occupationOwnerId=undefined;port.occupationProgress=0;changed=true;continue;
      }
      if(owner!==advancingOwner)continue;
      if(port.occupationProgress===0){port.occupationProgress=1;changed=true;continue;}
      const previous=port.ownerId,index=this.ports.indexOf(port);port.ownerId=owner;port.occupationOwnerId=undefined;port.occupationProgress=0;
      this.portIntel[owner-1][index]=owner;if(previous)this.portIntel[previous-1][index]=owner;
      changed=true;
    }
    if(changed){this.syncPortIntel();this.campaignRevision++;}
  }
  private sink(unit: MatchUnit): void {
    unit.hp = 0; unit.action = 0; unit.status = 'sunk'; unit.guard = false; unit.notice = '已被击沉';this.updatePortOccupations();
    loseCarrierDeck(this,unit.instanceId);
  }
  wait(id: string, hold = false): void {
    this.requireV2Phase();
    const unit = this.unit(id); this.requireActive(unit); unit.notice=undefined;
    unit.status = hold ? 'hold' : 'wait'; unit.action = 0; unit.guard = false;
  }
  wake(id: string): void { this.requireV2Phase();const unit = this.unit(id); this.requireActive(unit); unit.status = 'ready'; }
  nextPending(after?: string): MatchUnit | undefined {
    const own = this.units.filter(u => u.ownerId === this.active.id && u.status === 'ready' && (this.rulesetId==='naval-v2'?(!u.movedThisTurn||u.action>0):(this.budget(u)>0||u.action>0)));
    if (!own.length) return;
    const index = own.findIndex(u => u.instanceId === after); return own[(index + 1) % own.length];
  }
  private initiativeOrder():number[] {return this.teams.map((_,offset)=>(this.initiativeIndex+offset)%this.teams.length).filter(index=>!this.teams[index].eliminated);}
  private firstInitiativeTeam():number {return this.initiativeOrder()[0]??this.initiativeIndex;}
  private nextUnsubmittedTeam():number {return this.initiativeOrder().find(index=>!this.phaseSubmitted.includes(this.teams[index].id))??this.activeIndex;}
  private resolveMovementOrders(ownerId=this.active.id):MoveEvent[] {
    type Entry={unit:MatchUnit;order:NavalMoveOrder;index:number;spent:number;blocked:boolean;cells:Cell[]};
    const orders=this.movementOrders.filter(order=>order.ownerId===ownerId);
    const entries:Entry[]=orders.map(order=>({unit:this.unit(order.unitId),order,index:0,spent:0,blocked:false,cells:[{col:order.cells[0].col,row:order.cells[0].row}]}));
    let pulse=0;
    while(entries.some(entry=>!entry.blocked&&entry.index<entry.order.cells.length-1)&&pulse++<8){
      const intents=entries.flatMap(entry=>{
        if(entry.blocked||entry.index>=entry.order.cells.length-1)return [];
        const cost=entry.order.costs[entry.index+1];
        if(entry.spent+cost>this.movementLimit(entry.unit)){entry.blocked=true;return [];}
        return [{entry,target:entry.order.cells[entry.index+1],cost}];
      });
      const candidates=new Set(intents),byUnit=new Map(intents.map(intent=>[intent.entry.unit.instanceId,intent]));
      const byTarget=new Map<string,typeof intents>();
      for(const intent of intents){const key=cellKey(intent.target),group=byTarget.get(key)??[];group.push(intent);byTarget.set(key,group);}
      for(const group of byTarget.values())if(group.length>1){
        if(new Set(group.map(intent=>intent.entry.unit.ownerId)).size>1)for(const intent of group)candidates.delete(intent);
        else for(const intent of group.slice(1))candidates.delete(intent);
      }
      let changed=true;
      while(changed){changed=false;
        for(const intent of [...candidates]){
          const occupants=this.units.filter(unit=>unit.status!=='sunk'&&unit.instanceId!==intent.entry.unit.instanceId&&sameCell(unit,intent.target)
            &&!(unit.asset.ship_type.code==='SS'&&unit.submerged));
          for(const occupant of occupants){
            const leaving=byUnit.get(occupant.instanceId);
            if(occupant.ownerId!==intent.entry.unit.ownerId&&leaving&&sameCell(leaving.target,intent.entry.unit)){
              candidates.delete(intent);candidates.delete(leaving);changed=true;continue;
            }
            if(occupant.ownerId!==intent.entry.unit.ownerId||!leaving||!candidates.has(leaving)){
              candidates.delete(intent);changed=true;
            }
          }
        }
      }
      for(const intent of intents)if(!candidates.has(intent))intent.entry.blocked=true;
      const steps=[...candidates];
      for(const {entry,target,cost} of steps){
        entry.unit.col=target.col;entry.unit.row=target.row;entry.unit.facing=target.col<entry.order.cells[entry.index].col?'left':'right';
        entry.index++;entry.spent+=cost;entry.cells.push({...target});this.movementSpent(entry.unit,cost);
      }
    }
    const events=entries.filter(entry=>entry.cells.length>1).map(entry=>({instanceId:entry.unit.instanceId,cells:entry.cells}));
    this.movementOrders=this.movementOrders.filter(order=>order.ownerId!==ownerId);this.updatePortOccupations();this.refreshVision();this.campaignRevision++;return events;
  }
  private resolveCombatOrders(ownerId=this.active.id):CombatEvent[] {
    const initiative=new Map(this.initiativeOrder().map((teamIndex,rank)=>[this.teams[teamIndex].id,rank]));
    const orders=this.combatOrders.filter(order=>order.ownerId===ownerId).sort((a,b)=>(initiative.get(a.ownerId)??Number.MAX_SAFE_INTEGER)-(initiative.get(b.ownerId)??Number.MAX_SAFE_INTEGER)||a.attackerId.localeCompare(b.attackerId)||a.weaponId.localeCompare(b.weaponId));
    const snapshots=new Map<string,{hp:number;damage:number}>(),rolled:CombatEvent[]=[];
    for(const order of orders){
      const attacker=this.unit(order.attackerId),target=this.unit(order.targetId),weapon=this.weapons(attacker).find(item=>item.id===order.weaponId);
      if(!weapon)throw Error('锁定的武器已不存在');
      if(target.status==='sunk'){
        attacker.action=1;attacker.firedThisTurn=false;attacker.notice='目标在炮雷结算前已被空袭击沉，攻击计划取消';
        if(weapon.kind==='torpedo')attacker.torpedoes=Math.min(shipRulesV2(attacker.asset.ship_type.code).torpedoes,(attacker.torpedoes??0)+1);
        delete attacker.cooldowns[weapon.id];continue;
      }
      attacker.firedThisTurn=true;
      const distance=hexDistance(attacker,target),blocked=weapon.kind!=='air'&&hexLine(attacker,target).slice(1,-1).some(cell=>this.world.at(cell)===Terrain.Land);
      const inRange=distance>=weapon.minRange&&distance<=weapon.maxRange&&!blocked;
      const modifier=this.attackModifierV2(attacker,target,weapon,distance),dice:[number,number]=[this.rollDie(),this.rollDie()],total=dice[0]+dice[1],hit=inRange&&(total===12||total!==2&&total+modifier>=(weapon.kind==='torpedo'?8:7));
      if(weapon.kind==='torpedo'&&attacker.asset.ship_type.code==='SS'&&attacker.submerged)this.markSubmarineLaunch(attacker);
      const damage=hit?damageOnHitV2(weapon,shipRulesV2(target.asset.ship_type.code).armor,total===12):0;
      const snapshot=snapshots.get(target.instanceId)??{hp:target.hp,damage:0};snapshot.damage+=damage;snapshots.set(target.instanceId,snapshot);
      rolled.push({attackerId:order.attackerId,targetId:order.targetId,weaponId:order.weaponId,kind:weapon.kind,damage,hpBefore:0,hpAfter:0,sunk:false,hit,dice,...(weapon.kind==='asw'?{origin:cellCenter(attacker)}:{})});
      attacker.facing=target.col<attacker.col?'left':'right';
    }
    for(const [targetId,snapshot] of snapshots){const target=this.unit(targetId);target.hp=Math.max(0,snapshot.hp-snapshot.damage);target.notice=target.hp===0?'已被击沉':snapshot.damage?`本轮受到合计 ${snapshot.damage} 点伤害，剩余耐久 ${target.hp}/${target.maxHp}`:'炮弹未命中';}
    for(const [targetId] of snapshots){const target=this.unit(targetId);if(!target.hp&&target.status!=='sunk')this.sink(target);}
    const events=rolled.map(event=>{const target=this.unit(event.targetId),snapshot=snapshots.get(event.targetId)!;return {...event,hpBefore:snapshot.hp,hpAfter:target.hp,sunk:target.status==='sunk'};});
    this.combatOrders=this.combatOrders.filter(order=>order.ownerId!==ownerId);this.updatePortOccupations();this.refreshVision();this.resolveOutcome();this.campaignRevision++;
    return events;
  }
  private resolveAviationOrders(ownerId=this.active.id):void {
    const initiative=new Map(this.initiativeOrder().map((index,rank)=>[this.teams[index].id,rank]));
    const orders=this.aviationOrders.filter(order=>order.ownerId===ownerId).sort((a,b)=>(initiative.get(a.ownerId)??Number.MAX_SAFE_INTEGER)-(initiative.get(b.ownerId)??Number.MAX_SAFE_INTEGER)||a.carrierId.localeCompare(b.carrierId));
    this.aviationOrders=this.aviationOrders.filter(order=>order.ownerId!==ownerId);
    for(const order of orders){resolveQueuedCarrierLaunch(this,order);this.resolvedAviationLaunches.push(order.carrierId);}
    this.refreshVision();this.campaignRevision++;
  }
  private finishV2Round():void {
    this.phaseSubmitted=[];this.round++;this.initiativeIndex=(this.initiativeIndex+1)%this.teams.length;
    beginAviationRound(this);
    for(const squadron of this.aviation.squadrons)squadron.cooldown=0;
    for(const team of this.teams){
      team.supply=Math.min(MAX_SUPPLY,team.supply+this.ports.filter(port=>port.ownerId===team.id).length);
      for(const unit of this.units.filter(unit=>unit.ownerId===team.id)){
        for(const [weapon,turns] of Object.entries(unit.cooldowns)){const next=Math.max(0,turns-1);if(next)unit.cooldowns[weapon]=next;else delete unit.cooldowns[weapon];}
        unit.guard=false;if(unit.status==='wait')unit.status='ready';unit.firedThisTurn=false;
        if(unit.availableRound&&unit.availableRound<=this.round){delete unit.availableRound;unit.notice=undefined;}
        unit.action=unit.status==='hold'||unit.status==='sunk'?0:1;unit.movementUsed=0;unit.movedThisTurn=false;
      }
    }
    this.phase='aviation';this.activeIndex=this.firstInitiativeTeam();this.campaignRevision++;this.resolveOutcome();
  }
  private resolveLegacySubmittedTurns(activeOwnerId:number):void {
    const previouslySubmitted=new Set(this.phaseSubmitted);
    const order=this.initiativeOrder().map(index=>this.teams[index].id).filter(id=>previouslySubmitted.has(id));
    for(const ownerId of order){
      if(this.result||this.team(ownerId).eliminated)continue;
      this.activeIndex=this.teams.findIndex(team=>team.id===ownerId);
      const eligibleAirIds=new Set(this.aviation.squadrons.map(squadron=>squadron.id));
      this.resolveMovementOrders(ownerId);this.resolveAviationOrders(ownerId);
      const aviation=resolveAviationTurn(this,ownerId,eligibleAirIds);this.resolvedCombatEvents=[...aviation.combatEvents,...this.resolveCombatOrders(ownerId)];
      const newlyLaunchedAirIds=new Set(this.aviation.squadrons.filter(squadron=>squadron.ownerId===ownerId&&!eligibleAirIds.has(squadron.id)).map(squadron=>squadron.id));
      this.ageContacts(ownerId);this.updatePortOccupations(ownerId);endAviationTurn(this,ownerId,newlyLaunchedAirIds);this.resolveOutcome();
    }
    this.resolvedCombatEvents=[];this.resolvedAviationLaunches=[];
    this.phaseSubmitted=this.phaseSubmitted.filter(id=>!this.team(id).eliminated);
    const requested=this.team(activeOwnerId);
    if(!this.result&&!requested.eliminated&&!this.phaseSubmitted.includes(activeOwnerId))this.activeIndex=this.teams.findIndex(team=>team.id===activeOwnerId);
    else if(!this.result){const next=this.nextUnsubmittedTeam();this.activeIndex=next;}
    const activeOwner=this.result?undefined:this.active.id;
    this.aviationOrders=this.aviationOrders.filter(order=>order.ownerId===activeOwner);
    this.movementOrders=this.movementOrders.filter(order=>order.ownerId===activeOwner);
    this.combatOrders=this.combatOrders.filter(order=>order.ownerId===activeOwner);
  }
  private endV2Turn():MoveEvent[] {
    if(this.phase!=='aviation')throw Error('当前规则阶段无效');
    const ownerId=this.active.id;
    if(this.phaseSubmitted.includes(ownerId))throw Error('本方本轮已经行动');
    const eligibleAirIds=new Set(this.aviation.squadrons.map(squadron=>squadron.id));
    const movementEvents=this.resolveMovementOrders(ownerId);
    this.resolveAviationOrders(ownerId);
    const aviation=resolveAviationTurn(this,ownerId,eligibleAirIds);this.resolvedCombatEvents=aviation.combatEvents;this.resolvedAviationMoves=aviation.moves;
    this.resolvedCombatEvents.push(...this.resolveCombatOrders(ownerId));
    const newlyLaunchedAirIds=new Set(this.aviation.squadrons.filter(squadron=>squadron.ownerId===ownerId&&!eligibleAirIds.has(squadron.id)).map(squadron=>squadron.id));
    this.ageContacts(ownerId);this.updatePortOccupations(ownerId);endAviationTurn(this,ownerId,newlyLaunchedAirIds);this.resolveOutcome();
    if(this.result)return movementEvents;
    this.phaseSubmitted.push(ownerId);
    if(this.initiativeOrder().every(index=>this.phaseSubmitted.includes(this.teams[index].id)))this.finishV2Round();
    else this.activeIndex=this.nextUnsubmittedTeam();
    this.campaignRevision++;return movementEvents;
  }
  endTurn(): MoveEvent[] {
    if(this.rulesetId==='naval-v2'){this.assertPlayable();this.resolvedCombatEvents=[];this.resolvedAviationLaunches=[];this.resolvedAviationMoves=[];return this.endV2Turn();}
    this.assertPlayable();this.refreshVision();this.ageContacts(this.active.id);this.updatePortOccupations(this.active.id);this.resolveOutcome();if(this.result)return [];
    endAviationTurn(this,this.active.id);
    do {this.activeIndex = (this.activeIndex + 1) % this.teams.length; if (!this.activeIndex) this.round++;}while(this.active.eliminated);
    this.active.oil = this.oilCap();
    this.active.credits=Math.min(MAX_CREDITS,this.active.credits+this.income());
    this.campaignRevision++;
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
    this.refreshVision();this.resolveOutcome();if(this.rulesetId==='naval-v2')initializeAviationDecks(this);
    return JSON.parse(JSON.stringify({ format: 'al-hex-match', version: 28, ...(this.submarineRosterLegacy?{submarineRosterLegacy:true as const}:{}), mapVersion: 1, size: this.world.width,height:this.world.height,mapKind:this.world.scenarioId,mapHash: this.hash,
      rulesetId:this.rulesetId,combatState:this.combatState,phase:this.rulesetId==='naval-v2'?this.phase:'classic',initiativeIndex:this.initiativeIndex,phaseSubmitted:this.rulesetId==='naval-v2'?this.phaseSubmitted:[],aviationOrders:this.rulesetId==='naval-v2'?this.aviationOrders:[],movementOrders:this.rulesetId==='naval-v2'?this.movementOrders:[],combatOrders:this.rulesetId==='naval-v2'?this.combatOrders:[],round: this.round, activeIndex: this.activeIndex, teams: this.teams,
      units: this.units.map(({ asset, ...unit }) => ({ ...unit, assetId: asset.id })),contacts:this.rulesetId==='naval-v2'?this.contacts:this.teams.map(()=>[]),aviation: this.aviation,fog:this.fog.save(),campaign:{ports:this.ports,intel:this.portIntel,result:this.result} }));
  }
  static load(input: unknown, assets: ShipAsset[]): Match {
    const data = input as any;
    const fail = (): never => { throw Error('存档格式或战局数据无效，当前战局未改变'); };
    const integer = (n: unknown, low: number, high: number) => Number.isInteger(n) && Number(n) >= low && Number(n) <= high;
    const mapKind=data?.version>=23?data.mapKind:'archipelago',mapHeight=data?.version>=23?data.height:data?.size,battle=isCampaignBattleId(mapKind)?campaignBattle(mapKind):undefined;
    const validMap=mapKind==='archipelago'&&[128,256,512].includes(data?.size)&&mapHeight===data?.size||mapKind==='test-5x10'&&data?.size===5&&mapHeight===10||!!battle&&data?.size===battle.width&&mapHeight===battle.height;
    if (!data || data.format !== 'al-hex-match' || ![1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28].includes(data.version) || data.mapVersion !== 1 || !validMap) fail();
    if(data.version>=16&&(!['naval-v2','classic-v1'].includes(data.rulesetId)||!integer(data.combatState,0,0xffffffff)))fail();
    if (!Array.isArray(data.teams) || !integer(data.teams.length, 2, 8) || !integer(data.activeIndex, 0, data.teams.length - 1) || !integer(data.round, 1, 1_000_000)) fail();
    if(data.version>=19&&(!integer(data.initiativeIndex,0,data.teams.length-1)||!Array.isArray(data.phaseSubmitted)||new Set(data.phaseSubmitted).size!==data.phaseSubmitted.length||data.phaseSubmitted.some((id:number)=>!integer(id,1,data.teams.length))||!Array.isArray(data.movementOrders)||data.rulesetId==='naval-v2'&&(data.version>=24?data.phase!=='aviation':!(data.version>=22?['aviation','movement','combat']:['movement','combat']).includes(data.phase))||data.rulesetId==='classic-v1'&&data.phase!=='classic'))fail();
    if(data.version>=22&&!Array.isArray(data.aviationOrders))fail();
    if(data.version>=20&&!Array.isArray(data.combatOrders))fail();
    if (data.version < 8 ? !integer(data.fleetSerial,0,1_000_000) || !Array.isArray(data.fleets) : data.fleets !== undefined || data.fleetSerial !== undefined) fail();
    const teamNames=battle?.sides??TEAM_NAMES;
    if (data.teams.some((team: Team, i: number) => !team || team.id !== i + 1 || team.name !== teamNames[i] || data.version >= 4 && !integer(team.oil, 0, data.version>=14?MAX_CREDITS:OIL_PER_TURN))) fail();
    if(data.version>=13&&data.teams.some((t:Team)=>!integer(t.credits,0,MAX_CREDITS)||typeof t.eliminated!=='boolean'))fail();
    if(data.version>=16&&data.teams.some((t:Team)=>!integer(t.supply,0,MAX_SUPPLY)))fail();
    if(data.version>=15&&data.teams.some((t:Team)=>!['human','ai'].includes(t.controller)))fail();
    if(mapKind==='test-5x10'&&data.teams.length!==2)fail();
    const scenarioAssets=mapKind==='test-5x10'?testArenaFleetAssets(assets):assets;
    const expectedUnits = battle?battle.startingFleetIds.flat().length:scenarioAssets.length * (data.version === 1 ? 1 : data.teams.length);
    const legacySubmarineCount=battle?battle.startingFleetIds.flat().filter(id=>id==='i19').length:0;
    const legacyRosterCounts=battle?[expectedUnits-legacySubmarineCount]:mapKind==='test-5x10'
      ?[TEST_ARENA_SHIP_TYPES.filter(code=>code!=='SS').length*data.teams.length]
      :[scenarioAssets.filter(asset=>asset.ship_type.code!=='SS').length*(data.version===1?1:data.teams.length),scenarioAssets.filter(asset=>INITIAL_ROSTER_IDS.has(asset.id)).length*(data.version===1?1:data.teams.length)];
    const validLegacyRoster=(data.version<28||data.submarineRosterLegacy===true)&&Array.isArray(data.units)&&legacyRosterCounts.includes(data.units.length);
    if(data.submarineRosterLegacy!==undefined&&data.submarineRosterLegacy!==true||data.version>=28&&data.submarineRosterLegacy===true&&!validLegacyRoster)fail();
    const legacyFullCampaignRoster=!!battle&&data.version!==1&&Array.isArray(data.units)&&data.units.length===assets.length*data.teams.length;
    if (!Array.isArray(data.units) || data.units.length !== expectedUnits&&!legacyFullCampaignRoster&&!validLegacyRoster || data.version < 8 && data.fleets.length > Math.floor(expectedUnits / 2)) fail();
    const world=mapKind==='test-5x10'?new HexWorld(5,10,'test-5x10'):battle?new HexWorld(battle.width,battle.height,battle.id):new HexWorld(data.size);
    const match = new Match(world, assets, data.teams.length); if (match.hash !== data.mapHash) throw Error('存档地图与当前生成规则不同，当前战局未改变');
    match.submarineRosterLegacy=validLegacyRoster&&data.units.length!==expectedUnits;
    match.rulesetId=data.version>=16?data.rulesetId:'classic-v1';
    match.phase=data.version>=19?data.phase:match.rulesetId==='naval-v2'?'combat':'classic';
    if(match.rulesetId==='naval-v2')match.phase='aviation';
    match.initiativeIndex=data.version>=19?data.initiativeIndex:0;
    match.phaseSubmitted=data.version>=19?[...data.phaseSubmitted]:match.rulesetId==='naval-v2'?data.teams.slice(0,data.activeIndex).filter((team:Team)=>!team.eliminated).map((team:Team)=>team.id):[];
    if(data.version>=16)match.combatState=data.combatState>>>0;
    match.teams = data.teams.map((team: Team,i: number) => ({ id: i + 1, name: teamNames[i], oil: data.version >= 4 ? team.oil : OIL_PER_TURN,credits:data.version>=13?team.credits:STARTING_CREDITS,supply:data.version>=16?team.supply:STARTING_SUPPLY,eliminated:false,controller:data.version>=15?team.controller:'human' }));
    const freshUnits = match.units;
    const identities = new Set<string>(), occupied = new Map<string,boolean[]>(), assetIds = new Set<string>(), legacyMembership = new Map<string,string>();
    const validCell = (cell: Cell | undefined): boolean => !!cell && integer(cell.col, 0, data.size - 1) && integer(cell.row, 0, mapHeight - 1) && match.world.isSea(cell);
    const validNotice = (notice?: string) => notice === undefined || typeof notice === 'string' && notice.length < 160;
    match.units = data.units.map((raw: any) => {
      const saved = raw as any, expectedId = data.version === 1 ? `preview-${saved?.assetId}` : `team-${saved?.ownerId}-${saved?.assetId}`, assetKey = data.version === 1 ? saved?.assetId : `${saved?.ownerId}:${saved?.assetId}`;
      if (!saved || typeof saved.instanceId !== 'string' || saved.instanceId !== expectedId || identities.has(saved.instanceId) || assetIds.has(assetKey)) return fail();
      const asset = scenarioAssets.find(a => a.id === saved.assetId); if (!asset || !validCell(saved) || !integer(saved.ownerId, 1, data.teams.length) || !['left','right'].includes(saved.facing)) return fail();
      const combat = profile(asset.ship_type.code), status = saved.status as MatchUnit['status'];
      const v2Ship=shipRulesV2(asset.ship_type.code),savedSubmerged=asset.ship_type.code==='SS'?(data.version>=28?saved.submerged:true):undefined;
      if(data.version>=28&&(asset.ship_type.code==='SS'?typeof saved.submerged!=='boolean':saved.submerged!==undefined))return fail();
      if((data.version>=16&&data.rulesetId==='naval-v2'&&(!integer(saved.movementUsed,0,shipSpeedV2(asset.ship_type.code,savedSubmerged))||typeof saved.movedThisTurn!=='boolean'||data.version<19&&saved.movedThisTurn&&saved.movementUsed===0||!integer(saved.torpedoes,0,v2Ship.torpedoes)))||(data.version>=17&&data.rulesetId==='naval-v2'&&typeof saved.firedThisTurn!=='boolean'))return fail();
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
      if (status !== 'sunk') {
        const key=cellKey(saved),sameHex=occupied.get(key)??[],submergedSub=asset.ship_type.code==='SS'&&savedSubmerged===true;
        if(sameHex.length&&!(data.version>=28&&data.rulesetId==='naval-v2'&&sameHex.length===1&&sameHex[0]!==submergedSub))return fail();
        sameHex.push(submergedSub);occupied.set(key,sameHex);
      }
      identities.add(saved.instanceId); assetIds.add(assetKey);
      return { instanceId: saved.instanceId, asset, col: saved.col, row: saved.row, facing: saved.facing, ownerId: saved.ownerId,
        action: saved.action, status, hp, maxHp, guard, cooldowns: ['CV','CVL'].includes(asset.ship_type.code) ? {} : { ...cooldowns },
        notice: saved.order || /航线|自动航行|计划航行/.test(saved.notice ?? '') ? undefined : saved.notice,
        ...(data.version>=16&&data.rulesetId==='naval-v2'?{movementUsed:saved.movementUsed,movedThisTurn:saved.movedThisTurn,torpedoes:saved.torpedoes,firedThisTurn:data.version>=17?saved.firedThisTurn:false}:{}),
        ...(asset.ship_type.code==='SS'?{submerged:savedSubmerged}:{}),
        ...(saved.availableRound!==undefined?{availableRound:saved.availableRound}:{}) };
    });
    if (data.teams.some((team: Team) => !match.units.some(u => u.ownerId === team.id))) fail();
    if(data.version>=18){
      if(!Array.isArray(data.contacts)||data.contacts.length!==match.teams.length)fail();
      match.contacts=data.contacts.map((records:unknown,ownerIndex:number)=>{
        if(!Array.isArray(records))return fail();
        if(records.length>match.units.length||data.rulesetId==='classic-v1'&&records.length)fail();
        const known=new Set<string>();
        return records.map((raw:unknown)=>{
          const contact=raw as NavalContact,unit=contact&&match.units.find(u=>u.instanceId===contact.unitId);
          if(!contact||!unit||unit.ownerId!==contact.ownerId||contact.ownerId===ownerIndex+1||known.has(contact.unitId)||!validCell(contact)||!integer(contact.level,1,3)||!integer(contact.age,0,100)||typeof contact.seenThisTurn!=='boolean')return fail();
          if(contact.level===1&&(contact.sizeClass!==undefined||contact.hpBand!==undefined)||contact.level>=2&&!['large','small'].includes(contact.sizeClass??'')||contact.shipType!==undefined&&contact.shipType!==unit.asset.ship_type.code||contact.assetId!==undefined&&(contact.assetId!==unit.asset.id||contact.shipType!==unit.asset.ship_type.code)||contact.level<3&&contact.hpBand!==undefined||contact.level===3&&(contact.shipType!==unit.asset.ship_type.code||contact.assetId!==unit.asset.id||!['intact','damaged','critical'].includes(contact.hpBand??'')||contact.col!==unit.col||contact.row!==unit.row||!contact.seenThisTurn||!match.canObserveShip(ownerIndex+1,unit)))return fail();
          known.add(contact.unitId);return {...contact};
        });
      });
    }
    if(data.version>=19){
      const aviationOrders=data.version>=22?data.aviationOrders:[];
      if(match.rulesetId==='classic-v1'&&(data.phaseSubmitted.length||data.movementOrders.length||data.version>=20&&data.combatOrders.length||aviationOrders.length)||match.rulesetId==='naval-v2'&&(data.phase==='combat'&&data.movementOrders.length||data.phase!=='aviation'&&aviationOrders.length))fail();
      if(match.rulesetId==='naval-v2'&&(data.phaseSubmitted.includes(data.activeIndex+1)||data.phaseSubmitted.some((id:number)=>match.team(id).eliminated)))fail();
      const seenOrders=new Set<string>();
      for(const raw of data.movementOrders){
        const order=raw as NavalMoveOrder|undefined,unit=order&&match.units.find(item=>item.instanceId===order.unitId);
        if(!order||!unit)return fail();
        if(match.rulesetId!=='naval-v2'||(data.version>=24?data.phase!=='aviation':data.phase!=='aviation'&&data.phase!=='movement')||unit.ownerId!==order.ownerId||unit.status!=='ready'||!unit.movedThisTurn||seenOrders.has(unit.instanceId)||(data.version>=24?unit.ownerId!==data.activeIndex+1:!data.phaseSubmitted.includes(unit.ownerId)&&unit.ownerId!==data.activeIndex+1))return fail();
        if(!Array.isArray(order.cells)||order.cells.length<2||order.cells.length>7||!Array.isArray(order.costs)||order.costs.length!==order.cells.length||order.costs[0]!==0||!validCell(order.target)||order.groupId!==undefined&&(typeof order.groupId!=='string'||!order.groupId.length||order.groupId.length>500||typeof order.groupAnchor!=='boolean')||order.groupId===undefined&&order.groupAnchor!==undefined)return fail();
        const first=order.cells[0],last=order.cells[order.cells.length-1];
        if(!first||!last||!sameCell(first,unit)||!sameCell(last,order.target))return fail();
        let total=0;
        for(let i=1;i<order.cells.length;i++){
          const cell=order.cells[i],previous=order.cells[i-1];
          if(!cell||!previous||!validCell(cell)||hexDistance(previous,cell)!==1)return fail();
          const expectedCost=data.version>=25?1:match.world.at(cell)===Terrain.Shallow&&!['DD','CL'].includes(unit.asset.ship_type.code)?2:1;
          if(order.costs[i]!==expectedCost)return fail();total+=expectedCost;
        }
        if(total>match.movementLimit(unit))return fail();seenOrders.add(unit.instanceId);
      }
      const groups=new Map<string,number>();
      for(const order of data.movementOrders as NavalMoveOrder[])if(order.groupId)groups.set(order.groupId,(groups.get(order.groupId)??0)+Number(order.groupAnchor));
      if([...groups.values()].some(anchors=>anchors!==1))return fail();
      if(data.version>=20){
        if(match.rulesetId==='naval-v2'&&data.phase!=='combat'&&data.phase!=='aviation'&&data.combatOrders.length||match.rulesetId==='classic-v1'&&data.combatOrders.length)fail();
        const seenAttacks=new Set<string>();
        for(const raw of data.combatOrders){
          const order=raw as NavalAttackOrder|undefined,attacker=order&&match.units.find(item=>item.instanceId===order.attackerId),target=order&&match.units.find(item=>item.instanceId===order.targetId),weapon=attacker&&match.weapons(attacker).find(item=>item.id===order!.weaponId);
          if(!order||!attacker||!target||!weapon||weapon.kind==='air'||attacker.ownerId!==order.ownerId||attacker.ownerId===target.ownerId||seenAttacks.has(attacker.instanceId)||!integer(order.distance,weapon.kind==='asw'?0:1,7))return fail();
          if(attacker.action!==0||attacker.status!=='ready'&&attacker.status!=='sunk'||(data.version>=24?attacker.ownerId!==data.activeIndex+1:!data.phaseSubmitted.includes(attacker.ownerId)&&attacker.ownerId!==data.activeIndex+1))return fail();
          if(data.version>=28&&target.asset.ship_type.code==='SS'&&target.submerged&&weapon.kind!=='asw'||data.version>=28&&weapon.kind==='asw'&&(!['DD','CL'].includes(attacker.asset.ship_type.code)||target.asset.ship_type.code!=='SS'||!target.submerged))return fail();
          if(order.distance<weapon.minRange||order.distance>weapon.maxRange)return fail();
          seenAttacks.add(attacker.instanceId);
        }
      }
    }
    match.movementOrders=data.version>=19?data.movementOrders.map((order:NavalMoveOrder)=>({...order,target:{...order.target},cells:order.cells.map(cell=>({...cell})),costs:[...order.costs]})):[];
    if(data.version<25&&match.rulesetId==='naval-v2')for(const order of match.movementOrders)order.costs=order.cells.map((_,index)=>index?1:0);
    match.combatOrders=data.version>=20?data.combatOrders.map((order:NavalAttackOrder)=>({...order})):[];
    match.aviationOrders=data.version>=22?data.aviationOrders.map((order:CarrierLaunchOrder)=>({...order,slots:[...order.slots]})):[];
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
    if (data.version >= 5) match.aviation = validateAviation(data.aviation,match,data.version as 5|6|7|8|9|10|11|12|13|14|15|16|17|18|19|20|21|22|23|24|25|26|27|28);
    if(data.version>=22){
      const seenLaunches=new Set<string>();
      for(const order of match.aviationOrders){
        const carrier=match.units.find(unit=>unit.instanceId===order.carrierId);if(!carrier)return fail();
        const stats=CARRIER_STATS[carrier.asset.ship_type.code],deck=match.aviation.decks[order.carrierId];
        if(match.rulesetId!=='naval-v2'||match.phase!=='aviation'||!stats||carrier.ownerId!==order.ownerId||carrier.status!=='ready'||(data.version>=25?carrier.action!==0:!carrier.action)||seenLaunches.has(order.carrierId)||match.aviation.launched[order.carrierId]===match.round||(data.version>=24?order.ownerId!==match.active.id:!match.phaseSubmitted.includes(order.ownerId)&&order.ownerId!==match.active.id)||!Array.isArray(order.slots)||!deck)return fail();
        if(!stats||!deck)return fail();
        const limit=carrier.asset.ship_type.code==='CV'?2:1,expected=deck.squadrons.filter(slot=>slot.status==='ready').map(slot=>slot.slot).sort((a,b)=>a-b).slice(0,Math.max(0,limit-deck.operationsUsed));
        if(!expected.length||order.slots.length!==expected.length||order.slots.some((slot,index)=>slot!==expected[index]))fail();
        seenLaunches.add(order.carrierId);
      }
      if(data.version<25)for(const order of match.aviationOrders)match.unit(order.carrierId).action=0;
    }
    if (data.version === 1) {
      const ownerId = match.active.id;
      for (const unit of match.units) { unit.instanceId = `team-${ownerId}-${unit.asset.id}`; unit.ownerId = ownerId; }
      const legacyOccupied=new Set(match.units.map(cellKey));
      for (const unit of freshUnits.filter(unit => unit.ownerId !== ownerId)) {
        const cell = match.world.nearbySea(unit,legacyOccupied); Object.assign(unit,cell); legacyOccupied.add(cellKey(cell)); match.units.push(unit);
      }
    }
    if(data.version>=12){try{match.fog.load(data.fog);}catch{fail();}}
    else match.fog.load({explored:Array(match.teams.length).fill(btoa('\0'.repeat(Math.ceil(match.world.width*match.world.height/8))))});
    if(data.version>=13){
      const c=data.campaign;
      if(data.version===13)match.ports=createLegacyPorts(match.world,freshUnits,match.teams.length);
      if(!c||!Array.isArray(c.ports)||c.ports.length!==match.ports.length||!Array.isArray(c.intel)||c.intel.length!==match.teams.length)fail();
      match.ports=match.ports.map((p,i)=>{
        const raw=c.ports[i];if(!raw||raw.id!==p.id||raw.name!==p.name||raw.col!==p.col||raw.row!==p.row||raw.homeForId!==p.homeForId||!integer(raw.ownerId,0,match.teams.length)||!integer(raw.usedRound,0,data.round)||data.version>=16&&!integer(raw.serviceRound,0,data.round)||data.version>=17&&(!integer(raw.occupationProgress,0,1)||raw.occupationOwnerId!==undefined&&(!integer(raw.occupationOwnerId,1,match.teams.length)||raw.occupationOwnerId===raw.ownerId)||raw.occupationProgress===1&&!raw.occupationOwnerId))fail();
        return {...p,ownerId:raw.ownerId,usedRound:raw.usedRound,serviceRound:data.version>=16?raw.serviceRound:0,occupationOwnerId:data.version>=17?raw.occupationOwnerId:undefined,occupationProgress:data.version>=17?raw.occupationProgress:0};
      });
      if(c.intel.some((row:unknown)=>!Array.isArray(row)||row.length!==match.ports.length||row.some(v=>!integer(v,-1,match.teams.length))))fail();
      match.portIntel=c.intel.map((row:number[])=>[...row]);
    }else match.portIntel=match.teams.map(t=>match.ports.map(p=>p.ownerId===t.id?t.id:-1));
    if(data.version>=14&&match.teams.some(t=>t.oil>match.oilCap(t.id)))fail();
    const migrateLegacyTurnQueue=data.version>=19&&data.version<24&&match.rulesetId==='naval-v2'&&match.phaseSubmitted.length>0;
    if(migrateLegacyTurnQueue)match.resolveLegacySubmittedTurns(data.activeIndex+1);
    match.refreshVision();match.resolveOutcome();
    if(data.version>=13&&!migrateLegacyTurnQueue){
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
