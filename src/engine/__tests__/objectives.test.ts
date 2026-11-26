import { describe, expect, it } from 'vitest';
import { MAP_TEMPLATES } from '../../data/maps';
import { createBattleFromMap, executeMove, startPhase } from '../battle';
import { battleRng } from '../difficulty';
import { rollObjectiveForNode, routTargetFor, type RolledObjective } from '../objectives';
import { createNewRun, defaultMetaProgress } from '../run';

const defeatAllMaps = Object.values(MAP_TEMPLATES).filter((m) => m.objective === 'defeat_all');

function battleWith(mapId: string, objective: RolledObjective) {
  const run = createNewRun(defaultMetaProgress());
  return createBattleFromMap(mapId, run.roster.slice(0, 4), [], run.items, undefined, {
    rng: battleRng(run.seed, 'n1'),
    objective,
  });
}

describe('objectives that roll per battle', () => {
  it('rolls the same objective for the same seed and node, and varies across nodes', () => {
    const node = { id: 'a0-s2-l1', type: 'skirmish' as const, mapId: defeatAllMaps[0].id };
    expect(rollObjectiveForNode(1234, node)).toBe(rollObjectiveForNode(1234, node));
    const seen = new Set<string | null>();
    for (let i = 0; i < 200; i++) seen.add(rollObjectiveForNode(i, node));
    expect(seen).toEqual(new Set(['defeat_all', 'rout', 'reach_gate', 'survive']));
  });

  it('leaves hand-made objective maps, bosses and non-battle stops alone', () => {
    expect(rollObjectiveForNode(1, { id: 'x', type: 'skirmish', mapId: 'barn_raid' })).toBeNull();
    expect(rollObjectiveForNode(1, { id: 'x', type: 'boss', mapId: 'scarecrow_stand' })).toBeNull();
    expect(rollObjectiveForNode(1, { id: 'x', type: 'shop' })).toBeNull();
    for (let i = 0; i < 100; i++) {
      const elite = rollObjectiveForNode(i, { id: 'e', type: 'elite', mapId: defeatAllMaps[0].id });
      expect(['defeat_all', 'rout']).toContain(elite);
    }
  });

  it('wins a Rout once enough farmers are bonked', () => {
    const battle = battleWith('vegetable_patch', 'rout');
    const foes = battle.units.filter((u) => u.team === 'enemy');
    expect(battle.objective).toBe('rout');
    expect(battle.routTarget).toBe(routTargetFor(foes.length));
    expect(battle.routTarget!).toBeLessThan(foes.length + 1);

    battle.prepPhase = false;
    for (let i = 0; i < battle.routTarget! - 1; i++) foes[i].alive = false;
    startPhase(battle, 'enemy');
    startPhase(battle, 'player');
    expect(battle.status).toBe('ongoing');

    foes[battle.routTarget! - 1].alive = false;
    startPhase(battle, 'enemy');
    expect(battle.status).toBe('victory');
    expect(foes.some((f) => f.alive) || foes.length === battle.routTarget).toBe(true);
  });

  it('places a side-by-side gate on the back row of every defeat-all map', () => {
    for (const map of defeatAllMaps) {
      const battle = battleWith(map.id, 'reach_gate');
      expect(battle.objective, map.id).toBe('reach_gate');
      expect(battle.gateTiles.length, map.id).toBeGreaterThanOrEqual(2);
      const xs = battle.gateTiles.map((g) => g.x);
      expect(Math.max(...xs) - Math.min(...xs), map.id).toBe(xs.length - 1);
      for (const g of battle.gateTiles) {
        expect(g.y).toBe(0);
        expect(battle.tiles[0][g.x].terrain).toBe('gate');
        expect(battle.tiles[0][g.x].cover).toBeNull();
      }
      expect(battle.parTurns, map.id).toBeGreaterThanOrEqual(2);
    }
  });

  it('wins a Breakout when a hero steps onto the gate', () => {
    const battle = battleWith('creek_crossing', 'reach_gate');
    battle.prepPhase = false;
    const hero = battle.units.find((u) => u.team === 'player')!;
    const gate = battle.gateTiles[0];
    const below = { x: gate.x, y: 1 };
    battle.tiles[1][gate.x].terrain = 'grass';
    battle.tiles[1][gate.x].elevation = battle.tiles[0][gate.x].elevation;
    battle.tiles[1][gate.x].cover = null;
    battle.units.forEach((u, i) => {
      if (u.id !== hero.id) u.pos = { x: i % battle.width, y: battle.height - 1 - Math.floor(i / battle.width) };
    });
    hero.pos = below;
    hero.statuses = [];
    expect(executeMove(battle, hero.id, gate)).toBe(true);
    expect(battle.status).toBe('victory');
  });

  it('turns a map into a 4-turn Hold', () => {
    const battle = battleWith('apiary_ambush', 'survive');
    expect(battle.objective).toBe('survive');
    expect(battle.surviveTurns).toBe(4);
    expect(battle.parTurns).toBe(4);
  });
});
