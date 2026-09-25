import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import {ART_DIRECTIONS,harborOutwardDirection} from '../src/directional-art.ts';
import {Match} from '../src/match.ts';
import {Terrain,type Roster} from '../src/types.ts';
import {HexWorld,randomAt} from '../src/world.ts';

const kinds=['coast','harbor','mountain'] as const;
const assets=[] as {kind:string;direction:string;index:number;path:string;bytes:number;sha256:string;width:number;height:number}[];
for(const kind of kinds)for(const [index,direction] of ART_DIRECTIONS.entries()){
  const path=`assets/terrain/directional/watercolor-${kind}-${index}-${direction}.png`,data=readFileSync(path);
  assert.equal(data.subarray(1,4).toString(),'PNG');const width=data.readUInt32BE(16),height=data.readUInt32BE(20);
  assert.equal(width,512);assert.equal(height,512);
  assets.push({kind,direction,index,path,bytes:data.length,sha256:createHash('sha256').update(data).digest('hex'),width,height});
}
const roster=(JSON.parse(readFileSync('data/roster.json','utf8')) as Roster).units,world=new HexWorld(512),match=new Match(world,roster,8);
const harborDirections=Array(6).fill(0),coastDirections=Array(6).fill(0),mountainDirections=Array(6).fill(0);
for(const port of match.ports)harborDirections[harborOutwardDirection(world,port)]++;
for(let row=0;row<world.height;row++)for(let col=0;col<world.width;col++){
  const cell={col,row};if(world.at(cell)!==Terrain.Land)continue;
  const adjacent=[{col:col+1,row},{col:col+(row&1),row:row+1},{col:col-1+(row&1),row:row+1},{col:col-1,row},{col:col-1+(row&1),row:row-1},{col:col+(row&1),row:row-1}];
  adjacent.forEach((next,direction)=>{if(world.at(next)!==Terrain.Land)coastDirections[direction]++;});
  mountainDirections[Math.floor(randomAt(col,row,80)*6)]++;
}
for(const counts of [harborDirections,coastDirections,mountainDirections])assert(counts.every(count=>count>0));
const report={passed:true,directionOrder:ART_DIRECTIONS,assets,coverage:{harbors:harborDirections,coasts:coastDirections,mountains:mountainDirections},map:{size:512,players:8,ports:match.ports.length}};
writeFileSync('output/directional-art-verification.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({passed:true,assets:assets.length,directionOrder:ART_DIRECTIONS,coverage:report.coverage,ports:match.ports.length}));
