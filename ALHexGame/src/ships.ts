import { Assets, Container, Graphics, Sprite, Text, TextStyle } from 'pixi.js';
import { Spine } from 'pixi-spine';
import type { AnimationState, Bone } from '@pixi-spine/runtime-3.8';
import { cellCenter } from './hex.ts';
import type { ViewBounds } from './types.ts';
import { TEAM_COLORS, type CombatEvent, type MatchUnit, type MoveEvent } from './match.ts';
import { ShipAnimation, type ShipActionAnimation } from './ship-animation.ts';

interface Visual {
  unit: MatchUnit;
  root: Container;
  icon: Container;
  label: Text;
  nameplate: Container;
  health: Graphics;
  hpLabel: Text;
  rig?: Spine;
  loading?: Promise<void>;
  motion?: { points: { x: number; y: number }[]; elapsed: number; duration: number };
  animation: ShipAnimation;
  pendingDeath?: boolean;
  reaction?: number;
  calibration?: { basis: string; scale: number; pivotX: number; pivotY: number; bounds: { x: number; y: number; width: number; height: number } };
}
interface CombatEffect { root: Container; graphic: Graphics; sprites: Sprite[]; origin: { x: number; y: number }; target: Visual; elapsed: number; duration: number; delay: number; impacted: boolean; event: CombatEvent }
export const FACTION_COLORS: Record<number, number> = { 1: 0x89d8e3, 2: 0x9ae4c6, 3: 0xf2c39c, 4: 0xc8b7e8 };
const SHIP_DETAIL_ZOOM = .58;
const TARGET_HEIGHT = 98;
const TARGET_WIDTH = 116;

export class ShipRenderer {
  readonly container = new Container();
  private nameplates = new Container();
  private visuals: Visual[] = [];
  errors: string[] = [];
  private zoom = 1;
  private selected = new Set<string>();
  private disposed = false;
  private effects: CombatEffect[] = [];
  visibleRigs = 0;
  visibleIcons = 0;
  constructor(units: MatchUnit[]) {
    this.container.eventMode = 'none'; this.container.sortableChildren = true;
    this.nameplates.zIndex=100000; this.nameplates.sortableChildren=true; this.container.addChild(this.nameplates);
    for (const unit of units) {
      const root = new Container(), point = cellCenter(unit), color = unit.ownerId ? TEAM_COLORS[unit.ownerId - 1] : FACTION_COLORS[unit.asset.faction.id] ?? 0x9ae4c6;
      root.position.set(point.x, point.y); root.zIndex = point.y;
      const water = new Graphics(); water.beginFill(0x051e32, .3).drawEllipse(0, 9, 28, 8).endFill();
      water.lineStyle(1, color, .7).drawEllipse(0, 9, 27, 8); root.addChild(water);
      const icon = new Container(), badge = new Graphics();
      badge.beginFill(0x102e43, .95).lineStyle(1.5, color, 1).drawRoundedRect(-19, -12, 38, 24, 6).endFill();
      const text = new Text(unit.asset.ship_type.code, new TextStyle({ fontFamily: 'Arial', fontSize: 12, fontWeight: 'bold', fill: color })); text.anchor.set(.5); icon.addChild(badge, text); root.addChild(icon);
      const label = new Text(unit.asset.name, new TextStyle({ fontFamily: 'Microsoft YaHei, sans-serif', fontSize: 12, fill: 0xe7f5f5, stroke: 0x102e43, strokeThickness: 3 }));
      label.anchor.set(.5, 0);
      const nameplate=new Container(),health=new Graphics(),hpLabel=new Text('',new TextStyle({fontFamily:'Arial',fontSize:10,fontWeight:'bold',fill:0xf0f7f6,stroke:0x102e43,strokeThickness:3}));
      health.position.y=21;hpLabel.anchor.set(.5,0);hpLabel.position.y=31;
      nameplate.addChild(label,health,hpLabel);this.nameplates.addChild(nameplate);
      this.visuals.push({ unit, root, icon, label, nameplate, health, hpLabel, animation:new ShipAnimation(unit.asset) }); this.container.addChild(root);
    }
  }
  position(id: string): { x: number; y: number } {
    const visual=this.visuals.find(v=>v.unit.instanceId===id);
    return visual ? {x:visual.root.x,y:visual.root.y} : {x:0,y:0};
  }
  updateView(bounds: ViewBounds, zoom: number, selected=new Set<string>(), activeOwner=1, visible:(unit:MatchUnit)=>boolean=()=>true): void {
    this.zoom = zoom; this.selected = selected; this.visibleRigs = this.visibleIcons = 0;
    for (const visual of this.visuals) {
      const point = visual.motion ? visual.root.position : cellCenter(visual.unit);
      if (!visual.motion) { visual.root.position.set(point.x, point.y); visual.root.zIndex = point.y; }
      visual.root.visible = visible(visual.unit)&&point.x > bounds.left - 120 && point.x < bounds.right + 120
        && point.y > bounds.top - 70 && point.y < bounds.bottom + 120;
      visual.nameplate.visible=visual.root.visible && (zoom>=.68 || selected.has(visual.unit.instanceId));
      if (!visual.root.visible) continue;
      visual.root.alpha = visual.unit.status === 'sunk' && !visual.pendingDeath && !visual.animation.active ? .26 : 1;
      visual.label.text = visual.unit.status === 'sunk' ? `${visual.unit.asset.name} · 已沉没` : visual.unit.asset.name;
      const detailed = zoom >= SHIP_DETAIL_ZOOM;
      visual.icon.visible = !detailed || !visual.rig;
      visual.icon.scale.set(1 / zoom);
      if (visual.rig) { visual.rig.visible = detailed; if (detailed) this.visibleRigs++; }
      else if (detailed) this.ensureRig(visual);
      if (visual.icon.visible) this.visibleIcons++;
      visual.nameplate.alpha=visual.unit.status==='sunk' ? .45 : 1;
      visual.nameplate.scale.set(1/Math.max(.7,zoom));
      this.placeNameplate(visual);
      const ratio=Math.max(0,Math.min(1,visual.unit.hp/visual.unit.maxHp)),healthColor=visual.unit.ownerId===activeOwner ? 0x9ae4c6 : 0xf19590;
      visual.health.clear().lineStyle(1,0x051e32,1).beginFill(0x17384a,.95).drawRoundedRect(-34,0,68,7,2).endFill();
      if (ratio>0) visual.health.lineStyle(0).beginFill(healthColor,1).drawRoundedRect(-33,1,66*ratio,5,1).endFill();
      visual.hpLabel.text=`${visual.unit.hp}/${visual.unit.maxHp}`;
    }
  }
  private placeNameplate(visual: Visual): void {
    visual.nameplate.position.set(visual.root.x,visual.root.y+(this.zoom>=SHIP_DETAIL_ZOOM ? 23 : 17/this.zoom));visual.nameplate.zIndex=visual.root.y;
  }
  private ensureRig(visual: Visual): void {
    if (visual.loading) return;
    visual.loading = (async () => {
      try {
        const path = new URL('./' + visual.unit.asset.assets.skeleton, document.baseURI).href;
        const resource = await Assets.load(path);
        if (this.disposed) return;
        const rig = new Spine(resource.spineData); rig.autoUpdate = false;
        rig.state.setAnimation(0, visual.unit.asset.animation_map.idle!, true); rig.update(.05);
        const b = rig.getLocalBounds();
        // The root is authored at the feet. Bounds may include aircraft/pets below the feet.
        const root = rig.skeleton.bones[0] as Bone;
        const pivotX = root.worldX, pivotY = root.worldY;
        const scale = Math.min(TARGET_HEIGHT / Math.max(1, pivotY - b.y), TARGET_WIDTH / Math.max(1, b.width));
        rig.pivot.set(pivotX, pivotY); rig.position.set(0, 9);
        rig.scale.set(visual.unit.facing === 'left' ? -scale : scale, scale);
        visual.calibration = { basis: 'authored-root-at-feet', scale, pivotX, pivotY, bounds: { x: b.x, y: b.y, width: b.width, height: b.height } };
        visual.rig = rig; visual.root.addChildAt(rig, 1);
        const state=rig.state as AnimationState;
        visual.animation.bind({
          has:name=>!!rig.spineData.findAnimation(name),
          play:(name,loop)=>{const entry=state.setAnimation(0,name,loop);entry.mixDuration=.08;},
          current:()=>{const entry=state.getCurrent(0);return entry ? {name:entry.animation.name,elapsed:entry.trackTime,duration:entry.animationEnd-entry.animationStart} : undefined;},
        });
        visual.animation.sync(visual.unit.status==='sunk' && !visual.pendingDeath ? 'defeated' : visual.motion ? 'move' : 'idle');
        rig.visible = this.zoom >= SHIP_DETAIL_ZOOM; visual.icon.visible = !rig.visible;
      } catch (error) { this.errors.push(visual.unit.asset.id + ': ' + String(error)); }
    })();
  }
  update(deltaSeconds: number, animationSeconds = deltaSeconds): void {
    this.visibleRigs = this.visibleIcons = 0;
    for (const visual of this.visuals) {
      if (visual.motion) {
        const motion = visual.motion; motion.elapsed += animationSeconds;
        const progress = Math.min(1, motion.elapsed / motion.duration) * (motion.points.length - 1), i = Math.min(motion.points.length - 2, Math.floor(progress)), t = progress - i;
        const a = motion.points[i], b = motion.points[i + 1]; visual.root.position.set(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t); visual.root.zIndex = visual.root.y;
        if(Math.abs(b.x-a.x)>1e-6)visual.unit.facing=b.x<a.x?'left':'right';
        if (motion.elapsed >= motion.duration) visual.motion = undefined;
      }
      const moving = !!visual.motion;
      this.placeNameplate(visual);
      visual.animation.sync(visual.unit.status==='sunk' && !visual.pendingDeath ? 'defeated' : moving ? 'move' : 'idle');
      if (visual.rig && visual.calibration) visual.rig.scale.x = visual.calibration.scale * (visual.unit.facing === 'left' ? -1 : 1);
      if(visual.reaction)visual.reaction=Math.max(0,visual.reaction-animationSeconds);
      const shake=visual.reaction ? Math.sin(visual.reaction*65)*5*visual.reaction/.35 : 0;
      if(visual.rig)visual.rig.position.x=shake;visual.icon.position.x=shake;
      visual.root.alpha=visual.reaction && !visual.animation.defeated ? .55+Math.abs(Math.sin(visual.reaction*40))*.45 : visual.unit.status==='sunk' && !visual.pendingDeath && !visual.animation.active ? .26 : 1;
      if (visual.rig && (visual.root.visible && visual.rig.visible || visual.animation.active))visual.rig.update(animationSeconds);
      if (!visual.root.visible) continue;
      if (visual.rig?.visible) { this.visibleRigs++; }
      if (visual.icon.visible) this.visibleIcons++;
    }
    for (const effect of [...this.effects]) {
      effect.elapsed += animationSeconds; const t = Math.max(0,Math.min(1,(effect.elapsed-effect.delay)/effect.duration)), a = effect.origin, b = effect.target.root.position, kind=effect.event.kind;
      if(!effect.impacted && t>=.8) {effect.impacted=true;this.impact(effect.target,effect.event.sunk);}
      effect.graphic.clear();
      const color = kind === 'torpedo' ? 0x79dce9 : kind === 'air' ? 0xf4b26f : 0xffe4a1;
      const heading = Math.atan2(b.y-a.y,b.x-a.x), progress = Math.min(1,t/.8);
      effect.sprites.forEach((sprite,i) => {
        const offset = (i-(effect.sprites.length-1)/2)*12*Math.sin(progress*Math.PI);
        sprite.visible=effect.elapsed>=effect.delay;
        const arc = kind === 'gun' ? Math.sin(progress*Math.PI)*-60 : 0;
        sprite.position.set(a.x+(b.x-a.x)*progress-Math.sin(heading)*offset,a.y+(b.y-a.y)*progress+Math.cos(heading)*offset+arc);
        sprite.rotation = heading; sprite.alpha = t < .8 ? 1 : Math.max(0,(1-t)*5);
        if (kind === 'torpedo' && sprite.visible) effect.graphic.lineStyle(2,color,.25).moveTo(sprite.x-Math.cos(heading)*26,sprite.y-Math.sin(heading)*26).lineTo(sprite.x,sprite.y);
      });
      if (t > .8) effect.graphic.lineStyle(3,color,1-(t-.8)*5).drawCircle(b.x,b.y,8+(t-.8)*120);
      if (t >= 1) { effect.root.destroy({ children: true }); this.effects = this.effects.filter(item => item !== effect); }
    }
  }
  move(events: MoveEvent[], animate = true): void {
    this.finishMotion();
    for (const event of events) { const visual = this.visuals.find(v => v.unit.instanceId === event.instanceId); if (!visual) continue;
      if (animate && event.cells.length > 1) { const points = event.cells.map(cellCenter); visual.root.position.set(points[0].x, points[0].y); visual.motion = { points, elapsed: 0, duration: Math.min(1.6, .23 * (event.cells.length - 1)) }; }
      else { const p = cellCenter(visual.unit); visual.root.position.set(p.x, p.y); visual.root.zIndex = p.y; }
    }
  }
  playCombat(event: CombatEvent, animate = true): void {
    const attacker = this.visuals.find(v => v.unit.instanceId === event.attackerId), target = this.visuals.find(v => v.unit.instanceId === event.targetId);
    if (!target || !attacker && !event.origin) return;
    if (!animate) { if(event.sunk){target.pendingDeath=false;target.animation.sync('defeated');}target.root.alpha = event.sunk ? .26 : 1; return; }
    if(attacker) {this.playAction(attacker.unit.instanceId,event.kind==='air' ? 'skill' : event.weaponId==='main-gun' ? 'main_gun' : 'attack');}
    if(event.sunk)target.pendingDeath=true;
    const root = new Container(), graphic = new Graphics(), sprites: Sprite[] = [];
    root.zIndex = Math.max(attacker?.root.zIndex ?? target.root.zIndex,target.root.zIndex)+200; root.addChild(graphic); this.container.addChild(root);
    const texture = event.kind === 'torpedo' ? 'torpedo' : event.kind === 'air' ? 'bomb' : 'shell';
    for (let i=0;i<(event.kind === 'air' ? 1 : 3);i++) { const sprite = Sprite.from(new URL(`./assets/combat/${texture}.png`,document.baseURI).href); sprite.anchor.set(.5); sprite.scale.set(38/Math.max(1,sprite.texture.width)); root.addChild(sprite); sprites.push(sprite); }
    const origin = event.origin ?? { x: attacker!.root.x, y: attacker!.root.y-16 };
    this.effects.push({ root, graphic, sprites, origin, target, elapsed: 0, duration: event.kind === 'torpedo' ? 1.25 : .85, delay:attacker ? Math.min(.4,Math.max(.12,attacker.animation.duration*.2)) : 0, impacted:false, event });
  }
  private impact(target: Visual,sunk: boolean): void {
    target.reaction=.35;
    if(sunk) {target.pendingDeath=false;target.animation.sync('defeated');}
    else if(target.unit.status!=='sunk')target.animation.request('hurt');
  }
  playAction(instanceId:string,action:ShipActionAnimation,animate=true):void {
    if(!animate)return;
    const visual=this.visuals.find(v=>v.unit.instanceId===instanceId);if(!visual)return;
    visual.animation.request(action);this.ensureRig(visual);
  }
  redeploy(instanceId:string):void {
    const v=this.visuals.find(v=>v.unit.instanceId===instanceId);if(!v)return;
    this.effects=this.effects.filter(e=>{if(e.target!==v&&e.event.attackerId!==instanceId)return true;e.root.destroy({children:true});return false;});
    v.pendingDeath=false;v.reaction=undefined;v.motion=undefined;v.root.position.copyFrom(cellCenter(v.unit));v.root.alpha=1;v.animation.reset();
  }
  get moving(): boolean { return this.visuals.some(v => !!v.motion); }
  finishMotion(): void {
    for (const visual of this.visuals) { visual.motion = undefined; const p = cellCenter(visual.unit); visual.root.position.set(p.x, p.y); visual.root.zIndex = p.y; }
  }
  face(instanceId: string): void {
    const visual = this.visuals.find(v => v.unit.instanceId === instanceId); if (!visual) return;
    visual.unit.facing = visual.unit.facing === 'left' ? 'right' : 'left';
    if (visual.rig && visual.calibration) visual.rig.scale.x = visual.calibration.scale * (visual.unit.facing === 'left' ? -1 : 1);
  }
  async ready(): Promise<void> {
    await Promise.all(this.visuals.map(v => v.loading).filter(Boolean));
  }
  stats() {
    return { rigsLoaded: this.visuals.filter(v => v.rig).length, assetsLoaded: new Set(this.visuals.filter(v => v.rig).map(v => v.unit.asset.id)).size, visibleRigs: this.visibleRigs,
      visibleIcons: this.visibleIcons, errors: [...this.errors],
      calibration: this.visuals.filter(v => v.calibration).map(v => ({ id: v.unit.asset.id, facing: v.unit.facing, ...v.calibration })) };
  }
  destroy(): void { this.disposed = true; this.effects = []; this.container.destroy({ children: true, texture: false, baseTexture: false }); }
}
