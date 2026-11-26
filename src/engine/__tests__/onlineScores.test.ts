import { describe, expect, it, vi } from 'vitest';
import {
  fetchTopScores,
  MAX_NAME_LENGTH,
  randomPlayerName,
  sanitizePlayerName,
  submitScore,
  toRow,
  type OnlineConfig,
} from '../onlineScores';
import type { ScoreEntry } from '../score';

const config: OnlineConfig = { url: 'https://example.supabase.co', anonKey: 'anon-key' };
const entry: ScoreEntry = {
  id: 'run_1', score: 1428, at: '2026-11-26T20:00:00.000Z', mode: 'daily', dailyKey: '2026-11-26',
  heat: 2, victory: false, act: 1, battlesWon: 4, seed: 80267300,
};
const ok = (body: unknown = null) => new Response(body === null ? null : JSON.stringify(body), { status: 200 });

describe('player names', () => {
  it('strips markup and control characters and limits the length', () => {
    expect(sanitizePlayerName('  <b>Jan</b>\n')).toBe('bJanb');
    expect(sanitizePlayerName('Zoë   van_Dijk-2')).toBe('Zoë van_Dijk-2');
    expect(sanitizePlayerName('x'.repeat(40))).toHaveLength(MAX_NAME_LENGTH);
    expect(sanitizePlayerName('💥💥')).toBe('');
  });

  it('makes a valid default name', () => {
    const name = randomPlayerName(() => 0.5);
    expect(sanitizePlayerName(name)).toBe(name);
  });
});

describe('score upload', () => {
  it('maps an entry to a table row and never sends an empty name', () => {
    expect(toRow(entry, 'Jan')).toMatchObject({
      run_id: 'run_1', player_name: 'Jan', score: 1428, mode: 'daily', daily_key: '2026-11-26', battles_won: 4,
    });
    expect(toRow({ ...entry, mode: 'standard' }, '!!!')).toMatchObject({ player_name: 'Gardener', daily_key: null });
  });

  it('posts once per run and ignores duplicates', async () => {
    const fetchImpl = vi.fn(async () => ok());
    expect(await submitScore(config, toRow(entry, 'Jan'), fetchImpl)).toBe(true);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://example.supabase.co/rest/v1/scores?on_conflict=run_id');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Prefer).toContain('ignore-duplicates');
    expect(JSON.parse(init.body as string).run_id).toBe('run_1');
  });

  it('reports failure when the board rejects the score or is unreachable', async () => {
    expect(await submitScore(config, toRow(entry, 'Jan'), async () => new Response(null, { status: 403 }))).toBe(false);
    expect(await submitScore(config, toRow(entry, 'Jan'), async () => { throw new Error('offline'); })).toBe(false);
  });
});

describe('shared board', () => {
  it("asks for today's daily, best first", async () => {
    const fetchImpl = vi.fn(async () => ok([toRow(entry, 'Jan')]));
    const rows = await fetchTopScores(config, { mode: 'daily', dailyKey: '2026-11-26' }, fetchImpl);
    expect(rows).toHaveLength(1);
    const url = new URL((fetchImpl.mock.calls[0] as unknown as [string])[0]);
    expect(url.searchParams.get('mode')).toBe('eq.daily');
    expect(url.searchParams.get('daily_key')).toBe('eq.2026-11-26');
    expect(url.searchParams.get('order')).toBe('score.desc,created_at.asc');
  });

  it('leaves the day out for standard runs and returns null when unreachable', async () => {
    const fetchImpl = vi.fn(async () => ok([]));
    await fetchTopScores(config, { mode: 'standard' }, fetchImpl);
    expect(new URL((fetchImpl.mock.calls[0] as unknown as [string])[0]).searchParams.has('daily_key')).toBe(false);
    expect(await fetchTopScores(config, { mode: 'standard' }, async () => { throw new Error('offline'); })).toBeNull();
  });
});
