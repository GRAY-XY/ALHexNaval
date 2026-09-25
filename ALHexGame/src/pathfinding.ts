import { hexDistance, neighbors } from './hex.ts';
import type { Cell } from './types.ts';

export interface Route { cells: Cell[]; costs: number[]; cost: number; visited: number }
export interface NavigationGrid { width: number; height: number; contains(cell: Cell): boolean }
export const cellKey = (cell: Cell): string => `${cell.col},${cell.row}`;
export const sameCell = (a: Cell, b: Cell): boolean => a.col === b.col && a.row === b.row;

class Heap {
  items: { index: number; priority: number; cost: number }[] = [];
  push(item: { index: number; priority: number; cost: number }): void {
    const a = this.items; let i = a.length; a.push(item);
    while (i > 0) { const p = (i - 1) >> 1; if (a[p].priority <= item.priority) break; a[i] = a[p]; i = p; } a[i] = item;
  }
  pop() {
    const a = this.items, first = a[0], last = a.pop()!;
    if (a.length) { let i = 0; while (i * 2 + 1 < a.length) {
      let child = i * 2 + 1; if (child + 1 < a.length && a[child + 1].priority < a[child].priority) child++;
      if (last.priority <= a[child].priority) break; a[i] = a[child]; i = child;
    } a[i] = last; } return first;
  }
}

// Costs are paid on entering a cell. Infinity means blocked. No browser/rendering dependency.
export function findRoute(grid: NavigationGrid, start: Cell, target: Cell,
  enterCost: (cell: Cell) => number, canStop: (cell: Cell) => boolean): Route | undefined {
  if (!grid.contains(start) || !grid.contains(target) || !canStop(target)) return;
  if (sameCell(start, target)) return { cells: [{ ...start }], costs: [0], cost: 0, visited: 0 };
  if (!Number.isFinite(enterCost(target))) return;
  const total = grid.width * grid.height, distances = new Float64Array(total).fill(Infinity), previous = new Int32Array(total).fill(-1);
  const startIndex = start.row * grid.width + start.col, endIndex = target.row * grid.width + target.col;
  const heap = new Heap(); distances[startIndex] = 0; heap.push({ index: startIndex, cost: 0, priority: hexDistance(start, target) });
  let visited = 0;
  while (heap.items.length) {
    const item = heap.pop(); if (item.cost !== distances[item.index]) continue; visited++;
    if (item.index === endIndex) {
      const indices = [endIndex]; while (indices[indices.length - 1] !== startIndex) indices.push(previous[indices[indices.length - 1]]);
      indices.reverse(); const cells = indices.map(index => ({ col: index % grid.width, row: Math.floor(index / grid.width) }));
      const costs = indices.map((index, i) => i === 0 ? 0 : distances[index] - distances[indices[i - 1]]);
      return { cells, costs, cost: item.cost, visited };
    }
    const cell = { col: item.index % grid.width, row: Math.floor(item.index / grid.width) };
    for (const next of neighbors(cell)) {
      if (!grid.contains(next)) continue; const step = enterCost(next); if (!Number.isFinite(step) || step < 1) continue;
      const index = next.row * grid.width + next.col, cost = item.cost + step;
      if (cost < distances[index]) { distances[index] = cost; previous[index] = item.index;
        heap.push({ index, cost, priority: cost + hexDistance(next, target) }); }
    }
  }
}
