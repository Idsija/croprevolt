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
}

export const ACTS: ActDef[] = [
  {
    id: 'spring',
    boardArt: '/ui/board_spring.jpg',
    name: 'Spring Meadow Board',
    trailTitle: 'Spring Meadow Tabletop',
    trailHint: 'Play a Travel Card to march along the brook, clover hills & orchard toward Captain Scarecrow.',
    mapPools: {
      skirmish: ['creek_crossing', 'canyon_terrace', 'barnyard_siege', 'vegetable_patch'],
      escape: ['patch_breakout', 'harvest_railroad'],
      barn_rescue: ['barn_raid'],
      elite: ['tool_shed_ambush', 'molten_furnace'],
    },
    subtitles: {
      skirmish: 'Skirmish / Siege — Seize high ground, bounce pads & hold the patch!',
      escape: 'Breakout / Escort — Reach the Gate or escort the Golden Seed Cart!',
      barn_rescue: 'Barn Rescue — Smash the Burlap Cage to free a bagged ally!',
      elite: 'Elite Fight — High-stakes battle for rare Graft, Alt Weapon & Relic',
    },
    boss: {
      mapId: 'scarecrow_stand',
      name: "Captain Scarecrow's Barn",
      subtitle: 'Spring Boss — Topple the towering straw warden!',
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
  },
  {
    id: 'summer',
    boardArt: '/ui/board_summer.jpg',
    name: 'Summer Conservatory Board',
    trailTitle: 'Sunlit Conservatory Tabletop',
    trailHint: 'Chart a route across arched canal bridges & sunflower loops to Baron Combine’s Glasshouse.',
    mapPools: {
      skirmish: ['greenhouse_entry', 'molten_furnace', 'canyon_terrace', 'barnyard_siege'],
      escape: ['irrigation_run', 'harvest_railroad'],
      barn_rescue: ['barn_raid'],
      elite: ['apiary_ambush', 'molten_furnace'],
    },
    subtitles: {
      skirmish: 'Skirmish / Siege — Use Sunbeams (+2 ATK), Catwalks & Rolling Pumpkins',
      escape: 'Breakout / Escort — Blast Sprinklers or escort the Golden Seed Cart!',
      barn_rescue: 'Barn Rescue — Smash the Burlap Cage to free a bagged ally!',
      elite: 'Elite Fight — Chain-detonate Beehives for rare Graft, Alt Weapon & Relic',
    },
    boss: {
      mapId: 'combine_throne',
      name: "Baron Combine's Glasshouse",
      subtitle: 'Summer Boss — Topple the vintage red harvester tractor!',
    },
    shop: {
      name: "Greenhouse Compost Market",
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
  },
  {
    id: 'autumn',
    theme: 'autumn',
    boardArt: '/ui/board_autumn.jpg',
    name: 'Autumn Orchard Board',
    trailTitle: 'Autumn Harvest Tabletop',
    trailHint: 'Traverse Pumpkin Hollow, mossy walls & timber bridges to reach Lord Bramblecoat’s Keep.',
    mapPools: {
      skirmish: ['canyon_terrace', 'creek_crossing', 'barnyard_siege', 'greenhouse_entry', 'vegetable_patch'],
      escape: ['patch_breakout', 'harvest_railroad', 'irrigation_run'],
      barn_rescue: ['barn_raid'],
      elite: ['molten_furnace', 'tool_shed_ambush', 'apiary_ambush'],
    },
    subtitles: {
      skirmish: 'Skirmish / Siege — Clear the harvest crew or hold the orchard patch!',
      escape: 'Breakout / Escort — Slip through the gate or escort the Seed Cart!',
      barn_rescue: 'Barn Rescue — Smash the Burlap Cage to free a bagged ally!',
      elite: 'Elite Fight — The harvest veterans guard a Graft, Alt Weapon & Relic',
    },
    boss: {
      mapId: 'orchard_clearing',
      name: "Lord Bramblecoat's Keep",
      subtitle: 'Autumn Boss — Cut down the crimson harvest warden!',
    },
    shop: {
      name: "Cider Mill Compost Market",
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
  },
];

export const FLOORS_PER_ACT = 6;
export const MAX_LANES = 4;
/** Board turns available before the Harvest Bell rings and empowers the Act Boss. */
export const HARVEST_BELL_LIMIT = 7;

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
 * Hand-crafted seasonal boardgame layouts pinned to the actual painted roads,
 * bridges, loops, and landmarks of board_spring.jpg, board_summer.jpg, and board_autumn.jpg!
 */
const SEASON_BOARD_LAYOUTS: Record<SeasonId, BoardSpaceBlueprint[]> = {
  spring: [
    { key: 'start', stage: 0, lane: 1, x: 0.12, y: 0.85, region: 'Rose Garden Gate', fixedType: 'start', nextKeys: ['s1', 's2'] },
    { key: 's1', stage: 1, lane: 0, x: 0.26, y: 0.63, region: 'Wildflower Bend', fixedType: 'skirmish', nextKeys: ['s3'], shortcutKeys: ['s2'] },
    { key: 's2', stage: 1, lane: 2, x: 0.36, y: 0.79, region: 'Poppy Meadow Lane', fixedType: 'skirmish', nextKeys: ['s4'] },
    { key: 's3', stage: 2, lane: 0, x: 0.17, y: 0.45, region: 'West Cobble Curve', nextKeys: ['s6'] },
    { key: 's4', stage: 2, lane: 1, x: 0.48, y: 0.78, region: 'South Brook Bank', nextKeys: ['s5'] },
    { key: 's5', stage: 2, lane: 2, x: 0.58, y: 0.70, region: 'South Arch Bridge', nextKeys: ['s8'], shortcutKeys: ['s11'] },
    { key: 's6', stage: 3, lane: 0, x: 0.20, y: 0.30, region: 'West Hilltop Curve', nextKeys: ['s7'] },
    { key: 's7', stage: 3, lane: 1, x: 0.34, y: 0.27, region: 'Blossom Crest', nextKeys: ['s10'] },
    { key: 's8', stage: 3, lane: 2, x: 0.74, y: 0.70, region: 'Duck Pond Overlook', nextKeys: ['s9'] },
    { key: 's9', stage: 3, lane: 3, x: 0.87, y: 0.59, region: 'East Pond Curve', nextKeys: ['s12'] },
    { key: 's10', stage: 4, lane: 1, x: 0.46, y: 0.30, region: 'North Arch Bridge', nextKeys: ['s11'] },
    { key: 's11', stage: 4, lane: 2, x: 0.57, y: 0.36, region: 'Meadow Cobble Lane', nextKeys: ['s13'] },
    { key: 's12', stage: 4, lane: 3, x: 0.87, y: 0.47, region: 'East Blossom Bend', nextKeys: ['s14'] },
    { key: 's13', stage: 5, lane: 2, x: 0.65, y: 0.37, region: 'Barn Courtyard', fixedType: 'vault', nextKeys: ['boss'] },
    { key: 's14', stage: 5, lane: 3, x: 0.78, y: 0.38, region: 'Windmill Fork', fixedType: 'vault', nextKeys: ['boss'], shortcutKeys: ['s13'] },
    { key: 'boss', stage: 6, lane: 2, x: 0.72, y: 0.25, region: 'Red Storybook Barn', fixedType: 'boss', nextKeys: [] },
  ],
  summer: [
    { key: 'start', stage: 0, lane: 3, x: 0.90, y: 0.85, region: 'Stone Garden Steps', fixedType: 'start', nextKeys: ['s1', 's2'] },
    { key: 's1', stage: 1, lane: 2, x: 0.71, y: 0.74, region: 'South Fountain Walk', fixedType: 'skirmish', nextKeys: ['s3'], shortcutKeys: ['s2'] },
    { key: 's2', stage: 1, lane: 3, x: 0.89, y: 0.55, region: 'East Flower Walk', fixedType: 'skirmish', nextKeys: ['s4'], shortcutKeys: ['s8'] },
    { key: 's3', stage: 2, lane: 2, x: 0.60, y: 0.58, region: 'West Fountain Lawn', nextKeys: ['s6'], shortcutKeys: ['s8'] },
    { key: 's4', stage: 2, lane: 3, x: 0.86, y: 0.32, region: 'Rustic Market Awning', nextKeys: ['s5'] },
    { key: 's5', stage: 2, lane: 2, x: 0.71, y: 0.24, region: 'North Fountain Curve', nextKeys: ['s7'] },
    { key: 's6', stage: 3, lane: 1, x: 0.49, y: 0.52, region: 'South Brick Bridge', nextKeys: ['s9', 's10'] },
    { key: 's7', stage: 3, lane: 1, x: 0.52, y: 0.31, region: 'North Brick Bridge', nextKeys: ['s11'] },
    { key: 's8', stage: 3, lane: 2, x: 0.61, y: 0.39, region: 'Canal Terrace', nextKeys: ['s6', 's7'] },
    { key: 's9', stage: 3, lane: 1, x: 0.38, y: 0.73, region: 'South Veggie Path', nextKeys: ['s12'] },
    { key: 's10', stage: 4, lane: 1, x: 0.35, y: 0.45, region: 'Raised Bed Plaza', nextKeys: ['s13', 's14'] },
    { key: 's11', stage: 4, lane: 1, x: 0.38, y: 0.30, region: 'Cypress Garden Bend', nextKeys: ['s14'] },
    { key: 's12', stage: 4, lane: 0, x: 0.14, y: 0.78, region: 'Trellis South Curve', nextKeys: ['s13'] },
    { key: 's13', stage: 5, lane: 0, x: 0.12, y: 0.56, region: 'West Tomato Walk', fixedType: 'vault', nextKeys: ['boss'] },
    { key: 's14', stage: 5, lane: 0, x: 0.26, y: 0.37, region: 'Conservatory Forecourt', fixedType: 'vault', nextKeys: ['boss'] },
    { key: 'boss', stage: 6, lane: 0, x: 0.19, y: 0.25, region: 'Grand Glasshouse Dome', fixedType: 'boss', nextKeys: [] },
  ],
  autumn: [
    { key: 'start', stage: 0, lane: 1, x: 0.43, y: 0.85, region: 'South Valley Trail', fixedType: 'start', nextKeys: ['s1', 's2'] },
    { key: 's1', stage: 1, lane: 0, x: 0.33, y: 0.75, region: 'Cider Mill Footbridge', fixedType: 'skirmish', nextKeys: ['s3', 's4'] },
    { key: 's2', stage: 1, lane: 2, x: 0.56, y: 0.77, region: 'Apple Orchard Fork', fixedType: 'skirmish', nextKeys: ['s5', 's8'] },
    { key: 's3', stage: 2, lane: 0, x: 0.13, y: 0.79, region: 'South Pumpkin Curve', nextKeys: ['s6'] },
    { key: 's4', stage: 2, lane: 0, x: 0.21, y: 0.54, region: 'Mill Creek Road', nextKeys: ['s7'] },
    { key: 's5', stage: 2, lane: 2, x: 0.62, y: 0.50, region: 'Center Creek Bridge', nextKeys: ['s9'] },
    { key: 's6', stage: 3, lane: 0, x: 0.09, y: 0.58, region: 'West Maple Bend', nextKeys: ['s10'] },
    { key: 's7', stage: 3, lane: 1, x: 0.33, y: 0.37, region: 'Pumpkin Meadow Lane', nextKeys: ['s13'] },
    { key: 's8', stage: 3, lane: 3, x: 0.76, y: 0.90, region: 'South Apple Trees', nextKeys: ['s11'] },
    { key: 's9', stage: 3, lane: 2, x: 0.58, y: 0.34, region: 'Barn Meadow Plaza', nextKeys: ['s13', 's14'] },
    { key: 's10', stage: 4, lane: 0, x: 0.15, y: 0.21, region: 'North-West Pumpkin Rim', nextKeys: ['s13'] },
    { key: 's11', stage: 4, lane: 3, x: 0.88, y: 0.62, region: 'East Haystack Road', nextKeys: ['s12'] },
    { key: 's12', stage: 4, lane: 3, x: 0.91, y: 0.26, region: 'Upper Creek Footbridge', nextKeys: ['s14'] },
    { key: 's13', stage: 5, lane: 1, x: 0.43, y: 0.30, region: 'Keep West Approach', fixedType: 'vault', nextKeys: ['boss'] },
    { key: 's14', stage: 5, lane: 2, x: 0.72, y: 0.18, region: 'North Maple Overlook', fixedType: 'vault', nextKeys: ['boss'] },
    { key: 'boss', stage: 6, lane: 1, x: 0.50, y: 0.21, region: 'Harvest Barn Keep', fixedType: 'boss', nextKeys: [] },
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
 * Generates the 16-space seasonal tabletop boardgame graph for one Act.
 * Guarantees a Market, Watering Shrine, Armory Wagon, Elite, Rest Vaults, and Act Boss!
 */
export function generateActNodes(
  actIndex: number,
  rng: Rng,
  mapName: (mapId: string) => string = (id) => id
): SeasonNode[] {
  const act = ACTS[actIndex] ?? ACTS[0];
  const layout = SEASON_BOARD_LAYOUTS[act.id] ?? SEASON_BOARD_LAYOUTS.spring;

  // Assign dynamic encounter types to the 10 middle spaces (stages 2..4) deterministically from seed!
  const dynamicSpaces = layout.filter((s) => !s.fixedType);
  const guaranteedBag: NodeType[] = [
    'shop',
    'shrine',
    'armory',
    'elite',
    'elite',
    'escape',
    'barn_rescue',
    'event',
    'event',
    'skirmish',
  ];
  const shuffledBag = shuffleWithRng(guaranteedBag, rng);
  // Ensure an Elite doesn't sit on stage 2 if possible by swapping with stage 3/4
  const assigned = new Map<string, NodeType>();
  dynamicSpaces.forEach((sp, idx) => {
    assigned.set(sp.key, shuffledBag[idx % shuffledBag.length]);
  });

  // Push any stage-2 elite forward to stage 3/4 so early board spaces feel fair!
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
    name: 'Garden Trot',
    steps: 2,
    bonus: 'seeds3',
    icon: '🐾',
    desc: 'Advance 2 spaces · Gather +3 Run Seeds',
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
    name: 'Burrow Shortcut',
    steps: 2,
    flexible: true,
    bonus: 'flex',
    icon: '🕳️',
    desc: 'Hop 1 or 2 spaces along any branch!',
    tint: 'plum',
  },
];

let travelCardUid = 1;

/**
 * Draws a crisp 3-card Travel Hand for the boardgame overworld.
 * Always includes a 1-step Stroll so players can ALWAYS stop at adjacent Markets, Shrines, or the Boss!
 */
export function drawTravelHand(rng: Rng = Math.random): BoardTravelCard[] {
  const stroll = TRAVEL_CARD_TEMPLATES[0];
  const trot = TRAVEL_CARD_TEMPLATES[1];
  const sprint = TRAVEL_CARD_TEMPLATES[2];
  const burrow = TRAVEL_CARD_TEMPLATES[3];

  const card2 = rng() < 0.45 ? burrow : trot;
  const card3 = rng() < 0.7 ? sprint : trot;

  return [stroll, card2, card3].map((tpl) => ({
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
