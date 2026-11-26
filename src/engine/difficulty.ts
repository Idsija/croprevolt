import { FLOORS_PER_ACT, createRng, type Rng } from './mapgen';
import type { NodeType } from './types';

/**
 * Difficulty curve. Every floor is harder than the one before it, and every act starts
 * harder than the last one ended. All the knobs live here so balancing is one-file work.
 */
export interface BattleDifficulty {
  /** Monotonic rank across the whole run: act * (FLOORS_PER_ACT + 1) + floor. Shown on the map. */
  threat: number;
  /** Multiplier on enemy max HP (rounded up). */
  hpMult: number;
  /** Flat bonus added to enemy weapon and ability damage. */
  damageBonus: number;
  /** Extra regular enemies placed on top of the map's own spawns. */
  extraEnemies: number;
  /** Number of enemies promoted to Veterans (+50% HP, +1 damage, starts shielded). */
  veterans: number;
}

export const MAX_ENEMIES_PER_BATTLE = 6;

export const TUNING = {
  /** Enemy HP grows with threat, so the first floor of an act is harder than the last one before it. */
  hpPerThreat: 0.05,
  /** Bosses only scale with the act: their arenas are already tuned as finales. */
  bossHpPerAct: 0.2,
  /** Floors (0-based) from which enemies hit 1 harder. */
  damageBonusFloor: 5,
  damagePerAct: 1,
  /** Floors (0-based) at which an extra enemy joins: one at each listed floor. */
  extraEnemyFloors: [2, 5],
  /** Elite fights always field one Veteran, two from this floor on. */
  eliteSecondVeteranFloor: 4,
  /** Chance that each regular spawn is swapped for a different farmhand. */
  rerollChance: 0.5,
} as const;

export function threatFor(act: number, floor: number): number {
  return act * (FLOORS_PER_ACT + 1) + floor + 1;
}

export const MAX_HARVEST_HEAT = 5;

export interface HarvestHeatInfo {
  level: number;
  name: string;
  desc: string;
  seedBonusPct: number;
}

export const HARVEST_HEAT_LEVELS: HarvestHeatInfo[] = [
  { level: 0, name: 'Heat 0 · Morning Dew', desc: 'Standard storybook adventure.', seedBonusPct: 0 },
  { level: 1, name: 'Heat 1 · High Noon', desc: 'All farmhands gain +15% Max HP. The Harvest Bell rings 1 turn sooner.', seedBonusPct: 20 },
  { level: 2, name: 'Heat 2 · Barn Veterans', desc: 'Elites & battles field +1 Veteran farmhand. Market prices rise 25%.', seedBonusPct: 40 },
  { level: 3, name: 'Heat 3 · Brittle Crates', desc: 'Wooden crates start cracked (-2 HP). The rest after a battle heals 1 HP, not 3.', seedBonusPct: 60 },
  { level: 4, name: 'Heat 4 · Wrathful Wardens', desc: 'Act Bosses gain +20% HP & +1 telegraph DMG. The Harvest Bell rings 2 turns sooner.', seedBonusPct: 80 },
  { level: 5, name: 'Heat 5 · Scorching Harvest', desc: 'All enemies gain +1 Weapon Damage! Market prices rise 50%.', seedBonusPct: 100 },
];

/**
 * Run-level rule twists per Harvest Heat, on top of the tougher farmers in difficultyFor.
 * Each level keeps the twists of the levels below it.
 */
export interface HeatRunRules {
  /** Board turns taken off the Harvest Bell limit of every act. */
  bellTurnsLost: number;
  /** Multiplier on every market price (rounded up). */
  marketPriceMult: number;
  /** HP each surviving hero recovers after a won battle. */
  breatherHeal: number;
}

export function heatRunRules(harvestHeat = 0): HeatRunRules {
  const heat = Math.max(0, Math.min(MAX_HARVEST_HEAT, Math.floor(harvestHeat)));
  return {
    bellTurnsLost: heat >= 4 ? 2 : heat >= 1 ? 1 : 0,
    marketPriceMult: heat >= 5 ? 1.5 : heat >= 2 ? 1.25 : 1,
    breatherHeal: heat >= 3 ? 1 : 3,
  };
}

export function getHeatSeedMultiplier(heat = 0): number {
  const clamped = Math.max(0, Math.min(MAX_HARVEST_HEAT, Math.floor(heat)));
  return 1 + clamped * 0.2;
}

export function difficultyFor(
  act: number,
  floor: number,
  nodeType: NodeType,
  harvestHeat = 0
): BattleDifficulty {
  const heat = Math.max(0, Math.min(MAX_HARVEST_HEAT, Math.floor(harvestHeat)));
  const threat = threatFor(act, floor);
  const heatHpMult = heat >= 1 ? 1.15 : 1;
  const heatDmgBonus = heat >= 5 ? 1 : 0;

  if (nodeType === 'boss') {
    const bossHeatMult = heat >= 4 ? 1.2 : 1;
    return {
      threat,
      hpMult: (1 + TUNING.bossHpPerAct * act) * heatHpMult * bossHeatMult,
      damageBonus: TUNING.damagePerAct * act + heatDmgBonus,
      extraEnemies: 0,
      veterans: 0,
    };
  }
  // Reinforcements carry over between acts (capped by MAX_ENEMIES_PER_BATTLE at build time).
  const extraEnemies =
    act * TUNING.extraEnemyFloors.length + TUNING.extraEnemyFloors.filter((f) => floor >= f).length;
  const baseVeterans = nodeType === 'elite' ? (floor >= TUNING.eliteSecondVeteranFloor ? 2 : 1) : 0;
  const heatExtraVet = heat >= 2 ? 1 : 0;

  return {
    threat,
    hpMult: (1 + TUNING.hpPerThreat * (threat - 1)) * heatHpMult,
    damageBonus: (floor >= TUNING.damageBonusFloor ? 1 : 0) + TUNING.damagePerAct * act + heatDmgBonus,
    extraEnemies: nodeType === 'elite' ? Math.max(0, extraEnemies - 1) : extraEnemies,
    veterans: baseVeterans + heatExtraVet,
  };
}

/** Regular farmhands that can be rolled into any battle. */
export const REGULAR_ENEMY_POOL = [
  'digger',
  'trimmer',
  'sprayer',
  'mower',
  'beekeeper',
  'hound',
  'pitchfork',
] as const;

/** Stable 32-bit hash so each node of a seeded run always gets the same battle. */
export function hashString(text: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function battleRng(runSeed: number, nodeId: string): Rng {
  return createRng((runSeed ^ hashString(nodeId)) >>> 0);
}
