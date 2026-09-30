import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cellCenter, hexDistance } from '../src/hex.ts';
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
  for(const landmark of world.landmarks)assert.equal(world.at(landmark),Terrain.Land,`${battle.id} landmark ${landmark.id} is placed on land`);
  for(const start of world.startPositions)assert(world.isSea(start),`${battle.id} fleet start is water`);
  assert(hexDistance(world.startPositions[0],world.startPositions[1])>18,`${battle.id} opposing forces start apart`);
  const match=new Match(world,roster.units,2,['human','ai']);
  assert.deepEqual(match.teams.map(team=>team.name),battle.sides);assert.equal(match.units.length,roster.units.length*2);
  assert.deepEqual(match.ports.map(port=>port.name),battle.ports.map(port=>port.name));assert(match.ports.every(port=>!port.homeForId&&isCoastalPort(world,port)),`${battle.id} keeps named objective ports on the coast without adding false headquarters`);
  for(const unit of match.units)assert(world.isSea(unit),`${battle.id} deployed ship ${unit.instanceId} is afloat`);
  const saved=match.save(),loaded=Match.load(saved,roster.units);assert.deepEqual(loaded.save(),saved,`${battle.id} save/load retains its map and campaign side names`);
  reports.push({id:battle.id,size:`${battle.width}x${battle.height}`,landCells:world.landCells,landPercent:Number((landRatio*100).toFixed(1)),units:match.units.length,ports:match.ports.length,starts:world.startPositions.map(cell=>`${cell.col},${cell.row}`),preview:cellCenter(world.startPositions[0]),generationMs:Number(world.generationMs.toFixed(2))});
}
console.log(JSON.stringify({battles:reports},null,2));
