import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Match,type MatchUnit} from '../src/match.ts';
import {executeAiTurn} from '../src/ai.ts';
import {beginAviationRound,cancelCarrierLaunch,launchPreview,orderCarrierLaunch,tickAviation} from '../src/aircraft.ts';
import {cellCenter,hexDistance,hexLine,neighbors} from '../src/hex.ts';
import {rollDieV2} from '../src/naval-rules-v2.ts';
import {HexWorld} from '../src/world.ts';
import {Terrain,type Cell,type Roster} from '../src/types.ts';

const assets=(JSON.parse(readFileSync('data/roster.json','utf8')) as Roster).units;
const checks:string[]=[];
function check(name:string,fn:()=>void):void{fn();checks.push(name);}
function scene():Match{
  return new Match(new HexWorld(128),assets,2);
}
function launchV2(match:Match,carrierId:string){const slots=orderCarrierLaunch(match,carrierId);finishRound(match);return match.aviation.squadrons.filter(s=>s.carrierId===carrierId&&slots.includes(s.slot));}
function finishPhase(m:Match):void{const round=m.round;let steps=0;while(m.round===round&&!m.result&&steps++<m.teams.length+1)m.endTurn();assert.ok(m.round>round||m.result,'round should resolve after every active team submits');}
function finishRound(m:Match):void{finishPhase(m);}
function seaCellAtDistance(m:Match,origin:Cell,distance:number,blocked=new Set<string>()):Cell{
  const cells:Cell[]=[];for(let row=0;row<m.world.height;row++)for(let col=0;col<m.world.width;col++){
    const cell={col,row},key=`${col},${row}`;if(m.world.isSea(cell)&&hexLine(origin,cell).every(c=>m.world.isSea(c))&&!blocked.has(key)&&m.units.every(u=>u.status==='sunk'||`${u.col},${u.row}`!==key))cells.push(cell);
  }
  const found=cells.filter(c=>hexDistance(c,origin)===distance).sort((a,b)=>a.row-b.row||a.col-b.col)[0];
  if(!found)throw Error(`No sea cell at distance ${distance}`);return found;
}
function seaConflictCells(m:Match):{target:Cell;starts:[Cell,Cell]}{
  for(let row=0;row<m.world.height;row++)for(let col=0;col<m.world.width;col++){
    const target={col,row},starts=neighbors(target).filter(cell=>m.world.isSea(cell)&&m.units.every(u=>u.status==='sunk'||u.col!==cell.col||u.row!==cell.row));
    const targetOpen=m.units.every(u=>u.status==='sunk'||u.col!==target.col||u.row!==target.row);
    if(m.world.isSea(target)&&targetOpen&&starts.length>=2)return {target,starts:[starts[0],starts[1]]};
  }
  throw Error('No open sea conflict cells');
}
function sink(unit:MatchUnit):void{Object.assign(unit,{hp:0,status:'sunk',action:0,guard:false});}
function placeAtPort(m:Match,id:string,portId:string):MatchUnit{
  const unit=m.unit(id),port=m.port(portId);Object.assign(unit,{col:port.col,row:port.row,status:'ready',hp:unit.maxHp,action:1,firedThisTurn:false});return unit;
}

check('The 5x10 test arena gives both sides one ship of every class and round-trips saves',()=>{
  const world=new HexWorld(5,10,'test-5x10'),m=new Match(world,assets,2,['human','ai']);
  assert.equal(world.width,5);assert.equal(world.height,10);assert.equal(world.landCells,0);
  assert.equal(m.units.length,12);assert.equal(m.ports.length,2);assert.deepEqual(m.teams.map(team=>team.controller),['human','ai']);
  for(const ownerId of [1,2]){
    const fleet=m.units.filter(unit=>unit.ownerId===ownerId);
    assert.deepEqual(fleet.map(unit=>unit.asset.ship_type.code).sort(),['BB','CA','CL','CV','CVL','DD']);
    assert.equal(new Set(fleet.map(unit=>`${unit.col},${unit.row}`)).size,6);
  }
  assert.equal(new Set(m.units.map(unit=>`${unit.col},${unit.row}`)).size,12);
  assert(m.units.filter(unit=>unit.ownerId===1).every(unit=>m.reachable(unit.instanceId).some(cell=>cell.col!==unit.col||cell.row!==unit.row)),'the test fleet should not start boxed in by friendly ships');
  const saved=m.save();assert.equal(saved.version,25);assert.equal(saved.mapKind,'test-5x10');assert.equal(saved.size,5);assert.equal(saved.height,10);
  assert.deepEqual(Match.load(saved,assets).save(),saved);
  assert.throws(()=>new Match(world,assets,3),/只支持双方/);
});

check('Enemy harbor capture starts a siege and takes two rounds to complete',()=>{
  const m=scene(),port=m.port('home-2'),occupier=placeAtPort(m,'team-1-lafei',port.id);
  m.units.filter(u=>u.ownerId===2).forEach(sink);
  m.capturePort(occupier.instanceId,port.id);
  assert.equal(port.ownerId,2);assert.equal(port.occupationOwnerId,1);assert.equal(port.occupationProgress,0);
  const pending=m.save(),restored=Match.load(pending,assets);assert.deepEqual(restored.save(),pending);
  finishRound(m);assert.equal(port.occupationProgress,1);assert.equal(port.ownerId,2);
  finishRound(m);assert.equal(port.ownerId,1);assert.equal(port.occupationOwnerId,undefined);assert.equal(port.occupationProgress,0);
});

check('Enemy proximity or fire interrupts an enemy-harbor siege',()=>{
  {
    const m=scene(),port=m.port('home-2'),occupier=placeAtPort(m,'team-1-lafei',port.id),enemy=m.unit('team-2-lafei');
    m.units.filter(u=>u.ownerId===2&&u!==enemy).forEach(sink);sink(enemy);
    m.capturePort(occupier.instanceId,port.id);finishRound(m);assert.equal(port.occupationProgress,1);
    const contested=seaCellAtDistance(m,port,1);Object.assign(enemy,{...contested,status:'ready',hp:enemy.maxHp,action:1});finishRound(m);
    assert.equal(port.occupationOwnerId,undefined);assert.equal(port.occupationProgress,0);assert.equal(port.ownerId,2);
  }
  {
    const m=scene(),port=m.port('home-2'),occupier=placeAtPort(m,'team-1-lafei',port.id),target=m.unit('team-2-lafei');
    m.units.filter(u=>u.ownerId===2&&u!==target).forEach(sink);
    Object.assign(target,seaCellAtDistance(m,port,6),{status:'ready',hp:target.maxHp,action:1});
    m.capturePort(occupier.instanceId,port.id);finishRound(m);assert.equal(port.occupationProgress,1);assert.equal(m.phase,'aviation');m.activeIndex=0;m.phaseSubmitted=[];
    Object.assign(target,{...seaCellAtDistance(m,port,2),status:'ready',hp:target.maxHp,action:1});
    const hp=target.hp;m.orderAttack(occupier.instanceId,target.instanceId,'light-gun');
    assert.equal(occupier.firedThisTurn,true);assert.equal(port.occupationOwnerId,undefined);assert.equal(port.ownerId,2);
    assert.equal(target.hp,hp,'locked water attacks wait for shared combat resolution');
  }
});

check('Moving the occupying ship away clears pending enemy-harbor progress',()=>{
  const m=scene(),port=m.port('home-2'),occupier=placeAtPort(m,'team-1-lafei',port.id),enemy=m.unit('team-2-lafei');
  m.units.filter(u=>u.ownerId===2&&u!==enemy).forEach(sink);Object.assign(enemy,seaCellAtDistance(m,port,6),{status:'ready',hp:enemy.maxHp,action:1});
  m.capturePort(occupier.instanceId,port.id);finishRound(m);
  assert.equal(port.occupationProgress,1);assert.equal(m.phase,'aviation');m.activeIndex=0;m.phaseSubmitted=[];
  const destination=seaCellAtDistance(m,port,2);
  m.issueMove(occupier.instanceId,destination);assert.equal(port.occupationOwnerId,1);m.endTurn();assert.equal(m.active.id,2);m.endTurn();assert.equal(m.phase,'aviation');assert.equal(port.occupationOwnerId,undefined);assert.equal(port.occupationProgress,0);
});

check('Neutral harbors remain immediate captures',()=>{
  const m=scene(),port=m.ports.find(p=>p.ownerId===0)!,occupier=placeAtPort(m,'team-1-lafei',port.id);
  m.capturePort(occupier.instanceId,port.id);assert.equal(port.ownerId,1);assert.equal(port.occupationOwnerId,undefined);
});

check('V2 sight uses each ship profile while classic sight remains six hexes',()=>{
  const m=scene(),battleship=m.unit('team-1-bisimai'),destroyer=m.unit('team-1-lafei'),enemy=m.unit('team-2-lafei');
  m.units.filter(u=>u!==battleship&&u!==destroyer&&u!==enemy).forEach(sink);
  const home=m.port('home-1'),origin={col:home.col,row:home.row};
  Object.assign(battleship,origin,{status:'ready',hp:battleship.maxHp});Object.assign(destroyer,{status:'sunk',hp:0});
  const ring2=seaCellAtDistance(m,origin,2),ring3=seaCellAtDistance(m,origin,3);Object.assign(enemy,ring3,{status:'ready',hp:enemy.maxHp});m.refreshVision();
  assert.equal(m.fog.state(1,ring2),2);assert(!m.canSee(1,ring3));
  Object.assign(battleship,{status:'sunk',hp:0});const ring4=seaCellAtDistance(m,origin,4);Object.assign(destroyer,origin,{status:'ready',hp:destroyer.maxHp});m.refreshVision();
  assert.equal(m.fog.state(1,ring4),2);
  m.rulesetId='classic-v1';m.refreshVision();assert.equal(m.fog.state(1,seaCellAtDistance(m,origin,5)),2);
});

check('V2 executes one side move before handover and stops short of an occupied goal',()=>{
  const m=scene(),friendly=m.unit('team-1-lafei'),enemy=m.unit('team-2-lafei');
  m.units.filter(u=>u!==friendly&&u!==enemy).forEach(sink);
  const {target,starts}=seaConflictCells(m);
  Object.assign(friendly,starts[0],{status:'ready',hp:friendly.maxHp,movedThisTurn:false,movementUsed:0});
  Object.assign(enemy,starts[1],{status:'ready',hp:enemy.maxHp,movedThisTurn:false,movementUsed:0});m.refreshVision();
  const friendStart={col:friendly.col,row:friendly.row},enemyStart={col:enemy.col,row:enemy.row};
  assert.deepEqual(m.issueMove(friendly.instanceId,target),[]);assert.deepEqual({col:friendly.col,row:friendly.row},friendStart);
  const events=m.endTurn();assert.equal(m.active.id,2);assert.equal(events.length,1);assert.deepEqual({col:friendly.col,row:friendly.row},target);
  assert.deepEqual(m.reachable(enemy.instanceId).some(cell=>cell.col===target.col&&cell.row===target.row),false);
  const enemyRoute=m.route(enemy.instanceId,target);assert(enemyRoute);const enemyDestination=enemyRoute.cells.at(-1)!;assert.notDeepEqual(enemyDestination,target);
  m.issueMove(enemy.instanceId,target);assert.deepEqual({col:enemy.col,row:enemy.row},enemyStart);
  const enemyEvents=m.endTurn();assert.equal(m.round,2);assert.deepEqual({col:enemy.col,row:enemy.row},enemyDestination);assert(enemyEvents.some(event=>event.instanceId===enemy.instanceId));
  m.endTurn();assert.equal(m.phase,'aviation');assert.equal(m.round,2);
  assert.deepEqual({col:friendly.col,row:friendly.row},target);
  assert.equal(friendly.movementUsed,0);assert.equal(enemy.movementUsed,0);
});

check('V2 combines carrier launch and ship movement in one side turn, then immediately hands over',()=>{
  const m=new Match(new HexWorld(128),assets,2),carrier=m.unit('team-1-qiye'),mover=m.unit('team-1-lafei');
  const destination=m.reachable(mover.instanceId).find(cell=>cell.col!==mover.col||cell.row!==mover.row);
  assert(destination,'the destroyer should have a reachable move');
  const start={col:mover.col,row:mover.row};
  assert.deepEqual(orderCarrierLaunch(m,carrier.instanceId),[0,1]);
  assert.equal(carrier.action,0,'the launch command reserves this carrier action');
  m.issueMove(mover.instanceId,destination);
  assert.equal(m.phase,'aviation');assert.deepEqual({col:mover.col,row:mover.row},start);assert.equal(m.aviation.squadrons.length,0);
  const pending=m.save();assert.deepEqual(Match.load(pending,assets).save(),pending);
  const firstEvents=m.endTurn();assert.equal(m.active.id,2);assert.equal(m.aviation.squadrons.length,2);
  assert.deepEqual({col:mover.col,row:mover.row},destination);assert(firstEvents.some(event=>event.instanceId===mover.instanceId));
  const opposing= m.unit('team-2-lafei'),enemyCell=m.reachable(opposing.instanceId).find(cell=>cell.col!==opposing.col||cell.row!==opposing.row);
  assert(enemyCell);m.issueMove(opposing.instanceId,enemyCell);
  const events=m.endTurn();assert.equal(m.phase,'aviation');assert.equal(m.round,2);assert.equal(m.aviation.squadrons.length,2);
  assert.deepEqual({col:opposing.col,row:opposing.row},enemyCell);assert(events.some(event=>event.instanceId===opposing.instanceId));
});

check('V2 planned routes survive a save and resolve on that side turn before handover',()=>{
  const m=scene(),mover=m.unit('team-1-lafei'),other=m.unit('team-2-lafei');
  m.units.filter(u=>u!==mover&&u!==other).forEach(sink);
  const destination=seaCellAtDistance(m,mover,3),start={col:mover.col,row:mover.row};m.refreshVision();
  m.issueMove(mover.instanceId,destination);assert.deepEqual({col:mover.col,row:mover.row},start);
  const snapshot=m.save(),restored=Match.load(snapshot,assets);
  assert.equal(restored.phase,'aviation');assert.deepEqual(restored.phaseSubmitted,[]);assert.deepEqual(restored.plannedMove(mover.instanceId),destination);assert.deepEqual(restored.save(),snapshot);
  const events=m.endTurn();assert.equal(m.active.id,2);assert.equal(m.round,1);assert.equal(events.length,1);assert.equal(events[0].instanceId,mover.instanceId);
  assert.deepEqual({col:mover.col,row:mover.row},destination);assert(m.movementUsed(mover)>0);assert.equal(mover.movedThisTurn,true);assert.deepEqual(m.phaseSubmitted,[1]);
  m.endTurn();assert.equal(m.round,2);assert.equal(m.movementUsed(mover),0);assert.equal(mover.movedThisTurn,false);assert.deepEqual(m.phaseSubmitted,[]);
});

check('A planned ship can revise or cancel its route before executing one move',()=>{
  const m=scene(),mover=m.unit('team-1-lafei'),other=m.unit('team-2-lafei');
  m.units.filter(unit=>unit!==mover&&unit!==other).forEach(sink);m.refreshVision();
  const start={col:mover.col,row:mover.row},destinations=m.reachable(mover.instanceId).filter(cell=>cell.col!==mover.col||cell.row!==mover.row);
  assert(destinations.length>=2,'the ship should have at least two reachable destinations');
  const [first,second]=[destinations[0],destinations[destinations.length-1]];
  m.issueMove(mover.instanceId,first);assert.equal(m.movementOrders.length,1);assert(mover.movedThisTurn);
  assert(m.reachable(mover.instanceId).some(cell=>cell.col===second.col&&cell.row===second.row),'a planned ship should still show legal destinations for replanning');
  m.issueMove(mover.instanceId,second);assert.deepEqual(m.plannedMove(mover.instanceId),second);assert.equal(m.movementOrders.length,1);
  assert.deepEqual({col:mover.col,row:mover.row},start,'editing the route must not move the ship before handover');
  assert.throws(()=>m.issueMove(mover.instanceId,{col:128,row:128}));assert.deepEqual(m.plannedMove(mover.instanceId),second,'an invalid replacement must preserve the previous route');
  m.cancelMove(mover.instanceId);assert.equal(m.plannedMove(mover.instanceId),undefined);assert.equal(mover.movedThisTurn,false);
  m.issueMove(mover.instanceId,second);const events=m.endTurn();
  assert.equal(m.active.id,2);assert.deepEqual({col:mover.col,row:mover.row},second);assert.equal(events.filter(event=>event.instanceId===mover.instanceId).length,1);
});

check('A remote or uncharted click plans the closest reachable move toward it',()=>{
  const m=scene(),mover=m.unit('team-1-lafei');m.units.filter(unit=>unit!==mover&&unit.ownerId===1).forEach(sink);m.refreshVision();
  const target=seaCellAtDistance(m,mover,9);assert.equal(m.isExplored(1,target),false,'the distant destination should be uncharted');
  const route=m.route(mover.instanceId,target);assert(route&&route.cost>0&&route.cost<=m.movementLimit(mover));
  const endpoint=route.cells.at(-1)!;assert(m.isExplored(1,endpoint));assert(hexDistance(endpoint,target)<hexDistance(mover,target));
  m.issueMove(mover.instanceId,target);assert.deepEqual(m.plannedMove(mover.instanceId),endpoint,'the order should store the actual one-turn destination');
});

check('All V2 sea terrain costs one movement point, including shallow water',()=>{
  for(const id of ['team-1-lafei','team-1-hailunna','team-1-gaoxiong','team-1-yanzhan','team-1-qiye','team-1-dujiaoshou']){
    const world=new HexWorld(5,10,'test-5x10'),m=new Match(world,assets,2),ship=m.unit(id);world.terrain.fill(Terrain.Shallow);
    m.units.filter(unit=>unit!==ship).forEach(sink);m.refreshVision();
    const route=m.reachable(ship.instanceId).map(target=>m.route(ship.instanceId,target)).find(candidate=>candidate&&candidate.cost>0);
    assert(route,`${ship.asset.ship_type.code} should have a reachable shallow-water route`);
    assert(route.cost<=m.movementLimit(ship));assert.equal(route.cost,route.cells.length-1);assert(route.costs.every((cost,index)=>cost===Number(index>0)));
  }
});

check('Each side acts once per turn and port supply is automatic at round rollover',()=>{
  const m=scene(),before=m.teams.map(team=>team.supply);
  m.endTurn();assert.equal(m.active.id,2);assert.equal(m.round,1);assert.deepEqual(m.teams.map(team=>team.supply),before);
  m.endTurn();assert.equal(m.active.id,2);assert.equal(m.round,2);
  for(const team of m.teams){const ports=m.ports.filter(port=>port.ownerId===team.id).length;assert.equal(team.supply,Math.min(8,before[team.id-1]+ports));}
});

check('A planned route and ship attack execute together before the next side acts',()=>{
  const m=scene(),attacker=m.unit('team-1-bisimai'),target=m.unit('team-2-lafei');
  m.units.filter(unit=>unit!==attacker&&unit!==target&&unit.instanceId!=='team-2-bisimai').forEach(sink);
  const destination=m.reachable(attacker.instanceId).find(cell=>hexDistance(cell,attacker)>=1);
  assert(destination,'the battleship should have a reachable destination');
  const targetCell=seaCellAtDistance(m,destination,2);
  Object.assign(target,targetCell,{status:'ready',hp:target.maxHp,action:1});m.refreshVision();
  const start={col:attacker.col,row:attacker.row};
  assert(m.attackPreview(attacker.instanceId,target.instanceId,'main-gun').valid,'attack preview should use the planned end position');
  m.issueMove(attacker.instanceId,destination);m.orderAttack(attacker.instanceId,target.instanceId,'main-gun');
  assert.deepEqual({col:attacker.col,row:attacker.row},start);assert.equal(m.movementOrders.length,1);assert.equal(m.combatOrders.length,1);
  m.endTurn();assert.equal(m.active.id,2);assert.deepEqual({col:attacker.col,row:attacker.row},destination);
  assert.equal(m.takeResolvedCombatEvents().length,1,'the queued attack resolves in the same side turn as movement');
});

check('Group movement gives ships separate routes while showing one representative arrow',()=>{
  const m=scene(),first=m.unit('team-1-lafei'),second=m.unit('team-1-bisimai');
  m.units.filter(unit=>unit!==first&&unit!==second).forEach(sink);
  const origin={col:first.col,row:first.row},target=seaCellAtDistance(m,origin,3);
  const occupied=new Set(m.units.filter(unit=>unit.status!=='sunk'&&unit!==first&&unit!==second).map(unit=>`${unit.col},${unit.row}`));
  const starts=[seaCellAtDistance(m,target,3,occupied)];occupied.add(`${starts[0].col},${starts[0].row}`);starts.push(seaCellAtDistance(m,target,3,occupied));
  Object.assign(first,starts[0],{status:'ready',hp:first.maxHp,movedThisTurn:false,movementUsed:0});
  Object.assign(second,starts[1],{status:'ready',hp:second.maxHp,movedThisTurn:false,movementUsed:0});m.refreshVision();
  const issued=m.issueGroupMove([first.instanceId,second.instanceId],target);
  assert.equal(issued.assigned,2);assert.equal(m.movementOrders.length,2);
  assert.notDeepEqual(m.movementOrders[0].target,m.movementOrders[1].target,'each ship gets its own unoccupied destination');
  for(const order of m.movementOrders)assert(hexDistance(order.target,target)<hexDistance(m.unit(order.unitId),target),'each ship should move closer to the shared destination');
  const [a,b]=m.movementOrders;assert(a.groupId&&a.groupId===b.groupId);assert.equal([a,b].filter(order=>order.groupAnchor).length,1);
  const shown=m.displayMovementOrders(1);assert.equal(shown.length,1);assert.equal(shown[0].groupAnchor,true);
  assert.equal(m.displayMovementOrders(2).length,0,'the opposing side cannot see the active side planning route');
  const expected=[first,second].sort((left,right)=>hexDistance(left,issued.source)-hexDistance(right,issued.source)||left.instanceId.localeCompare(right.instanceId))[0];
  assert.equal(shown[0].unitId,expected.instanceId,'the single displayed route belongs to the ship closest to the formation center');
  const pending=m.save();assert.deepEqual(Match.load(pending,assets).save(),pending,'group routes retain their single visible anchor in saves');
  m.cancelMove(shown[0].unitId);assert.equal(m.movementOrders.length,0);assert(!first.movedThisTurn&&!second.movedThisTurn);
});

check('Replanning one ship from a group keeps its teammates routes as individual orders',()=>{
  const m=scene(),first=m.unit('team-1-lafei'),second=m.unit('team-1-bisimai'),origin={col:first.col,row:first.row},target=seaCellAtDistance(m,origin,3);
  m.units.filter(unit=>unit!==first&&unit!==second).forEach(sink);
  const occupied=new Set(m.units.filter(unit=>unit.status!=='sunk'&&unit!==first&&unit!==second).map(unit=>`${unit.col},${unit.row}`));
  const starts=[seaCellAtDistance(m,target,3,occupied)];occupied.add(`${starts[0].col},${starts[0].row}`);starts.push(seaCellAtDistance(m,target,3,occupied));
  Object.assign(first,starts[0],{status:'ready',hp:first.maxHp,movedThisTurn:false,movementUsed:0});
  Object.assign(second,starts[1],{status:'ready',hp:second.maxHp,movedThisTurn:false,movementUsed:0});m.refreshVision();
  assert.equal(m.issueGroupMove([first.instanceId,second.instanceId],target).assigned,2);
  const anchorOrder=m.movementOrders.find(order=>order.groupAnchor)!;
  const otherOrder=m.movementOrders.find(order=>order.unitId!==anchorOrder.unitId)!;
  const anchor=m.unit(anchorOrder.unitId),other=m.unit(otherOrder.unitId),otherTarget={...otherOrder.target};
  const destination=m.reachable(anchor.instanceId).find(cell=>(cell.col!==anchor.col||cell.row!==anchor.row)&&(cell.col!==otherTarget.col||cell.row!==otherTarget.row));
  assert(destination,'the group anchor should have an alternate route');
  m.issueMove(anchor.instanceId,destination);
  assert.deepEqual(m.plannedMove(anchor.instanceId),destination);assert.deepEqual(m.plannedMove(other.instanceId),otherTarget);
  assert.equal(m.movementOrders.length,2);assert(m.movementOrders.every(order=>!order.groupId));
  assert.deepEqual(Match.load(m.save(),assets).save(),m.save(),'individualized group routes should remain valid in saves');
  m.cancelMove(anchor.instanceId);assert.equal(m.movementOrders.length,1);assert.deepEqual(m.plannedMove(other.instanceId),otherTarget);assert(other.movedThisTurn);
});

check('V2 water attacks resolve for each side on its own turn and remain deterministic across saves',()=>{
  const m=scene(),blue=m.units.find(u=>u.ownerId===1&&u.asset.ship_type.code==='BB')!,green=m.units.find(u=>u.ownerId===2&&u.asset.ship_type.code==='BB')!;
  const blueReserve=m.unit('team-1-lafei'),greenReserve=m.unit('team-2-lafei');
  m.units.filter(u=>u!==blue&&u!==green&&u!==blueReserve&&u!==greenReserve).forEach(sink);
  const origin={col:m.port('home-1').col,row:m.port('home-1').row},targetCell=seaCellAtDistance(m,origin,2);
  Object.assign(blue,origin,{status:'ready',hp:blue.maxHp,action:1,guard:false,movementUsed:0,movedThisTurn:false,firedThisTurn:false});
  Object.assign(green,targetCell,{status:'ready',hp:green.maxHp,action:1,guard:false,movementUsed:0,movedThisTurn:false,firedThisTurn:false});m.refreshVision();
  let seed=1;
  for(;seed<10000;seed++){
    let state=seed,hits=true;
    for(let shot=0;shot<2;shot++){const a=rollDieV2(state);state=a.state;const b=rollDieV2(state);state=b.state;const total=a.die+b.die;if(total!==12&&total!==2&&total+1<7)hits=false;}
    if(hits)break;
  }
  assert(seed<10000,'a deterministic seed should produce two hits');m.combatState=seed;
  assert.throws(()=>m.attack(blue.instanceId,green.instanceId,'main-gun'),/须先规划/);
  m.orderAttack(blue.instanceId,green.instanceId,'main-gun');assert.equal(green.hp,green.maxHp);assert.equal(blue.action,0);
  assert.throws(()=>m.orderAttack(blue.instanceId,green.instanceId,'main-gun'),/作战行动/);
  m.endTurn();assert.equal(m.active.id,2);const firstEvents=m.takeResolvedCombatEvents();assert.equal(firstEvents.length,1);assert(firstEvents[0].hit&&!firstEvents[0].sunk);
  const snapshot=m.save(),restored=Match.load(snapshot,assets);assert.deepEqual(restored.save(),snapshot);
  assert.equal(restored.plannedAttack(blue.instanceId),undefined);assert.equal(restored.unit(green.instanceId).hp,green.hp);assert(green.hp<green.maxHp);
  restored.orderAttack(green.instanceId,blue.instanceId,'main-gun');restored.endTurn();
  m.orderAttack(green.instanceId,blue.instanceId,'main-gun');m.endTurn();
  const events=m.takeResolvedCombatEvents(),restoredEvents=restored.takeResolvedCombatEvents();
  assert.deepEqual(events,restoredEvents);assert.equal(events.length,1);assert.equal(events[0].attackerId,green.instanceId);
  assert(events[0].hit&&!events[0].sunk);assert.equal(blue.status,'ready');assert.equal(green.status,'ready');assert.equal(m.combatOrders.length,0);
});

check('V2 AI uses the same turn commands and resolves them before handing over',()=>{
  const m=new Match(new HexWorld(128),assets,2,['ai','human']);
  const before=new Map(m.units.map(unit=>[unit.instanceId,{col:unit.col,row:unit.row}]));
  const report=executeAiTurn(m);
  assert.deepEqual(report.moves,[]);assert(m.movementOrders.length>0);
  assert(m.units.every(unit=>unit.col===before.get(unit.instanceId)!.col&&unit.row===before.get(unit.instanceId)!.row));
  m.endTurn();assert.equal(m.active.id,2);assert.deepEqual(m.phaseSubmitted,[1]);assert.equal(m.movementOrders.length,0);
  assert(m.units.some(unit=>unit.ownerId===1&&JSON.stringify({col:unit.col,row:unit.row})!==JSON.stringify(before.get(unit.instanceId))));
});

check('V2 AI can launch aircraft and move ships in the same turn',()=>{
  const m=new Match(new HexWorld(128),assets,2,['ai','human']),report=executeAiTurn(m);
  assert.equal(report.launched,3);assert.equal(m.aviationOrders.length,2);assert(m.movementOrders.length>0);assert.equal(m.aviation.squadrons.length,0);
  const before=m.save();assert.deepEqual(Match.load(before,assets).save(),before);
  m.endTurn();assert.equal(m.active.id,2);assert.equal(m.round,1);assert.equal(m.aviationOrders.length,0);assert.equal(m.movementOrders.length,0);assert.equal(m.aviation.squadrons.length,3);
});

check('V2 AI attacks resolve immediately when its side ends the turn',()=>{
  const m=new Match(new HexWorld(128),assets,2,['ai','human']),attacker=m.unit('team-1-lafei'),target=m.unit('team-2-lafei');
  m.units.filter(unit=>unit!==attacker&&unit!==target).forEach(sink);
  const targetCell=seaCellAtDistance(m,attacker,2);Object.assign(target,targetCell,{status:'ready',hp:target.maxHp,action:1});m.refreshVision();
  const hp=target.hp,report=executeAiTurn(m);assert.equal(report.combats.length,0);assert.equal(target.hp,hp);assert.equal(m.combatOrders.length,1);
  m.endTurn();const events=m.takeResolvedCombatEvents();assert.equal(m.active.id,2);assert.equal(events.length,1);assert.equal(events[0].attackerId,attacker.instanceId);
});

check('V2 carrier launch resolves on its side turn and recovery preserves a full turnaround round',()=>{
  const m=scene(),carrier=m.unit('team-1-qiye');m.phase='aviation';const preview=launchPreview(m,carrier.instanceId);
  assert.deepEqual(preview.slots,[0,1]);assert.equal(preview.operationsLimit,2);assert.equal(preview.operationsUsed,0);
  assert.deepEqual(orderCarrierLaunch(m,carrier.instanceId),[0,1]);assert.equal(m.aviation.squadrons.length,0,'aircraft appear after this side implements its orders');
  assert.equal(carrier.action,0);cancelCarrierLaunch(m,carrier.instanceId);assert.equal(carrier.action,1);assert(launchPreview(m,carrier.instanceId).valid,'launch orders can be withdrawn before phase submission');orderCarrierLaunch(m,carrier.instanceId);
  const pending=m.save();assert.equal(pending.version,25);assert.equal(pending.phase,'aviation');assert.deepEqual(pending.aviationOrders[0].slots,[0,1]);assert.deepEqual(Match.load(pending,assets).save(),pending);
  m.endTurn();assert.equal(m.active.id,2);assert.equal(m.round,1);const launched=m.aviation.squadrons.filter(s=>s.carrierId===carrier.instanceId),deck=m.aviation.decks[carrier.instanceId];assert.deepEqual(launched.map(s=>s.role),['fighter','bomber']);
  assert.deepEqual(deck.squadrons.map(s=>s.status),['airborne','airborne','reserve']);assert.equal(deck.operationsUsed,2,'launches spend this carrier turn deck operations');
  m.endTurn();assert.equal(m.phase,'aviation');assert.equal(m.round,2);assert.equal(deck.operationsUsed,0,'deck operations reset at the global round boundary');
  const fighter=launched[0];Object.assign(fighter,cellCenter(carrier),{order:'return',flight:undefined});m.activeIndex=0;tickAviation(m,.1);
  assert(!m.aviation.squadrons.includes(fighter));assert.equal(deck.operationsUsed,1);assert.equal(deck.squadrons[0].status,'turnaround');assert.equal(deck.squadrons[0].readyRound,4);
  const saved=m.save(),restored=Match.load(saved,assets);assert.deepEqual(restored.save(),saved);
  restored.round=3;beginAviationRound(restored);assert.equal(restored.aviation.decks[carrier.instanceId].squadrons[0].status,'turnaround');
  restored.round=4;beginAviationRound(restored);assert.equal(restored.aviation.decks[carrier.instanceId].squadrons[0].status,'ready');
});

check('V2 aircraft losses permanently remove the deck squadron and survive save restoration',()=>{
  const m=scene(),carrier=m.unit('team-1-qiye'),fighter=launchV2(m,carrier.instanceId)[0];fighter.hp=0;tickAviation(m,.1);
  assert(!m.aviation.squadrons.some(s=>s.id===fighter.id));assert.equal(m.aviation.decks[carrier.instanceId].squadrons[fighter.slot].status,'lost');
  const saved=m.save();assert.deepEqual(Match.load(saved,assets).save(),saved);
  const invalid=JSON.parse(JSON.stringify(saved));invalid.aviation.decks[carrier.instanceId].squadrons[fighter.slot].status='airborne';
  assert.throws(()=>Match.load(invalid,assets),'a deck cannot retain an airborne slot after its squadron is destroyed');
});

check('V2 contact reports hide L2 ship identity, expose L3 identity, and decay stale reports',()=>{
  const m=scene(),port=m.port('home-1'),origin={col:port.col,row:port.row},spotter=m.unit('team-1-lafei'),enemy=m.units.find(u=>u.ownerId===2&&u.asset.ship_type.code==='BB')!;
  m.units.filter(u=>u!==spotter&&u!==enemy).forEach(sink);
  Object.assign(spotter,origin,{status:'ready',hp:spotter.maxHp,action:1});
  const lastReport=seaCellAtDistance(m,origin,3);Object.assign(enemy,lastReport,{status:'ready',hp:enemy.maxHp});m.refreshVision();
  let report=m.contactsFor(1).find(c=>c.key===enemy.instanceId)!;
  assert.equal(report.level,2);assert.equal(report.sizeClass,'large');assert.equal(report.shipType,undefined);assert(!m.unitVisible(enemy));
  const saved=m.save();assert.deepEqual(Match.load(saved,assets).save(),saved);
  assert(!m.attackPreview(spotter.instanceId,enemy.instanceId,'light-gun').valid);
  Object.assign(enemy,seaCellAtDistance(m,origin,2),{hp:enemy.maxHp});m.refreshVision();report=m.contactsFor(1).find(c=>c.key===enemy.instanceId)!;
  assert.equal(report.level,3);assert.equal(report.shipType,'BB');assert(m.unitVisible(enemy));assert(m.attackPreview(spotter.instanceId,enemy.instanceId,'light-gun').valid);
  Object.assign(enemy,lastReport);m.refreshVision();assert(!m.unitVisible(enemy));
  const hidden=seaCellAtDistance(m,origin,10);Object.assign(enemy,hidden);m.refreshVision();finishRound(m);
  report=m.contactsFor(1).find(c=>c.key===enemy.instanceId)!;assert.equal(report.level,2);assert.equal(report.age,0);
  finishRound(m);
  report=m.contactsFor(1).find(c=>c.key===enemy.instanceId)!;assert.equal(report.level,1);assert.equal(report.age,1);assert.equal(report.shipType,undefined);
  finishRound(m);assert(!m.contactsFor(1).some(c=>c.key===enemy.instanceId));
});

check('V2 alert posture no longer applies the legacy flat two-damage air reduction',()=>{
  const m=scene(),carrier=m.unit('team-1-qiye'),target=m.unit('team-2-qiye');
  const origin=m.port('home-1');Object.assign(carrier,{col:origin.col,row:origin.row,status:'ready',hp:carrier.maxHp,action:1});
  Object.assign(target,seaCellAtDistance(m,origin,3),{status:'ready',hp:target.maxHp,guard:true});
  const bomber=launchV2(m,carrier.instanceId).find(s=>s.role==='bomber')!;
  const guarded=m.airDamage(bomber,target.instanceId).damage;target.hp=target.maxHp;target.guard=false;
  const unguarded=m.airDamage(bomber,target.instanceId).damage;assert.equal(guarded,unguarded);assert.equal(guarded,4);
  m.rulesetId='classic-v1';m.active.oil=50;target.hp=target.maxHp;target.guard=true;
  assert.equal(m.airDamage(bomber,target.instanceId).damage,2);
});

check('Legacy V2 saves migrate to version 25 and previously submitted orders resolve once',()=>{
  const m=scene(),current:any=m.save();
  for(const version of [16,17]){
    const raw=JSON.parse(JSON.stringify(current));raw.version=version;delete raw.contacts;
    if(version===16){for(const unit of raw.units)delete unit.firedThisTurn;for(const port of raw.campaign.ports){delete port.occupationOwnerId;delete port.occupationProgress;}}
    const restored=Match.load(raw,assets);assert.equal(restored.save().version,25);assert(restored.units.every(u=>u.firedThisTurn===false));
  }
  const legacy18=JSON.parse(JSON.stringify(current));legacy18.version=18;legacy18.activeIndex=1;
  delete legacy18.phase;delete legacy18.initiativeIndex;delete legacy18.phaseSubmitted;delete legacy18.movementOrders;
  const alreadyMoved=legacy18.units.find((u:any)=>u.instanceId==='team-1-lafei');alreadyMoved.movedThisTurn=true;alreadyMoved.movementUsed=1;
  const restored18=Match.load(legacy18,assets),position={col:restored18.unit('team-1-lafei').col,row:restored18.unit('team-1-lafei').row};
  assert.equal(restored18.phase,'aviation');assert.deepEqual(restored18.phaseSubmitted,[1]);assert.deepEqual({col:restored18.unit('team-1-lafei').col,row:restored18.unit('team-1-lafei').row},position);
  restored18.endTurn();assert.equal(restored18.phase,'aviation');assert.equal(restored18.round,2);assert.deepEqual({col:restored18.unit('team-1-lafei').col,row:restored18.unit('team-1-lafei').row},position);
  const legacy19=JSON.parse(JSON.stringify(current));legacy19.version=19;legacy19.phase='combat';delete legacy19.combatOrders;
  assert.equal(Match.load(legacy19,assets).save().version,25);
  const legacy20=JSON.parse(JSON.stringify(current));legacy20.version=20;legacy20.phase='combat';delete legacy20.aviation.decks;
  assert.equal(Match.load(legacy20,assets).save().version,25);
  const legacy21=JSON.parse(JSON.stringify(current));legacy21.version=21;legacy21.phase='combat';delete legacy21.aviationOrders;
  assert.equal(Match.load(legacy21,assets).save().version,25);
  const oldTurn=scene(),oldUnit=oldTurn.unit('team-1-lafei'),oldDestination=oldTurn.reachable(oldUnit.instanceId).find(cell=>cell.col!==oldUnit.col||cell.row!==oldUnit.row)!;
  oldTurn.issueMove(oldUnit.instanceId,oldDestination);const submitted:any=oldTurn.save();submitted.version=23;submitted.activeIndex=1;submitted.phaseSubmitted=[1];
  const migrated=Match.load(submitted,assets);assert.equal(migrated.active.id,2);assert.equal(migrated.round,1);assert.deepEqual(migrated.phaseSubmitted,[1]);
  assert.deepEqual({col:migrated.unit(oldUnit.instanceId).col,row:migrated.unit(oldUnit.instanceId).row},oldDestination);assert.equal(migrated.movementOrders.length,0);
  const queued=scene(),carrier=queued.unit('team-1-qiye'),attacker=queued.unit('team-1-bisimai'),target=queued.unit('team-2-lafei');
  const launchSlots=orderCarrierLaunch(queued,carrier.instanceId),destination=queued.reachable(attacker.instanceId).find(cell=>hexDistance(cell,attacker)>0)!;
  const targetCell=seaCellAtDistance(queued,destination,2);Object.assign(target,targetCell,{status:'ready',hp:target.maxHp,action:1});queued.refreshVision();
  queued.issueMove(attacker.instanceId,destination);queued.orderAttack(attacker.instanceId,target.instanceId,'main-gun');
  let criticalSeed=1;for(;criticalSeed<100000;criticalSeed++){const first=rollDieV2(criticalSeed),second=rollDieV2(first.state);if(first.die===6&&second.die===6)break;}
  assert(criticalSeed<100000);queued.combatState=criticalSeed;
  const legacyBatch:any=queued.save();legacyBatch.version=23;legacyBatch.activeIndex=1;legacyBatch.phaseSubmitted=[1];legacyBatch.units.find((unit:any)=>unit.instanceId===carrier.instanceId).action=1;
  for(const order of legacyBatch.movementOrders){const unit=queued.unit(order.unitId);order.costs=order.cells.map((cell:any,index:number)=>index===0?0:queued.world.at(cell)===Terrain.Shallow&&!['DD','CL'].includes(unit.asset.ship_type.code)?2:1);}
  const batchMigrated=Match.load(legacyBatch,assets),resolvedHp=batchMigrated.unit(target.instanceId).hp;
  assert.equal(batchMigrated.active.id,2);assert.deepEqual(batchMigrated.phaseSubmitted,[1]);assert.equal(batchMigrated.aviation.squadrons.filter(s=>s.carrierId===carrier.instanceId).length,launchSlots.length);
  assert.deepEqual({col:batchMigrated.unit(attacker.instanceId).col,row:batchMigrated.unit(attacker.instanceId).row},destination);assert(resolvedHp<target.maxHp);assert.equal(batchMigrated.aviationOrders.length+batchMigrated.movementOrders.length+batchMigrated.combatOrders.length,0);
  const migratedAgain=Match.load(batchMigrated.save(),assets);assert.equal(migratedAgain.unit(target.instanceId).hp,resolvedHp);assert.equal(migratedAgain.aviation.squadrons.length,batchMigrated.aviation.squadrons.length);
  const oldMovement=scene(),battleship=oldMovement.unit('team-1-bisimai'),shallowRoute=oldMovement.reachable(battleship.instanceId).map(cell=>oldMovement.route(battleship.instanceId,cell)).find(route=>route&&route.cost>0&&route.cells.some((cell,index)=>index>0&&oldMovement.world.at(cell)===Terrain.Shallow));
  assert(shallowRoute,'the starting area should include a shallow-water route');oldMovement.issueMove(battleship.instanceId,shallowRoute.cells.at(-1)!);
  const version24:any=oldMovement.save();version24.version=24;
  for(const order of version24.movementOrders)order.costs=order.cells.map((cell:any,index:number)=>index===0?0:oldMovement.world.at(cell)===Terrain.Shallow&&!['DD','CL'].includes(battleship.asset.ship_type.code)?2:1);
  const migratedMovement=Match.load(version24,assets);assert.equal(migratedMovement.save().version,25);assert(migratedMovement.movementOrders[0].costs.slice(1).every(cost=>cost===1),'old shallow-water surcharges should be removed during migration');
  const oldLaunch=scene(),oldCarrier=oldLaunch.unit('team-1-qiye');orderCarrierLaunch(oldLaunch,oldCarrier.instanceId);
  const version24Launch:any=oldLaunch.save();version24Launch.version=24;version24Launch.units.find((unit:any)=>unit.instanceId===oldCarrier.instanceId).action=1;
  const migratedLaunch=Match.load(version24Launch,assets);assert.equal(migratedLaunch.unit(oldCarrier.instanceId).action,0,'an older queued launch should reserve its action after migration');
  const restored=Match.load(current,assets),invalid=restored.save() as any,port=invalid.campaign.ports.find((p:any)=>p.id==='home-2');port.occupationProgress=1;
  assert.throws(()=>Match.load(invalid,assets));
  const badContact=JSON.parse(JSON.stringify(current));badContact.contacts[0].push({unitId:'not-a-ship',ownerId:2,col:1,row:1,level:3,age:0,seenThisTurn:true,shipType:'BB',hpBand:'intact',sizeClass:'large'});
  assert.throws(()=>Match.load(badContact,assets));
  const badOrder=JSON.parse(JSON.stringify(current));badOrder.combatOrders.push({ownerId:1,attackerId:'not-a-ship',targetId:'team-2-lafei',weaponId:'light-gun',distance:1});
  assert.throws(()=>Match.load(badOrder,assets));
  const pending=scene();orderCarrierLaunch(pending,'team-1-qiye');
  const invalidLaunch=pending.save() as any;invalidLaunch.aviationOrders[0].slots=[2];assert.throws(()=>Match.load(invalidLaunch,assets));
  const invalidPhase=JSON.parse(JSON.stringify(current));invalidPhase.phase='combat';assert.throws(()=>Match.load(invalidPhase,assets));
});

console.log(JSON.stringify({passed:true,checks:checks.length,checks},null,2));
