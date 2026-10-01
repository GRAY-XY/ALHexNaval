import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Match} from '../src/match.ts';
import {CAMPAIGN_BATTLES} from '../src/historical-battles.ts';
import {HexWorld} from '../src/world.ts';
import {type Roster} from '../src/types.ts';

const assets=(JSON.parse(readFileSync('data/roster.json','utf8')) as Roster).units;
function endRound(match:Match):void{
  const startingRound=match.round;let steps=0;
  while(match.round===startingRound&&!match.result&&steps++<match.teams.length+1)match.endTurn();
  assert.ok(match.round>startingRound||match.result,'all teams should complete the round');
}
function check(name:string,run:()=>void):void{run();console.log(`PASS ${name}`);}

check('Archipelago games start with a representative fleet and deliver the rest in equal waves',()=>{
  const match=new Match(new HexWorld(128),assets,2,['human','ai'],'staggered');
  assert.equal(match.units.length,14);
  for(const ownerId of [1,2]){
    const deployed=match.units.filter(unit=>unit.ownerId===ownerId);
    assert.deepEqual(new Set(deployed.map(unit=>unit.asset.ship_type.code)),new Set(['DD','CL','CA','BB','CV','CVL','SS']));
    assert.equal(match.fleetEntryStatus(ownerId)?.remaining,assets.length-7);
    assert.equal(match.fleetEntryStatus(ownerId)?.nextRound,2);
  }
  const saved=match.save();assert.equal(saved.version,30);assert.equal(saved.fleetEntryMode,'staggered');
  assert.deepEqual(Match.load(saved,assets).save(),saved,'the reserve schedule should survive save/load');
  endRound(match);
  assert.equal(match.round,2);assert.equal(match.units.length,22);
  for(const ownerId of [1,2]){
    assert.equal(match.units.filter(unit=>unit.ownerId===ownerId).length,11);
    assert.equal(match.fleetEntryStatus(ownerId)?.remaining,assets.length-11);
  }
  assert(match.units.filter(unit=>unit.notice?.includes('增援已抵达')).length===8,'arrivals should be visible in the unit notices');
  assert.deepEqual(Match.load(match.save(),assets).save(),match.save());
});

check('Historical battles deploy four ships first and stage reinforcements without hiding Midway carriers',()=>{
  for(const battle of CAMPAIGN_BATTLES){
    const scenario=new Match(new HexWorld(battle.width,battle.height,battle.id),assets,2,['human','ai'],'staggered');
    assert.deepEqual(scenario.teams.map(team=>scenario.units.filter(unit=>unit.ownerId===team.id).length),[4,4],`${battle.id} opens with four deployed ships per side`);
    assert.deepEqual(scenario.teams.map(team=>scenario.fleetEntryStatus(team.id)?.remaining),battle.startingFleetIds.map(ids=>ids.length-4));
    assert.deepEqual(Match.load(scenario.save(),assets).save(),scenario.save(),`${battle.id} reinforcement records should round-trip`);
  }
  const battle=CAMPAIGN_BATTLES.find(item=>item.id==='midway')!,match=new Match(new HexWorld(battle.width,battle.height,battle.id),assets,2,['human','ai'],'staggered');
  const japaneseCarriers=match.units.filter(unit=>unit.ownerId===2&&['CV','CVL'].includes(unit.asset.ship_type.code));
  assert.equal(japaneseCarriers.length,2,'both carriers needed by the Japanese objective should be present at the outset');
});

check('The 5x10 test arena starts with four ships and brings its carriers before the submarine',()=>{
  const match=new Match(new HexWorld(5,10,'test-5x10'),assets,2,['human','ai'],'staggered');
  assert.deepEqual(match.teams.map(team=>match.units.filter(unit=>unit.ownerId===team.id).length),[4,4]);
  assert.deepEqual(match.teams.map(team=>match.fleetEntryStatus(team.id)?.remaining),[3,3]);
  assert.deepEqual(match.fleetReserve.filter(entry=>entry.ownerId===1).map(entry=>entry.arrivalRound),[2,2,3]);
  endRound(match);assert.equal(match.units.length,12);assert.equal(match.fleetReserve.filter(entry=>entry.ownerId===1).length,1);
  endRound(match);assert.equal(match.units.length,14);assert.equal(match.fleetReserve.length,0);
  assert.deepEqual(Match.load(match.save(),assets).save(),match.save());
});

check('A queued fleet keeps a side alive after its first wave is sunk',()=>{
  const match=new Match(new HexWorld(128),assets,2,['human','ai'],'staggered');
  for(const unit of match.units.filter(item=>item.ownerId===1)){unit.status='sunk';unit.hp=0;unit.action=0;}
  for(const port of match.ports)if(port.ownerId===1)port.ownerId=0;
  match.resolveOutcome();assert.equal(match.team(1).eliminated,false);assert.equal(match.result,undefined);
});

check('Classic mode deploys scheduled ships at the round boundary too',()=>{
  const match=new Match(new HexWorld(128),assets,2,undefined,'staggered');match.rulesetId='classic-v1';
  const initial=match.units.length;match.endTurn();assert.equal(match.units.length,initial);match.endTurn();
  assert.equal(match.round,2);assert.equal(match.units.length,initial+8);assert.equal(match.fleetEntryStatus(1)?.remaining,assets.length-11);
  const saved=match.save(),loaded=Match.load(saved,assets);assert.deepEqual(loaded.fleetReserve,saved.fleetReserve,'classic saves should preserve the remaining arrival schedule');
  assert.equal(loaded.fleetEntryMode,'staggered');assert.equal(loaded.units.length,match.units.length);
});

check('Malformed reserve schedules are rejected and old full-fleet saves still load',()=>{
  const staged=new Match(new HexWorld(128),assets,2,undefined,'staggered').save();
  const malformed=JSON.parse(JSON.stringify(staged));malformed.fleetReserve[0].arrivalRound=malformed.round;
  assert.throws(()=>Match.load(malformed,assets),/存档格式/);
  const old=JSON.parse(JSON.stringify(new Match(new HexWorld(128),assets,2).save()));old.version=28;delete old.fleetEntryMode;delete old.fleetReserve;
  const restored=Match.load(old,assets);assert.equal(restored.units.length,assets.length*2);assert.equal(restored.fleetReserve.length,0);
});
