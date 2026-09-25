import {readFileSync,writeFileSync} from 'node:fs';
import {Match,type MatchUnit} from '../src/match.ts';
import {HexWorld} from '../src/world.ts';
import {hexDistance} from '../src/hex.ts';
import type {Roster} from '../src/types.ts';
const assets=(JSON.parse(readFileSync('data/roster.json','utf8')) as Roster).units;
function sink(u:MatchUnit){Object.assign(u,{hp:0,action:0,status:'sunk',guard:false,col:80,row:80});delete u.availableRound;}
function ship(m:Match,id:string,col:number,row:number,hp?:number){const u=m.unit(id);Object.assign(u,{col,row,hp:hp??u.maxHp,action:1,status:'ready',guard:false});return u;}
function write(name:string,m:Match){const data=m.save();Match.load(data,assets);writeFileSync(`output/${name}.json`,JSON.stringify(data,null,2)+'\n');console.log(JSON.stringify({name,ports:m.knownPorts().map(v=>({id:v.port.id,name:v.port.name,col:v.port.col,row:v.port.row,owner:v.ownerId})),units:m.units.filter(u=>u.ownerId===1&&u.hp>0).map(u=>({id:u.instanceId,col:u.col,row:u.row,hp:u.hp}))}));}
const m=new Match(new HexWorld(128),assets,2),home=m.port('home-1'),neutral=m.ports.filter(p=>!p.ownerId&&hexDistance(p,home)>=8&&m.units.every(u=>u.ownerId===1||hexDistance(u,p)>8)).sort((a,b)=>hexDistance(a,home)-hexDistance(b,home))[0];
if(!neutral)throw new Error('Missing neutral demo port');
m.units.filter(u=>u.ownerId===1).forEach(sink);ship(m,'team-1-bisimai',home.col,home.row,8);ship(m,'team-1-lafei',neutral.col,neutral.row);m.active.credits=100;write('ports-demo',m);
for(const elimination of [false,true]){const battle=new Match(new HexWorld(128),assets,2),p=battle.port('home-2');battle.units.forEach(sink);ship(battle,'team-1-lafei',p.col,p.row);if(!elimination){const distant=battle.world.nearbySea({col:65,row:80});ship(battle,'team-2-biaoqiang',distant.col,distant.row);}write(elimination?'ports-elimination-demo':'ports-victory-demo',battle);}
