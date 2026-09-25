async (page) => {
  await page.waitForFunction(() => window.navalMap?.stats().ships.rigsLoaded === 12);
  return await page.evaluate(() => window.navalMap.ships.visuals.map(v => ({id: v.unit.asset.id,
    bones: v.rig.skeleton.bones.filter(b => /foot|leg|jiao|ground|body|root|knee|thigh/i.test(b.data.name)).map(b => ({name:b.data.name,x:b.worldX,y:b.worldY})),
    slots: v.rig.skeleton.slots.filter(s => /foot|leg|jiao|shoe/i.test(s.data.name)).map(s => ({name:s.data.name, attachment:s.attachment?.name, bone:s.bone.data.name}))})));
}
