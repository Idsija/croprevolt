import type { CoverKind, MapTemplate, TerrainType } from '../engine/types';

type TileSpec = MapTemplate['tiles'][number];

/** Helper to cleanly build multi-elevation rectangles, rivers, lava trenches, and paths. */
function rect(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  props: { terrain?: TerrainType; elevation?: number; cover?: Exclude<CoverKind, 'none'> }
): TileSpec[] {
  const out: TileSpec[] = [];
  for (let y = y1; y <= y2; y++) {
    for (let x = x1; x <= x2; x++) {
      out.push({ x, y, ...props });
    }
  }
  return out;
}

/** Merge overlapping tile specs cleanly (later entries override terrain/elevation/cover). */
function mergeTiles(...groups: TileSpec[][]): TileSpec[] {
  const map = new Map<string, TileSpec>();
  for (const group of groups) {
    for (const spec of group) {
      const key = `${spec.x},${spec.y}`;
      const existing = map.get(key);
      if (existing) {
        map.set(key, {
          x: spec.x,
          y: spec.y,
          terrain: spec.terrain ?? existing.terrain,
          elevation: spec.elevation !== undefined ? spec.elevation : existing.elevation,
          cover: spec.cover !== undefined ? spec.cover : existing.cover,
        });
      } else {
        map.set(key, { ...spec });
      }
    }
  }
  return Array.from(map.values());
}

export const MAP_TEMPLATES: Record<string, MapTemplate> = {
  vegetable_patch: {
    id: 'vegetable_patch',
    name: 'Sunlit Vegetable Patch',
    subtitle: 'Claim the raised west terrace, cross the brook bridge, and drive the farmhands out!',
    objective: 'defeat_all',
    objectiveLabel: 'Defeat all farmers',
    width: 7,
    height: 10,
    tiles: mergeTiles(
      // Vertical dirt garden path down the middle
      rect(3, 0, 3, 9, { terrain: 'soil' }),
      // West raised garden terrace (+1 High Ground!) with north & south ramps
      rect(0, 2, 0, 5, { terrain: 'grass', elevation: 1 }),
      [
        { x: 0, y: 6, terrain: 'ramp', elevation: 0 },
        { x: 0, y: 1, terrain: 'ramp', elevation: 0 },
      ],
      // East bubbling garden brook + wooden footbridge
      [
        { x: 6, y: 2, terrain: 'water', elevation: 0 },
        { x: 6, y: 3, terrain: 'water', elevation: 0 },
        { x: 6, y: 4, terrain: 'bridge', elevation: 0 },
        { x: 6, y: 5, terrain: 'water', elevation: 0 },
        { x: 6, y: 6, terrain: 'water', elevation: 0 },
      ],
      // Compost healing beds & mud puddles
      [
        { x: 1, y: 6, terrain: 'compost' },
        { x: 5, y: 4, terrain: 'compost' },
        { x: 2, y: 4, terrain: 'mud' },
        { x: 2, y: 3, terrain: 'mud' },
      ],
      // Tactile Cover & Interactive Garden Props (Sprinkler stays at (0,4) on the west ledge!)
      [
        { x: 2, y: 6, cover: 'crate' },
        { x: 4, y: 6, cover: 'crate' },
        { x: 1, y: 5, cover: 'haystack' },
        { x: 5, y: 5, cover: 'beehive' },
        { x: 4, y: 4, cover: 'crate' },
        { x: 0, y: 4, cover: 'sprinkler' },
        { x: 1, y: 3, cover: 'crate' },
        { x: 4, y: 3, cover: 'haystack' },
        { x: 2, y: 2, cover: 'crate' },
        { x: 5, y: 2, cover: 'crate' },
      ]
    ),
    playerSpawns: [
      { x: 1, y: 8 },
      { x: 2, y: 8 },
      { x: 4, y: 8 },
      { x: 5, y: 8 },
    ],
    enemySpawns: [
      { blueprintId: 'digger', x: 3, y: 4 },
      { blueprintId: 'trimmer', x: 4, y: 2 },
      { blueprintId: 'digger', x: 3, y: 1 },
    ],
  },

  // ===== NEW SHOWCASE MAP 1: TWIN BROOK BRIDGES & CENTRAL HIGH-GROUND KNOLL =====
  creek_crossing: {
    id: 'creek_crossing',
    name: 'Twin Brook Crossing',
    subtitle: 'Cross twin wooden bridges, seize the high-ground knoll, and knock foes into the creek!',
    objective: 'defeat_all',
    objectiveLabel: 'Defeat all farmers',
    width: 9,
    height: 11,
    tiles: mergeTiles(
      // Twin babbling water streams cutting across the valley
      rect(0, 7, 8, 7, { terrain: 'water', elevation: 0 }),
      rect(0, 3, 8, 3, { terrain: 'water', elevation: 0 }),
      // Four sturdy wooden plank footbridges
      [
        { x: 2, y: 7, terrain: 'bridge', elevation: 0 },
        { x: 6, y: 7, terrain: 'bridge', elevation: 0 },
        { x: 2, y: 3, terrain: 'bridge', elevation: 0 },
        { x: 6, y: 3, terrain: 'bridge', elevation: 0 },
      ],
      // Central raised rocky knoll (+1 High Ground!) with north & south timber ramps
      rect(3, 4, 5, 6, { terrain: 'grass', elevation: 1 }),
      [
        { x: 4, y: 6, terrain: 'ramp', elevation: 0 },
        { x: 4, y: 4, terrain: 'ramp', elevation: 0 },
      ],
      // Dirt lanes leading to bridges
      rect(2, 8, 2, 10, { terrain: 'soil' }),
      rect(6, 8, 6, 10, { terrain: 'soil' }),
      rect(2, 0, 2, 2, { terrain: 'soil' }),
      rect(6, 0, 6, 2, { terrain: 'soil' }),
      // Compost, mud banks, Bouncy Mushrooms & flanking Gopher Burrow Warp Pipes!
      [
        { x: 0, y: 5, terrain: 'compost' },
        { x: 8, y: 5, terrain: 'compost' },
        { x: 1, y: 8, terrain: 'mud' },
        { x: 7, y: 2, terrain: 'mud' },
        { x: 4, y: 8, terrain: 'bounce_pad', elevation: 0 },
        { x: 0, y: 8, terrain: 'burrow', elevation: 0 },
        { x: 0, y: 2, terrain: 'burrow', elevation: 0 },
        { x: 8, y: 8, terrain: 'burrow', elevation: 0 },
        { x: 8, y: 2, terrain: 'burrow', elevation: 0 },
      ],
      // Tactical cover, Rolling Pumpkins & creek-side explosive hazards
      [
        { x: 3, y: 8, cover: 'crate' },
        { x: 5, y: 8, cover: 'crate' },
        { x: 1, y: 6, cover: 'beehive' },
        { x: 7, y: 6, cover: 'sprinkler' },
        { x: 3, y: 5, cover: 'pumpkin' },
        { x: 5, y: 5, cover: 'crate' },
        { x: 1, y: 4, cover: 'haystack' },
        { x: 7, y: 4, cover: 'haystack' },
        { x: 3, y: 2, cover: 'crate' },
        { x: 5, y: 2, cover: 'beehive' },
        { x: 4, y: 1, cover: 'stone' },
      ]
    ),
    burrowPairs: [
      [{ x: 0, y: 8 }, { x: 0, y: 2 }],
      [{ x: 8, y: 8 }, { x: 8, y: 2 }],
    ],
    playerSpawns: [
      { x: 1, y: 10 },
      { x: 3, y: 9 },
      { x: 5, y: 9 },
      { x: 7, y: 10 },
    ],
    enemySpawns: [
      { blueprintId: 'pitchfork', x: 4, y: 5 },
      { blueprintId: 'barrow', x: 1, y: 2 },
      { blueprintId: 'beekeeper', x: 7, y: 2 },
      { blueprintId: 'digger', x: 2, y: 4 },
    ],
  },

  // ===== NEW SHOWCASE MAP 2: MULTI-TIER CANYON TERRACE (ELEVATION 0 -> 1 -> 2!) =====
  canyon_terrace: {
    id: 'canyon_terrace',
    name: 'Sunlit Canyon Terraces',
    subtitle: 'Scale two-story terraced cliffs via Bouncy Mushrooms, ramps, or Gopher Burrows!',
    objective: 'defeat_all',
    objectiveLabel: 'Defeat all farmers',
    width: 10,
    height: 12,
    tiles: mergeTiles(
      // Chasm creek running across mid-map with twin wooden bridges
      rect(2, 6, 7, 6, { terrain: 'water', elevation: 0 }),
      [
        { x: 3, y: 6, terrain: 'bridge', elevation: 0 },
        { x: 6, y: 6, terrain: 'bridge', elevation: 0 },
      ],
      // West & East Step-1 Terraces (elevation 1)
      rect(0, 3, 1, 8, { terrain: 'grass', elevation: 1 }),
      rect(8, 3, 9, 8, { terrain: 'grass', elevation: 1 }),
      [
        { x: 1, y: 8, terrain: 'ramp', elevation: 0 },
        { x: 8, y: 8, terrain: 'ramp', elevation: 0 },
        { x: 1, y: 3, terrain: 'ramp', elevation: 0 },
        { x: 8, y: 3, terrain: 'ramp', elevation: 0 },
      ],
      // North Mid-Terrace (elevation 1) & Top Citadel Ridge (elevation 2!)
      rect(2, 3, 7, 4, { terrain: 'soil', elevation: 1 }),
      [
        { x: 3, y: 5, terrain: 'ramp', elevation: 0 },
        { x: 6, y: 5, terrain: 'ramp', elevation: 0 },
      ],
      rect(3, 0, 6, 2, { terrain: 'grass', elevation: 2 }),
      [
        { x: 4, y: 3, terrain: 'ramp', elevation: 1 },
        { x: 5, y: 3, terrain: 'ramp', elevation: 1 },
      ],
      // Compost beds, sunbeams, Bouncy Mushrooms & Gopher Burrow Warp Pipes!
      [
        { x: 0, y: 6, terrain: 'compost', elevation: 1 },
        { x: 9, y: 6, terrain: 'compost', elevation: 1 },
        { x: 4, y: 1, terrain: 'sunbeam', elevation: 2 },
        { x: 2, y: 8, terrain: 'bounce_pad', elevation: 0 },
        { x: 7, y: 8, terrain: 'bounce_pad', elevation: 0 },
        { x: 1, y: 9, terrain: 'burrow', elevation: 0 },
        { x: 2, y: 3, terrain: 'burrow', elevation: 1 },
        { x: 8, y: 9, terrain: 'burrow', elevation: 0 },
        { x: 7, y: 3, terrain: 'burrow', elevation: 1 },
      ],
      // Cover, Rolling Pumpkins & interactive canyon props
      [
        { x: 3, y: 8, cover: 'crate' },
        { x: 6, y: 8, cover: 'crate' },
        { x: 4, y: 7, cover: 'pumpkin' },
        { x: 5, y: 7, cover: 'beehive' },
        { x: 0, y: 5, cover: 'crate' },
        { x: 9, y: 5, cover: 'sprinkler' },
        { x: 2, y: 4, cover: 'crate' },
        { x: 7, y: 4, cover: 'pumpkin' },
        { x: 3, y: 2, cover: 'stone' },
        { x: 6, y: 2, cover: 'stone' },
      ]
    ),
    burrowPairs: [
      [{ x: 1, y: 9 }, { x: 2, y: 3 }],
      [{ x: 8, y: 9 }, { x: 7, y: 3 }],
    ],
    playerSpawns: [
      { x: 2, y: 11 },
      { x: 4, y: 10 },
      { x: 6, y: 10 },
      { x: 7, y: 11 },
    ],
    enemySpawns: [
      { blueprintId: 'digger', x: 3, y: 4 },
      { blueprintId: 'trimmer', x: 6, y: 4 },
      { blueprintId: 'sprayer', x: 4, y: 2 },
      { blueprintId: 'mower', x: 5, y: 1 },
    ],
  },

  // ===== NEW SHOWCASE MAP 3: VOLCANIC BOILER FOUNDRY (MOLTEN LAVA & BRIDGES!) =====
  molten_furnace: {
    id: 'molten_furnace',
    name: 'Boiler Foundry Crucible',
    subtitle: 'Shove farmers into glowing lava channels (-4 HP + Burn) from elevated catwalks & burrows!',
    theme: 'greenhouse',
    objective: 'defeat_all',
    objectiveLabel: 'Defeat the foundry squad',
    width: 9,
    height: 12,
    tiles: mergeTiles(
      // Industrial brick/plank foundry floor
      rect(1, 1, 7, 10, { terrain: 'barn_floor', elevation: 0 }),
      // Twin glowing molten lava trenches!
      rect(1, 8, 7, 8, { terrain: 'lava', elevation: 0 }),
      rect(1, 4, 7, 4, { terrain: 'lava', elevation: 0 }),
      // Heavy foundry bridges spanning the lava
      [
        { x: 2, y: 8, terrain: 'bridge', elevation: 0 },
        { x: 6, y: 8, terrain: 'bridge', elevation: 0 },
        { x: 4, y: 4, terrain: 'bridge', elevation: 0 },
      ],
      // Elevated side boiler catwalks (elevation 1) with ramps
      rect(0, 3, 0, 9, { terrain: 'barn_floor', elevation: 1 }),
      rect(8, 3, 8, 9, { terrain: 'barn_floor', elevation: 1 }),
      [
        { x: 0, y: 9, terrain: 'ramp', elevation: 0 },
        { x: 8, y: 9, terrain: 'ramp', elevation: 0 },
        { x: 0, y: 3, terrain: 'ramp', elevation: 0 },
        { x: 8, y: 3, terrain: 'ramp', elevation: 0 },
      ],
      // North raised furnace dais (elevation 1) + Gopher Burrow tunnels onto catwalks!
      rect(2, 1, 6, 2, { terrain: 'barn_floor', elevation: 1 }),
      [
        { x: 4, y: 3, terrain: 'ramp', elevation: 0 },
        { x: 2, y: 6, terrain: 'sunbeam', elevation: 0 },
        { x: 6, y: 6, terrain: 'sunbeam', elevation: 0 },
        { x: 0, y: 10, terrain: 'burrow', elevation: 0 },
        { x: 0, y: 5, terrain: 'burrow', elevation: 1 },
        { x: 8, y: 10, terrain: 'burrow', elevation: 0 },
        { x: 8, y: 5, terrain: 'burrow', elevation: 1 },
      ],
      // Cover, Sprinklers & Beehives positioned for explosive lava dunks!
      [
        { x: 3, y: 9, cover: 'crate' },
        { x: 5, y: 9, cover: 'crate' },
        { x: 3, y: 6, cover: 'sprinkler' },
        { x: 5, y: 6, cover: 'beehive' },
        { x: 1, y: 6, cover: 'stone' },
        { x: 7, y: 6, cover: 'stone' },
        { x: 2, y: 5, cover: 'crate' },
        { x: 6, y: 5, cover: 'crate' },
        { x: 3, y: 2, cover: 'crate' },
        { x: 5, y: 2, cover: 'crate' },
      ]
    ),
    burrowPairs: [
      [{ x: 0, y: 10 }, { x: 0, y: 5 }],
      [{ x: 8, y: 10 }, { x: 8, y: 5 }],
    ],
    playerSpawns: [
      { x: 1, y: 11 },
      { x: 3, y: 10 },
      { x: 5, y: 10 },
      { x: 7, y: 11 },
    ],
    enemySpawns: [
      { blueprintId: 'mower', x: 2, y: 6 },
      { blueprintId: 'mower', x: 6, y: 6 },
      { blueprintId: 'trimmer', x: 4, y: 2 },
      { blueprintId: 'sprayer', x: 6, y: 1 },
    ],
  },

  patch_breakout: {
    id: 'patch_breakout',
    name: 'Garden Gate Breakout',
    subtitle: 'Cross the moat bridges and vault past raised guard towers to the north Garden Gate!',
    objective: 'reach_gate',
    objectiveLabel: 'Reach the Garden Gate (or defeat all)',
    width: 9,
    height: 12,
    tiles: mergeTiles(
      // Escape gate tiles on north (top) edge (keeps (3,0) & (3,1) flat for tests!)
      [
        { x: 3, y: 0, terrain: 'gate', elevation: 0 },
        { x: 4, y: 0, terrain: 'gate', elevation: 0 },
        { x: 5, y: 0, terrain: 'gate', elevation: 0 },
      ],
      // Central dirt road
      rect(4, 1, 4, 10, { terrain: 'soil' }),
      // Moat stream across the middle with 3 wooden bridges
      rect(0, 6, 8, 6, { terrain: 'water', elevation: 0 }),
      [
        { x: 2, y: 6, terrain: 'bridge', elevation: 0 },
        { x: 4, y: 6, terrain: 'bridge', elevation: 0 },
        { x: 7, y: 6, terrain: 'bridge', elevation: 0 },
      ],
      // Raised watchtowers on west & east flanks (elevation 1)
      rect(0, 2, 1, 5, { terrain: 'grass', elevation: 1 }),
      rect(7, 2, 8, 5, { terrain: 'grass', elevation: 1 }),
      [
        { x: 1, y: 5, terrain: 'ramp', elevation: 0 },
        { x: 7, y: 5, terrain: 'ramp', elevation: 0 },
        { x: 1, y: 2, terrain: 'ramp', elevation: 0 },
        { x: 7, y: 2, terrain: 'ramp', elevation: 0 },
      ],
      // Mud trenches & compost pads
      [
        { x: 2, y: 4, terrain: 'mud' },
        { x: 5, y: 4, terrain: 'mud' },
        { x: 6, y: 8, terrain: 'compost' },
        { x: 2, y: 2, terrain: 'compost' },
      ],
      // Cover layout
      [
        { x: 3, y: 8, cover: 'crate' },
        { x: 5, y: 8, cover: 'haystack' },
        { x: 3, y: 5, cover: 'crate' },
        { x: 5, y: 5, cover: 'beehive' },
        { x: 0, y: 4, cover: 'crate' },
        { x: 8, y: 4, cover: 'crate' },
        { x: 4, y: 3, cover: 'haystack' },
        { x: 2, y: 1, cover: 'crate' },
        { x: 6, y: 2, cover: 'stone' },
      ]
    ),
    playerSpawns: [
      { x: 2, y: 11 },
      { x: 4, y: 10 },
      { x: 6, y: 10 },
      { x: 7, y: 11 },
    ],
    enemySpawns: [
      { blueprintId: 'trimmer', x: 1, y: 4 },
      { blueprintId: 'digger', x: 4, y: 4 },
      { blueprintId: 'sprayer', x: 5, y: 1 },
      { blueprintId: 'mower', x: 7, y: 3 },
    ],
    gateTiles: [
      { x: 3, y: 0 },
      { x: 4, y: 0 },
      { x: 5, y: 0 },
    ],
  },

  barn_raid: {
    id: 'barn_raid',
    name: 'Old Barn Rescue',
    subtitle: 'Storm the hayloft balcony, smash the Burlap Cage at the north stall, and free your ally!',
    objective: 'barn_rescue',
    objectiveLabel: 'Break the Burlap Cage & clear the barn',
    width: 9,
    height: 11,
    tiles: mergeTiles(
      // Classic barn plank floor (keeps (2..3, 1..5) flat & cage at (3,1) for tests!)
      rect(1, 1, 5, 6, { terrain: 'barn_floor', elevation: 0 }),
      rect(3, 7, 3, 9, { terrain: 'soil' }),
      // West watering trough canal + bridge
      rect(0, 2, 0, 7, { terrain: 'water', elevation: 0 }),
      [{ x: 0, y: 5, terrain: 'bridge', elevation: 0 }],
      // East raised Hayloft Balcony (elevation 1) with timber ramps!
      rect(6, 2, 8, 6, { terrain: 'barn_floor', elevation: 1 }),
      [
        { x: 6, y: 6, terrain: 'ramp', elevation: 0 },
        { x: 6, y: 2, terrain: 'ramp', elevation: 0 },
        { x: 1, y: 7, terrain: 'compost' },
      ],
      // Cover + Objective Burlap Cage at (3,1)
      [
        { x: 2, y: 7, cover: 'crate' },
        { x: 4, y: 7, cover: 'crate' },
        { x: 1, y: 5, cover: 'haystack' },
        { x: 4, y: 5, cover: 'crate' },
        { x: 5, y: 4, cover: 'haystack' },
        { x: 7, y: 5, cover: 'haystack' },
        { x: 7, y: 3, cover: 'crate' },
        { x: 2, y: 2, cover: 'crate' },
        { x: 4, y: 2, cover: 'crate' },
        { x: 3, y: 1, cover: 'cage' },
      ]
    ),
    playerSpawns: [
      { x: 2, y: 10 },
      { x: 4, y: 10 },
      { x: 1, y: 9 },
      { x: 6, y: 9 },
    ],
    enemySpawns: [
      { blueprintId: 'digger', x: 2, y: 3 },
      { blueprintId: 'trimmer', x: 4, y: 3 },
      { blueprintId: 'sprayer', x: 7, y: 4 },
      { blueprintId: 'mower', x: 5, y: 1 },
    ],
    cagePos: { x: 3, y: 1 },
  },

  tool_shed_ambush: {
    id: 'tool_shed_ambush',
    name: 'Tool Shed Forge Elite',
    subtitle: 'Heavy tools guard a glowing forge trench and two-story tool benches!',
    objective: 'defeat_all',
    objectiveLabel: 'Defeat the elite tool squad',
    width: 9,
    height: 12,
    tiles: mergeTiles(
      rect(4, 1, 4, 9, { terrain: 'soil' }),
      // Molten forge lava trenches flanking the central stone bridge!
      rect(1, 6, 3, 6, { terrain: 'lava', elevation: 0 }),
      rect(5, 6, 7, 6, { terrain: 'lava', elevation: 0 }),
      [
        { x: 2, y: 6, terrain: 'bridge', elevation: 0 },
        { x: 6, y: 6, terrain: 'bridge', elevation: 0 },
      ],
      // Raised side workbenches (elevation 1) & North Overseer Platform (elevation 2!)
      rect(0, 2, 1, 5, { terrain: 'barn_floor', elevation: 1 }),
      rect(7, 2, 8, 5, { terrain: 'barn_floor', elevation: 1 }),
      [
        { x: 1, y: 5, terrain: 'ramp', elevation: 0 },
        { x: 7, y: 5, terrain: 'ramp', elevation: 0 },
      ],
      rect(3, 1, 5, 2, { terrain: 'barn_floor', elevation: 2 }),
      [
        { x: 4, y: 3, terrain: 'ramp', elevation: 1 },
        { x: 3, y: 3, terrain: 'barn_floor', elevation: 1 },
        { x: 5, y: 3, terrain: 'barn_floor', elevation: 1 },
        { x: 4, y: 4, terrain: 'ramp', elevation: 0 },
        { x: 1, y: 8, terrain: 'compost' },
        { x: 7, y: 8, terrain: 'compost' },
      ],
      // Tactical cover maze
      [
        { x: 3, y: 8, cover: 'crate' },
        { x: 5, y: 8, cover: 'stone' },
        { x: 4, y: 6, cover: 'beehive' },
        { x: 2, y: 4, cover: 'sprinkler' },
        { x: 6, y: 4, cover: 'haystack' },
        { x: 0, y: 3, cover: 'crate' },
        { x: 8, y: 3, cover: 'crate' },
        { x: 3, y: 2, cover: 'crate' },
        { x: 5, y: 2, cover: 'crate' },
      ]
    ),
    playerSpawns: [
      { x: 1, y: 11 },
      { x: 3, y: 10 },
      { x: 5, y: 10 },
      { x: 7, y: 11 },
    ],
    enemySpawns: [
      { blueprintId: 'digger', x: 1, y: 3 },
      { blueprintId: 'mower', x: 7, y: 3 },
      { blueprintId: 'trimmer', x: 4, y: 2 },
      { blueprintId: 'sprayer', x: 4, y: 1 },
    ],
  },

  scarecrow_stand: {
    id: 'scarecrow_stand',
    name: "Captain Scarecrow's Stand",
    subtitle: 'Spring Boss — Storm the terraced straw hill across twin moats and topple the warden!',
    objective: 'boss',
    objectiveLabel: 'Defeat Captain Scarecrow',
    width: 10,
    height: 12,
    tiles: mergeTiles(
      // Twin dirt approaches
      rect(4, 3, 5, 10, { terrain: 'soil' }),
      // Flanking irrigation moats + 4 wooden bridges
      rect(1, 3, 1, 8, { terrain: 'water', elevation: 0 }),
      rect(8, 3, 8, 8, { terrain: 'water', elevation: 0 }),
      [
        { x: 1, y: 7, terrain: 'bridge', elevation: 0 },
        { x: 8, y: 7, terrain: 'bridge', elevation: 0 },
        { x: 1, y: 3, terrain: 'bridge', elevation: 0 },
        { x: 8, y: 3, terrain: 'bridge', elevation: 0 },
      ],
      // Stepped Boss Hill: Tier 1 Ring (elevation 1) & Tier 2 Throne (elevation 2!)
      rect(3, 3, 6, 5, { terrain: 'grass', elevation: 1 }),
      [
        { x: 4, y: 6, terrain: 'ramp', elevation: 0 },
        { x: 5, y: 6, terrain: 'ramp', elevation: 0 },
      ],
      rect(3, 1, 6, 2, { terrain: 'soil', elevation: 2 }),
      [
        { x: 4, y: 3, terrain: 'ramp', elevation: 1 },
        { x: 5, y: 3, terrain: 'ramp', elevation: 1 },
      ],
      // Compost healers, mud flanks & Gopher Burrow warp pipes!
      [
        { x: 0, y: 6, terrain: 'compost' },
        { x: 9, y: 6, terrain: 'compost' },
        { x: 2, y: 5, terrain: 'mud' },
        { x: 7, y: 5, terrain: 'mud' },
        { x: 0, y: 9, terrain: 'burrow' },
        { x: 0, y: 2, terrain: 'burrow' },
        { x: 9, y: 9, terrain: 'burrow' },
        { x: 9, y: 2, terrain: 'burrow' },
      ],
      // Boss fortress cover
      [
        { x: 3, y: 8, cover: 'crate' },
        { x: 6, y: 8, cover: 'crate' },
        { x: 2, y: 7, cover: 'haystack' },
        { x: 7, y: 7, cover: 'haystack' },
        { x: 3, y: 5, cover: 'crate' },
        { x: 6, y: 5, cover: 'crate' },
        { x: 2, y: 3, cover: 'beehive' },
        { x: 7, y: 3, cover: 'sprinkler' },
        { x: 3, y: 2, cover: 'stone' },
        { x: 6, y: 2, cover: 'stone' },
      ]
    ),
    burrowPairs: [
      [{ x: 0, y: 9 }, { x: 0, y: 2 }],
      [{ x: 9, y: 9 }, { x: 9, y: 2 }],
    ],
    playerSpawns: [
      { x: 2, y: 11 },
      { x: 4, y: 10 },
      { x: 5, y: 10 },
      { x: 7, y: 11 },
    ],
    enemySpawns: [
      { blueprintId: 'scarecrow', x: 4, y: 1 },
      { blueprintId: 'digger', x: 3, y: 4 },
      { blueprintId: 'mower', x: 6, y: 4 },
      { blueprintId: 'sprayer', x: 5, y: 2 },
    ],
  },

  // ===== ACT 2: SUMMER GREENHOUSE MAPS (Sunbeams, Canals, Lava Boilers, Catwalks & Baron Combine!) =====
  greenhouse_entry: {
    id: 'greenhouse_entry',
    name: 'Sun-Baked Glasshouse',
    subtitle: 'Seize golden Sunbeams (+2 ATK), climb the side catwalks, and dunk foes in the canal!',
    theme: 'greenhouse',
    objective: 'defeat_all',
    objectiveLabel: 'Defeat all greenhouse guards',
    width: 9,
    height: 11,
    tiles: mergeTiles(
      // Terracotta central aisle (keeps x=2..4, y=2..6 flat for tests!)
      rect(3, 0, 3, 10, { terrain: 'barn_floor', elevation: 0 }),
      // East irrigation canal + wooden bridges
      rect(6, 1, 6, 9, { terrain: 'water', elevation: 0 }),
      [
        { x: 6, y: 3, terrain: 'bridge', elevation: 0 },
        { x: 6, y: 7, terrain: 'bridge', elevation: 0 },
      ],
      // East raised Glasshouse Balcony & West Planter Ledge (elevation 1)
      rect(7, 2, 8, 6, { terrain: 'barn_floor', elevation: 1 }),
      rect(0, 2, 0, 5, { terrain: 'barn_floor', elevation: 1 }),
      [
        { x: 7, y: 7, terrain: 'ramp', elevation: 0 },
        { x: 7, y: 1, terrain: 'ramp', elevation: 0 },
        { x: 0, y: 6, terrain: 'ramp', elevation: 0 },
        { x: 0, y: 1, terrain: 'ramp', elevation: 0 },
      ],
      // Golden Sunbeam skylights & compost
      [
        { x: 1, y: 5, terrain: 'sunbeam' },
        { x: 5, y: 5, terrain: 'sunbeam' },
        { x: 3, y: 3, terrain: 'sunbeam' },
        { x: 8, y: 4, terrain: 'sunbeam', elevation: 1 },
        { x: 1, y: 7, terrain: 'compost' },
      ],
      // Interactive Beehives, Sprinklers & Cover
      [
        { x: 2, y: 7, cover: 'crate' },
        { x: 4, y: 7, cover: 'crate' },
        { x: 2, y: 4, cover: 'beehive' },
        { x: 4, y: 4, cover: 'sprinkler' },
        { x: 1, y: 3, cover: 'haystack' },
        { x: 5, y: 3, cover: 'beehive' },
        { x: 7, y: 4, cover: 'crate' },
        { x: 2, y: 2, cover: 'crate' },
        { x: 4, y: 2, cover: 'crate' },
      ]
    ),
    playerSpawns: [
      { x: 1, y: 10 },
      { x: 3, y: 9 },
      { x: 5, y: 9 },
      { x: 7, y: 10 },
    ],
    enemySpawns: [
      { blueprintId: 'trimmer', x: 1, y: 2 },
      { blueprintId: 'sprayer', x: 5, y: 2 },
      { blueprintId: 'digger', x: 3, y: 1 },
      { blueprintId: 'trimmer', x: 8, y: 3 },
    ],
  },

  irrigation_run: {
    id: 'irrigation_run',
    name: 'Aqueduct Alley Breakout',
    subtitle: 'Blast Sprinklers along twin aqueduct canals and sprint to the north Glass Gate!',
    theme: 'greenhouse',
    objective: 'reach_gate',
    objectiveLabel: 'Reach the Glasshouse Gate (or defeat all)',
    width: 9,
    height: 12,
    tiles: mergeTiles(
      [
        { x: 3, y: 0, terrain: 'gate', elevation: 0 },
        { x: 4, y: 0, terrain: 'gate', elevation: 0 },
        { x: 5, y: 0, terrain: 'gate', elevation: 0 },
      ],
      rect(4, 1, 4, 10, { terrain: 'barn_floor' }),
      // Twin aqueduct water canals + bridges
      rect(0, 7, 8, 7, { terrain: 'water', elevation: 0 }),
      rect(0, 3, 8, 3, { terrain: 'water', elevation: 0 }),
      [
        { x: 2, y: 7, terrain: 'bridge', elevation: 0 },
        { x: 6, y: 7, terrain: 'bridge', elevation: 0 },
        { x: 4, y: 3, terrain: 'bridge', elevation: 0 },
        { x: 1, y: 3, terrain: 'bridge', elevation: 0 },
      ],
      // Raised aqueduct ledges on sides (elevation 1)
      rect(0, 4, 1, 6, { terrain: 'barn_floor', elevation: 1 }),
      rect(7, 4, 8, 6, { terrain: 'barn_floor', elevation: 1 }),
      [
        { x: 1, y: 6, terrain: 'ramp', elevation: 0 },
        { x: 7, y: 6, terrain: 'ramp', elevation: 0 },
      ],
      // Sunbeams & compost
      [
        { x: 3, y: 5, terrain: 'sunbeam' },
        { x: 5, y: 5, terrain: 'sunbeam' },
        { x: 7, y: 8, terrain: 'compost' },
      ],
      // Sprinkler & Beehive corridor
      [
        { x: 3, y: 8, cover: 'crate' },
        { x: 5, y: 8, cover: 'sprinkler' },
        { x: 4, y: 6, cover: 'beehive' },
        { x: 2, y: 5, cover: 'sprinkler' },
        { x: 6, y: 5, cover: 'haystack' },
        { x: 3, y: 2, cover: 'beehive' },
        { x: 6, y: 2, cover: 'stone' },
      ]
    ),
    playerSpawns: [
      { x: 2, y: 11 },
      { x: 4, y: 10 },
      { x: 6, y: 10 },
      { x: 7, y: 11 },
    ],
    enemySpawns: [
      { blueprintId: 'mower', x: 2, y: 4 },
      { blueprintId: 'trimmer', x: 6, y: 4 },
      { blueprintId: 'sprayer', x: 2, y: 1 },
      { blueprintId: 'digger', x: 6, y: 1 },
    ],
    gateTiles: [
      { x: 3, y: 0 },
      { x: 4, y: 0 },
      { x: 5, y: 0 },
    ],
  },

  apiary_ambush: {
    id: 'apiary_ambush',
    name: 'Terraced Apiary Elite',
    subtitle: 'Chain-detonate Beehives across two-story apiary ledges overlooking koi ponds!',
    theme: 'greenhouse',
    objective: 'defeat_all',
    objectiveLabel: 'Defeat the elite greenhouse squad',
    width: 9,
    height: 12,
    tiles: mergeTiles(
      rect(4, 1, 4, 9, { terrain: 'barn_floor' }),
      // Twin koi ponds flanking the central promenade
      rect(1, 7, 2, 8, { terrain: 'water', elevation: 0 }),
      rect(6, 7, 7, 8, { terrain: 'water', elevation: 0 }),
      [
        { x: 2, y: 7, terrain: 'bridge', elevation: 0 },
        { x: 6, y: 7, terrain: 'bridge', elevation: 0 },
      ],
      // Mid-level Apiary Terrace (elevation 1) & Queen Hive Overlook (elevation 2)
      rect(1, 3, 7, 5, { terrain: 'grass', elevation: 1 }),
      [
        { x: 3, y: 6, terrain: 'ramp', elevation: 0 },
        { x: 5, y: 6, terrain: 'ramp', elevation: 0 },
      ],
      rect(3, 1, 5, 2, { terrain: 'barn_floor', elevation: 2 }),
      [
        { x: 4, y: 3, terrain: 'ramp', elevation: 1 },
        { x: 2, y: 5, terrain: 'sunbeam', elevation: 1 },
        { x: 6, y: 5, terrain: 'sunbeam', elevation: 1 },
        { x: 4, y: 1, terrain: 'sunbeam', elevation: 2 },
        { x: 0, y: 8, terrain: 'bounce_pad', elevation: 0 },
        { x: 8, y: 8, terrain: 'bounce_pad', elevation: 0 },
        { x: 4, y: 9, terrain: 'compost', elevation: 0 },
      ],
      // Explosive apiary grid + fairer starting cover
      [
        { x: 2, y: 9, cover: 'crate' },
        { x: 6, y: 9, cover: 'crate' },
        { x: 3, y: 8, cover: 'crate' },
        { x: 5, y: 8, cover: 'stone' },
        { x: 2, y: 4, cover: 'beehive' },
        { x: 6, y: 4, cover: 'beehive' },
        { x: 4, y: 5, cover: 'sprinkler' },
        { x: 1, y: 3, cover: 'beehive' },
        { x: 7, y: 3, cover: 'haystack' },
        { x: 3, y: 2, cover: 'beehive' },
      ]
    ),
    playerSpawns: [
      { x: 0, y: 11 },
      { x: 3, y: 10 },
      { x: 5, y: 10 },
      { x: 8, y: 11 },
    ],
    enemySpawns: [
      { blueprintId: 'digger', x: 1, y: 4 },
      { blueprintId: 'blower', x: 7, y: 4 },
      { blueprintId: 'beekeeper', x: 4, y: 4 },
      { blueprintId: 'trimmer', x: 5, y: 3 },
    ],
  },

  combine_throne: {
    id: 'combine_throne',
    name: "Baron Combine's Conservatory",
    subtitle: 'Summer Boss — Cross molten boiler trenches and topple the red harvester on its throne!',
    theme: 'greenhouse',
    objective: 'boss',
    objectiveLabel: 'Defeat Baron Combine',
    width: 10,
    height: 12,
    tiles: mergeTiles(
      rect(4, 2, 5, 10, { terrain: 'barn_floor' }),
      // Twin molten boiler lava trenches + steel bridges
      rect(1, 6, 3, 6, { terrain: 'lava', elevation: 0 }),
      rect(6, 6, 8, 6, { terrain: 'lava', elevation: 0 }),
      [
        { x: 2, y: 6, terrain: 'bridge', elevation: 0 },
        { x: 7, y: 6, terrain: 'bridge', elevation: 0 },
      ],
      // Raised boiler catwalks (elevation 1) & Combine Engine Dais (elevation 2!)
      rect(0, 2, 1, 5, { terrain: 'barn_floor', elevation: 1 }),
      rect(8, 2, 9, 5, { terrain: 'barn_floor', elevation: 1 }),
      [
        { x: 1, y: 5, terrain: 'ramp', elevation: 0 },
        { x: 8, y: 5, terrain: 'ramp', elevation: 0 },
      ],
      rect(3, 3, 6, 4, { terrain: 'barn_floor', elevation: 1 }),
      [
        { x: 4, y: 5, terrain: 'ramp', elevation: 0 },
        { x: 5, y: 5, terrain: 'ramp', elevation: 0 },
      ],
      rect(3, 1, 6, 2, { terrain: 'barn_floor', elevation: 2 }),
      [
        { x: 4, y: 3, terrain: 'ramp', elevation: 1 },
        { x: 5, y: 3, terrain: 'ramp', elevation: 1 },
      ],
      // Sunbeams, Compost & Gopher Burrow warp pipes onto the boiler catwalks!
      [
        { x: 2, y: 8, terrain: 'sunbeam' },
        { x: 7, y: 8, terrain: 'sunbeam' },
        { x: 4, y: 4, terrain: 'sunbeam', elevation: 1 },
        { x: 0, y: 7, terrain: 'compost' },
        { x: 9, y: 7, terrain: 'compost' },
        { x: 0, y: 9, terrain: 'burrow' },
        { x: 0, y: 3, terrain: 'burrow', elevation: 1 },
        { x: 9, y: 9, terrain: 'burrow' },
        { x: 9, y: 3, terrain: 'burrow', elevation: 1 },
      ],
      // Boss fortress interactive props
      [
        { x: 3, y: 8, cover: 'crate' },
        { x: 6, y: 8, cover: 'crate' },
        { x: 3, y: 5, cover: 'sprinkler' },
        { x: 6, y: 5, cover: 'beehive' },
        { x: 2, y: 4, cover: 'beehive' },
        { x: 7, y: 4, cover: 'sprinkler' },
        { x: 3, y: 2, cover: 'stone' },
        { x: 6, y: 2, cover: 'stone' },
      ]
    ),
    burrowPairs: [
      [{ x: 0, y: 9 }, { x: 0, y: 3 }],
      [{ x: 9, y: 9 }, { x: 9, y: 3 }],
    ],
    playerSpawns: [
      { x: 2, y: 11 },
      { x: 4, y: 10 },
      { x: 5, y: 10 },
      { x: 7, y: 11 },
    ],
    enemySpawns: [
      { blueprintId: 'tractor', x: 4, y: 1 },
      { blueprintId: 'mower', x: 3, y: 4 },
      { blueprintId: 'trimmer', x: 6, y: 4 },
      { blueprintId: 'sprayer', x: 5, y: 2 },
    ],
  },

  // ===== ACT 3: AUTUMN ORCHARD BOSS =====
  orchard_clearing: {
    id: 'orchard_clearing',
    name: "Lord Bramblecoat's Orchard",
    subtitle: 'Autumn Boss — Ford the moonlit river bridges and climb the bramble ridge to cut him down!',
    theme: 'autumn',
    objective: 'boss',
    objectiveLabel: 'Defeat Lord Bramblecoat',
    width: 10,
    height: 12,
    tiles: mergeTiles(
      // Winding orchard dirt road
      [
        { x: 2, y: 9, terrain: 'soil' },
        { x: 3, y: 8, terrain: 'soil' },
        { x: 4, y: 7, terrain: 'soil' },
        { x: 5, y: 5, terrain: 'soil' },
        { x: 6, y: 4, terrain: 'soil' },
      ],
      // Moonlit autumn river across y=6 with 3 wooden bridges
      rect(0, 6, 9, 6, { terrain: 'water', elevation: 0 }),
      [
        { x: 2, y: 6, terrain: 'bridge', elevation: 0 },
        { x: 5, y: 6, terrain: 'bridge', elevation: 0 },
        { x: 8, y: 6, terrain: 'bridge', elevation: 0 },
      ],
      // Stepped Autumn Ridge (elevation 1 -> elevation 2 Bramblecoat Overlook!)
      rect(1, 3, 8, 4, { terrain: 'grass', elevation: 1 }),
      [
        { x: 2, y: 5, terrain: 'ramp', elevation: 0 },
        { x: 7, y: 5, terrain: 'ramp', elevation: 0 },
      ],
      rect(2, 0, 7, 2, { terrain: 'soil', elevation: 2 }),
      [
        { x: 4, y: 3, terrain: 'ramp', elevation: 1 },
        { x: 5, y: 3, terrain: 'ramp', elevation: 1 },
      ],
      // Compost, mud beds & Gopher Burrow warp pipes to the ridge!
      [
        { x: 0, y: 8, terrain: 'compost' },
        { x: 9, y: 8, terrain: 'compost' },
        { x: 3, y: 7, terrain: 'mud' },
        { x: 6, y: 7, terrain: 'mud' },
        { x: 0, y: 9, terrain: 'burrow' },
        { x: 1, y: 4, terrain: 'burrow', elevation: 1 },
        { x: 9, y: 9, terrain: 'burrow' },
        { x: 8, y: 4, terrain: 'burrow', elevation: 1 },
      ],
      // Orchard cover: thorny brambles, hay bales, crates, beehives & stones
      [
        { x: 1, y: 8, cover: 'haystack' },
        { x: 8, y: 8, cover: 'crate' },
        { x: 4, y: 8, cover: 'crate' },
        { x: 6, y: 5, cover: 'thorns' },
        { x: 3, y: 5, cover: 'beehive' },
        { x: 2, y: 4, cover: 'thorns' },
        { x: 7, y: 4, cover: 'haystack' },
        { x: 3, y: 2, cover: 'stone' },
        { x: 6, y: 2, cover: 'stone' },
        { x: 8, y: 3, cover: 'crate' },
      ]
    ),
    burrowPairs: [
      [{ x: 0, y: 9 }, { x: 1, y: 4 }],
      [{ x: 9, y: 9 }, { x: 8, y: 4 }],
    ],
    playerSpawns: [
      { x: 2, y: 11 },
      { x: 4, y: 10 },
      { x: 6, y: 10 },
      { x: 8, y: 11 },
    ],
    enemySpawns: [
      { blueprintId: 'harvester', x: 5, y: 1 },
      { blueprintId: 'trimmer', x: 1, y: 3 },
      { blueprintId: 'mower', x: 7, y: 3 },
      { blueprintId: 'sprayer', x: 4, y: 1 },
    ],
  },

  // ===== NEW MISSION TYPE 1: HOLD THE PATCH — SURVIVE 4 TURNS! =====
  barnyard_siege: {
    id: 'barnyard_siege',
    name: 'Barnyard Hilltop Siege',
    subtitle: 'Hold the garden knoll for 4 turns as farmer waves pour out of northern Gopher Burrows!',
    theme: 'spring',
    objective: 'survive',
    objectiveLabel: 'Hold the Patch — Survive 4 Turns',
    surviveTurns: 4,
    width: 9,
    height: 11,
    tiles: mergeTiles(
      // Raised defensive southern terrace (elevation 1) with central ramp & twin bounce pads
      rect(2, 6, 6, 8, { terrain: 'grass', elevation: 1 }),
      [
        { x: 4, y: 5, terrain: 'ramp', elevation: 0 },
        { x: 2, y: 5, terrain: 'bounce_pad', elevation: 0 },
        { x: 6, y: 5, terrain: 'bounce_pad', elevation: 0 },
      ],
      // Flanking creek channels + collapsible bridges
      rect(0, 4, 1, 4, { terrain: 'water', elevation: 0 }),
      rect(7, 4, 8, 4, { terrain: 'water', elevation: 0 }),
      [
        { x: 1, y: 4, terrain: 'bridge', elevation: 0 },
        { x: 7, y: 4, terrain: 'bridge', elevation: 0 },
      ],
      // Northern reinforcement Gopher Burrows + Compost beds on the hill
      [
        { x: 1, y: 1, terrain: 'burrow', elevation: 0 },
        { x: 7, y: 1, terrain: 'burrow', elevation: 0 },
        { x: 0, y: 8, terrain: 'burrow', elevation: 0 },
        { x: 8, y: 8, terrain: 'burrow', elevation: 0 },
        { x: 4, y: 7, terrain: 'compost', elevation: 1 },
        { x: 3, y: 3, terrain: 'mud' },
        { x: 5, y: 3, terrain: 'mud' },
      ],
      // Rolling Pumpkins perched on the ridge to bowl down attacking farmhands!
      [
        { x: 3, y: 6, cover: 'pumpkin' },
        { x: 5, y: 6, cover: 'pumpkin' },
        { x: 2, y: 7, cover: 'crate' },
        { x: 6, y: 7, cover: 'crate' },
        { x: 4, y: 4, cover: 'beehive' },
        { x: 2, y: 3, cover: 'haystack' },
        { x: 6, y: 3, cover: 'sprinkler' },
      ]
    ),
    burrowPairs: [
      [{ x: 0, y: 8 }, { x: 1, y: 1 }],
      [{ x: 8, y: 8 }, { x: 7, y: 1 }],
    ],
    playerSpawns: [
      { x: 1, y: 10 },
      { x: 3, y: 9 },
      { x: 5, y: 9 },
      { x: 7, y: 10 },
    ],
    enemySpawns: [
      { blueprintId: 'pitchfork', x: 3, y: 2 },
      { blueprintId: 'barrow', x: 5, y: 2 },
      { blueprintId: 'beekeeper', x: 4, y: 1 },
    ],
  },

  // ===== NEW MISSION TYPE 2: ESCORT THE GOLDEN SEED CART! =====
  harvest_railroad: {
    id: 'harvest_railroad',
    name: 'Golden Seed Convoy',
    subtitle: 'Escort the Golden Seed Cart north across twin bridges to the Gate — keep it safe!',
    theme: 'autumn',
    objective: 'escort',
    objectiveLabel: 'Escort the Golden Seed Cart to the North Gate',
    width: 9,
    height: 12,
    escortStartPos: { x: 4, y: 9 },
    tiles: mergeTiles(
      // North delivery gate
      [
        { x: 3, y: 0, terrain: 'gate', elevation: 0 },
        { x: 4, y: 0, terrain: 'gate', elevation: 0 },
        { x: 5, y: 0, terrain: 'gate', elevation: 0 },
      ],
      // Straight cobblestone/dirt convoy road down x=4
      rect(4, 1, 4, 10, { terrain: 'soil', elevation: 0 }),
      // Twin river crossings with wooden bridges!
      rect(0, 7, 8, 7, { terrain: 'water', elevation: 0 }),
      rect(0, 3, 8, 3, { terrain: 'water', elevation: 0 }),
      [
        { x: 2, y: 7, terrain: 'bridge', elevation: 0 },
        { x: 4, y: 7, terrain: 'bridge', elevation: 0 },
        { x: 6, y: 7, terrain: 'bridge', elevation: 0 },
        { x: 4, y: 3, terrain: 'bridge', elevation: 0 },
        { x: 7, y: 3, terrain: 'bridge', elevation: 0 },
      ],
      // Flanking high-ground escort overwatch hills (elevation 1) with Bouncy Mushrooms!
      rect(0, 4, 1, 6, { terrain: 'grass', elevation: 1 }),
      rect(7, 4, 8, 6, { terrain: 'grass', elevation: 1 }),
      [
        { x: 1, y: 8, terrain: 'bounce_pad', elevation: 0 },
        { x: 7, y: 8, terrain: 'bounce_pad', elevation: 0 },
        { x: 1, y: 6, terrain: 'ramp', elevation: 0 },
        { x: 7, y: 6, terrain: 'ramp', elevation: 0 },
        { x: 2, y: 5, terrain: 'compost', elevation: 0 },
        { x: 6, y: 5, terrain: 'sunbeam', elevation: 0 },
      ],
      // Cover & Rolling Pumpkins along the escort highway (never blocking x=4 road!)
      [
        { x: 3, y: 8, cover: 'crate' },
        { x: 5, y: 8, cover: 'crate' },
        { x: 3, y: 6, cover: 'pumpkin' },
        { x: 5, y: 6, cover: 'beehive' },
        { x: 2, y: 4, cover: 'haystack' },
        { x: 6, y: 4, cover: 'sprinkler' },
        { x: 3, y: 2, cover: 'crate' },
        { x: 5, y: 2, cover: 'pumpkin' },
      ]
    ),
    playerSpawns: [
      { x: 2, y: 11 },
      { x: 3, y: 10 },
      { x: 5, y: 10 },
      { x: 6, y: 11 },
    ],
    enemySpawns: [
      { blueprintId: 'pitchfork', x: 3, y: 5 },
      { blueprintId: 'barrow', x: 6, y: 5 },
      { blueprintId: 'mower', x: 2, y: 2 },
      { blueprintId: 'beekeeper', x: 6, y: 1 },
    ],
    gateTiles: [
      { x: 3, y: 0 },
      { x: 4, y: 0 },
      { x: 5, y: 0 },
    ],
  },

  duck_pond_meadow: {
    id: 'duck_pond_meadow',
    name: 'Duck Pond Meadow',
    subtitle: 'Cross lily-pad footbridges, warp through garden burrows & dunk farmhands into the spring pond!',
    theme: 'spring',
    objective: 'defeat_all',
    objectiveLabel: 'Clear the meadow watchcrew',
    width: 9,
    height: 11,
    burrowPairs: [
      [
        { x: 1, y: 9 },
        { x: 7, y: 2 },
      ],
      [
        { x: 7, y: 9 },
        { x: 1, y: 2 },
      ],
    ],
    tiles: mergeTiles(
      // Winding central lily-pad duck pond with center islet & 4 wooden footbridges
      rect(2, 4, 6, 6, { terrain: 'water', elevation: 0 }),
      rect(3, 5, 5, 5, { terrain: 'grass', elevation: 0 }),
      [
        { x: 4, y: 4, terrain: 'bridge', elevation: 0 },
        { x: 4, y: 6, terrain: 'bridge', elevation: 0 },
        { x: 2, y: 5, terrain: 'bridge', elevation: 0 },
        { x: 6, y: 5, terrain: 'bridge', elevation: 0 },
        { x: 4, y: 5, terrain: 'sunbeam', elevation: 0 },
      ],
      // Flanking raised grassy banks (elevation 1) with ramps & bounce pad
      rect(0, 3, 1, 7, { terrain: 'grass', elevation: 1 }),
      rect(7, 3, 8, 7, { terrain: 'grass', elevation: 1 }),
      [
        { x: 0, y: 8, terrain: 'ramp', elevation: 0 },
        { x: 8, y: 8, terrain: 'ramp', elevation: 0 },
        { x: 0, y: 2, terrain: 'ramp', elevation: 0 },
        { x: 8, y: 2, terrain: 'ramp', elevation: 0 },
        { x: 4, y: 8, terrain: 'bounce_pad', elevation: 0 },
        { x: 1, y: 9, terrain: 'burrow', elevation: 0 },
        { x: 7, y: 2, terrain: 'burrow', elevation: 0 },
        { x: 7, y: 9, terrain: 'burrow', elevation: 0 },
        { x: 1, y: 2, terrain: 'burrow', elevation: 0 },
        { x: 3, y: 8, terrain: 'compost', elevation: 0 },
      ],
      // Storybook meadow cover & hazards
      [
        { x: 2, y: 8, cover: 'crate' },
        { x: 6, y: 8, cover: 'crate' },
        { x: 1, y: 5, cover: 'stone' },
        { x: 7, y: 5, cover: 'stone' },
        { x: 3, y: 5, cover: 'beehive' },
        { x: 5, y: 5, cover: 'sprinkler' },
        { x: 3, y: 2, cover: 'haystack' },
        { x: 5, y: 2, cover: 'crate' },
      ]
    ),
    playerSpawns: [
      { x: 2, y: 10 },
      { x: 3, y: 9 },
      { x: 5, y: 9 },
      { x: 6, y: 10 },
    ],
    enemySpawns: [
      { blueprintId: 'blower', x: 2, y: 2 },
      { blueprintId: 'sapper', x: 6, y: 2 },
      { blueprintId: 'digger', x: 0, y: 4 },
      { blueprintId: 'trimmer', x: 8, y: 4 },
    ],
  },

  botanical_rotunda: {
    id: 'botanical_rotunda',
    name: 'Botanical Rotunda',
    subtitle: 'Seize the elevated central sunbeam pedestal while dodging Tin-Can Tank’s pressure blasts!',
    theme: 'greenhouse',
    objective: 'defeat_all',
    objectiveLabel: 'Liberate the glasshouse rotunda',
    width: 9,
    height: 11,
    tiles: mergeTiles(
      // Raised central glasshouse rotunda (elevation 1) + high sunlit dome plinth (elevation 2)
      rect(2, 3, 6, 7, { terrain: 'barn_floor', elevation: 1 }),
      rect(3, 4, 5, 6, { terrain: 'grass', elevation: 1 }),
      [
        { x: 4, y: 5, terrain: 'sunbeam', elevation: 2 },
        { x: 4, y: 6, terrain: 'ramp', elevation: 1 },
        { x: 4, y: 4, terrain: 'ramp', elevation: 1 },
        // Four cardinal ramps into the rotunda
        { x: 4, y: 8, terrain: 'ramp', elevation: 0 },
        { x: 4, y: 2, terrain: 'ramp', elevation: 0 },
        { x: 1, y: 5, terrain: 'ramp', elevation: 0 },
        { x: 7, y: 5, terrain: 'ramp', elevation: 0 },
        // Flanking bounce pads & garden pools
        { x: 1, y: 7, terrain: 'bounce_pad', elevation: 0 },
        { x: 7, y: 7, terrain: 'bounce_pad', elevation: 0 },
        { x: 0, y: 4, terrain: 'water', elevation: 0 },
        { x: 0, y: 6, terrain: 'water', elevation: 0 },
        { x: 8, y: 4, terrain: 'water', elevation: 0 },
        { x: 8, y: 6, terrain: 'water', elevation: 0 },
        { x: 2, y: 8, terrain: 'compost', elevation: 0 },
        { x: 6, y: 8, terrain: 'sunbeam', elevation: 0 },
      ],
      // Potted cover ring & hazards
      [
        { x: 3, y: 8, cover: 'crate' },
        { x: 5, y: 8, cover: 'crate' },
        { x: 2, y: 6, cover: 'stone' },
        { x: 6, y: 6, cover: 'stone' },
        { x: 2, y: 4, cover: 'beehive' },
        { x: 6, y: 4, cover: 'sprinkler' },
        { x: 3, y: 3, cover: 'pumpkin' },
        { x: 5, y: 3, cover: 'pumpkin' },
        { x: 3, y: 1, cover: 'haystack' },
        { x: 5, y: 1, cover: 'crate' },
      ]
    ),
    playerSpawns: [
      { x: 1, y: 10 },
      { x: 3, y: 9 },
      { x: 5, y: 9 },
      { x: 7, y: 10 },
    ],
    enemySpawns: [
      { blueprintId: 'kettlebot', x: 4, y: 2 },
      { blueprintId: 'beekeeper', x: 2, y: 2 },
      { blueprintId: 'blower', x: 6, y: 2 },
      { blueprintId: 'sprayer', x: 4, y: 0 },
    ],
  },

  cider_mill_yard: {
    id: 'cider_mill_yard',
    name: 'Cider Mill Courtyard',
    subtitle: 'Storm the autumn millstream bridges, bowl heirloom pumpkins & topple the armored mill guards!',
    theme: 'autumn',
    objective: 'defeat_all',
    objectiveLabel: 'Clear the Cider Mill courtyard',
    width: 9,
    height: 12,
    tiles: mergeTiles(
      // Autumn millstream crossing y=7 with 3 wooden bridges
      rect(0, 7, 8, 7, { terrain: 'water', elevation: 0 }),
      [
        { x: 1, y: 7, terrain: 'bridge', elevation: 0 },
        { x: 4, y: 7, terrain: 'bridge', elevation: 0 },
        { x: 7, y: 7, terrain: 'bridge', elevation: 0 },
      ],
      // Mid-level stone mill apron (elevation 1) & elevated Cider Loft (elevation 2)
      rect(1, 3, 7, 5, { terrain: 'soil', elevation: 1 }),
      rect(5, 0, 8, 2, { terrain: 'barn_floor', elevation: 2 }),
      [
        { x: 2, y: 6, terrain: 'ramp', elevation: 0 },
        { x: 6, y: 6, terrain: 'ramp', elevation: 0 },
        { x: 5, y: 3, terrain: 'ramp', elevation: 1 },
        { x: 4, y: 8, terrain: 'bounce_pad', elevation: 0 },
        { x: 7, y: 5, terrain: 'bounce_pad', elevation: 1 },
        { x: 2, y: 4, terrain: 'sunbeam', elevation: 1 },
        { x: 6, y: 1, terrain: 'sunbeam', elevation: 2 },
        { x: 3, y: 9, terrain: 'compost', elevation: 0 },
        { x: 0, y: 5, terrain: 'mud', elevation: 0 },
      ],
      // Barrels, rolling pumpkins, haystacks & mill crates
      [
        { x: 2, y: 9, cover: 'crate' },
        { x: 6, y: 9, cover: 'haystack' },
        { x: 3, y: 5, cover: 'pumpkin' },
        { x: 5, y: 5, cover: 'crate' },
        { x: 2, y: 3, cover: 'stone' },
        { x: 4, y: 3, cover: 'beehive' },
        { x: 6, y: 3, cover: 'pumpkin' },
        { x: 6, y: 2, cover: 'crate' },
        { x: 7, y: 2, cover: 'haystack' },
      ]
    ),
    playerSpawns: [
      { x: 1, y: 11 },
      { x: 3, y: 10 },
      { x: 5, y: 10 },
      { x: 7, y: 11 },
    ],
    enemySpawns: [
      { blueprintId: 'digger', x: 6, y: 1 },
      { blueprintId: 'sapper', x: 2, y: 2 },
      { blueprintId: 'kettlebot', x: 4, y: 4 },
      { blueprintId: 'blower', x: 7, y: 4 },
    ],
  },
};
