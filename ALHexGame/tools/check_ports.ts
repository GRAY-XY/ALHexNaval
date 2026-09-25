import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {Match,type MatchUnit} from '../src/match.ts';
import {HexWorld} from '../src/world.ts';
import {neighbors,hexDistance,cellCenter,worldToCell} from '../src/hex.ts';
import {cellKey} from '../src/pathfinding.ts';
import {launchWing,commandSquadron,tickAviation} from '../src/aircraft.ts';
import {REINFORCEMENT_COST,isCoastalPort,createLegacyPorts,PORT_OIL_BONUS} from '../src/ports.ts';
import type {Roster} from '../src/types.ts';
const assets=(JSON.parse(readFileSync('data/roster.json','utf8')) as Roster).units,checks:{name:string;passed:boolean}[]=[];
let invalid=0;
function check(name:string,fn:()=>void){fn();checks.push({name,passed:true});}
function sink(u:MatchUnit){Object.assign(u,{hp:0,action:0,status:'sunk',guard:false});delete u.availableRound;}
function scene(){const m=new Match(new HexWorld(128),assets,2),p=m.ports.find(p=>!p.ownerId&&m.units.every(u=>hexDistance(u,p)>2))!,u=m.unit('team-1-lafei');assert(p);Object.assign(u,{col:p.col,row:p.row});m.refreshVision();return {m,p,u};}
function own(){const s=scene();s.m.capturePort(s.u.instanceId,s.p.id);s.u.action=1;return s;}
check('All map sizes and player counts create unique sea harbors, one home per player and separate starting credits',()=>{
  for(const size of [128,256,512])for(const players of [2,4,8]){const m=new Match(new HexWorld(size),assets,players);assert.equal(m.ports.filter(p=>p.homeForId).length,players);assert.equal(new Set(m.ports.map(cellKey)).size,m.ports.length);assert(m.ports.every(p=>isCoastalPort(m.world,p)));assert(m.teams.every(t=>t.credits===40&&t.oil===50&&m.oilCap(t.id)===50&&!t.eliminated));assert.equal(m.ports.filter(p=>p.homeForId===1)[0].ownerId,1);assert(!m.result);}
});
check('Capturing costs one combat action, no credits or oil, and does not grant immediate income',()=>{
  const {m,p,u}=scene();const credit=m.active.credits,oil=m.active.oil,income=m.income();m.capturePort(u.instanceId,p.id);assert.equal(p.ownerId,1);assert.equal(u.action,0);assert.equal(m.active.credits,credit);assert.equal(m.active.oil,oil);assert.equal(m.income(),income+10);assert.equal(m.portIntel[0][m.ports.indexOf(p)],1);assert.throws(()=>m.capturePort(u.instanceId,p.id));
});
check('An enemy ship inside the harbor perimeter blocks capture without spending action or resources',()=>{
  const {m,p,u}=scene(),enemy=m.unit('team-2-lafei'),c=neighbors(p).find(c=>m.world.isSea(c))!;Object.assign(enemy,c);const before=m.save();assert.throws(()=>m.capturePort(u.instanceId,p.id),/敌舰/);assert.deepEqual(m.save(),before);Object.assign(enemy,m.world.nearbySea({col:80,row:80}));m.capturePort(u.instanceId,p.id);assert.equal(p.ownerId,1);
});
check('Faraway, held, sunk, wrong-owner and spent-action capture commands reject atomically',()=>{
  for(const mode of ['far','hold','sunk','other','spent']){const {m,p,u}=scene();let id=u.instanceId;if(mode==='far')Object.assign(u,m.world.nearbySea({col:60,row:60}));if(mode==='hold'){u.status='hold';u.action=0;}if(mode==='sunk')sink(u);if(mode==='other')id='team-2-lafei';if(mode==='spent')u.action=0;const before=m.save();assert.throws(()=>m.capturePort(id,p.id));assert.deepEqual(m.save(),before);}
});
check('Income belongs to the incoming player and cycles preserve the faction oil50 rule',()=>{
  for(const players of [2,4,8]){const m=new Match(new HexWorld(128),assets,players);m.active.oil=7;for(let i=1;i<=players;i++){const next=i%players+1,before=m.team(next).credits;m.endTurn();assert.equal(m.active.id,next);assert.equal(m.active.credits,before+m.income());assert.equal(m.active.oil,50);}assert.equal(m.round,2);}
});
check('Repair restores at most fourHP with two credits perHP and consumes the ships combat action',()=>{
  const {m,p,u}=own();u.hp=1;const oil=m.active.oil;m.repairShip(u.instanceId,p.id);assert.equal(u.hp,5);assert.equal(m.active.credits,32);assert.equal(u.action,0);assert.equal(m.active.oil,oil);assert.throws(()=>m.repairShip(u.instanceId,p.id));m.endTurn();m.endTurn();m.repairShip(u.instanceId,p.id);assert.equal(u.hp,6);assert.equal(m.active.credits,50);assert.throws(()=>m.repairShip(u.instanceId,p.id));
});
check('Unaffordable repair and wrong harbor commands cannot heal, revive or charge resources',()=>{
  const {m,p,u}=own();u.hp=1;m.active.credits=7;const before=m.save();assert.throws(()=>m.repairShip(u.instanceId,p.id),/资金/);assert.deepEqual(m.save(),before);assert.throws(()=>m.repairShip(u.instanceId,'home-2'));sink(u);assert.throws(()=>m.repairShip(u.instanceId,p.id));
});
check('Reinforcements replace a lost hull at an unoccupied sea berth and cannot act early or inherit cooldowns',()=>{
  const {m,p}=own(),u=m.unit('team-1-biaoqiang');sink(u);u.cooldowns={torpedo:2};const oil=m.active.oil;m.reinforce(p.id,u.instanceId);assert.equal(u.hp,6);assert.equal(u.status,'wait');assert.equal(u.action,0);assert.equal(u.availableRound,2);assert.deepEqual(u.cooldowns,{});assert.equal(m.active.credits,20);assert.equal(m.active.oil,oil);assert(hexDistance(u,p)<=1);assert.equal(m.units.filter(v=>v.status!=='sunk'&&cellKey(v)===cellKey(u)).length,1);assert.throws(()=>m.wake(u.instanceId),/增援/);assert.throws(()=>m.issueMove(u.instanceId,u),/增援/);const loaded=Match.load(m.save(),assets);assert.equal(loaded.unit(u.instanceId).availableRound,2);loaded.endTurn();loaded.endTurn();const ready=loaded.unit(u.instanceId);assert.equal(ready.status,'ready');assert.equal(ready.action,1);assert.equal(ready.availableRound,undefined);assert.equal(loaded.active.credits,40);
});
check('Each harbor supports only one replacement per round and rejects live hulls or unaffordable types',()=>{
  const {m,p}=own(),a=m.unit('team-1-biaoqiang'),b=m.unit('team-1-z23');sink(a);sink(b);m.reinforce(p.id,a.instanceId);const before=m.save();assert.throws(()=>m.reinforce(p.id,b.instanceId),/本轮/);assert.deepEqual(m.save(),before);assert.throws(()=>m.reinforce('home-2',b.instanceId));assert.throws(()=>m.reinforce(p.id,a.instanceId));m.endTurn();m.endTurn();m.active.credits=0;assert.throws(()=>m.reinforce(p.id,b.instanceId),/资金/);
});
check('No berth means no charge, no replacement, and no production quota consumption',()=>{
  const {m,p}=own(),u=m.unit('team-1-z23');sink(u);const cells=[p,...neighbors(p)].filter(c=>m.world.isSea(c)),fleet=m.units.filter(v=>v.status!=='sunk'&&v!==u);for(let i=0;i<cells.length;i++)Object.assign(fleet[i],{col:cells[i].col,row:cells[i].row});m.active.credits=100;const before=m.save();assert.throws(()=>m.reinforce(p.id,u.instanceId),/泊位/);assert.deepEqual(m.save(),before);
});
check('A destroyed carriers replacement cannot inherit its old airborne wing',()=>{
  const m=new Match(new HexWorld(128),assets,2),cv=m.unit('team-1-qiye');launchWing(m,cv.instanceId);sink(cv);m.active.credits=100;m.reinforce('home-1',cv.instanceId);assert.equal(m.aviation.squadrons.length,0);assert.equal(cv.action,0);assert.equal(m.aviation.launched[cv.instanceId],undefined);assert.equal(m.active.credits,30);
});
check('A player without hulls remains in play while owning a harbor and can recover through reinforcements',()=>{
  const m=new Match(new HexWorld(128),assets,2);m.units.filter(u=>u.ownerId===1).forEach(sink);m.resolveOutcome();assert(!m.active.eliminated);assert(!m.result);m.reinforce('home-1','team-1-lafei');assert.equal(m.unit('team-1-lafei').hp,6);
});
check('Portless players with no surviving hulls are eliminated and skipped by turn rotation',()=>{
  const m=new Match(new HexWorld(128),assets,4);m.units.filter(u=>u.ownerId===2).forEach(sink);m.port('home-2').ownerId=1;m.resolveOutcome();assert(m.team(2).eliminated);assert(!m.result);const credit=m.team(2).credits;m.endTurn();assert.equal(m.active.id,3);assert.equal(m.team(2).credits,credit);assert.equal(m.active.oil,50);assert.equal(m.round,1);
});
check('An air strike sinking a portless players last hull eliminates that player while other factions continue',()=>{
  const m=new Match(new HexWorld(128),assets,3),cv=m.unit('team-1-qiye'),wing=launchWing(m,cv.instanceId),bomber=wing.find(s=>s.role==='bomber')!;
  m.units.filter(u=>u.ownerId===2).forEach(sink);m.port('home-2').ownerId=3;
  const target=m.unit('team-2-lafei'),cell=m.world.nearbySea(cv,new Set(m.units.filter(u=>u.hp>0).map(cellKey)));
  Object.assign(target,cell,{hp:1,status:'ready',action:1});m.refreshVision();
  assert(m.airDamage(bomber,target.instanceId).sunk);assert(m.team(2).eliminated);assert(!m.result);
  const saved=m.save();assert.deepEqual(Match.load(saved,assets).save(),saved);m.endTurn();assert.equal(m.active.id,3);
});
check('Capturing the last defended home wins by headquarters even when the opponent still has ships',()=>{
  const m=new Match(new HexWorld(128),assets,2),u=m.unit('team-1-lafei'),p=m.port('home-2');m.units.filter(v=>v.ownerId===2).forEach(sink);const survivor=m.unit('team-2-biaoqiang');Object.assign(survivor,m.world.nearbySea({col:65,row:80}),{hp:6,status:'ready',action:1});Object.assign(u,{col:p.col,row:p.row});m.refreshVision();m.capturePort(u.instanceId,p.id);assert.equal(m.result?.winnerId,1);assert.equal(m.result?.reason,'headquarters');assert(!m.team(2).eliminated);const before=m.save();assert.throws(()=>m.endTurn(),/结束/);assert.throws(()=>m.issueMove(u.instanceId,u),/结束/);assert.throws(()=>m.reinforce('home-1','team-1-z23'),/结束/);assert.deepEqual(m.save(),before);assert.deepEqual(Match.load(before,assets).save(),before);
});
check('Losing the last harbor after losing all ships triggers elimination victory',()=>{
  const m=new Match(new HexWorld(128),assets,2),u=m.unit('team-1-lafei'),p=m.port('home-2');m.units.filter(v=>v.ownerId===2).forEach(sink);Object.assign(u,{col:p.col,row:p.row});m.refreshVision();m.capturePort(u.instanceId,p.id);assert(m.team(2).eliminated);assert.equal(m.result?.reason,'elimination');assert.equal(m.result?.winnerId,1);
});
check('Finished matches freeze air movement and reject fresh launches and commands',()=>{
  const m=new Match(new HexWorld(128),assets,2),cv=m.unit('team-1-qiye'),[air]=launchWing(m,cv.instanceId);commandSquadron(m,air.id,cellCenter({col:45,row:45}));m.ports.filter(p=>p.homeForId).forEach(p=>p.ownerId=1);m.resolveOutcome();const position={x:air.x,y:air.y,ap:air.actionPoints};assert.deepEqual(tickAviation(m,.1),[]);assert.equal(air.actionPoints,position.ap);assert.equal(air.x,position.x);assert.throws(()=>commandSquadron(m,air.id));assert.throws(()=>launchWing(m,cv.instanceId));
});
check('Unexplored harbors stay hidden and stale discovery does not reveal unseen enemy ownership changes',()=>{
  const {m,p,u}=scene(),i=m.ports.indexOf(p);assert(m.knownPorts().some(v=>v.port.id===p.id&&v.ownerId===0));Object.assign(u,m.world.nearbySea({col:75,row:60}));m.refreshVision();p.ownerId=2;assert.equal(m.knownPorts().find(v=>v.port.id===p.id)!.ownerId,0);Object.assign(u,{col:p.col,row:p.row});m.refreshVision();assert.equal(m.knownPorts().find(v=>v.port.id===p.id)!.ownerId,2);assert.equal(m.portIntel[0][i],2);assert(m.ports.some((_,i)=>m.portIntel[0][i]===-1));
});
check('Version12 migration retains hull, aircraft, oil and discovery while initializing only campaign fields',()=>{
  const m=new Match(new HexWorld(128),assets,2);m.active.oil=9;const raw:any=m.save();raw.version=12;delete raw.campaign;for(const t of raw.teams){delete t.credits;delete t.eliminated;}const before=JSON.stringify(raw),loaded=Match.load(raw,assets);assert.equal(JSON.stringify(raw),before);assert.equal(loaded.active.credits,40);assert.equal(loaded.active.oil,9);assert.deepEqual(loaded.save().fog,raw.fog);assert.deepEqual(loaded.save().units,raw.units);assert.deepEqual(loaded.save().aviation,raw.aviation);
});
check('Capturing a harbor raises the shared oil ceiling without granting immediate oil; next own turn fills the new ceiling',()=>{
  for(const players of [2,4,8]){
    const m=new Match(new HexWorld(128),assets,players),u=m.unit('team-1-lafei'),p=m.ports.find(p=>!p.ownerId&&m.units.every(v=>hexDistance(v,p)>2))!;
    Object.assign(u,{col:p.col,row:p.row});m.active.oil=7;m.capturePort(u.instanceId,p.id);assert.equal(m.oilCap(),60);assert.equal(m.active.oil,7);
    for(let i=0;i<players;i++)m.endTurn();assert.equal(m.active.oil,60);assert.deepEqual(Match.load(m.save(),assets).save(),m.save());
  }
});
check('The expanded oil pool can pay more than fifty DD movement steps within visible adjacent sea cells',()=>{
  const {m,p,u}=own();m.endTurn();m.endTurn();assert.equal(m.active.oil,60);
  const a={col:u.col,row:u.row},b=neighbors(a).find(c=>m.world.isSea(c)&&m.units.every(v=>!v.hp||cellKey(v)!==cellKey(c)))!;
  assert(b);for(let i=0;i<51;i++)m.issueMove(u.instanceId,i%2?a:b);assert.equal(m.active.oil,9);assert.equal(p.ownerId,1);
});
check('Losing a harbor reduces its former owners ceiling and clamps only excess oil',()=>{
  for(const oil of [15,60]){
    const {m,p,u}=own();m.team(1).oil=oil;Object.assign(u,m.world.nearbySea({col:70,row:60}));m.activeIndex=1;
    const e=m.unit('team-2-lafei');Object.assign(e,{col:p.col,row:p.row});m.capturePort(e.instanceId,p.id);
    assert.equal(m.oilCap(1),50);assert.equal(m.team(1).oil,Math.min(oil,50));assert.equal(m.oilCap(2),60);assert.equal(m.active.oil,50);
    assert.deepEqual(Match.load(m.save(),assets).save(),m.save());
  }
});
check('Harbor bonuses do not increase or refill aircraft action points and flights still spend only their own budget',()=>{
  const {m,u}=own();m.endTurn();m.endTurn();const cv=m.unit('team-1-qiye'),wing=launchWing(m,cv.instanceId),s=wing[0];
  const p=m.ports.find(p=>!p.ownerId&&m.units.every(v=>v.ownerId===1||hexDistance(v,p)>2))!;Object.assign(u,{col:p.col,row:p.row});
  const oil=m.active.oil;m.capturePort(u.instanceId,p.id);assert.equal(m.oilCap(),70);assert.equal(s.actionPoints,20);assert.equal(m.active.oil,oil);
  const target=neighbors(worldToCell(s)).find(c=>m.world.contains(c))!;commandSquadron(m,s.id,cellCenter(target));for(let i=0;i<10;i++)tickAviation(m,.1);
  assert.equal(s.actionPoints,19);assert.equal(m.active.oil,oil);
});
check('Version13 offshore ports relocate to coast while ownership, quota, funds, forces, aircraft and exploration survive migration',()=>{
  const m=new Match(new HexWorld(128),assets,2);launchWing(m,'team-1-qiye');m.unit('team-1-bisimai').hp=8;m.active.oil=17;m.active.credits=77;
  m.ports=createLegacyPorts(m.world,m.units,2);assert(m.ports.some(p=>!isCoastalPort(m.world,p)));const captured=m.ports.find(p=>!p.ownerId)!;captured.ownerId=1;captured.usedRound=1;
  m.refreshVision();m.portIntel=m.teams.map(t=>m.ports.map(p=>p.ownerId===t.id||m.fog.state(t.id,p)===2?p.ownerId:-1));
  const raw:any=m.save();raw.version=13;const before=JSON.stringify(raw),loaded=Match.load(raw,assets);
  assert.equal(JSON.stringify(raw),before);assert(loaded.ports.every(p=>isCoastalPort(loaded.world,p)));
  assert.deepEqual(loaded.ports.map(p=>({id:p.id,owner:p.ownerId,used:p.usedRound})),raw.campaign.ports.map((p:any)=>({id:p.id,owner:p.ownerId,used:p.usedRound})));
  assert.equal(loaded.active.credits,77);assert.equal(loaded.active.oil,17);assert.equal(loaded.oilCap(),60);assert.equal(loaded.save().version,15);
  assert.deepEqual(loaded.save().units,raw.units);assert.deepEqual(loaded.save().aviation,raw.aviation);assert.deepEqual(loaded.save().fog,raw.fog);
  assert.deepEqual(Match.load(loaded.save(),assets).save(),loaded.save());
});
check('Current saves reject oil above the owning factions derived harbor capacity without mutating input',()=>{
  const {m}=own();m.endTurn();m.endTurn();const raw=m.save();raw.teams[0].oil=61;const before=JSON.stringify(raw);assert.throws(()=>Match.load(raw,assets));assert.equal(JSON.stringify(raw),before);invalid++;
});
check('Corrupt campaign states reject without changing the original match or caller data',()=>{
  const m=new Match(new HexWorld(128),assets,2),before=JSON.stringify(m.save());
  const mutations=[(d:any)=>delete d.campaign,(d:any)=>d.campaign.ports.pop(),(d:any)=>d.campaign.ports[0].col++,(d:any)=>d.campaign.ports[0].id='duplicate',(d:any)=>d.campaign.ports[0].ownerId=3,(d:any)=>d.campaign.ports[0].usedRound=2,(d:any)=>d.campaign.intel=[],(d:any)=>d.campaign.intel[0][0]=9,(d:any)=>d.campaign.intel[0][0]=-1,(d:any)=>d.teams[0].credits=-1,(d:any)=>d.teams[0].credits=.5,(d:any)=>d.teams[0].eliminated=true,(d:any)=>d.campaign.result={winnerId:1,reason:'headquarters',round:1},(d:any)=>d.units[0].availableRound=2];
  for(const mutate of mutations){const data=JSON.parse(before);mutate(data);const caller=JSON.stringify(data);assert.throws(()=>Match.load(data,assets));assert.equal(JSON.stringify(data),caller);assert.equal(JSON.stringify(m.save()),before);invalid++;}
});
const start=performance.now(),large=new Match(new HexWorld(512),assets,8),benchmark={size:512,players:8,ports:large.ports.length,constructionMs:performance.now()-start};
writeFileSync('output/ports-verification.json',JSON.stringify({passed:true,checks,invalidSaveCases:invalid,reinforcementCosts:REINFORCEMENT_COST,portOilBonus:PORT_OIL_BONUS,allPortsCoastal:true,benchmark},null,2)+'\n');
console.log(JSON.stringify({passed:true,checks:checks.length,invalidSaveCases:invalid,benchmark}));

