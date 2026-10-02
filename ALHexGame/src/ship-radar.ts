import type {MatchUnit} from './match.ts';
import {shipRulesV2,shipSpeedV2,shipVisionV2} from './naval-rules-v2.ts';

const SVG='http://www.w3.org/2000/svg';
const RADAR_AXES=[
  {key:'hp',label:'耐久',max:16},
  {key:'armor',label:'装甲',max:3},
  {key:'speed',label:'航速',max:5},
  {key:'vision',label:'视野',max:4},
  {key:'aa',label:'防空',max:3},
  {key:'torpedoes',label:'鱼雷',max:2},
] as const;

function svgNode(name:string,attributes:Record<string,string>):SVGElement {
  const node=document.createElementNS(SVG,name);
  for(const [key,value] of Object.entries(attributes))node.setAttribute(key,value);
  return node;
}

export function createShipRadar(unit:MatchUnit):HTMLElement {
  const profile=shipRulesV2(unit.asset.ship_type.code);
  const values=[unit.maxHp,profile.armor,shipSpeedV2(unit.asset.ship_type.code,unit.submerged),shipVisionV2(unit.asset.ship_type.code,unit.submerged),profile.aa,profile.torpedoes];
  const center={x:110,y:99},radius=47,labelRadius=77;
  const point=(index:number,distance:number)=>{
    const angle=(-90+index*60)*Math.PI/180;
    return {x:center.x+Math.cos(angle)*distance,y:center.y+Math.sin(angle)*distance};
  };
  const valuePoints=values.map((value,index)=>point(index,radius*Math.max(0,Math.min(1,value/RADAR_AXES[index].max))));
  const card=document.createElement('section');card.className='ship-radar-card';card.setAttribute('aria-label','舰种能力雷达图');
  const heading=document.createElement('div');heading.className='ship-radar-heading';
  const title=document.createElement('strong');title.textContent='舰种能力';
  const note=document.createElement('span');note.textContent='外圈为各项上限';
  heading.append(title,note);
  const svg=svgNode('svg',{viewBox:'0 0 220 194',role:'img','aria-label':RADAR_AXES.map((axis,index)=>`${axis.label} ${values[index]} / ${axis.max}`).join('，')}) as SVGSVGElement;
  const accessibleTitle=svgNode('title',{});accessibleTitle.textContent=`${unit.asset.name}舰种能力：${RADAR_AXES.map((axis,index)=>`${axis.label}${values[index]}`).join('、')}`;svg.append(accessibleTitle);
  for(const fraction of [.25,.5,.75,1]){
    const ring=RADAR_AXES.map((_,index)=>point(index,radius*fraction)).map(p=>`${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
    svg.append(svgNode('polygon',{points:ring,class:'ship-radar-ring'}));
  }
  for(let index=0;index<RADAR_AXES.length;index++){
    const end=point(index,radius);
    svg.append(svgNode('line',{x1:String(center.x),y1:String(center.y),x2:end.x.toFixed(1),y2:end.y.toFixed(1),class:'ship-radar-axis'}));
  }
  const shape=valuePoints.map(p=>`${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  svg.append(svgNode('polygon',{points:shape,class:'ship-radar-shape'}));
  valuePoints.forEach((p,index)=>{
    const dot=svgNode('circle',{cx:p.x.toFixed(1),cy:p.y.toFixed(1),r:'2.4',class:'ship-radar-point'});
    const hint=svgNode('title',{});hint.textContent=`${RADAR_AXES[index].label}：${values[index]} / ${RADAR_AXES[index].max}`;dot.append(hint);svg.append(dot);
  });
  RADAR_AXES.forEach((axis,index)=>{
    const p=point(index,labelRadius),anchor=Math.abs(p.x-center.x)<5?'middle':p.x>center.x?'start':'end';
    const label=svgNode('text',{x:p.x.toFixed(1),y:p.y.toFixed(1),'text-anchor':anchor,'dominant-baseline':'middle',class:'ship-radar-label'});
    label.textContent=`${axis.label} ${values[index]}`;svg.append(label);
  });
  const depthNote=unit.asset.ship_type.code==='SS'?`按${unit.submerged?'潜航':'水面'}状态显示航速和视野`:'按当前舰种配置显示';
  const caption=document.createElement('p');caption.className='ship-radar-caption';caption.textContent=depthNote;
  card.append(heading,svg,caption);return card;
}
