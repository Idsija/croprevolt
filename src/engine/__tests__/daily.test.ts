import { describe, expect, it } from 'vitest';
import {
  activeStreak,
  dailyShareText,
  emptyDailyState,
  isPracticeRun,
  withAttempt,
  withFinishedDaily,
} from '../daily';
import { createDailyRun } from '../run';
import { insertScore, scoreEntryForRun, topDailyScores } from '../score';

describe('daily attempts', () => {
  it('numbers attempts per day and forgets old days', () => {
    let state = emptyDailyState();
    const first = withAttempt(state, '2026-11-26');
    expect(first.attempt).toBe(1);
    expect(withAttempt(first.state, '2026-11-26').attempt).toBe(2);
    expect(withAttempt(first.state, '2026-11-27').attempt).toBe(1);
    state = first.state;
    for (let d = 1; d <= 28; d++) state = withAttempt(state, `2026-12-${String(d).padStart(2, '0')}`).state;
    expect(Object.keys(state.attempts)).toHaveLength(14);
    expect(state.attempts['2026-11-26']).toBeUndefined();
  });

  it('keeps practice runs off the daily board', () => {
    const scored = createDailyRun(new Date('2026-11-26T12:00:00Z'));
    scored.dailyAttempt = 1;
    const practice = createDailyRun(new Date('2026-11-26T13:00:00Z'));
    practice.id = 'practice';
    practice.dailyAttempt = 2;
    practice.battlesWon = 9;
    expect(isPracticeRun(scored)).toBe(false);
    expect(isPracticeRun(practice)).toBe(true);
    const board = insertScore(insertScore([], scoreEntryForRun(scored)), scoreEntryForRun(practice));
    expect(topDailyScores(board, '2026-11-26').map((e) => e.id)).toEqual([scored.id]);
  });
});

describe('day streak', () => {
  it('grows on consecutive days, resets after a missed day and remembers the best', () => {
    let s = emptyDailyState().streak;
    s = withFinishedDaily(s, '2026-11-29');
    s = withFinishedDaily(s, '2026-11-30');
    s = withFinishedDaily(s, '2026-12-01'); // crosses a month boundary
    expect(s.count).toBe(3);
    expect(withFinishedDaily(s, '2026-12-01')).toBe(s);
    s = withFinishedDaily(s, '2026-12-03');
    expect(s).toMatchObject({ count: 1, best: 3 });
  });

  it('stays alive through the next day, then lapses', () => {
    const s = withFinishedDaily(emptyDailyState().streak, '2026-11-26');
    expect(activeStreak(s, '2026-11-26')).toBe(1);
    expect(activeStreak(s, '2026-11-27')).toBe(1);
    expect(activeStreak(s, '2026-11-28')).toBe(0);
  });
});

describe('share text', () => {
  it('summarises the result without revealing the map', () => {
    const run = createDailyRun(new Date('2026-11-26T12:00:00Z'));
    run.battlesWon = 4;
    run.status = 'defeat';
    const text = dailyShareText(run, 3);
    expect(text).toContain('Crop Revolt Daily 2026-11-26');
    expect(text).toContain('Fell in Act 1');
    expect(text).toContain('3-day streak');
    run.dailyAttempt = 2;
    expect(dailyShareText(run, 3)).toContain('(practice run)');
  });
});
