import { executeAbility, executeAttack, executeDash, executeMove } from './battle';
import { forecastAttack } from './combat';
import { chebyshev, evaluateCover, manhattan, samePos } from './grid';
import { computeDashOptions, computeMovableTiles } from './pathfinding';
import type { BattleState, BattleUnit, GridPos } from './types';

interface AttackChoice {
  targetPos: GridPos;
  score: number;
}

function evaluateBestAttackFromPos(
  state: BattleState,
  enemy: BattleUnit,
  hypotheticalPos: GridPos
): AttackChoice | null {
  const originalPos = enemy.pos;
  enemy.pos = hypotheticalPos;

  let best: AttackChoice | null = null;
  const players = state.units.filter((u) => u.team === 'player' && u.alive);

  for (const player of players) {
    const fc = forecastAttack(state, enemy, player.pos);
    if (!fc.canAttack) continue;

    let score = (fc.hitChance / 100) * fc.finalDamage * 10;
    if (fc.isLethal) score += 35;
    if (fc.matchup === 'advantage') score += 12;
    if (fc.hitChance === 100) score += 10;

    if (!best || score > best.score) {
      best = { targetPos: player.pos, score };
    }
  }

  // If no player is cleanly shootable, consider smashing a cover crate blocking a close hero
  if (!best) {
    for (const player of players) {
      const coverEval = evaluateCover(state, hypotheticalPos, player.pos);
      if (coverEval.coverPos) {
        const fc = forecastAttack(state, enemy, coverEval.coverPos);
        if (fc.canAttack) {
          const score = 8;
          if (!best || score > best.score) {
            best = { targetPos: coverEval.coverPos, score };
          }
        }
      }
    }
  }

  enemy.pos = originalPos;
  return best;
}

function evaluateTileCoverScore(state: BattleState, pos: GridPos): number {
  const players = state.units.filter((u) => u.team === 'player' && u.alive);
  let score = 0;
  for (const p of players) {
    const cov = evaluateCover(state, p.pos, pos);
    if (cov.level === 'full') score += 9;
    else if (cov.level === 'half') score += 5;
  }
  return Math.min(18, score);
}

/**
 * Executes a single enemy unit's complete turn (Dash -> Move to flank/cover -> Ability/Attack).
 * Designed to run one enemy at a time so the UI can animate each farmer cleanly!
 */
export function runEnemyUnitTurn(
  state: BattleState,
  enemyId: string,
  rng: () => number = Math.random
): boolean {
  if (state.status !== 'ongoing' || state.phase !== 'enemy') return false;
  const enemy = state.units.find((u) => u.id === enemyId && u.alive && u.team === 'enemy');
  if (!enemy) return false;

  const players = state.units.filter((u) => u.team === 'player' && u.alive);
  if (players.length === 0) return false;

  // 1. Opportunistic Dash! (Especially aggressive for Rusty Mower & Trimmer)
  const dashes = computeDashOptions(state, enemy);
  if (dashes.length > 0) {
    dashes.sort((a, b) => b.damage - a.damage);
    executeDash(state, enemy.id, dashes[0].enemyId);
    if (state.status !== 'ongoing') return true;
  }

  // 2. Pick best destination tile (staying put OR moving within moveRange)
  const movable = computeMovableTiles(state, enemy);
  const candidates: GridPos[] = [enemy.pos, ...Array.from(movable.values()).map((n) => n.pos)];

  let bestPos: GridPos = enemy.pos;
  let bestTileScore = -Infinity;
  let bestAttack: AttackChoice | null = null;

  for (const pos of candidates) {
    const attack = evaluateBestAttackFromPos(state, enemy, pos);
    const coverScore = evaluateTileCoverScore(state, pos);

    // Distance to closest player hero (prefer getting into optimal weapon range)
    const minDist = Math.min(...players.map((p) => manhattan(pos, p.pos)));
    const preferredDist = enemy.weapon.arc === 'lobbed' ? 4 : enemy.weapon.arc === 'melee' ? 1 : 3;
    const distPenalty = Math.abs(minDist - preferredDist) * 3.5;

    let totalScore = coverScore - distPenalty;
    if (attack) totalScore += attack.score;

    // Slightly favor moving closer if we can't attack yet
    if (!attack) {
      totalScore -= minDist * 4;
    }

    if (totalScore > bestTileScore) {
      bestTileScore = totalScore;
      bestPos = pos;
      bestAttack = attack;
    }
  }

  if (!samePos(bestPos, enemy.pos)) {
    executeMove(state, enemy.id, bestPos);
    if (state.status !== 'ongoing') return true;
  }

  // 3. Boss Signature Ability (Captain Scarecrow's Harvest Hex!)
  if (enemy.ability && !enemy.actions.hasUsedSkill && enemy.abilityCooldown === 0) {
    let bestHexPos: GridPos | null = null;
    let bestHits = 0;
    const r = enemy.ability.aoeRadius ?? 1;
    for (const p of players) {
      if (manhattan(enemy.pos, p.pos) > enemy.ability.range) continue;
      const hits = players.filter((other) => chebyshev(p.pos, other.pos) <= r).length;
      if (hits > bestHits) {
        bestHits = hits;
        bestHexPos = p.pos;
      }
    }
    if (bestHexPos && bestHits >= 1) {
      executeAbility(state, enemy.id, bestHexPos);
      if (state.status !== 'ongoing') return true;
    }
  }

  // 4. Primary Weapon Attack
  const finalAttack = bestAttack ?? evaluateBestAttackFromPos(state, enemy, enemy.pos);
  if (finalAttack) {
    executeAttack(state, enemy.id, finalAttack.targetPos, rng);
  }

  return true;
}
