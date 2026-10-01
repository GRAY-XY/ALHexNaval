import {CAMPAIGN_BATTLES,isCampaignBattleId,type CampaignBattleId} from './historical-battles.ts';

export type CampaignSideIndex=0|1;
export interface CampaignResultRecord {outcome:'victory'|'defeat'|'draw';round:number}
export interface CampaignSideProgress {unlockedCount:number;records:Partial<Record<CampaignBattleId,CampaignResultRecord>>}
export interface CampaignProgress {version:1;selectedSide:CampaignSideIndex;sides:[CampaignSideProgress,CampaignSideProgress]}
export const CAMPAIGN_PROGRESS_KEY='alhex-campaign-v1';

export function emptyCampaignProgress():CampaignProgress {
  return {version:1,selectedSide:0,sides:[{unlockedCount:1,records:{}},{unlockedCount:1,records:{}}]};
}

export function readCampaignProgress(raw:string|null):CampaignProgress {
  if(!raw)return emptyCampaignProgress();
  try{
    const value=JSON.parse(raw) as any;if(value?.version!==1||![0,1].includes(value.selectedSide)||!Array.isArray(value.sides)||value.sides.length!==2)return emptyCampaignProgress();
    const sides=value.sides.map((side:any)=>{
      if(!Number.isInteger(side?.unlockedCount)||side.unlockedCount<1||side.unlockedCount>CAMPAIGN_BATTLES.length||!side.records||typeof side.records!=='object'||Array.isArray(side.records))throw Error('invalid campaign progress');
      const records:CampaignSideProgress['records']={};
      for(const [id,record] of Object.entries(side.records) as [string,any][]){
        if(!isCampaignBattleId(id)||!['victory','defeat','draw'].includes(record?.outcome)||!Number.isInteger(record.round)||record.round<1)throw Error('invalid campaign record');
        records[id]={outcome:record.outcome,round:record.round};
      }
      return {unlockedCount:side.unlockedCount,records};
    });
    return {version:1,selectedSide:value.selectedSide,sides:sides as [CampaignSideProgress,CampaignSideProgress]};
  }catch{return emptyCampaignProgress();}
}

export function selectCampaignSide(progress:CampaignProgress,side:CampaignSideIndex):CampaignProgress {
  return {...progress,selectedSide:side};
}

export function recordCampaignResult(progress:CampaignProgress,sideIndex:CampaignSideIndex,battleId:CampaignBattleId,outcome:CampaignResultRecord['outcome'],round:number):CampaignProgress {
  const index=CAMPAIGN_BATTLES.findIndex(battle=>battle.id===battleId);if(index<0||!Number.isInteger(round)||round<1)return progress;
  const sides=progress.sides.map(side=>({unlockedCount:side.unlockedCount,records:{...side.records}})) as [CampaignSideProgress,CampaignSideProgress],side=sides[sideIndex];
  side.records[battleId]={outcome,round};if(outcome==='victory')side.unlockedCount=Math.max(side.unlockedCount,Math.min(index+2,CAMPAIGN_BATTLES.length));
  return {...progress,sides};
}
