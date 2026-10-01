import assert from 'node:assert/strict';
import {CAMPAIGN_BATTLES} from '../src/historical-battles.ts';
import {emptyCampaignProgress,readCampaignProgress,recordCampaignResult,selectCampaignSide} from '../src/campaign-progress.ts';

let progress=emptyCampaignProgress();assert.equal(progress.sides[0].unlockedCount,1);assert.equal(progress.sides[1].unlockedCount,1);
progress=recordCampaignResult(progress,0,CAMPAIGN_BATTLES[0].id,'defeat',6);assert.equal(progress.sides[0].unlockedCount,1);
progress=recordCampaignResult(progress,0,CAMPAIGN_BATTLES[0].id,'victory',4);assert.equal(progress.sides[0].unlockedCount,2);assert.equal(progress.sides[0].records['pearl-harbor']?.round,4);
progress=selectCampaignSide(progress,1);assert.equal(progress.selectedSide,1);
progress=recordCampaignResult(progress,1,CAMPAIGN_BATTLES[0].id,'victory',3);assert.equal(progress.sides[1].unlockedCount,2);assert.equal(progress.sides[0].unlockedCount,2);
for(const battle of CAMPAIGN_BATTLES.slice(1))progress=recordCampaignResult(progress,1,battle.id,'victory',4);
assert.equal(progress.sides[1].unlockedCount,CAMPAIGN_BATTLES.length);assert.equal(progress.sides[1].records['leyte-gulf']?.outcome,'victory');
assert.deepEqual(readCampaignProgress(JSON.stringify(progress)),progress);assert.equal(readCampaignProgress('{bad json').sides[0].unlockedCount,1);
assert.equal(readCampaignProgress(JSON.stringify({...progress,selectedSide:5})).selectedSide,0);
console.log(JSON.stringify({passed:true,chapters:CAMPAIGN_BATTLES.length,checks:8}));
