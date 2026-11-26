import { hashString } from './difficulty';
import type { RunState } from './types';

/**
 * Run score, the daily seeded run and the on-device leaderboard.
 * Every knob of the formula lives in SCORE_TUNING so balancing is one-file work.
 */
export const SCORE_TUNING = {
  perBattleWon: 100,
  perEnemyRouted: 10,
  perActCleared: 500,
  victoryBonus: 1000,
  perSurvivor: 50,
  /** Fallback for runs started before per-battle par: turns allowed per won battle. */
  parTurnsPerBattle: 8,
  perTurnUnderPar: 15,
  perPerfectHarvest: 60,
  /** Each Harvest Heat level multiplies the total by this much more. */
  heatMultPerLevel: 0.2,
} as const;

export interface ScoreLine {
  label: string;
  detail: string;
  points: number;
}

export interface RunScore {
  lines: ScoreLine[];
  subtotal: number;
  heat: number;
  heatMult: number;
  total: number;
}

export function computeRunScore(run: RunState): RunScore {
  const T = SCORE_TUNING;
  const won = run.status === 'victory';
  const actsCleared = run.act + (won ? 1 : 0);
  const survivors = run.roster.filter((h) => !h.harvested).length;
  const turns = run.battleTurns ?? 0;
  // Runs that track per-battle par use it; older saves fall back to the flat allowance.
  const turnsUnderPar =
    run.turnsUnderPar !== undefined
      ? run.turnsUnderPar
      : Math.max(0, run.battlesWon * T.parTurnsPerBattle - turns);
  const perfects = run.perfectHarvests ?? 0;

  const lines: ScoreLine[] = [
    { label: 'Battles won', detail: `${run.battlesWon} × ${T.perBattleWon}`, points: run.battlesWon * T.perBattleWon },
    { label: 'Farmers routed', detail: `${run.enemiesDefeated} × ${T.perEnemyRouted}`, points: run.enemiesDefeated * T.perEnemyRouted },
    { label: 'Acts cleared', detail: `${actsCleared} × ${T.perActCleared}`, points: actsCleared * T.perActCleared },
    { label: 'Swift harvest', detail: `${turnsUnderPar} turns under par`, points: turnsUnderPar * T.perTurnUnderPar },
    { label: 'Perfect harvests', detail: `${perfects} × ${T.perPerfectHarvest}`, points: perfects * T.perPerfectHarvest },
    { label: 'Produce standing', detail: `${survivors} × ${T.perSurvivor}`, points: survivors * T.perSurvivor },
  ];
  if (won) lines.push({ label: 'Garden freed', detail: 'Victory bonus', points: T.victoryBonus });

  const subtotal = lines.reduce((sum, l) => sum + l.points, 0);
  const heat = Math.max(0, Math.floor(run.harvestHeat ?? 0));
  const heatMult = 1 + T.heatMultPerLevel * heat;
  return { lines, subtotal, heat, heatMult, total: Math.round(subtotal * heatMult) };
}

/* ---------------------------------- Daily run ---------------------------------- */

/** Daily runs roll over at midnight UTC so every player gets the same garden on the same day. */
export function dailyKeyFor(date: Date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

export function dailySeedFor(dailyKey: string): number {
  return hashString(`crop-revolt-daily:${dailyKey}`);
}

/* --------------------------------- Leaderboard --------------------------------- */

export interface ScoreEntry {
  id: string;
  score: number;
  /** ISO timestamp of when the run ended. */
  at: string;
  mode: 'standard' | 'daily';
  dailyKey?: string;
  heat: number;
  victory: boolean;
  /** 1-based act the run ended in. */
  act: number;
  battlesWon: number;
  seed: number;
}

export const SCORES_STORAGE_KEY = 'crop_revolt_scores_v1';
export const BOARD_SIZE = 10;
/** How many past daily boards are kept on the device. */
const DAILY_KEYS_KEPT = 14;

export function scoreEntryForRun(run: RunState, now: Date = new Date()): ScoreEntry {
  return {
    id: run.id,
    score: computeRunScore(run).total,
    at: now.toISOString(),
    mode: run.mode === 'daily' ? 'daily' : 'standard',
    dailyKey: run.mode === 'daily' ? run.dailyKey : undefined,
    heat: Math.max(0, Math.floor(run.harvestHeat ?? 0)),
    victory: run.status === 'victory',
    act: run.act + 1,
    battlesWon: run.battlesWon,
    seed: run.seed,
  };
}

function byScore(a: ScoreEntry, b: ScoreEntry): number {
  return b.score - a.score || a.at.localeCompare(b.at);
}

/** Insert an entry and trim: top BOARD_SIZE standard runs, top BOARD_SIZE per recent daily. */
export function insertScore(entries: readonly ScoreEntry[], entry: ScoreEntry): ScoreEntry[] {
  const all = [...entries.filter((e) => e.id !== entry.id), entry];
  const standard = all.filter((e) => e.mode === 'standard').sort(byScore).slice(0, BOARD_SIZE);
  const dailyKeys = [...new Set(all.filter((e) => e.mode === 'daily').map((e) => e.dailyKey ?? ''))]
    .sort()
    .reverse()
    .slice(0, DAILY_KEYS_KEPT);
  const daily = dailyKeys.flatMap((key) =>
    all.filter((e) => e.mode === 'daily' && (e.dailyKey ?? '') === key).sort(byScore).slice(0, BOARD_SIZE)
  );
  return [...standard, ...daily];
}

export function topStandardScores(entries: readonly ScoreEntry[]): ScoreEntry[] {
  return entries.filter((e) => e.mode === 'standard').sort(byScore).slice(0, BOARD_SIZE);
}

export function topDailyScores(entries: readonly ScoreEntry[], dailyKey: string): ScoreEntry[] {
  return entries
    .filter((e) => e.mode === 'daily' && e.dailyKey === dailyKey)
    .sort(byScore)
    .slice(0, BOARD_SIZE);
}

/** 1-based rank of an entry on its own board, or 0 if it did not make the board. */
export function rankOf(entries: readonly ScoreEntry[], entry: ScoreEntry): number {
  const board =
    entry.mode === 'daily' ? topDailyScores(entries, entry.dailyKey ?? '') : topStandardScores(entries);
  return board.findIndex((e) => e.id === entry.id) + 1;
}

export function loadScores(): ScoreEntry[] {
  try {
    if (typeof localStorage === 'undefined') return [];
    const raw = localStorage.getItem(SCORES_STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e): e is ScoreEntry => Boolean(e) && typeof e.id === 'string' && typeof e.score === 'number'
    );
  } catch {
    return [];
  }
}

export function saveScores(entries: readonly ScoreEntry[]): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(SCORES_STORAGE_KEY, JSON.stringify(entries));
  } catch {
    /* storage full or blocked: the leaderboard is a nice-to-have */
  }
}

/** Record a finished run on the device leaderboard and return its entry. */
export function recordRunScore(run: RunState, now: Date = new Date()): ScoreEntry {
  const entry = scoreEntryForRun(run, now);
  saveScores(insertScore(loadScores(), entry));
  return entry;
}
