import type { ShipAsset } from './types.ts';

export type ShipBaseAnimation = 'idle' | 'move' | 'defeated';
export type ShipActionAnimation = 'attack' | 'main_gun' | 'skill' | 'hurt' | 'victory';
export interface AnimationPort {
  has(name: string): boolean;
  play(name: string, loop: boolean): void;
  current(): { name: string; elapsed: number; duration: number } | undefined;
}
const FALLBACKS: Record<ShipBaseAnimation | ShipActionAnimation,string[]> = {
  idle:['idle'], move:['move','idle'], defeated:['defeated','idle'],
  attack:['attack'], main_gun:['main_gun','attack'], skill:['skill','attack'], hurt:['hurt'],victory:['victory'],
};

// Presentation owns its one-shot queue. Changing movement or turn state never cuts an attack short.
export class ShipAnimation {
  private port?: AnimationPort;
  private base: ShipBaseAnimation = 'idle';
  private action?: ShipActionAnimation;
  private queue: ShipActionAnimation[] = [];
  private asset: Pick<ShipAsset,'animation_map'>;
  constructor(asset: Pick<ShipAsset,'animation_map'>) {this.asset=asset;}
  reset():void {this.base='idle';this.action=undefined;this.queue=[];const name=this.name('idle');if(name)this.port!.play(name,true);}
  bind(port: AnimationPort): void { this.port=port;this.sync(this.base); }
  private name(action: ShipBaseAnimation | ShipActionAnimation): string | undefined {
    return FALLBACKS[action].map(key=>this.asset.animation_map[key]).find((name):name is string=>!!name && !!this.port?.has(name));
  }
  request(action: ShipActionAnimation): void {
    if(this.base==='defeated')return;
    // A damage flash can overlap firing; a native hurt clip must not cancel the shot.
    if(action==='hurt' && this.action)return;
    this.queue.push(action);this.sync(this.base);
  }
  sync(base: ShipBaseAnimation): void {
    if(this.base==='defeated')base='defeated';
    this.base=base;if(!this.port)return;
    if(base==='defeated') {
      this.action=undefined;this.queue=[];
      const name=this.name(base);if(name && this.port.current()?.name!==name)this.port.play(name,false);
      return;
    }
    const current=this.port.current();
    if(this.action && current && current.elapsed+1e-8<current.duration)return;
    this.action=undefined;
    while(this.queue.length) {
      const action=this.queue.shift()!,name=this.name(action);
      if(name) { this.action=action;this.port.play(name,false);return; }
    }
    const name=this.name(base);if(name && this.port.current()?.name!==name)this.port.play(name,true);
  }
  get active(): boolean {
    const current=this.port?.current();
    return !!this.action || this.base==='defeated' && !!current && current.elapsed<current.duration;
  }
  get defeated(): boolean { return this.base==='defeated'; }
  get duration(): number { return this.port?.current()?.duration ?? 0; }
}
