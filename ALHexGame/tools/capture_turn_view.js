async (page) => {
  await page.setViewportSize({width:1440,height:1050});
  await page.waitForFunction(()=>window.navalMap?.ready);
  await page.getByRole('button',{name:'定位 拉菲',exact:true}).click();
  await page.getByRole('button',{name:'⌖ 返回舰队',exact:true}).click();
  const target=await page.evaluate(()=>{
    const m=window.navalMap,u=m.match.unit(m.selected),w=Math.sqrt(3)*42;
    for(let d=5;d<=8;d++) for(const [dx,dy] of [[d,0],[-d,0],[0,-d],[0,d]]) { const cell={col:u.col+dx,row:u.row+dy}; if(!m.match.route(u.instanceId,cell))continue;
      const p=m.camera.worldToScreen({x:w*(cell.col+(cell.row&1)*.5)+w/2,y:42+63*cell.row}),r=document.getElementById('map-viewport').getBoundingClientRect();
      if(p.x<30||p.x>r.width-100||p.y<150||p.y>r.height-280)continue;return{x:p.x+r.left,y:p.y+r.top};
    }throw Error('No capture route');
  });
  await page.mouse.move(target.x,target.y);await page.waitForFunction(()=>window.navalMap.routePreview&&!window.navalMap.dirty&&!window.navalMap.terrain.stats().pendingChunks);
  await page.waitForFunction(()=>document.getElementById('message').hidden);
  await page.screenshot({path:'output/playwright/行动力-本方舰船.png'});
  return {ready:true,view:await page.evaluate(()=>window.navalMap.stats())};
}
