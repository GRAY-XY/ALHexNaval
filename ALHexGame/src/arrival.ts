import { cellCenter, fromAxial, toAxial, worldToCell } from './hex.ts';
import type { Cell, Point } from './types.ts';

export function selectionCenter(points: Point[]): Point {
  if (!points.length) throw Error('先选择单位');
  return { x: points.reduce((sum, p) => sum + p.x, 0) / points.length,
    y: points.reduce((sum, p) => sum + p.y, 0) / points.length };
}
export function arrivalAnchor(points: Point[]): Cell { return worldToCell(selectionCenter(points)); }
export function translateCell(cell: Cell, source: Cell, target: Cell): Cell {
  const p = toAxial(cell), a = toAxial(source), b = toAxial(target);
  return fromAxial(p.q + b.q - a.q, p.r + b.r - a.r);
}
export function arrivalTranslation(source: Cell, target: Cell): Point {
  const a = cellCenter(source), b = cellCenter(target);
  return { x: b.x - a.x, y: b.y - a.y };
}
