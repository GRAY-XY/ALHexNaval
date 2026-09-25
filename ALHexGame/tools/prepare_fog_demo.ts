import {readFileSync,writeFileSync} from 'node:fs';
import {Match} from '../src/match.ts';
import {HexWorld} from '../src/world.ts';
import {hexDistance} from '../src/hex.ts';
import type {Roster} from '../src/types.ts';

const data=JSON.parse(readFileSync('output/state-animation-demo.json','utf8'));
data.version=11;delete data.fog;
const heroes=new Set(['team-1-lafei','team-1-qiye','team-2-lafei','team-2-biaoqiang']);
for(const u of data.units){
  delete u.order;
  u.status=heroes.has(u.instanceId)?'ready':'sunk';u.hp=heroes.has(u.instanceId)?u.maxHp:0;
  u.action=heroes.has(u.instanceId)?1:0;u.guard=false;u.cooldowns={};
}
const world=new HexWorld(128);
Object.assign(data.units.find((u:any)=>u.instanceId==='team-1-qiye'),world.nearbySea({col:20,row:32}));
Object.assign(data.units.find((u:any)=>u.instanceId==='team-2-biaoqiang'),world.nearbySea({col:35,row:20}));
data.aviation.squadrons=[];
const roster=(JSON.parse(readFileSync('data/roster.json','utf8')) as Roster).units;
const m=Match.load(data,roster),ship=m.unit('team-1-lafei')!,enemy=m.unit('team-2-lafei')!;
const candidates=[];
for(let row=Math.max(0,ship.row-10);row<Math.min(world.height,ship.row+11);row++)for(let col=Math.max(0,ship.col-10);col<Math.min(world.width,ship.col+11);col++){
  const cell={col,row};if(hexDistance(cell,enemy)<=6)continue;
  const path=m.route(ship.instanceId,cell);if(path&&path.cost<=6&&path.cost>=4)candidates.push({cell,cost:path.cost});
}
writeFileSync('output/fog-demo.json',JSON.stringify(data,null,2));
console.log(JSON.stringify({ship:{col:ship.col,row:ship.row},carrier:data.units.find((u:any)=>u.instanceId==='team-1-qiye'),enemy:{col:enemy.col,row:enemy.row},retreats:candidates.slice(0,12)}));
