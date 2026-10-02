import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Match} from '../src/match.ts';
import {CAMPAIGN_BATTLES} from '../src/historical-battles.ts';
import {HexWorld} from '../src/world.ts';
import {type Roster} from '../src/types.ts';

const assets=(JSON.parse(readFileSync('data/roster.json','utf8')) as Roster).units;
function check(name:string,run:()=>void):void{run();console.log(`PASS ${name}`);}
function createEditor(world:HexWorld,teams=2):Match{return new Match(world,assets,teams,Array.from({length:teams},()=> 'human' as const),'manual',{sandboxMode:true,sandboxEditing:true});}
function place(match:Match,assetId:string,ownerId:number):string{
  const occupied=new Set(match.units.map(unit=>`${unit.col},${unit.row}`)),cell=match.world.nearbySea(match.world.home,occupied);
  return match.placeSandboxShip(assetId,ownerId,cell).instanceId;
}

check('Empty editor opens on the test, archipelago, and historical map families with full visibility',()=>{
  const worlds=[new HexWorld(5,10,'test-5x10'),new HexWorld(128),...CAMPAIGN_BATTLES.map(battle=>new HexWorld(battle.width,battle.height,battle.id))];
  for(const world of worlds){
    const match=createEditor(world,2);
    assert.equal(match.sandboxMode,true,world.scenarioId);assert.equal(match.sandboxEditing,true,world.scenarioId);
    assert.equal(match.fleetEntryMode,'manual',world.scenarioId);assert.equal(match.units.length,0,world.scenarioId);
    assert.equal(match.fleetReserve.length,0,world.scenarioId);assert.equal(match.result,undefined,world.scenarioId);
    const cell=world.nearbySea(world.home);assert.equal(match.fog.state(1,cell),2,world.scenarioId);assert.equal(match.fog.state(2,cell),2,world.scenarioId);
  }
  const large=createEditor(new HexWorld(128),5);assert.equal(large.teams.length,5);assert.equal(large.units.length,0);
});

check('Palette placements can repeat ships, reject occupied or invalid cells, and change team ownership',()=>{
  const match=createEditor(new HexWorld(128),2),asset=assets.find(item=>item.ship_type.code==='DD')!;
  const first=place(match,asset.id,1),second=place(match,asset.id,1),third=place(match,assets.find(item=>item.ship_type.code==='CV')!.id,2);
  assert.equal(match.units.length,3);assert.notEqual(first,second);assert.equal(match.unit(first).asset.id,match.unit(second).asset.id);
  assert.throws(()=>match.placeSandboxShip(asset.id,1,{...match.unit(first)}),/已经有舰船/);
  assert.throws(()=>match.placeSandboxShip(asset.id,1,{col:-1,row:-1}),/有效海格/);
  match.assignSandboxOwner(second,2);assert.equal(match.unit(second).ownerId,2);
  match.setSandboxController(2,'ai');assert.equal(match.team(2).controller,'ai');
  assert.equal(match.result,undefined);assert(match.teams.every(team=>!team.eliminated),'empty seats do not get eliminated while editing');
  match.removeSandboxShip(first);assert.equal(match.units.length,2);assert.throws(()=>match.removeSandboxShip(first),/找不到/);
  assert.equal(third,'sandbox-3');
});

check('The added nation roster is available in the sandbox without auto-deploying ships',()=>{
  const added=[
    ['anshan',5],['yixian',5],['weineituo',6],['zhala',6],['aisaikesi',1],
    ['gangute',7],['talin',7],['lisailiu',8],['xukufu',8],['rangbaer',9],['fuxu',9],['aifosen',11],
  ] as const;
  for(const [id,factionId] of added){
    const asset=assets.find(item=>item.id===id);assert(asset,`${id} should be available in the ship palette`);
    assert.equal(asset.faction.id,factionId,`${id} should appear under its source faction`);
  }
  const match=createEditor(new HexWorld(128));assert.equal(match.units.length,0,'a larger asset library must not auto-place the fleet');
  for(const [index,[id]] of added.entries())place(match,id,index%2+1);
  assert.equal(match.units.length,added.length,'sandbox ships are added only by manual placement');
});

check('Custom editor layouts round-trip, then begin normal turns with fog and without campaign deadlines',()=>{
  const battle=CAMPAIGN_BATTLES.find(item=>item.id==='midway')!,match=createEditor(new HexWorld(battle.width,battle.height,battle.id));
  const first=place(match,assets.find(item=>item.ship_type.code==='DD')!.id,1);
  const duplicate=place(match,assets.find(item=>item.ship_type.code==='DD')!.id,1);
  const enemy=place(match,assets.find(item=>item.ship_type.code==='BB')!.id,2);
  match.assignSandboxOwner(duplicate,2);
  const draft=match.save();assert.equal(draft.version,30);assert.equal(draft.sandboxMode,true);assert.equal(draft.sandboxEditing,true);assert.equal(draft.fleetEntryMode,'manual');
  assert.deepEqual(Match.load(draft,assets).save(),draft,'empty and custom editor saves retain their map, ownership, and serials');
  match.beginSandboxGame();assert.equal(match.sandboxEditing,false);assert.equal(match.active.controller,'human');
  assert.equal(match.units.length,3);assert.equal(match.unit(first).ownerId,1);assert.equal(match.unit(duplicate).ownerId,2);assert.equal(match.unit(enemy).ownerId,2);
  assert.equal(match.fog.state(1,{col:0,row:0}),0,'fog resets when editing ends');
  match.round=battle.mission.roundLimit+2;match.resolveOutcome();assert.equal(match.result,undefined,'sandbox battles ignore campaign deadlines and objectives');
  const active=match.save();assert.equal(active.sandboxMode,true);assert.equal(active.sandboxEditing,false);
  assert.deepEqual(Match.load(active,assets).save(),active,'active sandbox saves retain the manually placed duplicate roster');
});

check('Starting play requires ships for every team and one human team',()=>{
  const missing=createEditor(new HexWorld(128));place(missing,assets.find(item=>item.ship_type.code==='DD')!.id,1);
  assert.throws(()=>missing.beginSandboxGame(),/每个势力至少放置一艘/);assert.equal(missing.sandboxEditing,true);
  const noPlayers=createEditor(new HexWorld(128));place(noPlayers,assets.find(item=>item.ship_type.code==='DD')!.id,1);place(noPlayers,assets.find(item=>item.ship_type.code==='DD')!.id,2);
  noPlayers.setSandboxController(1,'ai');noPlayers.setSandboxController(2,'ai');assert.throws(()=>noPlayers.beginSandboxGame(),/至少需要一个玩家/);
});

check('Legacy game saves still load as non-sandbox games',()=>{
  const legacy=JSON.parse(JSON.stringify(new Match(new HexWorld(128),assets,2).save()));
  legacy.version=29;delete legacy.sandboxMode;delete legacy.sandboxEditing;delete legacy.sandboxSerial;
  const loaded=Match.load(legacy,assets);assert.equal(loaded.sandboxMode,false);assert.equal(loaded.sandboxEditing,false);assert.equal(loaded.units.length,legacy.units.length);
});
