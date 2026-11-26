import {
  canStepElevation,
  getNeighbors,
  getStepMoveCost,
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
  getMaxDashesForUnit,
  getUnitPerkEffects,
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
 * Returns the paired exit tile for a Gopher Burrow Warp Pipe, if any.
 */
export function getLinkedBurrowDest(state: BattleState, pos: GridPos): GridPos | null {
  if (!state.burrowPairs) return null;
  for (const [a, b] of state.burrowPairs) {
    if (samePos(a, pos)) return b;
    if (samePos(b, pos)) return a;
  }
  return null;
}

/**
 * Computes all tiles a unit can traverse/stop on using Dijkstra over terrain + elevation move costs,
 * including Gopher Burrow Warp Pipes (1 Move cost to warp across elevation/rivers!).
 * Allies can be passed through; enemies, cover, water/lava, and sheer 2-level cliffs block walking.
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

    const currentTile = tileAt(state, current.pos);
    if (!currentTile) continue;

    // 1. Standard orthogonal steps
    for (const nextPos of getNeighbors(state, current.pos)) {
      if (!isTileWalkable(state, nextPos, unit.team, false)) continue;
      const t = tileAt(state, nextPos)!;
      if (!canStepElevation(currentTile, t)) continue;
      const stepCost = getStepMoveCost(currentTile, t, Boolean(unit.ignoresMud));
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

    // 2. Gopher Burrow Warp Pipe! (Mario + Rabbids pipe teleport across map/cliffs for 1 Move)
    if (currentTile.terrain === 'burrow') {
      const warpDest = getLinkedBurrowDest(state, current.pos);
      if (warpDest && isTileWalkable(state, warpDest, unit.team, false)) {
        const nextCost = current.cost + 1;
        if (nextCost <= maxMove) {
          const key = posKey(warpDest);
          const existing = result.get(key);
          if (!existing || nextCost < existing.cost) {
            const node: ReachableNode = {
              pos: warpDest,
              cost: nextCost,
              path: [...current.path, warpDest],
            };
            result.set(key, node);
            queue.push(node);
          }
        }
      }
    }

    // 3. Bouncy Mushroom Launchpad! Spring up to 3 tiles over water/lava/cover & up to +2 elevation for 1 Move!
    if (currentTile.terrain === 'bounce_pad') {
      const nextCost = current.cost + 1;
      if (nextCost <= maxMove) {
        const curElev = currentTile.elevation ?? 0;
        for (let dy = -3; dy <= 3; dy++) {
          for (let dx = -3; dx <= 3; dx++) {
            const dist = Math.abs(dx) + Math.abs(dy);
            if (dist < 2 || dist > 3) continue;
            const dest = { x: current.pos.x + dx, y: current.pos.y + dy };
            const destTile = tileAt(state, dest);
            if (!destTile) continue;
            if (!isTileWalkable(state, dest, unit.team, false)) continue;
            if ((destTile.elevation ?? 0) - curElev > 2) continue;

            const key = posKey(dest);
            const existing = result.get(key);
            if (!existing || nextCost < existing.cost) {
              const node: ReachableNode = {
                pos: dest,
                cost: nextCost,
                path: [...current.path, dest],
              };
              result.set(key, node);
              queue.push(node);
            }
          }
        }
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
  if (unit.isEscortCart || unit.actions.hasMoved || hasStatus(unit, 'rooted')) return out;
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
 * Supports Multi-Dash (double_dash perk) to bonk up to 2 different enemies in one turn!
 */
export function computeDashOptions(state: BattleState, unit: BattleUnit): DashOption[] {
  const dashesUsed = unit.actions.dashesUsed ?? (unit.actions.hasDashed ? 1 : 0);
  const maxDashes = getMaxDashesForUnit(unit);
  if (unit.isEscortCart || dashesUsed >= maxDashes || unit.actions.hasMoved || hasStatus(unit, 'rooted')) return [];

  const fx = getUnitPerkEffects(unit);
  const alreadyDashed = new Set(unit.actions.dashedEnemyIds ?? []);
  const reachable = computeReachableMap(state, unit);
  const options: DashOption[] = [];
  const dashBonus = hasStatus(unit, 'boosted') ? 2 : 0;
  const dashStatus = hasGraft(unit, 'dash_burn')
    ? 'burn'
    : (unit.dashStatus?.kind ?? fx.dashStatus);
  const dashKb = (unit.dashKnockback ?? 0) + (fx.dashKnockback ? 1 : 0);

  for (const target of state.units) {
    if (!target.alive || target.team === unit.team) continue;
    if (alreadyDashed.has(target.id)) continue;

    const targetTile = tileAt(state, target.pos);
    // Find best valid stop tile adjacent to the target (within 1 elevation step)
    let bestNode: ReachableNode | null = null;
    for (const adj of getNeighbors(state, target.pos)) {
      const node = reachable.get(posKey(adj));
      if (!node) continue;
      const adjTile = tileAt(state, adj);
      if (targetTile && adjTile && !canStepElevation(adjTile, targetTile)) continue;
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
        knockback: dashKb > 0 ? dashKb : undefined,
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
    unit.isEscortCart ||
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
