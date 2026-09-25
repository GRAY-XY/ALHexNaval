import { readFileSync,writeFileSync } from 'node:fs';
import { Match } from '../src/match.ts';
import { HexWorld } from '../src/world.ts';
import type { Roster } from '../src/types.ts';
const assets=(JSON.parse(readFileSync('data/roster.json','utf8')) as Roster).units;
const world=new HexWorld(128), match=new Match(world,assets,2);
let origin:{col:number;row:number}|undefined;
outer:for(let row=12;row<110;row++)for(let col=12;col<108;col++){
  for(let y=0;y<14;y++)for(let x=0;x<16;x++)if(!world.isSea({col:col+x,row:row+y}))continue outer;
  origin={col,row};break outer;
}
if(!origin)throw Error('No open demo sea');
for(const team of match.teams)match.units.filter(u=>u.ownerId===team.id).forEach((u,i)=>{
  u.col=origin!.col+i%6*2;u.row=origin!.row+Math.floor(i/6)*2+(team.id===2?5:0);
});
const saved=match.save();Match.load(saved,assets);
writeFileSync('output/combat-demo.json',JSON.stringify(saved,null,2)+'\n');
console.log(JSON.stringify({origin,carrier:match.units.find(u=>u.ownerId===1&&u.asset.ship_type.code==='CV'),enemy:match.units.find(u=>u.ownerId===2)?.instanceId},(key,value)=>key==='asset'?value.name:value));
