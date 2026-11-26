import type { ScoreEntry } from './score';

/**
 * Online leaderboard, stored in a Supabase table and reached through its REST API with
 * plain fetch (no SDK). It is switched on by two build-time settings; without them the
 * game keeps working with the on-device board only. See supabase/README.md for setup.
 */
export interface OnlineConfig {
  url: string;
  anonKey: string;
}

export interface OnlineScoreRow {
  run_id: string;
  player_name: string;
  score: number;
  mode: 'standard' | 'daily';
  daily_key: string | null;
  heat: number;
  victory: boolean;
  act: number;
  battles_won: number;
  seed: number;
  created_at?: string;
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export const ONLINE_BOARD_SIZE = 20;
export const MAX_NAME_LENGTH = 16;
const NAME_KEY = 'crop_revolt_player_name_v1';
const PENDING_KEY = 'crop_revolt_pending_scores_v1';
const MAX_PENDING = 20;

export function onlineConfig(): OnlineConfig | null {
  const url = (import.meta.env?.VITE_SUPABASE_URL as string | undefined)?.trim().replace(/\/+$/, '');
  const anonKey = (import.meta.env?.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim();
  return url && anonKey ? { url, anonKey } : null;
}

/* --------------------------------- Player name --------------------------------- */

/** Letters, digits, spaces, dashes and underscores only; trimmed to MAX_NAME_LENGTH. */
export function sanitizePlayerName(raw: string): string {
  return raw
    .replace(/[^\p{L}\p{N} _-]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_NAME_LENGTH)
    .trim();
}

const NAME_STEMS = ['Sprout', 'Radish', 'Turnip', 'Parsnip', 'Clover', 'Pumpkin', 'Sorrel', 'Bramble'];

export function randomPlayerName(rng: () => number = Math.random): string {
  const stem = NAME_STEMS[Math.floor(rng() * NAME_STEMS.length)];
  return `${stem}-${String(Math.floor(rng() * 9000) + 1000)}`;
}

export function loadPlayerName(): string {
  try {
    const saved = sanitizePlayerName(localStorage.getItem(NAME_KEY) ?? '');
    if (saved) return saved;
    const fresh = randomPlayerName();
    localStorage.setItem(NAME_KEY, fresh);
    return fresh;
  } catch {
    return randomPlayerName();
  }
}

export function savePlayerName(raw: string): string {
  const name = sanitizePlayerName(raw) || randomPlayerName();
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {
    /* name just won't persist */
  }
  return name;
}

/* ----------------------------------- Requests ----------------------------------- */

export function toRow(entry: ScoreEntry, playerName: string): OnlineScoreRow {
  return {
    run_id: entry.id,
    player_name: sanitizePlayerName(playerName) || 'Gardener',
    score: entry.score,
    mode: entry.mode,
    daily_key: entry.mode === 'daily' ? (entry.dailyKey ?? null) : null,
    heat: entry.heat,
    victory: entry.victory,
    act: entry.act,
    battles_won: entry.battlesWon,
    seed: entry.seed,
  };
}

function headers(config: OnlineConfig, extra: Record<string, string> = {}): Record<string, string> {
  return { apikey: config.anonKey, Authorization: `Bearer ${config.anonKey}`, ...extra };
}

/** Upload one score. A run that is already on the board is ignored, so retries are safe. */
export async function submitScore(
  config: OnlineConfig,
  row: OnlineScoreRow,
  fetchImpl: FetchLike = fetch
): Promise<boolean> {
  try {
    const res = await fetchImpl(`${config.url}/rest/v1/scores?on_conflict=run_id`, {
      method: 'POST',
      headers: headers(config, {
        'Content-Type': 'application/json',
        Prefer: 'resolution=ignore-duplicates,return=minimal',
      }),
      body: JSON.stringify(row),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Top scores for today's daily (pass its key) or for all standard runs. Null if unreachable. */
export async function fetchTopScores(
  config: OnlineConfig,
  board: { mode: 'daily'; dailyKey: string } | { mode: 'standard' },
  fetchImpl: FetchLike = fetch
): Promise<OnlineScoreRow[] | null> {
  const params = new URLSearchParams({
    select: 'run_id,player_name,score,mode,daily_key,heat,victory,act,battles_won,seed,created_at',
    mode: `eq.${board.mode}`,
    order: 'score.desc,created_at.asc',
    limit: String(ONLINE_BOARD_SIZE),
  });
  if (board.mode === 'daily') params.set('daily_key', `eq.${board.dailyKey}`);
  try {
    const res = await fetchImpl(`${config.url}/rest/v1/scores?${params}`, { headers: headers(config) });
    if (!res.ok) return null;
    const rows: unknown = await res.json();
    return Array.isArray(rows) ? (rows as OnlineScoreRow[]) : null;
  } catch {
    return null;
  }
}

/* ------------------------------- Offline-safe queue ------------------------------ */

function loadPending(): OnlineScoreRow[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(PENDING_KEY) ?? '[]');
    return Array.isArray(parsed) ? (parsed as OnlineScoreRow[]) : [];
  } catch {
    return [];
  }
}

function savePending(rows: OnlineScoreRow[]): void {
  try {
    localStorage.setItem(PENDING_KEY, JSON.stringify(rows.slice(-MAX_PENDING)));
  } catch {
    /* nothing to do */
  }
}

/** Remember a finished run for upload; it stays queued until the board accepts it. */
export function queueScore(row: OnlineScoreRow): void {
  savePending([...loadPending().filter((r) => r.run_id !== row.run_id), row]);
}

/** Try to upload everything queued. Returns how many are still waiting. */
export async function flushQueuedScores(
  config: OnlineConfig,
  fetchImpl: FetchLike = fetch
): Promise<number> {
  const stillWaiting: OnlineScoreRow[] = [];
  for (const row of loadPending()) {
    if (!(await submitScore(config, row, fetchImpl))) stillWaiting.push(row);
  }
  savePending(stillWaiting);
  return stillWaiting.length;
}
