import { describe, expect, it } from 'vitest';
import { buildBalanceReport, MAX_BATTLE_TURNS, simulateRun } from '../simulateRun';

describe('run simulator', () => {
  it('plays whole runs to an end without getting stuck', () => {
    for (let seed = 1; seed <= 12; seed++) {
      const log = simulateRun(seed, seed % 3);
      expect(log.battles.length).toBeGreaterThan(0);
      expect(log.endedAct).toBeGreaterThanOrEqual(1);
      for (const b of log.battles) expect(b.turns).toBeLessThanOrEqual(MAX_BATTLE_TURNS + 1);
      // A run ends on its first lost battle, or by winning the final boss.
      const lost = log.battles.filter((b) => b.outcome !== 'victory');
      expect(lost.length).toBe(log.victory ? 0 : 1);
    }
  });

  it('replays the same seed the same way', () => {
    const a = simulateRun(77, 1);
    const b = simulateRun(77, 1);
    expect(b.battles.map((x) => `${x.mapId}:${x.outcome}:${x.turns}`)).toEqual(
      a.battles.map((x) => `${x.mapId}:${x.outcome}:${x.turns}`)
    );
  });

  it('summarises runs per stage and per map', () => {
    const logs = [1, 2, 3, 4, 5, 6].map((seed) => simulateRun(seed, 0));
    const report = buildBalanceReport(logs, 0);
    expect(report.runs).toBe(6);
    expect(report.endedInAct.reduce((s, x) => s + x, 0)).toBeCloseTo(1);
    const total = logs.reduce((s, l) => s + l.battles.length, 0);
    expect(report.byStage.reduce((s, r) => s + r.battles, 0)).toBe(total);
    expect(report.byMap.reduce((s, r) => s + r.battles, 0)).toBe(total);
    for (const r of report.byStage) expect(r.winRate).toBeGreaterThanOrEqual(0);
  });
});
