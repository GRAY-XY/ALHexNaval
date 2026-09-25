import { readFileSync, writeFileSync } from 'node:fs';
import { Match } from '../src/match.ts';
import { launchWing } from '../src/aircraft.ts';
import { cellCenter } from '../src/hex.ts';
import type { Roster } from '../src/types.ts';

const assets=(JSON.parse(readFileSync('data/roster.json','utf8')) as Roster).units;
const match=Match.load(JSON.parse(readFileSync('output/combat-demo.json','utf8')),assets);
const carrier=match.units.find(u=>u.ownerId===1&&u.asset.ship_type.code==='CV')!;
const wing=launchWing(match,carrier.instanceId);
// A quiet asymmetric formation isolates grid movement from combat and automatic recall.
[{col:27,row:18},{col:29,row:18},{col:27,row:20}].forEach((cell,i)=>Object.assign(wing[i],cellCenter(cell)));
const saved=match.save();Match.load(saved,assets);
writeFileSync('output/air-hex-demo.json',JSON.stringify(saved,null,2)+'\n');
console.log(JSON.stringify({squadrons:wing.map(s=>s.id),actionPoints:20,oil:match.active.oil}));
