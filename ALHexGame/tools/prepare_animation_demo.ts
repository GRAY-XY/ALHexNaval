import { readFileSync, writeFileSync } from 'node:fs';
import { Match } from '../src/match.ts';
import { HexWorld } from '../src/world.ts';
import { cellKey } from '../src/pathfinding.ts';
import type { Roster } from '../src/types.ts';

const assets=(JSON.parse(readFileSync('data/roster.json','utf8')) as Roster).units;
const match=new Match(new HexWorld(128),assets,2);
let origin:{col:number;row:number}|undefined;
outer:for(let row=10;row<112;row++)for(let col=10;col<112;col++){
  for(let y=0;y<8;y++)for(let x=0;x<9;x++)if(!match.world.isSea({col:col+x,row:row+y}))continue outer;
  origin={col,row};break outer;
}
if(!origin)throw Error('No open animation demo sea');
const anchors:Record<string,{col:number;row:number}>={
  'team-1-lafei':{col:origin.col,row:origin.row},'team-2-lafei':{col:origin.col+3,row:origin.row},
  'team-1-bisimai':{col:origin.col,row:origin.row+3},'team-2-bisimai':{col:origin.col+4,row:origin.row+3},
  'team-1-qiye':{col:origin.col,row:origin.row+6},'team-1-dujiaoshou':{col:origin.col+3,row:origin.row+6},
};
const occupied=new Set(Object.values(anchors).map(cellKey));
match.units.forEach((unit,i)=>{
  const preferred=anchors[unit.instanceId];
  if(preferred) {if(!match.world.isSea(preferred))throw Error('Animation demo anchor is blocked');Object.assign(unit,preferred);}
  else {const cell=match.world.nearbySea({col:80+i%6*2,row:80+Math.floor(i/6)*3},occupied);Object.assign(unit,cell);occupied.add(cellKey(cell));}
});
match.unit('team-2-lafei').hp=3;
const saved=match.save();Match.load(saved,assets);
writeFileSync('output/state-animation-demo.json',JSON.stringify(saved,null,2)+'\n');
console.log(JSON.stringify({origin,ships:6,enemyHp:3,saveVersion:saved.version}));
