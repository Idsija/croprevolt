import {
  getNeighbors,
  getTerrainMoveCost,
  isTileWalkable,
  manhattan,
  posKey,
  samePos,
  tileAt,
  unitAt,
} from './grid';
import {
  getEffectiveDashDamage,
  getEffectiveJumpRange,
  getEffectiveMoveRange,
  hasGraft,
  hasStatus,
} from './hooks';
import type { BattleState, BattleUnit, DashOption, GridPos, JumpOption } from './types';

export interface ReachableNode {
  pos: GridPos;
  cost: number;
  path: GridPos[];
}

/**
 * Computes all tiles a unit can traverse/stop on using Dijkstra over terrain move costs.
 * Allies can be passed through, enemies and cover block traversal.
 */
export function computeReachableMap(state: BattleState, unit: BattleUnit): Map<string, ReachableNode> {
  const result = new Map<string, ReachableNode>();
  const maxMove = getEffectiveMoveRange(unit);
  const startKey = posKey(unit.pos);
  result.set(startKey, { pos: unit.pos, cost: 0, path: [unit.pos] });

  if (maxMove <= 0) return result;

  const queue: ReachableNode[] = [{ pos: unit.pos, cost: 0, path: [unit.pos] }];

  while (queue.length > 0) {
    let bestIdx = 0;
    for (let i = 1; i < queue.length; i++) {
      if (queue[i].cost < queue[bestIdx].cost) bestIdx = i;
    }
    const current = queue[bestIdx];
    queue[bestIdx] = queue[queue.length - 1];
    queue.pop();
    const currentBest = result.get(posKey(current.pos));
    if (currentBest && current.cost > currentBest.cost) continue;

    for (const nextPos of getNeighbors(state, current.pos)) {
      if (!isTileWalkable(state, nextPos, unit.team, false)) continue;
      const t = tileAt(state, nextPos)!;
      const stepCost = unit.ignoresMud ? 1 : getTerrainMoveCost(t.terrain);
      const nextCost = current.cost + stepCost;
      if (nextCost > maxMove) continue;

      const key = posKey(nextPos);
      const existing = result.get(key);
      if (!existing || nextCost < existing.cost) {
        const node: ReachableNode = {
          pos: nextPos,
          cost: nextCost,
          path: [...current.path, nextPos],
        };
        result.set(key, node);
        queue.push(node);
      }
    }
  }

  return result;
}

/**
 * Valid empty destination tiles the unit can end a normal Move on.
 */
export function computeMovableTiles(state: BattleState, unit: BattleUnit): Map<string, ReachableNode> {
  const out = new Map<string, ReachableNode>();
  if (unit.actions.hasMoved || hasStatus(unit, 'rooted')) return out;
  const all = computeReachableMap(state, unit);
  for (const [k, node] of all.entries()) {
    if (samePos(node.pos, unit.pos)) continue;
    if (isTileWalkable(state, node.pos, unit.team, true)) {
      out.set(k, node);
    }
  }
  return out;
}

/**
 * Enemies the unit can Dash-bonk during its Move phase (before finishing movement).
 * Player or enemy can Dash an adjacent/reachable opponent once per turn!
 */
export function computeDashOptions(state: BattleState, unit: BattleUnit): DashOption[] {
  if (unit.actions.hasDashed || unit.actions.hasMoved || hasStatus(unit, 'rooted')) return [];

  const reachable = computeReachableMap(state, unit);
  const options: DashOption[] = [];
  const dashBonus = hasStatus(unit, 'boosted') ? 2 : 0;
  const dashStatus = hasGraft(unit, 'dash_burn')
    ? 'burn'
    : unit.dashStatus?.kind;

  for (const target of state.units) {
    if (!target.alive || target.team === unit.team) continue;

    // Find best valid stop tile adjacent to the target that the unit can stand on
    let bestNode: ReachableNode | null = null;
    for (const adj of getNeighbors(state, target.pos)) {
      const node = reachable.get(posKey(adj));
      if (!node) continue;
      // Either stay at current pos or land on an empty walkable tile
      if (!samePos(adj, unit.pos) && !isTileWalkable(state, adj, unit.team, true)) continue;
      if (!bestNode || node.cost < bestNode.cost) {
        bestNode = node;
      }
    }

    if (bestNode) {
      options.push({
        enemyId: target.id,
        enemyPos: target.pos,
        stopPos: bestNode.pos,
        damage: getEffectiveDashDamage(unit) + dashBonus,
        knockback: unit.dashKnockback,
        appliesStatus: dashStatus,
      });
    }
  }

  return options;
}

/**
 * Mario + Rabbids Team-Jump destinations:
 * Reach an ally, springboard off them in an arc up to `unit.jumpRange` tiles over cover & hazards!
 */
export function computeTeamJumpOptions(state: BattleState, unit: BattleUnit): Map<string, JumpOption> {
  const out = new Map<string, JumpOption>();
  if (
    unit.team !== 'player' ||
    unit.actions.hasMoved ||
    unit.actions.hasJumped ||
    hasStatus(unit, 'rooted')
  ) {
    return out;
  }

  const reachable = computeReachableMap(state, unit);

  // Find every alive ally that this unit can reach adjacent to (or walk through)
  const springboardAllies: Array<{ ally: BattleUnit; approach: GridPos }> = [];
  for (const ally of state.units) {
    if (!ally.alive || ally.team !== unit.team || ally.id === unit.id) continue;

    let bestApproach: ReachableNode | null = null;
    for (const adj of getNeighbors(state, ally.pos)) {
      const node = reachable.get(posKey(adj));
      if (!node) continue;
      if (!bestApproach || node.cost < bestApproach.cost) {
        bestApproach = node;
      }
    }
    if (bestApproach) {
      springboardAllies.push({ ally, approach: bestApproach.pos });
    }
  }

  for (const { ally, approach } of springboardAllies) {
    const jumpRange = getEffectiveJumpRange(unit, ally);
    for (let y = 0; y < state.height; y++) {
      for (let x = 0; x < state.width; x++) {
        const dest = { x, y };
        const dist = manhattan(ally.pos, dest);
        if (dist < 1 || dist > jumpRange) continue;
        if (samePos(dest, unit.pos)) continue;
        if (!isTileWalkable(state, dest, unit.team, true)) continue;
        if (unitAt(state, dest)) continue;

        const key = posKey(dest);
        // Keep normal blue tiles clean; Team-Jump highlights extend beyond normal walking reach
        // (or vault past obstacles into new tiles)
        if (reachable.has(key)) continue;

        if (!out.has(key)) {
          out.set(key, {
            dest,
            allyId: ally.id,
            allyPos: ally.pos,
            approachPos: approach,
          });
        }
      }
    }
  }

  return out;
}
