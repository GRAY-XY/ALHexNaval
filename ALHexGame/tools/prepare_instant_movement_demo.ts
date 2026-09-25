import {readFileSync,writeFileSync} from 'node:fs';
import {Match} from '../src/match.ts';
import {cellKey} from '../src/pathfinding.ts';
import type {Roster} from '../src/types.ts';

const assets=(JSON.parse(readFileSync('data/roster.json','utf8')) as Roster).units;
const data=JSON.parse(readFileSync('output/state-animation-demo.json','utf8'));
data.version=10;data.teams[0].oil=2;
const match=Match.load(data,assets),ship=match.unit('team-1-lafei');
data.units.find((unit:any)=>unit.instanceId===ship.instanceId).order=match.world.nearbySea({col:100,row:100});
data.units.find((unit:any)=>unit.instanceId===ship.instanceId).notice='自动航线受阻';
const occupied=new Set(match.units.filter(u=>u.status!=='sunk').map(cellKey));
const targets=[];
for(let row=Math.max(0,ship.row-8);row<=Math.min(match.world.height-1,ship.row+8);row++)for(let col=Math.max(0,ship.col-8);col<=Math.min(match.world.width-1,ship.col+8);col++){
  const cell={col,row};if(occupied.has(cellKey(cell)))continue;
  const route=match.route(ship.instanceId,cell);if(route)targets.push({cell,cost:route.cost});
}
writeFileSync('output/instant-movement-demo.json',JSON.stringify(data,null,2)+'\n');
console.log(JSON.stringify({legacyVersion:10,oil:2,ship:{col:ship.col,row:ship.row},targets}));
