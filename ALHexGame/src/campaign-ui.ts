import {cellCenter,hexDistance} from './hex.ts';
import {PORT_INCOME,PORT_OIL_BONUS,REINFORCEMENT_COST,type PortView} from './ports.ts';
import {TEAM_COLORS,type Match} from './match.ts';
import type {Point} from './types.ts';

const $=<T extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id) as T;
function el(tag:string,text='',className=''):HTMLElement{const node=document.createElement(tag);node.textContent=text;node.className=className;return node;}
interface Host {
  match:()=>Match;selected:()=>string|undefined;
  selectedPort:()=>string|undefined;selectPort:(id:string,focus?:boolean)=>void;
  command:(action:()=>void,message?:string)=>void;
  select:(id:string,focus?:boolean)=>void;
  focus:(p:Point)=>void;redeploy:(id:string)=>void;victory:(owner:number)=>void;
}
export class CampaignUI {
  private choices=new Map<string,string>();
  private serviceChoices=new Map<string,string>();
  private reportedResult?:string;
  constructor(private host:Host){
    $('open-ports').onclick=()=>this.open();$('close-ports').onclick=()=>$<HTMLDialogElement>('port-dialog').close();
    $('open-result').onclick=()=>$<HTMLDialogElement>('result-dialog').showModal();$('close-result').onclick=()=>$<HTMLDialogElement>('result-dialog').close();
  }
  render():void {
    const m=this.host.match(),t=m.active,owned=m.ports.filter(p=>p.ownerId===t.id),result=m.result;
    $('campaign-info').textContent=`资金 ${t.credits} · 港口 ${owned.length} · 下次本方回合收入 +${m.income()}${t.eliminated?' · 本方已淘汰':''}${result?' · 战局已结束':''}`;
    $<HTMLButtonElement>('end-turn').disabled=!!result;
    $<HTMLButtonElement>('move-mode').disabled=!!result||!!this.host.selectedPort();
    $('open-result').hidden=!result;
    if(result){
      $<HTMLButtonElement>('next-unit').disabled=true;
      $('result-title').textContent=result.winnerId?`${m.team(result.winnerId).name} 获胜`:'战局结束 · 平局';
      $('result-description').textContent=`第${result.round}轮 · ${result.reason==='headquarters'?'控制了全部母港':result.reason==='elimination'?'其余阵营已被淘汰':'所有阵营均已失去舰船和港口'}`;
      const key=JSON.stringify(result);
      if(this.reportedResult!==key){this.reportedResult=key;if(result.winnerId)this.host.victory(result.winnerId);$<HTMLDialogElement>('port-dialog').close();$<HTMLDialogElement>('result-dialog').showModal();}
    }
    if($<HTMLDialogElement>('port-dialog').open)this.renderPorts();
    const portId=this.host.selectedPort();if(portId)this.renderSelectedPort($('selection'),portId);
  }
  open(portId?:string):void {
    if(portId){this.host.selectPort(portId,true);return;}
    this.host.match().refreshVision();this.renderPorts();$<HTMLDialogElement>('port-dialog').showModal();
  }
  private renderPorts():void {
    const m=this.host.match(),views=m.knownPorts(),list=$('port-list'),scroll=list.scrollTop;
    $('port-summary').textContent=`${m.active.name} · 资金 ${m.active.credits} · 石油 ${m.active.oil}/${m.oilCap()} · 每港口收入10、石油上限+10 · 本方控制 ${m.ports.filter(p=>p.ownerId===m.active.id).length} 座 · 母港共${m.teams.length}座`;
    list.replaceChildren();
    for(const view of views.sort((a,b)=>Number(b.ownerId===m.active.id)-Number(a.ownerId===m.active.id)||Number(!!b.port.homeForId)-Number(!!a.port.homeForId))){
      const p=view.port,row=el('section','','port-card');row.dataset.port=p.id;
      const title=el('div','','port-heading'),manage=document.createElement('button');manage.textContent=`管理 ${p.name}`;
      manage.onclick=()=>{$<HTMLDialogElement>('port-dialog').close();this.host.selectPort(p.id,true);};
      title.append(el('strong',p.name),manage);row.style.setProperty('--port-color',this.color(view));
      row.append(title,el('p',`${p.col}, ${p.row} · ${view.ownerId?m.team(view.ownerId).name:'中立'}${!view.visible?' · 视野外记录':''}`));
      list.append(row);
    }
    if(!views.length)list.append(el('p','尚未发现港口，派舰船或飞机继续侦察。'));
    list.scrollTop=scroll;
  }
  private color(view:PortView):string{return '#'+(view.ownerId?TEAM_COLORS[view.ownerId-1]:0xe9d29d).toString(16).padStart(6,'0');}
  renderSelectedPort(panel:HTMLElement,id:string):void {
    const m=this.host.match(),view=m.knownPorts().find(v=>v.port.id===id),scroll=panel.scrollTop;panel.replaceChildren();
    if(!view){panel.append(el('p','该港口当前没有可查看的情报','selection-empty'));return;}
    const p=view.port,own=view.ownerId===m.active.id,profile=el('section','','port-profile');profile.dataset.port=p.id;profile.style.setProperty('--port-color',this.color(view));
    const head=el('div','','port-profile-heading'),icon=el('span','⚓︎','port-profile-icon'),name=el('div');
    name.append(el('h3',p.name),el('p',`${view.ownerId?m.team(view.ownerId).name:'中立港口'}${p.homeForId?' · 母港':''}`));head.append(icon,name);
    const focus=document.createElement('button');focus.textContent='定位港口';focus.onclick=()=>this.host.focus(cellCenter(p));
    profile.append(head,el('p',`位置 ${p.col}, ${p.row} · ${view.visible?'当前视野':'视野外情报记录'}`,'port-position'),focus);
    const row=el('section','','port-card');
    const nearby=m.units.filter(u=>u.ownerId===m.active.id&&u.status==='ready'&&u.action&&hexDistance(u,p)<=1);
    nearby.sort((a,b)=>(b.maxHp-b.hp)-(a.maxHp-a.hp));
    const service=nearby.find(u=>u.instanceId===this.serviceChoices.get(id))??nearby.find(u=>u.instanceId===this.host.selected())??nearby[0];
    if(service)this.serviceChoices.set(id,service.instanceId);
    if(nearby.length){
      const label=el('label',own?'港内舰船':'执行占领的舰船'),select=document.createElement('select');select.setAttribute('aria-label',`${p.name}港内舰船`);
      for(const u of nearby){const option=document.createElement('option');option.value=u.instanceId;option.textContent=`${u.asset.name} · 耐久 ${u.hp}/${u.maxHp}`;select.append(option);}
      select.value=service!.instanceId;select.onchange=()=>{this.serviceChoices.set(id,select.value);this.renderSelectedPort(panel,id);};label.append(select);row.append(label);
    }
    if(!own){
      const preview=service?m.capturePreview(service.instanceId,id):undefined,b=document.createElement('button');
      b.textContent=service?`占领港口 · ${service.asset.name} · 1作战行动`:'占领港口 · 需可作战舰船进入1格内';b.disabled=!preview?.valid;
      b.onclick=()=>this.host.command(()=>m.capturePort(service!.instanceId,id),`已占领${p.name}，石油上限+${PORT_OIL_BONUS}，下次本方回合获得收入`);
      row.append(b);if(preview?.reason)row.append(el('p',preview.reason,'port-reason'));
      row.append(el('p','占领要求：本方舰船距港口不超过1格，且港口1格内没有敌舰。'));
    }else{
      row.append(el('p',`本港收入 +${PORT_INCOME}资金 / 本方回合 · 石油上限 +${PORT_OIL_BONUS}`,'port-benefits'),el('p',`本轮增援 ${p.usedRound===m.round?'1 / 1 · 已使用':'0 / 1 · 可用'}`,'port-quota'));
      const preview=service?m.repairPreview(service.instanceId,id):undefined,repair=document.createElement('button');
      repair.textContent=service?`维修 ${service.asset.name} · +${preview!.hp}耐久 · ${preview!.cost}资金`:'维修 · 需受损且可作战舰船进入1格内';repair.disabled=!preview?.valid;
      repair.onclick=()=>this.host.command(()=>m.repairShip(service!.instanceId,id),'维修已完成，消耗本舰作战行动');row.append(repair);
      if(preview?.reason)row.append(el('p',preview.reason,'port-reason'));
      const reserves=m.units.filter(u=>u.ownerId===m.active.id&&u.status==='sunk');
      if(reserves.length){
        let choice=this.choices.get(id);if(!reserves.some(u=>u.instanceId===choice)){choice=reserves[0].instanceId;this.choices.set(id,choice);}
        const label=el('label','增援舰型'),select=document.createElement('select');select.setAttribute('aria-label',`${p.name}增援舰型`);
        for(const u of reserves){const option=document.createElement('option');option.value=u.instanceId;option.textContent=`${u.asset.name} · ${REINFORCEMENT_COST[u.asset.ship_type.code]??40}资金`;select.append(option);}select.value=choice!;
        select.onchange=()=>{this.choices.set(id,select.value);this.renderSelectedPort(panel,id);};
        const recruit=m.reinforcementPreview(id,choice!),b=document.createElement('button');b.textContent=`增援所选舰型 · ${recruit.cost}资金`;b.disabled=!recruit.valid;
        b.onclick=()=>this.host.command(()=>{const u=m.reinforce(id,choice!);this.host.redeploy(u.instanceId);},`${p.name}增援已抵达，下次本方回合投入使用`);
        label.append(select);row.append(label,b);if(recruit.reason)row.append(el('p',recruit.reason,'port-reason'));
      }else row.append(el('p','当前没有损失舰型需要增援'));
      row.append(el('p','每港口每轮最多1艘增援；维修每次最多4耐久，每点2资金，使用1作战行动。资金和石油由本方所有港口共用。','port-rules'));
    }
    profile.append(row);panel.append(profile);panel.scrollTop=scroll;
  }
}
