import { REGULAR_ENEMY_POOL, type BattleDifficulty } from './difficulty';
import { createRng, type Rng } from './mapgen';
import type {
  BoardTheme,
  CoverKind,
  EndlessBonusKind,
  EndlessFloorOption,
  GridPos,
  MapTemplate,
  ObjectiveType,
  TerrainType,
} from './types';

type TileSpec = MapTemplate['tiles'][number];

interface GridSizePreset {
  width: number;
  height: number;
  label: string;
  tag: string;
}

const GRID_PRESETS: GridSizePreset[] = [
  { width: 7, height: 10, label: '7×10', tag: 'Narrow Ravine' },
  { width: 8, height: 11, label: '8×11', tag: 'Stepped Spire' },
  { width: 10, height: 9, label: '10×9', tag: 'Broad Meadow' },
  { width: 11, height: 8, label: '11×8', tag: 'Wide Causeway' },
  { width: 11, height: 11, label: '11×11', tag: 'Grand Courtyard' },
];

type ElevationArchetype =
  | 'terrace_climb'
  | 'twin_citadels'
  | 'sunken_moat'
  | 'central_keep'
  | 'bridge_canyon';

const ARCHETYPES: ElevationArchetype[] = [
  'terrace_climb',
  'twin_citadels',
  'sunken_moat',
  'central_keep',
  'bridge_canyon',
];

const THEMES: BoardTheme[] = ['spring', 'greenhouse', 'autumn'];

const THEME_ADJECTIVES: Record<BoardTheme, string[]> = {
  spring: ['Clover', 'Blossom', 'Dewdrop', 'Brookside', 'Dandelion'],
  greenhouse: ['Sunbeam', 'Terracotta', 'Glasshouse', 'Copper', 'Conservatory'],
  autumn: ['Pumpkin', 'Cider', 'Amber', 'Maple', 'Lantern'],
};

const ARCHETYPE_NOUNS: Record<ElevationArchetype, string[]> = {
  terrace_climb: ['Watchtower', 'Spire Bluffs', 'Staircase Ridge'],
  twin_citadels: ['Twin Bastions', 'Overlook Cliffs', 'Split Citadel'],
  sunken_moat: ['Creek Crossing', 'Moat Causeway', 'Waterway Depot'],
  central_keep: ['Crown Rotunda', 'Hilltop Keep', 'Sun Plinth'],
  bridge_canyon: ['Twin Bridges', 'Canyon Locks', 'Millstream Flats'],
};

const BOSS_ROTATION = ['scarecrow', 'tractor', 'harvester'] as const;

const OBJECTIVE_META: Record<
  Exclude<ObjectiveType, 'rout' | 'escort'>,
  { icon: string; name: string; label: string }
> = {
  defeat_all: { icon: '⚔️', name: 'Skirmish', label: 'Defeat all contraptions & farmhands' },
  smash_crates: { icon: '📦', name: 'Supply Sabotage', label: 'Smash all glowing Farmer Supply Crates' },
  survive: { icon: '⏳', name: 'Hold the Patch', label: 'Hold the patch for 3 turns' },
  reach_gate: { icon: '🚪', name: 'Gate Breakout', label: 'Reach the North Garden Gate (or clear all)' },
  barn_rescue: { icon: '🔓', name: 'Barn Rescue', label: 'Smash the Burlap Cage & clear the yard' },
  boss: { icon: '👑', name: 'Boss Showdown', label: 'Topple the Endless Harvest Boss!' },
};

const BONUS_ROOM_META: Record<
  EndlessBonusKind,
  { icon: string; title: string; subtitle: string; modifierLabel: string }
> = {
  carnival: {
    icon: '🎪',
    title: 'Carnival Barn',
    subtitle: 'Spin the Harvest Prize Wheel & recruit or unlock a goofy hero!',
    modifierLabel: 'Prize Wheel + Hero Draft',
  },
  tinkerer: {
    icon: '🛠️',
    title: "Tinkerer's Shed",
    subtitle: 'Forge an Alt Weapon, grant +1 SP to every hero, or stock rare bombs!',
    modifierLabel: 'Armory + Squad SP',
  },
  hotspring: {
    icon: '💧',
    title: 'Hot Spring Meadow',
    subtitle: 'Full squad heal + revive bagged allies, or soak for permanent +2 Max HP!',
    modifierLabel: 'Full Heal + Stat Boon',
  },
};

function pick<T>(rng: Rng, list: readonly T[]): T {
  return list[Math.floor(rng() * list.length)];
}

/** Smoothly escalating difficulty curve for Endless Harvest floors (1..∞). */
export function endlessDifficultyFor(floor: number, harvestHeat = 0): BattleDifficulty {
  const f = Math.max(1, Math.floor(floor));
  const heat = Math.max(0, Math.min(5, Math.floor(harvestHeat)));
  const isBoss = f % 4 === 0;
  const hpMult = (isBoss ? 1.08 + (f / 4 - 1) * 0.22 : 0.92 + f * 0.08) * (1 + heat * 0.05);
  const damageBonus = Math.floor((f - 1) / 4) + (heat >= 5 ? 1 : 0);
  const veterans = isBoss
    ? Math.min(3, Math.floor(f / 4))
    : f >= 3
      ? Math.min(3, Math.floor(f / 3) + (heat >= 2 ? 1 : 0))
      : 0;
  return {
    threat: f,
    hpMult,
    damageBonus,
    veteranDamageBonus: heat >= 5 ? 1 : 0,
    extraEnemies: 0, // Procedural generator spawns the exact floor count directly
    veterans,
  };
}

/**
 * Rolls 2 exciting floor options for Endless Harvest:
 * - Every 4th floor (4, 8, 12...): Boss Gate + Pre-Boss Bonus Pit-Stop (if not yet claimed on this floor).
 * - Even non-boss floors (2, 6, 10...): 1 Battle Stage + 1 Interactive Bonus Room (if not yet claimed).
 * - Otherwise (Floor 1, odd floors, or right after claiming a Bonus Room): 2 varied Battle Stages!
 */
export function rollEndlessFloorOptions(
  floor: number,
  seed: number,
  bonusAlreadyClaimedOnFloor = false
): EndlessFloorOption[] {
  const rng = createRng((seed ^ Math.imul(floor + 17, 0x85ebca6b) ^ (bonusAlreadyClaimedOnFloor ? 0x517cc1b7 : 0)) >>> 0);
  const isBossFloor = floor % 4 === 0;
  const offerBonus = !bonusAlreadyClaimedOnFloor && floor >= 2 && floor % 2 === 0;

  const makeBattleOption = (slot: number, forceBoss: boolean, spicy = false): EndlessFloorOption => {
    const optSeed = ((seed ^ Math.imul(floor * 13 + slot * 31 + (spicy ? 97 : 0), 0x9e3779b1)) >>> 0) || 1;
    const optRng = createRng(optSeed);
    const theme = THEMES[(floor - 1 + slot) % THEMES.length];
    const preset = GRID_PRESETS[Math.floor(optRng() * GRID_PRESETS.length)];
    const archetype = ARCHETYPES[Math.floor(optRng() * ARCHETYPES.length)];

    let objective: ObjectiveType;
    if (forceBoss) {
      objective = 'boss';
    } else {
      const pool: ObjectiveType[] =
        floor === 1
          ? ['defeat_all', 'smash_crates']
          : ['defeat_all', 'smash_crates', 'survive', 'reach_gate', 'barn_rescue'];
      objective = pool[(floor + slot + Math.floor(optRng() * pool.length)) % pool.length];
    }

    const adj = pick(optRng, THEME_ADJECTIVES[theme]);
    const noun = pick(optRng, ARCHETYPE_NOUNS[archetype]);
    const objInfo = OBJECTIVE_META[objective as keyof typeof OBJECTIVE_META] ?? OBJECTIVE_META.defeat_all;
    const bossId = BOSS_ROTATION[(Math.floor(floor / 4) - 1 + BOSS_ROTATION.length) % BOSS_ROTATION.length];
    const bossLabel =
      bossId === 'tractor'
        ? 'Baron Combine'
        : bossId === 'harvester'
          ? 'Lord Bramblecoat'
          : 'Captain Scarecrow';

const ARENA_MODIFIER_META: Record<
  Exclude<import('./types').EndlessArenaModifier, 'standard'>,
  { label: string; short: string }
> = {
  sunbeam_surge: { label: '☀️ Sunbeam Surge (+2 Sunbeams)', short: '☀️ Sunbeam Surge' },
  bouncy_meadow: { label: '🍄 Bouncy Meadow (+2 Bounce Pads)', short: '🍄 Bouncy Meadow' },
  rolling_patch: { label: '🎃 Rolling Patch (+2 Pumpkins)', short: '🎃 Rolling Patch' },
  buzzing_yard: { label: '🐝 Buzzing Yard (+2 Beehives)', short: '🐝 Buzzing Yard' },
  seed_convoy: { label: '🌱 Seed Convoy (+10 Bonus Seeds)', short: '🌱 +10 Seed Convoy' },
};

const ARENA_MODIFIER_KEYS = Object.keys(ARENA_MODIFIER_META) as Array<
  Exclude<import('./types').EndlessArenaModifier, 'standard'>
>;

const PREVIEW_CONTRAPTIONS = ['barrow', 'blower', 'sapper', 'mower', 'kettlebot', 'digger', 'trimmer', 'sprayer'] as const;

    const maxElev = archetype === 'terrace_climb' || archetype === 'central_keep' ? 3 : 2;
    const modKey =
      !forceBoss || spicy
        ? ARENA_MODIFIER_KEYS[(floor + slot + Math.floor(optRng() * ARENA_MODIFIER_KEYS.length)) % ARENA_MODIFIER_KEYS.length]
        : 'standard';
    const modMeta = modKey !== 'standard' ? ARENA_MODIFIER_META[modKey] : null;
    const seedBounty =
      (forceBoss ? 22 + floor * 3 : 10 + floor * 2) + (modKey === 'seed_convoy' ? 10 : 0);
    const previewSet = new Set<string>();
    if (forceBoss) {
      previewSet.add(bossId);
      if (floor >= 8) {
        previewSet.add(BOSS_ROTATION[Math.floor(floor / 4) % BOSS_ROTATION.length]);
      }
    }
    while (previewSet.size < 3) {
      previewSet.add(pick(optRng, PREVIEW_CONTRAPTIONS));
    }

    return {
      id: `endless_f${floor}_${slot}_${optSeed.toString(36).slice(0, 4)}`,
      kind: forceBoss ? 'boss' : 'battle',
      title: forceBoss
        ? spicy
          ? `Crowned ${bossLabel} Showdown`
          : `${bossLabel}'s ${noun}`
        : `${adj} ${noun}`,
      subtitle: forceBoss
        ? floor >= 8
          ? `Floor ${floor} Double-Threat Boss · ${preset.label} Arena · Max Height ${maxElev}`
          : `Floor ${floor} Boss Gate · ${preset.label} Arena · Max Height ${maxElev}`
        : `${objInfo.name} · ${preset.label} (${preset.tag}) · Elev 0–${maxElev}`,
      icon: forceBoss ? '👑' : objInfo.icon,
      theme,
      objective,
      gridSize: preset.label,
      modifierLabel: forceBoss
        ? spicy
          ? 'Double Seeds + Relic'
          : 'Boss Bounty + Relic'
        : `${objInfo.name} · Elev ${maxElev}`,
      arenaModifier: modKey,
      arenaModifierLabel: modMeta?.short,
      seedBounty,
      enemyPreviewKinds: Array.from(previewSet),
      seed: optSeed,
    };
  };

  const makeBonusOption = (): EndlessFloorOption => {
    const bonusKinds: EndlessBonusKind[] = ['carnival', 'tinkerer', 'hotspring'];
    // Before a Boss floor, favor Hot Spring or Tinkerer; mid-act favors Carnival Barn!
    const kind = isBossFloor
      ? rng() < 0.55
        ? 'hotspring'
        : 'tinkerer'
      : bonusKinds[(Math.floor(floor / 2) + Math.floor(rng() * bonusKinds.length)) % bonusKinds.length];
    const meta = BONUS_ROOM_META[kind];
    const theme = THEMES[(floor - 1) % THEMES.length];
    return {
      id: `endless_f${floor}_bonus_${kind}`,
      kind: 'bonus',
      title: meta.title,
      subtitle: meta.subtitle,
      icon: meta.icon,
      theme,
      bonusKind: kind,
      modifierLabel: meta.modifierLabel,
      seed: ((seed ^ Math.imul(floor * 41, 0x9e3779b1)) >>> 0) || 7,
    };
  };

  if (isBossFloor) {
    if (offerBonus) {
      return [makeBonusOption(), makeBattleOption(0, true, false)];
    }
    return [makeBattleOption(0, true, false), makeBattleOption(1, true, true)];
  }

  if (offerBonus) {
    return [makeBattleOption(0, false), makeBonusOption()];
  }

  // Ensure the two battle choices differ in grid size or objective for juicy replayability!
  const optA = makeBattleOption(0, false);
  let optB = makeBattleOption(1, false);
  if (optA.objective === optB.objective && optA.gridSize === optB.gridSize) {
    optB = makeBattleOption(2, false);
  }
  return [optA, optB];
}

/**
 * Deterministically builds a complete, guaranteed-traversable procedural MapTemplate
 * with varied grid dimensions, elevation 0–3 terraces, ramps, bridges, bounce pads,
 * contraption enemies, and mission objectives!
 */
export function generateEndlessFloorMap(
  floor: number,
  option: EndlessFloorOption
): MapTemplate {
  const rng = createRng(option.seed);
  const preset =
    GRID_PRESETS.find((p) => p.label === option.gridSize) ??
    GRID_PRESETS[Math.floor(rng() * GRID_PRESETS.length)];
  const width = preset.width;
  const height = preset.height;
  const theme = option.theme;
  const archetype = ARCHETYPES[Math.floor(rng() * ARCHETYPES.length)];
  const objective: ObjectiveType = option.objective ?? (option.kind === 'boss' ? 'boss' : 'defeat_all');
  const liquid: TerrainType = theme === 'greenhouse' && (floor >= 3 || rng() < 0.45) ? 'lava' : 'water';
  const floorTile: TerrainType = theme === 'greenhouse' ? 'barn_floor' : theme === 'autumn' ? 'soil' : 'grass';

  // Grid working buffer so we never overlap hazards, ramps, cover, or spawns
  const grid: Array<Array<{ terrain: TerrainType; elevation: number; cover?: Exclude<CoverKind, 'none'> }>> = [];
  for (let y = 0; y < height; y++) {
    const row: Array<{ terrain: TerrainType; elevation: number; cover?: Exclude<CoverKind, 'none'> }> = [];
    for (let x = 0; x < width; x++) {
      row.push({ terrain: 'grass', elevation: 0 });
    }
    grid.push(row);
  }

  const setTile = (
    x: number,
    y: number,
    props: Partial<{ terrain: TerrainType; elevation: number; cover: Exclude<CoverKind, 'none'> | undefined }>
  ) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    if (props.terrain !== undefined) grid[y][x].terrain = props.terrain;
    if (props.elevation !== undefined) grid[y][x].elevation = props.elevation;
    if ('cover' in props) grid[y][x].cover = props.cover;
  };

  const midX = Math.floor(width / 2);
  const midY = Math.floor(height / 2);
  const burrowPairs: Array<[GridPos, GridPos]> = [];

  // 1. Sculpt terrain & dramatic Elevation 0..3 architecture!
  if (archetype === 'terrace_climb') {
    const tier1Y = Math.max(4, height - 4);
    const tier2Y = Math.max(2, Math.floor(height * 0.42));
    const tier3Y = Math.max(1, Math.floor(height * 0.2));

    // Base valley stream if tall enough
    if (height >= 10) {
      const riverY = height - 3;
      for (let x = 0; x < width; x++) setTile(x, riverY, { terrain: liquid, elevation: 0 });
      setTile(1, riverY, { terrain: 'bridge', elevation: 0 });
      setTile(midX, riverY, { terrain: 'bridge', elevation: 0 });
      setTile(width - 2, riverY, { terrain: 'bridge', elevation: 0 });
    }

    // Tier 1 (elev 1)
    for (let y = 0; y <= tier1Y; y++) {
      for (let x = 0; x < width; x++) setTile(x, y, { terrain: floorTile, elevation: 1 });
    }
    setTile(1, tier1Y + 1, { terrain: 'ramp', elevation: 0 });
    setTile(width - 2, tier1Y + 1, { terrain: 'ramp', elevation: 0 });
    setTile(midX, tier1Y + 1, { terrain: 'bounce_pad', elevation: 0 });

    // Tier 2 (elev 2)
    for (let y = 0; y <= tier2Y; y++) {
      for (let x = 1; x < width - 1; x++) setTile(x, y, { terrain: 'soil', elevation: 2 });
    }
    setTile(Math.max(1, midX - 1), tier2Y + 1, { terrain: 'ramp', elevation: 1 });
    setTile(Math.min(width - 2, midX + 1), tier2Y + 1, { terrain: 'ramp', elevation: 1 });

    // Tier 3 Summit Watchtower (elev 3!)
    for (let y = 0; y <= tier3Y; y++) {
      for (let x = Math.max(1, midX - 1); x <= Math.min(width - 2, midX + 1); x++) {
        setTile(x, y, { terrain: 'barn_floor', elevation: 3 });
      }
    }
    setTile(midX, tier3Y + 1, { terrain: 'ramp', elevation: 2 });
    setTile(midX, Math.max(0, tier3Y - 1), { terrain: 'sunbeam', elevation: 3 });

    // Flanking Gopher Burrow tunnels from ground up to Tier 2!
    setTile(0, height - 2, { terrain: 'burrow', elevation: 0 });
    setTile(1, tier2Y, { terrain: 'burrow', elevation: 2 });
    burrowPairs.push([{ x: 0, y: height - 2 }, { x: 1, y: tier2Y }]);
  } else if (archetype === 'twin_citadels') {
    // Central sunken road with river/lava crossing
    for (let x = 0; x < width; x++) setTile(x, midY, { terrain: liquid, elevation: 0 });
    setTile(midX, midY, { terrain: 'bridge', elevation: 0 });
    setTile(Math.max(1, midX - 2), midY, { terrain: 'bridge', elevation: 0 });
    setTile(Math.min(width - 2, midX + 2), midY, { terrain: 'bridge', elevation: 0 });

    // West & East two-story citadels (elev 1 skirt + elev 2 peak)
    for (let y = 1; y <= height - 3; y++) {
      setTile(0, y, { terrain: floorTile, elevation: 2 });
      setTile(1, y, { terrain: floorTile, elevation: 1 });
      setTile(width - 1, y, { terrain: floorTile, elevation: 2 });
      setTile(width - 2, y, { terrain: floorTile, elevation: 1 });
    }
    // Smooth ramps up both citadels
    setTile(1, height - 3, { terrain: 'ramp', elevation: 0 });
    setTile(width - 2, height - 3, { terrain: 'ramp', elevation: 0 });
    setTile(1, Math.max(2, midY - 1), { terrain: 'ramp', elevation: 1 });
    setTile(width - 2, Math.max(2, midY - 1), { terrain: 'ramp', elevation: 1 });
    setTile(2, height - 3, { terrain: 'bounce_pad', elevation: 0 });
    setTile(width - 3, height - 3, { terrain: 'bounce_pad', elevation: 0 });
    setTile(0, Math.max(1, midY - 2), { terrain: 'sunbeam', elevation: 2 });
    setTile(width - 1, Math.max(1, midY - 2), { terrain: 'sunbeam', elevation: 2 });
  } else if (archetype === 'sunken_moat') {
    const moatY = midY;
    for (let x = 0; x < width; x++) setTile(x, moatY, { terrain: liquid, elevation: 0 });
    setTile(1, moatY, { terrain: 'bridge', elevation: 0 });
    setTile(midX, moatY, { terrain: 'bridge', elevation: 0 });
    setTile(width - 2, moatY, { terrain: 'bridge', elevation: 0 });

    // Raised northern fortified ridge (elev 1 + center elev 2)
    for (let y = 0; y < moatY - 1; y++) {
      for (let x = 0; x < width; x++) setTile(x, y, { terrain: floorTile, elevation: 1 });
    }
    for (let y = 0; y <= Math.max(1, moatY - 3); y++) {
      for (let x = Math.max(1, midX - 2); x <= Math.min(width - 2, midX + 2); x++) {
        setTile(x, y, { terrain: 'barn_floor', elevation: 2 });
      }
    }
    setTile(1, moatY - 1, { terrain: 'ramp', elevation: 0 });
    setTile(midX, moatY - 1, { terrain: 'ramp', elevation: 0 });
    setTile(width - 2, moatY - 1, { terrain: 'ramp', elevation: 0 });
    setTile(midX, Math.max(1, moatY - 2), { terrain: 'ramp', elevation: 1 });
    setTile(Math.max(2, midX - 2), moatY + 1, { terrain: 'bounce_pad', elevation: 0 });
    setTile(Math.min(width - 3, midX + 2), moatY + 1, { terrain: 'bounce_pad', elevation: 0 });
  } else if (archetype === 'central_keep') {
    // Concentric raised rotunda (elev 1 ring -> elev 2 inner deck -> elev 3 crown plinth!)
    for (let y = Math.max(1, midY - 2); y <= Math.min(height - 3, midY + 1); y++) {
      for (let x = Math.max(1, midX - 2); x <= Math.min(width - 2, midX + 2); x++) {
        setTile(x, y, { terrain: floorTile, elevation: 1 });
      }
    }
    for (let y = Math.max(1, midY - 1); y <= Math.min(height - 3, midY); y++) {
      for (let x = Math.max(1, midX - 1); x <= Math.min(width - 2, midX + 1); x++) {
        setTile(x, y, { terrain: 'soil', elevation: 2 });
      }
    }
    setTile(midX, Math.max(1, midY - 1), { terrain: 'sunbeam', elevation: 3 });
    // Cardinal ramps
    setTile(midX, Math.min(height - 2, midY + 2), { terrain: 'ramp', elevation: 0 });
    setTile(midX, Math.max(0, midY - 3), { terrain: 'ramp', elevation: 0 });
    setTile(Math.max(0, midX - 3), midY, { terrain: 'ramp', elevation: 0 });
    setTile(Math.min(width - 1, midX + 3), midY, { terrain: 'ramp', elevation: 0 });
    setTile(midX, Math.min(height - 3, midY + 1), { terrain: 'ramp', elevation: 1 });
    setTile(midX, midY, { terrain: 'ramp', elevation: 2 });
    // Decorative flank pools & bounce pads
    setTile(0, midY, { terrain: liquid, elevation: 0 });
    setTile(width - 1, midY, { terrain: liquid, elevation: 0 });
    setTile(1, Math.min(height - 2, midY + 2), { terrain: 'bounce_pad', elevation: 0 });
    setTile(width - 2, Math.min(height - 2, midY + 2), { terrain: 'bounce_pad', elevation: 0 });
  } else {
    // bridge_canyon: Twin water/lava canals with stepped middle island!
    const lowerY = Math.min(height - 3, midY + 1);
    const upperY = Math.max(2, midY - 2);
    for (let x = 0; x < width; x++) {
      setTile(x, lowerY, { terrain: liquid, elevation: 0 });
      setTile(x, upperY, { terrain: liquid, elevation: 0 });
    }
    const bx1 = Math.max(1, Math.floor(width * 0.25));
    const bx2 = Math.min(width - 2, Math.floor(width * 0.75));
    setTile(bx1, lowerY, { terrain: 'bridge', elevation: 0 });
    setTile(bx2, lowerY, { terrain: 'bridge', elevation: 0 });
    setTile(bx1, upperY, { terrain: 'bridge', elevation: 0 });
    setTile(bx2, upperY, { terrain: 'bridge', elevation: 0 });
    setTile(midX, upperY, { terrain: 'bridge', elevation: 0 });

    // Raised center island (elev 1) between canals + elevated north ledge (elev 2)
    for (let y = upperY + 1; y < lowerY; y++) {
      for (let x = Math.max(1, midX - 1); x <= Math.min(width - 2, midX + 1); x++) {
        setTile(x, y, { terrain: 'grass', elevation: 1 });
      }
    }
    for (let x = Math.max(1, midX - 2); x <= Math.min(width - 2, midX + 2); x++) {
      setTile(x, 0, { terrain: 'barn_floor', elevation: 2 });
      if (upperY > 1) setTile(x, 1, { terrain: 'soil', elevation: 1 });
    }
    if (upperY > 1) setTile(midX, 1, { terrain: 'ramp', elevation: 1 });
    setTile(midX, lowerY + 1, { terrain: 'bounce_pad', elevation: 0 });
  }

  // Always add 1–2 Compost heal beds near southern/mid flanks
  setTile(1, height - 2, { terrain: 'compost' });
  setTile(width - 2, height - 2, { terrain: 'compost' });

  // 2. Place guaranteed flat walkable Player Spawns along the south rows
  const playerSpawns: GridPos[] = [];
  const candidateXs = [
    Math.max(1, midX - 2),
    Math.max(1, midX - 1),
    Math.min(width - 2, midX + 1),
    Math.min(width - 2, midX + 2),
    midX,
    0,
    width - 1,
  ];
  for (const sx of candidateXs) {
    if (playerSpawns.length >= 4) break;
    const sy = playerSpawns.length % 2 === 0 ? height - 1 : Math.max(height - 2, 0);
    if (!playerSpawns.some((p) => p.x === sx && p.y === sy)) {
      setTile(sx, sy, { terrain: 'grass', elevation: 0, cover: undefined });
      playerSpawns.push({ x: sx, y: sy });
    }
  }

  const occupied = new Set<string>(playerSpawns.map((p) => `${p.x},${p.y}`));
  const isFree = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return false;
    const t = grid[y][x];
    if (t.terrain === 'water' || t.terrain === 'lava' || t.terrain === 'ramp' || t.terrain === 'bounce_pad' || t.terrain === 'burrow') {
      return false;
    }
    return !t.cover && !occupied.has(`${x},${y}`);
  };

  // 3. Configure special Objective fixtures (Gate, Cage, or Supply Crates!)
  let gateTiles: GridPos[] | undefined;
  let cagePos: GridPos | undefined;
  let objectiveCratePositions: GridPos[] | undefined;

  if (objective === 'reach_gate') {
    gateTiles = [];
    for (let dx = -1; dx <= 1; dx++) {
      const gx = Math.max(0, Math.min(width - 1, midX + dx));
      setTile(gx, 0, { terrain: 'gate', cover: undefined });
      occupied.add(`${gx},0`);
      gateTiles.push({ x: gx, y: 0 });
    }
  } else if (objective === 'barn_rescue') {
    const cx = midX;
    const cy = 1;
    setTile(cx, cy, { terrain: floorTile, cover: 'cage' });
    occupied.add(`${cx},${cy}`);
    cagePos = { x: cx, y: cy };
  } else if (objective === 'smash_crates') {
    const crateCount = width >= 10 ? 3 : 2;
    const targetXs =
      crateCount === 3 ? [1, midX, width - 2] : [Math.max(1, midX - 2), Math.min(width - 2, midX + 2)];
    objectiveCratePositions = [];
    for (const cx of targetXs) {
      const cy = 1;
      if (grid[cy][cx].terrain === 'water' || grid[cy][cx].terrain === 'lava') {
        setTile(cx, cy, { terrain: floorTile });
      }
      occupied.add(`${cx},${cy}`);
      objectiveCratePositions.push({ x: cx, y: cy });
    }
  }

  // 4. Spawn varied Enemy roster (prioritizing wacky contraptions alongside farmhands + Boss every 4th floor!)
  const enemySpawns: MapTemplate['enemySpawns'] = [];
  const contraptionBoostPool = [
    'barrow',
    'blower',
    'sapper',
    'mower',
    'kettlebot',
    ...REGULAR_ENEMY_POOL,
  ];
  const targetEnemyCount =
    objective === 'boss'
      ? Math.min(5, 3 + Math.floor(floor / 4))
      : Math.min(6, 3 + Math.floor((floor + 1) / 2));

  const findEnemySpot = (preferTop: boolean): GridPos | null => {
    const minY = objective === 'reach_gate' ? 1 : 0;
    const maxY = Math.max(minY + 1, Math.min(height - 4, Math.floor(height * (preferTop ? 0.45 : 0.62))));
    const candidates: GridPos[] = [];
    for (let y = minY; y <= maxY; y++) {
      for (let x = 0; x < width; x++) {
        if (isFree(x, y)) candidates.push({ x, y });
      }
    }
    if (candidates.length === 0) return null;
    return pick(rng, candidates);
  };

  if (objective === 'boss') {
    const primaryBoss = BOSS_ROTATION[(Math.floor(floor / 4) - 1 + BOSS_ROTATION.length) % BOSS_ROTATION.length];
    const bossSpot = isFree(midX, 1) ? { x: midX, y: 1 } : findEnemySpot(true);
    if (bossSpot) {
      occupied.add(`${bossSpot.x},${bossSpot.y}`);
      enemySpawns.push({ blueprintId: primaryBoss, x: bossSpot.x, y: bossSpot.y });
    }
    // Floor 8, 12, 16+ Double-Boss Escalation!
    if (floor >= 8) {
      const secondBoss = BOSS_ROTATION[Math.floor(floor / 4) % BOSS_ROTATION.length];
      const spot2 = findEnemySpot(true);
      if (spot2) {
        occupied.add(`${spot2.x},${spot2.y}`);
        enemySpawns.push({ blueprintId: secondBoss, x: spot2.x, y: spot2.y });
      }
    }
  }

  while (enemySpawns.length < targetEnemyCount) {
    const spot = findEnemySpot(enemySpawns.length < 2);
    if (!spot) break;
    occupied.add(`${spot.x},${spot.y}`);
    enemySpawns.push({
      blueprintId: pick(rng, contraptionBoostPool),
      x: spot.x,
      y: spot.y,
    });
  }

  // 5. Sprinkle fun cover & interactive hazards (crates, haystacks, beehives, sprinklers, rolling pumpkins!)
  const coverPalette: Array<Exclude<CoverKind, 'none'>> = [
    'crate',
    'crate',
    'haystack',
    'beehive',
    'sprinkler',
    'pumpkin',
    'stone',
  ];
  const targetCovers = Math.max(7, Math.min(13, Math.floor((width * height) / 9)));
  let placedCover = 0;
  for (let attempts = 0; attempts < 80 && placedCover < targetCovers; attempts++) {
    const cx = Math.floor(rng() * width);
    const cy = 1 + Math.floor(rng() * Math.max(1, height - 3));
    if (!isFree(cx, cy)) continue;
    // Keep narrow bridge exits clear so nobody gets corked!
    const adjBridge = [
      grid[cy]?.[cx - 1],
      grid[cy]?.[cx + 1],
      grid[cy - 1]?.[cx],
      grid[cy + 1]?.[cx],
    ].some((t) => t?.terrain === 'bridge' || t?.terrain === 'ramp');
    if (adjBridge) continue;
    const kind = pick(rng, coverPalette);
    setTile(cx, cy, { cover: kind });
    occupied.add(`${cx},${cy}`);
    placedCover += 1;
  }

  // 5B. Apply Endless Arena Modifier spice!
  const mod = option.arenaModifier ?? 'standard';
  if (mod === 'sunbeam_surge' || mod === 'bouncy_meadow') {
    const bonusTerrain: TerrainType = mod === 'sunbeam_surge' ? 'sunbeam' : 'bounce_pad';
    let placed = 0;
    for (let tries = 0; tries < 50 && placed < 2; tries++) {
      const mx = 1 + Math.floor(rng() * Math.max(1, width - 2));
      const my = 1 + Math.floor(rng() * Math.max(1, height - 3));
      if (!isFree(mx, my)) continue;
      if (grid[my][mx].terrain === 'ramp' || grid[my][mx].terrain === 'bridge' || grid[my][mx].terrain === 'burrow') continue;
      setTile(mx, my, { terrain: bonusTerrain });
      placed += 1;
    }
  } else if (mod === 'rolling_patch' || mod === 'buzzing_yard') {
    const bonusCover: Exclude<CoverKind, 'none'> = mod === 'rolling_patch' ? 'pumpkin' : 'beehive';
    let placed = 0;
    for (let tries = 0; tries < 50 && placed < 2; tries++) {
      const mx = 1 + Math.floor(rng() * Math.max(1, width - 2));
      const my = 1 + Math.floor(rng() * Math.max(1, height - 3));
      if (!isFree(mx, my)) continue;
      const adjBridge = [
        grid[my]?.[mx - 1],
        grid[my]?.[mx + 1],
        grid[my - 1]?.[mx],
        grid[my + 1]?.[mx],
      ].some((t) => t?.terrain === 'bridge' || t?.terrain === 'ramp');
      if (adjBridge) continue;
      setTile(mx, my, { cover: bonusCover });
      occupied.add(`${mx},${my}`);
      placed += 1;
    }
  }

  // Flatten non-default tiles into MapTemplate['tiles']
  const tiles: TileSpec[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const cell = grid[y][x];
      if (cell.terrain !== 'grass' || cell.elevation !== 0 || cell.cover) {
        tiles.push({
          x,
          y,
          ...(cell.terrain !== 'grass' ? { terrain: cell.terrain } : {}),
          ...(cell.elevation !== 0 ? { elevation: cell.elevation } : {}),
          ...(cell.cover ? { cover: cell.cover } : {}),
        });
      }
    }
  }

  const objMeta = OBJECTIVE_META[objective as keyof typeof OBJECTIVE_META] ?? OBJECTIVE_META.defeat_all;
  const objectiveLabel =
    objective === 'smash_crates'
      ? `Smash all ${objectiveCratePositions?.length ?? 2} Farmer Supply Crates`
      : objective === 'survive'
        ? `Hold the Patch — Survive ${floor >= 5 ? 4 : 3} Turns`
        : objMeta.label;

  return {
    id: `endless_f${floor}_${option.seed.toString(36)}${mod !== 'standard' ? `_${mod}` : ''}`,
    name: `Floor ${floor} · ${option.title}`,
    subtitle: option.subtitle,
    theme,
    objective,
    objectiveLabel,
    width,
    height,
    tiles,
    playerSpawns,
    enemySpawns,
    gateTiles,
    cagePos,
    burrowPairs: burrowPairs.length > 0 ? burrowPairs : undefined,
    surviveTurns: objective === 'survive' ? (floor >= 5 ? 4 : 3) : undefined,
    objectiveCratePositions,
  };
}
