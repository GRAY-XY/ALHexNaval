import type { Point } from './types.ts';

export function selectionRect(start: Point, end: Point) {
  return { left: Math.min(start.x,end.x), top: Math.min(start.y,end.y), width: Math.abs(end.x-start.x), height: Math.abs(end.y-start.y) };
}
export function inSelectionBox(point: Point, start: Point, end: Point): boolean {
  const rect = selectionRect(start,end);
  return point.x >= rect.left && point.x <= rect.left+rect.width && point.y >= rect.top && point.y <= rect.top+rect.height;
}
