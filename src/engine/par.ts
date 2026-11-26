import { manhattan } from './grid';
import type { BattleState } from './types';

/**
 * Turn par and battle grades.
 * Every battle gets a par: the number of turns a sharp squad should need for its objective.
 * Winning at or under par is a Great Harvest; doing it with no hero bagged is a Perfect Harvest.
 */
export const PAR_TUNING = {
  /** Extra seeds on the reward screen by grade. */
  bonusSeeds: { perfect: 10, great: 5, cleared: 0 },
} as const;

export type BattleGrade = 'perfect' | 'great' | 'cleared';

export interface BattleGradeResult {
  grade: BattleGrade;
  par: number;
  turns: number;
  turnsUnderPar: number;
  heroesLost: number;
}

export const GRADE_LABELS: Record<BattleGrade, string> = {
  perfect: 'Perfect Harvest',
  great: 'Great Harvest',
  cleared: 'Harvest Cleared',
};

/** Par for a freshly created battle, based on its objective, board and farmer count. */
export function computeParTurns(state: BattleState): number {
  const foes = state.units.filter((u) => u.team === 'enemy' && u.alive).length;
  const heroes = state.units.filter((u) => u.team === 'player' && u.alive && !u.isEscortCart);
  const sweep = 2 + Math.ceil(foes / 2);

  switch (state.objective) {
    case 'survive':
      return state.surviveTurns ?? 4;
    case 'escort': {
      const cart = state.units.find((u) => u.isEscortCart);
      const gate = state.gateTiles[Math.floor(state.gateTiles.length / 2)];
      if (!cart || !gate) return sweep;
      // The cart rolls up to 2 tiles per turn.
      return Math.ceil(manhattan(cart.pos, gate) / 2) + 1;
    }
    case 'reach_gate': {
      if (state.gateTiles.length === 0 || heroes.length === 0) return sweep;
      const closest = Math.min(
        ...heroes.flatMap((h) => state.gateTiles.map((g) => manhattan(h.pos, g)))
      );
      const bestMove = Math.max(1, ...heroes.map((h) => h.moveRange));
      return Math.ceil(closest / bestMove) + 1;
    }
    case 'barn_rescue':
    case 'boss':
      return sweep + 1;
    default:
      return sweep;
  }
}

/** Turns the squad actually used. A survive win is declared at the start of the turn after the last one. */
export function turnsUsed(state: BattleState): number {
  if (state.objective === 'survive') return Math.max(1, Math.min(state.turn, state.surviveTurns ?? 4));
  return Math.max(1, state.turn);
}

export function gradeBattle(state: BattleState): BattleGradeResult {
  const par = state.parTurns ?? computeParTurns(state);
  const turns = turnsUsed(state);
  const heroesLost = state.units.filter(
    (u) => u.team === 'player' && !u.isEscortCart && !u.alive
  ).length;
  const underPar = turns <= par;
  const grade: BattleGrade = underPar ? (heroesLost === 0 ? 'perfect' : 'great') : 'cleared';
  return { grade, par, turns, turnsUnderPar: Math.max(0, par - turns), heroesLost };
}
