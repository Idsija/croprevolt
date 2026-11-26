import { describe, expect, it } from 'vitest';
import { ACHIEVEMENTS, emptyHistory, HISTORY_RUNS_KEPT, runRecordFor, withRun, type RunRecord } from '../history';
import { createNewRun, defaultMetaProgress } from '../run';

function rec(over: Partial<RunRecord>): RunRecord {
  return {
    id: 'r', at: '2026-11-26T10:00:00.000Z', score: 500, mode: 'standard', heat: 0, victory: false,
    act: 1, battlesWon: 3, enemiesDefeated: 10, battleTurns: 20, heroesLost: 1, ...over,
  };
}

describe('run history', () => {
  it('tracks lifetime records and keeps a bounded list, newest first', () => {
    let state = emptyHistory();
    for (let i = 0; i < HISTORY_RUNS_KEPT + 3; i++) {
      state = withRun(state, rec({ id: `r${i}`, score: 100 * i, enemiesDefeated: 2 })).state;
    }
    expect(state.runs).toHaveLength(HISTORY_RUNS_KEPT);
    expect(state.runs[0].id).toBe(`r${HISTORY_RUNS_KEPT + 2}`);
    expect(state.stats.runs).toBe(HISTORY_RUNS_KEPT + 3);
    expect(state.stats.bestScore).toBe(100 * (HISTORY_RUNS_KEPT + 2));
    expect(state.stats.enemiesDefeated).toBe(2 * (HISTORY_RUNS_KEPT + 3));
  });

  it('records the fastest and hottest wins only from wins', () => {
    let state = withRun(emptyHistory(), rec({ id: 'loss', heat: 4, battleTurns: 5 })).state;
    expect(state.stats.highestHeatWon).toBe(-1);
    expect(state.stats.fastestWinTurns).toBe(0);
    state = withRun(state, rec({ id: 'w1', victory: true, act: 3, heat: 2, battleTurns: 90 })).state;
    state = withRun(state, rec({ id: 'w2', victory: true, act: 3, heat: 1, battleTurns: 70 })).state;
    expect(state.stats).toMatchObject({ wins: 2, highestHeatWon: 2, fastestWinTurns: 70, furthestAct: 3 });
  });

  it('builds a record from a run', () => {
    const run = createNewRun(defaultMetaProgress(), 'spring', 3, 2);
    run.roster[0].harvested = true;
    run.status = 'defeat';
    expect(runRecordFor(run)).toMatchObject({ mode: 'standard', heat: 2, victory: false, act: 1, heroesLost: 1 });
  });
});

describe('achievements', () => {
  it('have unique ids and a seed reward', () => {
    expect(new Set(ACHIEVEMENTS.map((a) => a.id)).size).toBe(ACHIEVEMENTS.length);
    for (const a of ACHIEVEMENTS) expect(a.seeds).toBeGreaterThan(0);
  });

  it('are earned once', () => {
    const first = withRun(emptyHistory(), rec({ id: 'a' }));
    expect(first.earned.map((a) => a.id)).toEqual(['first_harvest']);
    const again = withRun(first.state, rec({ id: 'b' }));
    expect(again.earned).toEqual([]);
    expect(withRun(again.state, rec({ id: 'b' })).state).toBe(again.state);
  });

  it('unlock on wins, heat, flawless runs, dailies and streaks', () => {
    const win = withRun(emptyHistory(), rec({ id: 'w', victory: true, act: 3, heat: 3, heroesLost: 0, score: 6500 }));
    expect(win.earned.map((a) => a.id)).toEqual(
      expect.arrayContaining(['first_win', 'act2', 'act3', 'flawless', 'heat1_win', 'heat3_win', 'score3000', 'score6000'])
    );
    expect(win.earned.map((a) => a.id)).not.toContain('heat5_win');

    const daily = withRun(emptyHistory(), rec({ id: 'd', mode: 'daily', dailyKey: '2026-11-26' }), 3);
    expect(daily.earned.map((a) => a.id)).toEqual(expect.arrayContaining(['daily_first', 'streak3']));
    const practice = withRun(emptyHistory(), rec({ id: 'p', mode: 'daily', dailyKey: '2026-11-26', practice: true }));
    expect(practice.earned.map((a) => a.id)).not.toContain('daily_first');
  });
});
