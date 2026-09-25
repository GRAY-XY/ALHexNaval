import {Application,Container,Graphics,RenderTexture,type Renderer} from 'pixi.js';
import { Camera } from './camera.ts';
import { cellCenter, HEX_WIDTH, hexVertices, ROW_HEIGHT, worldToCell } from './hex.ts';
import { HexWorld, TERRAIN_LABELS } from './world.ts';
import { TerrainRenderer } from './terrain-renderer.ts';
import {FogRenderer} from './fog-renderer.ts';
import {PortRenderer} from './port-renderer.ts';
import {CampaignUI} from './campaign-ui.ts';
import {SHIP_VISION,AIR_VISION} from './fog.ts';
import { ShipRenderer } from './ships.ts';
import { AircraftRenderer, loadCombatTextures } from './aircraft-renderer.ts';
import { AIR_NATIONS, AIR_ROLES, CARRIER_STATS, FIGHTER_RANGE, advanceAviation, aircraftActionLimit, aircraftActionText, aircraftPosition, commandSquadron, launchPreview, launchWing, nationFor, planeName, planeTexture, planSquadronTranslation, squadronName, type Squadron } from './aircraft.ts';
import { arrivalAnchor, arrivalTranslation } from './arrival.ts';
import { Minimap } from './minimap.ts';
import { COMBAT_STATS, Match, TEAM_COLORS, type CombatEvent, type MatchUnit, type MoveEvent } from './match.ts';
import { cellKey, type Route } from './pathfinding.ts';
import { inSelectionBox, selectionRect } from './selection.ts';
import type { Cell, Point, Roster, ShipAsset } from './types.ts';
import './style.css';
import './layout.css';
import './menu.css';
import {loadWatercolorTextures} from './watercolor-textures.ts';
import {executeAiTurn} from './ai.ts';
import {TEAM_NAMES,type TeamController} from './match.ts';

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;
function element(tag: string, className = '', text?: string): HTMLElement {
  const el = document.createElement(tag); el.className = className; if (text !== undefined) el.textContent = text; return el;
}
function assetUrl(path: string): string { return new URL('./' + path, document.baseURI).href; }
function nextFrame(): Promise<void> { return new Promise(resolve => requestAnimationFrame(() => resolve())); }
function delay(milliseconds:number):Promise<void>{return new Promise(resolve=>setTimeout(resolve,milliseconds));}

class NavalMap {
  readonly app: Application;
  readonly worldLayer = new Container();
  readonly grid = new Graphics();
  readonly highlight = new Graphics();
  world!: HexWorld;
  camera!: Camera;
  terrain!: TerrainRenderer;
  fog!:FogRenderer;
  ports!:PortRenderer;
  campaignUI!:CampaignUI;
  private visionRevision=-1;
  private campaignRevision=-1;
  ships!: ShipRenderer;
  aircraft!: AircraftRenderer;
  minimap!: Minimap;
  match!: Match;
  units: MatchUnit[] = [];
  chosen = new Set<string>();
  chosenAir = new Set<string>();
  moveMode = false;
  selectedWeapon?: string;
  routePreview?: Route;
  private routeCacheKey = '';
  private selectionPanelKey = '';
  private revision = 0;
  private previewTargetKey = '';
  private previewDue = 0;
  private messageTimer?: ReturnType<typeof setTimeout>;
  selected?: string;
  selectedAir?: string;
  selectedPort?: string;
  airPaused = false;
  private airUIElapsed = 0;
  private reachableKey = '';
  private reachableCells: Cell[] = [];
  hovered?: Cell;
  gridVisible = true;
  animationsPaused = false;
  private menuPaused = true;
  dirty = true;
  ready = false;
  lastFPS = 0;
  renderedFrames = 0;
  private lastFrame = performance.now();
  private elapsed = 0;
  private frames = 0;
  private rebuilding = false;
  private setupMode:'local'|'single'='local';
  private setupControllers:TeamController[]=Array.from({length:TEAM_NAMES.length},()=> 'human');
  private aiRunning=false;
  private aiGeneration=0;
  private keyState = new Set<string>();
  private resizeObserver: ResizeObserver;
  private drag?: { id: number; start: Point; last: Point; moved: boolean; mode: 'box' | 'pan' | 'order'; additive: boolean };
  constructor(readonly assets: ShipAsset[]) {
    this.app = new Application({ width: 1000, height: 800, backgroundColor: 0x0d2d44, antialias: true,
      resolution: Math.min(window.devicePixelRatio || 1, 1.5), autoDensity: true, autoStart: false });
    this.worldLayer.eventMode = 'none'; this.app.stage.addChild(this.worldLayer);
    $('canvas-host').appendChild(this.app.view as HTMLCanvasElement);
    (this.app.view as HTMLCanvasElement).setAttribute('aria-label', '舰船与六角海域');
    this.resizeObserver = new ResizeObserver(() => this.resize()); this.resizeObserver.observe($('map-viewport'));
    this.installInput(); this.installCommands();this.renderSeatSettings();
    this.app.ticker.maxFPS = 60;
    this.app.ticker.add(() => this.tick());
  }
  async changeSize(size: number, teamCount = 4, controllers?:TeamController[]): Promise<void> {
    if (this.match) this.writeSlot('previous', this.match.save());
    await this.installMatch(new Match(new HexWorld(size), this.assets, teamCount,controllers)); this.persist();
  }
  async installMatch(match: Match): Promise<void> {
    if (this.rebuilding) return;
    this.rebuilding = true; this.ready = false;this.aiGeneration++;this.aiRunning=false;
    $('loading').hidden = false; $<HTMLSelectElement>('map-size').disabled = true; $<HTMLButtonElement>('new-match').disabled = true;
    this.keyState.clear(); this.drag = undefined; this.hovered = undefined;
    try {
      await nextFrame();
      if (this.terrain) { this.worldLayer.removeChild(this.terrain.container); this.terrain.destroy(); }
      if (this.ships) { this.worldLayer.removeChild(this.ships.container); this.ships.destroy(); }
      this.aircraft?.destroy();
      this.fog?.destroy();
      this.ports?.destroy();
      for(const id of ['port-dialog','result-dialog'])$<HTMLDialogElement>(id).close();
      this.worldLayer.removeChildren();
      this.match = match; this.world = match.world; this.units = match.units;
      this.chosen.clear(); this.chosenAir.clear(); $('selection-box').hidden = true; this.moveMode = false; this.selectedWeapon = undefined; this.selectedAir = undefined; this.selectedPort = undefined; this.revision++; this.routeCacheKey = ''; this.routePreview = undefined;
      this.camera = new Camera(this.world.bounds); this.terrain = new TerrainRenderer(this.world); this.ships = new ShipRenderer(this.units);
      this.aircraft = new AircraftRenderer();
      this.fog=new FogRenderer(this.world,match.fog);this.ports=new PortRenderer(this.world);this.visionRevision=-1;this.campaignRevision=-1;
      this.campaignUI=new CampaignUI({match:()=>this.match,selected:()=>this.selected,selectedPort:()=>this.selectedPort,selectPort:(id,focus)=>this.selectPort(id,focus),command:(action,message)=>this.command(()=>{action();return[];},message),select:(id,focus)=>this.select(id,focus),focus:p=>{this.camera.focus(p,1.04);this.dirty=true;},redeploy:id=>this.ships.redeploy(id),victory:owner=>{for(const u of this.units.filter(u=>u.ownerId===owner&&u.status!=='sunk'))this.ships.playAction(u.instanceId,'victory',!this.animationsPaused);}});
      this.worldLayer.addChild(this.terrain.container, this.grid, this.fog.container,this.highlight, this.ships.container, this.ports.container, this.aircraft.container);
      this.minimap = new Minimap($<HTMLCanvasElement>('minimap'), this.world, this.terrain.overviewCanvas, this.units, this.camera,
        point => { this.camera.focus(point); this.dirty = true; });
      this.resize(); this.selected = this.units.find(u => u.ownerId === match.active.id)!.instanceId; this.chosen.add(this.selected); this.home(); this.renderSelection(); this.renderTurn();
      this.renderAirControls();
      const size = this.world.width;
      $('map-summary').textContent = `${size} × ${size} · ${(size * size).toLocaleString()} 格`;
      $<HTMLSelectElement>('map-size').value = String(size); $<HTMLSelectElement>('team-count').value = String(match.teams.length);
      this.setupControllers=Array.from({length:TEAM_NAMES.length},(_,i)=>match.teams[i]?.controller??'human');this.renderSeatSettings();
      this.ready = true; this.dirty = true; this.app.start();
      this.updateMenuSummary();
      $('loading').hidden = true;
    } finally { this.rebuilding = false; $<HTMLSelectElement>('map-size').disabled = false; this.renderSeatSettings(); }
  }
  resize(): void {
    const viewport = $('map-viewport'); const width = Math.max(1, viewport.clientWidth), height = Math.max(1, viewport.clientHeight);
    this.app.renderer.resize(width, height); this.camera?.resize(width, height); this.dirty = true;
  }
  home(): void {
    const owned = this.units.filter(u => u.ownerId === this.match.active.id), points = (owned.some(u => u.status !== 'sunk') ? owned.filter(u => u.status !== 'sunk') : owned).map(cellCenter), minX = Math.min(...points.map(p => p.x)), maxX = Math.max(...points.map(p => p.x)),
      minY = Math.min(...points.map(p => p.y)), maxY = Math.max(...points.map(p => p.y));
    const zoom = Math.min(.92, this.camera.viewportWidth / (maxX - minX + 180), Math.max(150, this.camera.viewportHeight - 310) / (maxY - minY + 170));
    this.camera.focus({ x: (minX + maxX) / 2, y: (minY + maxY) / 2 + 70 / zoom }, zoom);
    this.hovered = undefined; this.dirty = true;
  }
  select(instanceId?: string, focus = false, multi = false): void {
    if(instanceId)this.setUnitPanel(true);
    if (instanceId && this.match.unit(instanceId).ownerId !== this.match.active.id) { this.notify('这是其他阵营的舰船，只能选择本方舰船'); return; }
    this.selectedPort=undefined;
    if (!multi) { this.chosen.clear(); this.chosenAir.clear(); }
    if (instanceId) {
      const unit = this.match.unit(instanceId);
      if (multi && unit.ownerId !== this.match.active.id) return;
      if (multi && this.chosen.has(instanceId)) { this.chosen.delete(instanceId); instanceId = [...this.chosen][0]; }
      else { if (multi && [...this.chosen].some(id => this.match.unit(id).ownerId !== unit.ownerId)) this.chosen.clear(); this.chosen.add(instanceId); }
    }
    this.selected = instanceId;
    this.selectedAir = instanceId ? undefined : [...this.chosenAir][0];
    this.selectedWeapon = undefined;
    const unit = this.units.find(u => u.instanceId === instanceId);
    if (unit && focus) this.camera.focus(cellCenter(unit), 1.04);
    this.routeCacheKey = ''; this.renderSelection(); this.renderTurn(); this.renderAirControls(); this.dirty = true;
  }
  private selectPort(id:string,focus=false):void {
    const view=this.match.knownPorts().find(v=>v.port.id===id);if(!view)return;
    this.chosen.clear();this.chosenAir.clear();this.selected=undefined;this.selectedAir=undefined;this.selectedPort=id;
    this.selectedWeapon=undefined;this.moveMode=false;this.routePreview=undefined;this.routeCacheKey='';this.setUnitPanel(true);
    if(focus)this.camera.focus(cellCenter(view.port),1.04);
    this.renderSelection();this.renderTurn();this.renderAirControls();this.dirty=true;
  }
  private renderSelectionCount(): void {
    $('selection-count').textContent = this.selectedPort ? '已选 1 座港口 · 单独管理' : this.selectionCount ? `已选 ${this.chosen.size} 艘舰船 · ${this.chosenAir.size} 个中队` : '左键拖框选择本方单位 · 点击港口管理';
  }
  private get selectionCount(): number { return this.chosen.size + this.chosenAir.size; }
  private pruneSelection(): void {
    for (const id of this.chosen) if (this.match.unit(id).status === 'sunk' || this.match.unit(id).ownerId !== this.match.active.id) this.chosen.delete(id);
    for (const id of this.chosenAir) if (!this.match.aviation.squadrons.some(s=>s.id===id && s.ownerId===this.match.active.id)) this.chosenAir.delete(id);
    if (this.selected && !this.chosen.has(this.selected)) this.selected = [...this.chosen][0];
    if (this.selectedAir && !this.chosenAir.has(this.selectedAir)) this.selectedAir = [...this.chosenAir][0];
    if (!this.selected && !this.selectedAir) { this.selected = [...this.chosen][0]; if (!this.selected) this.selectedAir = [...this.chosenAir][0]; }
  }
  private renderSelection(): void {
    this.pruneSelection();
    const panelKey=JSON.stringify([[...this.chosen].sort(),[...this.chosenAir].sort(),this.selectedPort]);
    if(panelKey!==this.selectionPanelKey){$('selection').scrollTop=0;this.selectionPanelKey=panelKey;}
    if (this.selectedPort) { this.campaignUI.renderSelectedPort($('selection'),this.selectedPort); return; }
    if (this.selectionCount > 1) { this.renderGroupSelection(); return; }
    if (this.selectedAir) { this.renderAirSelection(); return; }
    const unit = this.units.find(u => u.instanceId === this.selected), panel = $('selection'); panel.replaceChildren();
    if (!unit) { panel.append(element('div', 'selection-empty', '点击海图中的舰船、飞机或港口查看资料')); return; }
    const head = element('div', 'selection-head'), image = document.createElement('img'); image.src = assetUrl(unit.asset.assets.preview); image.alt = unit.asset.name;
    const name = element('div'); name.append(element('h3', '', unit.asset.name), element('p', '', `${this.match.active.name} / ${unit.asset.ship_type.name}`)); head.append(image, name);
    const combat = COMBAT_STATS[unit.asset.ship_type.code] ?? COMBAT_STATS.CA;
    const health = element('div','health-card'); health.dataset.sunk = String(unit.status === 'sunk');
    const healthHead = element('div','health-heading'); healthHead.append(element('span','','舰体耐久'),element('strong','',`${unit.hp} / ${unit.maxHp}`));
    const healthMeter = element('div','health-meter'); const healthFill = element('span'); healthFill.style.width = `${unit.hp / unit.maxHp * 100}%`; healthMeter.append(healthFill);
    health.append(healthHead,healthMeter,element('p','',`${combat.armorName}${unit.guard ? ' · 防御姿态' : ''}${unit.status === 'sunk' ? ' · 已沉没' : ''}`));
    const coords = element('div', 'selection-coords'); coords.append(element('span', '', `位置 ${unit.col}, ${unit.row}`), element('span','combat-action',`作战行动 ${unit.action} / 1`));
    const face = document.createElement('button'); face.textContent = '↔ 切换舰船朝向'; face.onclick = () => this.command(() => { this.ships.face(unit.instanceId); return []; });
    const own = unit.ownerId === this.match.active.id&&this.match.active.controller==='human', status = element('p', 'unit-order');
    status.textContent = unit.notice ?? '';
    status.hidden = !status.textContent;
    const actions = element('div', 'unit-actions');
    for (const [id, label, command] of [
      ['wait-unit', '本回合待命', () => this.match.wait(unit.instanceId)],
      ['hold-unit', unit.status === 'hold' ? '唤醒' : '持续驻留', () => unit.status === 'hold' ? this.match.wake(unit.instanceId) : this.match.wait(unit.instanceId, true)],
    ] as const) { const b = document.createElement('button'); b.id = id; b.textContent = label; b.disabled = !own || unit.status === 'sunk';
      b.disabled=b.disabled||!!this.match.result||!!unit.availableRound&&unit.availableRound>this.match.round;b.onclick = () => this.command(() => { command(); return []; }); actions.append(b); }
    const weapons = element('div','weapon-actions');
    for (const weapon of this.match.weapons(unit)) {
      const cooldown = this.match.cooldown(unit,weapon.id), b = document.createElement('button'); b.className = this.selectedWeapon === weapon.id ? 'weapon active' : 'weapon';
      b.dataset.weapon = weapon.id; b.setAttribute('aria-pressed',String(this.selectedWeapon === weapon.id));
      b.textContent = cooldown ? `${weapon.name} · 冷却 ${cooldown}` : `${weapon.name} · ${weapon.minRange}～${weapon.maxRange} 格`;
      b.disabled = !!this.match.result||!own || unit.status !== 'ready' || !unit.action || cooldown > 0;
      b.onclick = () => { this.selectedWeapon = this.selectedWeapon === weapon.id ? undefined : weapon.id; this.moveMode = false; this.routeCacheKey = ''; this.renderSelection(); this.renderTurn(); this.dirty = true; };
      weapons.append(b);
    }
    const defend = document.createElement('button'); defend.className = 'defend'; defend.textContent = unit.guard ? '◆ 防御姿态生效' : '◇ 进入防御姿态';
    defend.disabled = !!this.match.result||!own || unit.status !== 'ready' || !unit.action; defend.onclick = () => this.command(() => { this.match.defend(unit.instanceId); this.selectedWeapon = undefined; return []; },'已进入防御姿态：每次受到的伤害减少 2 点'); weapons.append(defend);
    face.disabled = !!this.match.result||!own||unit.status === 'sunk'; panel.append(head, health, coords, status, weapons, actions, face);
    const carrier = CARRIER_STATS[unit.asset.ship_type.code];
    if (carrier) {
      const wing = element('div','carrier-wing'), nation = nationFor(this.match,unit.instanceId);
      const country = element('p','',`舰载机国家：${AIR_NATIONS.find(n=>n.id===nation)!.name}（随母舰固定）`); country.id = 'air-nation';
      const preview = launchPreview(this.match,unit.instanceId), launch = document.createElement('button'); launch.id = 'launch-wing';
      launch.textContent = `起飞 ${preview.slots.length} 个中队 · ${preview.oil} 石油`; launch.disabled = !own||!preview.valid; launch.title = preview.reason;
      launch.onclick = () => this.command(() => { const squadrons = launchWing(this.match,unit.instanceId); this.ships.playAction(unit.instanceId,'skill',!this.animationsPaused); this.renderAirControls(); this.notify(`${unit.asset.name}已出动 ${squadrons.length} 个中队；点击中队后右键移动或攻击`); return []; });
      const models = carrier.roles.map(role => `${AIR_ROLES[role]}：${planeName(nation,role)}`).join(' / ');
      wing.append(country,element('p','',`${carrier.roles.length}中队 × ${carrier.planes}机 · 每中队行动力${carrier.actionPoints}点 · ${carrier.endurance}回合续航 · 一波使用1次作战行动`),element('p','',models),element('p','',`战斗机自动攻击周围${FIGHTER_RANGE}格内敌机`),launch);
      if (!preview.valid) wing.append(element('p','wing-reason',preview.reason)); panel.insertBefore(wing,weapons);
    }
  }
  private renderGroupSelection(): void {
    const panel = $('selection'); panel.replaceChildren();
    panel.append(element('h3','group-title',`已选 ${this.selectionCount} 个单位`),element('p','group-help',`${this.chosen.size} 艘舰船 · ${this.chosenAir.size} 个飞行中队`),element('p','group-help','右键海图一起移动；抵达时保持出发队形与间距，途中各自寻路。舰船需有足够石油在本回合一起抵达。Shift / Ctrl 可追加选择。'));
    const list = element('div','group-units');
    for (const id of this.chosen) { const unit=this.match.unit(id); list.append(element('p','',`${unit.asset.name} · ${unit.hp}/${unit.maxHp}${unit.status !== 'ready' ? ' · 待命 / 驻留' : ''}`)); }
    for (const id of this.chosenAir) { const s=this.match.aviation.squadrons.find(s=>s.id===id)!; list.append(element('p','',`${squadronName(s)} · 行动力${aircraftActionText(s)} · 续航${s.fuelTurns}回合`)); }
    panel.append(list);
    if (this.chosen.size) {
      const wake = document.createElement('button'); wake.textContent='唤醒所选舰船';wake.disabled=this.match.active.controller==='ai'; wake.onclick=()=>this.command(()=>{for(const id of this.chosen)this.match.wake(id);return [];}); panel.append(wake);
    }
    if (this.chosenAir.size) { const recall=document.createElement('button');recall.textContent='召回所选中队';recall.disabled=!!this.match.result||this.match.active.controller==='ai';recall.onclick=()=>this.command(()=>{for(const id of this.chosenAir)commandSquadron(this.match,id);this.renderAirControls();return[];});panel.append(recall); }
  }
  private selectAir(id: string, focus = false, multi = false): void {
    this.setUnitPanel(true);
    const squadron = this.match.aviation.squadrons.find(s => s.id === id && s.ownerId === this.match.active.id); if (!squadron) return;
    this.selectedPort=undefined;
    if (!multi) { this.chosen.clear(); this.chosenAir.clear(); }
    if (multi && this.chosenAir.has(id)) this.chosenAir.delete(id); else this.chosenAir.add(id);
    this.selectedAir = this.chosenAir.has(id) ? id : [...this.chosenAir][0]; this.selected = this.selectedAir ? undefined : [...this.chosen][0]; this.selectedWeapon = undefined; this.moveMode = false; this.routePreview = undefined; this.routeCacheKey = '';
    if (focus) this.camera.focus(squadron,1.04); this.renderSelection(); this.renderTurn(); this.renderAirControls(); this.dirty = true;
  }
  private renderAirSelection(): void {
    const squadron = this.match.aviation.squadrons.find(s => s.id === this.selectedAir), panel = $('selection'); panel.replaceChildren();
    if (!squadron) { this.selectedAir = undefined; panel.append(element('p','selection-empty','中队已返航或损失，选择舰船继续指挥')); return; }
    const head = element('div','selection-head'), image = document.createElement('img'); image.src = assetUrl(planeTexture(squadron.nation,squadron.role)); image.alt = planeName(squadron.nation,squadron.role);
    const name = element('div'); name.append(element('h3','',squadronName(squadron)),element('p','',`${AIR_NATIONS.find(n=>n.id===squadron.nation)!.name} · ${planeName(squadron.nation,squadron.role)}`)); head.append(image,name);
    const action=element('div','action-points'), actionHead=element('div','ap-heading'), actionValue=element('strong','ap-number',aircraftActionText(squadron).split(' / ')[0]);
    action.id='selected-air-action';action.dataset.remaining=String(squadron.actionPoints);
    actionValue.append(element('span','',` / ${aircraftActionLimit(squadron)}`));actionHead.append(element('span','ap-label','行动力'),actionValue);
    const actionMeter=element('div','ap-meter');actionMeter.setAttribute('role','progressbar');actionMeter.setAttribute('aria-label','飞机行动力');
    actionMeter.setAttribute('aria-valuenow',String(squadron.actionPoints));actionMeter.setAttribute('aria-valuemin','0');actionMeter.setAttribute('aria-valuemax',String(aircraftActionLimit(squadron)));
    for(let i=0;i<10;i++)actionMeter.append(element('span',i*aircraftActionLimit(squadron)/10<squadron.actionPoints?'filled':''));
    action.append(actionHead,actionMeter,element('p','ap-hint',squadron.actionPoints===0?'行动力已耗尽 · 自动返航 · 本次出动不恢复':'沿六角格移动 · 每格1点 · 耗尽返航 · 不自动恢复'));
    const info = element('div','flight-details'); info.append(element('p','',`存续飞机 ${Math.ceil(squadron.hp/2)} / ${squadron.planes} · 机体 ${squadron.hp}/${squadron.maxHp}`),
      element('p','',`续航 ${squadron.fuelTurns} 回合 · 弹药 ${squadron.ammo} / 3 · 攻击间隔 ${Math.ceil(squadron.cooldown)} 秒`),element('p','',`母舰 ${this.match.unit(squadron.carrierId).asset.name} · ${this.airOrderName(squadron)}`));
    const recall = document.createElement('button'); recall.id = 'recall-air'; recall.textContent = '召回中队';recall.disabled=!!this.match.result||this.match.active.controller==='ai'; recall.onclick = () => this.airCommand(squadron.id);
    const carrier = document.createElement('button'); carrier.textContent = '定位母舰'; carrier.onclick = () => this.select(squadron.carrierId,true);
    const cell = worldToCell(squadron); info.append(element('p','',`当前位置 ${cell.col}, ${cell.row}`));
    if (squadron.destination) { const target=worldToCell(squadron.destination);info.append(element('p','',`目标格 ${target.col}, ${target.row}`)); }
    if (squadron.flight) info.append(element('p','',`飞往相邻格 ${squadron.flight.next.col}, ${squadron.flight.next.row}`));
    if (squadron.role === 'fighter') info.append(element('p','',`自动拦截：周围${FIGHTER_RANGE}格内敌机 · 移动和待命时生效 · 返航时停火`));
    panel.append(head,action,info,element('p','air-help','右键格子：沿相邻六角格实时飞行，抵达格心；右键敌舰：持续攻击；战斗机可右键敌机拦截。每移动一格消耗1点本中队行动力，飞机可越过岛屿。'),recall,carrier);
  }
  private airOrderName(s: Squadron): string { return ({ patrol: '空中待命', move: '前往目标', attack: '攻击目标', return: '返航' })[s.order]; }
  private renderAirControls(): void {
    $('air-pause').textContent = this.airPaused ? '▶ 继续飞行' : 'Ⅱ 暂停飞行'; $('air-pause').setAttribute('aria-pressed',String(this.airPaused));
  }
  private airCommand(id: string, point?: Point, targetId?: string): void {
    if(this.match.active.controller==='ai'){this.notify('AI正在指挥当前势力，请等待自动交接回合');return;}
    try { commandSquadron(this.match,id,point,targetId); this.renderAirControls(); this.renderSelection(); this.dirty = true; this.persist(); }
    catch (error) { this.notify(error instanceof Error ? error.message : String(error)); }
  }
  private notify(message: string): void {
    $('message').textContent = message; $('message').hidden = false; clearTimeout(this.messageTimer);
    this.messageTimer = setTimeout(() => { $('message').hidden = true; }, 5200);
  }
  private updateAiBanner(detail?:string):void {
    const visible=this.ready&&!this.match.result&&this.match.active.controller==='ai'&&$('front-end').hidden;
    document.body.classList.toggle('ai-turn',visible);$('ai-turn-banner').hidden=!visible;
    for(const panel of document.querySelectorAll<HTMLElement>('.workspace,.statusbar')){panel.inert=visible;if(visible)panel.setAttribute('aria-hidden','true');else panel.removeAttribute('aria-hidden');}
    if(visible){$('ai-turn-title').textContent=`${this.match.active.name} · AI行动中`;$('ai-turn-detail').textContent=detail??'海图与行动过程已隐藏，交接回玩家后重新显示';}
  }
  private advanceTurn():MoveEvent[]{
    const events=this.match.endTurn(),next=this.match.nextPending()??this.units.find(u=>u.ownerId===this.match.active.id&&u.status!=='sunk')??this.units.find(u=>u.ownerId===this.match.active.id);
    this.chosen.clear();this.chosenAir.clear();this.selectedWeapon=undefined;this.selectedAir=undefined;this.selectedPort=undefined;this.selected=next?.instanceId;
    if(this.selected)this.chosen.add(this.selected);this.renderAirControls();this.home();return events;
  }
  private async runAiTurnIfNeeded():Promise<void>{
    if(this.aiRunning||!this.ready||this.menuPaused||this.match.result||this.match.active.controller!=='ai'||document.querySelector('dialog[open]'))return;
    this.aiRunning=true;const generation=this.aiGeneration,match=this.match,teamId=match.active.id;this.updateAiBanner('海图与行动过程已隐藏，正在等待AI完成回合…');
    try{
      await delay(320);if(generation!==this.aiGeneration||match!==this.match||this.menuPaused||match.active.id!==teamId)return;
      const report=executeAiTurn(match);this.ships.move(report.moves,!this.animationsPaused);
      for(const event of report.combats)this.ships.playCombat(event,!this.animationsPaused);
      this.revision++;this.routeCacheKey='';this.renderSelection();this.renderTurn();this.dirty=true;this.persist();this.updateAiBanner('AI正在完成回合，稍后交接给下一位玩家…');
      await delay(this.animationsPaused?260:1050);
      while(this.menuPaused&&generation===this.aiGeneration&&match===this.match)await delay(150);
      if(generation!==this.aiGeneration||match!==this.match||match.active.id!==teamId||match.result)return;
      const events=this.advanceTurn();this.ships.move(events,!this.animationsPaused);this.revision++;this.routeCacheKey='';this.renderSelection();this.renderTurn();this.dirty=true;this.persist();
    }catch(error){console.error(error);this.notify(`AI回合发生错误：${error instanceof Error?error.message:String(error)}`);try{if(match===this.match&&!match.result&&match.active.id===teamId)this.advanceTurn();}catch{/* Keep the current state available for inspection. */}}
    finally{this.aiRunning=false;this.updateAiBanner();}
  }
  private renderTurn(): void {
    const active = this.match.active, own = this.units.filter(u => u.ownerId === active.id), alive = own.filter(u => u.status !== 'sunk'), pending = alive.filter(u => u.status === 'ready' && (active.oil > 0 || u.action > 0)).length;
    const ai=active.controller==='ai';
    $('turn-label').textContent = `第 ${this.match.round} 轮 · ${active.name}${ai?' · AI':''}`;
    $('turn-label').style.color = '#' + TEAM_COLORS[active.id - 1].toString(16);
    $('pending-info').textContent = `${alive.length}/${own.length} 艘存续 · ${ai?'AI自动处理':`${pending} 项待指挥`}`;
    $('team-oil').textContent = `${active.oil} / ${this.match.oilCap()}`; $('team-oil-fill').style.width = `${active.oil / this.match.oilCap() * 100}%`;
    $('oil-rule-note').textContent=`下次本方回合补满${this.match.oilCap()}点 · 每港口增加10上限`;
    $<HTMLButtonElement>('next-unit').disabled = !pending||ai;
    $<HTMLButtonElement>('end-turn').disabled=ai||!!this.match.result;
    $('move-mode').setAttribute('aria-pressed', String(this.moveMode));
    this.renderSelectionCount();
    this.campaignUI.render();
    $<HTMLButtonElement>('move-mode').disabled=ai||!!this.match.result||!!this.selectedPort;
    this.updateAiBanner();
  }
  private command(action: () => MoveEvent[], message?: string): void {
    if (!this.ready) return;
    if(this.match.active.controller==='ai'){this.notify('AI正在指挥当前势力，请等待自动交接回合');return;}
    try { this.match.assertPlayable();const events = action(); this.ships.move(events, !this.animationsPaused); this.revision++; this.routeCacheKey = '';
      this.renderSelection(); this.renderTurn(); this.dirty = true; this.persist(); if (message) this.notify(message);
    } catch (error) { this.notify(error instanceof Error ? error.message : String(error)); }
  }
  moveTo(cell: Cell): void {
    this.pruneSelection();
    if(this.selectedPort){this.notify('港口操作在右侧面板进行，选择舰船或飞机后可移动');return;}
    if (this.selectionCount > 1) { this.moveSelected(cellCenter(cell)); return; }
    if (this.selectedAir) {
      const enemyAir = this.match.aviation.squadrons.find(s => s.ownerId !== this.match.active.id && this.match.airVisible(s)&&cellKey(worldToCell(s)) === cellKey(cell));
      const enemyShip = this.units.find(u => u.ownerId !== this.match.active.id && u.status !== 'sunk' &&this.match.unitVisible(u)&& cellKey(u) === cellKey(cell));
      this.airCommand(this.selectedAir,enemyAir || enemyShip ? undefined : cellCenter(cell),enemyAir?.id ?? enemyShip?.instanceId); return;
    }
    if (!this.selected) { this.notify('先选择当前势力的舰船'); return; }
    this.selectedWeapon = undefined; this.command(() => this.match.issueMove(this.selected!, cell));
  }
  private moveSelected(point: Point): void {
    const cell=worldToCell(point); this.selectedWeapon=undefined;
    this.command(()=>{
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || !this.world.contains(cell)) throw Error('目标超出有效海域');
      let events: MoveEvent[] = [], assigned=0, skipped=0;
      const airIds = [...this.chosenAir], air = airIds.map(id => {
        const s = this.match.aviation.squadrons.find(s => s.id === id);
        if (!s || s.ownerId !== this.match.active.id) throw Error('只能指挥本方飞行中队');
        if (s.actionPoints<=0) throw Error('所选中队行动力已耗尽，正在返航'); return s;
      });
      const points = [...[...this.chosen].map(id => this.match.unit(id)).filter(u => u.status === 'ready').map(cellCenter),...air];
      let airOrders: ReturnType<typeof planSquadronTranslation>;
      if (this.chosen.size) {
        const result = this.match.issueGroupMove([...this.chosen],cell,{ source: arrivalAnchor(points), fits: (source,target) => {
          try { planSquadronTranslation(this.match,airIds,arrivalTranslation(source,target)); return true; } catch { return false; }
        }});
        events=result.events;assigned=result.assigned;skipped=result.skipped;
        airOrders=planSquadronTranslation(this.match,airIds,arrivalTranslation(result.source,result.target));
      } else {
        airOrders=planSquadronTranslation(this.match,airIds,arrivalTranslation(arrivalAnchor(points),cell));
      }
      for (const order of airOrders) commandSquadron(this.match,order.id,order.destination);
      this.notify(`已下达保持队形的移动指令 · ${assigned} 艘舰船 · ${airIds.length} 个中队${skipped ? ` · ${skipped} 艘待命未移动` : ''}`); this.renderAirControls(); return events;
    });
  }
  private attackTarget(targetId: string): void {
    if (!this.selected || !this.selectedWeapon) return;
    try {
      const attacker = this.match.unit(this.selected), target = this.match.unit(targetId), event: CombatEvent = this.match.attack(attacker.instanceId,target.instanceId,this.selectedWeapon);
      this.ships.playCombat(event,!this.animationsPaused); this.selectedWeapon = undefined; this.revision++; this.routeCacheKey = ''; this.renderSelection(); this.renderTurn(); this.dirty = true; this.persist();
      this.notify(`${attacker.asset.name}发动攻击 · ${target.asset.name}受到 ${event.damage} 点伤害${event.sunk ? ' · 目标沉没' : ` · 剩余耐久 ${event.hpAfter}/${target.maxHp}`}`);
    } catch (error) { this.notify(error instanceof Error ? error.message : String(error)); }
  }
  private writeSlot(slot: string, data: unknown): boolean {
    try { localStorage.setItem(`alhex-${slot}-v1`, JSON.stringify(data)); return true; }
    catch { $('save-status').textContent = '保存失败，请导出备份'; this.notify('浏览器无法保存战局，请使用“导出”保存 JSON 文件'); return false; }
  }
  persist(): void { if (this.writeSlot('auto', this.match.save())) $('save-status').textContent = `已自动保存 · 第 ${this.match.round} 轮`; }
  private async restore(input: unknown): Promise<void> {
    // Fully validate and rebuild the map before touching the active match.
    const restored = Match.load(input, this.assets); this.persist(); await this.installMatch(restored); this.persist(); this.notify('战局已恢复，位置、耐久、石油和冷却均已载入');
  }
  private updateMenuSummary(): void {
    if (!this.match) return;
    const ai=this.match.teams.filter(team=>team.controller==='ai').length;
    $('continue-summary').textContent = `第 ${this.match.round} 轮 · ${this.world.width} × ${this.world.height} · ${this.match.teams.length} 方${ai?` · ${ai} AI`:''}`;
    $<HTMLButtonElement>('continue-match').disabled = !this.ready;
    $('pause-summary').textContent = `第 ${this.match.round} 轮 · ${this.match.active.name} · ${this.world.width} × ${this.world.height} · ${this.match.teams.length} 方`;
  }
  private showFrontPage(page: 'main' | 'skirmish'): void {
    $('main-menu-page').hidden = page !== 'main';
    $('skirmish-page').hidden = page !== 'skirmish';
  }
  private openSetup(mode:'local'|'single'):void {
    this.setupMode=mode;
    const count=Number($<HTMLSelectElement>('team-count').value);
    this.setupControllers=Array.from({length:TEAM_NAMES.length},(_,i)=>mode==='single'&&i>0?'ai':'human');
    $('setup-kicker').textContent=mode==='single'?'SINGLE PLAYER':'LOCAL SKIRMISH';
    $('setup-title').textContent=mode==='single'?'建立单人战局':'建立本地战局';
    $('setup-description').textContent=mode==='single'?'你指挥1号势力，其余启用席位由AI自动侦察、抢港、作战与经营。':'各势力均可使用完整舰船阵容。本地玩家依次交接回合，也可单独把席位改为AI。';
    if(mode==='single'&&count<2)$<HTMLSelectElement>('team-count').value='4';
    this.renderSeatSettings();this.showFrontPage('skirmish');
  }
  private renderSeatSettings():void {
    const host=$('seat-settings'),count=Number($<HTMLSelectElement>('team-count').value)||4;host.replaceChildren();
    for(let i=0;i<TEAM_NAMES.length;i++){
      const row=element('label',`seat-row${i>=count?' empty':''}`);row.style.setProperty('--seat-color','#'+TEAM_COLORS[i].toString(16).padStart(6,'0'));
      const color=element('span','seat-color'),name=element('strong','',`${i+1}号 · ${TEAM_NAMES[i]}`),select=document.createElement('select');select.dataset.seat=String(i);select.setAttribute('aria-label',`${TEAM_NAMES[i]}控制方式`);
      for(const [value,label] of [['human','玩家'],['ai','AI'],['empty','空位']] as const){const option=document.createElement('option');option.value=value;option.textContent=label;if(value==='empty'&&i<2)option.disabled=true;select.append(option);}
      select.value=i<count?this.setupControllers[i]:'empty';
      select.onchange=()=>{
        const value=select.value as TeamController|'empty',teamCount=$<HTMLSelectElement>('team-count');
        if(value==='empty')teamCount.value=String(Math.max(2,i));
        else{this.setupControllers[i]=value;teamCount.value=String(Math.max(Number(teamCount.value),i+1));}
        this.renderSeatSettings();
      };
      row.append(color,name,select);host.append(row);
    }
    const controllers=this.setupControllers.slice(0,count),humans=controllers.filter(value=>value==='human').length,ais=count-humans,summary=$('seat-summary');
    summary.textContent=humans?`${humans} 个玩家席位 · ${ais} 个AI席位 · ${TEAM_NAMES.length-count} 个空位`:'至少保留 1 个玩家席位，避免无人接管战局';
    summary.classList.toggle('invalid',!humans);$<HTMLButtonElement>('new-match').disabled=this.rebuilding||!humans;
  }
  private enterGame(): void {
    $('front-end').hidden = true; document.body.classList.remove('front-active'); $('app').removeAttribute('aria-hidden');
    this.menuPaused = false; this.lastFrame = performance.now(); this.resize(); this.renderTurn();this.dirty = true; $('map-viewport').focus({preventScroll:true});
  }
  private showMainMenu(): void {
    if (this.ready) this.persist();
    const pause = $<HTMLDialogElement>('pause-dialog'); if (pause.open) pause.close();
    this.menuPaused = true; this.keyState.clear(); this.endDrag(); this.updateMenuSummary(); this.showFrontPage('main');
    $('front-end').hidden = false; document.body.classList.add('front-active');this.updateAiBanner(); $<HTMLButtonElement>('continue-match').focus(); $('app').setAttribute('aria-hidden','true');
  }
  private openPause(): void {
    if (!this.ready || !$('front-end').hidden) return;
    this.menuPaused = true; this.keyState.clear(); this.endDrag(); this.updateMenuSummary();this.updateAiBanner(); $<HTMLDialogElement>('pause-dialog').showModal();
  }
  private closePause(): void {
    const dialog = $<HTMLDialogElement>('pause-dialog'); if (dialog.open) dialog.close();
    this.menuPaused = false; this.lastFrame = performance.now();this.updateAiBanner(); this.dirty = true; $('map-viewport').focus({preventScroll:true});
  }
  private openSettings(): void {
    $<HTMLInputElement>('setting-grid').checked = this.gridVisible;
    $<HTMLInputElement>('setting-animation').checked = !this.animationsPaused;
    $<HTMLInputElement>('setting-air').checked = !this.airPaused;
    $<HTMLDialogElement>('settings-dialog').showModal();
  }
  private openLoadDialog(enterAfterLoad = false): void {
    const slots = $('save-slots'); slots.replaceChildren();
    for (const [slot, label] of [['manual','手动存档'],['auto','自动存档'],['previous','上一战局']] as const) {
      const button = document.createElement('button'), raw = localStorage.getItem(`alhex-${slot}-v1`); button.textContent = label; button.disabled = !raw;
      if (raw) { try { const data = JSON.parse(raw); button.textContent += ` · 第 ${data.round} 轮 · ${data.size} × ${data.size} · ${data.teams.length} 方`; } catch { button.textContent += ' · 数据损坏'; } }
      button.onclick = () => { $<HTMLDialogElement>('load-dialog').close(); try { this.restore(JSON.parse(raw!)).then(() => { if (enterAfterLoad) this.enterGame(); }).catch(error => this.notify(String(error))); } catch { this.notify('无法解析此存档，当前战局未改变'); } };
      slots.append(button);
    }
    $<HTMLDialogElement>('load-dialog').showModal();
  }
  private setUnitPanel(open:boolean):void {
    document.querySelector('.unit-sidebar')?.classList.toggle('panel-open',open);
    $('unit-panel-toggle').setAttribute('aria-expanded',String(open));
  }
  private installCommands(): void {
    $('continue-match').onclick=()=>this.enterGame();
    $('open-skirmish').onclick=()=>this.openSetup('local');
    $('open-single-player').onclick=()=>this.openSetup('single');
    $('setup-back').onclick=()=>this.showFrontPage('main');
    $<HTMLSelectElement>('team-count').onchange=()=>this.renderSeatSettings();
    $('main-load').onclick=()=>this.openLoadDialog(true);
    $('main-settings').onclick=()=>this.openSettings();
    $('open-pause').onclick=()=>this.openPause();
    $('resume-game').onclick=()=>this.closePause();
    $('pause-save').onclick=()=>{ $('save-match').click(); this.updateMenuSummary(); };
    $('pause-load').onclick=()=>this.openLoadDialog(false);
    $('pause-settings').onclick=()=>this.openSettings();
    $('return-main').onclick=()=>this.showMainMenu();
    const pauseDialog=$<HTMLDialogElement>('pause-dialog');pauseDialog.addEventListener('cancel',event=>{event.preventDefault();this.closePause();});
    $('close-settings').onclick=()=>$<HTMLDialogElement>('settings-dialog').close();
    $<HTMLInputElement>('setting-grid').onchange=event=>{this.gridVisible=(event.target as HTMLInputElement).checked;$('grid-toggle').setAttribute('aria-pressed',String(this.gridVisible));this.dirty=true;};
    $<HTMLInputElement>('setting-animation').onchange=event=>{this.animationsPaused=!(event.target as HTMLInputElement).checked;$('animation-toggle').setAttribute('aria-pressed',String(this.animationsPaused));$('animation-toggle').textContent=this.animationsPaused?'▶ 播放动画':'Ⅱ 暂停动画';};
    $<HTMLInputElement>('setting-air').onchange=event=>{this.airPaused=!(event.target as HTMLInputElement).checked;this.lastFrame=performance.now();this.renderAirControls();this.dirty=true;};
    $('unit-panel-toggle').onclick=()=>this.setUnitPanel($('unit-panel-toggle').getAttribute('aria-expanded')!=='true');
    $('close-unit-panel').onclick=()=>this.setUnitPanel(false);
    $('end-turn').onclick = () => this.command(() => this.advanceTurn(), '已交接指挥权；石油已补满当前上限');
    $('next-unit').onclick = () => { const unit = this.match.nextPending(this.selected); if (unit) this.select(unit.instanceId, true); };
    $('move-mode').onclick = () => { this.moveMode = !this.moveMode; this.selectedWeapon = undefined; this.renderSelection(); this.renderTurn(); this.dirty = true; };
    $('air-pause').onclick = () => { this.airPaused = !this.airPaused; this.lastFrame = performance.now(); this.renderAirControls(); if (this.selectedAir) this.renderSelection(); this.updateRoute(); this.dirty = true; };
    $('capture-map').onclick=()=>{
      const renderTexture=RenderTexture.create({width:this.app.screen.width,height:this.app.screen.height,resolution:this.app.renderer.resolution});
      this.app.renderer.render(this.app.stage,{renderTexture,clear:true});
      const capture=this.app.renderer.extract.canvas(renderTexture) as HTMLCanvasElement;
      $<HTMLImageElement>('map-capture-image').src=capture.toDataURL('image/png');
      renderTexture.destroy(true);
      $<HTMLDialogElement>('map-capture-dialog').showModal();
    };
    $('download-map-capture').onclick=()=>{const link=document.createElement('a');link.href=$<HTMLImageElement>('map-capture-image').src;link.download=`AL-HEX-NAVAL-海图-${this.world.width}格-第${this.match.round}轮.png`;link.click();};
    $('close-map-capture').onclick=()=>$<HTMLDialogElement>('map-capture-dialog').close();
    $('new-match').onclick = () => { if (this.rebuilding) return;
      const button=$<HTMLButtonElement>('new-match');button.textContent='正在生成海域…';
      const count=Number($<HTMLSelectElement>('team-count').value),controllers=this.setupControllers.slice(0,count);if(!controllers.includes('human')){this.notify('至少需要一个玩家席位');return;}
      this.changeSize(Number($<HTMLSelectElement>('map-size').value),count,controllers).then(() => { this.enterGame(); this.notify(`新战局已建立 · ${controllers.filter(value=>value==='human').length} 玩家 / ${controllers.filter(value=>value==='ai').length} AI`); }).catch(error => this.notify(String(error))).finally(()=>button.textContent='开始战局'); };
    $('save-match').onclick = () => { if (this.writeSlot('manual', this.match.save())) { $('save-status').textContent = '手动存档已保存'; this.notify('已保存到手动存档；自动保存不会覆盖这个存档'); } };
    $('load-match').onclick = () => this.openLoadDialog(false);
    $('close-load').onclick = () => $<HTMLDialogElement>('load-dialog').close();
    $('export-match').onclick = () => {
      const blob = new Blob([JSON.stringify(this.match.save(), null, 2) + '\n'], { type: 'application/json' }), url = URL.createObjectURL(blob), a = document.createElement('a');
      a.href = url; a.download = `AL-HEX-NAVAL-${this.world.width}格-第${this.match.round}轮.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 2000); this.notify('已导出战局 JSON，包含耐久、行动资源、冷却与航行指令');
    };
    $('import-match').onclick = () => $('import-file').click();
    $<HTMLInputElement>('import-file').onchange = async event => {
      const input = event.target as HTMLInputElement, file = input.files?.[0]; input.value = ''; if (!file) return;
      try { if (file.size > 2_000_000) throw Error('存档文件过大'); await this.restore(JSON.parse(await file.text())); } catch (error) { this.notify(String(error)); }
    };
    window.addEventListener('pagehide', () => { if (this.ready) this.persist(); });
  }
  private updateRoute(): void {
    if(this.match.result){this.routePreview=undefined;$('route-info').textContent='战局已结束 · 可查看海图或建立新战局';return;}
    if(this.match.active.controller==='ai'){this.routePreview=undefined;$('route-info').textContent='AI正在侦察、抢占港口并执行舰队命令';return;}
    if(this.selectedPort){this.routePreview=undefined;this.routeCacheKey=this.previewTargetKey='port';$('route-info').textContent='已选港口 · 在右侧管理占领、维修和增援 · 点击舰船或飞机继续指挥';return;}
    if (this.selectionCount > 1) { this.routePreview=undefined;this.routeCacheKey=this.previewTargetKey='group';$('route-info').textContent=`已选 ${this.chosen.size} 艘舰船 / ${this.chosenAir.size} 个中队 · 右键一起移动 · 抵达保持出发队形，逐舰耗油`;return; }
    if (this.selectedAir) { this.routePreview = undefined; const squadron=this.match.aviation.squadrons.find(s=>s.id===this.selectedAir); $('route-info').textContent = `中队行动力 ${squadron ? aircraftActionText(squadron) : '—'} · 沿六角格移动，每格1点，耗尽返航，不自动恢复 · ${this.airPaused ? '航空已暂停' : '右键格子移动 / 攻击'}`; return; }
    const unit = this.units.find(u => u.instanceId === this.selected), target = this.hovered;
    if (unit && this.selectedWeapon) {
      const combatKey = `combat:${this.revision}:${unit.instanceId}:${this.selectedWeapon}:${this.hovered ? cellKey(this.hovered) : ''}`; this.routeCacheKey = this.previewTargetKey = combatKey;
      this.routePreview = undefined; const hoveredUnit = this.hovered && this.units.find(item =>this.match.unitVisible(item)&& item.status !== 'sunk' && item.col === this.hovered!.col && item.row === this.hovered!.row && item.instanceId !== unit.instanceId);
      if (!hoveredUnit) $('route-info').textContent = `${this.match.weapons(unit).find(w => w.id === this.selectedWeapon)?.name ?? '武器'}瞄准中 · 左键点击敌舰`;
      else { const preview = this.match.attackPreview(unit.instanceId,hoveredUnit.instanceId,this.selectedWeapon); $('route-info').textContent = preview.valid ? `预计造成 ${preview.damage} 点伤害 · ${hoveredUnit.asset.name} ${hoveredUnit.hp} → ${preview.hpAfter}${preview.sunk ? ' · 将被击沉' : ''}` : preview.reason!; }
      return;
    }
    const key = `${this.revision}:${this.selected}:${target ? cellKey(target) : ''}`;
    if (this.previewTargetKey !== key) { this.previewTargetKey = key; this.previewDue = performance.now() + (this.hovered ? 90 : 0); }
    if (performance.now() < this.previewDue) { this.routePreview = undefined; $('route-info').textContent = '正在计算本次移动…'; return; }
    if (key === this.routeCacheKey) return; this.routeCacheKey = key; this.routePreview = undefined;
    if (!unit || unit.ownerId !== this.match.active.id) { $('route-info').textContent = unit ? '其他势力舰船 · 交接回合后方可指挥' : '选择本方舰船，右键海格安排航行'; return; }
    if (unit.status !== 'ready') { $('route-info').textContent = unit.status === 'hold' ? '持续驻留 · 唤醒后可重新参与航行' : '本回合待命 · 下一回合恢复'; return; }
    if (!target) { $('route-info').textContent = `石油 ${this.match.active.oil}/${this.match.oilCap()} · 绿色海格可抵达 · 右键航行 / R 后左键下令`; return; }
    if(!this.match.canSee(this.match.active.id,target)){$('route-info').textContent='目标不在本方当前视野内 · 分段移动或派飞机侦察';return;}
    this.routePreview = this.match.route(unit.instanceId, target);
    if (this.routePreview && this.routePreview.cost > this.match.active.oil) {
      $('route-info').textContent = `本回合石油不足 · 移动需要 ${this.routePreview.cost} 点，当前剩余 ${this.match.active.oil} 点 · 请选择绿色可抵达海格`;
      this.routePreview=undefined;
    } else $('route-info').textContent = this.routePreview ? `本回合移动 · 消耗 ${this.routePreview.cost} 点石油 · 剩余 ${this.match.active.oil-this.routePreview.cost}/${this.match.oilCap()}` : '无法抵达 · 检查岛屿或占据格';
  }
  private localPoint(event: PointerEvent | WheelEvent): Point {
    const rect = $('map-viewport').getBoundingClientRect(); return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }
  private boxSelect(start: Point, end: Point, additive: boolean): void {
    this.selectedPort=undefined;
    if (!additive) { this.chosen.clear(); this.chosenAir.clear(); }
    for (const unit of this.units.filter(u=>u.ownerId===this.match.active.id && u.status!=='sunk')) {
      const point=this.camera.worldToScreen(this.ships.position(unit.instanceId)); point.y -= this.camera.zoom>=.58 ? 35*this.camera.zoom : 0;
      if (inSelectionBox(point,start,end)) this.chosen.add(unit.instanceId);
    }
    for (const s of this.match.aviation.squadrons.filter(s=>s.ownerId===this.match.active.id)) if (inSelectionBox(this.camera.worldToScreen(aircraftPosition(s)),start,end)) this.chosenAir.add(s.id);
    this.selected=[...this.chosen][0];this.selectedAir=this.selected ? undefined : [...this.chosenAir][0];this.selectedWeapon=undefined;this.moveMode=false;this.routeCacheKey='';
    if(this.chosen.size||this.chosenAir.size)this.setUnitPanel(true);
    this.renderSelection();this.renderSelectionCount();this.renderAirControls();this.renderTurn();this.dirty=true;
  }
  private endDrag(): void {
    const canvas=this.app.view as HTMLCanvasElement;
    if (this.drag && canvas.hasPointerCapture(this.drag.id)) canvas.releasePointerCapture(this.drag.id);
    this.drag=undefined;$('selection-box').hidden=true;$('map-viewport').classList.remove('dragging');
  }
  private installInput(): void {
    const canvas = this.app.view as HTMLCanvasElement;
    canvas.addEventListener('pointerdown', event => {
      if (!this.ready || this.menuPaused || this.match.active.controller==='ai' || ![0, 1, 2].includes(event.button)) return;
      event.preventDefault(); const point = this.localPoint(event);
      this.drag = { id: event.pointerId, start: point, last: point, moved: false, mode: event.button===1 || event.button===0 && event.altKey ? 'pan' : event.button===0 ? 'box' : 'order', additive:event.ctrlKey || event.shiftKey };
      canvas.setPointerCapture(event.pointerId); $('map-viewport').focus({ preventScroll: true });
    });
    canvas.addEventListener('pointermove', event => {
      if (!this.ready || this.menuPaused) return;
      const point = this.localPoint(event);
      if (this.drag && this.drag.id === event.pointerId) {
        if (Math.hypot(point.x - this.drag.start.x, point.y - this.drag.start.y) > 4) this.drag.moved = true;
        if (this.drag.moved && this.drag.mode==='pan') { this.camera.pan(point.x - this.drag.last.x, point.y - this.drag.last.y); this.dirty = true; $('map-viewport').classList.add('dragging'); }
        if (this.drag.moved && this.drag.mode==='box') {
          const rect=selectionRect(this.drag.start,point), box=$('selection-box');box.hidden=false;
          box.style.left=`${rect.left}px`;box.style.top=`${rect.top}px`;box.style.width=`${rect.width}px`;box.style.height=`${rect.height}px`;
        }
        this.drag.last = point;
      } else {
        const cell = worldToCell(this.camera.screenToWorld(point));
        if (cell.col !== this.hovered?.col || cell.row !== this.hovered?.row) { this.hovered = this.world.contains(cell) ? cell : undefined; this.dirty = true; }
      }
    });
    canvas.addEventListener('pointerup', event => {
      if (!this.drag || this.drag.id !== event.pointerId) return;
      if (this.drag.moved && this.drag.mode==='box') this.boxSelect(this.drag.start,this.localPoint(event),this.drag.additive);
      else if (!this.drag.moved && this.drag.mode!=='pan') {
        const point = this.localPoint(event), cell = worldToCell(this.camera.screenToWorld(point));
        if (this.selectionCount>1 && (event.button===2 || event.button===0 && this.moveMode)) this.moveSelected(this.camera.screenToWorld(point));
        else if (this.selectedAir && (event.button === 2 || event.button === 0 && this.moveMode)) {
          const worldPoint = this.camera.screenToWorld(point), air = this.aircraft.pick(worldPoint,this.match.aviation.squadrons.filter(s=>s.ownerId!==this.match.active.id&&this.match.airVisible(s)));
          const ship = this.units.filter(u=>u.ownerId!==this.match.active.id&&u.status!=='sunk'&&this.match.unitVisible(u)).find(u=>{
            const anchor = this.camera.worldToScreen(cellCenter(u));return Math.abs(point.x-anchor.x)<50*this.camera.zoom&&point.y>anchor.y-92*this.camera.zoom&&point.y<anchor.y+24*this.camera.zoom;
          });
          this.airCommand(this.selectedAir,air||ship?undefined:worldPoint,air?.id??ship?.instanceId);
        } else if (event.button === 2 || event.button === 0 && this.moveMode) this.moveTo(cell);
        else if (event.button === 0) this.pick(point, event.ctrlKey || event.shiftKey);
      }
      this.endDrag();
    });
    canvas.addEventListener('pointercancel', () => this.endDrag());
    canvas.addEventListener('lostpointercapture', () => { this.drag=undefined;$('selection-box').hidden=true;$('map-viewport').classList.remove('dragging'); });
    canvas.addEventListener('pointerleave', () => { this.hovered = undefined; this.dirty = true; });
    canvas.addEventListener('contextmenu', event => event.preventDefault());
    canvas.addEventListener('wheel', event => {
      event.preventDefault(); if (!this.ready || this.menuPaused) return;
      this.camera.zoomAt(Math.exp(-Math.max(-140, Math.min(140, event.deltaY)) * .0024), this.localPoint(event)); this.dirty = true;
    }, { passive: false });
    $('home').onclick = () => this.home();
    $('overview').onclick = () => { this.camera.fit(); this.hovered = undefined; this.dirty = true; };
    $('grid-toggle').onclick = () => { this.gridVisible = !this.gridVisible; $('grid-toggle').setAttribute('aria-pressed', String(this.gridVisible)); this.dirty = true; };
    $('animation-toggle').onclick = () => { this.animationsPaused = !this.animationsPaused; $('animation-toggle').setAttribute('aria-pressed', String(this.animationsPaused)); $('animation-toggle').textContent = this.animationsPaused ? '▶ 播放动画' : 'Ⅱ 暂停动画'; };
    for (const [id, factor] of [['zoom-in', 1.25], ['zoom-out', .8]] as const) $(id).onclick = () => {
      this.camera.zoomAt(factor, { x: this.camera.viewportWidth / 2, y: this.camera.viewportHeight / 2 }); this.dirty = true;
    };
    const mini = $<HTMLCanvasElement>('minimap'); let miniDragging = false;
    mini.addEventListener('pointerdown', event => { if (!this.ready || this.menuPaused) return; miniDragging = true; mini.setPointerCapture(event.pointerId); this.minimap.navigate(event); });
    mini.addEventListener('pointermove', event => { if (miniDragging && this.ready) this.minimap.navigate(event); });
    mini.addEventListener('pointerup', event => { miniDragging = false; if (mini.hasPointerCapture(event.pointerId)) mini.releasePointerCapture(event.pointerId); });
    mini.addEventListener('pointercancel', () => { miniDragging = false; });
    window.addEventListener('keydown', event => {
      const key = event.key.toLowerCase();
      const openDialog=document.querySelector<HTMLDialogElement>('dialog[open]');
      if(key==='escape'&&!openDialog){
        event.preventDefault();
        if(!$('front-end').hidden){if(!$('skirmish-page').hidden)this.showFrontPage('main');return;}
        if(this.ready){this.openPause();return;}
      }
      if (!this.ready || this.menuPaused || openDialog || /INPUT|SELECT|TEXTAREA/.test((event.target as HTMLElement).tagName)) return;
      if(this.match.active.controller==='ai')return;
      if (['w','a','s','d','arrowup','arrowdown','arrowleft','arrowright'].includes(key)) { event.preventDefault(); this.keyState.add(key); }
      if (event.repeat) return;
      if (key === ' ') { event.preventDefault(); this.home(); }
      if (key === 'g') $('grid-toggle').click();
      if (key === 'm') $('overview').click();
      if (key === 'r') $('move-mode').click();
      const onMap = (event.target as HTMLElement).id === 'map-viewport' || event.target === canvas || event.target === document.body;
      if (key === 'tab' && onMap) { event.preventDefault(); $('next-unit').click(); }
      if (key === 'enter' && onMap) { event.preventDefault(); $('end-turn').click(); }
      if (key === '+' || key === '=') $('zoom-in').click();
      if (key === '-') $('zoom-out').click();
    });
    window.addEventListener('keyup', event => this.keyState.delete(event.key.toLowerCase()));
    window.addEventListener('blur', () => { this.keyState.clear();this.endDrag(); });
  }
  private pick(point: Point, multi = false): void {
    const occupied=new Set(this.units.filter(u=>u.status!=='sunk'&&this.match.unitVisible(u)).map(cellKey));
    const port=this.ports.pick(this.camera.screenToWorld(point),this.match.knownPorts(),this.camera.zoom,occupied);
    if(!this.selectedWeapon&&port){this.selectPort(port.port.id);return;}
    const air = this.aircraft.pick(this.camera.screenToWorld(point),this.match.aviation.squadrons.filter(s=>this.match.airVisible(s)));
    if (air) { if (air.ownerId === this.match.active.id) this.selectAir(air.id,false,multi); else this.notify('敌方飞行中队：选择战斗机后右键拦截'); return; }
    const detailed = this.camera.zoom >= .58;
    const candidates = this.units.filter(unit => {
      if(!this.match.unitVisible(unit))return false;
      const anchor = this.camera.worldToScreen(cellCenter(unit));
      return detailed ? Math.abs(point.x - anchor.x) < 54 * this.camera.zoom && point.y > anchor.y - 92 * this.camera.zoom && point.y < anchor.y + 24 * this.camera.zoom
        : Math.hypot(point.x - anchor.x, point.y - anchor.y) < 24;
    });
    candidates.sort((a, b) => Math.abs(point.y - this.camera.worldToScreen(cellCenter(a)).y) - Math.abs(point.y - this.camera.worldToScreen(cellCenter(b)).y));
    const picked = candidates.sort((a,b) => Number(a.status === 'sunk') - Number(b.status === 'sunk'))[0];
    if (this.selectedWeapon && this.selected) {
      if (picked && picked.ownerId !== this.match.active.id && picked.status !== 'sunk') this.attackTarget(picked.instanceId);
      else if (picked?.ownerId === this.match.active.id) this.select(picked.instanceId,false,multi);
      else this.notify('当前格没有可攻击的敌舰');
    } else this.select(picked?.instanceId, false, multi);
    this.hovered = worldToCell(this.camera.screenToWorld(point)); this.dirty = true;
  }
  private drawGrid(): void {
    this.grid.clear(); this.highlight.clear(); const zoom = this.camera.zoom, bounds = this.camera.viewBounds();
    if (this.gridVisible && zoom >= .46) {
      this.grid.lineStyle(.65 / zoom, 0xa2cdda, .13);
      const minRow = Math.max(0, Math.floor(bounds.top / ROW_HEIGHT) - 1), maxRow = Math.min(this.world.height - 1, Math.ceil(bounds.bottom / ROW_HEIGHT));
      const minCol = Math.max(0, Math.floor(bounds.left / HEX_WIDTH) - 1), maxCol = Math.min(this.world.width - 1, Math.ceil(bounds.right / HEX_WIDTH));
      if ((maxRow - minRow + 1) * (maxCol - minCol + 1) <= 4000)
      for (let row = minRow; row <= maxRow; row++) for (let col = minCol; col <= maxCol; col++) {
        const cell = { col, row }; if (!this.world.contains(cell)||this.match.fog.state(this.match.active.id,cell)===0) continue;
        this.grid.drawPolygon(hexVertices(cellCenter(cell)).flatMap(p => [p.x, p.y]));
      }
    }
    const selected = this.units.find(u => u.instanceId === this.selected), reachableKey = `${this.revision}:${this.selected}:${this.selectedWeapon}:${this.selectionCount}`;
    if (reachableKey !== this.reachableKey || this.selectionCount>1) { this.reachableKey = reachableKey; this.reachableCells = selected && !this.selectedWeapon && this.selectionCount===1 ? this.match.reachable(selected.instanceId) : []; }
    const reachable = this.reachableCells;
    if (selected && zoom >= .46) for (const cell of reachable) {
      this.highlight.lineStyle(.7 / zoom, 0x96dfc4, .24).beginFill(0x8ed8bf, .10).drawPolygon(hexVertices(cellCenter(cell)).flatMap(p => [p.x,p.y])).endFill();
    }
    for (const id of this.chosen) {
      const point=this.ships.position(id);
      this.highlight.lineStyle(2 / zoom, 0xb3f0d7, .9).beginFill(0xa5e6ce, .1).drawPolygon(hexVertices(point).flatMap(p=>[p.x,p.y])).endFill();
    }
    if (selected && this.selectedWeapon && zoom >= .36) for (const target of this.units.filter(u => u.ownerId !== selected.ownerId && u.status !== 'sunk')) {
      const preview = this.match.attackPreview(selected.instanceId,target.instanceId,this.selectedWeapon); if (!preview.valid) continue;
      const hovered = this.hovered?.col === target.col && this.hovered?.row === target.row;
      this.highlight.lineStyle((hovered ? 3 : 1.8) / zoom,0xf09a84,.95).beginFill(0xd75e52,hovered ? .23 : .1).drawPolygon(hexVertices(cellCenter(target)).flatMap(p => [p.x,p.y])).endFill();
    }
    if (this.hovered && this.world.contains(this.hovered) && zoom >= .46) {
      this.highlight.lineStyle(1 / zoom, 0xe1eef1, .65).beginFill(0xd4e7ef, .05).drawPolygon(hexVertices(cellCenter(this.hovered)).flatMap(p => [p.x, p.y])).endFill();
    }
    if (this.routePreview && selected) {
      const route = this.routePreview;
      for (let i = 1; i < route.cells.length; i++) { const a = cellCenter(route.cells[i - 1]), b = cellCenter(route.cells[i]);
        this.highlight.lineStyle(2.5 / zoom,0xb6f3d6,.9).moveTo(a.x,a.y).lineTo(b.x,b.y); }
      const end = cellCenter(route.cells[route.cells.length - 1]); this.highlight.lineStyle(2 / zoom,0xb6f3d6,1).drawCircle(end.x,end.y,12 / zoom);
    }
  }
  private updateView(): void {
    const camera = this.camera;
    this.worldLayer.scale.set(camera.zoom);
    this.worldLayer.position.set(camera.viewportWidth / 2 - camera.x * camera.zoom, camera.viewportHeight / 2 - camera.y * camera.zoom);
    this.match.refreshVision();const bounds = camera.viewBounds(); this.terrain.updateView(bounds, camera.zoom); this.fog.update(bounds,camera.zoom,this.match.active.id);
    this.ships.updateView(bounds, camera.zoom, this.chosen, this.match.active.id,u=>this.match.unitVisible(u));
    this.aircraft.update(this.match.aviation.squadrons.filter(s=>this.match.airVisible(s)),bounds,camera.zoom,this.chosenAir);
    const ports=this.match.knownPorts(),occupiedPorts=new Set(this.units.filter(u=>u.status!=='sunk'&&this.match.unitVisible(u)).map(cellKey));this.ports.update(ports,bounds,camera.zoom,occupiedPorts,this.selectedPort);
    this.updateRoute(); this.drawGrid(); this.minimap.draw(this.fog.overviewCanvas,u=>this.match.unitVisible(u),ports,this.selectedPort);
    $('fog-info').textContent=`战争迷雾 · 舰船${SHIP_VISION}格 / 飞机${AIR_VISION}格 · 已探索 ${(this.match.fog.field(this.match.active.id).known.size/(this.world.width*this.world.height)*100).toFixed(1)}%`;
    $('zoom-level').textContent = `${Math.round(camera.zoom * 100)}%`;
    $('map-mode').textContent = camera.zoom < .36 ? '战略总览 · 全海域' : camera.zoom < .58 ? '海域视图 · 舰种标记' : '战术视图 · 舰船详情';
    $('cell-info').textContent = this.hovered && this.world.contains(this.hovered)
      ? `${this.match.isExplored(this.match.active.id,this.hovered)?TERRAIN_LABELS[this.world.at(this.hovered)!]:'未探索海域'}${this.match.isExplored(this.match.active.id,this.hovered)&&!this.match.canSee(this.match.active.id,this.hovered)?' · 视野外':''} · ${this.hovered.col}, ${this.hovered.row}` : '左键框选 · 右键移动 · 中键 / WASD平移';
    this.dirty = false;
  }
  private tick(): void {
    if (!this.ready) return;
    if(this.menuPaused){this.lastFrame=performance.now();this.keyState.clear();this.terrain.buildPending();return;}
    void this.runAiTurnIfNeeded();
    if(document.querySelector('dialog[open]'))this.keyState.clear();
    const now = performance.now(), elapsedSeconds = Math.max(0, (now - this.lastFrame) / 1000), delta = Math.min(.05, elapsedSeconds); this.lastFrame = now;
    let dx = 0, dy = 0;
    if (this.keyState.has('a') || this.keyState.has('arrowleft')) dx += 430 * delta;
    if (this.keyState.has('d') || this.keyState.has('arrowright')) dx -= 430 * delta;
    if (this.keyState.has('w') || this.keyState.has('arrowup')) dy += 430 * delta;
    if (this.keyState.has('s') || this.keyState.has('arrowdown')) dy -= 430 * delta;
    if (dx || dy) { this.camera.pan(dx, dy); this.dirty = true; }
    if (!this.airPaused && !this.match.result&&this.match.aviation.squadrons.length) {
      // Catch up ordinary low-FPS frames in small simulation steps, without replaying a long suspended tab.
      const before = this.match.aviation.squadrons.length, flightSeconds = Math.min(1,elapsedSeconds), events = advanceAviation(this.match,elapsedSeconds);
      const countChanged = before !== this.match.aviation.squadrons.length;
      for (const event of events) if(this.match.unitVisible(this.match.unit(event.targetId)))this.ships.playCombat(event,!this.animationsPaused);
      if (events.length) { this.revision++; this.renderTurn(); }
      this.dirty = true; this.airUIElapsed += flightSeconds;
      if (this.airUIElapsed >= 1 || events.length || countChanged) { this.airUIElapsed = 0; this.pruneSelection();this.renderAirControls();this.renderSelectionCount(); if (this.chosenAir.size || events.length || countChanged) this.renderSelection(); this.persist(); }
    }
    this.match.refreshVision();if(this.visionRevision!==this.match.fog.revision){this.visionRevision=this.match.fog.revision;this.revision++;this.routeCacheKey='';if(this.selectedPort)this.renderSelection();this.dirty=true;}
    if(this.campaignRevision!==this.match.campaignRevision){this.campaignRevision=this.match.campaignRevision;this.campaignUI.render();this.dirty=true;}
    if (this.ships.moving || this.previewTargetKey !== this.routeCacheKey && performance.now() >= this.previewDue) this.dirty = true;
    if (this.dirty) this.updateView(); this.terrain.buildPending(); this.ships.update(delta, this.animationsPaused ? 0 : delta);
    this.renderedFrames++; this.frames++; this.elapsed += elapsedSeconds;
    if (this.elapsed > .75) {
      this.lastFPS = Math.round(this.frames / this.elapsed); this.frames = 0; this.elapsed = 0;
      const stats = this.ships.stats();
      $('load-status').textContent = stats.errors.length ? '部分舰船素材加载失败' : `素材 ${stats.assetsLoaded}/${this.assets.length} 种 · 本方 ${this.units.filter(unit => unit.ownerId === this.match.active.id).length} 艘`;
    }
  }
  stats() {
    const memory = (performance as Performance & { memory?: { usedJSHeapSize: number; totalJSHeapSize: number } }).memory;
    let rendererName = 'unknown';
    const gl = (this.app.renderer as Renderer).gl;
    if (gl) { const info = gl.getExtension('WEBGL_debug_renderer_info'); rendererName = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER)); }
    return { mapSize: this.world.width, totalCells: this.world.width * this.world.height, landCells: this.world.landCells,
      terrainDataBytes: this.world.terrain.byteLength + this.world.valid.byteLength, generationMs: this.world.generationMs,
      camera: { x: this.camera.x, y: this.camera.y, zoom: this.camera.zoom, width: this.camera.viewportWidth, height: this.camera.viewportHeight },
      terrain: this.terrain.stats(), ships: this.ships.stats(), fps: this.lastFPS, renderer: rendererName,
      jsHeapBytes: memory?.usedJSHeapSize ?? null, selected: this.selected ?? null, gridVisible: this.gridVisible,
      match: this.match.save(), moving: this.ships.moving };
  }
  async benchmark(frameCount = 90, pan = false) {
    await this.ships.ready();
    const started = performance.now(), times: number[] = [], original = { x: this.camera.x, y: this.camera.y, zoom: this.camera.zoom };
    let previous = performance.now(), serial = this.renderedFrames;
    for (let i = 0; i < frameCount; i++) {
      do { await nextFrame(); } while (serial === this.renderedFrames);
      serial = this.renderedFrames;
      const now = performance.now(); times.push(now - previous); previous = now;
      if (pan) { this.camera.focus({ x: original.x + Math.sin(i / 12) * 500, y: original.y + Math.cos(i / 15) * 350 }, original.zoom); this.dirty = true; }
    }
    const result = this.stats(); this.camera.focus(original, original.zoom); this.dirty = true;
    const sorted = times.slice(3).sort((a, b) => a - b);
    return { ...result, benchmark: { frames: frameCount, elapsedMs: performance.now() - started,
      medianFrameMs: sorted[Math.floor(sorted.length * .5)], p95FrameMs: sorted[Math.floor(sorted.length * .95)], pan,
      scope: `${this.units.length} ships across ${this.match.teams.length} teams; rendering benchmark only. Does not include combat, AI or networking.` } };
  }
}

function showError(error: unknown): void {
  $('loading').hidden = false; $('loading').querySelector('h2')!.textContent = '海图载入失败';
  $('loading').querySelector('p')!.textContent = String(error); console.error(error);
}
declare global { interface Window { navalMap?: NavalMap } }
(async () => {
  try {
    const response = await fetch(assetUrl('data/roster.json')); if (!response.ok) throw Error('无法读取舰船清单');
    const roster: Roster = await response.json(); await Promise.all([loadCombatTextures(),loadWatercolorTextures()]); const map = new NavalMap(roster.units); window.navalMap = map;
    const saved = localStorage.getItem('alhex-auto-v1');
    if (saved) { try { await map.installMatch(Match.load(JSON.parse(saved), roster.units)); map.persist(); } catch { await map.changeSize(256); } }
    else await map.changeSize(256);
  } catch (error) { showError(error); }
})();
