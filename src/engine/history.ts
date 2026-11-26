import { computeRunScore } from './score';
import type { RunState } from './types';

/**
 * Run history, lifetime records and achievements, kept on this device.
 * Achievements pay Heirloom Seeds once, when first earned.
 */
export interface RunRecord {
  id: string;
  at: string;
  score: number;
  mode: 'standard' | 'daily';
  dailyKey?: string;
  practice?: boolean;
  heat: number;
  victory: boolean;
  /** 1-based act the run ended in. */
  act: number;
  battlesWon: number;
  enemiesDefeated: number;
  battleTurns: number;
  heroesLost: number;
}

export interface LifetimeStats {
  runs: number;
  wins: number;
  battlesWon: number;
  enemiesDefeated: number;
  bestScore: number;
  bestDailyScore: number;
  /** Highest Harvest Heat a run was won on, or -1 if no win yet. */
  highestHeatWon: number;
  /** Fewest battle turns in a won run, or 0 if no win yet. */
  fastestWinTurns: number;
  furthestAct: number;
}

export interface HistoryState {
  runs: RunRecord[];
  stats: LifetimeStats;
  /** Achievement id -> ISO time it was earned. */
  achievements: Record<string, string>;
}

export interface AchievementContext {
  record: RunRecord;
  stats: LifetimeStats;
  /** Best daily streak so far, including this run. */
  bestStreak: number;
}

export interface Achievement {
  id: string;
  icon: string;
  name: string;
  desc: string;
  seeds: number;
  earned: (ctx: AchievementContext) => boolean;
}

const scored = (r: RunRecord) => !r.practice;

export const ACHIEVEMENTS: Achievement[] = [
  { id: 'first_harvest', icon: '🌱', name: 'First Sprout', desc: 'Finish your first run.', seeds: 5, earned: ({ stats }) => stats.runs >= 1 },
  { id: 'act2', icon: '☀️', name: 'Summer Bound', desc: 'Reach Act 2.', seeds: 10, earned: ({ stats }) => stats.furthestAct >= 2 },
  { id: 'act3', icon: '🍂', name: 'Orchard Bound', desc: 'Reach Act 3.', seeds: 15, earned: ({ stats }) => stats.furthestAct >= 3 },
  { id: 'first_win', icon: '🏆', name: 'Garden Freed', desc: 'Win a run.', seeds: 20, earned: ({ stats }) => stats.wins >= 1 },
  { id: 'flawless', icon: '🛡️', name: 'Nobody Bagged', desc: 'Win a run without losing a hero.', seeds: 30, earned: ({ record }) => record.victory && record.heroesLost === 0 },
  { id: 'heat1_win', icon: '🔥', name: 'Warming Up', desc: 'Win a run on Heat 1 or higher.', seeds: 20, earned: ({ stats }) => stats.highestHeatWon >= 1 },
  { id: 'heat3_win', icon: '🔥', name: 'Heatwave', desc: 'Win a run on Heat 3 or higher.', seeds: 40, earned: ({ stats }) => stats.highestHeatWon >= 3 },
  { id: 'heat5_win', icon: '🌋', name: 'Scorched Earth', desc: 'Win a run on Heat 5.', seeds: 80, earned: ({ stats }) => stats.highestHeatWon >= 5 },
  { id: 'score3000', icon: '⭐', name: 'Bumper Crop', desc: 'Score 3,000 points in one run.', seeds: 15, earned: ({ stats }) => stats.bestScore >= 3000 },
  { id: 'score6000', icon: '🌟', name: 'Prize Harvest', desc: 'Score 6,000 points in one run.', seeds: 30, earned: ({ stats }) => stats.bestScore >= 6000 },
  { id: 'routed100', icon: '🧹', name: 'Field Day', desc: 'Rout 100 farmers in total.', seeds: 10, earned: ({ stats }) => stats.enemiesDefeated >= 100 },
  { id: 'routed500', icon: '🚜', name: 'Farm Takeover', desc: 'Rout 500 farmers in total.', seeds: 25, earned: ({ stats }) => stats.enemiesDefeated >= 500 },
  { id: 'daily_first', icon: '📅', name: 'Daily Digger', desc: 'Finish a scored Daily Run.', seeds: 10, earned: ({ record }) => record.mode === 'daily' && scored(record) },
  { id: 'streak3', icon: '🔥', name: 'Three in a Row', desc: 'Reach a 3-day Daily Run streak.', seeds: 15, earned: ({ bestStreak }) => bestStreak >= 3 },
  { id: 'streak7', icon: '🗓️', name: 'Full Week', desc: 'Reach a 7-day Daily Run streak.', seeds: 40, earned: ({ bestStreak }) => bestStreak >= 7 },
];

export const HISTORY_STORAGE_KEY = 'crop_revolt_history_v1';
export const HISTORY_RUNS_KEPT = 30;

export function emptyHistory(): HistoryState {
  return {
    runs: [],
    stats: {
      runs: 0, wins: 0, battlesWon: 0, enemiesDefeated: 0, bestScore: 0, bestDailyScore: 0,
      highestHeatWon: -1, fastestWinTurns: 0, furthestAct: 0,
    },
    achievements: {},
  };
}

export function runRecordFor(run: RunState, now: Date = new Date()): RunRecord {
  const practice = run.mode === 'daily' && (run.dailyAttempt ?? 1) > 1;
  return {
    id: run.id,
    at: now.toISOString(),
    score: computeRunScore(run).total,
    mode: run.mode === 'daily' ? 'daily' : 'standard',
    dailyKey: run.mode === 'daily' ? run.dailyKey : undefined,
    practice: practice || undefined,
    heat: Math.max(0, Math.floor(run.harvestHeat ?? 0)),
    victory: run.status === 'victory',
    act: run.act + 1,
    battlesWon: run.battlesWon,
    enemiesDefeated: run.enemiesDefeated,
    battleTurns: run.battleTurns ?? 0,
    heroesLost: run.roster.filter((h) => h.harvested).length,
  };
}

/**
 * Add a finished run. Returns the new state and the achievements it earned for the first time.
 * Recording the same run twice changes nothing.
 */
export function withRun(
  state: HistoryState,
  record: RunRecord,
  bestStreak = 0
): { state: HistoryState; earned: Achievement[] } {
  if (state.runs.some((r) => r.id === record.id)) return { state, earned: [] };
  const s = state.stats;
  const stats: LifetimeStats = {
    runs: s.runs + 1,
    wins: s.wins + (record.victory ? 1 : 0),
    battlesWon: s.battlesWon + record.battlesWon,
    enemiesDefeated: s.enemiesDefeated + record.enemiesDefeated,
    bestScore: Math.max(s.bestScore, record.score),
    bestDailyScore: record.mode === 'daily' && scored(record) ? Math.max(s.bestDailyScore, record.score) : s.bestDailyScore,
    highestHeatWon: record.victory ? Math.max(s.highestHeatWon, record.heat) : s.highestHeatWon,
    fastestWinTurns:
      record.victory && record.battleTurns > 0 && (s.fastestWinTurns === 0 || record.battleTurns < s.fastestWinTurns)
        ? record.battleTurns
        : s.fastestWinTurns,
    furthestAct: Math.max(s.furthestAct, record.act),
  };
  const ctx: AchievementContext = { record, stats, bestStreak };
  const earned = ACHIEVEMENTS.filter((a) => !state.achievements[a.id] && a.earned(ctx));
  const achievements = { ...state.achievements };
  for (const a of earned) achievements[a.id] = record.at;
  return {
    state: { runs: [record, ...state.runs].slice(0, HISTORY_RUNS_KEPT), stats, achievements },
    earned,
  };
}

export function loadHistory(): HistoryState {
  try {
    if (typeof localStorage === 'undefined') return emptyHistory();
    const parsed = JSON.parse(localStorage.getItem(HISTORY_STORAGE_KEY) ?? 'null') as Partial<HistoryState> | null;
    const base = emptyHistory();
    if (!parsed || typeof parsed !== 'object') return base;
    return {
      runs: Array.isArray(parsed.runs) ? parsed.runs : [],
      stats: { ...base.stats, ...(parsed.stats ?? {}) },
      achievements: { ...(parsed.achievements ?? {}) },
    };
  } catch {
    return emptyHistory();
  }
}

/** Record a finished run on this device and return the achievements it just earned. */
export function recordRunHistory(run: RunState, bestStreak = 0, now: Date = new Date()): Achievement[] {
  const { state, earned } = withRun(loadHistory(), runRecordFor(run, now), bestStreak);
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* history is a nice-to-have */
  }
  return earned;
}
