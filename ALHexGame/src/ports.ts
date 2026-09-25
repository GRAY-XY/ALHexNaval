import {hexDistance,neighbors,fromAxial,toAxial} from './hex.ts';
import {cellKey} from './pathfinding.ts';
import {Terrain,type Cell} from './types.ts';
import type {MatchUnit} from './match.ts';
import type {HexWorld} from './world.ts';

export interface Port extends Cell {id:string;name:string;ownerId:number;homeForId?:number;usedRound:number}
export interface PortView {port:Port;ownerId:number;visible:boolean}
export interface MatchResult {winnerId:number|null;reason:'headquarters'|'elimination'|'draw';round:number}
export interface SavedCampaign {ports:Port[];intel:number[][];result?:MatchResult}
export const STARTING_CREDITS=40,PORT_INCOME=10,MAX_CREDITS=1_000_000_000;
export const PORT_OIL_BONUS=10;
export const REPAIR_LIMIT=4,REPAIR_PRICE=2;
export const REINFORCEMENT_COST:Record<string,number>={DD:20,CL:30,CA:40,BB:60,CV:70,CVL:50};

function berth(world:HexWorld,origin:Cell,ports:Port[],radius:number):Cell|undefined {
  const a=toAxial(origin),candidates:Cell[]=[];
  for(let q=-radius;q<=radius;q++)for(let r=-radius;r<=radius;r++){
    const cell=fromAxial(a.q+q,a.r+r);
    if(hexDistance(cell,origin)<=radius&&world.isSea(cell)&&neighbors(cell).filter(n=>world.isSea(n)).length>=3&&!ports.some(p=>hexDistance(p,cell)<8))candidates.push(cell);
  }
  candidates.sort((x,y)=>{
    const coast=(c:Cell)=>neighbors(c).some(n=>world.at(n)===Terrain.Land)?0:1;
    return coast(x)-coast(y)||hexDistance(x,origin)-hexDistance(y,origin)||x.row-y.row||x.col-y.col;
  });
  return candidates[0];
}
// Retained to validate v13 saves before relocating their offshore harbors.
export function createLegacyPorts(world:HexWorld,units:MatchUnit[],players:number):Port[] {
  const ports:Port[]=[];
  for(let ownerId=1;ownerId<=players;ownerId++){
    const first=units.find(u=>u.ownerId===ownerId)!;
    const cell=berth(world,first,ports,3)??world.nearbySea(first,new Set(ports.map(cellKey)));
    ports.push({...cell,id:`home-${ownerId}`,name:`${ownerId}号母港`,ownerId,homeForId:ownerId,usedRound:0});
  }
  for(let row=16;row<world.height;row+=32)for(let col=16;col<world.width;col+=32){
    const cell=berth(world,{col,row},ports,6);if(!cell)continue;
    ports.push({...cell,id:`port-${col}-${row}`,name:`群岛港 ${ports.length-players+1}`,ownerId:0,usedRound:0});
  }
  return ports;
}
export function isCoastalPort(world:HexWorld,cell:Cell):boolean {
  return world.isSea(cell)&&neighbors(cell).some(n=>world.at(n)===Terrain.Land)&&neighbors(cell).filter(n=>world.isSea(n)).length>=3;
}
export function createPorts(world:HexWorld,units:MatchUnit[],players:number):Port[] {
  const ports=createLegacyPorts(world,units,players),offshore=ports.filter(p=>!isCoastalPort(world,p));
  if(!offshore.length)return ports;
  const coast:Cell[]=[];
  for(let row=0;row<world.height;row++)for(let col=0;col<world.width;col++){const c={col,row};if(isCoastalPort(world,c))coast.push(c);}
  const assigned=ports.filter(p=>isCoastalPort(world,p)),occupied=new Set(assigned.map(cellKey));
  for(const p of offshore){
    let best:Cell|undefined,bestDistance=Infinity,fallback:Cell|undefined,fallbackDistance=Infinity;
    for(const c of coast){
      if(occupied.has(cellKey(c)))continue;
      const d=hexDistance(p,c);
      if(d<fallbackDistance){fallback=c;fallbackDistance=d;}
      if(d<bestDistance&&!assigned.some(v=>hexDistance(v,c)<8)){best=c;bestDistance=d;}
    }
    const c=best??fallback;if(!c)throw Error('海图没有足够的沿岸海格建立港口');
    Object.assign(p,c);assigned.push(p);occupied.add(cellKey(p));
  }
  return ports;
}
