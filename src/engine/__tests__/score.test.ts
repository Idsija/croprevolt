import { describe, expect, it } from 'vitest';
import { createDailyRun, createNewRun, defaultMetaProgress, generateRewardForNode } from '../run';
import {
  BOARD_SIZE,
  computeRunScore,
  dailyKeyFor,
  dailySeedFor,
  insertScore,
  rankOf,
  scoreEntryForRun,
  topDailyScores,
  topStandardScores,
  type ScoreEntry,
} from '../score';

function entry(over: Partial<ScoreEntry>): ScoreEntry {
  return {
    id: 'r1', score: 100, at: '2026-11-26T10:00:00.000Z', mode: 'standard',
    heat: 0, victory: false, act: 1, battlesWon: 1, seed: 1, ...over,
  };
}

describe('run score', () => {
  it('adds up the breakdown lines and applies the heat multiplier', () => {
    const run = createNewRun(defaultMetaProgress(), 'spring', 42, 0);
    run.battlesWon = 5;
    run.enemiesDefeated = 20;
    run.battleTurns = 30; // par is 40, so 10 under
    const base = computeRunScore(run);
    expect(base.subtotal).toBe(base.lines.reduce((s, l) => s + l.points, 0));
    expect(base.total).toBe(5 * 100 + 20 * 10 + 10 * 15 + run.roster.length * 50);

    run.harvestHeat = 5;
    expect(computeRunScore(run).total).toBe(base.total * 2);
  });

  it('rewards winning, going further and playing faster', () => {
    const run = createNewRun(defaultMetaProgress(), 'spring', 42, 0);
    run.battlesWon = 6;
    run.battleTurns = 60;
    const slow = computeRunScore(run).total;
    run.battleTurns = 30;
    const fast = computeRunScore(run).total;
    expect(fast).toBeGreaterThan(slow);
    run.act = 2;
    const deeper = computeRunScore(run).total;
    expect(deeper).toBeGreaterThan(fast);
    run.status = 'victory';
    expect(computeRunScore(run).total).toBeGreaterThan(deeper);
  });
});

describe('daily run', () => {
  it('gives the same seed, map and rewards to everyone on the same UTC day', () => {
    const morning = new Date('2026-11-26T00:05:00Z');
    const night = new Date('2026-11-26T23:55:00Z');
    expect(dailyKeyFor(morning)).toBe('2026-11-26');
    const a = createDailyRun(morning);
    const b = createDailyRun(night);
    expect(a.mode).toBe('daily');
    expect(a.seed).toBe(dailySeedFor('2026-11-26'));
    expect(b.nodes.map((n) => `${n.id}:${n.type}:${n.mapId}`)).toEqual(
      a.nodes.map((n) => `${n.id}:${n.type}:${n.mapId}`)
    );
    expect(b.travelHand?.map((c) => c.name)).toEqual(a.travelHand?.map((c) => c.name));
    const node = a.nodes.find((n) => n.type === 'skirmish')!;
    const rewardA = generateRewardForNode(a, node);
    const rewardB = generateRewardForNode(b, b.nodes.find((n) => n.id === node.id)!);
    expect(rewardB.graftChoices).toEqual(rewardA.graftChoices);
    expect(rewardB.seedsEarned).toBe(rewardA.seedsEarned);
  });

  it('changes the next day and ignores Seed Shed perks and heat', () => {
    expect(dailySeedFor('2026-11-27')).not.toBe(dailySeedFor('2026-11-26'));
    const run = createDailyRun(new Date('2026-11-26T12:00:00Z'));
    expect(run.harvestHeat).toBe(0);
    expect(run.relicIds).toEqual([]);
  });
});

describe('leaderboard', () => {
  it('keeps the top scores per board, best first', () => {
    let board: ScoreEntry[] = [];
    for (let i = 0; i < BOARD_SIZE + 5; i++) {
      board = insertScore(board, entry({ id: `s${i}`, score: i * 10 }));
    }
    const top = topStandardScores(board);
    expect(top).toHaveLength(BOARD_SIZE);
    expect(top[0].score).toBe((BOARD_SIZE + 4) * 10);
    expect(rankOf(board, entry({ id: 's0', score: 0 }))).toBe(0);
  });

  it('keeps daily boards apart from standard runs and from other days', () => {
    let board: ScoreEntry[] = [];
    board = insertScore(board, entry({ id: 'std', score: 900 }));
    board = insertScore(board, entry({ id: 'd1', score: 300, mode: 'daily', dailyKey: '2026-11-26' }));
    board = insertScore(board, entry({ id: 'd2', score: 500, mode: 'daily', dailyKey: '2026-11-26' }));
    board = insertScore(board, entry({ id: 'old', score: 999, mode: 'daily', dailyKey: '2026-11-25' }));
    expect(topDailyScores(board, '2026-11-26').map((e) => e.id)).toEqual(['d2', 'd1']);
    expect(topStandardScores(board).map((e) => e.id)).toEqual(['std']);
    expect(rankOf(board, entry({ id: 'd1', mode: 'daily', dailyKey: '2026-11-26' }))).toBe(2);
  });

  it('does not list the same run twice', () => {
    const run = createDailyRun(new Date('2026-11-26T12:00:00Z'));
    const e = scoreEntryForRun(run, new Date('2026-11-26T13:00:00Z'));
    expect(e.mode).toBe('daily');
    expect(insertScore(insertScore([], e), e)).toHaveLength(1);
  });
});
