import type { Point, ViewBounds, WorldBounds } from './types.ts';

export class Camera {
  x = 0;
  y = 0;
  zoom = .92;
  viewportWidth = 1;
  viewportHeight = 1;
  bounds: WorldBounds;
  constructor(bounds: WorldBounds) { this.bounds = bounds; }
  get minimumZoom(): number {
    return Math.min(.3, this.viewportWidth / this.bounds.width, this.viewportHeight / this.bounds.height) * .92;
  }
  resize(width: number, height: number): void {
    this.viewportWidth = width; this.viewportHeight = height;
    this.zoom = Math.max(this.minimumZoom, this.zoom); this.clamp();
  }
  screenToWorld(point: Point): Point {
    return { x: this.x + (point.x - this.viewportWidth / 2) / this.zoom,
      y: this.y + (point.y - this.viewportHeight / 2) / this.zoom };
  }
  worldToScreen(point: Point): Point {
    return { x: (point.x - this.x) * this.zoom + this.viewportWidth / 2,
      y: (point.y - this.y) * this.zoom + this.viewportHeight / 2 };
  }
  pan(dx: number, dy: number): void { this.x -= dx / this.zoom; this.y -= dy / this.zoom; this.clamp(); }
  zoomAt(factor: number, screen: Point): void {
    const before = this.screenToWorld(screen);
    this.zoom = Math.min(2.1, Math.max(this.minimumZoom, this.zoom * factor));
    const after = this.screenToWorld(screen);
    this.x += before.x - after.x; this.y += before.y - after.y; this.clamp();
  }
  focus(point: Point, zoom = this.zoom): void {
    this.x = point.x; this.y = point.y; this.zoom = Math.max(this.minimumZoom, Math.min(2.1, zoom)); this.clamp();
  }
  fit(): void { this.focus({ x: this.bounds.width / 2, y: this.bounds.height / 2 }, this.minimumZoom); }
  clamp(): void {
    const halfWidth = this.viewportWidth / (2 * this.zoom), halfHeight = this.viewportHeight / (2 * this.zoom);
    this.x = halfWidth * 2 >= this.bounds.width ? this.bounds.width / 2 : Math.min(this.bounds.width - halfWidth, Math.max(halfWidth, this.x));
    this.y = halfHeight * 2 >= this.bounds.height ? this.bounds.height / 2 : Math.min(this.bounds.height - halfHeight, Math.max(halfHeight, this.y));
  }
  viewBounds(): ViewBounds {
    return { left: this.x - this.viewportWidth / (2 * this.zoom), right: this.x + this.viewportWidth / (2 * this.zoom),
      top: this.y - this.viewportHeight / (2 * this.zoom), bottom: this.y + this.viewportHeight / (2 * this.zoom) };
  }
}
