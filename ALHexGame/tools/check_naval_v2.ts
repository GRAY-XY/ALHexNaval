import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Match,type MatchUnit} from '../src/match.ts';
import {executeAiTurn} from '../src/ai.ts';
import {beginAviationRound,cancelCarrierLaunch,launchPreview,orderCarrierLaunch,tickAviation} from '../src/aircraft.ts';
import {cellCenter,hexDistance,hexLine,neighbors} from '../src/hex.ts';
import {rollDieV2} from '../src/naval-rules-v2.ts';
import {HexWorld} from '../src/world.ts';
import {type Cell,type Roster} from '../src/types.ts';

const assets=(JSON.parse(readFileSync('data/roster.json','utf8')) as Roster).units;
const checks:string[]=[];
function check(name:string,fn:()=>void):void{fn();checks.push(name);}
function scene():Match{
  const match=new Match(new HexWorld(128),assets,2);match.phase='combat';return match;
}
function launchV2(match:Match,carrierId:string){match.phase='aviation';const slots=orderCarrierLaunch(match,carrierId);finishPhase(match);return match.aviation.squadrons.filter(s=>s.carrierId===carrierId&&slots.includes(s.slot));}
function finishPhase(m:Match):void{const phase=m.phase;let steps=0;while(m.phase===phase&&steps++<m.teams.length+1)m.endTurn();assert.notEqual(m.phase,phase,'phase should advance after every active team submits');}
function finishRound(m:Match):void{const round=m.round;let steps=0;while(m.round===round&&!m.result&&steps++<m.teams.length*3+2)m.endTurn();assert.ok(m.round>round||m.result,'round should resolve after all phase submissions');if(!m.result&&m.phase==='aviation')finishPhase(m);}
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
  const saved=m.save();assert.equal(saved.version,23);assert.equal(saved.mapKind,'test-5x10');assert.equal(saved.size,5);assert.equal(saved.height,10);
  assert.deepEqual(Match.load(saved,assets).save(),saved);
  assert.throws(()=>new Match(world,assets,3),/只支持双方/);
});

check('Enemy harbor capture starts a siege and takes two capturing-side end phases',()=>{
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
    m.units.filter(u=>u.ownerId===2&&u!==target).forEach(sink);sink(target);
    m.capturePort(occupier.instanceId,port.id);finishRound(m);assert.equal(port.occupationProgress,1);finishPhase(m);m.endTurn();
    Object.assign(target,{...seaCellAtDistance(m,port,2),status:'ready',hp:target.maxHp,action:1});
    const hp=target.hp;m.orderAttack(occupier.instanceId,target.instanceId,'light-gun');
    assert.equal(occupier.firedThisTurn,true);assert.equal(port.occupationOwnerId,undefined);assert.equal(port.ownerId,2);
    assert.equal(target.hp,hp,'locked water attacks wait for shared combat resolution');
  }
});

check('Moving the occupying ship away clears pending enemy-harbor progress',()=>{
  const m=scene(),port=m.port('home-2'),occupier=placeAtPort(m,'team-1-lafei',port.id);
  m.units.filter(u=>u.ownerId===2).forEach(sink);m.capturePort(occupier.instanceId,port.id);finishRound(m);
  assert.equal(port.occupationProgress,1);assert.equal(m.phase,'movement');m.endTurn();assert.equal(m.active.id,1);
  const destination=seaCellAtDistance(m,port,2);
  m.issueMove(occupier.instanceId,destination);assert.equal(port.occupationOwnerId,1);m.endTurn();assert.equal(m.phase,'combat');assert.equal(port.occupationOwnerId,undefined);assert.equal(port.occupationProgress,0);
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

check('V2 movement plans stay hidden until both sides submit; opposing ships contesting one cell both stop',()=>{
  const m=scene(),friendly=m.unit('team-1-lafei'),enemy=m.unit('team-2-lafei');m.phase='movement';
  m.units.filter(u=>u!==friendly&&u!==enemy).forEach(sink);
  const {target,starts}=seaConflictCells(m);
  Object.assign(friendly,starts[0],{status:'ready',hp:friendly.maxHp,movedThisTurn:false,movementUsed:0});
  Object.assign(enemy,starts[1],{status:'ready',hp:enemy.maxHp,movedThisTurn:false,movementUsed:0});m.refreshVision();
  const friendStart={col:friendly.col,row:friendly.row},enemyStart={col:enemy.col,row:enemy.row};
  assert.deepEqual(m.issueMove(friendly.instanceId,target),[]);assert.deepEqual({col:friendly.col,row:friendly.row},friendStart);
  m.endTurn();assert.equal(m.active.id,2);assert.deepEqual({col:friendly.col,row:friendly.row},friendStart);
  assert.deepEqual(m.issueMove(enemy.instanceId,target),[]);assert.deepEqual({col:enemy.col,row:enemy.row},enemyStart);
  const events=m.endTurn();assert.equal(m.phase,'combat');assert.deepEqual(events,[]);
  assert.deepEqual({col:friendly.col,row:friendly.row},friendStart);assert.deepEqual({col:enemy.col,row:enemy.row},enemyStart);
  assert.equal(friendly.movementUsed,0);assert.equal(enemy.movementUsed,0);
});

check('V2 committed routes survive a mid-planning save and resolve only after the final submission',()=>{
  const m=scene(),mover=m.unit('team-1-lafei'),other=m.unit('team-2-lafei');m.phase='movement';
  m.units.filter(u=>u!==mover&&u!==other).forEach(sink);
  const destination=seaCellAtDistance(m,mover,3),start={col:mover.col,row:mover.row};m.refreshVision();
  m.issueMove(mover.instanceId,destination);assert.deepEqual({col:mover.col,row:mover.row},start);
  m.endTurn();assert.equal(m.active.id,2);const snapshot=m.save(),restored=Match.load(snapshot,assets);
  assert.equal(restored.phase,'movement');assert.deepEqual(restored.phaseSubmitted,[1]);assert.deepEqual(restored.plannedMove(mover.instanceId),destination);assert.deepEqual(restored.save(),snapshot);
  const events=m.endTurn();assert.equal(m.phase,'combat');assert.equal(events.length,1);assert.equal(events[0].instanceId,mover.instanceId);
  assert.deepEqual({col:mover.col,row:mover.row},destination);assert(m.movementUsed(mover)>0);assert.deepEqual(m.phaseSubmitted,[]);
});

check('V2 water attacks persist as hidden orders and resolve simultaneously even when both attackers sink',()=>{
  const m=scene(),blue=m.units.find(u=>u.ownerId===1&&u.asset.ship_type.code==='BB')!,green=m.units.find(u=>u.ownerId===2&&u.asset.ship_type.code==='BB')!;
  m.units.filter(u=>u!==blue&&u!==green).forEach(sink);m.phase='combat';
  const origin={col:m.port('home-1').col,row:m.port('home-1').row},targetCell=seaCellAtDistance(m,origin,2);
  Object.assign(blue,origin,{status:'ready',hp:1,action:1,guard:false,movementUsed:0,movedThisTurn:false,firedThisTurn:false});
  Object.assign(green,targetCell,{status:'ready',hp:1,action:1,guard:false,movementUsed:0,movedThisTurn:false,firedThisTurn:false});m.refreshVision();
  let seed=1;
  for(;seed<10000;seed++){
    let state=seed,hits=true;
    for(let shot=0;shot<2;shot++){const a=rollDieV2(state);state=a.state;const b=rollDieV2(state);state=b.state;const total=a.die+b.die;if(total!==12&&total!==2&&total+1<7)hits=false;}
    if(hits)break;
  }
  assert(seed<10000,'a deterministic seed should produce two hits');m.combatState=seed;
  assert.throws(()=>m.attack(blue.instanceId,green.instanceId,'main-gun'),/须先锁定/);
  m.orderAttack(blue.instanceId,green.instanceId,'main-gun');assert.equal(green.hp,1);assert.equal(blue.action,0);
  assert.throws(()=>m.orderAttack(blue.instanceId,green.instanceId,'main-gun'),/作战行动/);
  m.endTurn();assert.equal(m.active.id,2);const snapshot=m.save(),restored=Match.load(snapshot,assets);assert.deepEqual(restored.save(),snapshot);
  assert.equal(restored.plannedAttack(blue.instanceId)?.targetId,green.instanceId);assert.equal(green.hp,1);
  restored.orderAttack(green.instanceId,blue.instanceId,'main-gun');restored.endTurn();
  m.orderAttack(green.instanceId,blue.instanceId,'main-gun');m.endTurn();
  const events=m.takeResolvedCombatEvents(),restoredEvents=restored.takeResolvedCombatEvents();
  assert.deepEqual(events,restoredEvents);assert.equal(events.length,2);assert.deepEqual(new Set(events.map(event=>event.attackerId)),new Set([blue.instanceId,green.instanceId]));
  assert(events.every(event=>event.hit&&event.sunk));assert.equal(blue.status,'sunk');assert.equal(green.status,'sunk');assert.equal(m.combatOrders.length,0);
});

check('V2 AI queues movement orders and waits for shared resolution',()=>{
  const m=new Match(new HexWorld(128),assets,2,['ai','human']);m.phase='movement';
  const before=new Map(m.units.map(unit=>[unit.instanceId,{col:unit.col,row:unit.row}]));
  const report=executeAiTurn(m);
  assert.deepEqual(report.moves,[]);assert(m.movementOrders.length>0);
  assert(m.units.every(unit=>unit.col===before.get(unit.instanceId)!.col&&unit.row===before.get(unit.instanceId)!.row));
  m.endTurn();assert.equal(m.active.id,2);assert.deepEqual(m.phaseSubmitted,[1]);
});

check('V2 AI locks carrier launches during aviation preparation and all wings appear together',()=>{
  const m=new Match(new HexWorld(128),assets,2,['ai','human']),report=executeAiTurn(m);
  assert.equal(report.launched,3);assert.equal(m.aviationOrders.length,2);assert.equal(m.aviation.squadrons.length,0);
  m.endTurn();assert.equal(m.active.id,2);assert.deepEqual(Match.load(m.save(),assets).save(),m.save());
  m.endTurn();assert.equal(m.phase,'movement');assert.equal(m.aviationOrders.length,0);assert.equal(m.aviation.squadrons.length,3);
});

check('V2 AI locks a combat attack without applying damage before all sides submit',()=>{
  const m=new Match(new HexWorld(128),assets,2,['ai','human']),attacker=m.unit('team-1-lafei'),target=m.unit('team-2-lafei');m.phase='combat';
  m.units.filter(unit=>unit!==attacker&&unit!==target).forEach(sink);
  const targetCell=seaCellAtDistance(m,attacker,2);Object.assign(target,targetCell,{status:'ready',hp:target.maxHp,action:1});m.refreshVision();
  const hp=target.hp,report=executeAiTurn(m);assert.equal(report.combats.length,0);assert.equal(target.hp,hp);assert.equal(m.combatOrders.length,1);
  m.endTurn();m.endTurn();const events=m.takeResolvedCombatEvents();assert.equal(events.length,1);assert.equal(events[0].attackerId,attacker.instanceId);
});

check('V2 carrier launch and recovery spend deck operations and preserve a full turnaround round',()=>{
  const m=scene(),carrier=m.unit('team-1-qiye');m.phase='aviation';const preview=launchPreview(m,carrier.instanceId);
  assert.deepEqual(preview.slots,[0,1]);assert.equal(preview.operationsLimit,2);assert.equal(preview.operationsUsed,0);
  assert.deepEqual(orderCarrierLaunch(m,carrier.instanceId),[0,1]);assert.equal(m.aviation.squadrons.length,0,'aircraft remain hidden until every side submits');
  cancelCarrierLaunch(m,carrier.instanceId);assert(launchPreview(m,carrier.instanceId).valid,'launch orders can be withdrawn before phase submission');orderCarrierLaunch(m,carrier.instanceId);
  m.endTurn();const pending=m.save();assert.equal(pending.version,23);assert.equal(pending.phase,'aviation');assert.deepEqual(pending.aviationOrders[0].slots,[0,1]);assert.deepEqual(Match.load(pending,assets).save(),pending);
  m.endTurn();assert.equal(m.phase,'movement');const launched=m.aviation.squadrons.filter(s=>s.carrierId===carrier.instanceId),deck=m.aviation.decks[carrier.instanceId];assert.deepEqual(launched.map(s=>s.role),['fighter','bomber']);
  assert.deepEqual(deck.squadrons.map(s=>s.status),['airborne','airborne','reserve']);assert.equal(deck.operationsUsed,2);
  const fighter=launched[0];Object.assign(fighter,cellCenter(carrier),{order:'return',flight:undefined});tickAviation(m,.1);assert(m.aviation.squadrons.includes(fighter),'a squadron waits when this round has no landing operation left');
  finishPhase(m);finishPhase(m);assert.equal(m.round,2);m.activeIndex=0;tickAviation(m,.1);
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

check('Legacy V2 saves migrate to version 23 and invalid contacts, siege, or queued orders are rejected',()=>{
  const m=scene(),current:any=m.save();
  for(const version of [16,17]){
    const raw=JSON.parse(JSON.stringify(current));raw.version=version;delete raw.contacts;
    if(version===16){for(const unit of raw.units)delete unit.firedThisTurn;for(const port of raw.campaign.ports){delete port.occupationOwnerId;delete port.occupationProgress;}}
    const restored=Match.load(raw,assets);assert.equal(restored.save().version,23);assert(restored.units.every(u=>u.firedThisTurn===false));
  }
  const legacy18=JSON.parse(JSON.stringify(current));legacy18.version=18;legacy18.activeIndex=1;
  delete legacy18.phase;delete legacy18.initiativeIndex;delete legacy18.phaseSubmitted;delete legacy18.movementOrders;
  const alreadyMoved=legacy18.units.find((u:any)=>u.instanceId==='team-1-lafei');alreadyMoved.movedThisTurn=true;alreadyMoved.movementUsed=1;
  const restored18=Match.load(legacy18,assets),position={col:restored18.unit('team-1-lafei').col,row:restored18.unit('team-1-lafei').row};
  assert.equal(restored18.phase,'combat');assert.deepEqual(restored18.phaseSubmitted,[1]);assert.deepEqual({col:restored18.unit('team-1-lafei').col,row:restored18.unit('team-1-lafei').row},position);
  restored18.endTurn();assert.equal(restored18.phase,'aviation');assert.deepEqual({col:restored18.unit('team-1-lafei').col,row:restored18.unit('team-1-lafei').row},position);
  const legacy19=JSON.parse(JSON.stringify(current));legacy19.version=19;delete legacy19.combatOrders;
  assert.equal(Match.load(legacy19,assets).save().version,23);
  const legacy20=JSON.parse(JSON.stringify(current));legacy20.version=20;delete legacy20.aviation.decks;
  assert.equal(Match.load(legacy20,assets).save().version,23);
  const legacy21=JSON.parse(JSON.stringify(current));legacy21.version=21;delete legacy21.aviationOrders;
  assert.equal(Match.load(legacy21,assets).save().version,23);
  const restored=Match.load(current,assets),invalid=restored.save() as any,port=invalid.campaign.ports.find((p:any)=>p.id==='home-2');port.occupationProgress=1;
  assert.throws(()=>Match.load(invalid,assets));
  const badContact=JSON.parse(JSON.stringify(current));badContact.contacts[0].push({unitId:'not-a-ship',ownerId:2,col:1,row:1,level:3,age:0,seenThisTurn:true,shipType:'BB',hpBand:'intact',sizeClass:'large'});
  assert.throws(()=>Match.load(badContact,assets));
  const badOrder=JSON.parse(JSON.stringify(current));badOrder.combatOrders.push({ownerId:1,attackerId:'not-a-ship',targetId:'team-2-lafei',weaponId:'light-gun',distance:1});
  assert.throws(()=>Match.load(badOrder,assets));
  const pending=scene();pending.phase='aviation';orderCarrierLaunch(pending,'team-1-qiye');pending.endTurn();
  const invalidLaunch=pending.save() as any;invalidLaunch.aviationOrders[0].slots=[2];assert.throws(()=>Match.load(invalidLaunch,assets));
});

console.log(JSON.stringify({passed:true,checks:checks.length,checks},null,2));
