import {Assets,ColorMatrixFilter,Container,Graphics,Sprite,Text,TextStyle} from 'pixi.js';
import {cellCenter,HEX_WIDTH} from './hex.ts';
import type {ContactReport} from './match.ts';
import type {ShipAsset,ViewBounds} from './types.ts';

interface ContactMark {root:Container;shape:Graphics;label:Text;sprite?:Sprite;loadingType?:string;previewType?:string}
const COLORS:Record<1|2,number>={1:0x8bbac5,2:0xa6b0b4};

export class ContactRenderer {
  readonly container=new Container();
  private marks=new Map<string,ContactMark>();
  private assetsById:Map<string,ShipAsset>;
  private disposed=false;
  constructor(assets:ShipAsset[]=[]){
    this.container.eventMode='none';
    this.assetsById=new Map(assets.map(asset=>[asset.id,asset]));
  }
  update(reports:ContactReport[],bounds:ViewBounds,zoom:number):void{
    for(const mark of this.marks.values())mark.root.visible=false;
    for(const report of reports){
      // A live or sunken ship at L3 is rendered by ShipRenderer, which can play its defeat animation.
      if(report.level===3)continue;
      const point=cellCenter({col:report.col,row:report.row}),margin=HEX_WIDTH*2;
      if(point.x<bounds.left-margin||point.x>bounds.right+margin||point.y<bounds.top-margin||point.y>bounds.bottom+margin)continue;
      let mark=this.marks.get(report.key);
      if(!mark){
        const root=new Container(),shape=new Graphics(),label=new Text('',new TextStyle({fontFamily:'Microsoft YaHei',fontSize:11,fill:0xe8f2ef,stroke:0x102a3a,strokeThickness:3}));
        label.anchor.set(.5,0);root.addChild(shape,label);this.container.addChild(root);mark={root,shape,label};this.marks.set(report.key,mark);
      }
      const color=COLORS[report.level],scale=1/zoom,uncertainty=report.level===1,asset=report.assetId?this.assetsById.get(report.assetId):undefined;
      mark.root.visible=true;mark.root.position.set(point.x,point.y);mark.root.alpha=Math.max(.35,1-report.age*.12);
      mark.shape.clear();
      if(asset){
        this.loadPreview(mark,asset);
        mark.shape.lineStyle(1.5*scale,color,.86).drawCircle(0,0,27*scale);
      }else{
        if(uncertainty)mark.shape.lineStyle(2.2*scale,color,.8).drawCircle(0,0,HEX_WIDTH*1.35);
        // Unknown or only roughly identified contacts use a muted hull silhouette at their last report.
        mark.shape.beginFill(color,.82).drawPolygon([-18,-1,-12,-5,10,-5,19,0,11,5,-12,4].map(value=>value*scale)).endFill();
        mark.shape.beginFill(0x65767d,.85).drawRoundedRect(-4*scale,-8*scale,9*scale,5*scale,2*scale).endFill();
        mark.shape.lineStyle(1.5*scale,0xd1d8da,.75).moveTo(-13*scale,7*scale).lineTo(13*scale,7*scale);
      }
      mark.label.text=`${asset?`L${report.level} ${asset.name}`:report.level===1?'L1 疑似接触':`L2 ${report.sizeClass==='large'?'大型':'小型'}舰影`}${report.age?` · ${report.age}回合前`:''}`;
      mark.label.scale.set(scale);mark.label.position.set(0,asset?30*scale:13*scale);
      if(mark.sprite){
        mark.sprite.visible=!!asset&&mark.previewType===asset.ship_type.code;
        mark.sprite.scale.set(44/Math.max(mark.sprite.texture.width,mark.sprite.texture.height)/zoom);
        mark.sprite.position.set(0,-2*scale);
      }
    }
  }
  private loadPreview(mark:ContactMark,asset:ShipAsset):void{
    const type=asset.ship_type.code;
    if(mark.previewType===type||mark.loadingType===type)return;
    mark.loadingType=type;
    const path=new URL('./'+asset.assets.preview,document.baseURI).href;
    void Assets.load(path).then(texture=>{
      if(this.disposed)return;
      const sprite=new Sprite(texture),filter=new ColorMatrixFilter();
      filter.grayscale(.9,false);sprite.filters=[filter];sprite.anchor.set(.5);sprite.alpha=.88;
      mark.sprite?.destroy();mark.root.addChildAt(sprite,0);mark.sprite=sprite;mark.previewType=type;mark.loadingType=undefined;
    }).catch(()=>{mark.loadingType=undefined;});
  }
  destroy():void{this.disposed=true;this.container.destroy({children:true});this.marks.clear();}
}
