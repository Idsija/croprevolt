import type { HeroSpecies, RosterHero, WeaponDef } from '../engine/types';
import { PRODUCE_BLUEPRINTS } from './produce';

export interface AltWeaponEntry {
  species: HeroSpecies;
  weapon: WeaponDef;
  cost: number;
  tagline: string;
}

export const ALT_WEAPONS: AltWeaponEntry[] = [
  {
    species: 'potato',
    cost: 12,
    tagline: 'Lobbed AoE knockback mortar',
    weapon: {
      id: 'masher_mortar',
      name: 'Tater Cannon',
      arc: 'lobbed',
      minRange: 2,
      maxRange: 4,
      damage: 4,
      coverDamage: 6,
      aoeRadius: 1,
      knockback: 1,
      description: 'Arcs heavy spud shells over Full Cover, splashing 3×3 and shoving targets back!',
    },
  },
  {
    species: 'pea',
    cost: 12,
    tagline: 'Straight-line piercing sniper',
    weapon: {
      id: 'snap_piercer',
      name: 'Railpod Rifle',
      arc: 'pierce',
      minRange: 1,
      maxRange: 6,
      damage: 5,
      coverDamage: 4,
      description: 'High-velocity sugar-snap bolt that skewers straight through two lined-up farmers!',
    },
  },
  {
    species: 'lemon',
    cost: 12,
    tagline: 'Piercing Acid laser beam',
    weapon: {
      id: 'zest_blaster',
      name: 'Citric Beam',
      arc: 'pierce',
      minRange: 1,
      maxRange: 5,
      damage: 5,
      coverDamage: 4,
      appliesStatus: { kind: 'acid', turns: 2 },
      description: 'Focused sour-beam that pierces targets and applies Acid (+2 incoming damage)!',
    },
  },
  {
    species: 'chili',
    cost: 12,
    tagline: 'Burning lobbed firecracker',
    weapon: {
      id: 'ember_lobber',
      name: 'Inferno Popper',
      arc: 'lobbed',
      minRange: 2,
      maxRange: 4,
      damage: 4,
      coverDamage: 4,
      aoeRadius: 1,
      appliesStatus: { kind: 'burn', turns: 2 },
      description: 'Lobs scorching pepper bombs over walls, igniting foes in a 3×3 patch!',
    },
  },
  {
    species: 'carrot',
    cost: 12,
    tagline: 'Heavy close-range knockback spear',
    weapon: {
      id: 'crunch_glaive',
      name: 'Bumper Spear',
      arc: 'melee',
      minRange: 1,
      maxRange: 2,
      damage: 6,
      coverDamage: 6,
      knockback: 1,
      description: 'Massive close-range root thrust that bowls farmers back into hazards!',
    },
  },
  {
    species: 'blackberry',
    cost: 12,
    tagline: 'Lobbed 3×3 Vine Root mortar',
    weapon: {
      id: 'briar_mortar',
      name: 'Briar Bomb',
      arc: 'lobbed',
      minRange: 2,
      maxRange: 5,
      damage: 3,
      coverDamage: 3,
      aoeRadius: 1,
      appliesStatus: { kind: 'rooted', turns: 1 },
      description: 'Tosses a tangled briar pod over cover, Rooting farmers across a 3×3 zone!',
    },
  },
  {
    species: 'corn',
    cost: 12,
    tagline: 'Scorching direct butter volley',
    weapon: {
      id: 'cob_gatling',
      name: 'Butter Repeater',
      arc: 'direct',
      minRange: 1,
      maxRange: 5,
      damage: 5,
      coverDamage: 5,
      appliesStatus: { kind: 'burn', turns: 1 },
      description: 'Rapid direct fire of sizzling popcorn kernels that shreds crates & Burns!',
    },
  },
  {
    species: 'lettuce',
    cost: 12,
    tagline: 'Piercing spinning leaf disc',
    weapon: {
      id: 'salad_shuriken',
      name: 'Wedge Boomerang',
      arc: 'pierce',
      minRange: 1,
      maxRange: 5,
      damage: 4,
      coverDamage: 3,
      knockback: 1,
      description: 'Razor-crisp lettuce disc that skewers straight lines and knocks foes back 1 tile!',
    },
  },
  {
    species: 'cow',
    cost: 12,
    tagline: 'Lobbed Creamery splash mortar',
    weapon: {
      id: 'milk_jug_lob',
      name: 'Creamery Lobber',
      arc: 'lobbed',
      minRange: 2,
      maxRange: 4,
      damage: 4,
      coverDamage: 5,
      aoeRadius: 1,
      knockback: 1,
      description: 'Heaves a churning milk jug over Full Cover, splashing 3×3 and pushing foes back!',
    },
  },
  {
    species: 'pig',
    cost: 12,
    tagline: 'Lobbed mud-snare cannon',
    weapon: {
      id: 'truffle_sling',
      name: 'Mud Clod Cannon',
      arc: 'lobbed',
      minRange: 2,
      maxRange: 4,
      damage: 4,
      coverDamage: 5,
      appliesStatus: { kind: 'rooted', turns: 1 },
      description: 'Hurls sticky barnyard mud over obstacles, Rooting exposed farmers in place!',
    },
  },
  {
    species: 'rooster',
    cost: 12,
    tagline: 'Concussive knockback + Fear blast',
    weapon: {
      id: 'sonic_beak',
      name: 'Crow Shockwave',
      arc: 'direct',
      minRange: 1,
      maxRange: 4,
      damage: 4,
      coverDamage: 4,
      knockback: 1,
      appliesStatus: { kind: 'feared', turns: 1 },
      description: 'Ear-splitting barnyard blast that shoves farmers back and inflicts Feared (-2 Move)!',
    },
  },
  {
    species: 'sheep',
    cost: 12,
    tagline: 'Heavy knockback cover-breaker',
    weapon: {
      id: 'fleece_hammer',
      name: 'Bale Crusher',
      arc: 'melee',
      minRange: 1,
      maxRange: 2,
      damage: 5,
      coverDamage: 8,
      knockback: 1,
      description: 'Weighted wool-bale slam that shatters obstacles and knocks enemies off cliffs!',
    },
  },
  {
    species: 'goat',
    cost: 12,
    tagline: 'Lobbed corrosive scrap mortar',
    weapon: {
      id: 'tin_can_launcher',
      name: 'Scrap Bazooka',
      arc: 'lobbed',
      minRange: 2,
      maxRange: 5,
      damage: 4,
      coverDamage: 7,
      aoeRadius: 1,
      appliesStatus: { kind: 'acid', turns: 2 },
      description: 'Fires tin-can ordnance over cover, wrecking crates and dousing foes in Acid!',
    },
  },
];

export const ALT_WEAPON_REGISTRY: Record<string, AltWeaponEntry> = Object.fromEntries(
  ALT_WEAPONS.map((entry) => [entry.weapon.id, entry])
);

export const ALT_WEAPONS_BY_SPECIES: Record<HeroSpecies, AltWeaponEntry> = Object.fromEntries(
  ALT_WEAPONS.map((entry) => [entry.species, entry])
) as Record<HeroSpecies, AltWeaponEntry>;

export const ALL_ALT_WEAPON_IDS: string[] = ALT_WEAPONS.map((entry) => entry.weapon.id);

/** Two starter alternate weapons unlocked right away so players can test Armory builds immediately! */
export const STARTER_UNLOCKED_WEAPONS: readonly string[] = ['milk_jug_lob', 'salad_shuriken'];

/**
 * Returns a hero's base weapon plus their species' alternate weapon definition.
 */
export function getSpeciesWeapons(species: HeroSpecies): { base: WeaponDef; alt: AltWeaponEntry } {
  const bp = PRODUCE_BLUEPRINTS[species];
  return {
    base: bp.weapon,
    alt: ALT_WEAPONS_BY_SPECIES[species],
  };
}

/**
 * Computes weapon stats for a hero taking their permanent level, promotion tier, graft, and perk bonuses into account.
 */
export function buildScaledWeaponForHero(hero: RosterHero, baseWeapon: WeaponDef): WeaponDef {
  const bp = PRODUCE_BLUEPRINTS[hero.blueprintId];
  const origBase = bp ? bp.weapon : baseWeapon;
  // Derive exact accumulated attack / cover / range deltas already earned on hero.weapon
  const prevBase =
    hero.equippedWeaponId && ALT_WEAPON_REGISTRY[hero.equippedWeaponId]
      ? ALT_WEAPON_REGISTRY[hero.equippedWeaponId].weapon
      : origBase;

  const dmgDelta = Math.max(0, hero.weapon.damage - prevBase.damage);
  const coverDelta = Math.max(0, hero.weapon.coverDamage - prevBase.coverDamage);
  const rangeDelta = Math.max(0, hero.weapon.maxRange - prevBase.maxRange);

  return {
    ...baseWeapon,
    damage: baseWeapon.damage + dmgDelta,
    coverDamage: baseWeapon.coverDamage + coverDelta,
    maxRange: baseWeapon.maxRange + rangeDelta,
    appliesStatus: baseWeapon.appliesStatus ? { ...baseWeapon.appliesStatus } : undefined,
  };
}
