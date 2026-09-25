async (page) => {
  await page.reload();await page.waitForFunction(()=>window.navalMap?.ready);
  const before=await page.evaluate(()=>window.navalMap.match.save());
  await page.locator('#import-file').setInputFiles('output/legacy-ownership-test.json');
  await page.waitForFunction(()=>document.getElementById('message').textContent.includes('战局已恢复'));
  await page.waitForFunction(()=>window.navalMap.ready&&window.navalMap.world.width===256&&window.navalMap.units.length===48);
  const saved=await page.evaluate(()=>window.navalMap.match.save());
  if(saved.version!==2||saved.units.filter(u=>u.ownerId===1).length!==12)throw Error('Legacy migration incomplete');
  if(!await page.evaluate(()=>document.querySelectorAll('.ship-row').length===12&&[...document.querySelectorAll('.ship-row')].every(row=>window.navalMap.match.unit(row.dataset.instance).ownerId===1)))throw Error('Legacy sidebar invalid');
  await page.reload();await page.waitForFunction(()=>window.navalMap.ready&&window.navalMap.world.width===256);
  const after=await page.evaluate(()=>window.navalMap.match.save());
  const normalize=value=>Array.isArray(value)?value.map(normalize):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,normalize(value[key])])):value;
  if(JSON.stringify(normalize(saved))!==JSON.stringify(normalize(after)))throw Error('Reload of migrated game differs');
  return {passed:true,legacyVersion:1,convertedVersion:after.version,units:after.units.length,ownUnits:12,checks:['Legacy JSON import expands the old roster to all players','All old demo ships belong to the current player','Only 12 own ship rows appear','Reload preserves the migrated match']};
}
