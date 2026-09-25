import { readFileSync, writeFileSync } from 'node:fs';
import { Match } from '../src/match.ts';
import { launchWing } from '../src/aircraft.ts';
import { cellCenter } from '../src/hex.ts';
import type { Roster } from '../src/types.ts';

const assets=(JSON.parse(readFileSync('data/roster.json','utf8')) as Roster).units;
const match=Match.load(JSON.parse(readFileSync('output/combat-demo.json','utf8')),assets);
const carrier=match.units.find(u=>u.ownerId===1&&u.asset.ship_type.code==='CV')!;
const wing=launchWing(match,carrier.instanceId),fighter=wing[0];
// A nearly depleted fighter far from home makes compulsory return visible in the UI.
Object.assign(fighter,cellCenter({col:55,row:20}),{actionPoints:1});
const saved=match.save();Match.load(saved,assets);
writeFileSync('output/air-action-demo.json',JSON.stringify(saved,null,2)+'\n');
console.log(JSON.stringify({fighter:fighter.id,actionPoints:fighter.actionPoints,carrier:carrier.asset.name,oil:match.active.oil}));
