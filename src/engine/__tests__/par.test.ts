import { describe, expect, it } from 'vitest';
import { MAP_TEMPLATES } from '../../data/maps';
import { createBattleFromMap } from '../battle';
import { GRADE_LABELS, PAR_TUNING, computeParTurns, gradeBattle } from '../par';
import { applyBattleOutcomeToRun, createNewRun, defaultMetaProgress } from '../run';
import { computeRunScore } from '../score';

function battleOn(mapId: string) {
  const run = createNewRun(defaultMetaProgress());
  return { run, battle: createBattleFromMap(mapId, run.roster.slice(0, 4), [], run.items) };
}

describe('turn par and battle grades', () => {
  it('gives every map a sensible par', () => {
    for (const map of Object.values(MAP_TEMPLATES)) {
      const { battle } = battleOn(map.id);
      expect(battle.parTurns, map.id).toBeGreaterThanOrEqual(2);
      expect(battle.parTurns, map.id).toBeLessThanOrEqual(8);
      expect(battle.parTurns).toBe(computeParTurns(battle));
    }
  });

  it('uses the hold length as par on survive maps', () => {
    const { battle } = battleOn('barnyard_siege');
    expect(battle.parTurns).toBe(battle.surviveTurns);
    // A survive win is declared at the start of the turn after the last one; that still counts as on par.
    battle.status = 'victory';
    battle.turn = (battle.surviveTurns ?? 4) + 1;
    expect(gradeBattle(battle).grade).toBe('perfect');
  });

  it('grades perfect, great and cleared', () => {
    const { battle } = battleOn('vegetable_patch');
    const par = battle.parTurns!;
    battle.status = 'victory';

    battle.turn = par;
    expect(gradeBattle(battle).grade).toBe('perfect');

    battle.units.find((u) => u.team === 'player')!.alive = false;
    expect(gradeBattle(battle).grade).toBe('great');

    battle.turn = par + 1;
    expect(gradeBattle(battle).grade).toBe('cleared');
    expect(GRADE_LABELS.cleared).toBe('Harvest Cleared');
  });

  it('pays grade seeds on the reward screen and feeds the run score', () => {
    const { run, battle } = battleOn('vegetable_patch');
    const node = run.nodes.find((n) => n.type === 'skirmish')!;
    run.currentNodeId = node.id;
    for (const u of battle.units) if (u.team === 'enemy') u.alive = false;
    battle.status = 'victory';
    battle.turn = Math.max(1, battle.parTurns! - 2);

    applyBattleOutcomeToRun(run, battle, defaultMetaProgress());
    expect(run.pendingReward?.battleGrade?.grade).toBe('perfect');
    expect(run.pendingReward?.battleGrade?.bonusSeeds).toBe(PAR_TUNING.bonusSeeds.perfect);
    expect(run.perfectHarvests).toBe(1);
    expect(run.turnsUnderPar).toBe(battle.parTurns! - battle.turn);

    const lines = computeRunScore(run).lines;
    expect(lines.find((l) => l.label === 'Perfect harvests')?.points).toBeGreaterThan(0);
    expect(lines.find((l) => l.label === 'Swift harvest')?.detail).toBe(`${run.turnsUnderPar} turns under par`);
  });
});
