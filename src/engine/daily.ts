import { computeRunScore } from './score';
import type { RunState } from './types';

/**
 * Daily run bookkeeping on this device: which attempt of the day a run is (only the first
 * one counts for the boards, later ones are practice) and the player's day streak.
 */
export interface DailyStreak {
  /** UTC day (YYYY-MM-DD) of the last scored daily that was finished. */
  lastKey: string | null;
  count: number;
  best: number;
}

export interface DailyState {
  /** Attempts started per UTC day. */
  attempts: Record<string, number>;
  streak: DailyStreak;
}

export const DAILY_STORAGE_KEY = 'crop_revolt_daily_v1';
const ATTEMPT_DAYS_KEPT = 14;

export function emptyDailyState(): DailyState {
  return { attempts: {}, streak: { lastKey: null, count: 0, best: 0 } };
}

function dayBefore(key: string): string {
  const d = new Date(`${key}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** Count a new attempt for the day and return its number (1 = the scored attempt). */
export function withAttempt(state: DailyState, key: string): { state: DailyState; attempt: number } {
  const attempt = (state.attempts[key] ?? 0) + 1;
  const kept = Object.keys({ ...state.attempts, [key]: attempt }).sort().slice(-ATTEMPT_DAYS_KEPT);
  const attempts: Record<string, number> = {};
  for (const k of kept) attempts[k] = k === key ? attempt : state.attempts[k];
  return { state: { ...state, attempts }, attempt };
}

/** Streak after finishing the scored daily for `key`: +1 if yesterday's was finished too. */
export function withFinishedDaily(streak: DailyStreak, key: string): DailyStreak {
  if (streak.lastKey === key) return streak;
  const count = streak.lastKey === dayBefore(key) ? streak.count + 1 : 1;
  return { lastKey: key, count, best: Math.max(streak.best, count) };
}

/** The streak as it stands today: it survives until a whole day is missed. */
export function activeStreak(streak: DailyStreak, todayKey: string): number {
  return streak.lastKey === todayKey || streak.lastKey === dayBefore(todayKey) ? streak.count : 0;
}

export function isPracticeRun(run: RunState): boolean {
  return run.mode === 'daily' && (run.dailyAttempt ?? 1) > 1;
}

/** Short plain-text result for sharing. Contains no spoilers about the day's map. */
export function dailyShareText(run: RunState, streak: number): string {
  const score = computeRunScore(run).total.toLocaleString('en-US');
  const outcome = run.status === 'victory' ? 'Garden freed' : `Fell in Act ${run.act + 1}`;
  const lines = [
    `Crop Revolt Daily ${run.dailyKey ?? ''}`.trim(),
    `${score} points · ${outcome} · ${run.battlesWon} battles won`,
  ];
  if (isPracticeRun(run)) lines.push('(practice run)');
  else if (streak > 1) lines.push(`${streak}-day streak`);
  return lines.join('\n');
}

/* ----------------------------------- Storage ----------------------------------- */

export function loadDailyState(): DailyState {
  try {
    if (typeof localStorage === 'undefined') return emptyDailyState();
    const parsed = JSON.parse(localStorage.getItem(DAILY_STORAGE_KEY) ?? 'null') as Partial<DailyState> | null;
    const base = emptyDailyState();
    if (!parsed || typeof parsed !== 'object') return base;
    return {
      attempts: { ...(parsed.attempts ?? {}) },
      streak: { ...base.streak, ...(parsed.streak ?? {}) },
    };
  } catch {
    return emptyDailyState();
  }
}

function saveDailyState(state: DailyState): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(DAILY_STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* streaks are a nice-to-have */
  }
}

/** Call when a daily run starts. Starting is what uses up the scored attempt. */
export function registerDailyAttempt(key: string): number {
  const { state, attempt } = withAttempt(loadDailyState(), key);
  saveDailyState(state);
  return attempt;
}

/** Call when a daily run ends. Practice runs leave the streak alone. */
export function recordDailyFinish(run: RunState): void {
  if (run.mode !== 'daily' || !run.dailyKey || isPracticeRun(run)) return;
  const state = loadDailyState();
  saveDailyState({ ...state, streak: withFinishedDaily(state.streak, run.dailyKey) });
}
