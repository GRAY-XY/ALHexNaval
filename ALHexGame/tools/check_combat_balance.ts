import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Match,type MatchUnit} from '../src/match.ts';
import {cellCenter,hexDistance} from '../src/hex.ts';
import {initializeAviationDecks,nationFor,type Squadron} from '../src/aircraft.ts';
import {damageOnHitV2,hitChanceV2,shipRulesV2} from '../src/naval-rules-v2.ts';
import {HexWorld} from '../src/world.ts';
import type {Roster} from '../src/types.ts';

const assets=(JSON.parse(readFileSync('data/roster.json','utf8')) as Roster).units;
const TRIALS=512;
type ShipTrial={scenario:string;seedStart:number;seedEnd:number;trials:number;exactHitChance:number;displayedHitChance:number;observedHitRate:number;averageDamage:number;averageDamageOnHit:number;criticalHits:number;expectedDamagePerShot:number};
type AirTrial={scenario:string;seedStart:number;seedEnd:number;trials:number;aaDice:number;averageAircraftLost:number;averageSuppression:number;averageStrikeDamage:number;strikesThatSankTarget:number};

function arena():Match{return new Match(new HexWorld(5,10,'test-5x10'),assets,2);}
function sink(unit:MatchUnit):void{Object.assign(unit,{hp:0,status:'sunk',action:0,guard:false});}
function exactHitPercent(modifier:number,target:number):number{
  let hits=0;for(let first=1;first<=6;first++)for(let second=1;second<=6;second++){const sum=first+second;if(sum===12||sum!==2&&sum+modifier>=target)hits++;}
  return hits*100/36;
}
function findCell(match:Match,origin:{col:number;row:number},distance:number,blocked=new Set<string>()):{col:number;row:number}{
  for(let row=0;row<match.world.height;row++)for(let col=0;col<match.world.width;col++){
    const cell={col,row};if(hexDistance(origin,cell)===distance&&!blocked.has(`${col},${row}`)&&match.world.isSea(cell))return cell;
  }
  throw Error(`No test-arena sea hex at distance ${distance}`);
}
function fixedSeedSurfaceTrial(attackerCode:'BB'|'DD',targetCode:'CA'|'BB',weaponId:string):ShipTrial{
  const probe=arena(),attackerCell={col:1,row:4},targetCell=findCell(probe,attackerCell,2);
  const count={hits:0,damage:0,onHit:0,criticals:0,exact:0};let displayedChance=0,actualChance=0,expectedDamage=0,modifier=0,targetNumber=0;
  for(let seed=1;seed<=TRIALS;seed++){
    const match=arena(),attacker=match.units.find(unit=>unit.ownerId===1&&unit.asset.ship_type.code===attackerCode)!,target=match.units.find(unit=>unit.ownerId===2&&unit.asset.ship_type.code===targetCode)!;
    match.units.filter(unit=>unit!==attacker&&unit!==target).forEach(sink);
    Object.assign(attacker,{...attackerCell,status:'ready',hp:attacker.maxHp,action:1,torpedoes:attackerCode==='DD'?2:attacker.torpedoes});
    Object.assign(target,{...targetCell,status:'ready',hp:target.maxHp,action:1});match.combatState=seed;match.refreshVision();
    const preview=match.attackPreview(attacker.instanceId,target.instanceId,weaponId);assert(preview.valid&&preview.weapon&&preview.hitChance!==undefined);
    displayedChance=preview.hitChance;modifier=preview.hitModifier!;targetNumber=preview.hitTarget!;actualChance=exactHitPercent(modifier,targetNumber);
    const damageOnHit=damageOnHitV2(preview.weapon,shipRulesV2(target.asset.ship_type.code).armor,false);
    expectedDamage=actualChance/100*damageOnHit+1/36;
    match.orderAttack(attacker.instanceId,target.instanceId,weaponId);match.endTurn();
    const event=match.takeResolvedCombatEvents().find(item=>item.attackerId===attacker.instanceId);assert(event,'the planned test shot resolves');
    count.exact++;count.damage+=event.damage;if(event.hit){count.hits++;count.onHit+=event.damage;}if(event.dice&&event.dice[0]+event.dice[1]===12)count.criticals++;
  }
  const avgDamage=count.damage/count.exact,hitRate=count.hits/count.exact;
  assert.equal(displayedChance,hitChanceV2(modifier,targetNumber),'displayed probability should match the exact 2d6 distribution');
  assert(Math.abs(hitRate-actualChance/100)<.09,`${attackerCode} sampled hit rate should track the exact 2d6 probability`);
  return {scenario:`${attackerCode} ${weaponId} vs ${targetCode} at 2 hexes`,seedStart:1,seedEnd:TRIALS,trials:count.exact,exactHitChance:Number(actualChance.toFixed(4)),displayedHitChance:displayedChance,observedHitRate:Number(hitRate.toFixed(4)),averageDamage:Number(avgDamage.toFixed(4)),averageDamageOnHit:Number((count.onHit/Math.max(1,count.hits)).toFixed(4)),criticalHits:count.criticals,expectedDamagePerShot:Number(expectedDamage.toFixed(4))};
}
function fixedSeedAirTrial(withEscorts:boolean):AirTrial{
  let totalLost=0,totalSuppression=0,totalDamage=0,sunk=0,diceCount=0;
  for(let seed=1;seed<=TRIALS;seed++){
    const match=arena(),carrier=match.units.find(unit=>unit.ownerId===1&&unit.asset.ship_type.code==='CV')!,scout=match.units.find(unit=>unit.ownerId===1&&unit.asset.ship_type.code==='DD')!,target=match.units.find(unit=>unit.ownerId===2&&unit.asset.ship_type.code==='BB')!;
    const escorts=withEscorts?match.units.filter(unit=>unit.ownerId===2&&['DD','CL'].includes(unit.asset.ship_type.code)).slice(0,2):[];
    match.units.filter(unit=>unit!==carrier&&unit!==scout&&unit!==target&&!escorts.includes(unit)).forEach(sink);
    const targetCell={col:2,row:4},carrierCell={col:0,row:0},ring1=Array.from({length:match.world.height},(_,row)=>Array.from({length:match.world.width},(_,col)=>({col,row}))).flat().filter(cell=>hexDistance(targetCell,cell)===1);
    Object.assign(carrier,{...carrierCell,status:'ready',hp:carrier.maxHp});Object.assign(target,{...targetCell,status:'ready',hp:target.maxHp,guard:false});
    const bomberCell=ring1[0],occupied=new Set([`${targetCell.col},${targetCell.row}`,`${carrierCell.col},${carrierCell.row}`,`${bomberCell.col},${bomberCell.row}`]);
    const scoutCell=findCell(match,targetCell,2,occupied);Object.assign(scout,{...scoutCell,status:'ready',hp:scout.maxHp});occupied.add(`${scoutCell.col},${scoutCell.row}`);
    for(let index=0;index<escorts.length;index++){
      const cell=ring1.find(item=>!occupied.has(`${item.col},${item.row}`));assert(cell,'the target has enough adjacent escort positions');
      Object.assign(escorts[index],{...cell,status:'ready',hp:escorts[index].maxHp,guard:false});occupied.add(`${cell.col},${cell.row}`);
    }
    const planes=4,bomber:Squadron={id:'air-1',carrierId:carrier.instanceId,ownerId:1,nation:nationFor(match,carrier.instanceId),role:'bomber',slot:1,...cellCenter(bomberCell),planes,hp:planes*2,maxHp:planes*2,fuelTurns:4,actionPoints:20,ammo:3,cooldown:0,heading:0,order:'patrol'};
    match.aviation.serial=1;match.aviation.squadrons.push(bomber);initializeAviationDecks(match);match.combatState=seed;match.refreshVision();
    const event=match.airDamage(bomber,target.instanceId);assert(event.aa,'V2 target AA should resolve for every strike');
    if(seed===1)diceCount=event.aa.dice.length;else assert.equal(event.aa.dice.length,diceCount,'AA dice count is stable in the scenario');
    totalLost+=event.aa.aircraftLost;totalSuppression+=event.aa.suppression;totalDamage+=event.damage;if(event.sunk)sunk++;
  }
  return {scenario:withEscorts?'Bomber vs BB with two adjacent escorts':'Bomber vs BB without escorts',seedStart:1,seedEnd:TRIALS,trials:TRIALS,aaDice:diceCount,averageAircraftLost:Number((totalLost/TRIALS).toFixed(4)),averageSuppression:Number((totalSuppression/TRIALS).toFixed(4)),averageStrikeDamage:Number((totalDamage/TRIALS).toFixed(4)),strikesThatSankTarget:sunk};
}

const shipTrials=[fixedSeedSurfaceTrial('BB','CA','main-gun'),fixedSeedSurfaceTrial('DD','BB','torpedo')];
const airTrials=[fixedSeedAirTrial(false),fixedSeedAirTrial(true)];
assert.equal(shipTrials[0].displayedHitChance,hitChanceV2(1,7));
assert(shipTrials[1].averageDamageOnHit>0);
assert.equal(airTrials[0].aaDice,3,'an unescorted battleship rolls its three base AA dice');
assert.equal(airTrials[1].aaDice,5,'two adjacent escorts add two AA dice to the cap');
assert(airTrials[1].averageAircraftLost>airTrials[0].averageAircraftLost,'escorts raise aircraft attrition');
assert(airTrials[1].averageStrikeDamage<airTrials[0].averageStrikeDamage,'escorts reduce expected strike damage');
console.log(JSON.stringify({passed:true,map:'5x10 test arena',seedRange:[1,TRIALS],shipTrials,airTrials,caps:{fighterInterceptDamage:3,fighterAmmoPerRound:1,bomberHp:8,interceptsToDestroyFullBomber:3}},null,2));
