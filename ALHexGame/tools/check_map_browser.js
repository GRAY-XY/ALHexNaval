async (page) => {
  const report = { verifiedAt: new Date().toISOString(), status: 'passed', checks: [], benchmarks: [], consoleErrors: [] };
  page.on('pageerror', error => report.consoleErrors.push(String(error)));
  const ensure = (condition, message) => { if (!condition) throw Error(message); report.checks.push(message); };
  const waitReady = async size => {
    await page.waitForFunction(size => window.navalMap?.ready && window.navalMap.world.width === size, size);
    await page.waitForFunction(() => !window.navalMap.dirty && window.navalMap.stats().ships.rigsLoaded === 12 && window.navalMap.stats().terrain.pendingChunks === 0);
  };
  await waitReady(256);
  const initial = await page.evaluate(() => window.navalMap.stats());
  ensure(initial.ships.visibleRigs === 12 && initial.ships.errors.length === 0, '12 copied skeletons render in the fleet view');
  const viewport = await page.locator('#canvas-host canvas').boundingBox();
  const start = { x: viewport.x + viewport.width * .65, y: viewport.y + viewport.height * .7 };
  await page.mouse.move(start.x, start.y); await page.mouse.down();
  await page.mouse.move(start.x + 110, start.y + 70, { steps: 8 }); await page.mouse.up();
  const dragged = await page.evaluate(() => window.navalMap.stats());
  ensure(Math.hypot(dragged.camera.x - initial.camera.x, dragged.camera.y - initial.camera.y) > 80, 'Pointer dragging changes the camera');
  const cursor = { x: viewport.width * .5, y: viewport.height * .5 };
  const beforeWheel = await page.evaluate(cursor => window.navalMap.camera.screenToWorld(cursor), cursor);
  await page.mouse.move(viewport.x + cursor.x, viewport.y + cursor.y); await page.mouse.wheel(0, -100);
  await page.waitForFunction(zoom => window.navalMap.camera.zoom > zoom, dragged.camera.zoom);
  const afterWheel = await page.evaluate(cursor => window.navalMap.camera.screenToWorld(cursor), cursor);
  ensure(Math.hypot(beforeWheel.x - afterWheel.x, beforeWheel.y - afterWheel.y) < .001, 'Wheel zoom keeps the world position under the cursor');
  const target = await page.evaluate(() => {
    const map = window.navalMap, visual = map.ships.visuals.find(v => v.unit.asset.id === 'hailunna');
    const p = visual.root.getGlobalPosition(); return { x: p.x, y: p.y - 35 * map.camera.zoom };
  });
  await page.mouse.click(viewport.x + target.x, viewport.y + target.y);
  ensure(await page.evaluate(() => window.navalMap.selected === 'preview-hailunna'), 'Clicking the rendered chibi selects its ship');
  const originalFacing = await page.evaluate(() => window.navalMap.units.find(u => u.asset.id === 'hailunna').facing);
  await page.getByRole('button', { name: '↔ 切换舰船朝向' }).click();
  ensure(await page.evaluate(original => window.navalMap.units.find(u => u.asset.id === 'hailunna').facing !== original, originalFacing), 'Facing button changes the ship orientation');
  await page.getByRole('button', { name: '⬡ 六角网格' }).click();
  ensure(await page.evaluate(() => !window.navalMap.gridVisible), 'Grid toggle hides hex lines');
  await page.getByRole('button', { name: '⬡ 六角网格' }).click();
  await page.getByRole('button', { name: 'Ⅱ 暂停动画' }).click();
  const trackBefore = await page.evaluate(() => window.navalMap.ships.visuals[0].rig.state.getCurrent(0).trackTime);
  await page.evaluate(async () => { for (let i = 0; i < 10; i++) await new Promise(resolve => requestAnimationFrame(resolve)); });
  const trackAfter = await page.evaluate(() => window.navalMap.ships.visuals[0].rig.state.getCurrent(0).trackTime);
  ensure(Math.abs(trackAfter - trackBefore) < .001, 'Pause stops skeleton animation time');
  await page.getByRole('button', { name: '▶ 播放动画' }).click();
  const mini = await page.locator('#minimap').boundingBox();
  await page.mouse.click(mini.x + mini.width * .7, mini.y + mini.height * .65);
  await page.waitForFunction(() => window.navalMap.camera.x > window.navalMap.world.bounds.width * .5);
  await page.evaluate(async () => { for (let i = 0; i < 4; i++) await new Promise(resolve => requestAnimationFrame(resolve)); });
  const far = await page.evaluate(() => window.navalMap.stats());
  ensure(far.ships.visibleRigs === 0, 'Minimap navigation moves off-screen ships out of the animation update');
  await page.getByRole('button', { name: '全图 ↗' }).click();
  await page.waitForFunction(() => !window.navalMap.dirty && window.navalMap.camera.zoom < .36);
  const overview = await page.evaluate(() => window.navalMap.stats());
  ensure(!overview.terrain.detail && overview.ships.visibleRigs === 0 && overview.ships.visibleIcons === 12, 'Full-map overview uses icons and the overview terrain texture');
  await page.screenshot({ path: 'output/playwright/海图-战略总览.png' });
  for (const size of [128, 256, 512]) {
    await page.getByRole('combobox', { name: '海域规模' }).selectOption(String(size));
    await waitReady(size);
    const sample = await page.evaluate(() => window.navalMap.benchmark(90, true));
    report.benchmarks.push(sample);
    ensure(sample.totalCells === size * size && sample.ships.errors.length === 0, `${size} map size renders with intact ship assets`);
    ensure(sample.terrain.cachedChunks <= sample.terrain.chunkLimit, `${size} map stays within the terrain chunk cache limit during panning`);
    if (size === 512) {
      await page.getByRole('button', { name: '全图 ↗' }).click();
      await page.waitForFunction(() => !window.navalMap.dirty && window.navalMap.camera.zoom < .36);
      await page.screenshot({ path: 'output/playwright/海图-512全图.png' });
    }
  }
  // Visit distant sea regions to exercise eviction rather than only reusing nearby chunks.
  await page.getByRole('button', { name: '⌖ 返回舰队' }).click();
  for (const [x, y] of [[.2,.2],[.4,.4],[.6,.6],[.8,.8],[.85,.3],[.3,.85]]) {
    await page.mouse.click(mini.x + mini.width * x, mini.y + mini.height * y);
    await page.waitForFunction(() => !window.navalMap.dirty && window.navalMap.stats().terrain.pendingChunks === 0);
  }
  const cache = await page.evaluate(() => window.navalMap.stats());
  ensure(cache.terrain.cachedChunks <= cache.terrain.chunkLimit && cache.terrain.generatedChunks > cache.terrain.cachedChunks, 'Distant-region navigation evicts old chunk textures');
  report.cacheEviction = { terrain: cache.terrain, jsHeapBytes: cache.jsHeapBytes };
  await page.getByRole('combobox', { name: '海域规模' }).selectOption('256'); await waitReady(256);
  await page.getByRole('button', { name: '⌖ 返回舰队' }).click();
  await page.screenshot({ path: 'output/playwright/海图-战术视图.png' });
  await page.setViewportSize({ width: 980, height: 760 });
  await page.getByRole('button', { name: '⌖ 返回舰队' }).click();
  const layout = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth,
    minimapBottom: document.getElementById('minimap').getBoundingClientRect().bottom,
    footerTop: document.querySelector('footer').getBoundingClientRect().top }));
  ensure(layout.scroll <= layout.width && layout.minimapBottom <= layout.footerTop, '980px desktop layout keeps navigation within the viewport');
  await page.screenshot({ path: 'output/playwright/海图-紧凑窗口.png' });
  await page.setViewportSize({ width: 3840, height: 2160 });
  await page.evaluate(() => { const map = window.navalMap; map.camera.zoomAt(.4 / map.camera.zoom, {x: map.camera.viewportWidth / 2, y: map.camera.viewportHeight / 2}); map.dirty = true; });
  await page.waitForFunction(() => !window.navalMap.dirty && window.navalMap.stats().terrain.pendingChunks === 0);
  const wide = await page.evaluate(() => window.navalMap.stats());
  ensure(wide.terrain.cachedChunks <= wide.terrain.chunkLimit && !wide.terrain.detail, 'Wide 4K overview adapts terrain detail to keep texture caching bounded');
  report.wideWindow = {camera: wide.camera, terrain: wide.terrain};
  await page.setViewportSize({ width: 1440, height: 1050 });
  await page.getByRole('button', { name: '⌖ 返回舰队' }).click();
  ensure(report.consoleErrors.length === 0, 'No uncaught browser errors during map interaction and size changes');
  return report;
}
