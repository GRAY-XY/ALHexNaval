import { Assets, Container, Graphics, Sprite, Text, TextStyle } from 'pixi.js';
import { aircraftActionText, aircraftPosition, aircraftRoute, planeTexture, squadronName, type AircraftMoveEvent, type Squadron, AIR_NATIONS, FIGHTER_RANGE } from './aircraft.ts';
import { cellCenter, fromAxial, hexDistance, hexVertices, toAxial, worldToCell } from './hex.ts';
import { TEAM_COLORS, type CombatEvent, type Match } from './match.ts';
import type { Cell, Point, ViewBounds } from './types.ts';

export async function loadCombatTextures(): Promise<void> {
  const paths = ['shell','torpedo','bomb',...AIR_NATIONS.flatMap(n => ['fighter','bomber','torpedo'].map(role => `${n.id}-${role}`))];
  await Promise.all(paths.map(name => Assets.load(new URL(`./assets/combat/${name}.png`,document.baseURI).href)));
}
interface AirVisual { root: Container; marker: Graphics; planes: Sprite[]; label: Text; motion?:{from:Point;to:Point;started:number;duration:number} }
interface AirCombatVisual { root:Container; graphic:Graphics; from:Point; to:Point; started:number; duration:number }
export class AircraftRenderer {
  readonly container = new Container();
  private range = new Graphics();
  private cells = new Graphics();
  private routes = new Graphics();
  private combatLayer = new Container();
  private visuals = new Map<string,AirVisual>();
  private combatEffects:AirCombatVisual[]=[];
  constructor() { this.container.eventMode = 'none'; this.combatLayer.sortableChildren=true;this.container.addChild(this.range,this.cells,this.routes,this.combatLayer); }
  update(squadrons: Squadron[], bounds: ViewBounds, zoom: number, selected=new Set<string>(),match?:Match,routeOwnerId=match?.active.id): void {
    this.range.clear();
    this.cells.clear();
    this.routes.clear();
    for (const s of squadrons.filter(s=>selected.has(s.id))) {
      const color=TEAM_COLORS[s.ownerId-1];
      this.cells.lineStyle(2,color,.8).drawPolygon(hexVertices(cellCenter(worldToCell(s)),39).flatMap(p=>[p.x,p.y]));
      if(s.flight)this.cells.lineStyle(1,color,.5).drawPolygon(hexVertices(cellCenter(s.flight.next),39).flatMap(p=>[p.x,p.y]));
      if(s.destination)this.cells.lineStyle(2,color,1).beginFill(color,.12).drawPolygon(hexVertices(s.destination,39).flatMap(p=>[p.x,p.y])).endFill();
    }
    if(match)for(const s of squadrons.filter(s=>s.ownerId===routeOwnerId&&(s.order==='move'&&s.destination||s.order==='attack'&&s.targetId))){
      const attacking=s.order==='attack',current=aircraftPosition(s),start=s.flight?.next??worldToCell(s);
      let targetCell:Cell|undefined;
      if(attacking){
        const air=match.aviation.squadrons.find(target=>target.id===s.targetId),ship=match.units.find(target=>target.instanceId===s.targetId);
        if(air&&match.airVisible(air,s.ownerId))targetCell=worldToCell(air);
        else if(ship&&match.unitVisible(ship,s.ownerId))targetCell=ship;
      }else if(s.destination)targetCell=worldToCell(s.destination);
      if(!targetCell)continue;
      const route=aircraftRoute(match,start,targetCell);
      let points=route?.length?(s.flight?[current,...route.map(cellCenter)]:route.map(cellCenter)):[current,cellCenter(targetCell)];
      if(points.length<2)points=[current,cellCenter(targetCell)];
      if(points.length<2)continue;
      const color=attacking?0xf04448:TEAM_COLORS[s.ownerId-1]??0xb6f3d6;
      for(let i=1;i<points.length;i++){
        this.routes.lineStyle(5.5/zoom,0x0b2234,.82).moveTo(points[i-1].x,points[i-1].y).lineTo(points[i].x,points[i].y);
        this.routes.lineStyle(3.3/zoom,color,.98).moveTo(points[i-1].x,points[i-1].y).lineTo(points[i].x,points[i].y);
        if(i<points.length-1)this.routes.beginFill(color,.95).drawCircle(points[i].x,points[i].y,3.4/zoom).endFill();
      }
      const end=points[points.length-1],before=points[points.length-2],angle=Math.atan2(end.y-before.y,end.x-before.x),size=12/zoom,half=6/zoom;
      this.routes.beginFill(color,.98).drawPolygon([end.x,end.y,end.x-Math.cos(angle)*size-Math.sin(angle)*half,end.y-Math.sin(angle)*size+Math.cos(angle)*half,end.x-Math.cos(angle)*size+Math.sin(angle)*half,end.y-Math.sin(angle)*size-Math.cos(angle)*half]).endFill();
    }
    const fighter = squadrons.find(s=>selected.has(s.id) && s.role==='fighter');
    if (fighter) {
      const center = worldToCell(fighter), axial = toAxial(center);
      this.range.lineStyle(1,TEAM_COLORS[fighter.ownerId-1],.5).beginFill(TEAM_COLORS[fighter.ownerId-1],.07);
      for (let dq=-FIGHTER_RANGE;dq<=FIGHTER_RANGE;dq++) for (let dr=-FIGHTER_RANGE;dr<=FIGHTER_RANGE;dr++) {
        const cell = fromAxial(axial.q+dq,axial.r+dr);
        if (hexDistance(center,cell)<=FIGHTER_RANGE) this.range.drawPolygon(hexVertices(cellCenter(cell)).flatMap(p=>[p.x,p.y]));
      }
      this.range.endFill();
    }
    const ids = new Set(squadrons.map(s => s.id));
    for (const [id,v] of this.visuals) if (!ids.has(id)) { v.root.destroy({ children: true }); this.visuals.delete(id); }
    for (const s of squadrons) {
      let visual = this.visuals.get(s.id);
      if (!visual) {
        const root = new Container(), marker = new Graphics(), planes: Sprite[] = [];
        root.addChild(marker);
        for (let i = 0; i < s.planes; i++) {
          const sprite = Sprite.from(new URL('./'+planeTexture(s.nation,s.role),document.baseURI).href); sprite.anchor.set(.5);
          const size = 31; sprite.scale.set(size/Math.max(sprite.texture.width,sprite.texture.height)); root.addChild(sprite); planes.push(sprite);
        }
        const label = new Text('',new TextStyle({ fontFamily: 'Microsoft YaHei', fontSize: 10, fill: 0xe9f5ee, stroke: 0x0b2538, strokeThickness: 3 }));
        label.anchor.set(.5); label.position.y = 40; root.addChild(label); this.container.addChild(root);
        visual = { root, marker, planes, label }; this.visuals.set(s.id,visual);
      }
      if(visual.motion){const t=visual.motion.duration?Math.min(1,(performance.now()-visual.motion.started)/visual.motion.duration):1;
        visual.root.position.set(visual.motion.from.x+(visual.motion.to.x-visual.motion.from.x)*t,visual.motion.from.y+(visual.motion.to.y-visual.motion.from.y)*t);
        if(t>=1)visual.motion=undefined;
      }else{const point=aircraftPosition(s);visual.root.position.set(point.x,point.y);}
      visual.root.visible = visual.root.x > bounds.left-70 && visual.root.x < bounds.right+70 && visual.root.y > bounds.top-70 && visual.root.y < bounds.bottom+70;
      visual.root.scale.set(Math.max(1,.55/zoom)); const selectedNow = selected.has(s.id), count = Math.ceil(s.hp/2), color = TEAM_COLORS[s.ownerId-1];
      visual.marker.clear().lineStyle(selectedNow ? 2 : 1,color,selectedNow ? 1 : .55).drawEllipse(0,0,42,32);
      visual.marker.lineStyle(3,0x17384a,1).moveTo(-25,34).lineTo(25,34).lineStyle(3,0xa7e9c9,1).moveTo(-25,34).lineTo(-25+50*s.hp/s.maxHp,34);
      visual.planes.forEach((sprite,i) => {
        sprite.visible = i < count; const side = i % 2 ? 1 : -1, tier = Math.ceil(i/2), offset = i === 0 ? 0 : 20*tier;
        sprite.position.set(Math.cos(s.heading+Math.PI/2)*side*offset - Math.cos(s.heading)*tier*10,
          Math.sin(s.heading+Math.PI/2)*side*offset - Math.sin(s.heading)*tier*10);
        sprite.rotation = s.heading + Math.PI;
      });
      visual.label.text = `${squadronName(s)}\n行动力 ${aircraftActionText(s)}`; visual.label.visible = zoom >= .58 || selectedNow;
    }
    const now=performance.now();
    for(const effect of [...this.combatEffects]){
      const t=Math.max(0,Math.min(1,(now-effect.started)/effect.duration)),progress=Math.min(1,t/.72),x=effect.from.x+(effect.to.x-effect.from.x)*progress,y=effect.from.y+(effect.to.y-effect.from.y)*progress;
      effect.graphic.clear().lineStyle(5,0x5b151a,.8).moveTo(effect.from.x,effect.from.y).lineTo(x,y).lineStyle(2.4,0xff4a43,1).moveTo(effect.from.x,effect.from.y).lineTo(x,y);
      if(t>=.72)effect.graphic.lineStyle(3,0xffc477,Math.max(0,1-(t-.72)*3.5)).drawCircle(effect.to.x,effect.to.y,7+(t-.72)*44);
      if(t>=1){effect.root.destroy({children:true});this.combatEffects=this.combatEffects.filter(item=>item!==effect);}
    }
  }
  move(events:AircraftMoveEvent[],animate=true):void{
    for(const event of events){const visual=this.visuals.get(event.id);if(!visual)continue;
      if(animate){visual.root.position.set(event.from.x,event.from.y);visual.motion={from:event.from,to:event.to,started:performance.now(),duration:Math.min(1.2,.16*Math.hypot(event.to.x-event.from.x,event.to.y-event.from.y)/70)};}
      else{visual.motion=undefined;visual.root.position.set(event.to.x,event.to.y);}
    }
  }
  playCombat(event:CombatEvent,targetPosition:Point|undefined,animate=true):void{
    if(!event.targetIsAircraft||!targetPosition||!animate)return;
    const from=event.origin??this.visuals.get(event.attackerId)?.root.position;
    if(!from)return;
    const root=new Container(),graphic=new Graphics();root.zIndex=100000;root.addChild(graphic);this.combatLayer.addChild(root);
    this.combatEffects.push({root,graphic,from:{x:from.x,y:from.y},to:{x:targetPosition.x,y:targetPosition.y},started:performance.now(),duration:.56});
  }
  get moving():boolean{return [...this.visuals.values()].some(visual=>!!visual.motion);}
  get combatAnimating():boolean{return this.combatEffects.length>0;}
  finishMotion(squadrons:Squadron[]):void{for(const squadron of squadrons){const visual=this.visuals.get(squadron.id);if(!visual)continue;visual.motion=undefined;const point=aircraftPosition(squadron);visual.root.position.set(point.x,point.y);}}
  finishCombatEffects():void{for(const effect of this.combatEffects)effect.root.destroy({children:true});this.combatEffects=[];}
  pick(point: Point, squadrons: Squadron[]): Squadron | undefined {
    const distance=(s:Squadron)=>{const p=aircraftPosition(s);return Math.hypot(p.x-point.x,p.y-point.y);};
    return squadrons.filter(s=>distance(s)<48).sort((a,b)=>distance(a)-distance(b))[0];
  }
  destroy(): void { this.combatEffects=[];this.container.destroy({ children: true, texture: false, baseTexture: false }); this.visuals.clear(); }
}
