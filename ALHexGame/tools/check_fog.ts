import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {Match} from '../src/match.ts';
import {FogOfWar,SHIP_VISION,AIR_VISION} from '../src/fog.ts';
import {launchWing,commandSquadron,tickAviation} from '../src/aircraft.ts';
import {cellCenter,worldToCell} from '../src/hex.ts';
import {HexWorld} from '../src/world.ts';
import {Terrain,type Roster} from '../src/types.ts';

const assets=(JSON.parse(readFileSync('data/roster.json','utf8')) as Roster).units,checks:{name:string;passed:boolean}[]=[];
function check(name:string,fn:()=>void){fn();checks.push({name,passed:true});}
function scenario(native=false){
  const world=new HexWorld(128);if(!native){world.terrain.fill(Terrain.Sea);world.terrain.fill(Terrain.Land,0,128);world.terrain.fill(Terrain.Land,127*128);}
  const m=new Match(world,assets,2),own=m.units.filter(u=>u.ownerId===1),ship=own.find(u=>u.asset.ship_type.code==='BB')!,enemy=m.units.find(u=>u.ownerId===2&&u.asset.ship_type.code==='DD')!;
  own.forEach(u=>{u.status='sunk';u.hp=0;u.action=0;u.guard=false;});
  const shipCell=native?world.nearbySea({col:20,row:20}):{col:20,row:20},enemyCell=native?world.nearbySea({col:27,row:20},new Set([`${shipCell.col},${shipCell.row}`])):{col:27,row:20};
  Object.assign(ship,{...shipCell,status:'ready',hp:ship.maxHp,action:1});Object.assign(enemy,enemyCell);m.refreshVision();
  return {m,ship,enemy,own};
}
check('Hex sight includes ring 6 and excludes ring 7 without leaking hidden target data',()=>{
  const {m,ship,enemy}=scenario();assert(m.canSee(1,{col:26,row:20}));assert(!m.canSee(1,enemy));
  assert.equal(m.fog.field(1).lit.size,1+3*SHIP_VISION*(SHIP_VISION+1));
  const preview=m.attackPreview(ship.instanceId,enemy.instanceId,'main-gun');assert(!preview.valid);assert.match(preview.reason!,/视野/);
  assert.equal(preview.damage,0);assert.equal(preview.hpAfter,0);assert.equal(preview.distance,0);assert.deepEqual(preview.blocked,[]);
  const hp=enemy.hp,oil=m.active.oil;assert.throws(()=>m.attack(ship.instanceId,enemy.instanceId,'main-gun'),/视野/);assert.equal(enemy.hp,hp);assert.equal(ship.action,1);assert.equal(m.active.oil,oil);
});
check('Friendly spotting enables a battleship shot at seven hexes regardless of original nation',()=>{
  const {m,ship,enemy,own}=scenario(),spotter=own.find(u=>u.asset.faction.id!==ship.asset.faction.id)!;
  Object.assign(spotter,{col:27,row:21,status:'ready',hp:spotter.maxHp,action:1});assert(m.unitVisible(enemy));
  assert(m.attackPreview(ship.instanceId,enemy.instanceId,'main-gun').valid);m.attack(ship.instanceId,enemy.instanceId,'main-gun');assert.equal(enemy.hp,3);
});
check('Explored terrain remains after retreat while enemy positions disappear',()=>{
  const {m,ship,enemy}=scenario();enemy.col=26;assert(m.unitVisible(enemy));ship.col=40;m.refreshVision();
  assert.equal(m.fog.state(1,{col:20,row:20}),1);assert(!m.unitVisible(enemy));assert.equal(m.fog.state(1,{col:60,row:20}),0);assert.equal(m.fog.state(1,ship),2);
});
check('No automatic movement and no hidden-cell navigation after sight is lost',()=>{
  const {m,ship}=scenario();assert.equal(m.route(ship.instanceId,{col:28,row:20}),undefined);assert.throws(()=>m.issueMove(ship.instanceId,{col:28,row:20}),/视野/);
  m.issueMove(ship.instanceId,{col:23,row:20});assert.equal(m.active.oil,47);for(let i=0;i<4;i++)assert.deepEqual(m.endTurn(),[]);assert.equal(ship.col,23);assert.equal(m.active.oil,50);
});
check('Each of two, four and eight players has separate discovery and current sight',()=>{
  for(const n of [2,4,8]){const m=new Match(new HexWorld(256),assets,n),a=m.units.find(u=>u.ownerId===1)!,b=m.units.find(u=>u.ownerId===2)!;
    assert(m.canSee(1,a));assert(!m.canSee(1,b));assert(m.canSee(2,b));assert(!m.isExplored(2,a));m.endTurn();assert(m.unitVisible(b));assert(!m.unitVisible(a));}
});
check('Losing the last ship clears live sight without erasing discovery, including all-sunk battles',()=>{
  const {m,ship}=scenario();ship.status='sunk';ship.hp=0;ship.action=0;m.refreshVision();assert.equal(m.fog.field(1).lit.size,0);assert.equal(m.fog.state(1,ship),1);
  m.units.forEach(u=>{u.status='sunk';u.hp=0;u.action=0;});m.refreshVision();assert(m.fog.field(2).lit.size===0);
});
check('Aircraft reveal eight hexes, fly over islands and keep independent action and oil accounting',()=>{
  const m=new Match(new HexWorld(128),assets,2),cv=m.units.find(u=>u.ownerId===1&&u.asset.ship_type.code==='CV')!,[s]=launchWing(m,cv.instanceId);
  Object.assign(s,cellCenter({col:45,row:45}));assert(m.canSee(1,{col:53,row:45}));assert(!m.canSee(1,{col:54,row:45}));
  assert.equal(s.actionPoints,20);assert.equal(m.active.oil,41);m.world.terrain[45*128+46]=Terrain.Land;
  commandSquadron(m,s.id,cellCenter({col:47,row:45}));for(let i=0;i<10;i++)tickAviation(m,.1);assert.deepEqual(worldToCell(s),{col:47,row:45});assert.equal(s.actionPoints,18);assert.equal(m.active.oil,41);
});
check('Every airplane role provides sight while stationed in an inactive player turn',()=>{
  const m=new Match(new HexWorld(128),assets,2),cv=m.units.find(u=>u.ownerId===1&&u.asset.ship_type.code==='CV')!,wing=launchWing(m,cv.instanceId);
  wing.forEach((s,i)=>Object.assign(s,cellCenter({col:40+i*20,row:45})));m.endTurn();wing.forEach(s=>assert(m.canSee(1,worldToCell(s))));assert.equal(wing[0].fuelTurns,3);
});
check('Removed aircraft withdraw sight but their reconnaissance remains explored',()=>{
  const m=new Match(new HexWorld(128),assets,2),cv=m.units.find(u=>u.ownerId===1&&u.asset.ship_type.code==='CV')!,[s]=launchWing(m,cv.instanceId);
  Object.assign(s,cellCenter({col:60,row:45}));assert(m.canSee(1,{col:66,row:45}));m.aviation.squadrons=[];
  assert(!m.canSee(1,{col:66,row:45}));assert(m.isExplored(1,{col:66,row:45}));
});
check('Unseen ship and aircraft targets reject aviation commands without consuming ammunition',()=>{
  const m=new Match(new HexWorld(128),assets,2),cv=m.units.find(u=>u.ownerId===1&&u.asset.ship_type.code==='CV')!,[s]=launchWing(m,cv.instanceId),enemy=m.units.find(u=>u.ownerId===2)!;
  assert.throws(()=>commandSquadron(m,s.id,undefined,enemy.instanceId),/视野/);assert.equal(s.ammo,3);assert.equal(s.order,'patrol');
  m.endTurn();const other=m.units.find(u=>u.ownerId===2&&u.asset.ship_type.code==='CV')!,[enemyAir]=launchWing(m,other.instanceId);m.endTurn();
  assert.throws(()=>commandSquadron(m,s.id,undefined,enemyAir.id),/视野/);assert.equal(s.ammo,3);
});
check('Losing a pursued enemy clears targeting and preserves the already committed adjacent hex',()=>{
  const m=new Match(new HexWorld(128),assets,2),cv=m.units.find(u=>u.ownerId===1&&u.asset.ship_type.code==='CV')!,[s]=launchWing(m,cv.instanceId),enemy=m.units.find(u=>u.ownerId===2)!;
  Object.assign(s,cellCenter({col:40,row:40}));Object.assign(enemy,m.world.nearbySea({col:45,row:40}));commandSquadron(m,s.id,undefined,enemy.instanceId);tickAviation(m,.1);assert(s.flight);
  const pending={...s.flight.next};Object.assign(enemy,m.world.nearbySea({col:75,row:70}));tickAviation(m,.1);assert.equal(s.order,'patrol');assert.equal(s.targetId,undefined);
  for(let i=0;i<8;i++)tickAviation(m,.1);assert.deepEqual(worldToCell(s),pending);assert.equal(s.actionPoints,19);
});
check('Version 12 restores exploration exactly and recomputes current sight from surviving units',()=>{
  const {m,ship}=scenario(true),previous={col:ship.col,row:ship.row};Object.assign(ship,m.world.nearbySea({col:40,row:40}));m.refreshVision();m.active.oil=7;
  const saved=m.save(),loaded=Match.load(saved,assets);assert.equal(saved.version,15);assert.deepEqual(loaded.save(),saved);assert.equal(loaded.fog.state(1,previous),1);assert.equal(loaded.active.oil,7);
  assert(!loaded.unitVisible(loaded.unit('team-2-lafei')));assert(loaded.canSee(1,loaded.unit(ship.instanceId)));
});
check('Version 11 starts discovery only around current forces and preserves battle resources',()=>{
  const {m,ship}=scenario(true),previous={col:ship.col,row:ship.row};Object.assign(ship,m.world.nearbySea({col:40,row:40}));const legacy:any=m.save();legacy.version=11;delete legacy.fog;legacy.teams[0].oil=13;
  const before=JSON.stringify(legacy),loaded=Match.load(legacy,assets);assert.equal(JSON.stringify(legacy),before);assert.equal(loaded.fog.state(1,previous),0);assert.equal(loaded.active.oil,13);assert.equal(loaded.save().version,15);
});
check('Idle updates and turn switches never rebuild or erase unchanged sight',()=>{
  const m=new Match(new HexWorld(128),assets,2),before=m.fog.revision;for(let i=0;i<100;i++)assert(!m.refreshVision());m.endTurn();m.refreshVision();assert.equal(m.fog.revision,before);
});
check('Discovery masks exclude invalid cells and canonical saves cannot add them',()=>{
  const world=new HexWorld(128);world.valid[20*128+23]=0;const m=new Match(world,assets,2),fog=new FogOfWar(world,2),ship=m.units[0];Object.assign(ship,{col:20,row:20});fog.refresh([ship],[]);
  assert.equal(fog.state(1,{col:23,row:20}),0);const bad=fog.save(),raw=atob(bad.explored[0]),bytes=Uint8Array.from(raw,c=>c.charCodeAt(0)),i=20*128+23;bytes[i>>3]|=1<<(i&7);bad.explored[0]=btoa(String.fromCharCode(...bytes));assert.throws(()=>new FogOfWar(world,2).load(bad));
});
let invalid=0;
check('Malformed or missing discovery data rejects the save before changing the caller state',()=>{
  const m=new Match(new HexWorld(128),assets,2),before=JSON.stringify(m.save());
  for(const mutate of [(d:any)=>delete d.fog,(d:any)=>d.fog=null,(d:any)=>d.fog.explored=[],(d:any)=>d.fog.explored[0]='!',(d:any)=>d.fog.explored[0]=d.fog.explored[0].slice(4),(d:any)=>d.fog.explored[0]=9,(d:any)=>d.fog.explored.push(d.fog.explored[0])]){const data=JSON.parse(before);mutate(data);assert.throws(()=>Match.load(data,assets));invalid++;assert.equal(JSON.stringify(m.save()),before);}
});
const large=new Match(new HexWorld(512),assets,8),start=performance.now();large.units[0].col++;large.refreshVision();
const benchmark={size:512,players:8,ships:large.units.length,refreshMs:performance.now()-start,discoveryCharacters:large.save().fog.explored.reduce((sum,s)=>sum+s.length,0)};
const report={passed:true,shipVision:SHIP_VISION,airVision:AIR_VISION,checks,invalidSaveCases:invalid,benchmark};
writeFileSync('output/fog-verification.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({passed:true,checks:checks.length,invalidSaveCases:invalid,benchmark}));

