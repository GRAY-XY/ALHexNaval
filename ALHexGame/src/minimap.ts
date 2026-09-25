import { cellCenter } from './hex.ts';
import type { Camera } from './camera.ts';
import { FACTION_COLORS } from './ships.ts';
import { TEAM_COLORS } from './match.ts';
import type { Point } from './types.ts';
import type { MatchUnit } from './match.ts';
import type { HexWorld } from './world.ts';
import type {PortView} from './ports.ts';

export class Minimap {
  private context: CanvasRenderingContext2D;
  private scale = 1;
  private offset: Point = { x: 0, y: 0 };
  constructor(readonly canvas: HTMLCanvasElement, readonly world: HexWorld,
    readonly overview: HTMLCanvasElement, readonly units: MatchUnit[], readonly camera: Camera,
    readonly onNavigate: (point: Point) => void) {
    canvas.width = 480; canvas.height = 364; this.context = canvas.getContext('2d')!;
    this.scale = Math.min(456 / world.bounds.width, 340 / world.bounds.height);
    this.offset = { x: (480 - world.bounds.width * this.scale) / 2, y: (364 - world.bounds.height * this.scale) / 2 };
  }
  navigate(event: PointerEvent): void {
    const rect = this.canvas.getBoundingClientRect(), x = (event.clientX - rect.left) / rect.width * 480,
      y = (event.clientY - rect.top) / rect.height * 364;
    this.onNavigate({ x: Math.max(0, Math.min(this.world.bounds.width, (x - this.offset.x) / this.scale)),
      y: Math.max(0, Math.min(this.world.bounds.height, (y - this.offset.y) / this.scale)) });
  }
  draw(fog:HTMLCanvasElement,visible:(unit:MatchUnit)=>boolean,ports:PortView[]=[],selectedPort?:string): void {
    const c = this.context, b = this.world.bounds, s = this.scale, o = this.offset;
    c.clearRect(0, 0, 480, 364); c.fillStyle = '#102a3b'; c.fillRect(0, 0, 480, 364);
    c.drawImage(this.overview, o.x, o.y, b.width * s, b.height * s);
    c.drawImage(fog,o.x,o.y,b.width*s,b.height*s);
    c.strokeStyle = '#446373'; c.lineWidth = 1; c.strokeRect(o.x, o.y, b.width * s, b.height * s);
    for (const unit of this.units) {
      if (unit.status === 'sunk'||!visible(unit)) continue;
      const p = cellCenter(unit); c.fillStyle = '#' + (unit.ownerId ? TEAM_COLORS[unit.ownerId - 1] : FACTION_COLORS[unit.asset.faction.id] ?? 0x9ae4c6).toString(16).padStart(6, '0');
      c.beginPath(); c.arc(o.x + p.x * s, o.y + p.y * s, 2.6, 0, Math.PI * 2); c.fill();
    }
    for(const {port,ownerId} of ports){
      const p=cellCenter(port),x=o.x+p.x*s,y=o.y+p.y*s;
      c.fillStyle=ownerId?'#'+TEAM_COLORS[ownerId-1].toString(16).padStart(6,'0'):'#e9d29d';c.fillRect(x-3,y-3,6,6);
      c.strokeStyle='#0b2335';c.lineWidth=1;c.strokeRect(x-3,y-3,6,6);
      if(port.id===selectedPort){c.strokeStyle='#f3f8f4';c.strokeRect(x-5,y-5,10,10);}
    }
    const v = this.camera.viewBounds(), left = Math.max(0, v.left), top = Math.max(0, v.top), right = Math.min(b.width, v.right), bottom = Math.min(b.height, v.bottom);
    c.fillStyle = '#b6f2dd22'; c.fillRect(o.x + left * s, o.y + top * s, (right - left) * s, (bottom - top) * s);
    c.strokeStyle = '#c0f8df'; c.lineWidth = 2; c.strokeRect(o.x + left * s, o.y + top * s, (right - left) * s, (bottom - top) * s);
  }
}
