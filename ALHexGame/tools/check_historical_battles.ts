import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cellCenter, hexDistance, neighbors } from '../src/hex.ts';
import { Match } from '../src/match.ts';
import { CAMPAIGN_BATTLES } from '../src/historical-battles.ts';
import { isCoastalPort } from '../src/ports.ts';
import { HexWorld } from '../src/world.ts';
import { Terrain,type Roster } from '../src/types.ts';

const roster=JSON.parse(readFileSync(new URL('../data/roster.json',import.meta.url),'utf8')) as Roster;
const reports=[];
for(const battle of CAMPAIGN_BATTLES){
  const world=new HexWorld(battle.width,battle.height,battle.id),area=world.width*world.height,landRatio=world.landCells/area;
  assert(landRatio>(battle.id==='midway' ? .0003 : .025)&&landRatio<.55,`${battle.id} has plausible regional land coverage (${landRatio})`);
  assert.equal(world.locations.length,battle.locations.length);assert.equal(world.landmarks.length,battle.landmarks.length);
  for(const cell of [...world.startPositions,...world.locations,...world.landmarks])assert(world.contains(cell),`${battle.id} location lies within the map`);
  for(const [rangeIndex,range] of (battle.mountainRanges??[]).entries())for(const [pointIndex,[x,y]] of range.points.entries()){
    const anchor={col:Math.round(x*(world.width-1)),row:Math.round(y*(world.height-1))};
    assert.equal(world.at(anchor),Terrain.Land,`${battle.id} mountain ridge ${rangeIndex+1} point ${pointIndex+1} lies on land`);
    assert(neighbors(anchor).filter(cell=>world.at(cell)===Terrain.Land).length>=5,`${battle.id} mountain ridge ${rangeIndex+1} point ${pointIndex+1} stays inland`);
  }
  for(const landmark of world.landmarks)assert.equal(world.at(landmark),Terrain.Land,`${battle.id} landmark ${landmark.id} is placed on land`);
  for(const start of world.startPositions)assert(world.isSea(start),`${battle.id} fleet start is water`);
  assert(hexDistance(world.startPositions[0],world.startPositions[1])>18,`${battle.id} opposing forces start apart`);
  const match=new Match(world,roster.units,2,['human','ai']);
  assert.deepEqual(match.teams.map(team=>team.name),battle.sides);
  assert.equal(match.activeIndex,battle.firstMoverIndex,`${battle.id} keeps its authored opening initiative`);
  assert(Number.isInteger(battle.mission.roundLimit)&&battle.mission.roundLimit>=4,`${battle.id} has a bounded mission length`);
  assert.equal(battle.mission.objectives.length,2,`${battle.id} defines a mission objective for each side`);
  assert.equal(battle.startingFleetIds.length,2);assert(battle.startingFleetIds.every(ids=>ids.length>=4&&ids.length<roster.units.length),`${battle.id} starts with a focused fleet, not the full roster`);
  for(const [index,ids] of battle.startingFleetIds.entries()){
    assert.equal(new Set(ids).size,ids.length,`${battle.id} side ${index+1} has no duplicate starting ships`);
    assert.deepEqual(match.units.filter(unit=>unit.ownerId===index+1).map(unit=>unit.asset.id),ids,`${battle.id} deploys its authored starting fleet`);
    assert(ids.every(id=>roster.units.some(asset=>asset.id===id)),`${battle.id} starting ship ids exist in the shared roster`);
  }
  assert.equal(match.units.length,battle.startingFleetIds.flat().length);
  assert.deepEqual(match.ports.map(port=>port.name),battle.ports.map(port=>port.name));assert(match.ports.every(port=>!port.homeForId&&isCoastalPort(world,port)),`${battle.id} keeps named objective ports on the coast without adding false headquarters`);
  for(const unit of match.units)assert(world.isSea(unit),`${battle.id} deployed ship ${unit.instanceId} is afloat`);
  const saved=match.save(),loaded=Match.load(saved,roster.units);assert.deepEqual(loaded.save(),saved,`${battle.id} save/load retains its map and campaign side names`);
  reports.push({id:battle.id,size:`${battle.width}x${battle.height}`,landCells:world.landCells,landPercent:Number((landRatio*100).toFixed(1)),unitsBySide:battle.startingFleetIds.map(ids=>ids.length),units:match.units.length,ports:match.ports.length,starts:world.startPositions.map(cell=>`${cell.col},${cell.row}`),preview:cellCenter(world.startPositions[0]),generationMs:Number(world.generationMs.toFixed(2))});
}
for(const battle of CAMPAIGN_BATTLES){
  const objective=battle.mission.objectives[1];if(objective.kind!=='capture-port')continue;
  const match=new Match(new HexWorld(battle.width,battle.height,battle.id),roster.units,2,['ai','human']),unit=match.units.find(item=>item.ownerId===2&&item.asset.ship_type.code==='DD'),port=match.ports[objective.portIndex];
  assert(unit,`${battle.id} gives Japan an eligible capture ship`);
  for(let round=1;round<=battle.mission.roundLimit&&!match.result;round++){
    match.activeIndex=1;
    if(unit.col===port.col&&unit.row===port.row){if(match.capturePreview(unit.instanceId,port.id).valid)match.capturePort(unit.instanceId,port.id);}
    else match.issueMove(unit.instanceId,port);
    match.endTurn();if(!match.result){match.activeIndex=0;match.endTurn();}
  }
  assert.equal(match.result?.winnerId,2,`${battle.id} Japanese port-capture objective is reachable before its deadline`);
  assert(match.result!.round<=battle.mission.roundLimit,`${battle.id} capture completes within the displayed time limit`);
}
{
  const battle=CAMPAIGN_BATTLES.find(item=>item.id==='midway')!,match=new Match(new HexWorld(battle.width,battle.height,battle.id),roster.units,2,['human','ai']);
  const japaneseCarriers=match.units.filter(unit=>unit.ownerId===2&&['CV','CVL'].includes(unit.asset.ship_type.code)).slice(0,2);
  assert.equal(japaneseCarriers.length,2,'Midway has two carrier targets for its primary objective');
  for(const carrier of japaneseCarriers)carrier.status='sunk';
  match.resolveOutcome();assert.equal(match.result?.winnerId,1,'sinking the required carriers completes the Allied mission');assert.equal(match.result?.reason,'objective');
}
{
  const battle=CAMPAIGN_BATTLES.find(item=>item.id==='coral-sea')!,match=new Match(new HexWorld(battle.width,battle.height,battle.id),roster.units,2,['ai','human']);
  match.ports[0].ownerId=2;match.resolveOutcome();assert.equal(match.result?.winnerId,2,'capturing Port Moresby completes the Japanese mission');
  const holdMatch=new Match(new HexWorld(battle.width,battle.height,battle.id),roster.units,2,['human','ai']);
  holdMatch.round=battle.mission.roundLimit+1;holdMatch.resolveOutcome();assert.equal(holdMatch.result?.winnerId,1,'holding Port Moresby to the deadline completes the Allied mission');assert.equal(holdMatch.result?.round,battle.mission.roundLimit);
}
{
  const battle=CAMPAIGN_BATTLES.find(item=>item.id==='pearl-harbor')!,match=new Match(new HexWorld(battle.width,battle.height,battle.id),roster.units,2,['human','ai']);
  match.round=battle.mission.roundLimit+1;match.resolveOutcome();assert.equal(match.result?.winnerId,1,'preserving the required fleet through the deadline wins Pearl Harbor');assert.equal(match.result?.reason,'time-limit');
}
console.log(JSON.stringify({battles:reports},null,2));
