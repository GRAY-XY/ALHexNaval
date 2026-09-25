import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { AnimationState, AnimationStateData, BoundingBoxAttachment, ClippingAttachment, MeshAttachment, PathAttachment, PointAttachment, RegionAttachment, Skeleton, SkeletonBinary } from '@pixi-spine/runtime-3.8';
import { ShipAnimation, type AnimationPort, type ShipBaseAnimation } from '../src/ship-animation.ts';
import type { Roster, ShipAsset } from '../src/types.ts';

const assets=(JSON.parse(readFileSync('data/roster.json','utf8')) as Roster).units;
// Headless bones/timelines use the real copied binaries. Textures are verified in the browser.
const reader=new SkeletonBinary({
  newRegionAttachment:(_skin,name)=>new RegionAttachment(name),
  newMeshAttachment:(_skin,name)=>new MeshAttachment(name),
  newBoundingBoxAttachment:(_skin,name)=>new BoundingBoxAttachment(name),
  newPathAttachment:(_skin,name)=>new PathAttachment(name),
  newPointAttachment:(_skin,name)=>new PointAttachment(name),
  newClippingAttachment:(_skin,name)=>new ClippingAttachment(name),
});
const data=assets.map(asset=>reader.readSkeletonData(new Uint8Array(readFileSync(asset.assets.skeleton))));
const checks:{name:string;passed:boolean}[]=[];
function check(name:string,test:()=>void){test();checks.push({name,passed:true});}
function rig(i:number,asset:Pick<ShipAsset,'animation_map'>=assets[i]) {
  const skeleton=new Skeleton(data[i]),state=new AnimationState(new AnimationStateData(data[i])),animation=new ShipAnimation(asset);
  const port:AnimationPort={has:name=>!!data[i].findAnimation(name),play:(name,loop)=>{state.setAnimation(0,name,loop).mixDuration=.08;},current:()=>{const entry=state.getCurrent(0);return entry ? {name:entry.animation.name,elapsed:entry.trackTime,duration:entry.animationEnd-entry.animationStart} : undefined;}};
  function advance(seconds:number,base:ShipBaseAnimation='idle') {
    for(let left=seconds;left>1e-9;){const dt=Math.min(.05,left);animation.sync(base);state.update(dt);state.apply(skeleton);skeleton.updateWorldTransform();left-=dt;}
    animation.sync(base);
    for(const bone of skeleton.bones)assert([bone.worldX,bone.worldY,bone.matrix.a,bone.matrix.b,bone.matrix.c,bone.matrix.d].every(Number.isFinite));
  }
  return {state,animation,port,advance};
}
function all(test:(i:number)=>void){assets.forEach((_,i)=>test(i));}

check('All 12 copied Spine binaries load with finite timeline poses',()=>all(i=>{const r=rig(i);r.animation.bind(r.port);r.advance(.25);assert.equal(r.state.getCurrent(0).animation.name,assets[i].animation_map.idle);}));
check('A fresh attack survives the first idle synchronization',()=>all(i=>{const r=rig(i);r.animation.bind(r.port);r.animation.request('attack');r.advance(.2);assert.equal(r.state.getCurrent(0).animation.name,assets[i].animation_map.attack);assert(r.animation.active);assert(!r.state.getCurrent(0).loop);}));
check('Repeated movement and idle transitions never restart or truncate an attack',()=>all(i=>{const r=rig(i);r.animation.bind(r.port);r.animation.request('attack');const duration=r.animation.duration;for(let j=0;j<6;j++)r.advance(duration/10,j%2?'idle':'move');assert.equal(r.state.getCurrent(0).animation.name,assets[i].animation_map.attack);assert(Math.abs(r.state.getCurrent(0).trackTime-duration*.6)<1e-7);r.advance(duration*.5,'move');assert.equal(r.state.getCurrent(0).animation.name,assets[i].animation_map.move);assert(r.state.getCurrent(0).loop);}));
check('Completed attacks return to the current idle state',()=>all(i=>{const r=rig(i);r.animation.bind(r.port);r.animation.request('attack');r.advance(r.animation.duration+.1);assert.equal(r.state.getCurrent(0).animation.name,assets[i].animation_map.idle);assert(!r.animation.active);}));
check('Overlapping attack requests play each complete one-shot in order',()=>all(i=>{const r=rig(i);r.animation.bind(r.port);r.animation.request('attack');const duration=r.animation.duration;r.advance(duration*.4);r.animation.request('skill');assert.equal(r.state.getCurrent(0).animation.name,assets[i].animation_map.attack);r.advance(duration*.7);assert.equal(r.state.getCurrent(0).animation.name,assets[i].animation_map.skill);r.advance(r.animation.duration+.2);assert.equal(r.state.getCurrent(0).animation.name,assets[i].animation_map.idle);}));
check('Paused state updates do not advance or replace the active attack',()=>all(i=>{const r=rig(i);r.animation.bind(r.port);r.animation.request('attack');r.advance(.2);const entry=r.state.getCurrent(0),time=entry.trackTime;for(let j=0;j<100;j++){r.animation.sync(j%2?'idle':'move');r.state.update(0);r.state.apply(new Skeleton(data[i]));}assert.equal(r.state.getCurrent(0),entry);assert.equal(entry.trackTime,time);r.advance(r.animation.duration+.1);assert(!r.animation.active);}));
check('Sinking preempts actions once and keeps the final dead pose through later movement states',()=>all(i=>{const r=rig(i);r.animation.bind(r.port);r.animation.request('attack');r.animation.request('skill');r.animation.sync('defeated');const entry=r.state.getCurrent(0);assert.equal(entry.animation.name,assets[i].animation_map.defeated);assert(!entry.loop);r.advance(entry.animation.duration+.1,'move');r.animation.request('attack');r.advance(.25);assert.equal(r.state.getCurrent(0),entry);assert(r.animation.defeated);assert(!r.animation.active);}));
check('A restored sunken ship binds directly to dead and never returns to idle',()=>all(i=>{const r=rig(i);r.animation.sync('defeated');r.animation.bind(r.port);r.advance(5);assert.equal(r.state.getCurrent(0).animation.name,assets[i].animation_map.defeated);assert(r.animation.defeated);}));
check('Actions requested during asynchronous loading are preserved when the rig binds',()=>all(i=>{const r=rig(i);r.animation.request('attack');r.animation.sync('move');r.animation.bind(r.port);assert.equal(r.state.getCurrent(0).animation.name,assets[i].animation_map.attack);r.advance(r.animation.duration+.1,'move');assert.equal(r.state.getCurrent(0).animation.name,assets[i].animation_map.move);}));
check('Main guns select their native main-gun clip and fall back to normal attack where needed',()=>all(i=>{const r=rig(i);r.animation.bind(r.port);r.animation.request('main_gun');assert.equal(r.state.getCurrent(0).animation.name,assets[i].animation_map.main_gun);r.advance(.25);assert(r.animation.active);}));
check('Carrier launches select the skill clip and complete before the ambient state resumes',()=>all(i=>{const r=rig(i);r.animation.bind(r.port);r.animation.request('skill');assert.equal(r.state.getCurrent(0).animation.name,assets[i].animation_map.skill);r.advance(r.animation.duration+.1);assert.equal(r.state.getCurrent(0).animation.name,assets[i].animation_map.idle);}));
check('Absent native hurt clips do not cancel firing or invent a substitute skeleton animation',()=>all(i=>{const r=rig(i);r.animation.bind(r.port);r.animation.request('attack');r.advance(.2);const entry=r.state.getCurrent(0);r.animation.request('hurt');assert.equal(r.state.getCurrent(0),entry);r.advance(r.animation.duration+.1);r.animation.request('hurt');assert.equal(r.state.getCurrent(0).animation.name,assets[i].animation_map.idle);}));
check('Missing action mappings fail gracefully and main-gun fallback stays playable',()=>{const r=rig(0,{animation_map:{idle:'stand',move:'missing',main_gun:'missing',attack:'attack',skill:null,hurt:null,defeated:'dead'}});r.animation.bind(r.port);r.animation.sync('move');assert.equal(r.state.getCurrent(0).animation.name,'stand');r.animation.request('main_gun');assert.equal(r.state.getCurrent(0).animation.name,'attack');});

check('Replacement hulls reset the defeated lock and resume native idle animation',()=>all(i=>{const r=rig(i);r.animation.bind(r.port);r.animation.sync('defeated');r.advance(5);r.animation.reset();r.advance(.2);assert(!r.animation.defeated);assert.equal(r.state.getCurrent(0).animation.name,assets[i].animation_map.idle);r.animation.request('attack');assert(r.animation.active);}));
check('Victory waits for the current shot, plays once and returns to idle',()=>all(i=>{const r=rig(i);r.animation.bind(r.port);r.animation.request('attack');const duration=r.animation.duration;r.animation.request('victory');r.advance(duration+.01);assert.equal(r.state.getCurrent(0).animation.name,assets[i].animation_map.victory);assert(!r.state.getCurrent(0).loop);r.advance(r.animation.duration+.1);assert.equal(r.state.getCurrent(0).animation.name,assets[i].animation_map.idle);}));
const report={passed:true,checks,ships:assets.map((asset,i)=>({id:asset.id,name:asset.name,animations:data[i].animations.filter(a=>['stand','move','attack','attack_main','skill','dead','victory'].includes(a.name)).map(a=>({name:a.name,duration:a.duration}))})),scope:'Actual copied Spine 3.8 binary timelines and animation-state transitions, without GPU textures; visual browser validation is separate.'};
writeFileSync('output/state-animation-verification.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({passed:true,checks:checks.length,ships:assets.length}));
