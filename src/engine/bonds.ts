/**
 * Squad Bonds: bonuses for the mix of heroes you deploy. Two of a kind switches a bond on,
 * three makes it stronger, and one of each produce family earns the Mixed Basket.
 * Bonds are worked out from the heroes on the board when Turn 1 starts and last the battle.
 */
import { applyStatusToUnit } from './hooks';
import type { BattleState, BattleUnit, ProduceFamily } from './types';

export type BondId = 'root_wall' | 'vine_volley' | 'fruit_frenzy' | 'barnyard_buddies' | 'mixed_basket';

export interface BondDef {
  id: BondId;
  name: string;
  icon: string;
  /** Who counts toward the bond, in a few words. */
  who: string;
  /** Effect per tier: index 0 is tier 1, index 1 is tier 2. */
  tiers: string[];
  /** Members needed for each tier. */
  thresholds: number[];
}

export const BOND_DEFS: Record<BondId, BondDef> = {
  root_wall: {
    id: 'root_wall',
    name: 'Root Wall',
    icon: '🥔',
    who: 'Roots',
    thresholds: [2, 3],
    tiers: ['Roots start Shielded for 1 turn (-2 damage taken).', 'Roots start Shielded for 2 turns.'],
  },
  vine_volley: {
    id: 'vine_volley',
    name: 'Vine Volley',
    icon: '🌿',
    who: 'Vines',
    thresholds: [2, 3],
    tiers: ['Vines deal +2 damage to cover and crates.', 'Vines also gain +1 weapon range.'],
  },
  fruit_frenzy: {
    id: 'fruit_frenzy',
    name: 'Fruit Frenzy',
    icon: '🍋',
    who: 'Fruits',
    thresholds: [2, 3],
    tiers: ['Fruits gain +1 Dash damage.', 'Fruits gain +1 Dash damage and +1 Move.'],
  },
  barnyard_buddies: {
    id: 'barnyard_buddies',
    name: 'Barnyard Buddies',
    icon: '🐮',
    who: 'Barnyard animals',
    thresholds: [2, 3],
    tiers: ['Animals gain +1 Team-Jump range.', 'Animals gain +1 Team-Jump range and +1 Move.'],
  },
  mixed_basket: {
    id: 'mixed_basket',
    name: 'Mixed Basket',
    icon: '🧺',
    who: 'A Root, a Vine and a Fruit',
    thresholds: [3],
    tiers: ['Every hero heals 2 HP when the battle starts.'],
  },
};

export const BOND_ORDER: BondId[] = ['mixed_basket', 'root_wall', 'vine_volley', 'fruit_frenzy', 'barnyard_buddies'];

export interface BondMember {
  family: ProduceFamily | string;
  isAnimal?: boolean;
}

export interface BondStatus {
  def: BondDef;
  /** Members counted toward this bond. */
  count: number;
  /** 0 = off, 1 or 2 = active tier. */
  tier: 0 | 1 | 2;
  /** Effect text of the active tier, or of tier 1 while the bond is off. */
  effect: string;
  /** Members still missing for the next tier, or 0 at the top tier. */
  missing: number;
}

function countFor(id: BondId, squad: BondMember[]): number {
  switch (id) {
    case 'root_wall':
      return squad.filter((h) => h.family === 'root').length;
    case 'vine_volley':
      return squad.filter((h) => h.family === 'vine').length;
    case 'fruit_frenzy':
      return squad.filter((h) => h.family === 'fruit').length;
    case 'barnyard_buddies':
      return squad.filter((h) => h.isAnimal).length;
    case 'mixed_basket':
      return (['root', 'vine', 'fruit'] as const).filter((f) => squad.some((h) => h.family === f)).length;
  }
}

/** Every bond with its progress for this squad, active bonds first. */
export function bondStatuses(squad: BondMember[]): BondStatus[] {
  const all = BOND_ORDER.map((id): BondStatus => {
    const def = BOND_DEFS[id];
    const count = countFor(id, squad);
    const tier = (def.thresholds.filter((t) => count >= t).length as 0 | 1 | 2);
    const nextThreshold = def.thresholds[tier];
    return {
      def,
      count,
      tier,
      effect: def.tiers[Math.max(0, tier - 1)] ?? def.tiers[0],
      missing: nextThreshold ? nextThreshold - count : 0,
    };
  });
  return [...all.filter((b) => b.tier > 0), ...all.filter((b) => b.tier === 0)];
}

export function activeBonds(squad: BondMember[]): BondStatus[] {
  return bondStatuses(squad).filter((b) => b.tier > 0);
}

function deployedHeroes(state: BattleState): BattleUnit[] {
  return state.units.filter((u) => u.team === 'player' && u.alive && !u.isEscortCart);
}

/**
 * Apply the deployed squad's bonds to its units. Runs once per battle, when Turn 1 starts,
 * so bench swaps during the prep phase count.
 */
export function applySquadBonds(state: BattleState): BondStatus[] {
  if (state.bondsApplied) return [];
  state.bondsApplied = true;
  const heroes = deployedHeroes(state);
  const bonds = activeBonds(heroes);
  for (const bond of bonds) {
    for (const unit of heroes) {
      switch (bond.def.id) {
        case 'root_wall':
          if (unit.family === 'root') applyStatusToUnit(unit, 'shield', bond.tier);
          break;
        case 'vine_volley':
          if (unit.family === 'vine') {
            unit.weapon.coverDamage = (unit.weapon.coverDamage ?? unit.weapon.damage) + 2;
            if (bond.tier >= 2) unit.weapon.maxRange += 1;
          }
          break;
        case 'fruit_frenzy':
          if (unit.family === 'fruit') {
            unit.dashDamage += 1;
            if (bond.tier >= 2) unit.moveRange += 1;
          }
          break;
        case 'barnyard_buddies':
          if (unit.isAnimal) {
            unit.jumpRange += 1;
            if (bond.tier >= 2) unit.moveRange += 1;
          }
          break;
        case 'mixed_basket':
          unit.hp = Math.min(unit.maxHp, unit.hp + 2);
          break;
      }
    }
  }
  state.activeBonds = bonds.map((b) => ({ id: b.def.id, tier: b.tier as 1 | 2 }));
  return bonds;
}
