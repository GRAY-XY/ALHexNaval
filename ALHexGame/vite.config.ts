import { defineConfig } from 'vite';
import { cpSync, copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export default defineConfig({
  base: './',
  publicDir: false,
  build: { outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 1200 },
  plugins: [{
    name: 'copy-independent-ship-assets',
    closeBundle() {
      const output = resolve('dist');
      mkdirSync(resolve(output, 'data'), { recursive: true });
      cpSync(resolve('assets/ships'), resolve(output, 'assets/ships'), { recursive: true });
      cpSync(resolve('assets/combat'), resolve(output, 'assets/combat'), { recursive: true });
      cpSync(resolve('assets/terrain'), resolve(output, 'assets/terrain'), { recursive: true });
      cpSync(resolve('data/combat-assets.json'), resolve(output, 'data/combat-assets.json'));
      cpSync(resolve('data/art-assets.json'), resolve(output, 'data/art-assets.json'));
      cpSync(resolve('data/roster.json'), resolve(output, 'data/roster.json'));
      const csvSource = resolve('素材清单.csv'), csvTarget = resolve(output, '素材清单.csv');
      // Some Windows viewers retain the CSV handle. An identical retained copy needs no overwrite.
      if (!existsSync(csvTarget) || !readFileSync(csvTarget).equals(readFileSync(csvSource))) copyFileSync(csvSource, csvTarget);
      cpSync(resolve('preview'), resolve(output, 'preview'), { recursive: true });
      mkdirSync(resolve(output, 'licenses'), { recursive: true });
      for (const name of ['PIXI-LICENSE.txt', 'SPINE-LICENSE.txt']) {
        cpSync(resolve('preview/vendor', name), resolve(output, 'licenses', name));
      }
    },
  }],
});
