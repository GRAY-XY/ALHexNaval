import {Container,Graphics,Sprite,Texture} from 'pixi.js';
import {cellCenter,HEX_RADIUS,HEX_WIDTH,ROW_HEIGHT,hexVertices} from './hex.ts';
import type {FogOfWar} from './fog.ts';
import type {HexWorld} from './world.ts';
import {randomAt} from './world.ts';
import type {ViewBounds} from './types.ts';

export class FogRenderer {
  readonly container=new Container();
  readonly overviewCanvas:HTMLCanvasElement;
  private overview:Sprite;
  private detail=new Graphics();
  private context:CanvasRenderingContext2D;
  private owner=0;
  private revision=-1;
  private previous=new Set<number>();
  private scale:number;
  private world:HexWorld;
  private fog:FogOfWar;
  constructor(world:HexWorld,fog:FogOfWar){
    this.world=world;this.fog=fog;this.container.eventMode='none';
    this.scale=Math.min(1,1024/world.bounds.width);this.overviewCanvas=document.createElement('canvas');
    this.overviewCanvas.width=Math.ceil(world.bounds.width*this.scale);this.overviewCanvas.height=Math.ceil(world.bounds.height*this.scale);
    this.context=this.overviewCanvas.getContext('2d')!;this.overview=new Sprite(Texture.from(this.overviewCanvas));
    this.overview.width=world.bounds.width;this.overview.height=world.bounds.height;this.container.addChild(this.overview,this.detail);
  }
  update(bounds:ViewBounds,zoom:number,owner:number):void {
    const field=this.fog.field(owner),c=this.context;
    if(owner!==this.owner||this.revision!==this.fog.revision){
      c.save();c.setTransform(1,0,0,1,0,0);
      if(owner!==this.owner){c.clearRect(0,0,this.overviewCanvas.width,this.overviewCanvas.height);c.fillStyle='#10293b';c.fillRect(0,0,this.overviewCanvas.width,this.overviewCanvas.height);this.previous=new Set(field.known);}
      c.scale(this.scale,this.scale);
      for(const i of new Set([...this.previous,...field.lit])){
        const cell={col:i%this.world.width,row:Math.floor(i/this.world.width)},vertices=hexVertices(cellCenter(cell));
        c.beginPath();vertices.forEach((p,j)=>j?c.lineTo(p.x,p.y):c.moveTo(p.x,p.y));c.closePath();
        c.globalCompositeOperation='destination-out';c.fillStyle='#000';c.fill();c.globalCompositeOperation='source-over';
        if(!field.visible[i]){c.fillStyle=field.explored[i]?'rgba(19,48,61,0.66)':'#10293b';c.fill();}
      }
      c.restore();this.previous=new Set(field.lit);this.owner=owner;this.revision=this.fog.revision;this.overview.texture.baseTexture.update();
    }
    const minRow=Math.max(0,Math.floor(bounds.top/ROW_HEIGHT)-2),maxRow=Math.min(this.world.height-1,Math.ceil(bounds.bottom/ROW_HEIGHT)+2);
    const minCol=Math.max(0,Math.floor(bounds.left/HEX_WIDTH)-2),maxCol=Math.min(this.world.width-1,Math.ceil(bounds.right/HEX_WIDTH)+2);
    const detailed=zoom>=.36&&(maxRow-minRow+1)*(maxCol-minCol+1)<=4000;
    this.overview.visible=!detailed;this.detail.visible=detailed;this.detail.clear();if(!detailed)return;
    for(let row=minRow;row<=maxRow;row++)for(let col=minCol;col<=maxCol;col++){
      const cell={col,row};if(!this.world.contains(cell))continue;const state=this.fog.state(owner,cell);if(state===2)continue;
      const wash=randomAt(col,row,97),color=state===1?(wash>.52?0x173d4b:0x143342):(wash>.52?0x102d43:0x0d2639);
      this.detail.beginFill(color,state===1?.62+.12*wash:.95).drawPolygon(hexVertices(cellCenter(cell),HEX_RADIUS+.2).flatMap(p=>[p.x,p.y])).endFill();
    }
  }
  destroy():void {this.overview.texture.destroy(true);this.container.destroy({children:true});}
}
