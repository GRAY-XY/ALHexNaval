import {Container,Graphics,Text,TextStyle} from 'pixi.js';
import {cellCenter,HEX_WIDTH} from './hex.ts';
import type {ContactReport} from './match.ts';
import type {ViewBounds} from './types.ts';

interface ContactMark {root:Container;shape:Graphics;label:Text}
const COLORS:Record<1|2,number>={1:0x8bbac5,2:0xf0c773};

export class ContactRenderer {
  readonly container=new Container();
  private marks=new Map<string,ContactMark>();
  constructor(){this.container.eventMode='none';}
  update(reports:ContactReport[],bounds:ViewBounds,zoom:number):void{
    for(const mark of this.marks.values())mark.root.visible=false;
    for(const report of reports){
      if(report.level===3)continue;
      const point=cellCenter({col:report.col,row:report.row}),margin=HEX_WIDTH*2;
      if(point.x<bounds.left-margin||point.x>bounds.right+margin||point.y<bounds.top-margin||point.y>bounds.bottom+margin)continue;
      let mark=this.marks.get(report.key);
      if(!mark){
        const root=new Container(),shape=new Graphics(),label=new Text('',new TextStyle({fontFamily:'Microsoft YaHei',fontSize:11,fill:0xe8f2ef,stroke:0x102a3a,strokeThickness:3}));
        label.anchor.set(.5,0);root.addChild(shape,label);this.container.addChild(root);mark={root,shape,label};this.marks.set(report.key,mark);
      }
      const color=COLORS[report.level],scale=1/zoom,uncertainty=report.level===1;
      mark.root.visible=true;mark.root.position.set(point.x,point.y);mark.root.alpha=Math.max(.35,1-report.age*.18);
      mark.shape.clear();
      if(uncertainty)mark.shape.lineStyle(2.2*scale,color,.8).drawCircle(0,0,HEX_WIDTH*1.35);
      mark.shape.lineStyle(2.4*scale,color,.95).beginFill(0x102d3b,.9).drawCircle(0,0,16*scale).endFill();
      mark.shape.beginFill(color,.8).drawCircle(0,0,4*scale).endFill();
      const description=report.level===1?'L1 疑似接触':`L2 ${report.sizeClass==='large'?'大型':'小型'}舰影`;
      mark.label.text=`${description}${report.age?` · ${report.age}回合前`:''}`;mark.label.scale.set(scale);mark.label.position.set(0,20*scale);
    }
  }
  destroy():void{this.container.destroy({children:true});this.marks.clear();}
}
