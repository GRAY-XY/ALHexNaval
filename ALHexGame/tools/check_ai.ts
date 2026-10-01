import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {executeAiTurn} from '../src/ai.ts';
import {cellCenter,hexDistance,hexLine,neighbors} from '../src/hex.ts';
import {Match,type MatchUnit} from '../src/match.ts';
import {cellKey} from '../src/pathfinding.ts';
import {Terrain,type Cell,type Roster} from '../src/types.ts';
import {HexWorld} from '../src/world.ts';
import {campaignBattle,type CampaignBattleId} from '../src/historical-battles.ts';

const assets=(JSON.parse(readFileSync('data/roster.json','utf8')) as Roster).units;
const checks:{name:string;passed:boolean}[]=[];
function check(name:string,fn:()=>void){fn();checks.push({name,passed:true});}
function aiMatch(){const match=new Match(new HexWorld(128),assets,2,['ai','human']);match.rulesetId='classic-v1';match.teams.forEach(team=>team.oil=50);match.units.forEach(unit=>{delete unit.movementUsed;delete unit.movedThisTurn;delete unit.firedThisTurn;delete unit.torpedoes;});match.refreshVision();return match;}
function campaignAiMatch(scenario:CampaignBattleId,side:number){const battle=campaignBattle(scenario)!;const controllers=side===0?['ai','human'] as const:['human','ai'] as const;const match=new Match(new HexWorld(battle.width,battle.height,scenario),assets,2,[...controllers]);match.activeIndex=side;return {match,battle};}
function sink(unit:MatchUnit){Object.assign(unit,{hp:0,action:0,status:'sunk',guard:false});}

check('AI and player seat controllers persist in v15 saves',()=>{
  const m=aiMatch(),saved=m.save(),loaded=Match.load(saved,assets);assert.equal(saved.version,29);assert.deepEqual(loaded.teams.map(team=>team.controller),['ai','human']);assert.deepEqual(loaded.save(),saved);
});

check('v14 saves migrate to human seats so old local games are never taken over',()=>{
  const m=aiMatch(),legacy:any=m.save();legacy.version=14;for(const team of legacy.teams)delete team.controller;
  const before=JSON.stringify(legacy),loaded=Match.load(legacy,assets);assert.equal(JSON.stringify(legacy),before);assert(loaded.teams.every(team=>team.controller==='human'));assert.equal(loaded.save().version,29);
});

check('invalid v15 seat controllers reject without mutating input',()=>{
  const raw:any=aiMatch().save();raw.teams[1].controller='remote';const before=JSON.stringify(raw);assert.throws(()=>Match.load(raw,assets));assert.equal(JSON.stringify(raw),before);
});

check('AI attacks only a visible enemy through the normal combat rules',()=>{
  const m=aiMatch(),attacker=m.unit('team-1-biaoqiang'),target=m.unit('team-2-lafei'),occupied=new Set(m.units.filter(u=>u!==target&&u.status!=='sunk').map(cellKey));
  const cell=m.world.nearbySea({col:attacker.col+2,row:attacker.row},occupied);Object.assign(target,cell);m.refreshVision();const before=target.hp,report=executeAiTurn(m);
  assert(report.combats.length>0);assert(target.hp<before||target.status==='sunk');assert(report.combats.every(event=>event.attackerId.startsWith('team-1-')||event.attackerId.startsWith('air-')));
});

check('AI cannot target ships that remain behind the fog of war',()=>{
  const m=aiMatch(),report=executeAiTurn(m);assert.equal(report.combats.length,0);assert(m.units.filter(unit=>unit.ownerId===2).every(unit=>unit.hp===unit.maxHp));
});

check('V2 submarine AI surfaces to travel when safe and dives when threatened',()=>{
  const threatened=new Match(new HexWorld(128),assets,2,['ai','human']),sub=threatened.unit('team-1-i19'),dd=threatened.units.find(unit=>unit.ownerId===2&&unit.asset.ship_type.code==='DD')!;
  threatened.units.filter(unit=>unit!==sub&&unit!==dd).forEach(sink);
  const adjacent=neighbors(sub).find(cell=>threatened.world.isSea(cell));assert(adjacent,'expected an open adjacent sea cell');
  Object.assign(sub,{submerged:false,action:1,status:'ready',movedThisTurn:false,movementUsed:0});Object.assign(dd,adjacent,{action:1,status:'ready'});threatened.refreshVision();
  assert(threatened.unitVisible(dd,1),'the surfaced submarine should detect the nearby destroyer');executeAiTurn(threatened);assert.equal(sub.submerged,true,'the AI should spend its action to dive under a visible destroyer threat');

  const safe=new Match(new HexWorld(128),assets,2,['ai','human']),traveler=safe.unit('team-1-i19');safe.units.filter(unit=>unit!==traveler).forEach(sink);traveler.action=1;traveler.submerged=true;
  executeAiTurn(safe);assert.equal(traveler.submerged,false,'the AI should surface for faster movement when no enemy is nearby');
});

check('V2 AI torpedo aircraft skip submerged submarines when another ship can be attacked',()=>{
  const m=new Match(new HexWorld(128),assets,2,['ai','human']),sub=m.unit('team-2-i19'),target=m.units.find(unit=>unit.ownerId===2&&unit.asset.ship_type.code==='CA')!;
  m.units.filter(unit=>unit!==sub&&unit!==target).forEach(sink);sub.submerged=true;
  const adjacent=neighbors(sub).find(cell=>m.world.isSea(cell));assert(adjacent,'expected an open sea cell for the surface target');Object.assign(target,adjacent,{status:'ready'});
  const point=cellCenter(sub),squadron:any={id:'ai-test-torpedo',carrierId:'team-1-qiye',ownerId:1,nation:'jp',role:'torpedo',slot:0,planes:3,hp:6,maxHp:6,fuelTurns:4,actionPoints:8,ammo:3,cooldown:0,heading:0,order:'patrol',...point};
  m.aviation.squadrons.push(squadron);m.refreshVision();assert(m.unitVisible(sub,1)&&m.unitVisible(target,1),'the test aircraft should spot both the nearer submarine and the surface ship');
  const report=executeAiTurn(m);assert.equal(report.airOrders,1);assert.equal(squadron.targetId,target.instanceId,'torpedo aircraft should select a legal surface target instead of failing on the nearer submerged submarine');
});

check('AI captures a visible neutral coastal port with a legal combat action',()=>{
  const m=aiMatch(),port=m.ports.find(p=>!p.ownerId&&m.units.every(u=>hexDistance(u,p)>2))!,unit=m.unit('team-1-lafei');assert(port);Object.assign(unit,{col:port.col,row:port.row});m.refreshVision();const report=executeAiTurn(m);
  assert.equal(port.ownerId,1);assert(report.captures>=1);assert.equal(unit.action,0);assert(m.oilCap(1)>50);
});

check('AI repairs critically damaged ships at an owned port before sailing',()=>{
  const m=aiMatch(),port=m.port('home-1'),unit=m.unit('team-1-lafei');Object.assign(unit,{col:port.col,row:port.row,hp:1});m.refreshVision();const credits=m.active.credits,report=executeAiTurn(m);
  assert(report.repairs>=1);assert(unit.hp>1);assert(m.active.credits<credits);assert.equal(unit.action,0);
});

check('AI spends port production on an affordable replacement hull',()=>{
  const m=aiMatch(),unit=m.unit('team-1-lafei');sink(unit);const report=executeAiTurn(m);assert(report.reinforcements>=1);assert.notEqual(unit.status,'sunk');assert.equal(unit.availableRound,2);assert(m.active.credits<40);
});

check('AI scout movement obeys the shared oil budget and uses visible sea cells',()=>{
  const m=aiMatch();m.active.oil=5;const report=executeAiTurn(m);assert(report.moves.length>0);assert(m.active.oil>=0&&m.active.oil<=5);
  for(const event of report.moves){const end=event.cells.at(-1)!;assert(m.world.isSea(end));assert(m.canSee(1,end));}
});

check('campaign AI advances its designated ships toward each historical harbor objective',()=>{
  const priority:Record<string,number>={DD:0,CL:1,CA:2};
  for(const battleId of ['coral-sea','midway','guadalcanal','leyte-gulf'] as const)for(let side=0;side<2;side++){
    const {match,battle}=campaignAiMatch(battleId,side),objective=battle.mission.objectives[side];
    if(objective.kind!=='hold-port'&&objective.kind!=='capture-port')continue;
    const port=match.ports[objective.portIndex],leader=match.units.filter(unit=>unit.ownerId===side+1&&unit.status==='ready'&&['DD','CL','CA'].includes(unit.asset.ship_type.code))
      .sort((a,b)=>(priority[a.asset.ship_type.code]??9)-(priority[b.asset.ship_type.code]??9)||a.instanceId.localeCompare(b.instanceId))[0];
    assert(port&&leader);const before=hexDistance(leader,port);executeAiTurn(match);
    const order=match.movementOrders.find(item=>item.unitId===leader.instanceId);assert(order,`${battleId} side ${side+1}: AI did not assign a ship to the mission harbor`);
    assert(hexDistance(order.target,port)<before,`${battleId} side ${side+1}: mission ship moved from distance ${before} to ${hexDistance(order.target,port)}`);
  }
});

check('campaign AI selects a mission carrier over a nearby destroyer',()=>{
  const {match}=campaignAiMatch('midway',0);match.rulesetId='classic-v1';
  const attacker=match.unit('team-1-baerdimo'),carrier=match.unit('team-2-chicheng'),destroyer=match.unit('team-2-lingbo');
  const occupied=new Set(match.units.filter(unit=>unit!==attacker&&unit!==carrier&&unit!==destroyer).map(cellKey));
  const adjacent=neighbors(attacker).filter(cell=>match.world.isSea(cell)&&!occupied.has(cellKey(cell)));
  assert(adjacent.length>=2,'expected two open sea cells beside the cruiser');
  Object.assign(carrier,adjacent[0]);Object.assign(destroyer,adjacent[1]);
  for(const unit of match.units.filter(unit=>unit.ownerId===1))unit.action=unit===attacker?1:0;
  match.refreshVision();assert(match.unitVisible(carrier)&&match.unitVisible(destroyer));
  const report=executeAiTurn(match);
  assert.equal(report.combats[0]?.targetId,carrier.instanceId,'AI should prioritize the carrier required by the Midway objective');
});

check('campaign AI sends a threatened harbor guard to a safer cell and keeps it on station',()=>{
  const {match,battle}=campaignAiMatch('guadalcanal',0),objective=battle.mission.objectives[0];if(objective.kind!=='hold-port')throw Error('expected a harbor defense objective');
  const port=match.ports[objective.portIndex],guard=match.unit('team-1-lafei'),enemy=match.unit('team-2-changmen');
  Object.assign(guard,port);Object.assign(enemy,{col:58,row:50});match.refreshVision();
  assert(match.unitVisible(enemy),'the nearby enemy must be identified before its threat affects AI movement');
  const weapons=match.weapons(enemy),inFiringRange=(cell:Cell)=>weapons.some(weapon=>{const distance=hexDistance(cell,enemy);return distance>=weapon.minRange&&distance<=weapon.maxRange;});
  assert(inFiringRange(guard),'the enemy should threaten the current harbor position');
  executeAiTurn(match);const evade=match.movementOrders.find(order=>order.unitId===guard.instanceId);
  assert(evade,'the AI should move the threatened harbor guard when a safer position is available');
  assert(hexDistance(evade.target,port)<=2,'the evasive move must stay within the harbor defense area');
  assert(!inFiringRange(evade.target),'the evasive move should leave the visible enemy firing envelope');
  match.endTurn();assert(hexDistance(guard,port)<=2);assert.equal(port.ownerId,1,'the harbor must remain under friendly control after evasion');
  for(let turn=0;turn<3;turn++){
    while(match.active.id!==1&&!match.result)match.endTurn();
    if(match.result)break;
    assert.equal(enemy.status,'ready','the nearby enemy threat should remain active during the defense test');
    assert(match.unitVisible(enemy),'the harbor guard should retain current contact with the nearby threat');
    executeAiTurn(match);
    const order=match.movementOrders.find(item=>item.unitId===guard.instanceId);
    if(order)assert(hexDistance(order.target,port)<=2,'the defending ship must not abandon its harbor');
    match.endTurn();assert(hexDistance(guard,port)<=2,'the defending ship must remain on station after each turn');
    assert.equal(port.ownerId,1,'the threatened harbor must remain under friendly control');
  }
});

check('campaign AI captures its assigned enemy harbor over successive turns',()=>{
  const {match,battle}=campaignAiMatch('coral-sea',1),objective=battle.mission.objectives[1];if(objective.kind!=='capture-port')throw Error('expected a harbor capture objective');
  const port=match.ports[objective.portIndex],opponents=match.units.filter(unit=>unit.ownerId===1);
  const occupied=new Set([...match.units.map(cellKey),...match.ports.map(cellKey)]),remote:Cell[]=[];
  for(let row=0;row<match.world.height;row++)for(let col=0;col<match.world.width;col++){
    const cell={col,row};if(match.world.isSea(cell)&&hexDistance(cell,port)>24&&!occupied.has(cellKey(cell)))remote.push(cell);
  }
  remote.sort((a,b)=>hexDistance(b,port)-hexDistance(a,port)||a.row-b.row||a.col-b.col);assert(remote.length>=opponents.length);
  opponents.forEach((unit,index)=>Object.assign(unit,remote[index]));match.refreshVision();
  let aiTurns=0;
  while(!match.result&&aiTurns<battle.mission.roundLimit){
    while(match.active.id!==2&&!match.result)match.endTurn();
    if(match.result)break;
    executeAiTurn(match);match.endTurn();aiTurns++;
  }
  assert.equal(port.ownerId,2,`the mission harbor was not captured after ${aiTurns} Japanese turns`);
  assert.equal(match.result?.winnerId,2,'capturing the assigned harbor should complete the campaign objective');
  assert.equal(match.result?.reason,'objective');
});

check('campaign AI keeps a harbor siege active instead of firing at a nearby ship',()=>{
  const {match,battle}=campaignAiMatch('coral-sea',1),objective=battle.mission.objectives[1];if(objective.kind!=='capture-port')throw Error('expected a harbor capture objective');
  const port=match.ports[objective.portIndex],priority=(unit:MatchUnit)=>unit.asset.ship_type.code==='DD'?0:unit.asset.ship_type.code==='CL'?1:2;
  const leader=match.units.filter(unit=>unit.ownerId===2&&unit.status==='ready'&&['DD','CL','CA'].includes(unit.asset.ship_type.code))
    .sort((a,b)=>priority(a)-priority(b)||a.instanceId.localeCompare(b.instanceId))[0];
  const defender=match.unit('team-1-baerdimo');assert(port&&leader&&defender);
  for(const unit of match.units.filter(unit=>unit.ownerId===2&&unit!==leader)){unit.status='hold';unit.action=0;}
  Object.assign(leader,{col:port.col,row:port.row});
  const defenderWeapons=match.weapons(defender),attackerWeapons=match.weapons(leader),firingCells:Cell[]=[];
  for(let row=0;row<match.world.height;row++)for(let col=0;col<match.world.width;col++){
    const cell={col,row},distance=hexDistance(cell,port);
    if(match.world.isSea(cell)&&distance>1&&defenderWeapons.some(weapon=>distance>=weapon.minRange&&distance<=weapon.maxRange)
      &&distance<=4&&attackerWeapons.some(weapon=>distance>=weapon.minRange&&distance<=weapon.maxRange&&weapon.kind!=='air')
      &&!hexLine(port,cell).slice(1,-1).some(sample=>match.world.at(sample)===Terrain.Land)
      &&!hexLine(cell,port).slice(1,-1).some(sample=>match.world.at(sample)===Terrain.Land))firingCells.push(cell);
  }
  firingCells.sort((a,b)=>hexDistance(a,port)-hexDistance(b,port)||a.row-b.row||a.col-b.col);
  const defenderCell=firingCells[0];assert(defenderCell,'expected an open sea firing position beside the harbor');Object.assign(defender,defenderCell);
  match.refreshVision();
  assert(match.unitVisible(defender),'the harbor defender should be visible to the occupying ship');
  assert(match.weapons(defender).some(weapon=>{const distance=hexDistance(defender,port);return distance>=weapon.minRange&&distance<=weapon.maxRange;}),'the defender should remain in firing range');
  assert(attackerWeapons.some(weapon=>match.attackPreview(leader.instanceId,defender.instanceId,weapon.id).valid),'the occupier must have a legal attack available against the defender');
  const startReport=executeAiTurn(match);
  assert.equal(port.occupationOwnerId,2,'the AI should start its harbor siege before attacking');
  assert(!match.combatOrders.some(order=>order.attackerId===leader.instanceId),'the occupier must not fire while starting the siege');
  assert.equal(leader.firedThisTurn,false);
  match.endTurn();
  assert.equal(port.occupationProgress,1,'the first uninterrupted allied end phase should advance the siege');
  while(match.active.id!==2&&!match.result)match.endTurn();
  assert.equal(port.occupationProgress,1,'the siege should remain active through the opposing side turn');
  const continuationReport=executeAiTurn(match);
  assert(!match.combatOrders.some(order=>order.attackerId===leader.instanceId),'the occupier must not fire and reset its active siege');
  assert.equal(leader.firedThisTurn,false);
  match.endTurn();
  assert.equal(port.ownerId,2,'the harbor should be captured when the second uninterrupted occupation turn ends');
  assert.equal(defender.status,'ready','the nearby defender must still be afloat when the siege completes');
  assert.equal(match.result?.winnerId,2);
  assert.equal(match.result?.reason,'objective');
  assert(startReport.captures>=1,'the occupier should spend its first action starting the siege');
  assert(continuationReport.defended>=1,'the occupier should retain a legal non-firing action while maintaining the siege');
});

const report={generatedAt:new Date().toISOString(),passed:checks.length,checks};
writeFileSync('output/ai-rules-check.json',JSON.stringify(report,null,2)+'\n');
console.log(`AI rules check passed: ${checks.length} scenarios`);
