import { GRAFT_REGISTRY } from '../data/grafts';
import type {
  BattleState,
  BattleUnit,
  GraftDef,
  GraftEffectKind,
  MatchupResult,
  RelicEffectKind,
  StatusKind,
  UnitFamily,
} from './types';
import { RELIC_REGISTRY } from '../data/relics';

/**
 * Produce vs. Tool Triangle:
 * - Roots  > Sprayers  |  Diggers  > Roots
 * - Vines  > Diggers   |  Blades   > Vines
 * - Fruits > Blades    |  Sprayers > Fruits
 */
const ADVANTAGE_MAP: Partial<Record<UnitFamily, UnitFamily>> = {
  root: 'sprayer',
  vine: 'digger',
  fruit: 'blade',
  digger: 'root',
  blade: 'vine',
  sprayer: 'fruit',
};

export function getMatchup(attacker: UnitFamily, defender: UnitFamily): MatchupResult {
  if (ADVANTAGE_MAP[attacker] === defender) return 'advantage';
  if (ADVANTAGE_MAP[defender] === attacker) return 'disadvantage';
  return 'neutral';
}

export function getMatchupMultiplier(
  matchup: MatchupResult,
  attackerTeam: 'player' | 'enemy',
  relicIds: string[]
): number {
  if (matchup === 'advantage') {
    if (attackerTeam === 'player' && hasRelic(relicIds, 'sharp_trowel')) {
      return 1.5;
    }
    return 1.3;
  }
  if (matchup === 'disadvantage') {
    return 0.8;
  }
  return 1.0;
}

export function hasRelic(relicIds: string[], effect: RelicEffectKind): boolean {
  return relicIds.some((id) => RELIC_REGISTRY[id]?.effect === effect);
}

export function getUnitGrafts(unit: Pick<BattleUnit, 'graftIds'>): GraftDef[] {
  return unit.graftIds.map((id) => GRAFT_REGISTRY[id]).filter((g): g is GraftDef => Boolean(g));
}

export function hasGraft(unit: Pick<BattleUnit, 'graftIds'>, effect: GraftEffectKind): boolean {
  return getUnitGrafts(unit).some((g) => g.effect === effect);
}

export function hasPerk(unit: Pick<BattleUnit, 'perkIds'>, perkId: string): boolean {
  return Boolean(unit.perkIds?.includes(perkId));
}

export function hasStatus(unit: Pick<BattleUnit, 'statuses'>, kind: StatusKind): boolean {
  return unit.statuses.some((s) => s.kind === kind && s.turns > 0);
}

export function getEffectiveMoveRange(unit: BattleUnit): number {
  if (hasStatus(unit, 'rooted')) return 0;
  let move = unit.moveRange;
  if (hasStatus(unit, 'feared')) {
    move = Math.max(1, move - 2);
  }
  return move;
}

export function getEffectiveJumpRange(unit: BattleUnit, springboardAlly?: BattleUnit): number {
  const launchBonus = springboardAlly?.launchpadCoop ? 2 : 0;
  return unit.jumpRange + launchBonus;
}

export function getMaxDashesForUnit(unit: BattleUnit): number {
  return hasPerk(unit, 'double_dash') ? 2 : 1;
}

export function getMaxOverwatchCharges(unit: BattleUnit): number {
  return hasPerk(unit, 'hero_sight') ? 2 : 1;
}

export function getEffectiveDashDamage(unit: BattleUnit): number {
  return unit.dashDamage + (hasPerk(unit, 'double_dash') ? 1 : 0);
}

export function getEffectiveCoverDamage(unit: BattleUnit): number {
  return unit.weapon.coverDamage + (hasPerk(unit, 'cover_buster') ? 4 : 0);
}

export function applyStatusToUnit(unit: BattleUnit, kind: StatusKind, turns: number): boolean {
  // Iron Taproot graft grants immunity to Rooted & Feared
  if (hasGraft(unit, 'root_anchor') && (kind === 'rooted' || kind === 'feared')) {
    return false;
  }
  // Season Bosses cannot be permanently locked in place by Rooted
  if (unit.isBoss && kind === 'rooted') {
    return false;
  }
  const existing = unit.statuses.find((s) => s.kind === kind);
  if (existing) {
    existing.turns = Math.max(existing.turns, turns);
  } else {
    unit.statuses.push({ kind, turns });
  }
  return true;
}

export function getFamilyLabel(family: UnitFamily): string {
  switch (family) {
    case 'root':
      return 'Root';
    case 'vine':
      return 'Vine';
    case 'fruit':
      return 'Fruit';
    case 'digger':
      return 'Digger';
    case 'blade':
      return 'Blade';
    case 'sprayer':
      return 'Sprayer';
    default:
      return 'Neutral';
  }
}

export function getCooldownForUnit(
  state: BattleState,
  baseCooldown: number,
  team: 'player' | 'enemy',
  unit?: Pick<BattleUnit, 'perkIds'>
): number {
  let cd = baseCooldown;
  if (team === 'player' && hasRelic(state.relicIds, 'heirloom_fertilizer')) {
    cd -= 1;
  }
  if (unit && hasPerk(unit, 'quick_bloom')) {
    cd -= 1;
  }
  return Math.max(1, cd);
}
