import {fromAxial,toAxial,worldToCell} from './hex.ts';
import type {MatchUnit} from './match.ts';
import type {Squadron} from './aircraft.ts';
import type {Cell} from './types.ts';
import type {HexWorld} from './world.ts';

export const SHIP_VISION=6, AIR_VISION=8;
export interface SavedFog {explored:string[]}
interface VisionField {explored:Uint8Array;visible:Uint8Array;known:Set<number>;lit:Set<number>}
export class FogOfWar {
  private fields:VisionField[];
  private signature?:string;
  revision=0;
  private world:HexWorld;
  constructor(world:HexWorld,teams:number){
    this.world=world;this.fields=Array.from({length:teams},()=>({explored:new Uint8Array(world.width*world.height),visible:new Uint8Array(world.width*world.height),known:new Set<number>(),lit:new Set<number>()}));
  }
  field(owner:number):VisionField {const field=this.fields[owner-1];if(!field)throw Error('无效的视野所属玩家');return field;}
  state(owner:number,cell:Cell):0|1|2 {
    if(!this.world.contains(cell))return 0;
    const field=this.field(owner),i=cell.row*this.world.width+cell.col;return field.visible[i]?2:field.explored[i]?1:0;
  }
  private reveal(owner:number,center:Cell,radius:number):void {
    const field=this.field(owner),a=toAxial(center);
    for(let q=-radius;q<=radius;q++)for(let r=Math.max(-radius,-q-radius);r<=Math.min(radius,-q+radius);r++){
      const cell=fromAxial(a.q+q,a.r+r);if(!this.world.contains(cell))continue;
      const i=cell.row*this.world.width+cell.col;field.visible[i]=1;field.explored[i]=1;field.lit.add(i);field.known.add(i);
    }
  }
  refresh(units:MatchUnit[],air:Squadron[]):boolean {
    const sources=units.filter(u=>u.status!=='sunk').map(u=>({owner:u.ownerId,cell:{col:u.col,row:u.row},radius:SHIP_VISION}))
      .concat(air.filter(s=>s.hp>0&&s.fuelTurns>0).map(s=>({owner:s.ownerId,cell:worldToCell(s),radius:AIR_VISION})));
    const signature=sources.map(s=>`${s.owner}:${s.cell.col},${s.cell.row}:${s.radius}`).join('|');
    if(signature===this.signature)return false;this.signature=signature;
    for(const field of this.fields){for(const i of field.lit)field.visible[i]=0;field.lit.clear();}
    for(const s of sources)this.reveal(s.owner,s.cell,s.radius);
    this.revision++;return true;
  }
  save():SavedFog {
    return {explored:this.fields.map(field=>{
      const bytes=new Uint8Array(Math.ceil(field.explored.length/8));for(const i of field.known)bytes[i>>3]|=1<<(i&7);
      let binary='';for(const byte of bytes)binary+=String.fromCharCode(byte);return btoa(binary);
    })};
  }
  load(input:unknown):void {
    const data=input as SavedFog,bytes=Math.ceil(this.world.width*this.world.height/8);
    if(!data||!Array.isArray(data.explored)||data.explored.length!==this.fields.length)throw Error('迷雾存档格式无效');
    const decoded=data.explored.map(text=>{
      if(typeof text!=='string'||text.length!==Math.ceil(bytes/3)*4||!/^[A-Za-z0-9+/]+={0,2}$/.test(text))throw Error('迷雾存档格式无效');
      const raw=atob(text);if(raw.length!==bytes||btoa(raw)!==text)throw Error('迷雾存档格式无效');return raw;
    });
    decoded.forEach((raw,index)=>{
      const field=this.fields[index];field.explored.fill(0);field.known.clear();
      for(let i=0;i<field.explored.length;i++)if(raw.charCodeAt(i>>3)&1<<(i&7)){
        if(!this.world.contains({col:i%this.world.width,row:Math.floor(i/this.world.width)}))throw Error('迷雾存档包含无效海格');
        field.explored[i]=1;field.known.add(i);
      }
    });this.signature=undefined;this.revision++;
  }
}
