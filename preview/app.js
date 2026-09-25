'use strict';
const $ = id => document.getElementById(id);
// Absolute URLs keep pixi-spine's texture resolver independent of this page's subdirectory.
const urlFor = path => new URL('../' + path.split('/').map(encodeURIComponent).join('/'), document.baseURI).href;
const labels = {stand:'待机',stand2:'待机 2',move:'移动',move_left:'向左移动',walk:'行走',attack:'攻击',attack_left:'向左攻击',attack_main:'主炮攻击',skill:'技能',victory:'胜利',dead:'退场',normal:'日常',dance:'舞蹈',motou:'摸头',touch:'触摸',sit:'坐下',sleep:'睡觉',wash:'洗浴',yun:'眩晕',tuozhuai:'拖拽',tuozhuai2:'拖拽 2',break:'特殊动作',BSMjiangtai:'特殊动作'};
let roster, app, sprite, activeUnit, loadedUrl, loadToken = 0, baseScale = 1, paused = false, verifying = false;
function element(tag, className, text) {const el=document.createElement(tag);if(className)el.className=className;if(text!==undefined)el.textContent=text;return el;}
function renderCards() {
  for(const unit of roster.units) {
    const card=element('button','card');card.dataset.unit=unit.id;card.setAttribute('aria-label',`预览 ${unit.name}`);
    const portrait=element('div','portrait');portrait.append(element('span','tag',unit.ship_type.code));
    const img=element('img');img.src=urlFor(unit.assets.preview);img.alt=unit.name;portrait.append(img);
    const caption=element('div','caption');caption.append(element('h3','',unit.name),element('p','',`${unit.faction.name} · ${unit.ship_type.name}`),element('small','',`默认皮肤 · ${unit.animations.length} 个动作`));
    card.append(portrait,caption);card.onclick=()=>openUnit(unit);$('grid').append(card);
  }
}
function ensureApp() {
  if(app)return;
  app=new PIXI.Application({width:640,height:640,backgroundAlpha:0,antialias:true,preserveDrawingBuffer:true});app.stop();$('stage').append(app.view);
  app.ticker.add(()=>{if(sprite)sprite.update(app.ticker.deltaMS/1000);});
}
async function clearSprite() {
  app?.stop();
  if(sprite){app.stage.removeChild(sprite);sprite.destroy({children:true,texture:false,baseTexture:false});sprite=null;}
  if(loadedUrl){const old=loadedUrl;loadedUrl=null;await PIXI.Assets.unload(old);}
}
function fitSprite() {
  const track=sprite.state.getCurrent(0);if(!track)return;
  let left=Infinity,top=Infinity,right=-Infinity,bottom=-Infinity;
  const time=track.trackTime,timeScale=sprite.state.timeScale;sprite.state.timeScale=1;
  for(let i=0;i<=36;i++){track.trackTime=track.animation.duration*i/36;sprite.update(0);const b=sprite.getLocalBounds();left=Math.min(left,b.x);top=Math.min(top,b.y);right=Math.max(right,b.x+b.width);bottom=Math.max(bottom,b.y+b.height);}
  track.trackTime=time;sprite.state.timeScale=timeScale;sprite.update(0);
  baseScale=Math.min(570/Math.max(1,right-left),570/Math.max(1,bottom-top),3);
  sprite.pivot.set((left+right)/2,(top+bottom)/2);sprite.position.set(320,320);sprite.scale.set(baseScale);$('zoom').value=100;
}
function setAction(name) {
  if(!sprite)return;
  sprite.skeleton.setToSetupPose();sprite.state.setAnimation(0,name,true);sprite.state.timeScale=Number($('speed').value);sprite.update(.01);fitSprite();app.renderer.render(app.stage);
  $('action-info').textContent=`${labels[name]||name} · ${name} · ${sprite.state.getCurrent(0).animation.duration.toFixed(2)} 秒`;
}
async function openUnit(unit) {
  if(verifying)return;
  const token=++loadToken;ensureApp();await clearSprite();if(token!==loadToken)return;
  activeUnit=unit;paused=false;$('pause').textContent='暂停';$('ship-name').textContent=unit.name;
  $('ship-type').textContent=`${unit.ship_type.code} / ${unit.ship_type.name}`;$('identity').textContent=`${unit.faction.name} · 默认皮肤 · Spine ${unit.spine_version}`;
  $('asset-folder').href=urlFor(unit.assets.directory)+'/';$('animation').replaceChildren();
  for(const id of ['animation','pause','reset'])$(id).disabled=true;
  $('player-status').hidden=false;$('player-status').textContent='正在加载动画…';if(!$('detail').open)$('detail').showModal();
  try {
    const resourceUrl=urlFor(unit.assets.skeleton);loadedUrl=resourceUrl;
    const resource=await PIXI.Assets.load(resourceUrl);if(token!==loadToken){await PIXI.Assets.unload(resourceUrl);return;}
    sprite=new PIXI.spine.Spine(resource.spineData);sprite.autoUpdate=false;app.stage.addChild(sprite);
    for(const animation of sprite.spineData.animations)$('animation').add(new Option(`${labels[animation.name]||animation.name} · ${animation.name}`,animation.name));
    $('animation').value=unit.animation_map.idle;setAction(unit.animation_map.idle);
    for(const id of ['animation','pause','reset'])$(id).disabled=false;
    $('player-status').hidden=true;app.start();
  } catch(error) {$('player-status').textContent='动画加载失败：'+String(error);}
}
async function verifyAll() {
  if(verifying)return;
  verifying=true;$('verify').disabled=true;++loadToken;if($('detail').open)$('detail').close();ensureApp();await clearSprite();
  const report={verified_at:new Date().toISOString(),renderer:app.renderer.type===PIXI.RENDERER_TYPE.WEBGL?'WebGL':'Canvas',runtime:roster.runtime,units:[],issues:[],scope:'Loads every copied skeleton/atlas and samples every animation through the renderer. No game performance or combat validation.'};
  try {
    for(const unit of roster.units) {
      $('verification-status').textContent=`检查 ${unit.name} 的全部动画…`;
      const result={id:unit.id,name:unit.name,status:'passed',animations:[],issues:[]};
      try {
        loadedUrl=urlFor(unit.assets.skeleton);const resource=await PIXI.Assets.load(loadedUrl);
        sprite=new PIXI.spine.Spine(resource.spineData);sprite.autoUpdate=false;app.stage.addChild(sprite);
        const names=sprite.spineData.animations.map(a=>a.name);
        if(JSON.stringify(names)!==JSON.stringify(unit.animations))result.issues.push('Current animation names differ from the roster');
        for(const animation of sprite.spineData.animations) {
          sprite.skeleton.setToSetupPose();sprite.state.setAnimation(0,animation.name,false);sprite.state.timeScale=1;
          let visible=0;const samples=[];
          for(const fraction of [0,.25,.5,.75,.99]) {
            sprite.state.getCurrent(0).trackTime=animation.duration*fraction;sprite.update(0);
            const b=sprite.getLocalBounds();const valid=[b.x,b.y,b.width,b.height].every(Number.isFinite);
            if(!valid)throw Error(`Invalid bounds: ${animation.name}`);
            if(b.width>0&&b.height>0)visible++;
            const scale=Math.min(570/Math.max(1,b.width),570/Math.max(1,b.height),3);
            sprite.pivot.set(b.x+b.width/2,b.y+b.height/2);sprite.position.set(320,320);sprite.scale.set(scale);app.renderer.render(app.stage);
            samples.push({fraction,width:Math.round(b.width*100)/100,height:Math.round(b.height*100)/100});
          }
          if(!visible)result.issues.push('No visible sample: '+animation.name);
          result.animations.push({name:animation.name,duration:animation.duration,samples});
        }
        // Confirm the selected default skin actually produces visible pixels.
        sprite.skeleton.setToSetupPose();sprite.state.setAnimation(0,unit.animation_map.idle,true);sprite.update(.05);
        const b=sprite.getLocalBounds(),scale=Math.min(570/Math.max(1,b.width),570/Math.max(1,b.height),3);
        sprite.pivot.set(b.x+b.width/2,b.y+b.height/2);sprite.position.set(320,320);sprite.scale.set(scale);app.renderer.render(app.stage);
        const pixels=app.renderer.extract.pixels(app.stage);let alphaPixels=0;for(let i=3;i<pixels.length;i+=4)if(pixels[i])alphaPixels++;
        result.idle_visible_pixels=alphaPixels;if(!alphaPixels)result.issues.push('Empty default animation render');
      } catch(error) {result.issues.push(String(error));}
      if(result.issues.length){result.status='failed';report.issues.push(...result.issues.map(issue=>unit.id+': '+issue));}
      report.units.push(result);await clearSprite();
    }
    report.status=report.issues.length?'failed':'passed';
    report.animations_checked=report.units.reduce((sum,u)=>sum+u.animations.length,0);
    const response=await fetch('../api/verification',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(report)});
    if(!response.ok)throw Error('Cannot save verification report: '+await response.text());
    $('verification-status').textContent=report.status==='passed'?`检查通过：${report.units.length} 艘舰船，${report.animations_checked} 个动作。`:`检查发现 ${report.issues.length} 项问题，详见检查报告。`;
    window.assetPreview.lastReport=report;return report;
  } finally {verifying=false;$('verify').disabled=false;}
}
$('close').onclick=()=>$('detail').close();
$('detail').addEventListener('close',()=>{++loadToken;if(!verifying)clearSprite().catch(console.error);});
$('animation').onchange=()=>setAction($('animation').value);
$('pause').onclick=()=>{paused=!paused;paused?app.stop():app.start();$('pause').textContent=paused?'播放':'暂停';};
$('speed').onchange=()=>{if(sprite)sprite.state.timeScale=Number($('speed').value);};
$('zoom').oninput=()=>{if(sprite){sprite.scale.set(baseScale*Number($('zoom').value)/100);app.renderer.render(app.stage);}};
$('reset').onclick=()=>{if(sprite){fitSprite();app.renderer.render(app.stage);}};
$('verify').onclick=()=>verifyAll().catch(error=>{$('verification-status').textContent=String(error);});
window.assetPreview={verifyAll,openUnit,get roster(){return roster;},get sprite(){return sprite;},get unit(){return activeUnit;},get paused(){return paused;},lastReport:null};
(async()=>{try{roster=await(await fetch('../data/roster.json')).json();renderCards();$('summary').textContent='4 个原始阵营 / 6 种舰种 / 12 艘舰船';$('verify').disabled=false;}catch(error){$('verification-status').textContent='资料读取失败：'+String(error);}})();
