import type { WeaponKind, WeaponDefinition } from './match.ts';

export interface ShipRuleProfile {
  maxHp: number;
  armor: number;
  speed: number;
  vision: number;
  aa: number;
  torpedoes: number;
}

export const SHIP_RULES_V2: Record<string, ShipRuleProfile> = {
  DD: { maxHp: 6, armor: 0, speed: 5, vision: 4, aa: 1, torpedoes: 2 },
  CL: { maxHp: 8, armor: 1, speed: 4, vision: 3, aa: 2, torpedoes: 1 },
  CA: { maxHp: 11, armor: 2, speed: 4, vision: 3, aa: 2, torpedoes: 1 },
  BB: { maxHp: 16, armor: 3, speed: 3, vision: 2, aa: 3, torpedoes: 0 },
  CV: { maxHp: 10, armor: 1, speed: 3, vision: 2, aa: 2, torpedoes: 0 },
  CVL: { maxHp: 9, armor: 1, speed: 4, vision: 2, aa: 1, torpedoes: 0 },
};

export const WEAPONS_V2: Record<string, WeaponDefinition[]> = {
  DD: [
    { id: 'light-gun', name: '驱逐舰主炮', kind: 'gun', minRange: 1, maxRange: 3, cooldown: 0, damage: { light: 2, medium: 2, heavy: 2 }, power: 2, penetration: 0 },
    { id: 'torpedo', name: '鱼雷齐射', kind: 'torpedo', minRange: 2, maxRange: 4, cooldown: 0, damage: { light: 5, medium: 5, heavy: 5 }, power: 5, penetration: 3 },
  ],
  CL: [
    { id: 'medium-gun', name: '轻巡主炮', kind: 'gun', minRange: 1, maxRange: 4, cooldown: 0, damage: { light: 3, medium: 3, heavy: 3 }, power: 3, penetration: 1 },
    { id: 'torpedo', name: '鱼雷齐射', kind: 'torpedo', minRange: 2, maxRange: 4, cooldown: 0, damage: { light: 4, medium: 4, heavy: 4 }, power: 4, penetration: 3 },
  ],
  CA: [
    { id: 'heavy-gun', name: '重巡主炮', kind: 'gun', minRange: 1, maxRange: 5, cooldown: 0, damage: { light: 4, medium: 4, heavy: 4 }, power: 4, penetration: 2 },
    { id: 'torpedo', name: '鱼雷齐射', kind: 'torpedo', minRange: 2, maxRange: 4, cooldown: 0, damage: { light: 4, medium: 4, heavy: 4 }, power: 4, penetration: 3 },
  ],
  BB: [
    { id: 'main-gun', name: '战列舰主炮', kind: 'gun', minRange: 2, maxRange: 7, cooldown: 0, damage: { light: 6, medium: 6, heavy: 6 }, power: 6, penetration: 3 },
  ],
  CV: [], CVL: [],
};

export function shipRulesV2(code: string): ShipRuleProfile {
  return SHIP_RULES_V2[code] ?? SHIP_RULES_V2.CA;
}

export function damageOnHitV2(weapon: WeaponDefinition, targetArmor: number, critical: boolean): number {
  const armorAfterPenetration = Math.max(0, targetArmor - (weapon.penetration ?? 0));
  return Math.max(1, (weapon.power ?? 1) - armorAfterPenetration) + Number(critical);
}

export function hitChanceV2(modifier: number, target: number): number {
  let hits = 0;
  for (let first = 1; first <= 6; first++) for (let second = 1; second <= 6; second++) {
    const sum = first + second;
    if (sum === 12 || sum !== 2 && sum + modifier >= target) hits++;
  }
  return Math.round(hits * 100 / 36);
}

export function rollDieV2(state: number): { state: number; die: number } {
  const next = (Math.imul(state, 1664525) + 1013904223) >>> 0;
  return { state: next, die: (next >>> 16) % 6 + 1 };
}
