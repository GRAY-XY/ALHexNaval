import type { Cell, Point, WorldBounds } from './types.ts';

export const HEX_RADIUS = 42;
export const HEX_WIDTH = Math.sqrt(3) * HEX_RADIUS;
export const ROW_HEIGHT = HEX_RADIUS * 1.5;
const DIRECTIONS = [[1, 0], [0, 1], [-1, 1], [-1, 0], [0, -1], [1, -1]];

export function toAxial(cell: Cell): { q: number; r: number } {
  return { q: cell.col - (cell.row - (cell.row & 1)) / 2, r: cell.row };
}
export function fromAxial(q: number, r: number): Cell {
  return { col: q + (r - (r & 1)) / 2 + 0, row: r + 0 };
}
export function cellCenter(cell: Cell): Point {
  return { x: HEX_WIDTH * (cell.col + (cell.row & 1) * .5) + HEX_WIDTH / 2,
    y: HEX_RADIUS + ROW_HEIGHT * cell.row };
}
export function worldToCell(point: Point): Cell {
  const x = point.x - HEX_WIDTH / 2, y = point.y - HEX_RADIUS;
  const q = (Math.sqrt(3) / 3 * x - y / 3) / HEX_RADIUS;
  const r = (2 / 3 * y) / HEX_RADIUS;
  const s = -q - r;
  let rq = Math.round(q), rr = Math.round(r);
  const rs = Math.round(s), dq = Math.abs(rq - q), dr = Math.abs(rr - r), ds = Math.abs(rs - s);
  if (dq > dr && dq > ds) rq = -rr - rs;
  else if (dr > ds) rr = -rq - rs;
  return fromAxial(rq, rr);
}
export function neighbors(cell: Cell): Cell[] {
  const { q, r } = toAxial(cell);
  return DIRECTIONS.map(([dq, dr]) => fromAxial(q + dq, r + dr));
}
export function hexDistance(a: Cell, b: Cell): number {
  const aa = toAxial(a), bb = toAxial(b);
  return (Math.abs(aa.q - bb.q) + Math.abs(aa.r - bb.r) + Math.abs(aa.q + aa.r - bb.q - bb.r)) / 2;
}
export function hexLine(a: Cell, b: Cell): Cell[] {
  const start = toAxial(a), end = toAxial(b), distance = hexDistance(a, b), cells: Cell[] = [];
  const roundCube = (q: number, r: number, s: number): Cell => {
    let rq = Math.round(q), rr = Math.round(r), rs = Math.round(s);
    const dq = Math.abs(rq - q), dr = Math.abs(rr - r), ds = Math.abs(rs - s);
    if (dq > dr && dq > ds) rq = -rr - rs;
    else if (dr > ds) rr = -rq - rs;
    return fromAxial(rq, rr);
  };
  for (let i = 0; i <= distance; i++) {
    const t = distance ? i / distance : 0;
    const q = start.q + (end.q - start.q) * t, r = start.r + (end.r - start.r) * t;
    cells.push(roundCube(q, r, -q - r));
  }
  return cells;
}
export function hexVertices(center: Point, radius = HEX_RADIUS): Point[] {
  return Array.from({ length: 6 }, (_, i) => {
    const angle = (i * 60 - 30) * Math.PI / 180;
    return { x: center.x + Math.cos(angle) * radius, y: center.y + Math.sin(angle) * radius };
  });
}
export function worldBounds(width: number, height: number): WorldBounds {
  return { width: HEX_WIDTH * (width + .5), height: ROW_HEIGHT * (height - 1) + HEX_RADIUS * 2 };
}
