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

export function difficultyFor(act: number, floor: number, nodeType: NodeType): BattleDifficulty {
  const threat = threatFor(act, floor);
  if (nodeType === 'boss') {
    return {
      threat,
      hpMult: 1 + TUNING.bossHpPerAct * act,
      damageBonus: TUNING.damagePerAct * act,
      extraEnemies: 0,
      veterans: 0,
    };
  }
  // Reinforcements carry over between acts (capped by MAX_ENEMIES_PER_BATTLE at build time).
  const extraEnemies =
    act * TUNING.extraEnemyFloors.length + TUNING.extraEnemyFloors.filter((f) => floor >= f).length;
  return {
    threat,
    hpMult: 1 + TUNING.hpPerThreat * (threat - 1),
    damageBonus: (floor >= TUNING.damageBonusFloor ? 1 : 0) + TUNING.damagePerAct * act,
    extraEnemies: nodeType === 'elite' ? Math.max(0, extraEnemies - 1) : extraEnemies,
    veterans: nodeType === 'elite' ? (floor >= TUNING.eliteSecondVeteranFloor ? 2 : 1) : 0,
  };
}

/** Regular farmhands that can be rolled into any battle. */
export const REGULAR_ENEMY_POOL = ['digger', 'trimmer', 'sprayer', 'mower'] as const;

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
