import type { BoardTheme, BoardTravelCard, NodeType, SeasonId, SeasonNode } from './types';

/**
 * Seasonal Watercolor Boardgame Overworld Generator & Travel Card Pathfinder.
 *
 * Each Act lays out 16 interconnected board spaces pinned directly to the roads,
 * bridges, loops, and landmarks of its seasonal hand-painted watercolor game board
 * (Spring Meadow Patch, Summer Sunlit Greenhouse, Autumn Harvest Orchard).
 * Space encounters are procedurally seeded per run while preserving rich branching
 * routes, cross-road shortcuts, Markets, Shrines, Armory Wagons, Elites, and Bosses.
 */

export type Rng = () => number;

/** Small, fast, seedable PRNG (mulberry32). Same seed → same run. */
export function createRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randomSeed(): number {
  return Math.floor(Math.random() * 0xffffffff) >>> 0;
}

type BattleNodeType = Extract<NodeType, 'skirmish' | 'escape' | 'barn_rescue' | 'elite'>;

export interface ActDef {
  id: SeasonId;
  /** Overrides the battlefield palette (lets an act reuse earlier layouts in its own colours). */
  theme?: BoardTheme;
  /** Illustrated watercolor tabletop board image path in public/ui/. */
  boardArt: string;
  /** Shown in the map header, e.g. "Spring Patch" */
  name: string;
  trailTitle: string;
  trailHint: string;
  mapPools: Record<BattleNodeType, string[]>;
  subtitles: Record<BattleNodeType, string>;
  boss: { mapId: string; name: string; subtitle: string };
  shop: { name: string; subtitle: string };
  vault: { name: string; subtitle: string };
  shrine: { name: string; subtitle: string };
  armory: { name: string; subtitle: string };
  forge: { name: string; subtitle: string };
  lore: { name: string; subtitle: string };
}

export const ACTS: ActDef[] = [
  {
    id: 'spring',
    boardArt: '/ui/board_spring.jpg',
    name: 'Spring Meadow Board',
    trailTitle: 'Spring Meadow Tabletop',
    trailHint: 'Explore 22 winding brook & clover stops, uncover Rebellion Chronicles & Forge weapons toward Captain Scarecrow!',
    mapPools: {
      skirmish: ['cliff_watchtower', 'windmill_causeway', 'creek_crossing', 'duck_pond_meadow', 'canyon_terrace', 'barnyard_siege', 'vegetable_patch'],
      escape: ['patch_breakout', 'harvest_railroad'],
      barn_rescue: ['barn_raid'],
      elite: ['cliff_watchtower', 'tool_shed_ambush', 'molten_furnace'],
    },
    subtitles: {
      skirmish: 'Skirmish / Sabotage — Seize 3-story cliffs, smash Supply Crates & bounce across!',
      escape: 'Breakout / Escort — Reach the Gate or escort the Golden Seed Cart!',
      barn_rescue: 'Barn Rescue — Smash the Burlap Cage to free a bagged ally!',
      elite: 'Elite Fight — High-stakes battle for rare Graft, Alt Weapon & Relic',
    },
    boss: {
      mapId: 'scarecrow_stand',
      name: "Captain Scarecrow's Barn",
      subtitle: 'Act 1 Boss — Topple the towering straw warden!',
    },
    shop: {
      name: "Farmer's Compost Market",
      subtitle: 'Market Space — Spend Run Seeds on Alt Weapons, Grafts, Items & Healing!',
    },
    vault: {
      name: 'Seed Vault Camp',
      subtitle: 'Rest Camp — Heal squad +6 HP, recruit a Hero & grab a Watering Can',
    },
    shrine: {
      name: 'Dewdrop Watering Shrine',
      subtitle: 'Shrine Boon — Choose full squad healing, next-battle Blessing, or +14 Seeds!',
    },
    armory: {
      name: 'Tinker Armory Wagon',
      subtitle: 'Armory Space — Unlock Alternate Weapons & stock tactical supplies!',
    },
    forge: {
      name: 'Sprout Anvil Forge',
      subtitle: 'Weapon Forge — Evolve Primary & Secondary weapons along Tactical or Elemental paths!',
    },
    lore: {
      name: 'Meadow Signpost Chronicle',
      subtitle: 'World Lore — Uncover Rebellion history & claim a Skill Point, Forge Voucher, or Seeds!',
    },
  },
  {
    id: 'summer',
    theme: 'greenhouse',
    boardArt: '/ui/board_summer.jpg',
    name: 'Summer Conservatory Board',
    trailTitle: 'Sunlit Conservatory Tabletop',
    trailHint: 'Chart a grand 22-stop route across arched canal bridges & sunflower loops to Baron Combine’s Glasshouse!',
    mapPools: {
      skirmish: ['botanical_rotunda', 'windmill_causeway', 'cliff_watchtower', 'greenhouse_entry', 'molten_furnace', 'canyon_terrace', 'barnyard_siege'],
      escape: ['irrigation_run', 'harvest_railroad'],
      barn_rescue: ['barn_raid'],
      elite: ['apiary_ambush', 'molten_furnace', 'cliff_watchtower'],
    },
    subtitles: {
      skirmish: 'Skirmish / Sabotage — Use Sunbeams (+3 ATK in Summer!), 3-story Bluffs & Rolling Pumpkins',
      escape: 'Breakout / Escort — Blast Sprinklers or escort the Golden Seed Cart!',
      barn_rescue: 'Barn Rescue — Smash the Burlap Cage to free a bagged ally!',
      elite: 'Elite Fight — Chain-detonate Beehives for rare Graft, Alt Weapon & Relic',
    },
    boss: {
      mapId: 'combine_throne',
      name: "Baron Combine's Glasshouse",
      subtitle: 'Act 2 Boss — Topple the vintage red harvester tractor!',
    },
    shop: {
      name: 'Greenhouse Compost Market',
      subtitle: 'Market Space — Spend Run Seeds on Alt Weapons, Grafts, Items & Healing!',
    },
    vault: {
      name: 'Conservatory Seed Vault',
      subtitle: 'Rest Camp — Heal squad +6 HP, recruit a Hero & grab a Watering Can',
    },
    shrine: {
      name: 'Sunbeam Fountain Shrine',
      subtitle: 'Shrine Boon — Choose full squad healing, next-battle Blessing, or +14 Seeds!',
    },
    armory: {
      name: 'Sunlit Armory Wagon',
      subtitle: 'Armory Space — Unlock Alternate Weapons & stock tactical supplies!',
    },
    forge: {
      name: 'Glasshouse Brass Forge',
      subtitle: 'Weapon Forge — Upgrade Primary & Secondary weapons with discounted Seeds or Vouchers!',
    },
    lore: {
      name: 'Conservatory Ledger Plaque',
      subtitle: 'World Lore — Read Conservatory history & claim a Skill Point, Forge Voucher, or Seeds!',
    },
  },
  {
    id: 'autumn',
    theme: 'autumn',
    boardArt: '/ui/board_autumn.jpg',
    name: 'Autumn Orchard Board',
    trailTitle: 'Autumn Harvest Tabletop',
    trailHint: 'Traverse 22 cider-mill trails, Pumpkin Hollow loops & timber bridges to reach Lord Bramblecoat’s Keep!',
    mapPools: {
      skirmish: ['windmill_causeway', 'cider_mill_yard', 'cliff_watchtower', 'duck_pond_meadow', 'botanical_rotunda', 'canyon_terrace', 'creek_crossing', 'barnyard_siege'],
      escape: ['patch_breakout', 'harvest_railroad', 'irrigation_run'],
      barn_rescue: ['barn_raid'],
      elite: ['cider_mill_yard', 'cliff_watchtower', 'molten_furnace', 'tool_shed_ambush', 'apiary_ambush'],
    },
    subtitles: {
      skirmish: 'Skirmish / Siege — Harvest Gale boosts every Bump by +1 DMG!',
      escape: 'Breakout / Escort — Slip through the gate or escort the Seed Cart!',
      barn_rescue: 'Barn Rescue — Smash the Burlap Cage to free a bagged ally!',
      elite: 'Elite Fight — Harvest veterans guard a Graft, Alt Weapon & Relic',
    },
    boss: {
      mapId: 'orchard_clearing',
      name: "Lord Bramblecoat's Keep",
      subtitle: 'Act 3 Boss — Cut down the crimson harvest warden!',
    },
    shop: {
      name: 'Cider Mill Compost Market',
      subtitle: 'Market Space — Spend Run Seeds on Alt Weapons, Grafts, Items & Healing!',
    },
    vault: {
      name: 'Orchard Seed Vault',
      subtitle: 'Rest Camp — Heal squad +6 HP, recruit a Hero & grab a Watering Can',
    },
    shrine: {
      name: 'Harvest Lantern Shrine',
      subtitle: 'Shrine Boon — Choose full squad healing, next-battle Blessing, or +14 Seeds!',
    },
    armory: {
      name: 'Cider-Barn Armory Wagon',
      subtitle: 'Armory Space — Unlock Alternate Weapons & stock tactical supplies!',
    },
    forge: {
      name: 'Cider-Press Forge',
      subtitle: 'Weapon Forge — Temper Tier II & Masterwork Tier III weapons before Winter!',
    },
    lore: {
      name: 'Orchard Chronicle Cairn',
      subtitle: 'World Lore — Discover Autumn rebellion notes & claim a Skill Point, Voucher, or Seeds!',
    },
  },
  {
    id: 'winter',
    theme: 'winter',
    boardArt: '/ui/board_winter.jpg',
    name: 'Winter Frostbite Board',
    trailTitle: 'Frostbite Hearth Tabletop',
    trailHint: 'Cross 22 snow-cleared lanes, frozen creek bridges & lantern villages to storm Grand Marshal Frostplow’s Citadel!',
    mapPools: {
      skirmish: ['frost_brook_ridge', 'hearth_greenhouse_courtyard', 'cliff_watchtower', 'canyon_terrace', 'windmill_causeway'],
      escape: ['icicle_supply_run', 'harvest_railroad'],
      barn_rescue: ['barn_raid'],
      elite: ['frost_brook_ridge', 'hearth_greenhouse_courtyard', 'molten_furnace'],
    },
    subtitles: {
      skirmish: 'Winter Battle — Knockbacks & Duster Pulls slide +1 extra tile across Glaze Ice!',
      escape: 'Snowpass Convoy — Race the frozen pass or escort the Golden Seed Cart!',
      barn_rescue: 'Frost Barn Rescue — Shatter the cage to free a bundled hero!',
      elite: 'Winter Elite — Chug-Plows & Sleet-Cannons guard rare Masterwork spoils!',
    },
    boss: {
      mapId: 'frostplow_citadel',
      name: 'Hearth Greenhouse Citadel',
      subtitle: 'Final Boss — Topple Grand Marshal Frostplow to liberate the Heirloom Vault!',
    },
    shop: {
      name: 'Hearthfire Winter Market',
      subtitle: 'Market Space — Warm cocoa, Grafts, Alt Weapons & last-chance supplies!',
    },
    vault: {
      name: 'Lantern Lodge Camp',
      subtitle: 'Rest Camp — Warm up (+6 HP), recruit a Hero & grab a Watering Can',
    },
    shrine: {
      name: 'Hot-Spring Lantern Shrine',
      subtitle: 'Shrine Boon — Full squad warm-up heal, next-battle Blessing, or +14 Seeds!',
    },
    armory: {
      name: 'Boiler-Works Armory',
      subtitle: 'Armory Space — Unlock Alternate Weapons & winter satchel gear!',
    },
    forge: {
      name: 'Hearthstone Master Forge',
      subtitle: 'Weapon Forge — Forge Masterwork Tier III weapons for the final Citadel assault!',
    },
    lore: {
      name: 'Frostbridge Chronicle Post',
      subtitle: 'World Lore — Uncover Winter Hearth secrets & claim a Skill Point, Voucher, or Seeds!',
    },
  },
];

export const FLOORS_PER_ACT = 7;
export const MAX_LANES = 4;
/** Board turns available before the Harvest Bell rings and empowers the Act Boss. */
export const HARVEST_BELL_LIMIT = 9;

export function actIndexForSeason(seasonId: SeasonId | undefined): number {
  const idx = ACTS.findIndex((a) => a.id === seasonId);
  return idx >= 0 ? idx : 0;
}

/** Derive an independent, reproducible stream per act from the run seed. */
export function actRng(runSeed: number, actIndex: number): Rng {
  return createRng((runSeed ^ Math.imul(actIndex + 1, 0x9e3779b1)) >>> 0);
}

export function startNodeId(actIndex: number): string {
  return `a${actIndex}start`;
}

export function bossNodeId(actIndex: number): string {
  return `a${actIndex}boss`;
}

interface BoardSpaceBlueprint {
  key: string;
  stage: number;
  lane: number;
  x: number;
  y: number;
  region: string;
  fixedType?: NodeType;
  nextKeys: string[];
  shortcutKeys?: string[];
}

/**
 * Expanded 22-space hand-crafted seasonal boardgame layouts pinned accurately to
 * the painted roads, bridges, scenic loops, and landmarks of all 4 watercolor boards!
 */
const SEASON_BOARD_LAYOUTS: Record<SeasonId, BoardSpaceBlueprint[]> = {
  spring: [
    { key: 'start', stage: 0, lane: 1, x: 0.15, y: 0.84, region: 'Rose Garden Gate', fixedType: 'start', nextKeys: ['s1', 's2'] },
    { key: 's1', stage: 1, lane: 0, x: 0.27, y: 0.75, region: 'Clover Crossroads', fixedType: 'skirmish', nextKeys: ['s3', 's4'], shortcutKeys: ['s2'] },
    { key: 's2', stage: 1, lane: 2, x: 0.38, y: 0.79, region: 'Poppy Meadow Lane', fixedType: 'skirmish', nextKeys: ['s5'], shortcutKeys: ['s4'] },
    { key: 's3', stage: 2, lane: 0, x: 0.24, y: 0.59, region: 'Wildflower Bend', nextKeys: ['s6'] },
    { key: 's4', stage: 2, lane: 1, x: 0.48, y: 0.78, region: 'South Brook Bank', nextKeys: ['s5', 's7'] },
    { key: 's5', stage: 2, lane: 2, x: 0.58, y: 0.70, region: 'South Arch Bridge', nextKeys: ['s8'], shortcutKeys: ['s11'] },
    { key: 's6', stage: 3, lane: 0, x: 0.16, y: 0.44, region: 'West Cobble Curve', nextKeys: ['s9'] },
    { key: 's7', stage: 3, lane: 1, x: 0.67, y: 0.69, region: 'Brookside Meadow', nextKeys: ['s8', 's12'] },
    { key: 's8', stage: 3, lane: 2, x: 0.77, y: 0.69, region: 'Duck Pond Overlook', nextKeys: ['s10'] },
    { key: 's9', stage: 4, lane: 0, x: 0.20, y: 0.30, region: 'West Hilltop Curve', nextKeys: ['s11', 's13'] },
    { key: 's10', stage: 4, lane: 3, x: 0.87, y: 0.60, region: 'East Pond Curve', nextKeys: ['s14'] },
    { key: 's11', stage: 4, lane: 1, x: 0.33, y: 0.26, region: 'Blossom Crest', nextKeys: ['s13'] },
    { key: 's12', stage: 4, lane: 2, x: 0.87, y: 0.49, region: 'East Blossom Bend', nextKeys: ['s14', 's16'] },
    { key: 's13', stage: 5, lane: 1, x: 0.46, y: 0.30, region: 'North Arch Bridge', nextKeys: ['s15'] },
    { key: 's14', stage: 5, lane: 3, x: 0.82, y: 0.41, region: 'Orchard Stone Wall', nextKeys: ['s16', 's18'] },
    { key: 's15', stage: 5, lane: 1, x: 0.56, y: 0.36, region: 'Meadow Cobble Lane', nextKeys: ['s17', 's19'] },
    { key: 's16', stage: 5, lane: 2, x: 0.74, y: 0.38, region: 'East Barn Approach', nextKeys: ['s18', 's20'] },
    { key: 's17', stage: 6, lane: 1, x: 0.62, y: 0.37, region: 'Lower Barn Walk', nextKeys: ['s19'] },
    { key: 's18', stage: 6, lane: 3, x: 0.86, y: 0.30, region: 'Windmill Ridge Trail', nextKeys: ['s20'] },
    { key: 's19', stage: 6, lane: 2, x: 0.66, y: 0.32, region: 'Barn Courtyard Camp', fixedType: 'vault', nextKeys: ['boss'], shortcutKeys: ['s20'] },
    { key: 's20', stage: 6, lane: 3, x: 0.79, y: 0.34, region: 'Windmill Fork Camp', fixedType: 'vault', nextKeys: ['boss'] },
    { key: 'boss', stage: 7, lane: 2, x: 0.72, y: 0.23, region: 'Red Storybook Barn', fixedType: 'boss', nextKeys: [] },
  ],
  summer: [
    { key: 'start', stage: 0, lane: 3, x: 0.90, y: 0.86, region: 'Stone Garden Steps', fixedType: 'start', nextKeys: ['s1', 's2'] },
    { key: 's1', stage: 1, lane: 2, x: 0.76, y: 0.76, region: 'South Fountain Walk', fixedType: 'skirmish', nextKeys: ['s3', 's4'], shortcutKeys: ['s2'] },
    { key: 's2', stage: 1, lane: 3, x: 0.88, y: 0.60, region: 'East Flower Walk', fixedType: 'skirmish', nextKeys: ['s5'], shortcutKeys: ['s4'] },
    { key: 's3', stage: 2, lane: 2, x: 0.64, y: 0.68, region: 'Fountain Lawn Curve', nextKeys: ['s6'] },
    { key: 's4', stage: 2, lane: 2, x: 0.79, y: 0.44, region: 'Central Fountain Arch', nextKeys: ['s7', 's8'] },
    { key: 's5', stage: 2, lane: 3, x: 0.88, y: 0.37, region: 'Rustic Market Awning', nextKeys: ['s8'] },
    { key: 's6', stage: 3, lane: 1, x: 0.59, y: 0.53, region: 'West Fountain Lawn', nextKeys: ['s9', 's10'] },
    { key: 's7', stage: 3, lane: 2, x: 0.62, y: 0.39, region: 'Canal Terrace', nextKeys: ['s10', 's11'] },
    { key: 's8', stage: 3, lane: 3, x: 0.75, y: 0.24, region: 'North Fountain Curve', nextKeys: ['s11'] },
    { key: 's9', stage: 4, lane: 1, x: 0.49, y: 0.53, region: 'South Brick Bridge', nextKeys: ['s12', 's13'] },
    { key: 's10', stage: 4, lane: 1, x: 0.52, y: 0.31, region: 'North Brick Bridge', nextKeys: ['s14'] },
    { key: 's11', stage: 4, lane: 2, x: 0.63, y: 0.26, region: 'Upper Canal Turn', nextKeys: ['s10'] },
    { key: 's12', stage: 5, lane: 1, x: 0.40, y: 0.69, region: 'South Veggie Path', nextKeys: ['s15'] },
    { key: 's13', stage: 5, lane: 1, x: 0.36, y: 0.46, region: 'Raised Bed Plaza', nextKeys: ['s16', 's19'] },
    { key: 's14', stage: 5, lane: 1, x: 0.40, y: 0.29, region: 'Cypress Garden Bend', nextKeys: ['s17', 's20'] },
    { key: 's15', stage: 5, lane: 0, x: 0.25, y: 0.83, region: 'Melon Trellis Curve', nextKeys: ['s18'] },
    { key: 's16', stage: 6, lane: 0, x: 0.24, y: 0.59, region: 'Inner Veggie Cross', nextKeys: ['s19'] },
    { key: 's17', stage: 6, lane: 1, x: 0.32, y: 0.34, region: 'Glasshouse Hedge Walk', nextKeys: ['s20'] },
    { key: 's18', stage: 6, lane: 0, x: 0.13, y: 0.72, region: 'Trellis South Curve', nextKeys: ['s19'] },
    { key: 's19', stage: 6, lane: 0, x: 0.12, y: 0.52, region: 'West Tomato Camp', fixedType: 'vault', nextKeys: ['boss'], shortcutKeys: ['s20'] },
    { key: 's20', stage: 6, lane: 0, x: 0.24, y: 0.36, region: 'Conservatory Forecourt', fixedType: 'vault', nextKeys: ['boss'] },
    { key: 'boss', stage: 7, lane: 0, x: 0.18, y: 0.22, region: 'Grand Glasshouse Dome', fixedType: 'boss', nextKeys: [] },
  ],
  autumn: [
    { key: 'start', stage: 0, lane: 1, x: 0.42, y: 0.87, region: 'South Valley Trail', fixedType: 'start', nextKeys: ['s1', 's2'] },
    { key: 's1', stage: 1, lane: 0, x: 0.33, y: 0.74, region: 'Cider Mill Footbridge', fixedType: 'skirmish', nextKeys: ['s3', 's4'] },
    { key: 's2', stage: 1, lane: 2, x: 0.56, y: 0.78, region: 'Apple Orchard Fork', fixedType: 'skirmish', nextKeys: ['s5', 's6'] },
    { key: 's3', stage: 2, lane: 0, x: 0.18, y: 0.81, region: 'South Pumpkin Curve', nextKeys: ['s7'] },
    { key: 's4', stage: 2, lane: 0, x: 0.21, y: 0.58, region: 'Mill Creek Road', nextKeys: ['s8'] },
    { key: 's5', stage: 2, lane: 2, x: 0.65, y: 0.61, region: 'South Orchard Lane', nextKeys: ['s9'] },
    { key: 's6', stage: 2, lane: 3, x: 0.74, y: 0.90, region: 'South Apple Trees', nextKeys: ['s10'] },
    { key: 's7', stage: 3, lane: 0, x: 0.08, y: 0.65, region: 'West Maple Bend', nextKeys: ['s11'] },
    { key: 's8', stage: 3, lane: 1, x: 0.27, y: 0.43, region: 'Cider Mill Overlook', nextKeys: ['s12'] },
    { key: 's9', stage: 3, lane: 2, x: 0.61, y: 0.49, region: 'Center Creek Bridge', nextKeys: ['s13', 's14'] },
    { key: 's10', stage: 3, lane: 3, x: 0.89, y: 0.77, region: 'East Orchard Rim', nextKeys: ['s15'] },
    { key: 's11', stage: 4, lane: 0, x: 0.10, y: 0.38, region: 'Pumpkin Hollow West', nextKeys: ['s16'] },
    { key: 's12', stage: 4, lane: 1, x: 0.37, y: 0.35, region: 'Pumpkin Meadow Lane', nextKeys: ['s17', 's19'] },
    { key: 's13', stage: 4, lane: 2, x: 0.55, y: 0.37, region: 'Barn Meadow Plaza', nextKeys: ['s19', 's20'] },
    { key: 's14', stage: 4, lane: 2, x: 0.66, y: 0.29, region: 'Upper Brook Bend', nextKeys: ['s20'] },
    { key: 's15', stage: 4, lane: 3, x: 0.87, y: 0.56, region: 'East Haystack Road', nextKeys: ['s18'] },
    { key: 's16', stage: 5, lane: 0, x: 0.16, y: 0.20, region: 'North-West Pumpkin Rim', nextKeys: ['s17'] },
    { key: 's17', stage: 5, lane: 0, x: 0.31, y: 0.22, region: 'North Gourd Curve', nextKeys: ['s19'] },
    { key: 's18', stage: 5, lane: 3, x: 0.91, y: 0.28, region: 'Upper Creek Footbridge', nextKeys: ['s20'] },
    { key: 's19', stage: 6, lane: 1, x: 0.43, y: 0.29, region: 'Keep West Camp', fixedType: 'vault', nextKeys: ['boss'], shortcutKeys: ['s20'] },
    { key: 's20', stage: 6, lane: 2, x: 0.74, y: 0.18, region: 'North Maple Camp', fixedType: 'vault', nextKeys: ['boss'] },
    { key: 'boss', stage: 7, lane: 1, x: 0.50, y: 0.20, region: 'Harvest Barn Keep', fixedType: 'boss', nextKeys: [] },
  ],
  winter: [
    { key: 'start', stage: 0, lane: 1, x: 0.42, y: 0.87, region: 'Snowy Valley Entry', fixedType: 'start', nextKeys: ['s1', 's2'] },
    { key: 's1', stage: 1, lane: 0, x: 0.33, y: 0.74, region: 'Frostbridge Crossing', fixedType: 'skirmish', nextKeys: ['s3', 's4'] },
    { key: 's2', stage: 1, lane: 2, x: 0.56, y: 0.78, region: 'Woodpile Fork', fixedType: 'skirmish', nextKeys: ['s5', 's6'] },
    { key: 's3', stage: 2, lane: 0, x: 0.18, y: 0.80, region: 'Frosted Gourd Curve', nextKeys: ['s7'] },
    { key: 's4', stage: 2, lane: 0, x: 0.21, y: 0.57, region: 'Icicle Barn Road', nextKeys: ['s8'] },
    { key: 's5', stage: 2, lane: 2, x: 0.65, y: 0.61, region: 'Lantern Cottage Walk', nextKeys: ['s9'] },
    { key: 's6', stage: 2, lane: 3, x: 0.75, y: 0.90, region: 'Lower Hearth Lane', nextKeys: ['s10'] },
    { key: 's7', stage: 3, lane: 0, x: 0.08, y: 0.64, region: 'West Pine Bend', nextKeys: ['s11'] },
    { key: 's8', stage: 3, lane: 1, x: 0.27, y: 0.43, region: 'Root Cellar Ridge', nextKeys: ['s12'] },
    { key: 's9', stage: 3, lane: 2, x: 0.61, y: 0.50, region: 'Frozen Brook Bridge', nextKeys: ['s13', 's14'] },
    { key: 's10', stage: 3, lane: 3, x: 0.89, y: 0.76, region: 'South Cottage Bend', nextKeys: ['s15'] },
    { key: 's11', stage: 4, lane: 0, x: 0.11, y: 0.38, region: 'Turnip Drift Trail', nextKeys: ['s16'] },
    { key: 's12', stage: 4, lane: 1, x: 0.37, y: 0.35, region: 'Snowdrift Meadow', nextKeys: ['s17', 's19'] },
    { key: 's13', stage: 4, lane: 2, x: 0.56, y: 0.37, region: 'Steam Cobble Plaza', nextKeys: ['s19', 's20'] },
    { key: 's14', stage: 4, lane: 2, x: 0.68, y: 0.28, region: 'Upper Frost Curve', nextKeys: ['s20'] },
    { key: 's15', stage: 4, lane: 3, x: 0.87, y: 0.54, region: 'Upper Lantern Cottage', nextKeys: ['s18'] },
    { key: 's16', stage: 5, lane: 0, x: 0.16, y: 0.20, region: 'North Pine Rim', nextKeys: ['s17'] },
    { key: 's17', stage: 5, lane: 0, x: 0.31, y: 0.22, region: 'Frost Turnip Crest', nextKeys: ['s19'] },
    { key: 's18', stage: 5, lane: 3, x: 0.91, y: 0.28, region: 'East Ice Footbridge', nextKeys: ['s20'] },
    { key: 's19', stage: 6, lane: 1, x: 0.44, y: 0.28, region: 'West Hearth Camp', fixedType: 'vault', nextKeys: ['boss'], shortcutKeys: ['s20'] },
    { key: 's20', stage: 6, lane: 2, x: 0.75, y: 0.18, region: 'Pine Ridge Camp', fixedType: 'vault', nextKeys: ['boss'] },
    { key: 'boss', stage: 7, lane: 1, x: 0.52, y: 0.19, region: 'Hearth Greenhouse Citadel', fixedType: 'boss', nextKeys: [] },
  ],
};

function pick<T>(rng: Rng, items: readonly T[]): T {
  return items[Math.floor(rng() * items.length)];
}

function shuffleWithRng<T>(items: T[], rng: Rng): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function spaceNodeId(actIndex: number, key: string): string {
  if (key === 'start') return startNodeId(actIndex);
  if (key === 'boss') return bossNodeId(actIndex);
  return `a${actIndex}_${key}`;
}

function describeNode(act: ActDef, type: NodeType, rng: Rng, region: string): Pick<SeasonNode, 'name' | 'subtitle' | 'mapId'> {
  if (type === 'start') {
    return {
      name: region,
      subtitle: 'Starting Gate — Play a Travel Card to march onto the board!',
    };
  }
  if (type === 'shop') return { name: act.shop.name, subtitle: act.shop.subtitle };
  if (type === 'vault') return { name: act.vault.name, subtitle: act.vault.subtitle };
  if (type === 'shrine') return { name: act.shrine.name, subtitle: act.shrine.subtitle };
  if (type === 'armory') return { name: act.armory.name, subtitle: act.armory.subtitle };
  if (type === 'forge') return { name: act.forge.name, subtitle: act.forge.subtitle };
  if (type === 'lore') return { name: act.lore.name, subtitle: act.lore.subtitle };
  if (type === 'event') return { name: 'Clover Crossroads', subtitle: 'Mystery Event — A strange find, a storybook choice!' };
  if (type === 'boss') return { name: act.boss.name, subtitle: act.boss.subtitle, mapId: act.boss.mapId };
  const battleType = type as BattleNodeType;
  return {
    name: '',
    subtitle: act.subtitles[battleType],
    mapId: pick(rng, act.mapPools[battleType]),
  };
}

/**
 * Generates the expanded 22-space seasonal tabletop boardgame graph for one Act.
 * Guarantees Market, Watering Shrine, Armory, Tinker Forge, 2 Lore Monuments,
 * 2 Elites, Barn Rescue, Convoy Escape, Clover Events, Rest Vaults & Act Boss!
 */
export function generateActNodes(
  actIndex: number,
  rng: Rng,
  mapName: (mapId: string) => string = (id) => id
): SeasonNode[] {
  const act = ACTS[actIndex] ?? ACTS[0];
  const layout = SEASON_BOARD_LAYOUTS[act.id] ?? SEASON_BOARD_LAYOUTS.spring;

  // Assign dynamic encounter types to the 16 middle spaces (stages 2..6) deterministically from seed!
  const dynamicSpaces = layout.filter((s) => !s.fixedType);
  const guaranteedBag: NodeType[] = [
    'shop',
    'shrine',
    'armory',
    'forge',
    'lore',
    'lore',
    'elite',
    'elite',
    'escape',
    'barn_rescue',
    'event',
    'event',
    'skirmish',
    'skirmish',
    'skirmish',
    'shop',
  ];
  const shuffledBag = shuffleWithRng(guaranteedBag, rng);
  const assigned = new Map<string, NodeType>();
  dynamicSpaces.forEach((sp, idx) => {
    assigned.set(sp.key, shuffledBag[idx % shuffledBag.length]);
  });

  // Push any stage-2 elite forward to stage 3+ so early board spaces feel fair!
  for (const sp of dynamicSpaces) {
    if (sp.stage === 2 && assigned.get(sp.key) === 'elite') {
      const swapTarget = dynamicSpaces.find(
        (other) => other.stage >= 3 && assigned.get(other.key) !== 'elite'
      );
      if (swapTarget) {
        const prev = assigned.get(swapTarget.key)!;
        assigned.set(swapTarget.key, 'elite');
        assigned.set(sp.key, prev);
      }
    }
  }

  return layout.map((sp) => {
    const type: NodeType = sp.fixedType ?? assigned.get(sp.key) ?? 'skirmish';
    const info = describeNode(act, type, rng, sp.region);
    return {
      id: spaceNodeId(actIndex, sp.key),
      stage: sp.stage,
      lane: sp.lane,
      boardX: sp.x,
      boardY: sp.y,
      region: sp.region,
      type,
      name: info.mapId && !info.name ? mapName(info.mapId) : info.name,
      subtitle: info.subtitle,
      mapId: info.mapId,
      nextIds: sp.nextKeys.map((k) => spaceNodeId(actIndex, k)),
      shortcutIds: sp.shortcutKeys?.map((k) => spaceNodeId(actIndex, k)),
      completed: type === 'start',
    };
  });
}

// ===== Watercolor Tabletop Travel Hand Cards =====

const TRAVEL_CARD_TEMPLATES: Omit<BoardTravelCard, 'id'>[] = [
  {
    name: 'Meadow Stroll',
    steps: 1,
    bonus: 'heal2',
    icon: '🥾',
    desc: 'Advance 1 space · Squad heals +2 HP',
    tint: 'mint',
  },
  {
    name: "Forager's Detour",
    steps: 1,
    bonus: 'item',
    icon: '🧺',
    desc: 'Advance 1 space · Forage a free Bag Item!',
    tint: 'plum',
  },
  {
    name: 'Garden Trot',
    steps: 2,
    bonus: 'seeds3',
    icon: '🐾',
    desc: 'Advance 2 spaces · Gather +3 Run Seeds',
    tint: 'gold',
  },
  {
    name: 'Orchard Guard',
    steps: 2,
    bonus: 'shield',
    icon: '🛡️',
    desc: 'Advance 2 spaces · Start next fight Shielded!',
    tint: 'mint',
  },
  {
    name: 'Burrow Shortcut',
    steps: 2,
    flexible: true,
    bonus: 'flex',
    icon: '🕳️',
    desc: 'Hop 1 or 2 spaces along any branch!',
    tint: 'plum',
  },
  {
    name: 'Windmill Gust',
    steps: 2,
    flexible: true,
    bonus: 'seeds3',
    icon: '🌾',
    desc: 'Glide 1–2 spaces with the breeze · +3 Seeds',
    tint: 'gold',
  },
  {
    name: 'Harvest Sprint',
    steps: 3,
    bonus: 'boost',
    icon: '💨',
    desc: 'Advance 3 spaces · Start next fight Boosted!',
    tint: 'crimson',
  },
  {
    name: 'Hayride Express',
    steps: 3,
    flexible: true,
    bonus: 'move1',
    icon: '🚜',
    desc: 'Ride 1–3 spaces · +1 Move in next fight!',
    tint: 'gold',
  },
];

let travelCardUid = 1;

/**
 * Draws a crisp 3-card Travel Hand for the boardgame overworld.
 * Slot 1 is ALWAYS a 1-step card (Stroll or Forager's Detour) so players can always stop
 * at adjacent Markets, Shrines, or the Act Boss!
 */
export function drawTravelHand(rng: Rng = Math.random): BoardTravelCard[] {
  const step1Pool = [TRAVEL_CARD_TEMPLATES[0], TRAVEL_CARD_TEMPLATES[1]];
  const step2Pool = [
    TRAVEL_CARD_TEMPLATES[2],
    TRAVEL_CARD_TEMPLATES[3],
    TRAVEL_CARD_TEMPLATES[4],
    TRAVEL_CARD_TEMPLATES[5],
  ];
  const step3Pool = [TRAVEL_CARD_TEMPLATES[6], TRAVEL_CARD_TEMPLATES[7], TRAVEL_CARD_TEMPLATES[2]];

  const card1 = rng() < 0.72 ? step1Pool[0] : step1Pool[1];
  const card2 = pick(rng, step2Pool);
  let card3 = pick(rng, step3Pool);
  if (card3.name === card2.name) {
    card3 = TRAVEL_CARD_TEMPLATES[6];
  }

  return [card1, card2, card3].map((tpl) => ({
    ...tpl,
    id: `tcard_${travelCardUid++}_${Math.floor(rng() * 1e5)}`,
  }));
}

/**
 * Computes every reachable board space from `fromNodeId` using a given Travel Card,
 * returning a Map of `destinationNodeId -> step-by-step path [fromId, ..., destId]`.
 *
 * Rules:
 * - Follows directed road edges (`nextIds` + `shortcutIds`).
 * - Stops early if a path reaches the Act Boss (you can never overshoot the Boss!).
 * - Flexible cards (`Burrow Shortcut`) allow stopping at any step from `1..card.steps`.
 * - If no forward path has length `card.steps` (e.g. near the Boss), includes the Boss cleanly.
 */
export function getReachableBoardTargets(
  nodes: SeasonNode[],
  fromNodeId: string | null,
  card: BoardTravelCard
): Map<string, string[]> {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const startNode =
    (fromNodeId ? byId.get(fromNodeId) : undefined) ??
    nodes.find((n) => n.type === 'start') ??
    nodes[0];

  const results = new Map<string, string[]>();
  if (!startNode) return results;

  const bossNode = nodes.find((n) => n.type === 'boss');
  const maxSteps = Math.max(1, card.steps);

  const dfs = (cur: SeasonNode, path: string[], stepsTaken: number) => {
    if (stepsTaken > 0) {
      const isBoss = cur.type === 'boss';
      if (isBoss || stepsTaken === maxSteps || (card.flexible && stepsTaken <= maxSteps)) {
        const existing = results.get(cur.id);
        if (!existing || path.length < existing.length) {
          results.set(cur.id, [...path]);
        }
        if (isBoss || stepsTaken === maxSteps) return;
      }
    }
    if (stepsTaken >= maxSteps) return;

    const outgoing = [...cur.nextIds, ...(cur.shortcutIds ?? [])];
    for (const nextId of outgoing) {
      if (path.includes(nextId)) continue;
      const nextNode = byId.get(nextId);
      if (!nextNode) continue;
      dfs(nextNode, [...path, nextId], stepsTaken + 1);
    }
  };

  dfs(startNode, [startNode.id], 0);

  // Safety guarantee: if standing adjacent to Boss or dead-end, never leave player stranded!
  if (results.size === 0 && bossNode && startNode.id !== bossNode.id) {
    results.set(bossNode.id, [startNode.id, bossNode.id]);
  }
  return results;
}
