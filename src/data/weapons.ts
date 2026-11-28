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
  {
    species: 'strawberry',
    cost: 12,
    tagline: 'Close-range knockback seed scattergun',
    weapon: {
      id: 'berry_scatter',
      name: 'Seed Scattergun',
      arc: 'direct',
      minRange: 1,
      maxRange: 3,
      damage: 6,
      coverDamage: 5,
      knockback: 1,
      description: 'Explosive close-range spray of strawberry seeds that slams foes back 1 tile!',
    },
  },
  {
    species: 'mushroom',
    cost: 12,
    tagline: 'Piercing corrosive mycelium beam',
    weapon: {
      id: 'mycelium_beam',
      name: 'Mycelium Ray',
      arc: 'pierce',
      minRange: 1,
      maxRange: 5,
      damage: 5,
      coverDamage: 4,
      appliesStatus: { kind: 'acid', turns: 2 },
      description: 'Straight-line fungal beam that skewers two farmers and coats them in Acid!',
    },
  },
  {
    species: 'duck',
    cost: 12,
    tagline: 'Lobbed splash-knockback water balloon',
    weapon: {
      id: 'hydro_mortar',
      name: 'Pond Balloon',
      arc: 'lobbed',
      minRange: 2,
      maxRange: 5,
      damage: 4,
      coverDamage: 4,
      aoeRadius: 1,
      knockback: 1,
      description: 'Lobs a giant pond-water balloon over Full Cover, splashing 3×3 and pushing foes back!',
    },
  },
  {
    species: 'pumpkin',
    cost: 12,
    tagline: 'Lobbed fiery heirloom gourd mortar',
    weapon: {
      id: 'gourd_mortar',
      name: 'Ember Gourd',
      arc: 'lobbed',
      minRange: 2,
      maxRange: 5,
      damage: 4,
      coverDamage: 6,
      aoeRadius: 1,
      appliesStatus: { kind: 'burn', turns: 2 },
      description: 'Lobs a glowing jack-o-lantern gourd over walls, scorching 3×3 with Burn & crushing crates!',
    },
  },
  {
    species: 'blueberry',
    cost: 12,
    tagline: 'Lobbed fear-inducing berry smoke grenade',
    weapon: {
      id: 'indigo_flash',
      name: 'Berry Smoke Bomb',
      arc: 'lobbed',
      minRange: 2,
      maxRange: 4,
      damage: 3,
      coverDamage: 3,
      aoeRadius: 1,
      appliesStatus: { kind: 'feared', turns: 1 },
      description: 'Tosses a shadowy berry flash-pod over cover, splashing 3×3 and rattling foes with Feared!',
    },
  },
  {
    species: 'owl',
    cost: 12,
    tagline: 'Piercing straight-line starlight feather barrage',
    weapon: {
      id: 'feather_fan',
      name: 'Starlight Fan',
      arc: 'pierce',
      minRange: 1,
      maxRange: 6,
      damage: 5,
      coverDamage: 4,
      description: 'Sweeps a razor-sharp fan of owl quills straight through lined-up farmers and wooden cover!',
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

/** Starter alternate weapons unlocked right away so players can test Armory builds immediately! */
export const STARTER_UNLOCKED_WEAPONS: readonly string[] = ['milk_jug_lob', 'salad_shuriken', 'berry_scatter'];

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

// =========================================================================
// DUAL-WEAPON LOADOUTS (Primary Ranged + Secondary Melee / Gimmick!)
// Every single playable hero carries BOTH a Ranged Primary and a Melee or
// Mario+Rabbids-style Gimmick Secondary (Luigi-style Vacuum Duster, Cleave
// Hammer, Curving Boomerang, Grapple Whip, Inferno Bellows, Sentry Pop!).
// =========================================================================

export interface DualWeaponKit {
  primary: WeaponDef;
  secondary: WeaponDef;
  secondaryRoleTag: string;
  defaultSlot?: 'primary' | 'secondary';
}

export const DUAL_WEAPON_KITS: Record<HeroSpecies, DualWeaponKit> = {
  cow: {
    secondaryRoleTag: 'Cleave Mallet',
    defaultSlot: 'secondary',
    primary: {
      id: 'cow_cream_cannon',
      name: 'Cream Jug Mortar',
      arc: 'lobbed',
      slot: 'primary',
      visualKind: 'mortar',
      forgeTier: 1,
      minRange: 2,
      maxRange: 4,
      damage: 4,
      coverDamage: 5,
      aoeRadius: 1,
      knockback: 1,
      description: 'Lobs a churning milk jug over Full Cover, splashing 3×3 and shoving farmers back!',
    },
    secondary: {
      id: 'stampede_bash',
      name: 'Moo-ve It! Mallet',
      arc: 'melee',
      slot: 'secondary',
      visualKind: 'hammer',
      gimmick: 'hammer_cleave',
      cleave: true,
      forgeTier: 1,
      minRange: 1,
      maxRange: 2,
      damage: 5,
      coverDamage: 7,
      knockback: 1,
      description: 'Heavy bell-mallet cleave that smashes cover, hits adjacent foes, and shoves targets back!',
    },
  },
  pea: {
    secondaryRoleTag: 'Vacuum Duster',
    primary: {
      id: 'pea_bow',
      name: 'Pod Shot Rifle',
      arc: 'direct',
      slot: 'primary',
      visualKind: 'sniper',
      forgeTier: 1,
      minRange: 1,
      maxRange: 6,
      damage: 4,
      coverDamage: 3,
      description: 'Long-range crisp pea sniper rifle. Flank or climb high ground for 100% shots.',
    },
    secondary: {
      id: 'pea_dew_duster',
      name: 'Dew Duster Vac',
      arc: 'direct',
      slot: 'secondary',
      visualKind: 'duster',
      gimmick: 'vacuum_pull',
      pull: 2,
      curvesCover: true,
      forgeTier: 1,
      minRange: 1,
      maxRange: 4,
      damage: 3,
      coverDamage: 4,
      description: 'Luigi-style suction duster! Pulls hunkered enemies 2 tiles straight OUT of cover!',
    },
  },
  lemon: {
    secondaryRoleTag: 'Acid Duster',
    primary: {
      id: 'citrus_mortar',
      name: 'Citrus Mortar',
      arc: 'lobbed',
      slot: 'primary',
      visualKind: 'mortar',
      forgeTier: 1,
      minRange: 2,
      maxRange: 5,
      damage: 4,
      coverDamage: 4,
      aoeRadius: 1,
      description: 'Lobbed sour bomb that arcs OVER Full Cover and splashes adjacent tiles.',
    },
    secondary: {
      id: 'lemon_zest_duster',
      name: 'Zest Squeezer Vac',
      arc: 'direct',
      slot: 'secondary',
      visualKind: 'duster',
      gimmick: 'vacuum_pull',
      pull: 1,
      curvesCover: true,
      forgeTier: 1,
      minRange: 1,
      maxRange: 4,
      damage: 4,
      coverDamage: 3,
      appliesStatus: { kind: 'acid', turns: 2 },
      description: 'Sour suction blower that yanks farmers 1 tile out of cover and coats them in Acid!',
    },
  },
  rooster: {
    secondaryRoleTag: 'Curving Rang',
    primary: {
      id: 'feather_darts',
      name: 'Quill Longbow',
      arc: 'direct',
      slot: 'primary',
      visualKind: 'bow',
      forgeTier: 1,
      minRange: 1,
      maxRange: 5,
      damage: 4,
      coverDamage: 3,
      description: 'Crisp feathered arrows fired rapidly from high ledges & flank angles.',
    },
    secondary: {
      id: 'rooster_rang',
      name: 'Rooster-Rang',
      arc: 'direct',
      slot: 'secondary',
      visualKind: 'boomerang',
      gimmick: 'boomerang',
      curvesCover: true,
      forgeTier: 1,
      minRange: 1,
      maxRange: 4,
      damage: 4,
      coverDamage: 3,
      knockback: 1,
      appliesStatus: { kind: 'feared', turns: 1 },
      description: 'Curving feather boomerang that arcs around Half Cover, shoves & inflicts Feared!',
    },
  },
  carrot: {
    secondaryRoleTag: 'Grapple Hook',
    primary: {
      id: 'carrot_skewer',
      name: 'Taproot Repeater',
      arc: 'pierce',
      slot: 'primary',
      visualKind: 'blaster',
      forgeTier: 1,
      minRange: 1,
      maxRange: 4,
      damage: 5,
      coverDamage: 5,
      description: 'Piercing straight-line root bolt that skewers enemies and punches through crates.',
    },
    secondary: {
      id: 'carrot_burrow_hook',
      name: 'Taproot Grapple',
      arc: 'direct',
      slot: 'secondary',
      visualKind: 'whip',
      gimmick: 'grapple_yank',
      pull: 2,
      curvesCover: true,
      forgeTier: 1,
      minRange: 1,
      maxRange: 3,
      damage: 4,
      coverDamage: 4,
      appliesStatus: { kind: 'rooted', turns: 1 },
      description: 'Snap-vine grappling hook that yanks farmers 2 tiles into melee range & Roots them!',
    },
  },
  potato: {
    secondaryRoleTag: 'Cleave Mallet',
    defaultSlot: 'secondary',
    primary: {
      id: 'potato_spud_cannon',
      name: 'Tater Cannon',
      arc: 'lobbed',
      slot: 'primary',
      visualKind: 'mortar',
      forgeTier: 1,
      minRange: 2,
      maxRange: 4,
      damage: 4,
      coverDamage: 5,
      aoeRadius: 1,
      description: 'Arcs heavy spud shells over Full Cover, splashing 3×3 and cracking crates!',
    },
    secondary: {
      id: 'tater_bash',
      name: 'Spud Smasher',
      arc: 'melee',
      slot: 'secondary',
      visualKind: 'hammer',
      gimmick: 'hammer_cleave',
      cleave: true,
      forgeTier: 1,
      minRange: 1,
      maxRange: 2,
      damage: 5,
      coverDamage: 7,
      knockback: 1,
      description: 'Heavy cleaving mallet whack that hits adjacent enemies and knocks foes back (+2 BUMP)!',
    },
  },
  chili: {
    secondaryRoleTag: 'Flame Bellows',
    primary: {
      id: 'pepper_pop',
      name: 'Scoville Blaster',
      arc: 'direct',
      slot: 'primary',
      visualKind: 'blaster',
      forgeTier: 1,
      minRange: 1,
      maxRange: 4,
      damage: 4,
      coverDamage: 3,
      description: 'Zippy midrange pepper blaster with snappy flanking reach.',
    },
    secondary: {
      id: 'chili_bellows',
      name: 'Inferno Bellows',
      arc: 'melee',
      slot: 'secondary',
      visualKind: 'bellows',
      gimmick: 'cone_bellows',
      cleave: true,
      forgeTier: 1,
      minRange: 1,
      maxRange: 2,
      damage: 4,
      coverDamage: 5,
      knockback: 1,
      appliesStatus: { kind: 'burn', turns: 2 },
      description: 'Scorching brass forge-bellows that blasts adjacent foes back and lights them up with Burn!',
    },
  },
  blackberry: {
    secondaryRoleTag: 'Briar Whip',
    primary: {
      id: 'thorn_sling',
      name: 'Bramble Sling',
      arc: 'direct',
      slot: 'primary',
      visualKind: 'slingshot',
      forgeTier: 1,
      minRange: 1,
      maxRange: 5,
      damage: 3,
      coverDamage: 2,
      appliesStatus: { kind: 'rooted', turns: 1 },
      description: 'Barbed berry slingshot that slows and Roots exposed farmhands.',
    },
    secondary: {
      id: 'blackberry_briar_whip',
      name: 'Briar Lasso Whip',
      arc: 'direct',
      slot: 'secondary',
      visualKind: 'whip',
      gimmick: 'grapple_yank',
      pull: 1,
      curvesCover: true,
      forgeTier: 1,
      minRange: 1,
      maxRange: 3,
      damage: 4,
      coverDamage: 4,
      appliesStatus: { kind: 'rooted', turns: 1 },
      description: 'Thorny whip crack that yanks farmers out of cover and Roots them in place!',
    },
  },
  corn: {
    secondaryRoleTag: 'Popper Sentry',
    primary: {
      id: 'popcorn_mortar',
      name: 'Popcorn Mortar',
      arc: 'lobbed',
      slot: 'primary',
      visualKind: 'mortar',
      forgeTier: 1,
      minRange: 2,
      maxRange: 5,
      damage: 4,
      coverDamage: 5,
      aoeRadius: 1,
      knockback: 1,
      description: 'Lobs buttered kernels over Full Cover, splashing 3×3 and scattering foes!',
    },
    secondary: {
      id: 'corn_popper_drone',
      name: 'Kernel Pop-Drone',
      arc: 'direct',
      slot: 'secondary',
      visualKind: 'drone',
      gimmick: 'sentry_pop',
      curvesCover: true,
      forgeTier: 1,
      minRange: 1,
      maxRange: 4,
      damage: 4,
      coverDamage: 4,
      aoeRadius: 1,
      appliesStatus: { kind: 'burn', turns: 1 },
      description: 'Clockwork kettle-corn glider that curves around barriers and bursts in hot buttered Burn!',
    },
  },
  lettuce: {
    secondaryRoleTag: 'Leaf Boomerang',
    primary: {
      id: 'lettuce_dew_blaster',
      name: 'Dewdrop Carbine',
      arc: 'direct',
      slot: 'primary',
      visualKind: 'blaster',
      forgeTier: 1,
      minRange: 1,
      maxRange: 5,
      damage: 4,
      coverDamage: 3,
      knockback: 1,
      description: 'Crisp pressurized garden-dew carbine that pushes farmers back 1 tile!',
    },
    secondary: {
      id: 'crisp_leaf_toss',
      name: 'Crisp Boomerang',
      arc: 'direct',
      slot: 'secondary',
      visualKind: 'boomerang',
      gimmick: 'boomerang',
      curvesCover: true,
      forgeTier: 1,
      minRange: 1,
      maxRange: 4,
      damage: 4,
      coverDamage: 4,
      knockback: 1,
      description: 'Spinning crisp leaf boomerang that curves past Half Cover and shoves targets back!',
    },
  },
  pig: {
    secondaryRoleTag: 'Tusk Plow',
    primary: {
      id: 'pig_mud_cannon',
      name: 'Mud Clod Sling',
      arc: 'lobbed',
      slot: 'primary',
      visualKind: 'mortar',
      forgeTier: 1,
      minRange: 2,
      maxRange: 4,
      damage: 4,
      coverDamage: 4,
      appliesStatus: { kind: 'rooted', turns: 1 },
      description: 'Lobs sticky barnyard mud clods over walls to Root distant farmhands!',
    },
    secondary: {
      id: 'tusk_charge',
      name: 'Tusk Plow Hammer',
      arc: 'melee',
      slot: 'secondary',
      visualKind: 'hammer',
      gimmick: 'hammer_cleave',
      cleave: true,
      forgeTier: 1,
      minRange: 1,
      maxRange: 2,
      damage: 5,
      coverDamage: 7,
      knockback: 1,
      description: 'Cleaving iron-shod plow swing that wrecks crates and bowls adjacent foes sideways!',
    },
  },
  sheep: {
    secondaryRoleTag: 'Bale Crusher',
    primary: {
      id: 'sheep_fleece_sling',
      name: 'Wool-Ball Sling',
      arc: 'direct',
      slot: 'primary',
      visualKind: 'slingshot',
      forgeTier: 1,
      minRange: 1,
      maxRange: 4,
      damage: 4,
      coverDamage: 3,
      knockback: 1,
      description: 'Weighted yarn-bale slingshot that bumps enemies out of position from mid-range.',
    },
    secondary: {
      id: 'wool_ram',
      name: 'Bale Crusher',
      arc: 'melee',
      slot: 'secondary',
      visualKind: 'hammer',
      gimmick: 'hammer_cleave',
      cleave: true,
      forgeTier: 1,
      minRange: 1,
      maxRange: 2,
      damage: 5,
      coverDamage: 8,
      knockback: 1,
      description: 'Heavy wool-bale slam that cleaves adjacent foes, shatters cover & shoves off cliffs!',
    },
  },
  goat: {
    secondaryRoleTag: 'Anvil Crusher',
    primary: {
      id: 'goat_scrap_bazooka',
      name: 'Tin-Can Bazooka',
      arc: 'lobbed',
      slot: 'primary',
      visualKind: 'mortar',
      forgeTier: 1,
      minRange: 2,
      maxRange: 5,
      damage: 4,
      coverDamage: 6,
      aoeRadius: 1,
      appliesStatus: { kind: 'acid', turns: 2 },
      description: 'Lobs corrosive tin-can ordnance over cover, wrecking crates & coating foes in Acid!',
    },
    secondary: {
      id: 'billy_ram',
      name: 'Anvil Horn-Maul',
      arc: 'melee',
      slot: 'secondary',
      visualKind: 'hammer',
      gimmick: 'hammer_cleave',
      cleave: true,
      forgeTier: 1,
      minRange: 1,
      maxRange: 2,
      damage: 5,
      coverDamage: 10,
      knockback: 1,
      description: 'Obliterates crates in 1 hit, cleaves nearby foes & sends farmers flying into hazards!',
    },
  },
  strawberry: {
    secondaryRoleTag: 'Rapier Lunge',
    primary: {
      id: 'straw_seed_scatter',
      name: 'Seed Scattergun',
      arc: 'direct',
      slot: 'primary',
      visualKind: 'scatter',
      forgeTier: 1,
      minRange: 1,
      maxRange: 4,
      damage: 5,
      coverDamage: 4,
      description: 'Punchy close-mid berry scattergun built for bold flanking plays.',
    },
    secondary: {
      id: 'berry_rapier',
      name: 'Leaf Rapier Lunge',
      arc: 'pierce',
      slot: 'secondary',
      visualKind: 'lance',
      gimmick: 'lunge_skewer',
      curvesCover: true,
      forgeTier: 1,
      minRange: 1,
      maxRange: 2,
      damage: 6,
      coverDamage: 4,
      knockback: 1,
      description: 'Swashbuckling foil skewer that curves past Half Cover and knocks targets back!',
    },
  },
  mushroom: {
    secondaryRoleTag: 'Boing Mallet',
    primary: {
      id: 'spore_sling',
      name: 'Spore Lobber',
      arc: 'lobbed',
      slot: 'primary',
      visualKind: 'mortar',
      forgeTier: 1,
      minRange: 2,
      maxRange: 5,
      damage: 4,
      coverDamage: 3,
      aoeRadius: 1,
      appliesStatus: { kind: 'feared', turns: 1 },
      description: 'Lobs dizzying toadstool spores over Full Cover, splashing 3×3 with Feared!',
    },
    secondary: {
      id: 'shroom_boing_hammer',
      name: 'Boing-Cap Mallet',
      arc: 'melee',
      slot: 'secondary',
      visualKind: 'hammer',
      gimmick: 'hammer_cleave',
      cleave: true,
      forgeTier: 1,
      minRange: 1,
      maxRange: 2,
      damage: 4,
      coverDamage: 5,
      knockback: 2,
      appliesStatus: { kind: 'feared', turns: 1 },
      description: 'Springy rubber toadstool hammer that bounces enemies a whopping 2 tiles back!',
    },
  },
  duck: {
    secondaryRoleTag: 'Pond Polter-Vac',
    primary: {
      id: 'hose_blaster',
      name: 'Hose Blaster',
      arc: 'direct',
      slot: 'primary',
      visualKind: 'hose',
      forgeTier: 1,
      minRange: 1,
      maxRange: 5,
      damage: 4,
      coverDamage: 4,
      knockback: 1,
      description: 'Pressurized pond-water jet that blasts farmers back 1 tile into water or lava!',
    },
    secondary: {
      id: 'duck_pond_vac',
      name: 'Pond Polter-Vac',
      arc: 'direct',
      slot: 'secondary',
      visualKind: 'duster',
      gimmick: 'vacuum_pull',
      pull: 2,
      curvesCover: true,
      forgeTier: 1,
      minRange: 1,
      maxRange: 4,
      damage: 4,
      coverDamage: 4,
      appliesStatus: { kind: 'frost', turns: 1 },
      description: 'Aviator vacuum duster that sucks enemies 2 tiles out of bunkers & Chills them!',
    },
  },
  pumpkin: {
    secondaryRoleTag: 'Cider Mallet',
    primary: {
      id: 'pumpkin_ember_mortar',
      name: 'Ember Gourd Mortar',
      arc: 'lobbed',
      slot: 'primary',
      visualKind: 'mortar',
      forgeTier: 1,
      minRange: 2,
      maxRange: 5,
      damage: 4,
      coverDamage: 5,
      aoeRadius: 1,
      appliesStatus: { kind: 'burn', turns: 2 },
      description: 'Lobs glowing jack-o-lantern gourds over cover, scorching 3×3 with Burn!',
    },
    secondary: {
      id: 'cider_mallet',
      name: 'Cider Mallet',
      arc: 'melee',
      slot: 'secondary',
      visualKind: 'hammer',
      gimmick: 'hammer_cleave',
      cleave: true,
      forgeTier: 1,
      minRange: 1,
      maxRange: 2,
      damage: 5,
      coverDamage: 8,
      knockback: 1,
      description: 'Heavy oak cider-press mallet that cleaves foes, shatters cover & shoves back 1 tile!',
    },
  },
  blueberry: {
    secondaryRoleTag: 'Shadow Rang',
    primary: {
      id: 'thorn_darts',
      name: 'Rose-Thorn Darts',
      arc: 'direct',
      slot: 'primary',
      visualKind: 'blaster',
      forgeTier: 1,
      minRange: 1,
      maxRange: 5,
      damage: 4,
      coverDamage: 3,
      appliesStatus: { kind: 'acid', turns: 1 },
      description: 'Twin razor rose-thorn kunai that coat targets in Acid from nimble angles.',
    },
    secondary: {
      id: 'blue_shadow_rang',
      name: 'Shadow Berry-Rang',
      arc: 'direct',
      slot: 'secondary',
      visualKind: 'boomerang',
      gimmick: 'boomerang',
      curvesCover: true,
      forgeTier: 1,
      minRange: 1,
      maxRange: 4,
      damage: 5,
      coverDamage: 3,
      appliesStatus: { kind: 'acid', turns: 2 },
      description: 'Curving indigo shuriken-boomerang that bends around Half Cover and melts armor with Acid!',
    },
  },
  owl: {
    secondaryRoleTag: 'Updraft Duster',
    primary: {
      id: 'quill_longbow',
      name: 'Quill Longbow',
      arc: 'direct',
      slot: 'primary',
      visualKind: 'bow',
      forgeTier: 1,
      minRange: 2,
      maxRange: 7,
      damage: 4,
      coverDamage: 3,
      description: 'Ultra-long-range feather-quill bow built for perched High Ground sniping!',
    },
    secondary: {
      id: 'owl_updraft_duster',
      name: 'Updraft Duster',
      arc: 'direct',
      slot: 'secondary',
      visualKind: 'duster',
      gimmick: 'vacuum_pull',
      pull: 2,
      curvesCover: true,
      forgeTier: 1,
      minRange: 1,
      maxRange: 4,
      damage: 4,
      coverDamage: 3,
      appliesStatus: { kind: 'frost', turns: 1 },
      description: 'Tactician’s wind-vortex duster that yanks entrenched foes 2 tiles & Chills them with Frost!',
    },
  },
};

export function getDualWeaponKit(species: HeroSpecies): DualWeaponKit {
  return DUAL_WEAPON_KITS[species] ?? DUAL_WEAPON_KITS.cow;
}

// =========================================================================
// BRANCHING WEAPON FORGE (Tier 1 -> Tier 2 Tactical/Elemental -> Tier 3)
// =========================================================================

export const WEAPON_FORGE_COSTS: Record<2 | 3, number> = {
  2: 12,
  3: 22,
};

export interface WeaponForgeOptionInfo {
  branch: 'tactical' | 'elemental';
  targetTier: 2 | 3;
  title: string;
  badge: string;
  cost: number;
  summary: string;
  previewWeapon: WeaponDef;
}

const ELEMENT_BY_SPECIES: Record<HeroSpecies, { kind: 'burn' | 'acid' | 'frost' | 'rooted'; label: string }> = {
  cow: { kind: 'frost', label: 'Frost-Churned' },
  pea: { kind: 'rooted', label: 'Briar-Snap' },
  lemon: { kind: 'acid', label: 'Solar Acid' },
  rooster: { kind: 'burn', label: 'Sunburst' },
  carrot: { kind: 'rooted', label: 'Taproot Snare' },
  potato: { kind: 'burn', label: 'Baked-Ember' },
  chili: { kind: 'burn', label: 'Volcanic' },
  blackberry: { kind: 'rooted', label: 'Thorn-Bind' },
  corn: { kind: 'burn', label: 'Kettle-Blaze' },
  lettuce: { kind: 'frost', label: 'Iceberg Chill' },
  pig: { kind: 'rooted', label: 'Mire-Snare' },
  sheep: { kind: 'frost', label: 'Winter-Wool' },
  goat: { kind: 'acid', label: 'Rust-Acid' },
  strawberry: { kind: 'burn', label: 'Crimson Spark' },
  mushroom: { kind: 'acid', label: 'Spore-Melt' },
  duck: { kind: 'frost', label: 'Glacier Jet' },
  pumpkin: { kind: 'burn', label: 'Jack-O-Flame' },
  blueberry: { kind: 'frost', label: 'Frost-Indigo' },
  owl: { kind: 'frost', label: 'Midnight Frost' },
};

export function applyWeaponForge(
  baseWeapon: WeaponDef,
  species: HeroSpecies,
  progress?: { tier: 1 | 2 | 3; branch?: 'tactical' | 'elemental' }
): WeaponDef {
  const tier = progress?.tier ?? 1;
  const branch = progress?.branch;
  const cloned: WeaponDef = {
    ...baseWeapon,
    forgeTier: tier,
    forgeBranch: tier > 1 ? branch : undefined,
    appliesStatus: baseWeapon.appliesStatus ? { ...baseWeapon.appliesStatus } : undefined,
  };
  if (tier <= 1 || !branch) return cloned;

  const isSecondary = cloned.slot === 'secondary';
  const elem = ELEMENT_BY_SPECIES[species] ?? { kind: 'burn', label: 'Ember' };

  if (branch === 'tactical') {
    if (tier >= 2) {
      cloned.damage += 1;
      cloned.coverDamage += 2;
      if (cloned.pull) {
        cloned.pull += 1;
      } else if (cloned.arc === 'melee') {
        cloned.knockback = (cloned.knockback ?? 0) + 1;
      } else {
        cloned.maxRange += 1;
      }
    }
    if (tier >= 3) {
      cloned.damage += 1;
      cloned.coverDamage += 3;
      cloned.curvesCover = true;
      if (!isSecondary && cloned.arc === 'direct') {
        cloned.arc = 'pierce';
      } else if (isSecondary) {
        cloned.maxRange += 1;
      }
    }
    cloned.name = tier === 3 ? `Apex ${baseWeapon.name} III` : `${baseWeapon.name} Mk.II`;
  } else {
    // Elemental / Overcharge Forge
    if (tier >= 2) {
      cloned.damage += 2;
      if (!cloned.appliesStatus) {
        cloned.appliesStatus = { kind: elem.kind, turns: 2 };
      } else {
        cloned.appliesStatus = { kind: cloned.appliesStatus.kind, turns: cloned.appliesStatus.turns + 1 };
      }
    }
    if (tier >= 3) {
      cloned.damage += 2;
      if (cloned.arc === 'lobbed' || cloned.gimmick === 'sentry_pop') {
        cloned.aoeRadius = Math.max(1, cloned.aoeRadius ?? 1);
        cloned.knockback = (cloned.knockback ?? 0) + 1;
      } else if (isSecondary) {
        cloned.cleave = true;
      } else {
        cloned.coverDamage += 2;
      }
    }
    cloned.name = tier === 3 ? `${elem.label} ${baseWeapon.name} III` : `${elem.label} ${baseWeapon.name} II`;
  }

  return cloned;
}

export function getWeaponForgeOptions(
  baseWeapon: WeaponDef,
  species: HeroSpecies,
  current?: { tier: 1 | 2 | 3; branch?: 'tactical' | 'elemental' },
  discountMult = 1
): WeaponForgeOptionInfo[] {
  const curTier = current?.tier ?? 1;
  if (curTier >= 3) return [];
  const nextTier = (curTier + 1) as 2 | 3;
  const cost = Math.max(4, Math.round(WEAPON_FORGE_COSTS[nextTier] * discountMult));
  const elem = ELEMENT_BY_SPECIES[species] ?? { kind: 'burn', label: 'Ember' };

  const branches: Array<'tactical' | 'elemental'> =
    curTier === 1 ? ['tactical', 'elemental'] : [current?.branch ?? 'tactical'];

  return branches.map((branch) => {
    const previewWeapon = applyWeaponForge(baseWeapon, species, { tier: nextTier, branch });
    if (branch === 'tactical') {
      return {
        branch,
        targetTier: nextTier,
        title: nextTier === 2 ? 'Tactical Precision II' : 'Apex Masterwork III',
        badge: '⚙️ Tactical',
        cost,
        summary:
          nextTier === 2
            ? baseWeapon.pull
              ? '+1 DMG · +1 Pull · +2 Cover Shred'
              : baseWeapon.arc === 'melee'
                ? '+1 DMG · +1 Knockback · +2 Cover Shred'
                : '+1 DMG · +1 Range · +2 Cover Shred'
            : '+1 DMG · Curves Cover · +3 Cover Shred & Piercing/Reach!',
        previewWeapon,
      };
    }
    return {
      branch,
      targetTier: nextTier,
      title: nextTier === 2 ? `${elem.label} Forge II` : `${elem.label} Overcharge III`,
      badge: '🔥 Elemental',
      cost,
      summary:
        nextTier === 2
          ? `+2 DMG · Inflicts ${elem.kind.toUpperCase()} status!`
          : '+2 DMG · Masterwork Cleave / Blast Overcharge!',
      previewWeapon,
    };
  });
}

/**
 * Computes weapon stats for a hero taking their permanent level, promotion tier, graft, and perk bonuses into account.
 */
export function buildScaledWeaponForHero(hero: RosterHero, baseWeapon: WeaponDef): WeaponDef {
  const kit = getDualWeaponKit(hero.species);
  const forgedSlot = baseWeapon.slot === 'secondary' ? hero.weaponForge?.secondary : hero.weaponForge?.primary;
  const forgedBase = applyWeaponForge(baseWeapon, hero.species, forgedSlot);

  // Derive accumulated non-forge deltas (level, grafts, workshop, perks) from BOTH hero.weapon and primaryWeapon
  const curPrimRaw =
    hero.equippedWeaponId && ALT_WEAPON_REGISTRY[hero.equippedWeaponId]
      ? ALT_WEAPON_REGISTRY[hero.equippedWeaponId].weapon
      : kit.primary;
  const primBaseline = applyWeaponForge(curPrimRaw, hero.species, hero.weaponForge?.primary);
  const secBaseline = applyWeaponForge(kit.secondary, hero.species, hero.weaponForge?.secondary);
  const activeBaseline = (hero.activeWeaponSlot ?? kit.defaultSlot ?? 'primary') === 'secondary' ? secBaseline : primBaseline;

  const activeDmgDelta = Math.max(0, hero.weapon.damage - activeBaseline.damage);
  const primDmgDelta = hero.primaryWeapon ? Math.max(0, hero.primaryWeapon.damage - primBaseline.damage) : 0;
  const dmgDelta = Math.max(activeDmgDelta, primDmgDelta);

  const activeCovDelta = Math.max(0, hero.weapon.coverDamage - activeBaseline.coverDamage);
  const primCovDelta = hero.primaryWeapon ? Math.max(0, hero.primaryWeapon.coverDamage - primBaseline.coverDamage) : 0;
  const coverDelta = Math.max(activeCovDelta, primCovDelta);

  const activeRngDelta = Math.max(0, hero.weapon.maxRange - activeBaseline.maxRange);
  const primRngDelta = hero.primaryWeapon ? Math.max(0, hero.primaryWeapon.maxRange - primBaseline.maxRange) : 0;
  const rangeDelta = Math.max(activeRngDelta, primRngDelta);

  return {
    ...forgedBase,
    damage: forgedBase.damage + dmgDelta,
    coverDamage: forgedBase.coverDamage + coverDelta,
    maxRange: forgedBase.maxRange + rangeDelta,
    appliesStatus: forgedBase.appliesStatus ? { ...forgedBase.appliesStatus } : undefined,
  };
}

/** Ensures a RosterHero always has synchronized Primary (Ranged) + Secondary (Melee/Gimmick) weapons! */
export function ensureHeroDualWeapons(hero: RosterHero): void {
  const kit = getDualWeaponKit(hero.species);
  const bp = PRODUCE_BLUEPRINTS[hero.blueprintId];
  const baseDmg = bp?.weapon.damage ?? kit.primary.damage;
  const baseCov = bp?.weapon.coverDamage ?? kit.primary.coverDamage;
  const dmgDelta = Math.max(0, hero.weapon.damage - baseDmg);
  const covDelta = Math.max(0, hero.weapon.coverDamage - baseCov);

  if (!hero.primaryWeapon) {
    const forgedPrim = applyWeaponForge(kit.primary, hero.species, hero.weaponForge?.primary);
    hero.primaryWeapon = {
      ...forgedPrim,
      damage: forgedPrim.damage + dmgDelta,
      coverDamage: forgedPrim.coverDamage + covDelta,
      appliesStatus: forgedPrim.appliesStatus ? { ...forgedPrim.appliesStatus } : undefined,
    };
  }
  if (!hero.secondaryWeapon) {
    const forgedSec = applyWeaponForge(kit.secondary, hero.species, hero.weaponForge?.secondary);
    hero.secondaryWeapon = {
      ...forgedSec,
      damage: forgedSec.damage + dmgDelta,
      coverDamage: forgedSec.coverDamage + covDelta,
      appliesStatus: forgedSec.appliesStatus ? { ...forgedSec.appliesStatus } : undefined,
    };
  }
  if (!hero.activeWeaponSlot) {
    hero.activeWeaponSlot = kit.defaultSlot ?? 'primary';
  }
  const active = hero.activeWeaponSlot === 'secondary' ? hero.secondaryWeapon : hero.primaryWeapon;
  if (
    hero.weapon.id !== active.id ||
    hero.weapon.damage !== active.damage ||
    hero.weapon.forgeTier !== active.forgeTier ||
    hero.weapon.forgeBranch !== active.forgeBranch ||
    hero.weapon.slot !== active.slot
  ) {
    hero.weapon = {
      ...active,
      appliesStatus: active.appliesStatus ? { ...active.appliesStatus } : undefined,
    };
  }
}
