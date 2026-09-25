import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { Match } from '../src/match.ts';
import { advanceAviation, aircraftPosition, aircraftRoute, commandSquadron, fighterInRange, launchPreview, launchWing, nationFor, planSquadronTranslation, squadronName, tickAviation, type AirRole } from '../src/aircraft.ts';
import { arrivalAnchor, arrivalTranslation, translateCell } from '../src/arrival.ts';
import { cellCenter, HEX_WIDTH, worldToCell } from '../src/hex.ts';
import { fromAxial, hexDistance, hexLine, neighbors, toAxial } from '../src/hex.ts';
import { cellKey, findRoute, sameCell } from '../src/pathfinding.ts';
import { inSelectionBox, selectionRect } from '../src/selection.ts';
import { HexWorld } from '../src/world.ts';
import { Terrain, type Cell, type Roster } from '../src/types.ts';

const assets = (JSON.parse(readFileSync('data/roster.json', 'utf8')) as Roster).units;
// These established scenarios isolate movement/combat arithmetic from the new visibility gate.
// Production visibility, scouting and persistence are covered independently in check_fog.ts.
class RulesMatch extends Match { override canSee(_owner:number,cell:Cell):boolean{return this.world.contains(cell);} }
function loadRules(input:unknown,roster=assets):Match {
  const match=Match.load(input,roster);match.canSee=(_owner,cell)=>match.world.contains(cell);return match;
}
const legacyMove: Record<string,number> = { DD:4, CL:3, CA:2, BB:2, CV:2, CVL:2 };
const checks: { name: string; passed: boolean }[] = [];
let invalidSaveCases = 0;
function check(name: string, test: () => void): void { test(); checks.push({ name, passed: true }); }
function flat(): Match {
  const world = new HexWorld(128); world.terrain.fill(Terrain.Sea);
  // Distant coast keeps production harbors valid without affecting tactical arithmetic.
  world.terrain.fill(Terrain.Land,0,128);world.terrain.fill(Terrain.Land,127*128);
  const match = new RulesMatch(world, assets);
  // A small hand-built fleet arrangement isolates crossing and ownership rules.
  match.units = assets.map((asset,i) => match.units.find(u => u.asset.id === asset.id && u.ownerId === i % 4 + 1)!);
  match.units.forEach((u,i) => { u.col = 80 + i; u.row = 80; });
  return match;
}
function corridor(match: Match): void {
  match.world.terrain.fill(Terrain.Land); for (let col = 18; col <= 50; col++) match.world.terrain[20 * 128 + col] = Terrain.Sea;
  match.units.forEach(u => { match.world.terrain[u.row * 128 + u.col] = Terrain.Sea; });
}
function ownTurn(match: Match): void { for (let i = 0; i < match.teams.length; i++) match.endTurn(); }
function legacySave(match: Match, version: number): any {
  const saved:any={...match.save(),version};if(version<8){saved.fleetSerial=0;saved.fleets=[];}
  saved.aviation.squadrons.forEach((s:any)=>{if(version<9)delete s.actionPoints;delete s.flight;});return saved;
}
function airDuel(enemyRole: AirRole = 'torpedo') {
  const match=flat(),cv=match.units.find(u=>u.asset.ship_type.code==='CV')!,cvl=match.units.find(u=>u.asset.ship_type.code==='CVL')!;
  Object.assign(cv,{ownerId:1,col:10,row:10});Object.assign(cvl,{ownerId:2,col:100,row:100});
  const fighter=launchWing(match,cv.instanceId)[0];match.endTurn();const enemy=launchWing(match,cvl.instanceId).find(s=>s.role===enemyRole)!;
  for(let i=0;i<3;i++)match.endTurn();match.aviation.squadrons=[fighter,enemy];
  Object.assign(fighter,cellCenter({col:30,row:30}));Object.assign(enemy,cellCenter({col:32,row:30}));
  return {match,fighter,enemy};
}
function oracle(width: number, height: number, start: Cell, target: Cell, cost: (c: Cell) => number): number {
  const distance = new Map([[cellKey(start),0]]), pending = [start];
  while (pending.length) { pending.sort((a,b) => distance.get(cellKey(a))! - distance.get(cellKey(b))!); const cell = pending.shift()!, d = distance.get(cellKey(cell))!;
    if (sameCell(cell,target)) return d;
    for (const next of neighbors(cell)) { if (next.col < 0 || next.row < 0 || next.col >= width || next.row >= height) continue;
      const n = d + cost(next); if (n < (distance.get(cellKey(next)) ?? Infinity)) { distance.set(cellKey(next), n); pending.push(next); } }
  } return Infinity;
}
check('A* matches independent Dijkstra on 80 weighted/blocked maps', () => {
  for (let seed = 0; seed < 80; seed++) {
    const grid = { width: 12, height: 12, contains: (c: Cell) => c.col >= 0 && c.row >= 0 && c.col < 12 && c.row < 12 }, start = { col:0,row:0 }, target = { col:11,row:11 };
    const cost = (c: Cell) => sameCell(c,start) || sameCell(c,target) ? 1 : (c.col * 73 + c.row * 31 + seed * 19) % 11 < 2 ? Infinity : (c.col + c.row + seed) % 3 === 0 ? 2 : 1;
    const route = findRoute(grid,start,target,cost,() => true), expected = oracle(12,12,start,target,cost);
    assert.equal(route?.cost ?? Infinity,expected);
    if (route) { assert.deepEqual(route.cells[0],start); assert.deepEqual(route.cells.at(-1),target);
      assert.equal(route.costs.reduce((a,b) => a+b,0),route.cost); route.cells.slice(1).forEach((c,i) => assert.equal(hexDistance(c,route.cells[i]),1)); }
  }
});
check('Hex lines include both endpoints and use only adjacent cells', () => {
  for (const [a,b] of [[{col:2,row:3},{col:9,row:8}],[{col:15,row:4},{col:3,row:19}],[{col:7,row:7},{col:7,row:7}]] as [Cell,Cell][]) {
    const line=hexLine(a,b);assert.deepEqual(line[0],a);assert.deepEqual(line.at(-1),b);assert.equal(line.length,hexDistance(a,b)+1);
    line.slice(1).forEach((cell,i)=>assert.equal(hexDistance(cell,line[i]),1));
  }
});
check('Invalid map mask and land are impassable', () => {
  const m = flat(), u = m.units[0]; u.col = 20; u.row = 20; corridor(m);
  m.world.valid[20*128+23] = 0; assert.equal(m.route(u.instanceId,{ col:30,row:20 }),undefined);
  assert.equal(m.route(u.instanceId,{ col:-1,row:20 }),undefined); assert.equal(m.route(u.instanceId,{col:21,row:21}),undefined);
});
check('Friendly crossings are legal; stops on occupied cells are forbidden', () => {
  const m = flat(), u = m.units[0], friend = m.units[4]; u.col=20;u.row=20;friend.col=21;friend.row=20;corridor(m);
  assert(m.route(u.instanceId,{col:24,row:20})); assert.equal(m.route(u.instanceId,friend),undefined);
  m.issueMove(u.instanceId,{col:24,row:20}); assert.equal(u.col,24);assert.equal(m.active.oil,46);assert.equal(u.action,1);
});
check('An unaffordable destination rejects without stopping at an intermediate friendly cell', () => {
  const m=flat(),u=m.units[0],friend=m.units[4];u.col=20;u.row=20;friend.col=25;friend.row=20;corridor(m);m.active.oil=5;
  assert.throws(()=>m.issueMove(u.instanceId,{col:27,row:20}),/石油不足/);assert.equal(u.col,20);assert.equal(m.active.oil,5);assert(!('order' in u));
});
check('Enemy blocks a narrow sea lane, and enemy ownership rejects orders', () => {
  const m=flat(),u=m.units[0],enemy=m.units[1];u.col=20;u.row=20;enemy.col=23;enemy.row=20;corridor(m);
  assert.equal(m.route(u.instanceId,{col:30,row:20}),undefined);assert.throws(() => m.issueMove(enemy.instanceId,{col:22,row:20}),/当前势力/);
});
check('Shallow-water costs distinguish light ships from heavy ships', () => {
  for (const code of ['DD','BB','CVL']) { const m=flat(),u=m.units.find(u=>u.asset.ship_type.code===code)!;u.ownerId=1;u.col=20;u.row=20;corridor(m);
    m.world.terrain[20*128+21]=Terrain.Shallow;const route=m.route(u.instanceId,{col:22,row:20})!;
    assert.equal(route.cost,code==='DD'?2:3);m.active.oil=2;
    if(code==='DD'){m.issueMove(u.instanceId,{col:22,row:20});assert.equal(u.col,22);assert.equal(m.active.oil,0);}
    else {assert.throws(()=>m.issueMove(u.instanceId,{col:22,row:20}),/石油不足/);assert.equal(u.col,20);assert.equal(m.active.oil,2);}
    m.active.oil=route.cost;m.issueMove(u.instanceId,{col:22,row:20});assert.equal(u.col,22); }
});
check('Turn rotation refills only the incoming team to 50 oil and increments the round', () => {
  const m=flat();m.teams[0].oil=0;m.teams[1].oil=0;m.units[1].action=0;
  m.endTurn();assert.equal(m.active.id,2);assert.equal(m.round,1);assert.equal(m.teams[0].oil,0);assert.equal(m.teams[1].oil,50);assert.equal(m.units[1].action,1);
  for(let i=0;i<3;i++)m.endTurn();assert.equal(m.round,2);assert.equal(m.active.id,1);assert.equal(m.teams[0].oil,50);
});
check('Movement has no remainder and owner turns refill oil without moving any ship', () => {
  const m=flat(),u=m.units[0];u.col=20;u.row=20;corridor(m);m.active.oil=4;
  assert.throws(()=>m.issueMove(u.instanceId,{col:29,row:20}),/石油不足/);assert.equal(u.col,20);
  m.issueMove(u.instanceId,{col:24,row:20});assert.equal(u.col,24);assert.equal(m.active.oil,0);assert(!('order' in u));
  const positions=m.units.map(u=>({col:u.col,row:u.row}));ownTurn(m);assert.deepEqual(m.units.map(u=>({col:u.col,row:u.row})),positions);assert.equal(m.active.oil,50);
});
check('A failed move does not resume when a blocker leaves or the next round starts', () => {
  const m=flat(),u=m.units[0],enemy=m.units[1];u.col=20;u.row=20;corridor(m);enemy.col=25;enemy.row=20;
  assert.throws(()=>m.issueMove(u.instanceId,{col:35,row:20}),/无法抵达/);enemy.col=100;enemy.row=80;
  ownTurn(m);assert.equal(u.col,20);assert.equal(m.active.oil,50);assert(!('order' in u));
  m.issueMove(u.instanceId,{col:35,row:20});assert.equal(u.col,35);assert.equal(m.active.oil,35);
});
check('Wait, hold and wake never refund shared oil or individual combat actions', () => {
  const m=flat(),u=m.units[0];u.col=20;u.row=20;m.issueMove(u.instanceId,{col:30,row:20});assert(!('order' in u));assert.equal(m.active.oil,40);
  m.wait(u.instanceId);assert.equal(m.active.oil,40);ownTurn(m);assert.equal(u.status,'ready');assert.equal(m.active.oil,50);
  m.wait(u.instanceId,true);ownTurn(m);assert.equal(u.status,'hold');assert.equal(u.action,0);assert.equal(m.active.oil,50);
  m.wake(u.instanceId);assert.equal(u.action,0);ownTurn(m);assert.equal(u.action,1);assert.equal(m.active.oil,50);
});
check('Temporary multi-selection preserves arrival offsets with shared oil and no stacking', () => {
  const m=flat(),members=[m.units[0],m.units[4],m.units[8]];members.forEach((u,i)=>Object.assign(u,{col:20,row:20+i,ownerId:1}));
  const ids=members.map(u=>u.instanceId), before=JSON.stringify(m.save()),plan=m.planGroupMove(ids,{col:30,row:20});
  assert.equal(JSON.stringify(m.save()),before);assert.equal(plan.orders.length,3);assert.equal(new Set(plan.orders.map(o=>cellKey(o.target))).size,3);
  for(const order of plan.orders) assert.deepEqual(order.target,translateCell(m.unit(order.instanceId),plan.source,plan.target));
  m.active.oil=6;const insufficient=JSON.stringify(m.save());assert.throws(()=>m.issueGroupMove(ids,{col:30,row:20}),/石油不足/);assert.equal(JSON.stringify(m.save()),insufficient);
  m.active.oil=50;const cost=plan.orders.reduce((sum,o)=>sum+o.route.cost,0),result=m.issueGroupMove(ids,{col:30,row:20});assert.equal(result.events.length,3);assert.equal(m.active.oil,50-cost);
  assert.equal(result.events.reduce((sum,event)=>sum+event.cells.length-1,0),cost);assert(members.every(u=>u.action===1&&!('order' in u)));
  assert.equal(new Set(m.units.map(cellKey)).size,12);ownTurn(m);assert(members.every(u=>!('order' in u)));
  plan.orders.forEach(o=>assert(sameCell(m.unit(o.instanceId),o.target)));
  assert.equal(m.active.oil,50);
});
check('Group ships pass a one-cell lane separately without a rigid footprint', () => {
  const m=flat(),members=[m.units[0],m.units[4],m.units[8]];members.forEach((u,i)=>Object.assign(u,{col:20+i,row:20,ownerId:1}));corridor(m);
  const result=m.issueGroupMove(members.map(u=>u.instanceId),{col:30,row:20});assert.equal(result.assigned,3);assert.equal(result.events.length,3);
  assert(members.every(u=>u.row===20&&!('order' in u)));assert.equal(new Set(m.units.map(cellKey)).size,12);
});
check('Group commands validate ownership atomically and skip held ships without spending their oil', () => {
  const m=flat(),a=m.units[0],b=m.units[4],enemy=m.units[1];Object.assign(a,{col:20,row:20});Object.assign(b,{col:20,row:22});
  const before=JSON.stringify(m.save());assert.throws(()=>m.issueGroupMove([a.instanceId,enemy.instanceId],{col:25,row:20}),/当前势力/);assert.equal(JSON.stringify(m.save()),before);
  m.wait(b.instanceId,true);const result=m.issueGroupMove([a.instanceId,b.instanceId],{col:25,row:20});assert.equal(result.assigned,1);assert.equal(result.skipped,1);assert.equal(b.col,20);assert.equal(b.row,22);assert(!('order' in b));
});
check('Two and twelve selected ships have no old three-to-six member limit', () => {
  for(const count of [2,12]) { const m=flat(),units=m.units.slice(0,count);units.forEach((u,i)=>Object.assign(u,{ownerId:1,col:20+i,row:20}));
    const source=arrivalAnchor(units.map(cellCenter)),target=translateCell(source,{col:20,row:20},{col:21,row:20});
    const result=m.issueGroupMove(units.map(u=>u.instanceId),target);assert.equal(result.assigned,count);assert.equal(result.events.length,count);assert.equal(new Set(m.units.map(cellKey)).size,12);assert.equal(m.active.oil,50-count); }
});
check('Box selection accepts every drag direction and includes boundaries', () => {
  for(const [a,b] of [[{x:10,y:20},{x:80,y:90}],[{x:80,y:90},{x:10,y:20}],[{x:10,y:90},{x:80,y:20}],[{x:80,y:20},{x:10,y:90}]] as const) {
    assert.deepEqual(selectionRect(a,b),{left:10,top:20,width:70,height:70});assert(inSelectionBox({x:40,y:60},a,b));assert(inSelectionBox({x:10,y:90},a,b));assert(!inSelectionBox({x:81,y:60},a,b));
  }
});
check('Group movement preserves shallow costs and rejects an isolated member atomically', () => {
  const m=flat(),light=m.units[0],heavy=m.units[8],isolated=m.units[4];[light,heavy,isolated].forEach(u=>u.ownerId=1);
  Object.assign(light,{col:20,row:20});Object.assign(heavy,{col:20,row:21});Object.assign(isolated,{col:10,row:10});
  m.world.terrain.fill(Terrain.Shallow);for(const c of neighbors(isolated))m.world.terrain[c.row*128+c.col]=Terrain.Land;
  const before=JSON.stringify(m.save());assert.throws(()=>m.issueGroupMove([light.instanceId,heavy.instanceId,isolated.instanceId],{col:35,row:30}),/完整保留/);assert.equal(JSON.stringify(m.save()),before);
  const result=m.issueGroupMove([light.instanceId,heavy.instanceId],{col:25,row:20});assert.equal(result.assigned,2);assert.equal(result.skipped,0);
  const paid=result.events.reduce((sum,e)=>sum+(e.cells.length-1)*(e.instanceId===heavy.instanceId?2:1),0);assert.equal(m.active.oil,50-paid);assert.equal(isolated.col,10);
});
check('Asymmetric arrival layouts preserve every world offset across odd and even rows', () => {
  for(const row of [30,31]) {
    const m=flat(),members=m.units.slice(0,4),origins=[{col:20,row:20},{col:23,row:20},{col:21,row:21},{col:20,row:23}];
    members.forEach((u,i)=>Object.assign(u,origins[i],{ownerId:1}));
    const plan=m.planGroupMove(members.map(u=>u.instanceId),{col:25,row:row-6});assert.deepEqual(plan.target,{col:25,row:row-6});
    const delta=arrivalTranslation(plan.source,plan.target);
    plan.orders.forEach((o,i)=>{const a=cellCenter(origins[i]),b=cellCenter(o.target);assert(Math.abs(b.x-a.x-delta.x)<1e-8);assert.equal(b.y-a.y,delta.y);});
    m.issueGroupMove(members.map(u=>u.instanceId),plan.target);
    plan.orders.forEach(o=>assert(sameCell(m.unit(o.instanceId),o.target)));assert(members.every(u=>!('order' in u)));
  }
});
check('An island, stationary ship or invalid boundary shifts the entire arrival footprint', () => {
  for(const obstacle of ['island','ship','boundary']) {
    const m=flat(),members=m.units.slice(0,3);members.forEach((u,i)=>Object.assign(u,{ownerId:1,col:20+i*2,row:20}));
    const target=obstacle==='boundary'?{col:127,row:30}:{col:40,row:30};
    if(obstacle==='island')m.world.terrain[30*128+38]=Terrain.Land;
    if(obstacle==='ship')Object.assign(m.units[3],{col:38,row:30});
    const plan=m.planGroupMove(members.map(u=>u.instanceId),target);assert(!sameCell(plan.target,target));
    plan.orders.forEach((o,i)=>{assert.deepEqual(o.target,translateCell(members[i],plan.source,plan.target));assert(m.world.isSea(o.target));});
  }
});
check('A formation too wide for the destination channel fails without changing orders or oil', () => {
  const m=flat(),members=m.units.slice(0,3);members.forEach((u,i)=>Object.assign(u,{ownerId:1,col:20,row:20+i}));corridor(m);
  const before=JSON.stringify(m.save());assert.throws(()=>m.issueGroupMove(members.map(u=>u.instanceId),{col:40,row:20}),/完整保留/);assert.equal(JSON.stringify(m.save()),before);
});
check('A short overlapping translation vacates selected cells and completes without stacking', () => {
  const m=flat(),members=m.units.slice(0,4);members.forEach((u,i)=>Object.assign(u,{ownerId:1,col:20+i,row:20}));
  const source=arrivalAnchor(members.map(cellCenter)),target=translateCell(source,{col:20,row:20},{col:21,row:20});
  const plan=m.planGroupMove(members.map(u=>u.instanceId),target);assert.deepEqual(plan.target,target);
  m.active.oil=1;const before=JSON.stringify(m.save());assert.throws(()=>m.issueGroupMove(members.map(u=>u.instanceId),target),/石油不足/);assert.equal(JSON.stringify(m.save()),before);
  m.active.oil=4;m.issueGroupMove(members.map(u=>u.instanceId),target);assert.equal(m.active.oil,0);ownTurn(m);
  plan.orders.forEach(o=>assert(sameCell(m.unit(o.instanceId),o.target)));assert.equal(new Set(m.units.map(cellKey)).size,12);
});
check('Aircraft preserve arbitrary departure spacing and reach exact translated positions', () => {
  const m=flat(),cv=m.units.find(u=>u.asset.ship_type.code==='CV')!;Object.assign(cv,{ownerId:1,col:20,row:20});
  const air=launchWing(m,cv.instanceId);Object.assign(air[1],cellCenter({col:21,row:20}));Object.assign(air[2],cellCenter({col:22,row:18}));
  const delta={x:311,y:187},orders=planSquadronTranslation(m,air.map(s=>s.id),delta);
  orders.forEach(o=>commandSquadron(m,o.id,o.destination));for(let i=0;i<100;i++)tickAviation(m,.1);
  orders.forEach((o,i)=>{assert.equal(air[i].x,o.destination.x);assert.equal(air[i].y,o.destination.y);assert.equal(air[i].order,'patrol');assert.equal(air[i].fuelTurns,4);});
});
check('Aircraft outside the map or with enemy ownership reject before any order changes', () => {
  const m=flat(),cv=m.units.find(u=>u.asset.ship_type.code==='CV')!;Object.assign(cv,{ownerId:1,col:20,row:20});const air=launchWing(m,cv.instanceId);
  const before=JSON.stringify(m.save());assert.throws(()=>planSquadronTranslation(m,air.map(s=>s.id),{x:-5000,y:0}),/完整飞机队形/);assert.equal(JSON.stringify(m.save()),before);
  air[1].ownerId=2;const owned=JSON.stringify(m.save());assert.throws(()=>planSquadronTranslation(m,air.map(s=>s.id),{x:300,y:0}),/本方/);assert.equal(JSON.stringify(m.save()),owned);
});
check('Mixed ship and aircraft selection uses one translation and fits all members before moving', () => {
  const m=flat(),cv=m.units.find(u=>u.asset.ship_type.code==='CV')!;Object.assign(cv,{ownerId:1,col:20,row:20});const air=launchWing(m,cv.instanceId);
  const origins=air.map(s=>({x:s.x,y:s.y})),ship=cellCenter(cv),source=arrivalAnchor([ship,...air]);
  const result=m.issueGroupMove([cv.instanceId],{col:30,row:25},{source,fits:(a,b)=>{try{planSquadronTranslation(m,air.map(s=>s.id),arrivalTranslation(a,b));return true;}catch{return false;}}});
  const delta=arrivalTranslation(result.source,result.target),orders=planSquadronTranslation(m,air.map(s=>s.id),delta);orders.forEach(o=>commandSquadron(m,o.id,o.destination));
  for(let i=0;i<100;i++)tickAviation(m,.1);
  for(let i=0;i<air.length;i++){assert(Math.abs(air[i].x-cellCenter(cv).x-(origins[i].x-ship.x))<1e-8);assert.equal(air[i].y-cellCenter(cv).y,origins[i].y-ship.y);}
  const before=JSON.stringify(m.save());assert.throws(()=>m.issueGroupMove([cv.instanceId],{col:45,row:35},{source,fits:()=>false}),/完整保留/);assert.equal(JSON.stringify(m.save()),before);
});
check('Version 7 fleets and future routes are removed without changing positions, oil, HP or aviation', () => {
  const m=new RulesMatch(new HexWorld(128),assets),legacy=legacySave(m,7),members=legacy.units.filter((u:any)=>u.ownerId===1).slice(0,3);
  const leader=members[0],target=m.world.nearbySea({col:leader.col+3,row:leader.row});legacy.teams[0].oil=19;members[1].hp=3;
  members.forEach((u:any)=>u.fleetId='fleet-1');legacy.fleetSerial=1;legacy.fleets=[{id:'fleet-1',name:'旧编队',ownerId:1,members:members.map((u:any)=>u.instanceId),leaderId:leader.instanceId,order:target}];
  const before=JSON.stringify(legacy),loaded=loadRules(legacy,assets);assert.equal(JSON.stringify(legacy),before);assert.equal(loaded.active.oil,19);assert.equal(loaded.unit(members[1].instanceId).hp,3);
  for(const u of members) {const unit=loaded.unit(u.instanceId);assert.equal(unit.col,u.col);assert.equal(unit.row,u.row);assert(!('fleetId' in unit));assert(!('order' in unit));}
  assert.deepEqual(loadRules(loaded.save(),assets).save(),loaded.save());assert(!('fleets' in loaded.save()));
  for(const mutation of [(d:any)=>d.fleets[0].members[1]=d.fleets[0].members[0],(d:any)=>d.fleets[0].leaderId='absent',(d:any)=>d.fleets[0].ownerId=2,(d:any)=>d.units[0].fleetId='orphan']) {const corrupt=JSON.parse(before);mutation(corrupt);assert.throws(()=>loadRules(corrupt,assets));invalidSaveCases++;}
});
check('Distant multi-ship moves reject atomically and stay still through save, reload and later turns', () => {
  const m=new RulesMatch(new HexWorld(128),assets),units=m.units.filter(u=>u.ownerId===1),target=m.world.nearbySea({col:116,row:116});
  const before=JSON.stringify(m.save());assert.throws(()=>m.issueGroupMove(units.map(u=>u.instanceId),target),/石油不足/);assert.equal(JSON.stringify(m.save()),before);
  const restored=loadRules(m.save(),assets);for(let i=0;i<20;i++){assert.deepEqual(m.endTurn(),restored.endTurn());assert.deepEqual(m.save(),restored.save());assert.equal(new Set(m.units.filter(u=>u.status!=='sunk').map(cellKey)).size,48);}
});
check('Every one of 2 through 8 players has the entire shared roster and unique ship instances', () => {
  for(let n=2;n<=8;n++){const m=new RulesMatch(new HexWorld(128),assets,n);assert.equal(m.units.length,n*assets.length);
    for(const team of m.teams)assert.deepEqual(m.units.filter(u=>u.ownerId===team.id).map(u=>u.asset.id),assets.map(a=>a.id));
    assert.equal(new Set(m.units.map(u=>u.instanceId)).size,m.units.length);assert.equal(new Set(m.units.map(cellKey)).size,m.units.length);
    for(let i=1;i<=n;i++){assert.equal(m.active.id,i);m.endTurn();}assert.equal(m.round,2);assert.equal(m.active.id,1);}
});
check('Different ships consume one shared 50-point oil pool in the same turn', () => {
  const m=flat(),a=m.units[0],b=m.units[4];Object.assign(a,{ownerId:1,col:20,row:20});Object.assign(b,{ownerId:1,col:20,row:24});m.world.terrain.fill(Terrain.Sea);
  m.issueMove(a.instanceId,{col:23,row:20});assert.equal(m.active.oil,47);
  m.issueMove(b.instanceId,{col:24,row:24});assert.equal(m.active.oil,43);assert.equal(a.action,1);assert.equal(b.action,1);
});
check('Expanded weapons enforce range, armor damage and island line of sight', () => {
  const m=flat(),bb=m.units[8],enemy=m.units[1];Object.assign(bb,{ownerId:1,col:20,row:20});Object.assign(enemy,{ownerId:2,col:27,row:20});
  let p=m.attackPreview(bb.instanceId,enemy.instanceId,'main-gun');assert(p.valid);assert.equal(p.distance,7);assert.equal(p.damage,3);
  const middle=hexLine(bb,enemy)[1];m.world.terrain[middle.row*128+middle.col]=Terrain.Land;p=m.attackPreview(bb.instanceId,enemy.instanceId,'main-gun');assert.equal(p.valid,false);assert.match(p.reason!,/岛屿/);
  m.world.terrain.fill(Terrain.Sea);enemy.col=28;assert.match(m.attackPreview(bb.instanceId,enemy.instanceId,'main-gun').reason!,/射程/);
  const dd=m.units[0];Object.assign(dd,{ownerId:1,col:20,row:22});Object.assign(enemy,{col:25,row:22});assert(m.attackPreview(dd.instanceId,enemy.instanceId,'torpedo').valid);
  enemy.col=26;assert.match(m.attackPreview(dd.instanceId,enemy.instanceId,'torpedo').reason!,/射程/);
});
check('Defense reduces damage, torpedo cooldown lasts one owner turn, and actions never replenish early', () => {
  const m=flat(),defender=m.units[0],attacker=m.units[1];Object.assign(defender,{ownerId:1,col:20,row:20});Object.assign(attacker,{ownerId:2,col:22,row:20});
  m.defend(defender.instanceId);assert.equal(defender.guard,true);assert.equal(defender.action,0);m.endTurn();
  const event=m.attack(attacker.instanceId,defender.instanceId,'torpedo');assert.equal(event.damage,2);assert.equal(attacker.action,0);assert.equal(m.cooldown(attacker,'torpedo'),2);
  assert.throws(()=>m.attack(attacker.instanceId,defender.instanceId,'torpedo'),/作战行动/);
  m.endTurn();m.endTurn();m.endTurn();assert.equal(m.active.id,1);assert.equal(defender.guard,false);m.endTurn();assert.equal(m.active.id,2);assert.equal(m.cooldown(attacker,'torpedo'),1);
  assert.match(m.attackPreview(attacker.instanceId,defender.instanceId,'torpedo').reason!,/冷却/);
  m.endTurn();m.endTurn();m.endTurn();m.endTurn();assert.equal(m.active.id,2);assert.equal(m.cooldown(attacker,'torpedo'),0);
});
check('Sinking a selected ship releases its occupied cell without changing other ships positions', () => {
  const m=flat(),members=[m.units[0],m.units[4],m.units[8]],attacker=m.units[1];members.forEach((u,i)=>Object.assign(u,{ownerId:1,col:20,row:20+i}));
  const friend={col:members[1].col,row:members[1].row};members[0].hp=2;Object.assign(attacker,{ownerId:2,col:21,row:20});m.endTurn();
  const event=m.attack(attacker.instanceId,members[0].instanceId,'light-gun');assert(event.sunk);assert.equal(members[0].status,'sunk');assert.equal(members[0].action,0);assert(sameCell(members[1],friend));
  assert(m.route(attacker.instanceId,{col:20,row:20}));
});
check('Saved game restores independent ownership and resources without persistent groups or ship routes', () => {
  const m=new RulesMatch(new HexWorld(128),assets), own=m.units.filter(u=>u.ownerId===1).filter((_,i)=>[0,4,8].includes(i));m.wait(own[0].instanceId,true);m.endTurn();
  const saved=m.save(),restored=loadRules(saved,assets);assert.deepEqual(restored.save(),saved);
  for(let i=0;i<12;i++){m.endTurn();restored.endTurn();assert.deepEqual(restored.save(),m.save());}
  assert(!JSON.stringify(saved).includes('skeleton'));assert(JSON.stringify(saved).length<m.units.length*512);
  assert(!('fleets' in saved));assert(!('fleetSerial' in saved));assert(saved.units.every(u=>!('fleetId' in u)&&!('order' in u)));
});
check('Distant single-ship moves do not create future orders or spend oil', () => {
  const m=new RulesMatch(new HexWorld(128),assets),u=m.units[0],target=m.world.nearbySea({col:120,row:120}),route=m.route(u.instanceId,target);
  assert(route&&route.cost>50);const before=JSON.stringify(m.save());assert.throws(()=>m.issueMove(u.instanceId,target),/石油不足/);assert.equal(JSON.stringify(m.save()),before);const restored=loadRules(m.save(),assets);
  for(let i=0;i<16;i++){const a=m.endTurn(),b=restored.endTurn();assert.deepEqual(a,b);assert.deepEqual(m.save(),restored.save());}
});
check('Version 10 pending ship routes are discarded once while ongoing aircraft commands remain intact', () => {
  const m=new RulesMatch(new HexWorld(128),assets,2),cv=m.units.find(u=>u.ownerId===1&&u.asset.ship_type.code==='CV')!;
  const [air]=launchWing(m,cv.instanceId),destination=m.world.nearbySea({col:cv.col+4,row:cv.row});
  commandSquadron(m,air.id,cellCenter(destination));tickAviation(m,.1);
  const legacy:any=JSON.parse(JSON.stringify(m.save()));legacy.version=10;
  legacy.units[0].order=m.world.nearbySea({col:100,row:100});legacy.units[0].notice='自动航线受阻';legacy.teams[0].oil=7;
  const before=JSON.stringify(legacy),loaded=loadRules(legacy,assets),saved=loaded.save();
  assert.equal(JSON.stringify(legacy),before);assert.equal(saved.version,15);assert.equal(loaded.active.oil,7);
  assert(saved.units.every(u=>!('order' in u)));assert.equal(loaded.units[0].notice,undefined);assert.deepEqual(saved.aviation,legacy.aviation);
  const positions=loaded.units.map(u=>({col:u.col,row:u.row}));for(let i=0;i<6;i++)assert.deepEqual(loaded.endTurn(),[]);
  assert.deepEqual(loaded.units.map(u=>({col:u.col,row:u.row})),positions);assert.equal(loaded.active.oil,50);
  assert.deepEqual(loadRules(saved,assets).save(),saved);
});
check('Version 11 rejects removed ship-order fields even when their target is a legal sea cell', () => {
  const m=new RulesMatch(new HexWorld(128),assets),data:any=m.save();data.units[0].order=m.world.nearbySea({col:80,row:80});
  assert.throws(()=>loadRules(data,assets));invalidSaveCases++;
});
check('Malformed saves reject versions, overlaps, impossible resources and removed group fields', () => {
  const m=new RulesMatch(new HexWorld(128),assets);
  const mutations:((d:any)=>void)[]=[d=>d.version=99,d=>d.mapHash='deadbeef',d=>d.size=100000,d=>d.round=0,d=>d.activeIndex=9,
    d=>d.units[0].ownerId=9,d=>d.units[0].col=-1,d=>d.units[0].col=.5,d=>d.units[0].movement=5,d=>d.units[0].action=2,
    d=>d.units[0].assetId='unknown',d=>d.units[1].instanceId=d.units[0].instanceId,d=>Object.assign(d.units[1],{col:d.units[0].col,row:d.units[0].row}),
    d=>d.units[0].status='unknown',d=>d.units[0].order={col:-1,row:1},d=>d.units[0].fleetId='orphan',d=>d.fleets=[],d=>d.fleetSerial=0,d=>d.teams[0].name='changed',
    d=>d.units[0].hp=-1,d=>d.units[0].maxHp=999,d=>d.units[0].guard='yes',d=>d.units[0].cooldowns={unknown:1},d=>d.units[0].cooldowns={torpedo:0},d=>d.teams[0].oil=-1,d=>d.teams[0].oil=51];
  for(const mutation of mutations){const data=m.save();mutation(data);assert.throws(()=>loadRules(data,assets));invalidSaveCases++;}
});
check('Different players can save and load the same ship asset without sharing resources or orders', () => {
  const m=new RulesMatch(new HexWorld(128),assets),a=m.units.find(u=>u.ownerId===1&&u.asset.id==='lafei')!,b=m.units.find(u=>u.ownerId===2&&u.asset.id==='lafei')!;
  m.teams[0].oil=17;m.wait(a.instanceId);assert.equal(m.teams[1].oil,50);assert.equal(b.status,'ready');assert.notEqual(a.instanceId,b.instanceId);
  const restored=loadRules(m.save(),assets);assert.deepEqual(restored.save(),m.save());
});
check('Version 1 migration gives the old complete demo roster to its current player and preserves ship progress', () => {
  const world=new HexWorld(128),old=new RulesMatch(world,assets);old.activeIndex=2;
  const deployed=world.deploy(assets),legacy:any=legacySave(old,1),legacyTarget=world.nearbySea({col:deployed[0].col-3,row:deployed[0].row});
  legacy.units=deployed.map((u,i)=>({instanceId:u.instanceId,assetId:u.asset.id,col:u.col,row:u.row,facing:u.facing,ownerId:i%4+1,movement:i===0?1:legacyMove[u.asset.ship_type.code],action:1,status:'ready'}));
  legacy.units[0].order=legacyTarget;
  legacy.units.filter((u:any)=>u.ownerId===1).forEach((u:any)=>{u.fleetId='fleet-1';delete u.order;});
  legacy.fleetSerial=1;legacy.fleets=[{id:'fleet-1',name:'湛蓝舰队 · 第1编队',ownerId:1,members:legacy.units.filter((u:any)=>u.ownerId===1).map((u:any)=>u.instanceId),leaderId:legacy.units[0].instanceId,order:legacyTarget}];
  const migrated=loadRules(legacy,assets);assert.equal(migrated.active.id,3);assert.equal(migrated.units.length,48);assert.equal(migrated.save().version,15);assert.equal(migrated.active.oil,50);
  const own=migrated.units.filter(u=>u.ownerId===3);assert.equal(own.length,12);own.forEach((u,i)=>{assert.equal(u.col,deployed[i].col);assert.equal(u.row,deployed[i].row);assert(!('movement' in u));});
  assert(migrated.units.every(u=>!('fleetId' in u)));assert(!('order' in own[0]));assert(!('fleets' in migrated.save()));
  assert.deepEqual(loadRules(migrated.save(),assets).save(),migrated.save());assert.equal(new Set(migrated.units.map(cellKey)).size,48);
});
check('Version 2 migration adds full hull, armor action state and empty cooldowns without moving ships', () => {
  const m=new RulesMatch(new HexWorld(128),assets),legacy:any=legacySave(m,2);
  for(const team of legacy.teams)delete team.oil;
  for(const unit of legacy.units){const asset=assets.find(a=>a.id===unit.assetId)!;unit.movement=legacyMove[asset.ship_type.code];delete unit.hp;delete unit.maxHp;delete unit.guard;delete unit.cooldowns;}
  const migrated=loadRules(legacy,assets);assert.equal(migrated.save().version,15);assert.equal(migrated.units.length,m.units.length);assert(migrated.teams.every(team=>team.oil===50));
  migrated.units.forEach((unit,i)=>{assert.equal(unit.hp,unit.maxHp);assert.equal(unit.guard,false);assert.deepEqual(unit.cooldowns,{});assert.equal(unit.col,m.units[i].col);assert.equal(unit.row,m.units[i].row);});
});
check('Version 3 migration preserves combat state and replaces per-ship movement with 50 shared oil', () => {
  const m=new RulesMatch(new HexWorld(128),assets),legacy:any=legacySave(m,3);for(const team of legacy.teams)delete team.oil;
  for(const unit of legacy.units){const asset=assets.find(a=>a.id===unit.assetId)!;unit.movement=legacyMove[asset.ship_type.code];}
  legacy.units[0].hp=3;legacy.units[0].action=0;legacy.units[0].guard=true;
  const migrated=loadRules(legacy,assets);assert.equal(migrated.save().version,15);assert.equal(migrated.units[0].hp,3);assert.equal(migrated.units[0].guard,true);assert.equal(migrated.active.oil,50);assert(!('movement' in migrated.units[0]));
});
check('CV launches 3x4 and CVL launches 2x3 using shared oil and one action', () => {
  const m=new RulesMatch(new HexWorld(128),assets),cv=m.units.find(u=>u.ownerId===1&&u.asset.ship_type.code==='CV')!,cvl=m.units.find(u=>u.ownerId===1&&u.asset.ship_type.code==='CVL')!;
  const heavy=launchWing(m,cv.instanceId);assert.equal(heavy.length,3);assert(heavy.every(s=>s.planes===4&&s.fuelTurns===4&&s.actionPoints===20));assert.equal(m.active.oil,41);assert.equal(cv.action,0);
  const light=launchWing(m,cvl.instanceId);assert.equal(light.length,2);assert(light.every(s=>s.planes===3&&s.fuelTurns===3&&s.actionPoints===15));assert.equal(m.active.oil,35);assert.equal(cvl.action,0);assert.deepEqual(light.map(s=>s.role),['fighter','torpedo']);
  assert.throws(()=>launchWing(m,cv.instanceId));assert.equal(m.active.oil,35);assert.equal(m.weapons(cv).length,0);
});
check('Launch atomically rejects insufficient oil, inactive teams and held carriers', () => {
  const m=new RulesMatch(new HexWorld(128),assets),cv=m.units.find(u=>u.ownerId===1&&u.asset.ship_type.code==='CV')!,enemy=m.units.find(u=>u.ownerId===2&&u.asset.ship_type.code==='CV')!;
  m.active.oil=8;assert.throws(()=>launchWing(m,cv.instanceId),/石油/);assert.equal(cv.action,1);assert.equal(m.aviation.serial,0);assert.equal(m.aviation.squadrons.length,0);
  m.active.oil=50;assert.throws(()=>launchWing(m,enemy.instanceId),/本方/);m.wait(cv.instanceId,true);assert(!launchPreview(m,cv.instanceId).valid);
});
check('Aircraft country is fixed to carrier origin, independent of the player owner', () => {
  const m=new RulesMatch(new HexWorld(128),assets),cv=m.units.find(u=>u.ownerId===1&&u.asset.ship_type.code==='CV')!,cvl=m.units.find(u=>u.ownerId===1&&u.asset.ship_type.code==='CVL')!;
  assert.equal(nationFor(m,cv.instanceId),'us');assert.equal(nationFor(m,cvl.instanceId),'uk');assert(launchWing(m,cv.instanceId).every(s=>s.nation==='us'));assert(launchWing(m,cvl.instanceId).every(s=>s.nation==='uk'));
  assert.equal(nationFor(m,m.units.find(u=>u.ownerId===2&&u.asset.ship_type.code==='CV')!.instanceId),'us');
  for (const [faction,nation] of [[1,'us'],[2,'uk'],[3,'jp'],[4,'de']] as const) {
    const countryMatch=new RulesMatch(new HexWorld(128),assets),carrier=countryMatch.units.find(u=>u.ownerId===1&&u.asset.ship_type.code==='CV')!;
    carrier.asset={...carrier.asset,faction:{...carrier.asset.faction,id:faction}};
    assert.equal(nationFor(countryMatch,carrier.instanceId),nation);assert(launchWing(countryMatch,carrier.instanceId).every(s=>s.nation===nation));
  }
});
check('Independent realtime squadrons cross islands and pause on other player turns', () => {
  const m=flat(),cv=m.units.find(u=>u.asset.ship_type.code==='CV')!;Object.assign(cv,{ownerId:1,col:20,row:20});const [a,b]=launchWing(m,cv.instanceId),start={x:a.x,y:a.y},bStart={x:b.x,y:b.y};
  const dest=cellCenter({col:28,row:20});m.world.terrain[20*128+24]=Terrain.Land;commandSquadron(m,a.id,dest);
  for(let i=0;i<50;i++)tickAviation(m,.1);assert(Math.hypot(a.x-dest.x,a.y-dest.y)<2);assert.equal(a.order,'patrol');assert.deepEqual({x:b.x,y:b.y},bStart);assert.equal(a.fuelTurns,4);
  assert.notEqual(a.x,start.x);m.endTurn();const snapshot=JSON.stringify(a);for(let i=0;i<50;i++)tickAviation(m,.1);assert.equal(JSON.stringify(a),snapshot);
  assert.throws(()=>commandSquadron(m,a.id,dest),/本方/);assert.throws(()=>commandSquadron(m,m.aviation.squadrons[0].id,{x:NaN,y:0}));
});
check('Bombers strike in realtime, respect armor and defense, and spend ammo instead of oil', () => {
  const m=flat(),cv=m.units.find(u=>u.asset.ship_type.code==='CV')!,enemy=m.units[1];Object.assign(cv,{ownerId:1,col:20,row:20});Object.assign(enemy,{ownerId:2,col:24,row:20,hp:6,guard:true});
  const bomber=launchWing(m,cv.instanceId).find(s=>s.role==='bomber')!;commandSquadron(m,bomber.id,undefined,enemy.instanceId);let events:any[]=[];
  for(let i=0;i<20;i++)events.push(...tickAviation(m,.1));assert.equal(events.length,1);assert.equal(events[0].damage,2);assert.equal(bomber.ammo,2);assert.equal(m.active.oil,41);assert(events[0].origin);assert.equal(events[0].kind,'air');
});
check('Fighters intercept enemy aircraft; non-fighters reject air targets', () => {
  const m=flat(),cv=m.units.find(u=>u.asset.ship_type.code==='CV')!,cvl=m.units.find(u=>u.asset.ship_type.code==='CVL')!;Object.assign(cv,{ownerId:1,col:20,row:20});Object.assign(cvl,{ownerId:2,col:22,row:20});
  const wing=launchWing(m,cv.instanceId);m.endTurn();const enemy=launchWing(m,cvl.instanceId)[0];m.endTurn();m.endTurn();m.endTurn();
  const fighter=wing[0],bomber=wing[1];assert.throws(()=>commandSquadron(m,bomber.id,undefined,enemy.id),/战斗机/);commandSquadron(m,fighter.id,undefined,enemy.id);
  for(let i=0;i<10;i++)tickAviation(m,.1);assert.equal(enemy.hp,3);assert.equal(fighter.ammo,2);
});
check('Automatic fighter range covers both complete hex rings and excludes the third ring', () => {
  const center={col:30,row:30},axial=toAxial(center);let covered=0;
  for(let dq=-3;dq<=3;dq++)for(let dr=-3;dr<=3;dr++) {
    const cell=fromAxial(axial.q+dq,axial.r+dr),d=hexDistance(center,cell);
    assert.equal(fighterInRange(cellCenter(center),cellCenter(cell)),d<=2);if(d<=2)covered++;
  }
  assert.equal(covered,19);
});
check('Patrolling fighters automatically attack nearby enemies without pursuing distant aircraft', () => {
  const {match,fighter,enemy}=airDuel();Object.assign(enemy,cellCenter({col:33,row:30}));const start={x:fighter.x,y:fighter.y};
  advanceAviation(match,1);assert.equal(enemy.hp,6);assert.equal(fighter.ammo,3);assert.deepEqual({x:fighter.x,y:fighter.y},start);
  Object.assign(enemy,cellCenter({col:32,row:30}));tickAviation(match,.1);assert.equal(enemy.hp,3);assert.equal(fighter.ammo,2);assert.equal(fighter.order,'patrol');assert.equal(fighter.targetId,undefined);
  advanceAviation(match,1);assert.equal(enemy.hp,3);assert.equal(fighter.ammo,2);
  for(let i=0;i<7;i++)advanceAviation(match,1);assert(!match.aviation.squadrons.some(s=>s.id===enemy.id));assert.equal(fighter.ammo,1);
});
check('Automatic fire chooses nearby enemies, ignores friendly aircraft and preserves movement orders', () => {
  const {match,fighter,enemy}=airDuel(),friend={...enemy,id:'air-99',ownerId:1,...cellCenter({col:31,row:30})},far={...enemy,id:'air-100',...cellCenter({col:33,row:30})};
  match.aviation.squadrons.push(friend,far);const destination=cellCenter({col:40,row:30});commandSquadron(match,fighter.id,destination);
  tickAviation(match,.1);assert.equal(enemy.hp,3);assert.equal(friend.hp,6);assert.equal(far.hp,6);assert.equal(fighter.order,'move');assert.deepEqual(fighter.destination,destination);assert.equal(fighter.targetId,undefined);
});
check('Inactive fighters defend automatically while position and fuel remain paused', () => {
  const {match,fighter,enemy}=airDuel('fighter');fighter.role='bomber';const start={x:enemy.x,y:enemy.y,fuelTurns:enemy.fuelTurns};
  tickAviation(match,.1);assert.equal(fighter.hp,5);assert.equal(enemy.ammo,2);assert.deepEqual({x:enemy.x,y:enemy.y,fuelTurns:enemy.fuelTurns},start);
  advanceAviation(match,1);assert.equal(fighter.hp,5);assert.equal(enemy.ammo,2);
});
check('Returning fighters and bombers do not automatically intercept enemy aircraft', () => {
  const {match,fighter,enemy}=airDuel();commandSquadron(match,fighter.id);tickAviation(match,.1);assert.equal(enemy.hp,6);assert.equal(fighter.ammo,3);
  const bomberDuel=airDuel();bomberDuel.fighter.role='bomber';tickAviation(bomberDuel.match,.1);assert.equal(bomberDuel.enemy.hp,6);
});
check('Squadrons cannot rebase to a carrier from a different country', () => {
  const m=new RulesMatch(new HexWorld(128),assets),cv=m.units.find(u=>u.ownerId===1&&u.asset.ship_type.code==='CV')!;launchWing(m,cv.instanceId);
  Object.assign(cv,{status:'sunk',hp:0,action:0});tickAviation(m,.1);assert.equal(m.aviation.squadrons.length,0);
});
check('Recall tracks the moving carrier; low fuel returns and AA causes aircraft losses', () => {
  const m=flat(),cv=m.units.find(u=>u.asset.ship_type.code==='CV')!,enemy=m.units[1];Object.assign(cv,{ownerId:1,col:20,row:20});const [s]=launchWing(m,cv.instanceId);
  Object.assign(enemy,{ownerId:2,col:20,row:20});tickAviation(m,.1);assert.equal(s.hp,7);enemy.col=100;enemy.row=100;
  commandSquadron(m,s.id,cellCenter({col:30,row:20}));for(let i=0;i<20;i++)tickAviation(m,.1);s.fuelTurns=1;tickAviation(m,.1);assert.equal(s.order,'return');
  s.fuelTurns=3;cv.col=21;commandSquadron(m,s.id);for(let i=0;i<60;i++)tickAviation(m,.1);assert(!m.aviation.squadrons.some(a=>a.id===s.id));
});
check('In-flight save restores positions, orders, fuel, country, AA cooldown and next outcomes exactly', () => {
  const m=new RulesMatch(new HexWorld(128),assets),cv=m.units.find(u=>u.ownerId===1&&u.asset.ship_type.code==='CV')!;const [s]=launchWing(m,cv.instanceId);
  commandSquadron(m,s.id,cellCenter({col:cv.col+5,row:cv.row}));for(let i=0;i<10;i++)tickAviation(m,.1);const loaded=loadRules(m.save(),assets);assert.deepEqual(loaded.save(),m.save());
  for(let i=0;i<20;i++){assert.deepEqual(tickAviation(loaded,.1),tickAviation(m,.1));assert.deepEqual(loaded.save(),m.save());}
});
check('Low-FPS aviation frames match twenty fine steps and long suspension catches up at most one second', () => {
  const m=new RulesMatch(new HexWorld(128),assets),cv=m.units.find(u=>u.ownerId===1&&u.asset.ship_type.code==='CV')!,[s]=launchWing(m,cv.instanceId);
  commandSquadron(m,s.id,cellCenter({col:cv.col+10,row:cv.row}));const fine=loadRules(m.save(),assets);advanceAviation(m,1);for(let i=0;i<20;i++)tickAviation(fine,.05);assert.deepEqual(m.save(),fine.save());
  const before=s.fuelTurns;advanceAviation(m,60);assert.equal(s.fuelTurns,before);const snapshot=m.save();advanceAviation(m,NaN);advanceAviation(m,-1);assert.deepEqual(m.save(),snapshot);
});
check('Version 4 migration preserves oil and hull state, removes old carrier strike cooldowns', () => {
  const m=new RulesMatch(new HexWorld(128),assets),legacy:any=legacySave(m,4);delete legacy.aviation;legacy.teams[0].oil=17;
  const carrier=legacy.units.find((u:any)=>u.assetId==='qiye');carrier.cooldowns={airstrike:2};carrier.action=0;
  const loaded=loadRules(legacy,assets);assert.equal(loaded.active.oil,17);assert.equal(loaded.save().version,15);assert.deepEqual(loaded.unit(carrier.instanceId).cooldowns,{});assert.equal(loaded.aviation.squadrons.length,0);
});
check('Version 5 flight saves migrate mixed-country wings to their carrier country without losing flight state', () => {
  const m=new RulesMatch(new HexWorld(128),assets),cv=m.units.find(u=>u.ownerId===1&&u.asset.ship_type.code==='CV')!,cvl=m.units.find(u=>u.ownerId===1&&u.asset.ship_type.code==='CVL')!;
  launchWing(m,cv.instanceId);launchWing(m,cvl.instanceId);const legacy:any=legacySave(m,5);legacy.aviation.nations={[cv.instanceId]:'de',[cvl.instanceId]:'jp'};
  legacy.aviation.squadrons.forEach((s:any)=>{s.nation=s.carrierId===cv.instanceId?'de':'jp';s.fuel=s.fuelTurns*30;delete s.fuelTurns;});
  const before=JSON.stringify(legacy),loaded=loadRules(legacy,assets),expected:any=JSON.parse(before);expected.version=15;expected.campaign=loaded.save().campaign;expected.teams=loaded.save().teams;expected.fog=loaded.save().fog;delete expected.fleets;delete expected.fleetSerial;delete expected.aviation.nations;
  expected.aviation.squadrons.forEach((s:any)=>{s.nation=s.carrierId===cv.instanceId?'us':'uk';s.fuelTurns=s.fuel/30;s.actionPoints=s.fuelTurns*5;delete s.fuel;});
  assert.deepEqual(loaded.save(),expected);assert.equal(JSON.stringify(legacy),before);
  for(const mutation of [(d:any)=>delete d.aviation.nations,(d:any)=>d.aviation.nations[cv.instanceId]='unknown']) {
    const invalid=JSON.parse(before);mutation(invalid);assert.throws(()=>loadRules(invalid,assets));invalidSaveCases++;
  }
});
check('Endurance consumes exactly one turn only when the squadron owner ends their turn', () => {
  for(const teams of [2,4,8]) {
    const m=new RulesMatch(new HexWorld(128),assets,teams),cv=m.units.find(u=>u.ownerId===1&&u.asset.ship_type.code==='CV')!,[s]=launchWing(m,cv.instanceId);
    for(let i=0;i<20;i++)advanceAviation(m,1);assert.equal(s.fuelTurns,4);
    m.endTurn();assert.equal(s.fuelTurns,3);
    for(let i=1;i<teams;i++){m.endTurn();assert.equal(s.fuelTurns,3);}assert.equal(m.active.id,1);
    commandSquadron(m,s.id,cellCenter({col:cv.col+10,row:cv.row}));m.endTurn();assert.equal(s.fuelTurns,2);
    for(let i=1;i<teams;i++)m.endTurn();m.endTurn();assert.equal(s.fuelTurns,1);assert.equal(s.order,'return');assert.equal(s.destination,undefined);
    for(let i=1;i<teams;i++)m.endTurn();m.endTurn();assert(!m.aviation.squadrons.some(a=>a.id===s.id));
  }
});
check('Returning on the final endurance turn recovers to the moving mother before expiration', () => {
  const m=new RulesMatch(new HexWorld(128),assets),cv=m.units.find(u=>u.ownerId===1&&u.asset.ship_type.code==='CV')!,[s]=launchWing(m,cv.instanceId);
  commandSquadron(m,s.id,cellCenter({col:cv.col+5,row:cv.row}));advanceAviation(m,1);s.fuelTurns=1;
  for(let i=0;i<5;i++)advanceAviation(m,1);assert(!m.aviation.squadrons.some(a=>a.id===s.id));
});
check('Version 6 seconds-based flight endurance migrates upwards to complete owner turns', () => {
  const m=new RulesMatch(new HexWorld(128),assets),cv=m.units.find(u=>u.ownerId===1&&u.asset.ship_type.code==='CV')!,cvl=m.units.find(u=>u.ownerId===1&&u.asset.ship_type.code==='CVL')!;
  launchWing(m,cv.instanceId);launchWing(m,cvl.instanceId);const legacy:any=legacySave(m,6);
  legacy.aviation.squadrons.forEach((s:any,i:number)=>{s.fuel=[61,60,31,90,1][i];delete s.fuelTurns;});
  const before=JSON.stringify(legacy),loaded=loadRules(legacy,assets);
  assert.deepEqual(loaded.aviation.squadrons.map(s=>s.fuelTurns),[3,2,2,3,1]);assert.equal(loaded.save().version,15);assert.equal(JSON.stringify(legacy),before);assert.equal(loaded.active.oil,35);
  assert.deepEqual(loadRules(loaded.save(),assets).save(),loaded.save());
  const invalid=JSON.parse(before);invalid.aviation.squadrons[0].fuel=121;assert.throws(()=>loadRules(invalid,assets));invalidSaveCases++;
});
check('Squadron labels use aircraft category and the surviving aircraft count', () => {
  const m=new RulesMatch(new HexWorld(128),assets),cv=m.units.find(u=>u.ownerId===1&&u.asset.ship_type.code==='CV')!,wing=launchWing(m,cv.instanceId);
  assert.deepEqual(wing.map(squadronName),['战斗机-4机','轰炸机-4机','鱼雷机-4机']);wing[1].hp=5;assert.equal(squadronName(wing[1]),'轰炸机-3机');
});
check('Aircraft snap destinations to hex centers and charge one point per adjacent hex independently', () => {
  const m=flat(),cv=m.units.find(u=>u.asset.ship_type.code==='CV')!;Object.assign(cv,{ownerId:1,col:20,row:20});const [a,b]=launchWing(m,cv.instanceId),start={x:a.x,y:a.y};
  const destination={x:a.x+HEX_WIDTH*3+9,y:a.y+HEX_WIDTH*4+7},target=worldToCell(destination),cost=hexDistance(worldToCell(a),target);commandSquadron(m,a.id,destination);
  let previous=worldToCell(a),hops=0;
  for(let i=0;i<100;i++){tickAviation(m,.1);const current=worldToCell(a);if(!sameCell(current,previous)){assert.equal(hexDistance(previous,current),1);hops++;previous=current;}assert.deepEqual({x:a.x,y:a.y},cellCenter(current));assert(Number.isInteger(a.actionPoints));}
  assert.deepEqual({x:a.x,y:a.y},cellCenter(target));assert.equal(hops,cost);assert.equal(a.actionPoints,20-cost);assert.equal(b.actionPoints,20);assert.equal(m.active.oil,41);
  const next={x:a.x-HEX_WIDTH,y:a.y};commandSquadron(m,a.id,next);for(let i=0;i<30;i++)tickAviation(m,.1);assert.equal(a.actionPoints,19-cost);assert.notEqual(a.x,start.x);
});
check('Idle aircraft and 2, 4 or 8 player turn cycles never restore aircraft action', () => {
  for(const teams of [2,4,8]) {
    const m=new RulesMatch(new HexWorld(128),assets,teams),cv=m.units.find(u=>u.ownerId===1&&u.asset.ship_type.code==='CV')!,[s]=launchWing(m,cv.instanceId);
    commandSquadron(m,s.id,{x:s.x+HEX_WIDTH*2,y:s.y});for(let i=0;i<20;i++)tickAviation(m,.1);const left=s.actionPoints;assert(Math.abs(left-18)<1e-8);
    for(let i=0;i<20;i++)advanceAviation(m,1);assert.equal(s.actionPoints,left);
    for(let i=0;i<teams;i++){m.endTurn();assert.equal(s.actionPoints,left);}assert.equal(s.fuelTurns,3);assert.equal(m.active.oil,50);
    const restored=loadRules(m.save(),assets);assert.equal(restored.aviation.squadrons[0].actionPoints,left);assert.deepEqual(restored.save(),m.save());
  }
});
check('The last aircraft action completes exactly one hex then immediately forces return', () => {
  const m=loadRules(JSON.parse(readFileSync('output/combat-demo.json','utf8')),assets),cv=m.units.find(u=>u.ownerId===1&&u.asset.ship_type.code==='CV')!;const [s]=launchWing(m,cv.instanceId);
  s.actionPoints=1;const start=worldToCell(s);commandSquadron(m,s.id,{x:s.x+HEX_WIDTH*10,y:s.y});tickAviation(m,.1);
  assert.deepEqual(worldToCell(s),start);assert.equal(s.actionPoints,1);assert(s.flight);tickAviation(m,.1);tickAviation(m,.1);
  assert.equal(hexDistance(worldToCell(s),start),1);assert.equal(s.actionPoints,0);assert.equal(s.order,'return');assert.equal(s.destination,undefined);assert.equal(s.targetId,undefined);
  assert.throws(()=>commandSquadron(m,s.id,{x:s.x+HEX_WIDTH,y:s.y}),/行动力已耗尽/);assert.throws(()=>planSquadronTranslation(m,[s.id],{x:0,y:0}),/行动力已耗尽/);
  const restored=loadRules(m.save(),assets);assert.equal(restored.aviation.squadrons[0].actionPoints,0);assert.equal(restored.aviation.squadrons[0].order,'return');
  for(let i=0;i<60;i++)tickAviation(m,.1);assert(!m.aviation.squadrons.some(a=>a.id===s.id));assert.equal(s.actionPoints,0);assert.equal(m.active.oil,41);
});
check('Spending exactly the remaining aircraft action at a destination still triggers return', () => {
  const m=flat(),cv=m.units.find(u=>u.asset.ship_type.code==='CV')!;Object.assign(cv,{ownerId:1,col:20,row:20});const [s]=launchWing(m,cv.instanceId);s.actionPoints=1;
  commandSquadron(m,s.id,{x:s.x+HEX_WIDTH,y:s.y});for(let i=0;i<3;i++)tickAviation(m,.1);assert.equal(s.actionPoints,0);assert.equal(s.order,'return');assert.equal(s.destination,undefined);
});
check('Attack approaches charge aircraft action and exhaustion prevents firing or new pursuit orders', () => {
  const m=flat(),cv=m.units.find(u=>u.asset.ship_type.code==='CV')!,enemy=m.units[1];Object.assign(cv,{ownerId:1,col:20,row:20});Object.assign(enemy,{ownerId:2,col:40,row:20});const wing=launchWing(m,cv.instanceId),bomber=wing[1];bomber.actionPoints=1;
  const before=enemy.hp;commandSquadron(m,bomber.id,undefined,enemy.instanceId);for(let i=0;i<3;i++)assert.deepEqual(tickAviation(m,.1),[]);assert.equal(bomber.actionPoints,0);assert.equal(bomber.order,'return');assert.equal(bomber.ammo,3);assert.equal(enemy.hp,before);
  assert.throws(()=>commandSquadron(m,bomber.id,undefined,enemy.instanceId),/行动力已耗尽/);
  const duel=airDuel();Object.assign(duel.enemy,cellCenter({col:40,row:30}));duel.fighter.actionPoints=1;commandSquadron(duel.match,duel.fighter.id,undefined,duel.enemy.id);for(let i=0;i<3;i++)tickAviation(duel.match,.1);assert.equal(duel.fighter.actionPoints,0);assert.equal(duel.fighter.order,'return');assert.equal(duel.fighter.ammo,3);
});
check('Stationary automatic fighter interception consumes ammunition but no movement action', () => {
  const {match,fighter,enemy}=airDuel(),left=fighter.actionPoints;tickAviation(match,.1);assert.equal(enemy.hp,3);assert.equal(fighter.ammo,2);assert.equal(fighter.actionPoints,left);
});
check('Manual recall spends remaining action before compulsory return and cannot bypass the movement budget', () => {
  const m=flat(),cv=m.units.find(u=>u.asset.ship_type.code==='CV')!;Object.assign(cv,{ownerId:1,col:20,row:20});const [s]=launchWing(m,cv.instanceId);
  Object.assign(s,cellCenter({col:30,row:20}),{actionPoints:1});commandSquadron(m,s.id);tickAviation(m,.1);assert.equal(s.actionPoints,1);assert(s.flight);
  tickAviation(m,.1);tickAviation(m,.1);assert.equal(s.actionPoints,0);assert.equal(s.order,'return');assert.throws(()=>commandSquadron(m,s.id,cellCenter({col:31,row:20})),/行动力已耗尽/);
});
check('Returning exhausted aircraft cannot replenish in flight; a later new launch has a new budget', () => {
  const m=flat(),cv=m.units.find(u=>u.asset.ship_type.code==='CV')!;Object.assign(cv,{ownerId:1,col:20,row:20});const [s]=launchWing(m,cv.instanceId);s.actionPoints=0;tickAviation(m,.1);
  for(let i=0;i<20;i++)tickAviation(m,.1);assert(!m.aviation.squadrons.some(a=>a.id===s.id));assert.equal(s.actionPoints,0);ownTurn(m);
  const fresh=launchWing(m,cv.instanceId).find(a=>a.slot===s.slot)!;assert.notEqual(fresh.id,s.id);assert.equal(fresh.actionPoints,20);
});
check('Legacy versions 7 and 8 migrate aircraft budgets using remaining endurance without mutating the save', () => {
  for(const version of [7,8]) {
    const m=new RulesMatch(new HexWorld(128),assets),cv=m.units.find(u=>u.ownerId===1&&u.asset.ship_type.code==='CV')!,cvl=m.units.find(u=>u.ownerId===1&&u.asset.ship_type.code==='CVL')!;launchWing(m,cv.instanceId);launchWing(m,cvl.instanceId);
    const legacy=legacySave(m,version);legacy.aviation.squadrons[0].fuelTurns=2;legacy.aviation.squadrons[3].fuelTurns=1;legacy.teams[0].oil=13;const before=JSON.stringify(legacy),loaded=loadRules(legacy,assets);
    assert.deepEqual(loaded.aviation.squadrons.map(s=>s.actionPoints),[10,20,20,5,15]);assert.equal(loaded.active.oil,13);assert.equal(loaded.save().version,15);assert.equal(JSON.stringify(legacy),before);assert.deepEqual(loadRules(loaded.save(),assets).save(),loaded.save());
  }
});
check('Aircraft spawn at valid hex centers even when the carrier is at a map corner', () => {
  for(const home of [{col:0,row:0},{col:127,row:127},{col:0,row:127}]) {
    const m=flat(),cv=m.units.find(u=>u.asset.ship_type.code==='CV')!;Object.assign(cv,{ownerId:1,...home});
    for(const s of launchWing(m,cv.instanceId)) {assert(m.world.contains(worldToCell(s)));assert.deepEqual({x:s.x,y:s.y},cellCenter(worldToCell(s)));assert.equal(s.actionPoints,20);}
  }
});
check('Air routes cross land but detour around invalid hexes and reject disconnected targets atomically', () => {
  const m=flat(),cv=m.units.find(u=>u.asset.ship_type.code==='CV')!;Object.assign(cv,{ownerId:1,col:20,row:20});const [s]=launchWing(m,cv.instanceId);
  Object.assign(s,cellCenter({col:30,row:20}));const start=worldToCell(s),target={col:34,row:20};
  m.world.terrain.fill(Terrain.Land);m.world.valid[20*128+31]=0;m.world.valid[20*128+32]=0;
  const route=aircraftRoute(m,start,target)!;assert(route.length>5);route.forEach(c=>assert(m.world.contains(c)));
  commandSquadron(m,s.id,cellCenter(target));let previous=start,hops=0;
  for(let i=0;i<50;i++){tickAviation(m,.1);const current=worldToCell(s);assert(m.world.contains(current));if(!sameCell(current,previous)){assert.equal(hexDistance(current,previous),1);hops++;previous=current;}}
  assert.deepEqual(worldToCell(s),target);assert.equal(s.actionPoints,20-hops);assert.equal(hops,route.length-1);
  const isolated={col:50,row:50};neighbors(isolated).forEach(c=>m.world.valid[c.row*128+c.col]=0);
  const before=JSON.stringify(m.save());assert.throws(()=>commandSquadron(m,s.id,cellCenter(isolated)),/无法沿有效六角格/);assert.equal(JSON.stringify(m.save()),before);
});
check('Aircraft keep asymmetric hex formations when translation crosses row parity', () => {
  for(const target of [{col:27,row:25},{col:26,row:24}]) {
    const m=flat(),cv=m.units.find(u=>u.asset.ship_type.code==='CV')!;Object.assign(cv,{ownerId:1,col:20,row:20});const air=launchWing(m,cv.instanceId);
    [{col:20,row:20},{col:22,row:21},{col:19,row:23}].forEach((c,i)=>Object.assign(air[i],cellCenter(c)));
    const starts=air.map(s=>worldToCell(s)),source=arrivalAnchor(air),orders=planSquadronTranslation(m,air.map(s=>s.id),arrivalTranslation(source,target));
    orders.forEach(o=>commandSquadron(m,o.id,o.destination));for(let i=0;i<80;i++)tickAviation(m,.1);
    air.forEach((s,i)=>{const end=translateCell(starts[i],source,target);assert.deepEqual(worldToCell(s),end);assert.deepEqual({x:s.x,y:s.y},cellCenter(end));assert.equal(s.actionPoints,20-hexDistance(starts[i],end));});
  }
});
check('Mid-leg commands preserve the committed adjacent hex and cannot reset its cost or animation', () => {
  const m=new RulesMatch(new HexWorld(128),assets),cv=m.units.find(u=>u.ownerId===1&&u.asset.ship_type.code==='CV')!,[s]=launchWing(m,cv.instanceId),start={x:s.x,y:s.y};
  commandSquadron(m,s.id,{x:s.x+HEX_WIDTH*3,y:s.y});tickAviation(m,.1);const leg=JSON.parse(JSON.stringify(s.flight));
  assert(s.flight);assert.equal(s.actionPoints,20);assert.deepEqual({x:s.x,y:s.y},start);assert.notDeepEqual(aircraftPosition(s),start);
  assert.deepEqual(loadRules(m.save(),assets).save(),m.save());commandSquadron(m,s.id,start);assert.deepEqual(s.flight,leg);
  for(let i=0;i<15;i++)tickAviation(m,.1);assert.deepEqual({x:s.x,y:s.y},start);assert.equal(s.actionPoints,18);assert.equal(s.flight,undefined);assert.equal(s.order,'patrol');
});
check('A lost attack target finishes the pending hex then idles without freezing the flight animation', () => {
  const {match,fighter,enemy}=airDuel();Object.assign(enemy,cellCenter({col:40,row:30}));const start=worldToCell(fighter);
  commandSquadron(match,fighter.id,undefined,enemy.id);tickAviation(match,.1);assert(fighter.flight);const pending={...fighter.flight!.next};
  match.aviation.squadrons=match.aviation.squadrons.filter(s=>s.id!==enemy.id);for(let i=0;i<8;i++)tickAviation(match,.1);
  assert.deepEqual(worldToCell(fighter),pending);assert.equal(hexDistance(start,pending),1);assert.equal(fighter.flight,undefined);assert.equal(fighter.order,'patrol');assert.equal(fighter.actionPoints,19);
});
check('Partial hex travel is preserved through player transitions and a saved game', () => {
  const m=new RulesMatch(new HexWorld(128),assets),cv=m.units.find(u=>u.ownerId===1&&u.asset.ship_type.code==='CV')!,[s]=launchWing(m,cv.instanceId);
  commandSquadron(m,s.id,{x:s.x+HEX_WIDTH*4,y:s.y});tickAviation(m,.1);assert(s.flight);const before=JSON.stringify(s.flight);
  m.endTurn();for(let i=0;i<10;i++)tickAviation(m,.1);assert.equal(JSON.stringify(s.flight),before);assert.equal(s.actionPoints,20);
  const restored=loadRules(m.save(),assets);for(let i=1;i<m.teams.length;i++){m.endTurn();restored.endTurn();}
  for(let i=0;i<20;i++){assert.deepEqual(tickAviation(m,.1),tickAviation(restored,.1));assert.deepEqual(m.save(),restored.save());}
  assert.equal(s.actionPoints,16);assert.equal(s.flight,undefined);
});
check('Version 9 free-flight saves snap to hexes and floor fractional budgets once without refilling', () => {
  const m=new RulesMatch(new HexWorld(128),assets),cv=m.units.find(u=>u.ownerId===1&&u.asset.ship_type.code==='CV')!;launchWing(m,cv.instanceId);
  const legacy=legacySave(m,9),s=legacy.aviation.squadrons[0],zero=legacy.aviation.squadrons[1];
  Object.assign(s,{x:s.x+9,y:s.y+7,actionPoints:17.77,order:'move',destination:{x:s.x+HEX_WIDTH*3+12,y:s.y+11}});zero.actionPoints=.35;
  legacy.teams[0].oil=23;const before=JSON.stringify(legacy),restored=loadRules(legacy,assets),air=restored.aviation.squadrons;
  assert.equal(air[0].actionPoints,17);assert.deepEqual({x:air[0].x,y:air[0].y},cellCenter(worldToCell(s)));assert.deepEqual(air[0].destination,cellCenter(worldToCell(s.destination)));
  assert.equal(air[1].actionPoints,0);assert.equal(air[1].order,'return');assert.equal(air[2].actionPoints,20);assert.equal(restored.active.oil,23);assert.equal(JSON.stringify(legacy),before);
  assert.deepEqual(loadRules(restored.save(),assets).save(),restored.save());
});
check('Malformed aviation saves reject identity, ownership, timing, slot and command corruption', () => {
  const m=new RulesMatch(new HexWorld(128),assets),cv=m.units.find(u=>u.ownerId===1&&u.asset.ship_type.code==='CV')!;launchWing(m,cv.instanceId);
  const mutations:((d:any)=>void)[]=[d=>delete d.aviation,d=>d.aviation.serial=0,d=>d.aviation.squadrons[0].ownerId=2,d=>d.aviation.squadrons[0].x=NaN,d=>d.aviation.squadrons[0].fuelTurns=5,d=>d.aviation.squadrons[0].ammo=4,
    d=>d.aviation.squadrons[0].fuelTurns=1.5,d=>d.aviation.squadrons[0].fuelTurns=0,d=>d.aviation.squadrons[0].fuel=120,
    d=>d.aviation.squadrons[0].nation='unknown',d=>d.aviation.squadrons[0].nation='jp',d=>d.aviation.squadrons[0].hp=0,d=>d.aviation.squadrons[1].slot=0,d=>d.aviation.squadrons[1].id=d.aviation.squadrons[0].id,d=>d.aviation.squadrons[0].order='move',
    d=>d.aviation.squadrons[0].carrierId=m.units[0].instanceId,d=>d.aviation.launched[cv.instanceId]=2,d=>d.aviation.aa[cv.instanceId]=5,d=>d.aviation.nations={[cv.instanceId]:'jp'},d=>Object.assign(d.aviation.squadrons[0],{order:'attack',targetId:'missing'}),
    d=>delete d.aviation.squadrons[0].actionPoints,d=>d.aviation.squadrons[0].actionPoints=-1,d=>d.aviation.squadrons[0].actionPoints=21,d=>d.aviation.squadrons[0].actionPoints=NaN,d=>d.aviation.squadrons[0].actionPoints=0,
    d=>d.aviation.squadrons[0].actionPoints=1.5,d=>d.aviation.squadrons[0].x+=9,
    d=>d.aviation.squadrons[0].flight={next:{col:-1,row:0},progress:.5},d=>d.aviation.squadrons[0].flight={next:worldToCell(d.aviation.squadrons[0]),progress:.5},
    d=>d.aviation.squadrons[0].flight={next:neighbors(worldToCell(d.aviation.squadrons[0]))[0],progress:1},d=>d.aviation.squadrons[0].flight={next:neighbors(worldToCell(d.aviation.squadrons[0]))[0],progress:-.1},
    d=>d.aviation.squadrons[0].flight={progress:.5},d=>Object.assign(d.aviation.squadrons[0],{order:'move',destination:{x:d.aviation.squadrons[0].x+9,y:d.aviation.squadrons[0].y}})];
  for(const mutation of mutations){const saved=m.save();mutation(saved);assert.throws(()=>loadRules(saved,assets));invalidSaveCases++;}
});
const performanceReport=[];
for(const size of [128,256,512]) {
  const m=new RulesMatch(new HexWorld(size),assets),u=m.units[0],target=m.world.nearbySea({col:size-8,row:size-8});const started=performance.now(),route=m.route(u.instanceId,target);
  assert(route);const elapsedMs=performance.now()-started;performanceReport.push({size,elapsedMs,visited:route.visited,pathCells:route.cells.length,cost:route.cost});
}
const report={passed:true,checks,weightedOracleCases:80,invalidSaveCases,pathfinding:performanceReport};
writeFileSync('output/rules-verification.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));

