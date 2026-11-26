/**
 * Balance report: a bot plays seeded runs at each Harvest Heat and prints where they end.
 *
 *   npm run balance            200 runs per heat, Heat 0 to 5
 *   npm run balance -- 50 0 2  50 runs per heat, Heat 0 to 2
 *   npm run balance -- 200 0 5 9000   same, with a different set of seeds (first seed 9000)
 *
 * The bot is far weaker than a person, so compare rows with each other; don't read the
 * win rates as what a player would get. See src/sim/simulateRun.ts.
 */
import { buildBalanceReport, simulateRun, type RunLog } from '../src/sim/simulateRun';

const [runsArg, fromArg, toArg, seedArg] = process.argv.slice(2).map(Number);
const seedBase = Number.isFinite(seedArg) ? seedArg : 1000;
const runs = Number.isFinite(runsArg) && runsArg > 0 ? Math.floor(runsArg) : 200;
const fromHeat = Number.isFinite(fromArg) ? fromArg : 0;
const toHeat = Number.isFinite(toArg) ? toArg : 5;
const pct = (n: number) => `${(n * 100).toFixed(0)}%`.padStart(4);

// The engine logs to the console in places; keep the report readable.
const print = console.log.bind(console);
console.log = () => {};
console.warn = () => {};

for (let heat = fromHeat; heat <= toHeat; heat++) {
  const logs: RunLog[] = [];
  for (let i = 0; i < runs; i++) logs.push(simulateRun(seedBase + i, heat));
  const report = buildBalanceReport(logs, heat);
  print(`\n=== Heat ${heat}: ${runs} runs ===`);
  print(
    `Runs won ${pct(report.runWinRate)} · battles won per run ${report.avgBattlesWon.toFixed(1)} · ended in ` +
      report.endedInAct.map((share, i) => `Act ${i + 1} ${pct(share).trim()}`).join(', ')
  );
  print('stage              battles   won  turns  HP lost  stalled');
  for (const r of [...report.byStage, null, ...report.byMap]) {
    if (!r) {
      print('map                battles   won  turns  HP lost  stalled');
      continue;
    }
    print(
      `${r.label.padEnd(18)} ${String(r.battles).padStart(7)}  ${pct(r.winRate)}  ${r.avgTurns.toFixed(1).padStart(5)}  ${pct(r.avgHpLost).padStart(7)}  ${String(r.stalled).padStart(7)}`
    );
  }
}
