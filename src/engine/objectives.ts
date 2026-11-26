import { MAP_TEMPLATES } from '../data/maps';
import { battleRng } from './difficulty';
import type { ObjectiveType, SeasonNode } from './types';

/**
 * Objectives that roll per battle.
 * Skirmish and elite stops on "defeat all" maps roll one of these, seeded by the run and node,
 * so the same run seed (a daily run) always rolls the same objectives.
 * Hand-made objective maps (gate, rescue, survive, escort, boss) keep their own objective.
 */
export type RolledObjective = Extract<ObjectiveType, 'defeat_all' | 'rout' | 'reach_gate' | 'survive'>;

const SKIRMISH_WEIGHTS: Array<[RolledObjective, number]> = [
  ['defeat_all', 40],
  ['rout', 25],
  ['reach_gate', 20],
  ['survive', 15],
];
/** Elites are about the fight itself, so no gate runs or holds. */
const ELITE_WEIGHTS: Array<[RolledObjective, number]> = [
  ['defeat_all', 60],
  ['rout', 40],
];

export const ROLLED_SURVIVE_TURNS = 4;

/** Share of the farmers that must be bonked on a Rout. */
export function routTargetFor(enemyCount: number): number {
  return Math.max(2, Math.min(enemyCount, Math.ceil(enemyCount * 0.6)));
}

export function rollObjectiveForNode(runSeed: number, node: Pick<SeasonNode, 'id' | 'type' | 'mapId'>): RolledObjective | null {
  if (node.type !== 'skirmish' && node.type !== 'elite') return null;
  const map = node.mapId ? MAP_TEMPLATES[node.mapId] : undefined;
  if (!map || map.objective !== 'defeat_all') return null;
  const weights = node.type === 'elite' ? ELITE_WEIGHTS : SKIRMISH_WEIGHTS;
  const total = weights.reduce((s, [, w]) => s + w, 0);
  let roll = battleRng(runSeed, `${node.id}:objective`)() * total;
  for (const [objective, w] of weights) {
    roll -= w;
    if (roll < 0) return objective;
  }
  return 'defeat_all';
}

/** Short line for the trail map's stop card. */
export function objectiveBlurb(objective: ObjectiveType): string {
  switch (objective) {
    case 'rout':
      return 'Rout: bonk most of the farmers and the rest flee';
    case 'reach_gate':
      return 'Breakout: get one hero through the far fence';
    case 'survive':
      return `Hold: survive ${ROLLED_SURVIVE_TURNS} turns`;
    default:
      return 'Defeat all farmers';
  }
}
