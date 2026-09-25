import { readFileSync,writeFileSync } from 'node:fs';
import { Match } from '../src/match.ts';
import { launchWing } from '../src/aircraft.ts';
import { cellCenter } from '../src/hex.ts';
import type { Roster } from '../src/types.ts';

const assets=(JSON.parse(readFileSync('data/roster.json','utf8')) as Roster).units;
const match=Match.load(JSON.parse(readFileSync('output/combat-demo.json','utf8')),assets);
const own=match.units.find(u=>u.ownerId===1&&u.asset.ship_type.code==='CV')!;
const enemy=match.units.find(u=>u.ownerId===2&&u.asset.ship_type.code==='CV')!;
const fighter=launchWing(match,own.instanceId).find(s=>s.role==='fighter')!;
match.endTurn();const bomber=launchWing(match,enemy.instanceId).find(s=>s.role==='bomber')!;match.endTurn();
// Three hexes apart: move the fighter one hex toward the bomber to trigger automatic fire.
Object.assign(fighter,cellCenter({col:27,row:20}));Object.assign(bomber,cellCenter({col:30,row:20}));
match.aviation.squadrons=[fighter,bomber];
const saved=match.save();Match.load(saved,assets);
writeFileSync('output/fighter-patrol-demo.json',JSON.stringify(saved,null,2)+'\n');
console.log(JSON.stringify({fighter:fighter.id,bomber:bomber.id,start:{col:27,row:20},destination:{col:28,row:20},enemy:{col:30,row:20}}));
