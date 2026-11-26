import { evaluateCover, manhattan, posKey, tileAt, unitAt } from './grid';
import {
  getEffectiveCoverDamage,
  getMatchup,
  getMatchupMultiplier,
  hasGraft,
  hasRelic,
  hasStatus,
} from './hooks';
import { computeMovableTiles } from './pathfinding';
import type { BattleState, BattleUnit, CombatForecast, GridPos } from './types';

/**
 * Predicts exact hit chance (100 / 50 / 0), cover protection, triangle multiplier, and damage.
 * Shared identically by the Hover Forecast UI and the Battle Executor!
 */
export function forecastAttack(
  state: BattleState,
  attacker: BattleUnit,
  targetPos: GridPos
): CombatForecast {
  const dist = manhattan(attacker.pos, targetPos);
  const w = attacker.weapon;
  const targetUnit = unitAt(state, targetPos);
  const targetTile = tileAt(state, targetPos);

  const invalid = (reason: string): CombatForecast => ({
    attackerId: attacker.id,
    targetUnitId: targetUnit?.id,
    targetPos,
    hitChance: 0,
    coverLevel: 'none',
    matchup: 'neutral',
    baseDamage: w.damage,
    finalDamage: 0,
    coverDamage: w.coverDamage,
    isLethal: false,
    canAttack: false,
    reason,
  });

  if (attacker.actions.hasAttacked) {
    return invalid('Already attacked this turn');
  }
  if (dist < w.minRange || dist > w.maxRange) {
    return invalid(`Out of range (${w.minRange}-${w.maxRange})`);
  }

  // Can target an enemy unit, a destructible cover tile (crate/haystack/cage), or any tile with lobbed AoE
  const isEnemyTarget = Boolean(targetUnit && targetUnit.team !== attacker.team);
  const isDestructibleCover = Boolean(targetTile?.cover && targetTile.cover.destructible);
  const isLobbedGround = w.arc === 'lobbed' && !targetUnit;

  if (!isEnemyTarget && !isDestructibleCover && !isLobbedGround) {
    return invalid('No valid target');
  }

  // Raw base attack including temporary bonuses (Bouncy Mulch, Cluck Norris jump, Spicy Pep boost)
  const boostBonus = (hasStatus(attacker, 'boosted') ? 2 : 0) + attacker.tempAttackBonus;
  const rawBase = w.damage + boostBonus;
  const effCoverDmg = getEffectiveCoverDamage(attacker) + boostBonus;

  // Targeting destructible cover / Barn Rescue cage directly: always 100% hit!
  if (!isEnemyTarget) {
    return {
      attackerId: attacker.id,
      targetPos,
      hitChance: 100,
      coverLevel: 'none',
      matchup: 'neutral',
      baseDamage: rawBase,
      finalDamage: isDestructibleCover ? effCoverDmg : rawBase,
      coverDamage: effCoverDmg,
      isLethal: Boolean(targetTile?.cover && effCoverDmg >= targetTile.cover.hp),
      canAttack: true,
    };
  }

  const defender = targetUnit!;
  const matchup = getMatchup(attacker.family, defender.family);
  const mult = getMatchupMultiplier(matchup, attacker.team, state.relicIds);

  // Discrete Mario + Rabbids cover resolution (including Living Wool Sheep half cover!)
  let coverEval = evaluateCover(state, attacker.pos, defender.pos, defender.team);
  let hitChance = 100;

  if (w.arc === 'lobbed') {
    // Lobbed mortars arc right OVER Half & Full cover!
    coverEval = { level: 'none' };
    hitChance = 100;
  } else if (w.arc === 'melee') {
    if (coverEval.level === 'full') {
      hitChance = 0;
    } else {
      // Melee smashes through half cover
      hitChance = 100;
    }
  } else {
    // Direct / Pierce shots
    if (coverEval.level === 'full') {
      hitChance = 0;
    } else if (coverEval.level === 'half') {
      hitChance = attacker.team === 'player' && hasRelic(state.relicIds, 'lucky_clover') ? 70 : 50;
    } else {
      hitChance = 100;
    }
  }

  // Final damage calculation
  let dmg = Math.round(rawBase * mult);
  if (hasStatus(defender, 'acid')) dmg += 2;
  if (hasStatus(defender, 'shield')) dmg -= 2;
  dmg = Math.max(1, dmg);

  const appliesStatus =
    w.appliesStatus?.kind ??
    (hitChance === 100 && hasGraft(attacker, 'spicy_shot') ? 'burn' : undefined);

  return {
    attackerId: attacker.id,
    targetUnitId: defender.id,
    targetPos,
    hitChance,
    coverLevel: coverEval.level,
    coverPos: coverEval.coverPos,
    matchup,
    baseDamage: rawBase,
    finalDamage: hitChance === 0 ? 0 : dmg,
    coverDamage: effCoverDmg,
    isLethal: hitChance > 0 && dmg >= defender.hp,
    appliesStatus,
    canAttack: hitChance > 0,
    reason: hitChance === 0 ? 'Blocked by Full Cover! Flank, lob, or smash cover.' : undefined,
  };
}

/**
 * Returns all tiles the attacker can click in Attack Mode (enemies + destructible cover + lobbed tiles).
 */
export function getAttackableTiles(state: BattleState, attacker: BattleUnit): GridPos[] {
  if (attacker.actions.hasAttacked) return [];
  const out: GridPos[] = [];
  const w = attacker.weapon;
  for (let y = 0; y < state.height; y++) {
    for (let x = 0; x < state.width; x++) {
      const p = { x, y };
      const d = manhattan(attacker.pos, p);
      if (d < w.minRange || d > w.maxRange) continue;
      const u = unitAt(state, p);
      const t = tileAt(state, p);
      if ((u && u.team !== attacker.team) || (t?.cover && t.cover.destructible) || w.arc === 'lobbed') {
        out.push(p);
      }
    }
  }
  return out;
}

/**
 * Returns EVERY tile inside a unit's weapon reach from `fromPos` (defaulting to current pos).
 * Used to visualize full attack range for BOTH selected allies (even from previewed Move tiles!)
 * and selected enemies.
 */
export function getWeaponRangeTiles(
  state: Pick<BattleState, 'width' | 'height'>,
  unit: BattleUnit,
  fromPos: GridPos = unit.pos
): GridPos[] {
  const out: GridPos[] = [];
  const { minRange, maxRange } = unit.weapon;
  for (let y = 0; y < state.height; y++) {
    for (let x = 0; x < state.width; x++) {
      const p = { x, y };
      const d = manhattan(fromPos, p);
      if (d >= minRange && d <= maxRange) {
        out.push(p);
      }
    }
  }
  return out;
}

/**
 * Computes an enemy's full Danger Zone (Fire Emblem style):
 * - moveKeys: tiles the enemy can walk to on its turn
 * - attackKeys: every tile the enemy could attack from its current position OR any walkable tile!
 */
export function getEnemyThreatZone(
  state: BattleState,
  enemy: BattleUnit
): { moveKeys: Set<string>; attackKeys: Set<string> } {
  // Temporarily allow full move preview regardless of current phase flags
  const shadowEnemy: BattleUnit = {
    ...enemy,
    actions: {
      hasMoved: false,
      hasDashed: false,
      hasJumped: false,
      hasAttacked: false,
      hasUsedSkill: false,
    },
  };
  const movable = computeMovableTiles(state, shadowEnemy);
  const moveKeys = new Set<string>(movable.keys());
  const attackKeys = new Set<string>();

  const origins: GridPos[] = [enemy.pos, ...Array.from(movable.values()).map((n) => n.pos)];
  for (const origin of origins) {
    for (const t of getWeaponRangeTiles(state, shadowEnemy, origin)) {
      attackKeys.add(posKey(t));
    }
  }

  return { moveKeys, attackKeys };
}

/**
 * Computes the combined Danger Zone across ALL alive enemies (Fire Emblem style global danger toggle).
 */
export function getAllEnemiesThreatZone(state: BattleState): {
  moveKeys: Set<string>;
  attackKeys: Set<string>;
} {
  const moveKeys = new Set<string>();
  const attackKeys = new Set<string>();
  for (const enemy of state.units) {
    if (!enemy.alive || enemy.team !== 'enemy') continue;
    const z = getEnemyThreatZone(state, enemy);
    for (const k of z.moveKeys) moveKeys.add(k);
    for (const k of z.attackKeys) attackKeys.add(k);
  }
  return { moveKeys, attackKeys };
}

/**
 * Returns true if a single player hero still has any meaningful turn action left:
 * - Can still Move (not rooted)
 * - Can still Attack an enemy currently in weapon range (with >0% hit chance)
 * - Can still use their signature Ability (off cooldown)
 */
export function unitHasMeaningfulAction(state: BattleState, unit: BattleUnit): boolean {
  if (!unit.alive || unit.team !== 'player') return false;

  if (!unit.actions.hasMoved && !hasStatus(unit, 'rooted')) {
    return true;
  }

  if (!unit.actions.hasAttacked) {
    const hasShootableEnemy = state.units.some(
      (e) => e.alive && e.team === 'enemy' && forecastAttack(state, unit, e.pos).canAttack
    );
    if (hasShootableEnemy) return true;
  }

  if (!unit.actions.hasUsedSkill && unit.ability && unit.abilityCooldown === 0) {
    return true;
  }

  return false;
}

/**
 * Returns true if ANY alive player unit still has a meaningful action left this turn.
 * Used to drive smooth Auto Turn-End when no skills or characters remain!
 */
export function hasAnyPlayerActionRemaining(state: BattleState): boolean {
  if (state.status !== 'ongoing' || state.phase !== 'player') return false;
  return state.units.some((u) => unitHasMeaningfulAction(state, u));
}
