import {Container,Graphics,Sprite,Text,TextStyle,Texture} from 'pixi.js';
import {cellCenter,neighbors} from './hex.ts';
import {harborOutwardDirection} from './directional-art.ts';
import {TEAM_COLORS} from './match.ts';
import {cellKey} from './pathfinding.ts';
import type {PortView} from './ports.ts';
import {Terrain,type Point,type ViewBounds} from './types.ts';
import type {HexWorld} from './world.ts';
import {watercolorTextures} from './watercolor-textures.ts';

const DETAIL_ZOOM=.68;

function markerPoint(port:PortView['port'],zoom:number,occupied:ReadonlySet<string>):Point {
  const point=cellCenter(port);return occupied.has(cellKey(port))?{x:point.x+38/zoom,y:point.y+14/zoom}:point;
}

export class PortRenderer {
  readonly container=new Container();
  private markers=new Map<string,{root:Container;shape:Graphics;harbor:Sprite;anchor:Text;label:Text}>();
  private harborTextures=watercolorTextures().harbors.map(texture=>Texture.from(texture));
  constructor(readonly world:HexWorld){this.container.eventMode='none';}
  update(ports:PortView[],bounds:ViewBounds,zoom:number,occupied:ReadonlySet<string>=new Set(),selected?:string):void {
    for(const marker of this.markers.values())marker.root.visible=false;
    for(const {port,ownerId,visible} of ports){
      const actual=cellCenter(port),badge=markerPoint(port,zoom,occupied),margin=180/zoom;
      if(actual.x<bounds.left-margin||actual.x>bounds.right+margin||actual.y<bounds.top-margin||actual.y>bounds.bottom+margin)continue;
      let marker=this.markers.get(port.id);
      if(!marker){
        const root=new Container(),harbor=new Sprite(this.harborTextures[0]),shape=new Graphics();harbor.anchor.set(.5);
        const anchor=new Text('⚓',new TextStyle({fontFamily:'Segoe UI Symbol, Microsoft YaHei',fontSize:22,fill:0xe6eed5}));anchor.anchor.set(.5);
        const label=new Text('',new TextStyle({fontFamily:'Microsoft YaHei',fontSize:10,fill:0xe6eed5,stroke:0x102e43,strokeThickness:3}));label.anchor.set(.5,0);
        root.addChild(harbor,shape,anchor,label);this.container.addChild(root);marker={root,shape,harbor,anchor,label};this.markers.set(port.id,marker);
      }
      marker.root.visible=true;marker.root.position.set(actual.x,actual.y);marker.root.scale.set(1);marker.root.alpha=visible?1:.58;
      const color=ownerId?TEAM_COLORS[ownerId-1]:0xe9d29d,isSelected=selected===port.id;
      const bx=badge.x-actual.x,by=badge.y-actual.y,unitScale=1/zoom;
      marker.shape.clear();marker.anchor.position.set(bx,by);marker.anchor.scale.set(unitScale);marker.label.scale.set(unitScale);
      marker.shape.lineStyle(2*unitScale,color,.95).beginFill(0x143449,.9).drawCircle(bx,by,18*unitScale).endFill();
      marker.shape.beginFill(color,.22).drawCircle(bx,by,15.5*unitScale).endFill();
      if(isSelected)marker.shape.lineStyle(2.4*unitScale,0xfff8dc,.98).drawCircle(bx,by,24*unitScale);
      marker.anchor.visible=true;marker.anchor.tint=color;marker.label.style.fill=color;
      marker.label.position.set(bx,by+(occupied.has(cellKey(port))?58:24)*unitScale);
      marker.label.text=`${port.name}${!visible?' · 记录':''}`;marker.label.visible=isSelected||zoom>=(occupied.has(cellKey(port))?.8:.58);

      marker.harbor.visible=zoom>=DETAIL_ZOOM;
      if(marker.harbor.visible){
        const direction=harborOutwardDirection(this.world,port),sea=cellCenter(neighbors(port)[direction]),dx=sea.x-actual.x,dy=sea.y-actual.y,length=Math.hypot(dx,dy)||1;
        marker.harbor.texture=this.harborTextures[direction];marker.harbor.position.set(-dx/length*46,-dy/length*46);marker.harbor.rotation=0;
        marker.harbor.width=260;marker.harbor.height=260;
      }
    }
  }
  pick(point:Point,ports:PortView[],zoom:number,occupied:ReadonlySet<string>):PortView|undefined {
    return ports.map(view=>({view,point:markerPoint(view.port,zoom,occupied)}))
      .filter(value=>Math.hypot(point.x-value.point.x,point.y-value.point.y)<=24/zoom)
      .sort((a,b)=>Math.hypot(point.x-a.point.x,point.y-a.point.y)-Math.hypot(point.x-b.point.x,point.y-b.point.y))[0]?.view;
  }
  destroy():void{this.container.destroy({children:true});}
}
