import {Container,Sprite,Texture} from 'pixi.js';
import {cellCenter,HEX_RADIUS,HEX_WIDTH,hexVertices,neighbors,ROW_HEIGHT} from './hex.ts';
import {HexWorld,randomAt,TERRAIN_COLORS} from './world.ts';
import {Terrain,type Cell,type ViewBounds} from './types.ts';
import {watercolorTextures} from './watercolor-textures.ts';

const CHUNK_SIZE=6;
const TEXTURE_SCALE=.86;
const DECORATION_PAD=70;
const MAX_CACHED_CHUNKS=96;
const MAX_CACHED_MOUNTAINS=128;
const MAX_CACHED_LAND_DETAILS=160;
const DETAIL_ZOOM=.36;
interface Chunk {sprite:Sprite;lastUsed:number;bytes:number}
interface Mountain {sprite:Sprite;lastUsed:number}

function polygon(context:CanvasRenderingContext2D,cell:Cell):void {
  const corners=hexVertices(cellCenter(cell));
  context.beginPath();corners.forEach((point,index)=>index?context.lineTo(point.x,point.y):context.moveTo(point.x,point.y));context.closePath();
}

function landNeighborCount(world:HexWorld,cell:Cell):number {
  return neighbors(cell).filter(next=>world.at(next)===Terrain.Land).length;
}

function isMountainSeed(world:HexWorld,cell:Cell):boolean {
  if(world.at(cell)!==Terrain.Land||landNeighborCount(world,cell)<5)return false;
  const score=randomAt(cell.col,cell.row,76);if(score>.32)return false;
  for(let row=cell.row-3;row<=cell.row+3;row++)for(let col=cell.col-3;col<=cell.col+3;col++){
    if(col===cell.col&&row===cell.row)continue;const next={col,row};
    if(world.at(next)===Terrain.Land&&landNeighborCount(world,next)>=5&&randomAt(col,row,76)<score)return false;
  }
  return true;
}

function isLandDetailSeed(world:HexWorld,cell:Cell):boolean {
  if(world.at(cell)!==Terrain.Land||landNeighborCount(world,cell)<3||isMountainSeed(world,cell))return false;
  const score=randomAt(cell.col,cell.row,512);if(score>.42)return false;
  for(let row=cell.row-2;row<=cell.row+2;row++)for(let col=cell.col-2;col<=cell.col+2;col++){
    if(col===cell.col&&row===cell.row)continue;const next={col,row};
    if(world.at(next)===Terrain.Land&&landNeighborCount(world,next)>=3&&randomAt(col,row,512)<score)return false;
  }
  return true;
}

function drawWaves(context:CanvasRenderingContext2D,cell:Cell,terrain:Terrain):void {
  const center=cellCenter(cell),hash=randomAt(cell.col,cell.row,20);if(hash<.2)return;
  const count=terrain===Terrain.Shallow?2:hash>.76?2:1;
  context.save();context.lineCap='round';context.globalCompositeOperation='screen';
  context.strokeStyle=terrain===Terrain.Shallow?'rgba(255,247,219,.48)':terrain===Terrain.Sea?'rgba(225,244,238,.28)':'rgba(193,226,224,.18)';
  context.lineWidth=terrain===Terrain.Shallow?1.45:1.05;
  for(let index=0;index<count;index++){
    const drift=randomAt(cell.col,cell.row,21+index),width=terrain===Terrain.Shallow?15+drift*10:20+drift*16;
    const y=center.y+(drift-.5)*26+index*7-3,x=center.x-width/2;
    context.beginPath();context.moveTo(x,y);context.bezierCurveTo(x+width*.28,y-4-drift*2,x+width*.58,y+4,x+width,y-1);context.stroke();
  }
  if(terrain===Terrain.Shallow&&hash>.67){
    context.fillStyle='rgba(255,248,221,.32)';
    for(let index=0;index<3;index++){const drift=randomAt(cell.col,cell.row,27+index);context.beginPath();context.arc(center.x-17+drift*34,center.y+14+(index%2)*4,1.1+drift,0,Math.PI*2);context.fill();}
  }
  context.restore();
}

function drawLandMass(context:CanvasRenderingContext2D,cells:Cell[],radius:number,paint:string|CanvasPattern,radiusSalt=103,radiusVariation=1.6):void {
  const corner=Math.min(14,radius*.3),shapes=new Map(cells.map(cell=>{
    const base=cellCenter(cell),center={x:base.x+(randomAt(cell.col,cell.row,101)-.5)*3,y:base.y+(randomAt(cell.col,cell.row,102)-.5)*3};
    return [`${cell.col},${cell.row}`,{center,radius:radius+(randomAt(cell.col,cell.row,radiusSalt)-.5)*radiusVariation}] as const;
  }));
  context.save();context.fillStyle=paint;context.strokeStyle=paint;context.lineCap='round';context.lineJoin='round';
  for(const cell of cells){
    const shape=shapes.get(`${cell.col},${cell.row}`)!;
    for(const next of neighbors(cell))if((next.row>cell.row||next.row===cell.row&&next.col>cell.col)){
      const nextShape=shapes.get(`${next.col},${next.row}`);if(!nextShape)continue;
      context.lineWidth=(shape.radius+nextShape.radius)*.86;context.beginPath();context.moveTo(shape.center.x,shape.center.y);context.lineTo(nextShape.center.x,nextShape.center.y);context.stroke();
    }
  }
  context.beginPath();
  for(const cell of cells){
    const shape=shapes.get(`${cell.col},${cell.row}`)!,points=hexVertices(shape.center,shape.radius);
    for(let index=0;index<points.length;index++){
      const previous=points[(index+points.length-1)%points.length],point=points[index],next=points[(index+1)%points.length];
      const previousLength=Math.hypot(previous.x-point.x,previous.y-point.y)||1,nextLength=Math.hypot(next.x-point.x,next.y-point.y)||1;
      const entry={x:point.x+(previous.x-point.x)*corner/previousLength,y:point.y+(previous.y-point.y)*corner/previousLength};
      const exit={x:point.x+(next.x-point.x)*corner/nextLength,y:point.y+(next.y-point.y)*corner/nextLength};
      if(index===0)context.moveTo(entry.x,entry.y);else context.lineTo(entry.x,entry.y);
      context.quadraticCurveTo(point.x,point.y,exit.x,exit.y);
    }
    context.closePath();
  }
  context.fill();context.restore();
}

function drawDirectionalCoasts(context:CanvasRenderingContext2D,world:HexWorld,cells:Cell[],coasts:HTMLCanvasElement[]):void {
  context.save();context.globalAlpha=.18;
  for(const cell of cells){
    const center=cellCenter(cell);
    neighbors(cell).forEach((next,direction)=>{
      if(world.at(next)===Terrain.Land||randomAt(cell.col,cell.row,140+direction)<.92)return;
      const outside=cellCenter(next),dx=outside.x-center.x,dy=outside.y-center.y,length=Math.hypot(dx,dy)||1;
      const size=54+randomAt(cell.col,cell.row,120+direction)*6,tangent=(randomAt(cell.col,cell.row,130+direction)-.5)*3;
      const x=(center.x+outside.x)/2-dy/length*tangent,y=(center.y+outside.y)/2+dx/length*tangent;
      context.drawImage(coasts[direction],x-size/2,y-size/2,size,size);
    });
  }
  context.restore();
}

function drawShorelineDetails(context:CanvasRenderingContext2D,world:HexWorld,cells:Cell[]):void {
  context.save();context.lineCap='round';
  for(const cell of cells){
    const center=cellCenter(cell);
    neighbors(cell).forEach((next,direction)=>{
      if(world.at(next)===Terrain.Land)return;
      const seed=randomAt(cell.col,cell.row,610+direction);if(seed<.25)return;
      const outside=cellCenter(next),dx=outside.x-center.x,dy=outside.y-center.y,length=Math.hypot(dx,dy)||1,ux=dx/length,uy=dy/length,tx=-uy,ty=ux;
      const tangent=(randomAt(cell.col,cell.row,620+direction)-.5)*7,radial=44+randomAt(cell.col,cell.row,630+direction)*2.2,len=11+randomAt(cell.col,cell.row,640+direction)*13;
      const x=center.x+ux*radial+tx*tangent,y=center.y+uy*radial+ty*tangent,bend=2+randomAt(cell.col,cell.row,650+direction)*2.5;
      context.strokeStyle='rgba(255,255,238,.8)';context.lineWidth=.9+randomAt(cell.col,cell.row,660+direction)*.65;context.beginPath();context.moveTo(x-tx*len/2,y-ty*len/2);context.quadraticCurveTo(x+ux*bend,y+uy*bend,x+tx*len/2,y+ty*len/2);context.stroke();
      if(seed>.76){
        context.fillStyle='rgba(156,126,79,.4)';
        for(let index=0;index<3;index++){const drift=(randomAt(cell.col,cell.row,670+direction*3+index)-.5)*len;context.beginPath();context.arc(center.x+ux*40+tx*drift,center.y+uy*40+ty*drift,.7+index*.22,0,Math.PI*2);context.fill();}
      }
    });
  }
  context.restore();
}

function isForestSeed(world:HexWorld,cell:Cell):boolean {
  if(world.at(cell)!==Terrain.Land||landNeighborCount(world,cell)<2||isMountainSeed(world,cell))return false;
  const isLocalMinimum=(salt:number,limit:number)=>{
    const score=randomAt(cell.col,cell.row,salt);if(score>limit)return false;
    for(let row=cell.row-1;row<=cell.row+1;row++)for(let col=cell.col-1;col<=cell.col+1;col++){
      if(col===cell.col&&row===cell.row)continue;
      if(world.at({col,row})===Terrain.Land&&randomAt(col,row,salt)<score)return false;
    }
    return true;
  };
  return isLocalMinimum(212,.55)||isLocalMinimum(412,.4);
}

function drawConifer(context:CanvasRenderingContext2D,x:number,y:number,size:number,tone:number):void {
  context.strokeStyle='rgba(77,67,48,.76)';context.lineWidth=Math.max(1.2,size*.1);context.beginPath();context.moveTo(x,y+size*.54);context.lineTo(x,y-size*.48);context.stroke();
  const colors=tone>.52?['#315f4f','#47725a','#668662']:['#274f47','#386457','#547864'];
  colors.forEach((color,layer)=>{const top=y-size+layer*size*.28,half=size*(.58-layer*.07);context.fillStyle=color;context.beginPath();context.moveTo(x,top);context.lineTo(x-half,y+size*(.15+layer*.2));context.quadraticCurveTo(x,y+size*(.02+layer*.16),x+half,y+size*(.15+layer*.2));context.closePath();context.fill();});
}

function drawBroadleaf(context:CanvasRenderingContext2D,x:number,y:number,size:number,tone:number):void {
  context.strokeStyle='rgba(84,68,47,.72)';context.lineWidth=Math.max(1.2,size*.1);context.beginPath();context.moveTo(x,y+size*.54);context.lineTo(x,y-size*.16);context.stroke();
  const colors=tone>.5?['rgba(72,105,66,.96)','rgba(93,127,72,.95)','rgba(125,146,84,.9)']:['rgba(54,91,67,.96)','rgba(72,111,72,.95)','rgba(103,132,78,.9)'];
  const crowns=[[-.28,-.34,.46],[.28,-.3,.43],[0,-.58,.5],[-.06,-.14,.48]];
  crowns.forEach(([dx,dy,scale],index)=>{context.fillStyle=colors[index%colors.length];context.beginPath();context.arc(x+size*dx,y+size*dy,size*scale,0,Math.PI*2);context.fill();});
}

function drawForestGrove(context:CanvasRenderingContext2D,cell:Cell,interior:number):void {
  const center=cellCenter(cell),count=8+Math.floor(randomAt(cell.col,cell.row,213)*6)+(interior>=5?2:0),trees:Array<{x:number;y:number;size:number;tone:number;broadleaf:boolean}>=[];
  context.save();context.globalCompositeOperation='multiply';
  context.fillStyle='rgba(54,91,59,.13)';context.beginPath();context.ellipse(center.x,center.y+6,50,27,-.12,0,Math.PI*2);context.fill();
  context.fillStyle='rgba(116,126,70,.14)';context.beginPath();context.ellipse(center.x-13,center.y-1,34,22,.2,0,Math.PI*2);context.fill();
  context.globalCompositeOperation='source-over';
  for(let index=0;index<count;index++){
    const spread=Math.sqrt(randomAt(cell.col,cell.row,230+index)),angle=randomAt(cell.col,cell.row,250+index)*Math.PI*2;
    const x=center.x+Math.cos(angle)*spread*(42+randomAt(cell.col,cell.row,270+index)*16),y=center.y+Math.sin(angle)*spread*(23+randomAt(cell.col,cell.row,290+index)*11);
    const tone=randomAt(cell.col,cell.row,310+index),size=14+randomAt(cell.col,cell.row,330+index)*9;
    trees.push({x,y,size,tone,broadleaf:randomAt(cell.col,cell.row,350+index)<.26});
  }
  trees.sort((a,b)=>a.y-b.y).forEach(tree=>tree.broadleaf?drawBroadleaf(context,tree.x,tree.y,tree.size,tree.tone):drawConifer(context,tree.x,tree.y,tree.size,tree.tone));
  context.restore();
}

function drawGroundPatch(context:CanvasRenderingContext2D,cell:Cell):void {
  const center=cellCenter(cell),warm=randomAt(cell.col,cell.row,219)>.48;
  context.save();context.globalCompositeOperation='source-over';
  for(let index=0;index<4;index++){
    const dx=(randomAt(cell.col,cell.row,220+index)-.5)*55,dy=(randomAt(cell.col,cell.row,224+index)-.5)*34;
    context.fillStyle=warm?'rgba(184,158,103,.09)':'rgba(72,111,67,.065)';context.beginPath();context.ellipse(center.x+dx,center.y+dy,25+randomAt(cell.col,cell.row,228+index)*19,11+randomAt(cell.col,cell.row,232+index)*10,randomAt(cell.col,cell.row,236+index)*Math.PI,0,Math.PI*2);context.fill();
  }
  context.globalCompositeOperation='source-over';context.strokeStyle=warm?'rgba(204,180,122,.35)':'rgba(68,100,64,.22)';context.lineWidth=1.4;context.lineCap='round';
  context.beginPath();context.moveTo(center.x-24,center.y+8);context.bezierCurveTo(center.x-8,center.y-3,center.x+9,center.y+17,center.x+28,center.y+1);context.stroke();context.restore();
}

function drawCoastalRock(context:CanvasRenderingContext2D,cell:Cell):void {
  const center=cellCenter(cell),count=2+Math.floor(randomAt(cell.col,cell.row,55)*3);
  context.save();context.globalCompositeOperation='multiply';context.fillStyle='rgba(181,155,104,.18)';context.beginPath();context.ellipse(center.x,center.y+3,28,14,-.16,0,Math.PI*2);context.fill();context.globalCompositeOperation='source-over';
  for(let index=0;index<count;index++){
    const dx=(randomAt(cell.col,cell.row,56+index)-.5)*35,dy=(randomAt(cell.col,cell.row,61+index)-.5)*18,size=5+randomAt(cell.col,cell.row,66+index)*6;
    context.fillStyle=index%2?'rgba(172,173,151,.92)':'rgba(197,190,158,.94)';context.strokeStyle='rgba(72,89,80,.5)';context.lineWidth=1;
    context.beginPath();context.ellipse(center.x+dx,center.y+dy,size,size*.55,(randomAt(cell.col,cell.row,70+index)-.5)*.8,0,Math.PI*2);context.fill();context.stroke();
  }
  context.restore();
}

export class TerrainRenderer {
  readonly container=new Container();
  readonly overviewCanvas:HTMLCanvasElement;
  private overview:Sprite;
  private detail=new Container();
  private landmarks=new Container();
  private chunks=new Map<string,Chunk>();
  private mountains=new Map<string,Mountain>();
  private landDetails=new Map<string,Mountain>();
  private mountainTextures=watercolorTextures().mountains.map(texture=>Texture.from(texture));
  private landDetailTextures=watercolorTextures().landDetails.map(texture=>Texture.from(texture));
  private pending:string[]=[];
  private needed=new Set<string>();
  private stamp=0;
  private overviewBytes:number;
  totalGenerated=0;
  constructor(readonly world:HexWorld){
    this.container.eventMode='none';this.overviewCanvas=world.overviewCanvas();this.overview=new Sprite(Texture.from(this.overviewCanvas));
    this.overview.width=world.bounds.width;this.overview.height=world.bounds.height;this.overviewBytes=this.overviewCanvas.width*this.overviewCanvas.height*4;
    this.landmarks.sortableChildren=true;
    this.container.addChild(this.overview,this.detail,this.landmarks);
  }
  updateView(bounds:ViewBounds,zoom:number):void {
    this.stamp++;this.detail.visible=zoom>=DETAIL_ZOOM;this.landmarks.visible=zoom>=DETAIL_ZOOM;this.needed.clear();this.pending=[];
    for(const chunk of this.chunks.values())chunk.sprite.visible=false;for(const mountain of this.mountains.values())mountain.sprite.visible=false;for(const detail of this.landDetails.values())detail.sprite.visible=false;if(!this.detail.visible)return;
    const minCol=Math.max(0,Math.floor(bounds.left/HEX_WIDTH)-2),maxCol=Math.min(this.world.width-1,Math.ceil(bounds.right/HEX_WIDTH)+2);
    const minRow=Math.max(0,Math.floor(bounds.top/ROW_HEIGHT)-2),maxRow=Math.min(this.world.height-1,Math.ceil(bounds.bottom/ROW_HEIGHT)+2);
    for(let cy=Math.floor(minRow/CHUNK_SIZE);cy<=Math.floor(maxRow/CHUNK_SIZE);cy++)for(let cx=Math.floor(minCol/CHUNK_SIZE);cx<=Math.floor(maxCol/CHUNK_SIZE);cx++){
      const key=`${cx},${cy}`;this.needed.add(key);const chunk=this.chunks.get(key);
      if(chunk){chunk.sprite.visible=true;chunk.lastUsed=this.stamp;}else this.pending.push(key);
    }
    this.updateLandDetails(minCol,maxCol,minRow,maxRow);this.updateMountains(minCol,maxCol,minRow,maxRow);
    if(this.needed.size>MAX_CACHED_CHUNKS){this.detail.visible=false;this.landmarks.visible=false;this.needed.clear();this.pending=[];}this.evict();
  }
  buildPending(budgetMs=5):void {
    const started=performance.now();
    while(this.pending.length&&performance.now()-started<budgetMs){const key=this.pending.shift()!,parts=key.split(',').map(Number),chunk=this.buildChunk(parts[0],parts[1]);this.chunks.set(key,chunk);this.detail.addChild(chunk.sprite);this.totalGenerated++;}
    this.evict();
  }
  private buildChunk(cx:number,cy:number):Chunk {
    const startCol=cx*CHUNK_SIZE,startRow=cy*CHUNK_SIZE,endCol=Math.min(startCol+CHUNK_SIZE,this.world.width),endRow=Math.min(startRow+CHUNK_SIZE,this.world.height);
    const left=startCol*HEX_WIDTH-DECORATION_PAD,top=startRow*ROW_HEIGHT-DECORATION_PAD;
    const width=(endCol-startCol+.5)*HEX_WIDTH+DECORATION_PAD*2,height=(endRow-startRow-1)*ROW_HEIGHT+HEX_RADIUS*2+DECORATION_PAD*2;
    const canvas=document.createElement('canvas');canvas.width=Math.ceil(width*TEXTURE_SCALE);canvas.height=Math.ceil(height*TEXTURE_SCALE);
    const context=canvas.getContext('2d')!;context.scale(TEXTURE_SCALE,TEXTURE_SCALE);context.translate(-left,-top);
    const textures=watercolorTextures(),oceanPattern=context.createPattern(textures.ocean,'repeat')!,landPattern=context.createPattern(textures.land,'repeat')!;
    const drawStartRow=Math.max(0,startRow-2),drawEndRow=Math.min(this.world.height,endRow+2),drawStartCol=Math.max(0,startCol-2),drawEndCol=Math.min(this.world.width,endCol+2),landCells:Cell[]=[];
    for(let row=drawStartRow;row<drawEndRow;row++)for(let col=drawStartCol;col<drawEndCol;col++){
      const cell={col,row};if(!this.world.contains(cell))continue;const terrain=this.world.at(cell)!;
      const waterTerrain=terrain===Terrain.Land?Terrain.Shallow:terrain;context.fillStyle=TERRAIN_COLORS[waterTerrain];polygon(context,cell);context.fill();
      context.save();polygon(context,cell);context.clip();context.globalCompositeOperation='soft-light';context.globalAlpha=.48;
      context.fillStyle=oceanPattern;const center=cellCenter(cell);context.fillRect(center.x-HEX_WIDTH/2,center.y-HEX_RADIUS,HEX_WIDTH,HEX_RADIUS*2);context.restore();
      if(terrain===Terrain.Land)landCells.push(cell);else drawWaves(context,cell,terrain);
    }
    drawLandMass(context,landCells,56,'rgba(61,196,205,.5)',103,3.2);
    drawLandMass(context,landCells,52,'rgba(255,251,233,.96)',104,2.6);
    drawLandMass(context,landCells,50.5,'rgba(226,202,154,.97)',105,2.5);
    drawLandMass(context,landCells,43,TERRAIN_COLORS[Terrain.Land],106,1.6);
    context.save();context.globalCompositeOperation='source-over';context.globalAlpha=.4;drawLandMass(context,landCells,43,landPattern,106,1.6);context.restore();
    drawDirectionalCoasts(context,this.world,landCells,textures.coasts);
    drawShorelineDetails(context,this.world,landCells);
    for(let row=startRow;row<endRow;row++)for(let col=startCol;col<endCol;col++){
      const cell={col,row};if(this.world.at(cell)!==Terrain.Land||isMountainSeed(this.world,cell))continue;
      const interior=landNeighborCount(this.world,cell),detail=randomAt(col,row,216);
      if(interior>=5&&detail<.3)drawGroundPatch(context,cell);else if(interior<4&&detail<.11)drawCoastalRock(context,cell);
    }
    const texture=Texture.from(canvas),sprite=new Sprite(texture);sprite.position.set(left,top);sprite.width=canvas.width/TEXTURE_SCALE;sprite.height=canvas.height/TEXTURE_SCALE;
    return {sprite,lastUsed:this.stamp,bytes:canvas.width*canvas.height*4};
  }
  private updateLandDetails(minCol:number,maxCol:number,minRow:number,maxRow:number):void {
    const variants=[0,1,4,5,0,1,3,2],widths=[230,210,220,205,230,215];
    for(let row=Math.max(0,minRow-4);row<=Math.min(this.world.height-1,maxRow+4);row++)for(let col=Math.max(0,minCol-4);col<=Math.min(this.world.width-1,maxCol+4);col++){
      const cell={col,row};if(!isLandDetailSeed(this.world,cell))continue;const key=`${col},${row}`;let detail=this.landDetails.get(key);
      if(!detail){
        const variant=variants[Math.floor(randomAt(col,row,513)*variants.length)],sprite=new Sprite(this.landDetailTextures[variant]),center=cellCenter(cell),scale=.88+randomAt(col,row,514)*.2,width=widths[variant]*scale;
        sprite.anchor.set(.5,.52);sprite.position.set(center.x,center.y);sprite.width=width;sprite.height=width;sprite.zIndex=center.y;
        this.landmarks.addChild(sprite);detail={sprite,lastUsed:this.stamp};this.landDetails.set(key,detail);
      }
      detail.sprite.visible=true;detail.lastUsed=this.stamp;
    }
  }
  private updateMountains(minCol:number,maxCol:number,minRow:number,maxRow:number):void {
    for(let row=Math.max(0,minRow-2);row<=Math.min(this.world.height-1,maxRow+2);row++)for(let col=Math.max(0,minCol-2);col<=Math.min(this.world.width-1,maxCol+2);col++){
      const cell={col,row};if(!isMountainSeed(this.world,cell))continue;const key=`${col},${row}`;let mountain=this.mountains.get(key);
      if(!mountain){
        const direction=Math.floor(randomAt(col,row,80)*6),sprite=new Sprite(this.mountainTextures[direction]),center=cellCenter(cell),scale=.9+randomAt(col,row,78)*.24,width=310*scale;
        sprite.anchor.set(.5,.58);sprite.position.set(center.x,center.y);sprite.width=width;sprite.height=width;sprite.rotation=0;sprite.zIndex=center.y+1;
        this.landmarks.addChild(sprite);mountain={sprite,lastUsed:this.stamp};this.mountains.set(key,mountain);
      }
      mountain.sprite.visible=true;mountain.lastUsed=this.stamp;
    }
  }
  private evict():void {
    if(this.chunks.size<=MAX_CACHED_CHUNKS)return;
    const candidates=[...this.chunks.entries()].filter(([key])=>!this.needed.has(key)).sort((a,b)=>a[1].lastUsed-b[1].lastUsed);
    for(const [key,chunk] of candidates){if(this.chunks.size<=MAX_CACHED_CHUNKS)break;this.detail.removeChild(chunk.sprite);chunk.sprite.destroy({texture:true,baseTexture:true});this.chunks.delete(key);}
    const oldMountains=[...this.mountains.entries()].filter(([,mountain])=>!mountain.sprite.visible).sort((a,b)=>a[1].lastUsed-b[1].lastUsed);
    for(const [key,mountain] of oldMountains){if(this.mountains.size<=MAX_CACHED_MOUNTAINS)break;this.landmarks.removeChild(mountain.sprite);mountain.sprite.destroy();this.mountains.delete(key);}
    const oldLandDetails=[...this.landDetails.entries()].filter(([,detail])=>!detail.sprite.visible).sort((a,b)=>a[1].lastUsed-b[1].lastUsed);
    for(const [key,detail] of oldLandDetails){if(this.landDetails.size<=MAX_CACHED_LAND_DETAILS)break;this.landmarks.removeChild(detail.sprite);detail.sprite.destroy();this.landDetails.delete(key);}
  }
  stats(){return {cachedChunks:this.chunks.size,visibleChunks:this.needed.size,pendingChunks:this.pending.length,cachedMountains:this.mountains.size,cachedLandDetails:this.landDetails.size,generatedChunks:this.totalGenerated,estimatedTerrainTextureBytes:this.overviewBytes+[...this.chunks.values()].reduce((sum,chunk)=>sum+chunk.bytes,0),detail:this.detail.visible,chunkLimit:MAX_CACHED_CHUNKS};}
  destroy():void {for(const chunk of this.chunks.values())chunk.sprite.destroy({texture:true,baseTexture:true});for(const mountain of this.mountains.values())mountain.sprite.destroy();for(const detail of this.landDetails.values())detail.sprite.destroy();this.chunks.clear();this.mountains.clear();this.landDetails.clear();this.overview.destroy({texture:true,baseTexture:true});this.container.destroy({children:true});}
}
