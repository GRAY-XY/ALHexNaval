export interface Cell { col: number; row: number }
export interface Point { x: number; y: number }
export interface WorldBounds { width: number; height: number }
export interface ViewBounds { left: number; top: number; right: number; bottom: number }
export interface ShipAsset {
  id: string;
  ship_group: number;
  name: string;
  faction: { id: number; name: string };
  ship_type: { code: string; name: string; source_code: number };
  assets: { skeleton: string; atlas: string; preview: string; pages: string[] };
  animation_map: Record<string, string | null>;
}
export interface Roster { units: ShipAsset[] }
export interface DeployedShip extends Cell {
  instanceId: string;
  asset: ShipAsset;
  facing: 'left' | 'right';
  ownerId?: number;
}
export const Terrain = { Deep: 0, Sea: 1, Shallow: 2, Land: 3 } as const;
export type Terrain = typeof Terrain[keyof typeof Terrain];
