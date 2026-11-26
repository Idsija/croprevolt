import { evaluateCover, inBounds, manhattan, posKey, tileAt, unitAt } from './grid';
import {
  getEffectiveCoverDamage,
  getMatchup,
  getMatchupMultiplier,
  hasGraft,
  hasPerk,
  hasRelic,
  hasStatus,
} from './hooks';
import { computeMovableTiles } from './pathfinding';
import type { BattleState, BattleUnit, CombatForecast, GridPos } from './types';

export function computePushDirection(from: GridPos, to: GridPos): GridPos {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.abs(dx) >= Math.abs(dy)) {
    return { x: dx >= 0 ? 1 : -1, y: 0 };
  }
  return { x: 0, y: dy >= 0 ? 1 : -1 };
}

/**
 * Predicts exact hit chance (100 / 50 / 0), cover protection, high-ground elevation bonus,
 * triangle multiplier, knockback hazards (bump / water / lava / cliff drop), and damage.
 * Shared identically by the Hover Forecast UI and the Battle Executor!
 */
export function forecastAttack(
  state: BattleState,
  attacker: BattleUnit,
  targetPos: GridPos,
  ignoreHasAttacked = false
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

  if (attacker.actions.hasAttacked && !ignoreHasAttacked) {
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

  // Raw base attack including temporary bonuses (Bouncy Mulch, Cluck Norris jump, Spicy Pep, Sunbeam tile!)
  const attackerTile = tileAt(state, attacker.pos);
  const sunbeamBonus = attackerTile?.terrain === 'sunbeam' ? 2 : 0;
  const boostBonus = (hasStatus(attacker, 'boosted') ? 2 : 0) + attacker.tempAttackBonus + sunbeamBonus;
  const rawBase = w.damage + boostBonus;
  const effCoverDmg = getEffectiveCoverDamage(attacker) + boostBonus;

  // Targeting destructible cover / Barn Rescue cage directly (or lobbing onto empty ground): always 100% hit!
  if (!isEnemyTarget) {
    const emptyLobSplash = Math.max(1, Math.floor(w.damage / 2));
    return {
      attackerId: attacker.id,
      targetPos,
      hitChance: 100,
      coverLevel: 'none',
      matchup: 'neutral',
      baseDamage: rawBase,
      finalDamage: isDestructibleCover ? effCoverDmg : emptyLobSplash,
      coverDamage: effCoverDmg,
      isLethal: Boolean(targetTile?.cover && effCoverDmg >= targetTile.cover.hp),
      canAttack: true,
    };
  }

  const defender = targetUnit!;
  const matchup = getMatchup(attacker.family, defender.family);
  const mult = getMatchupMultiplier(matchup, attacker.team, state.relicIds);

  // Elevation Advantage (Mario + Rabbids High Ground!)
  const attackerElev = attackerTile?.elevation ?? 0;
  const defenderElev = targetTile?.elevation ?? 0;
  const elevationDiff = attackerElev - defenderElev;
  const highGroundBonus = elevationDiff > 0 ? 2 : 0;

  // Discrete Mario + Rabbids cover resolution (including Living Wool Sheep half cover + High Ground override!)
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
      hitChance = 100;
    }
  } else {
    // High Ground shoots right over Half Cover!
    if (elevationDiff > 0 && coverEval.level === 'half') {
      coverEval = { level: 'none' };
    }
    // Shooting steeply uphill (+2 levels) grants defender ledge half-cover if exposed
    if (elevationDiff <= -2 && coverEval.level === 'none') {
      coverEval = { level: 'half' };
    }

    if (coverEval.level === 'full') {
      hitChance = 0;
    } else if (coverEval.level === 'half') {
      hitChance = attacker.team === 'player' && hasRelic(state.relicIds, 'lucky_clover') ? 70 : 50;
    } else {
      hitChance = 100;
    }
  }

  // Final damage calculation (+ High Ground + Flank Breaker Critical!)
  const isCriticalFlank = hitChance >= 100 && hasPerk(attacker, 'cover_buster');
  let dmg = Math.round((rawBase + highGroundBonus) * mult);
  if (isCriticalFlank) dmg += 2;
  if (hasStatus(defender, 'acid')) dmg += 2;
  if (hasStatus(defender, 'shield')) dmg -= 2;
  dmg = Math.max(1, dmg);

  const appliesStatus =
    w.appliesStatus?.kind ??
    (hitChance === 100 && hasGraft(attacker, 'spicy_shot') ? 'burn' : undefined);

  const effectiveKnockback = (w.knockback ?? 0) + (hasPerk(attacker, 'cover_buster') ? 1 : 0);
  let knockbackDir: GridPos | undefined;
  let knockbackWillBump = false;
  let knockbackHazard: CombatForecast['knockbackHazard'];
  let extraHazardDmg = 0;

  if (effectiveKnockback > 0 && hitChance > 0) {
    knockbackDir = computePushDirection(attacker.pos, defender.pos);
    const dest = { x: defender.pos.x + knockbackDir.x, y: defender.pos.y + knockbackDir.y };
    const destTile = tileAt(state, dest);
    if (!inBounds(state, dest) || Boolean(destTile?.cover) || Boolean(unitAt(state, dest))) {
      knockbackWillBump = true;
      knockbackHazard = 'bump';
      extraHazardDmg = 2;
    } else if (destTile?.terrain === 'lava') {
      knockbackWillBump = true;
      knockbackHazard = 'lava';
      extraHazardDmg = 4;
    } else if (destTile?.terrain === 'water') {
      knockbackWillBump = true;
      knockbackHazard = 'water';
      extraHazardDmg = 3;
    } else if (destTile && (destTile.elevation ?? 0) < defenderElev) {
      knockbackHazard = 'drop';
      extraHazardDmg = 2;
    }
  }

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
    isLethal: hitChance > 0 && dmg + extraHazardDmg >= defender.hp,
    knockbackDir,
    knockbackWillBump,
    knockbackHazard,
    elevationDiff,
    highGroundBonus,
    isCriticalFlank,
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

    // Objective Barn Rescue Cage within weapon reach counts as a meaningful attack target!
    for (let y = 0; y < state.height; y++) {
      for (let x = 0; x < state.width; x++) {
        if (state.tiles[y][x].cover?.isObjectiveCage && forecastAttack(state, unit, { x, y }).canAttack) {
          return true;
        }
      }
    }
  }

  if (!unit.actions.hasUsedSkill) {
    if (unit.ability && unit.abilityCooldown === 0) {
      return true;
    }
    // Check if the player has usable Garden Satchel items remaining for this hero's utility slot
    const hasAnyItem = Object.values(state.items).some((count) => count > 0);
    if (hasAnyItem) {
      return true;
    }
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
