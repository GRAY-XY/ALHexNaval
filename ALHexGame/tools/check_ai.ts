import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {executeAiTurn} from '../src/ai.ts';
import {hexDistance} from '../src/hex.ts';
import {Match,type MatchUnit} from '../src/match.ts';
import {cellKey} from '../src/pathfinding.ts';
import type {Roster} from '../src/types.ts';
import {HexWorld} from '../src/world.ts';

const assets=(JSON.parse(readFileSync('data/roster.json','utf8')) as Roster).units;
const checks:{name:string;passed:boolean}[]=[];
function check(name:string,fn:()=>void){fn();checks.push({name,passed:true});}
function aiMatch(){return new Match(new HexWorld(128),assets,2,['ai','human']);}
function sink(unit:MatchUnit){Object.assign(unit,{hp:0,action:0,status:'sunk',guard:false});}

check('AI and player seat controllers persist in v15 saves',()=>{
  const m=aiMatch(),saved=m.save(),loaded=Match.load(saved,assets);assert.equal(saved.version,15);assert.deepEqual(loaded.teams.map(team=>team.controller),['ai','human']);assert.deepEqual(loaded.save(),saved);
});

check('v14 saves migrate to human seats so old local games are never taken over',()=>{
  const m=aiMatch(),legacy:any=m.save();legacy.version=14;for(const team of legacy.teams)delete team.controller;
  const before=JSON.stringify(legacy),loaded=Match.load(legacy,assets);assert.equal(JSON.stringify(legacy),before);assert(loaded.teams.every(team=>team.controller==='human'));assert.equal(loaded.save().version,15);
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

const report={generatedAt:new Date().toISOString(),passed:checks.length,checks};
writeFileSync('output/ai-rules-check.json',JSON.stringify(report,null,2)+'\n');
console.log(`AI rules check passed: ${checks.length} scenarios`);
