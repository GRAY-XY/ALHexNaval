import {neighbors} from './hex.ts';
import {Terrain,type Cell} from './types.ts';
import type {HexWorld} from './world.ts';

export const ART_DIRECTIONS=['east','southeast','southwest','west','northwest','northeast'] as const;
export type ArtDirection=typeof ART_DIRECTIONS[number];

export function oppositeDirection(direction:number):number{return (direction+3)%6;}

export function harborOutwardDirection(world:HexWorld,port:Cell):number {
  const candidates=neighbors(port).map((cell,direction)=>({cell,direction,depth:neighbors(cell).filter(next=>world.at(next)===Terrain.Land).length})).filter(value=>world.at(value.cell)===Terrain.Land);
  candidates.sort((a,b)=>b.depth-a.depth||a.direction-b.direction);
  return candidates.length?oppositeDirection(candidates[0].direction):4;
}
