import { describe, expect, it } from 'vitest';
import { MAP_TEMPLATES } from '../../data/maps';
import {
  ACTS,
  actRng,
  bossNodeId,
  createRng,
  drawTravelHand,
  generateActNodes,
  getReachableBoardTargets,
  startNodeId,
} from '../mapgen';
import {
  applyBattleOutcomeToRun,
  applyTravelCardMove,
  claimShrineBlessing,
  createNewRun,
  defaultMetaProgress,
  getAvailableNextNodeIds,
  getBoardPathsForCard,
  migrateSavedRun,
  openShrineNode,
} from '../run';
import { createBattleFromMap } from '../battle';
import type { RunState, SeasonNode } from '../types';

function byId(nodes: SeasonNode[]): Map<string, SeasonNode> {
  return new Map(nodes.map((n) => [n.id, n]));
}

describe('seasonal watercolor tabletop boardgame overworld', () => {
  const seeds = Array.from({ length: 120 }, (_, i) => i * 7919 + 1);

  it('is deterministic for a given seed across all 3 seasonal boards', () => {
    const a = generateActNodes(0, actRng(12345, 0));
    const b = generateActNodes(0, actRng(12345, 0));
    expect(a).toEqual(b);
    const c = generateActNodes(0, actRng(54321, 0));
    expect(c).not.toEqual(a);
  });

  it('produces connected 16-space seasonal boards with valid coordinates, shrines, armories, markets, elites & boss', () => {
    for (const seed of seeds) {
      for (let act = 0; act < ACTS.length; act++) {
        const nodes = generateActNodes(act, actRng(seed, act));
        const map = byId(nodes);
        const start = map.get(startNodeId(act))!;
        const boss = map.get(bossNodeId(act))!;

        expect(start.type).toBe('start');
        expect(start.completed).toBe(true);
        expect(boss.type).toBe('boss');
        expect(boss.mapId).toBe(ACTS[act].boss.mapId);
        expect(nodes.filter((n) => n.type === 'boss')).toHaveLength(1);
        expect(nodes.length).toBe(16);

        // Every space has valid normalized watercolor board coordinates (0..1)
        for (const n of nodes) {
          expect(n.boardX).toBeGreaterThan(0);
          expect(n.boardX).toBeLessThan(1);
          expect(n.boardY).toBeGreaterThan(0);
          expect(n.boardY).toBeLessThan(1);
          if (n.type !== 'boss') expect(n.nextIds.length).toBeGreaterThan(0);
          for (const id of [...n.nextIds, ...(n.shortcutIds ?? [])]) {
            expect(map.get(id)).toBeDefined();
          }
          if (['skirmish', 'escape', 'barn_rescue', 'elite', 'boss'].includes(n.type)) {
            expect(MAP_TEMPLATES[n.mapId!]).toBeDefined();
          }
        }

        // BFS from start reaches every single space on the board!
        const visited = new Set<string>([start.id]);
        const queue = [start.id];
        while (queue.length > 0) {
          const cur = map.get(queue.shift()!)!;
          for (const nxt of [...cur.nextIds, ...(cur.shortcutIds ?? [])]) {
            if (!visited.has(nxt)) {
              visited.add(nxt);
              queue.push(nxt);
            }
          }
        }
        expect(visited.size).toBe(nodes.length);

        // Guaranteed boardgame landmarks in every Act
        expect(nodes.some((n) => n.type === 'shop')).toBe(true);
        expect(nodes.some((n) => n.type === 'shrine')).toBe(true);
        expect(nodes.some((n) => n.type === 'armory')).toBe(true);
        expect(nodes.some((n) => n.type === 'elite')).toBe(true);
        expect(nodes.some((n) => n.type === 'vault')).toBe(true);
      }
    }
  });

  it('draws 3-card Travel Hands with multi-step board paths and never overshoots the Act Boss', () => {
    const run = createNewRun(defaultMetaProgress(), 'spring', 42);
    expect(run.travelHand).toHaveLength(3);
    expect(run.travelHand!.some((c) => c.steps === 1)).toBe(true);

    // 1-step card reaches stage-1 battle forks; 2-step or 3-step cards reach deeper spaces with full step-by-step hop paths!
    const step1Card = run.travelHand!.find((c) => c.steps === 1)!;
    const paths1 = getBoardPathsForCard(run, step1Card.id);
    expect(paths1.size).toBeGreaterThanOrEqual(2);
    for (const [destId, path] of paths1.entries()) {
      expect(path[0]).toBe(run.currentNodeId);
      expect(path[path.length - 1]).toBe(destId);
      expect(path.length).toBe(2);
    }

    // Applying a 3-step Sprint card grants Next-Battle Boost, advances boardTurn, and redraws a fresh 3-card hand!
    const sprintCard = {
      id: 'test_sprint',
      name: 'Harvest Sprint',
      steps: 3,
      bonus: 'boost' as const,
      icon: '💨',
      desc: 'Advance 3 spaces',
      tint: 'crimson' as const,
    };
    run.travelHand = [sprintCard, ...drawTravelHand(createRng(99)).slice(0, 2)];
    const sprintTargets = getReachableBoardTargets(run.nodes, run.currentNodeId, sprintCard);
    expect(sprintTargets.size).toBeGreaterThan(0);
    const firstSprintDest = Array.from(sprintTargets.keys())[0];
    const movedPath = applyTravelCardMove(run, 'test_sprint', firstSprintDest, createRng(7));
    expect(movedPath).not.toBeNull();
    expect(movedPath!.length).toBe(4); // start + 3 hops
    expect(run.boardTurn).toBe(1);
    expect(run.nextBattleBuff?.boost).toBe(true);
    expect(run.travelHand).toHaveLength(3);

    // Standing on a Vault right before Boss: even a 3-step Sprint stops cleanly on the Boss!
    const preBossVault = run.nodes.find((n) => n.nextIds.includes(bossNodeId(0)))!;
    const bossReach = getReachableBoardTargets(run.nodes, preBossVault.id, sprintCard);
    expect(bossReach.has(bossNodeId(0))).toBe(true);
  });

  it('supports Watering Shrine blessings on the boardgame overworld', () => {
    const run = createNewRun(defaultMetaProgress(), 'spring', 123);
    const shrine = run.nodes.find((n) => n.type === 'shrine')!;
    expect(shrine).toBeDefined();

    run.roster[0].hp = 3;
    expect(openShrineNode(run, shrine.id)).toBe(true);
    expect(run.status).toBe('shrine');
    expect(claimShrineBlessing(run, 'blessing')).toBe(true);
    expect(run.status).toBe('map');
    expect(run.nextBattleBuff?.boost).toBe(true);
    expect(run.nextBattleBuff?.shield).toBe(true);
    expect(run.nextBattleBuff?.moveBonus).toBe(1);
    expect(shrine.completed).toBe(true);
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

describe('multi-act boardgame runs', () => {
  it('starts in Act 1 on the Starting Gate with reachable spaces available', () => {
    const run = createNewRun(defaultMetaProgress(), 'spring', 42);
    expect(run.act).toBe(0);
    expect(run.seed).toBe(42);
    expect(run.seasonName).toContain('Act 1');
    expect(run.currentNodeId).toBe(startNodeId(0));
    const starts = getAvailableNextNodeIds(run);
    expect(starts.length).toBeGreaterThanOrEqual(2);
  });

  it('carries the squad from Spring to Summer to Autumn boards, and ends the run after the Autumn boss', () => {
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
    expect(run.completedNodeIds).toEqual([startNodeId(1)]);
    expect(run.nodes.find((n) => n.type === 'boss')!.mapId).toBe('combine_throne');
    expect(meta.runsWon).toBe(0);

    run.currentNodeId = bossNodeId(1);
    const summerBoss = createBattleFromMap('combine_throne', heroes, [], run.items);
    summerBoss.status = 'victory';
    applyBattleOutcomeToRun(run, summerBoss, meta);
    expect(run.status).toBe('reward');
    expect(run.act).toBe(2);
    expect(run.seasonId).toBe('autumn');
    expect(run.nodes.find((n) => n.type === 'boss')!.mapId).toBe('orchard_clearing');
    expect(meta.runsWon).toBe(0);

    run.currentNodeId = bossNodeId(2);
    const autumnBoss = createBattleFromMap('orchard_clearing', heroes, [], run.items);
    expect(autumnBoss.theme).toBe('autumn');
    expect(autumnBoss.units.find((u) => u.isBoss)?.visualKind).toBe('harvester');
    autumnBoss.status = 'victory';
    applyBattleOutcomeToRun(run, autumnBoss, meta);
    expect(run.status).toBe('victory');
    expect(meta.runsWon).toBe(1);
  });

  it('migrates legacy saves cleanly into seasonal boardgame format', () => {
    const legacy = createNewRun(defaultMetaProgress(), 'summer', 1) as Partial<RunState>;
    delete legacy.act;
    delete legacy.seed;
    delete legacy.travelHand;
    const migrated = migrateSavedRun(legacy as RunState);
    expect(migrated.act).toBe(1);
    expect(typeof migrated.seed).toBe('number');
    expect(migrated.travelHand?.length).toBe(3);
  });
});
