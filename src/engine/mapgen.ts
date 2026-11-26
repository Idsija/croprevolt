import type { BoardTheme, NodeType, SeasonId, SeasonNode } from './types';

/**
 * Procedural run map generation (Slay the Spire style).
 *
 * A run is a sequence of acts. Each act is a grid of FLOORS rows × MAX_LANES columns.
 * A handful of paths are walked from the first floor to the last, each step moving at most
 * one column sideways and never crossing an earlier path. Every visited cell becomes a node,
 * so every node is reachable and has a way forward. The last floor always connects to the
 * act's fixed boss.
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
  /** Shown in the map header, e.g. "Act 1 · Spring Patch" */
  name: string;
  trailTitle: string;
  trailHint: string;
  mapPools: Record<BattleNodeType, string[]>;
  subtitles: Record<BattleNodeType, string>;
  boss: { mapId: string; name: string; subtitle: string };
  shop: { name: string; subtitle: string };
  vault: { name: string; subtitle: string };
}

export const ACTS: ActDef[] = [
  {
    id: 'spring',
    name: 'Spring Patch',
    trailTitle: 'Garden Trail Map',
    trailHint: 'Pick a path. Captain Scarecrow waits at the end of the trail.',
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
      name: "Captain Scarecrow's Stand",
      subtitle: 'Spring Boss — Topple the towering straw warden!',
    },
    shop: {
      name: "Farmer's Compost Market",
      subtitle: 'Safe Market — Spend run Seeds on Alt Weapons, Grafts, Items & Healing!',
    },
    vault: {
      name: 'Seed Vault & Compost',
      subtitle: 'Safe Stop — Heal squad +6 HP, recruit a Hero & grab a Watering Can',
    },
  },
  {
    id: 'summer',
    name: 'Summer Greenhouse',
    trailTitle: 'Summer Greenhouse Trail',
    trailHint: 'Pick a path. Baron Combine waits in the Conservatory.',
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
      name: "Baron Combine's Conservatory",
      subtitle: 'Summer Boss — Topple the vintage red harvester tractor!',
    },
    shop: {
      name: "Farmer's Compost Market",
      subtitle: 'Safe Market — Spend run Seeds on Alt Weapons, Grafts, Items & Healing!',
    },
    vault: {
      name: 'Seed Vault & Compost',
      subtitle: 'Safe Stop — Heal squad +6 HP, recruit a Hero & grab a Watering Can',
    },
  },
  {
    id: 'autumn',
    theme: 'autumn',
    name: 'Autumn Orchard',
    trailTitle: 'Autumn Orchard Trail',
    trailHint: 'Pick a path. Lord Bramblecoat waits in the moonlit orchard.',
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
      name: "Lord Bramblecoat's Orchard",
      subtitle: 'Autumn Boss — Cut down the crimson harvest warden!',
    },
    shop: {
      name: "Farmer's Compost Market",
      subtitle: 'Safe Market — Spend run Seeds on Grafts, Items, Healing & Recruits!',
    },
    vault: {
      name: 'Seed Vault & Compost',
      subtitle: 'Safe Stop — Heal squad +6 HP, recruit a Hero & grab a Watering Can',
    },
  },
];

/** Generated floors per act, not counting the boss. */
export const FLOORS_PER_ACT = 7;
export const MAX_LANES = 4;
const PATH_COUNT = 5;

export function actIndexForSeason(seasonId: SeasonId | undefined): number {
  const idx = ACTS.findIndex((a) => a.id === seasonId);
  return idx >= 0 ? idx : 0;
}

/** Derive an independent, reproducible stream per act from the run seed. */
export function actRng(runSeed: number, actIndex: number): Rng {
  return createRng((runSeed ^ Math.imul(actIndex + 1, 0x9e3779b1)) >>> 0);
}

function nodeId(actIndex: number, floor: number, lane: number): string {
  return `a${actIndex}f${floor}l${lane}`;
}

export function bossNodeId(actIndex: number): string {
  return `a${actIndex}boss`;
}

interface Edge {
  floor: number;
  from: number;
  to: number;
}

function crosses(edges: Edge[], floor: number, from: number, to: number): boolean {
  return edges.some(
    (e) => e.floor === floor && ((e.from < from && e.to > to) || (e.from > from && e.to < to))
  );
}

/** Walk PATH_COUNT non-crossing paths up the grid; returns the set of cells and edges. */
function walkPaths(rng: Rng): { cells: Set<string>; edges: Edge[] } {
  const cells = new Set<string>();
  const edges: Edge[] = [];
  const starts: number[] = [];

  for (let p = 0; p < PATH_COUNT; p++) {
    let lane = Math.floor(rng() * MAX_LANES);
    // Guarantee at least two different starting points.
    if (p === 1 && lane === starts[0]) lane = (lane + 1 + Math.floor(rng() * (MAX_LANES - 1))) % MAX_LANES;
    starts.push(lane);
    cells.add(`0:${lane}`);

    for (let floor = 0; floor < FLOORS_PER_ACT - 1; floor++) {
      const options = [lane - 1, lane, lane + 1].filter(
        (l) => l >= 0 && l < MAX_LANES && !crosses(edges, floor, lane, l)
      );
      // Staying in the same lane never crosses anything, so options is never empty.
      const next = options[Math.floor(rng() * options.length)];
      if (!edges.some((e) => e.floor === floor && e.from === lane && e.to === next)) {
        edges.push({ floor, from: lane, to: next });
      }
      lane = next;
      cells.add(`${floor + 1}:${lane}`);
    }
  }
  return { cells, edges };
}

function pick<T>(rng: Rng, items: readonly T[]): T {
  return items[Math.floor(rng() * items.length)];
}

function weightedPick<T extends string>(rng: Rng, weights: Partial<Record<T, number>>): T {
  const entries = Object.entries(weights).filter(([, w]) => (w as number) > 0) as [T, number][];
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let roll = rng() * total;
  for (const [key, w] of entries) {
    roll -= w;
    if (roll < 0) return key;
  }
  return entries[entries.length - 1][0];
}

/** Node types that may be swapped for a guaranteed market / elite. */
const CONVERTIBLE: ReadonlySet<NodeType> = new Set<NodeType>(['skirmish', 'event', 'escape', 'barn_rescue']);

/** Node types that shouldn't appear twice in a row along a path. */
const NO_REPEAT: ReadonlySet<NodeType> = new Set<NodeType>(['elite', 'shop', 'vault', 'escape', 'barn_rescue', 'event']);

function typeWeights(floor: number): Partial<Record<NodeType, number>> {
  if (floor === 0) return { skirmish: 1 };
  if (floor === 1) return { skirmish: 45, escape: 20, barn_rescue: 15, event: 20 };
  return {
    skirmish: 30,
    event: 14,
    escape: 14,
    barn_rescue: 12,
    elite: floor >= 2 ? 16 : 0,
    shop: 12,
    vault: floor === FLOORS_PER_ACT - 2 ? 0 : 10, // the floor right before the rest stop
  };
}

function describeNode(act: ActDef, type: NodeType, rng: Rng): Pick<SeasonNode, 'name' | 'subtitle' | 'mapId'> {
  if (type === 'shop') return { name: act.shop.name, subtitle: act.shop.subtitle };
  if (type === 'vault') return { name: act.vault.name, subtitle: act.vault.subtitle };
  if (type === 'event') return { name: 'Something Along the Trail', subtitle: 'Mystery — A strange find, a choice to make' };
  if (type === 'boss') return { name: act.boss.name, subtitle: act.boss.subtitle, mapId: act.boss.mapId };
  const battleType = type as BattleNodeType;
  return {
    name: '', // filled in by the caller from the map template name
    subtitle: act.subtitles[battleType],
    mapId: pick(rng, act.mapPools[battleType]),
  };
}

/**
 * Generate the node graph for one act.
 * `mapName` resolves a map id to its display name (kept injectable so this stays data-agnostic).
 */
export function generateActNodes(
  actIndex: number,
  rng: Rng,
  mapName: (mapId: string) => string = (id) => id
): SeasonNode[] {
  const act = ACTS[actIndex] ?? ACTS[0];
  const { cells, edges } = walkPaths(rng);
  const lastFloor = FLOORS_PER_ACT - 1;

  // Parents per cell, so we can avoid repeating special node types along a path.
  const parents = new Map<string, number[]>();
  for (const e of edges) {
    const key = `${e.floor + 1}:${e.to}`;
    parents.set(key, [...(parents.get(key) ?? []), e.from]);
  }

  const types = new Map<string, NodeType>();
  for (let floor = 0; floor < FLOORS_PER_ACT; floor++) {
    for (let lane = 0; lane < MAX_LANES; lane++) {
      const key = `${floor}:${lane}`;
      if (!cells.has(key)) continue;
      if (floor === lastFloor) {
        types.set(key, 'vault'); // rest stop before every boss
        continue;
      }
      const parentTypes = (parents.get(key) ?? []).map((l) => types.get(`${floor - 1}:${l}`));
      const weights = typeWeights(floor);
      for (const t of parentTypes) {
        if (t && NO_REPEAT.has(t)) weights[t] = 0;
      }
      types.set(key, weightedPick(rng, weights));
    }
  }

  // Every act should offer at least one market and one elite somewhere in the middle floors.
  for (const required of ['shop', 'elite'] as const) {
    if ([...types.values()].includes(required)) continue;
    const candidates = [...types.entries()].filter(([key, t]) => {
      const [floor, lane] = key.split(':').map(Number);
      if (!CONVERTIBLE.has(t) || floor < 2 || floor >= lastFloor - 1) return false;
      const neighbours = [
        ...(parents.get(key) ?? []).map((l) => types.get(`${floor - 1}:${l}`)),
        ...edges.filter((e) => e.floor === floor && e.from === lane).map((e) => types.get(`${floor + 1}:${e.to}`)),
      ];
      return !neighbours.includes(required);
    });
    // Prefer turning a plain skirmish into the missing stop; fall back to other filler nodes.
    const skirmishes = candidates.filter(([, t]) => t === 'skirmish');
    const pool = skirmishes.length > 0 ? skirmishes : candidates;
    if (pool.length > 0) types.set(pick(rng, pool)[0], required);
  }

  const nodes: SeasonNode[] = [];
  for (let floor = 0; floor < FLOORS_PER_ACT; floor++) {
    for (let lane = 0; lane < MAX_LANES; lane++) {
      const key = `${floor}:${lane}`;
      const type = types.get(key);
      if (!type) continue;
      const info = describeNode(act, type, rng);
      const nextIds =
        floor === lastFloor
          ? [bossNodeId(actIndex)]
          : edges
              .filter((e) => e.floor === floor && e.from === lane)
              .map((e) => e.to)
              .sort((a, b) => a - b)
              .map((to) => nodeId(actIndex, floor + 1, to));
      nodes.push({
        id: nodeId(actIndex, floor, lane),
        stage: floor,
        lane,
        type,
        name: info.mapId && !info.name ? mapName(info.mapId) : info.name,
        subtitle: info.subtitle,
        mapId: info.mapId,
        nextIds,
        completed: false,
      });
    }
  }

  const boss = describeNode(act, 'boss', rng);
  nodes.push({
    id: bossNodeId(actIndex),
    stage: FLOORS_PER_ACT,
    lane: 0,
    type: 'boss',
    name: boss.name,
    subtitle: boss.subtitle,
    mapId: boss.mapId,
    nextIds: [],
    completed: false,
  });

  return nodes;
}
