import { describe, expect, it } from 'vitest';
import { MAP_TEMPLATES } from '../../data/maps';
import { ACTS, FLOORS_PER_ACT, MAX_LANES, actRng, bossNodeId, createRng, generateActNodes } from '../mapgen';
import {
  applyBattleOutcomeToRun,
  createNewRun,
  defaultMetaProgress,
  getAvailableNextNodeIds,
  migrateSavedRun,
} from '../run';
import { createBattleFromMap } from '../battle';
import type { RunState, SeasonNode } from '../types';

function byId(nodes: SeasonNode[]): Map<string, SeasonNode> {
  return new Map(nodes.map((n) => [n.id, n]));
}

describe('procedural run map', () => {
  const seeds = Array.from({ length: 200 }, (_, i) => i * 7919 + 1);

  it('is deterministic for a given seed', () => {
    const a = generateActNodes(0, actRng(12345, 0));
    const b = generateActNodes(0, actRng(12345, 0));
    expect(a).toEqual(b);
    const c = generateActNodes(0, actRng(54321, 0));
    expect(c).not.toEqual(a);
  });

  it('produces a well-formed, fully connected act for many seeds', () => {
    for (const seed of seeds) {
      for (let act = 0; act < ACTS.length; act++) {
        const nodes = generateActNodes(act, actRng(seed, act));
        const map = byId(nodes);
        const boss = map.get(bossNodeId(act))!;
        expect(boss.type).toBe('boss');
        expect(boss.mapId).toBe(ACTS[act].boss.mapId);
        expect(nodes.filter((n) => n.type === 'boss')).toHaveLength(1);

        // At least two starting choices on floor 1.
        expect(nodes.filter((n) => n.stage === 0).length).toBeGreaterThanOrEqual(2);

        for (const n of nodes) {
          expect(n.lane).toBeGreaterThanOrEqual(0);
          expect(n.lane).toBeLessThan(MAX_LANES);
          // Every non-boss node has a way forward, one floor up, at most one lane sideways.
          if (n.type !== 'boss') expect(n.nextIds.length).toBeGreaterThan(0);
          for (const id of n.nextIds) {
            const next = map.get(id)!;
            expect(next).toBeDefined();
            expect(next.stage).toBe(n.stage + 1);
            if (next.type !== 'boss') expect(Math.abs(next.lane - n.lane)).toBeLessThanOrEqual(1);
          }
          // Every battle node points at a real battlefield.
          if (n.type !== 'vault' && n.type !== 'shop') {
            expect(MAP_TEMPLATES[n.mapId!]).toBeDefined();
          }
        }

        // Every node except the first floor is reachable from the floor below.
        const reachable = new Set(nodes.filter((n) => n.stage === 0).map((n) => n.id));
        for (let f = 0; f <= FLOORS_PER_ACT; f++) {
          for (const n of nodes.filter((x) => x.stage === f && reachable.has(x.id))) {
            n.nextIds.forEach((id) => reachable.add(id));
          }
        }
        expect(reachable.size).toBe(nodes.length);

        // Rules: fights first, rest stop right before the boss, a market and an elite exist.
        expect(nodes.filter((n) => n.stage === 0).every((n) => n.type === 'skirmish')).toBe(true);
        expect(nodes.filter((n) => n.stage === FLOORS_PER_ACT - 1).every((n) => n.type === 'vault')).toBe(true);
        expect(nodes.some((n) => n.type === 'shop')).toBe(true);
        expect(nodes.some((n) => n.type === 'elite')).toBe(true);
        expect(nodes.filter((n) => n.stage < 2).some((n) => n.type === 'elite')).toBe(false);
      }
    }
  });

  it('never draws crossing paths between two floors', () => {
    for (const seed of seeds) {
      const nodes = generateActNodes(0, actRng(seed, 0));
      const edges = nodes
        .filter((n) => n.type !== 'boss' && n.stage < FLOORS_PER_ACT - 1)
        .flatMap((n) => n.nextIds.map((id) => ({ floor: n.stage, from: n.lane, to: byId(nodes).get(id)!.lane })));
      for (const e of edges) {
        for (const o of edges) {
          if (e.floor !== o.floor) continue;
          const crossing = (e.from < o.from && e.to > o.to) || (e.from > o.from && e.to < o.to);
          expect(crossing).toBe(false);
        }
      }
    }
  });

  it('createRng yields values in [0, 1)', () => {
    const rng = createRng(1);
    for (let i = 0; i < 1000; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('multi-act runs', () => {
  it('starts in Act 1 with every first-floor node available', () => {
    const run = createNewRun(defaultMetaProgress(), 'spring', 42);
    expect(run.act).toBe(0);
    expect(run.seed).toBe(42);
    expect(run.seasonName).toContain('Act 1');
    const starts = getAvailableNextNodeIds(run);
    expect(starts.length).toBeGreaterThanOrEqual(2);
    expect(starts.every((id) => run.nodes.find((n) => n.id === id)!.stage === 0)).toBe(true);
  });

  it('carries the squad into Summer after beating the Spring boss, and ends the run after the final boss', () => {
    const meta = defaultMetaProgress();
    const run = createNewRun(meta, 'spring', 7);
    const heroes = run.roster.slice(0, 4);

    run.currentNodeId = bossNodeId(0);
    const springBoss = createBattleFromMap('scarecrow_stand', heroes, [], run.items);
    springBoss.status = 'victory';
    applyBattleOutcomeToRun(run, springBoss, meta);

    expect(run.status).toBe('reward');
    expect(run.act).toBe(1);
    expect(run.seasonId).toBe('summer');
    expect(run.completedNodeIds).toEqual([]);
    expect(run.nodes.find((n) => n.type === 'boss')!.mapId).toBe('combine_throne');
    expect(meta.runsWon).toBe(0);

    run.currentNodeId = bossNodeId(1);
    const summerBoss = createBattleFromMap('combine_throne', heroes, [], run.items);
    summerBoss.status = 'victory';
    applyBattleOutcomeToRun(run, summerBoss, meta);
    expect(run.status).toBe('victory');
    expect(meta.runsWon).toBe(1);
  });

  it('migrates saves from before acts existed', () => {
    const legacy = createNewRun(defaultMetaProgress(), 'summer', 1) as Partial<RunState>;
    delete legacy.act;
    delete legacy.seed;
    const migrated = migrateSavedRun(legacy as RunState);
    expect(migrated.act).toBe(1);
    expect(typeof migrated.seed).toBe('number');
  });
});
