import {commandSquadron,launchPreview,launchWing,orderCarrierLaunch} from './aircraft.ts';
import {cellCenter,hexDistance,hexLine,neighbors,worldToCell} from './hex.ts';
import {REINFORCEMENT_COST} from './ports.ts';
import {cellKey} from './pathfinding.ts';
import {campaignBattle} from './historical-battles.ts';
import {damageOnHitV2,shipRulesV2} from './naval-rules-v2.ts';
import type {CombatEvent,Match,MatchUnit,MoveEvent,WeaponDefinition} from './match.ts';
import {Terrain,type Cell} from './types.ts';

export interface AiTurnReport {
  teamId:number;
  moves:MoveEvent[];
  combats:CombatEvent[];
  captures:number;
  repairs:number;
  reinforcements:number;
  launched:number;
  airOrders:number;
  defended:number;
}

const typePriority:Record<string,number>={DD:0,CL:1,CA:2,BB:3,CVL:4,CV:5};

function visibleEnemies(match:Match):MatchUnit[] {
  return match.units.filter(unit=>unit.ownerId!==match.active.id&&unit.status!=='sunk'&&match.unitVisible(unit));
}

function bestAttack(match:Match,unit:MatchUnit):{target:MatchUnit;weapon:WeaponDefinition;score:number}|undefined {
  const mission=campaignBattle(match.world.scenarioId)?.mission.objectives[match.active.id-1];
  let best:{target:MatchUnit;weapon:WeaponDefinition;score:number}|undefined;
  for(const target of visibleEnemies(match))for(const weapon of match.weapons(unit)){
    const preview=match.attackPreview(unit.instanceId,target.instanceId,weapon.id);if(!preview.valid)continue;
    const code=target.asset.ship_type.code,strategic=(['CV','CVL','BB'].includes(code)?18:0)+(mission?.kind==='sink-ships'&&(!mission.targetTypes||mission.targetTypes.includes(code))?80:0);
    const chance=preview.hitChance??100,band=match.rulesetId==='naval-v2'?match.contactsFor(match.active.id).find(c=>c.key===target.instanceId)?.hpBand:undefined;
    const knownHp=band==='critical'?target.maxHp*.125:band==='damaged'?target.maxHp*.375:band==='intact'?target.maxHp*.75:target.hp;
    const score=(knownHp<=preview.damage?1000*chance/100:0)+preview.damage*chance/100*30+strategic-knownHp*2-preview.distance;
    if(!best||score>best.score||score===best.score&&target.instanceId.localeCompare(best.target.instanceId)<0)best={target,weapon,score};
  }
  return best;
}

function captureNearby(match:Match,unit:MatchUnit):boolean {
  const ports=match.knownPorts().filter(view=>view.visible&&view.ownerId!==unit.ownerId&&hexDistance(unit,view.port)<=1)
    .sort((a,b)=>Number(!!b.port.homeForId)-Number(!!a.port.homeForId)||a.port.id.localeCompare(b.port.id));
  for(const {port} of ports){const preview=match.capturePreview(unit.instanceId,port.id);if(preview.valid){match.capturePort(unit.instanceId,port.id);return true;}}
  return false;
}

function executeAttack(match:Match,report:AiTurnReport,attacker:MatchUnit,target:MatchUnit,weapon:WeaponDefinition):void {
  if(match.rulesetId==='naval-v2')match.orderAttack(attacker.instanceId,target.instanceId,weapon.id);
  else report.combats.push(match.attack(attacker.instanceId,target.instanceId,weapon.id));
}

function cellsWithin(origin:Cell,radius:number):Cell[]{
  const queue:[Cell,number][]=[[origin,0]],seen=new Set([cellKey(origin)]),result=[origin];
  for(let i=0;i<queue.length;i++){
    const [cell,distance]=queue[i];if(distance===radius)continue;
    for(const next of neighbors(cell)){const key=cellKey(next);if(seen.has(key))continue;seen.add(key);queue.push([next,distance+1]);result.push(next);}
  }
  return result;
}

function explorationScore(match:Match,cell:Cell,owner:number):number {
  let unknown=0,frontier=0;
  for(const sample of cellsWithin(cell,2))if(match.world.contains(sample)){
    const state=match.fog.state(owner,sample);if(!state)unknown++;else if(state===1)frontier++;
  }
  return unknown*4+frontier;
}

function threatAt(match:Match,unit:MatchUnit,cell:Cell,enemies:MatchUnit[]):number {
  const armor=shipRulesV2(unit.asset.ship_type.code).armor,armorClass=armor<=1?'light':armor<=2?'medium':'heavy';
  let total=0;
  for(const enemy of enemies){
    if(enemy.status!=='ready')continue;
    const distance=hexDistance(cell,enemy);
    const best=match.weapons(enemy).filter(weapon=>distance>=weapon.minRange&&distance<=weapon.maxRange&&match.cooldown(enemy,weapon.id)===0
      &&(weapon.kind!=='torpedo'||(enemy.torpedoes??0)>0)
      &&(weapon.kind==='air'||!hexLine(enemy,cell).slice(1,-1).some(sample=>match.world.at(sample)===Terrain.Land)))
      .reduce((value,weapon)=>{
        const damage=weapon.power===undefined?weapon.damage[armorClass]:damageOnHitV2(weapon,armor,false);
        return Math.max(value,damage*(weapon.kind==='torpedo'?1.35:1));
      },0);
    total+=best;
  }
  return total;
}

function campaignPortGoal(match:Match,unit:MatchUnit):{port:Cell;kind:'capture-port'|'hold-port'}|undefined {
  const objective=campaignBattle(match.world.scenarioId)?.mission.objectives[match.active.id-1];
  if(!objective||(objective.kind!=='capture-port'&&objective.kind!=='hold-port'))return;
  const port=match.ports[objective.portIndex];if(!port)return;
  const eligible=(candidate:MatchUnit)=>candidate.ownerId===unit.ownerId&&candidate.status==='ready'&&(!candidate.availableRound||candidate.availableRound<=match.round)&&['DD','CL','CA'].includes(candidate.asset.ship_type.code);
  if(objective.kind==='capture-port'){
    if(port.ownerId===unit.ownerId)return;
    const leader=match.units.filter(eligible).sort((a,b)=>(typePriority[a.asset.ship_type.code]??9)-(typePriority[b.asset.ship_type.code]??9)||a.instanceId.localeCompare(b.instanceId))[0];
    return leader?.instanceId===unit.instanceId?{port,kind:objective.kind}:undefined;
  }
  const candidates=match.units.filter(eligible),stationed=candidates.filter(candidate=>hexDistance(candidate,port)<=2)
    .sort((a,b)=>hexDistance(a,port)-hexDistance(b,port)||(typePriority[a.asset.ship_type.code]??9)-(typePriority[b.asset.ship_type.code]??9)||a.instanceId.localeCompare(b.instanceId));
  const guard=stationed[0]??candidates.sort((a,b)=>(typePriority[a.asset.ship_type.code]??9)-(typePriority[b.asset.ship_type.code]??9)||a.instanceId.localeCompare(b.instanceId))[0];
  return guard?.instanceId===unit.instanceId?{port,kind:objective.kind}:undefined;
}

function chooseMove(match:Match,unit:MatchUnit):Cell|undefined {
  const reachable=match.reachable(unit.instanceId);if(reachable.length<2)return;
  const current={col:unit.col,row:unit.row},enemies=visibleEnemies(match);
  const ownPorts=match.knownPorts().filter(view=>view.ownerId===unit.ownerId).map(view=>view.port);
  const targetPorts=match.knownPorts().filter(view=>view.ownerId!==unit.ownerId).map(view=>view.port);
  const campaignGoal=campaignPortGoal(match,unit);
  if(campaignGoal&&campaignGoal.kind==='hold-port'&&hexDistance(unit,campaignGoal.port)<=2){
    const currentThreat=threatAt(match,unit,unit,enemies);if(!currentThreat)return;
    return reachable.filter(cell=>hexDistance(cell,campaignGoal.port)<=2)
      .map(cell=>({cell,threat:threatAt(match,unit,cell,enemies),distance:hexDistance(cell,campaignGoal.port)}))
      .filter(candidate=>candidate.threat<currentThreat)
      .sort((a,b)=>a.threat-b.threat||a.distance-b.distance||a.cell.row-b.cell.row||a.cell.col-b.cell.col)[0]?.cell;
  }
  if(campaignGoal&&campaignGoal.kind==='capture-port'&&hexDistance(unit,campaignGoal.port)===0)return;
  const retreat=unit.hp/unit.maxHp<=.38&&ownPorts.length;
  const objective=retreat
    ? ownPorts.sort((a,b)=>hexDistance(unit,a)-hexDistance(unit,b))[0]
    : campaignGoal?.port??enemies.sort((a,b)=>hexDistance(unit,a)-hexDistance(unit,b))[0]
      ??targetPorts.sort((a,b)=>hexDistance(unit,a)-hexDistance(unit,b))[0];
  const maxRange=Math.max(1,...match.weapons(unit).map(weapon=>weapon.maxRange));
  const scored=reachable.filter(cell=>cellKey(cell)!==cellKey(current)).map(cell=>{
    const explore=explorationScore(match,cell,unit.ownerId),travel=hexDistance(current,cell);
    let score=explore*12+travel;
    if(objective){
      const distance=hexDistance(cell,objective);
      if(retreat)score+=1000-distance*80;
      else if(campaignGoal)score+=(hexDistance(current,campaignGoal.port)-distance)*10000-threatAt(match,unit,cell,enemies)*2400;
      else if('instanceId' in objective)score+=700-Math.abs(distance-maxRange)*75-distance;
      else score+=600-distance*55;
    }
    if(['DD','CL'].includes(unit.asset.ship_type.code))score+=explore*10;
    return {cell,score};
  });
  scored.sort((a,b)=>b.score-a.score||b.cell.row-a.cell.row||b.cell.col-a.cell.col);
  return scored[0]?.cell;
}

function repairDamaged(match:Match,report:AiTurnReport):void {
  const ports=match.knownPorts().filter(view=>view.ownerId===match.active.id).map(view=>view.port);
  const damaged=match.units.filter(unit=>unit.ownerId===match.active.id&&unit.status==='ready'&&unit.action&&unit.hp<unit.maxHp&&unit.hp/unit.maxHp<=.62)
    .sort((a,b)=>a.hp/a.maxHp-b.hp/b.maxHp||a.instanceId.localeCompare(b.instanceId));
  for(const unit of damaged)for(const port of ports){const preview=match.repairPreview(unit.instanceId,port.id);if(preview.valid){match.repairShip(unit.instanceId,port.id);report.repairs++;break;}}
}

function reinforceFleet(match:Match,report:AiTurnReport):void {
  const ports=match.knownPorts().filter(view=>view.ownerId===match.active.id).map(view=>view.port).sort((a,b)=>a.id.localeCompare(b.id));
  for(const port of ports){
    const sunk=match.units.filter(unit=>unit.ownerId===match.active.id&&unit.status==='sunk')
      .sort((a,b)=>(REINFORCEMENT_COST[a.asset.ship_type.code]??40)-(REINFORCEMENT_COST[b.asset.ship_type.code]??40)||a.instanceId.localeCompare(b.instanceId));
    const choice=sunk.find(unit=>match.reinforcementPreview(port.id,unit.instanceId).valid);
    if(choice){match.reinforce(port.id,choice.instanceId);report.reinforcements++;}
  }
}

function orderAircraft(match:Match,report:AiTurnReport):void {
  if(match.rulesetId==='classic-v1'){
    const carriers=match.units.filter(unit=>unit.ownerId===match.active.id&&unit.status==='ready'&&['CV','CVL'].includes(unit.asset.ship_type.code))
      .sort((a,b)=>a.instanceId.localeCompare(b.instanceId));
    for(const carrier of carriers){const preview=launchPreview(match,carrier.instanceId);if(preview.valid){report.launched+=launchWing(match,carrier.instanceId).length;}}
  }
  const enemyAir=match.aviation.squadrons.filter(s=>s.ownerId!==match.active.id&&match.airVisible(s));
  const enemyShips=visibleEnemies(match),mission=campaignBattle(match.world.scenarioId)?.mission.objectives[match.active.id-1];
  const objectives=match.knownPorts().filter(view=>view.ownerId!==match.active.id).map(view=>view.port);
  for(const squadron of match.aviation.squadrons.filter(s=>s.ownerId===match.active.id&&s.actionPoints>0&&s.order!=='return')){
    const cell=worldToCell(squadron);
    const air=squadron.role==='fighter'?enemyAir.slice().sort((a,b)=>hexDistance(cell,worldToCell(a))-hexDistance(cell,worldToCell(b))||a.id.localeCompare(b.id))[0]:undefined;
    const validShipTargets=squadron.role==='fighter'?[]:enemyShips.filter(unit=>!(unit.asset.ship_type.code==='SS'&&unit.submerged&&squadron.role!=='bomber'));
    const ship=validShipTargets.slice().sort((a,b)=>{
      const priority=(unit:MatchUnit)=>mission?.kind==='sink-ships'&&(!mission.targetTypes||mission.targetTypes.includes(unit.asset.ship_type.code))?1:0;
      return priority(b)-priority(a)||hexDistance(cell,a)-hexDistance(cell,b)||a.instanceId.localeCompare(b.instanceId);
    })[0];
    try {
      if(air)commandSquadron(match,squadron.id,undefined,air.id);
      else if(ship)commandSquadron(match,squadron.id,undefined,ship.instanceId);
      else {
        const objective=objectives.slice().sort((a,b)=>hexDistance(cell,a)-hexDistance(cell,b))[0]??{col:Math.floor(match.world.width/2),row:Math.floor(match.world.height/2)};
        const line=hexLine(cell,objective),step=line[Math.min(line.length-1,Math.max(3,Math.min(10,squadron.actionPoints)))];
        if(step&&cellKey(step)!==cellKey(cell))commandSquadron(match,squadron.id,cellCenter(step));else continue;
      }
      report.airOrders++;
    } catch { /* Another squadron may have changed visibility or ended the battle. */ }
  }
}

export function executeAiTurn(match:Match):AiTurnReport {
  if(match.active.controller!=='ai')throw Error('当前不是AI席位');
  match.assertPlayable();
  const report:AiTurnReport={teamId:match.active.id,moves:[],combats:[],captures:0,repairs:0,reinforcements:0,launched:0,airOrders:0,defended:0};
  if(match.rulesetId==='naval-v2'&&match.phase==='aviation'){
    repairDamaged(match,report);
    for(const submarine of match.units.filter(unit=>unit.ownerId===match.active.id&&unit.asset.ship_type.code==='SS'&&unit.status==='ready'&&unit.action>0)){
      const enemies=visibleEnemies(match),shipThreat=enemies.some(enemy=>{
        const distance=hexDistance(submarine,enemy);
        return match.weapons(enemy).some(weapon=>weapon.kind!=='asw'&&distance>=weapon.minRange&&distance<=weapon.maxRange
          &&(weapon.kind==='air'||!hexLine(enemy,submarine).slice(1,-1).some(cell=>match.world.at(cell)===Terrain.Land)));
      });
      const bomberThreat=match.aviation.squadrons.some(s=>s.ownerId!==match.active.id&&s.role==='bomber'&&s.hp>0&&s.fuelTurns>0&&match.airVisible(s)&&hexDistance(submarine,worldToCell(s))<=2);
      const detected=enemies.some(enemy=>hexDistance(submarine,enemy)<=6)||bomberThreat;
      const shouldSubmerge=!submarine.submerged&&(shipThreat||bomberThreat),shouldSurface=submarine.submerged&&!detected;
      if(shouldSubmerge||shouldSurface){try{match.setSubmarineDepth(submarine.instanceId,shouldSubmerge);}catch{/* Depth change may be unavailable after another order. */}}
    }
    const carriers=match.units.filter(unit=>unit.ownerId===match.active.id&&unit.status==='ready'&&['CV','CVL'].includes(unit.asset.ship_type.code))
      .sort((a,b)=>a.instanceId.localeCompare(b.instanceId));
    for(const carrier of carriers){const preview=launchPreview(match,carrier.instanceId);if(preview.valid){try{report.launched+=orderCarrierLaunch(match,carrier.instanceId).length;}catch{/* A carrier may have become unavailable earlier in this action. */}}}
    const units=match.units.filter(unit=>unit.ownerId===match.active.id&&unit.status==='ready'&&!unit.movedThisTurn&&(!unit.availableRound||unit.availableRound<=match.round))
      .sort((a,b)=>(typePriority[a.asset.ship_type.code]??9)-(typePriority[b.asset.ship_type.code]??9)||a.instanceId.localeCompare(b.instanceId));
    for(const unit of units){const target=chooseMove(match,unit);if(!target)continue;try{match.issueMove(unit.instanceId,target);}catch{/* A blocked or newly invalid route remains unplanned. */}}
    const commanders=match.units.filter(unit=>unit.ownerId===match.active.id&&unit.status==='ready'&&unit.action>0&&(!unit.availableRound||unit.availableRound<=match.round))
      .sort((a,b)=>(typePriority[a.asset.ship_type.code]??9)-(typePriority[b.asset.ship_type.code]??9)||a.instanceId.localeCompare(b.instanceId));
    for(const unit of commanders){
      const objective=campaignBattle(match.world.scenarioId)?.mission.objectives[match.active.id-1];
      const objectivePort=objective?.kind==='capture-port'?match.ports[objective.portIndex]:undefined;
      const occupyingObjectivePort=objectivePort&&objectivePort.ownerId!==unit.ownerId&&unit.col===objectivePort.col&&unit.row===objectivePort.row;
      if(occupyingObjectivePort&&objectivePort.occupationOwnerId===unit.ownerId)continue;
      if(occupyingObjectivePort&&!match.plannedMove(unit.instanceId)){
        const preview=match.capturePreview(unit.instanceId,objectivePort.id);
        if(preview.valid){match.capturePort(unit.instanceId,objectivePort.id);report.captures++;continue;}
      }
      const attack=bestAttack(match,unit);if(attack){try{executeAttack(match,report,unit,attack.target,attack.weapon);}catch{/* Keep a plan valid if the target changed. */}continue;}
      if(!match.plannedMove(unit.instanceId)&&captureNearby(match,unit))report.captures++;
    }
    if(!match.result)orderAircraft(match,report);
    for(const unit of commanders)if(!match.result&&unit.action){try{match.defend(unit.instanceId);report.defended++;}catch{/* A ship moved too far or became unavailable. */}}
    return report;
  }
  reinforceFleet(match,report);repairDamaged(match,report);
  const units=match.units.filter(unit=>unit.ownerId===match.active.id&&unit.status==='ready'&&(!unit.availableRound||unit.availableRound<=match.round))
    .sort((a,b)=>(typePriority[a.asset.ship_type.code]??9)-(typePriority[b.asset.ship_type.code]??9)||a.instanceId.localeCompare(b.instanceId));
  for(const unit of units){
    if(match.result)break;
    const attack=unit.action?bestAttack(match,unit):undefined;
    if(attack){executeAttack(match,report,unit,attack.target,attack.weapon);continue;}
    if(unit.action&&captureNearby(match,unit))report.captures++;
  }
  if(!match.result)orderAircraft(match,report);
  for(const unit of units){
    if(match.result||match.rulesetId!=='naval-v2'&&match.active.oil<=0)break;if(unit.status!=='ready')continue;
    const target=chooseMove(match,unit);if(!target)continue;
    try {report.moves.push(...match.issueMove(unit.instanceId,target));match.refreshVision();} catch {continue;}
    if(unit.action&&captureNearby(match,unit)){report.captures++;continue;}
    const attack=unit.action?bestAttack(match,unit):undefined;
    if(attack)executeAttack(match,report,unit,attack.target,attack.weapon);
  }
  for(const unit of units)if(!match.result&&unit.status==='ready'&&unit.action){try{match.defend(unit.instanceId);report.defended++;}catch{/* Unit became unavailable. */}}
  return report;
}
