import { Assets, Container, Graphics, Sprite, Text, TextStyle } from 'pixi.js';
import { aircraftActionText, aircraftPosition, planeTexture, squadronName, type Squadron, AIR_NATIONS, FIGHTER_RANGE } from './aircraft.ts';
import { cellCenter, fromAxial, hexDistance, hexVertices, toAxial, worldToCell } from './hex.ts';
import { TEAM_COLORS } from './match.ts';
import type { Point, ViewBounds } from './types.ts';

export async function loadCombatTextures(): Promise<void> {
  const paths = ['shell','torpedo','bomb',...AIR_NATIONS.flatMap(n => ['fighter','bomber','torpedo'].map(role => `${n.id}-${role}`))];
  await Promise.all(paths.map(name => Assets.load(new URL(`./assets/combat/${name}.png`,document.baseURI).href)));
}
interface AirVisual { root: Container; marker: Graphics; planes: Sprite[]; label: Text }
export class AircraftRenderer {
  readonly container = new Container();
  private range = new Graphics();
  private cells = new Graphics();
  private visuals = new Map<string,AirVisual>();
  constructor() { this.container.eventMode = 'none'; this.container.addChild(this.range,this.cells); }
  update(squadrons: Squadron[], bounds: ViewBounds, zoom: number, selected=new Set<string>()): void {
    this.range.clear();
    this.cells.clear();
    for (const s of squadrons.filter(s=>selected.has(s.id))) {
      const color=TEAM_COLORS[s.ownerId-1];
      this.cells.lineStyle(2,color,.8).drawPolygon(hexVertices(cellCenter(worldToCell(s)),39).flatMap(p=>[p.x,p.y]));
      if(s.flight)this.cells.lineStyle(1,color,.5).drawPolygon(hexVertices(cellCenter(s.flight.next),39).flatMap(p=>[p.x,p.y]));
      if(s.destination)this.cells.lineStyle(2,color,1).beginFill(color,.12).drawPolygon(hexVertices(s.destination,39).flatMap(p=>[p.x,p.y])).endFill();
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
      const point=aircraftPosition(s);
      visual.root.position.set(point.x,point.y); visual.root.visible = point.x > bounds.left-70 && point.x < bounds.right+70 && point.y > bounds.top-70 && point.y < bounds.bottom+70;
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
  }
  pick(point: Point, squadrons: Squadron[]): Squadron | undefined {
    const distance=(s:Squadron)=>{const p=aircraftPosition(s);return Math.hypot(p.x-point.x,p.y-point.y);};
    return squadrons.filter(s=>distance(s)<48).sort((a,b)=>distance(a)-distance(b))[0];
  }
  destroy(): void { this.container.destroy({ children: true, texture: false, baseTexture: false }); this.visuals.clear(); }
}
