async (page) => {
  await page.waitForFunction(() => window.navalMap?.ready && window.navalMap.stats().ships.rigsLoaded === 12, { timeout: 30000 });
  await page.waitForFunction(() => window.navalMap.stats().terrain.pendingChunks === 0);
  return await page.evaluate(() => window.navalMap.stats());
}
