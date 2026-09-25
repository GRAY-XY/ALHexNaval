import { cellCenter, neighbors, worldBounds } from './hex.ts';
import { Terrain, type Cell, type DeployedShip, type ShipAsset } from './types.ts';

export function randomAt(x: number, y: number, salt = 0): number {
  let n = Math.imul(x + 117 + salt, 374761393) ^ Math.imul(y + 91, 668265263);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}
function smoothNoise(x: number, y: number, size: number): number {
  const xx = x / size, yy = y / size, ix = Math.floor(xx), iy = Math.floor(yy);
  const fx = xx - ix, fy = yy - iy, sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = randomAt(ix, iy), b = randomAt(ix + 1, iy), c = randomAt(ix, iy + 1), d = randomAt(ix + 1, iy + 1);
  return a * (1 - sx) * (1 - sy) + b * sx * (1 - sy) + c * (1 - sx) * sy + d * sx * sy;
}
export const TERRAIN_LABELS = ['深海', '海面', '浅滩', '岛屿'];
export const TERRAIN_COLORS = ['#27617d', '#3b8da4', '#72b8bd', '#adb17a'];

export class HexWorld {
  readonly width: number;
  readonly height: number;
  readonly terrain: Uint8Array;
  readonly valid: Uint8Array;
  readonly bounds;
  readonly generationMs: number;
  readonly landCells: number;
  readonly home: Cell;
  constructor(size: number) {
    const started = performance.now();
    this.width = this.height = size;
    this.bounds = worldBounds(size, size);
    this.terrain = new Uint8Array(size * size);
    // Validity is separate from terrain so later maps can have arbitrary outlines.
    this.valid = new Uint8Array(size * size).fill(1);
    this.home = { col: Math.round(size * .12), row: Math.round(size * .13) };
    let land = 0;
    for (let row = 0; row < size; row++) for (let col = 0; col < size; col++) {
      const px = Math.floor(col / 30), py = Math.floor(row / 30);
      let island = -10;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const ax = px + dx, ay = py + dy;
        if (randomAt(ax, ay, 9) < .43) continue;
        const cx = ax * 30 + 7 + randomAt(ax, ay, 2) * 16;
        const cy = ay * 30 + 7 + randomAt(ax, ay, 3) * 16;
        const heading = randomAt(ax, ay, 6) * Math.PI * 2;
        for (let lobe = 0; lobe < 3; lobe++) {
          const spread = lobe ? 4 + randomAt(ax, ay, 12 + lobe) * 4 : 0;
          const direction = heading + (lobe === 1 ? -.9 : lobe === 2 ? 1.35 : 0);
          const lx = cx + Math.cos(direction) * spread, ly = cy + Math.sin(direction) * spread;
          const rotation = heading * .35 + (randomAt(ax, ay, 18 + lobe) - .5) * .55;
          const cosine = Math.cos(rotation), sine = Math.sin(rotation), ox = col - lx, oy = row - ly;
          const u = ox * cosine + oy * sine, v = -ox * sine + oy * cosine;
          const rx = 5.7 + randomAt(ax, ay, 22 + lobe) * 4.4, ry = 4.8 + randomAt(ax, ay, 26 + lobe) * 4.2;
          const distance = (u / rx) ** 2 + (v / ry) ** 2;
          island = Math.max(island, 1 - distance + (smoothNoise(col + ax * 7 + lobe * 19, row + ay * 11 + lobe * 23, 4) - .5) * .78);
        }
      }
      const homeIslands = [
        1 - ((col - this.home.col + 13) / 9.5) ** 2 - ((row - this.home.row + 1) / 10.5) ** 2,
        .92 - ((col - this.home.col + 18) / 7.2) ** 2 - ((row - this.home.row + 7) / 6.8) ** 2,
        .88 - ((col - this.home.col + 12) / 6.2) ** 2 - ((row - this.home.row - 10) / 7.5) ** 2,
      ];
      island = Math.max(island, ...homeIslands) + (smoothNoise(col + 83, row + 61, 4) - .5) * .24;
      const noise = smoothNoise(col, row, 11);
      let terrain = island > .15 ? Terrain.Land : island > -.48 ? Terrain.Shallow : noise > .37 ? Terrain.Sea : Terrain.Deep;
      this.terrain[row * size + col] = terrain;
      if (terrain === Terrain.Land) land++;
    }
    // Reserve the actual assembly cells rather than erasing a large circle of islands.
    for (let i = 0; i < 12; i++) {
      const slot = { col: this.home.col - 5 + i % 4 * 3, row: this.home.row - 3 + Math.floor(i / 4) * 3 };
      for (const cell of [slot, ...neighbors(slot)]) if (this.contains(cell)) {
        const index = cell.row * size + cell.col;
        if (this.terrain[index] === Terrain.Land) { this.terrain[index] = Terrain.Shallow; land--; }
        if (cell.col === slot.col && cell.row === slot.row) this.terrain[index] = Terrain.Sea;
      }
    }
    this.landCells = land;
    this.generationMs = performance.now() - started;
  }
  contains(cell: Cell): boolean {
    return Number.isInteger(cell.col) && Number.isInteger(cell.row) && cell.col >= 0 && cell.row >= 0 && cell.col < this.width && cell.row < this.height
      && this.valid[cell.row * this.width + cell.col] === 1;
  }
  at(cell: Cell): Terrain | undefined {
    return this.contains(cell) ? this.terrain[cell.row * this.width + cell.col] as Terrain : undefined;
  }
  isSea(cell: Cell): boolean { return this.contains(cell) && this.at(cell) !== Terrain.Land; }
  nearbySea(preferred: Cell, occupied = new Set<string>()): Cell {
    const queue = [preferred], seen = new Set([`${preferred.col},${preferred.row}`]);
    for (let i = 0; i < queue.length; i++) {
      const cell = queue[i], key = `${cell.col},${cell.row}`;
      if (this.isSea(cell) && !occupied.has(key)) return cell;
      for (const next of neighbors(cell)) {
        const nextKey = `${next.col},${next.row}`;
        if (this.contains(next) && !seen.has(nextKey)) { seen.add(nextKey); queue.push(next); }
      }
    }
    throw Error('No available sea cell');
  }
  deploy(assets: ShipAsset[], origin = this.home, ownerId?: number, occupied = new Set<string>()): DeployedShip[] {
    return assets.map((asset, index) => {
      const preferred = { col: origin.col - 5 + (index % 4) * 3, row: origin.row - 3 + Math.floor(index / 4) * 3 };
      const cell = this.nearbySea(preferred, occupied);
      occupied.add(`${cell.col},${cell.row}`);
      return { ...cell, instanceId: ownerId ? `team-${ownerId}-${asset.id}` : `preview-${asset.id}`, ownerId, asset, facing: index % 2 ? 'left' : 'right' };
    });
  }
  overviewCanvas(maxSize = 1536): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    const scale = maxSize / Math.max(this.bounds.width, this.bounds.height);
    canvas.width = Math.ceil(this.bounds.width * scale); canvas.height = Math.ceil(this.bounds.height * scale);
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#d9d0b5'; context.fillRect(0, 0, canvas.width, canvas.height);
    for (let row = 0; row < this.height; row++) for (let col = 0; col < this.width; col++) {
      const cell = { col, row }; if (!this.contains(cell)) continue;
      const p = cellCenter(cell); context.fillStyle = TERRAIN_COLORS[this.at(cell)!];
      context.fillRect((p.x - 37) * scale, (p.y - 32) * scale, 75 * scale + .4, 64 * scale + .4);
    }
    context.globalCompositeOperation='soft-light';
    for(let y=0;y<canvas.height;y+=5)for(let x=0;x<canvas.width;x+=5){const n=randomAt(x,y,71);context.fillStyle=n>.5?`rgba(255,245,215,${.02+n*.035})`:`rgba(18,72,78,${.015+(1-n)*.025})`;context.fillRect(x,y,5,5);}
    context.globalCompositeOperation='source-over';
    return canvas;
  }
}
