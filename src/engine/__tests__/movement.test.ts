import { describe, expect, it } from 'vitest';
import { createBattleFromMap, executeDash, executeMove, executeTeamJump } from '../battle';
import { getRemainingMove } from '../hooks';
import { computeDashOptions, computeMovableTiles, computeTeamJumpOptions } from '../pathfinding';
import { createNewRun, defaultMetaProgress } from '../run';
import type { BattleState, BattleUnit } from '../types';

/** A flat, empty board: grass everywhere, no cover, no burrows, everyone parked out of the way. */
function flatBattle(): { battle: BattleState; hero: BattleUnit; ally: BattleUnit; foe: BattleUnit } {
  const run = createNewRun(defaultMetaProgress());
  const battle = createBattleFromMap('creek_crossing', run.roster.slice(0, 4), [], run.items);
  battle.prepPhase = false;
  battle.phase = 'player';
  battle.burrowPairs = [];
  for (const row of battle.tiles) {
    for (const t of row) {
      t.terrain = 'grass';
      t.elevation = 0;
      t.cover = null;
    }
  }
  const players = battle.units.filter((u) => u.team === 'player');
  const enemies = battle.units.filter((u) => u.team === 'enemy');
  const [hero, ally, ...restPlayers] = players;
  const [foe, ...restEnemies] = enemies;
  restPlayers.forEach((u, i) => (u.pos = { x: 8, y: 10 - i }));
  restEnemies.forEach((u, i) => (u.pos = { x: 8 - i, y: 0 }));
  hero.moveRange = 4;
  hero.jumpRange = 3;
  hero.statuses = [];
  hero.pos = { x: 2, y: 8 };
  ally.pos = { x: 6, y: 10 };
  foe.pos = { x: 0, y: 0 };
  return { battle, hero, ally, foe };
}

describe('one fluid move per turn', () => {
  it('lets a hero split one movement budget across several moves', () => {
    const { battle, hero } = flatBattle();
    expect(executeMove(battle, hero.id, { x: 2, y: 6 })).toBe(true);
    expect(hero.actions.moveSpent).toBe(2);
    expect(hero.actions.hasMoved).toBe(false);
    expect(getRemainingMove(hero)).toBe(2);

    // Only 2 steps left: 3 away is out of reach, 2 away is fine.
    const movable = computeMovableTiles(battle, hero);
    expect(movable.has('2,3')).toBe(false);
    expect(movable.has('2,4')).toBe(true);

    expect(executeMove(battle, hero.id, { x: 2, y: 4 })).toBe(true);
    expect(hero.actions.hasMoved).toBe(true);
    expect(computeMovableTiles(battle, hero).size).toBe(0);
    expect(executeMove(battle, hero.id, { x: 2, y: 3 })).toBe(false);
  });

  it('charges a dash for the steps it takes and keeps only the remainder', () => {
    const { battle, hero, foe } = flatBattle();
    foe.pos = { x: 2, y: 5 }; // stop tile (2,6) is 2 steps away
    const opt = computeDashOptions(battle, hero).find((o) => o.enemyId === foe.id)!;
    expect(opt.cost).toBe(2);

    expect(executeDash(battle, hero.id, foe.id)).toBe(true);
    expect(hero.pos).toEqual({ x: 2, y: 6 });
    expect(getRemainingMove(hero)).toBe(2);

    // Before this change a dash handed back a full 4-step move from the stop tile.
    const movable = computeMovableTiles(battle, hero);
    expect(movable.has('4,6')).toBe(true);
    expect(movable.has('5,6')).toBe(false);
  });

  it('cannot dash a foe that is beyond the remaining budget', () => {
    const { battle, hero, foe } = flatBattle();
    foe.pos = { x: 2, y: 3 }; // stop tile (2,4) is 4 steps away
    expect(executeMove(battle, hero.id, { x: 3, y: 8 })).toBe(true);
    expect(computeDashOptions(battle, hero).some((o) => o.enemyId === foe.id)).toBe(false);
  });

  it('lets a hero keep walking after a team jump with whatever budget is left', () => {
    const { battle, hero, ally } = flatBattle();
    ally.pos = { x: 2, y: 7 }; // already adjacent: the approach costs nothing
    hero.moveRange = 2; // so (2,4) is only reachable by jumping
    const jumps = computeTeamJumpOptions(battle, hero);
    const landing = jumps.get('2,4');
    expect(landing).toBeDefined();
    expect(landing!.approachCost).toBe(0);

    expect(executeTeamJump(battle, hero.id, { x: 2, y: 4 })).toBe(true);
    expect(hero.actions.hasJumped).toBe(true);
    expect(hero.actions.hasMoved).toBe(false);
    expect(getRemainingMove(hero)).toBe(2);
    expect(executeMove(battle, hero.id, { x: 2, y: 3 })).toBe(true);
    expect(getRemainingMove(hero)).toBe(1);
  });

  it('pays for walking up to the springboard ally', () => {
    const { battle, hero, ally } = flatBattle();
    ally.pos = { x: 4, y: 8 }; // nearest approach tile (3,8) is 1 step away
    const jumps = computeTeamJumpOptions(battle, hero);
    const opt = Array.from(jumps.values()).find((j) => j.allyId === ally.id)!;
    expect(opt.approachCost).toBe(1);
    expect(executeTeamJump(battle, hero.id, opt.dest)).toBe(true);
    expect(getRemainingMove(hero)).toBe(3);
  });
});
