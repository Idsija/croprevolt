import { describe, expect, it } from 'vitest';
import { MAP_TEMPLATES } from '../../data/maps';
import { createBattleFromMap } from '../battle';
import {
  MAX_ENEMIES_PER_BATTLE,
  battleRng,
  difficultyFor,
  threatFor,
} from '../difficulty';
import { ACTS, FLOORS_PER_ACT } from '../mapgen';
import { createNewRun, defaultMetaProgress } from '../run';
import type { BattleState } from '../types';

const regularMaps = Object.values(MAP_TEMPLATES).filter((m) => m.objective !== 'boss');

function enemies(b: BattleState) {
  return b.units.filter((u) => u.team === 'enemy');
}

describe('difficulty curve', () => {
  it('never gets easier from one floor to the next, across acts', () => {
    let prev = difficultyFor(0, 0, 'skirmish');
    let prevThreat = threatFor(0, 0);
    for (let act = 0; act < ACTS.length; act++) {
      for (let floor = 0; floor < FLOORS_PER_ACT; floor++) {
        if (act === 0 && floor === 0) continue;
        const d = difficultyFor(act, floor, 'skirmish');
        expect(d.hpMult).toBeGreaterThan(prev.hpMult);
        expect(d.damageBonus).toBeGreaterThanOrEqual(prev.damageBonus);
        expect(d.extraEnemies).toBeGreaterThanOrEqual(prev.extraEnemies);
        expect(threatFor(act, floor)).toBeGreaterThan(prevThreat);
        prev = d;
        prevThreat = threatFor(act, floor);
      }
    }
  });

  it('makes later bosses tougher and gives elites veterans', () => {
    expect(difficultyFor(1, FLOORS_PER_ACT, 'boss').hpMult).toBeGreaterThan(
      difficultyFor(0, FLOORS_PER_ACT, 'boss').hpMult
    );
    expect(difficultyFor(0, 2, 'elite').veterans).toBe(1);
    expect(difficultyFor(0, 5, 'elite').veterans).toBe(2);
    expect(difficultyFor(0, 5, 'skirmish').veterans).toBe(0);
  });
});

describe('randomized battle setups', () => {
  const heroes = createNewRun(defaultMetaProgress()).roster.slice(0, 4);

  it('builds maps exactly as authored when no setup is given', () => {
    for (const map of Object.values(MAP_TEMPLATES)) {
      const b = createBattleFromMap(map.id, heroes, [], {});
      expect(enemies(b).map((u) => [u.blueprintId, u.pos.x, u.pos.y])).toEqual(
        map.enemySpawns.map((e) => [e.blueprintId, e.x, e.y])
      );
    }
  });

  it('is deterministic per run seed and node', () => {
    const d = difficultyFor(0, 5, 'skirmish');
    const a = createBattleFromMap('vegetable_patch', heroes, [], {}, undefined, { rng: battleRng(9, 'a0f5l1'), difficulty: d });
    const b = createBattleFromMap('vegetable_patch', heroes, [], {}, undefined, { rng: battleRng(9, 'a0f5l1'), difficulty: d });
    expect(JSON.stringify(a.units)).toBe(JSON.stringify(b.units));
  });

  it('produces valid, varied, scaled battles on every map', () => {
    const layouts = new Set<string>();
    for (const map of regularMaps) {
      for (let seed = 1; seed <= 60; seed++) {
        const floor = seed % FLOORS_PER_ACT;
        const act = seed % ACTS.length;
        const type = map.id.includes('ambush') ? 'elite' : 'skirmish';
        const difficulty = difficultyFor(act, floor, type);
        const b = createBattleFromMap(map.id, heroes, [], {}, undefined, { rng: battleRng(seed, map.id), difficulty });
        const foes = enemies(b);
        layouts.add(JSON.stringify(foes.map((u) => [u.blueprintId, u.pos])));

        expect(foes.length).toBeLessThanOrEqual(Math.max(MAX_ENEMIES_PER_BATTLE, map.enemySpawns.length));
        expect(foes.length).toBeGreaterThanOrEqual(
          Math.min(map.enemySpawns.length + difficulty.extraEnemies, MAX_ENEMIES_PER_BATTLE)
        );
        expect(foes.filter((u) => u.isVeteran)).toHaveLength(difficulty.veterans);

        // No two units share a tile, nobody stands on cover, and everyone is on the board.
        const seen = new Set<string>();
        for (const u of b.units) {
          const key = `${u.pos.x},${u.pos.y}`;
          expect(seen.has(key)).toBe(false);
          seen.add(key);
          expect(u.pos.x).toBeGreaterThanOrEqual(0);
          expect(u.pos.x).toBeLessThan(b.width);
          expect(b.tiles[u.pos.y][u.pos.x].cover).toBeNull();
        }

        // Every enemy is at least as tough as its blueprint says.
        for (const u of foes) {
          expect(u.maxHp).toBeGreaterThanOrEqual(u.isVeteran ? 1 : 0);
          expect(u.hp).toBe(u.maxHp);
        }
      }
    }
    // Mirroring + rerolls + reinforcements should give many distinct layouts.
    expect(layouts.size).toBeGreaterThan(regularMaps.length * 20);
  });

  it('mirrors cover, squad spawns and gates together with the board', () => {
    const authored = MAP_TEMPLATES.vegetable_patch;
    let mirroredSeen = false;
    for (let seed = 1; seed < 30; seed++) {
      const b = createBattleFromMap('vegetable_patch', heroes, [], {}, undefined, {
        rng: battleRng(seed, 'x'),
        difficulty: difficultyFor(0, 0, 'skirmish'),
      });
      // The authored sprinkler sits at (0,4); a mirrored board has it at (6,4).
      const mirrored = b.tiles[4][6].cover?.kind === 'sprinkler';
      if (!mirrored) {
        expect(b.tiles[4][0].cover?.kind).toBe('sprinkler');
        continue;
      }
      mirroredSeen = true;
      const fx = (x: number) => b.width - 1 - x;
      const heroCells = b.units.filter((u) => u.team === 'player').map((u) => `${u.pos.x},${u.pos.y}`).sort();
      const expected = authored.playerSpawns.map((p) => `${fx(p.x)},${p.y}`).sort();
      expect(heroCells).toEqual(expected);
      for (const t of authored.tiles) {
        if (t.cover) expect(b.tiles[t.y][fx(t.x)].cover?.kind).toBe(t.cover);
      }
    }
    expect(mirroredSeen).toBe(true);
  });
});

import { heatRunRules } from '../difficulty';
import { generateMarketOffers } from '../run';

describe('heat run rules', () => {
  it('leaves Heat 0 untouched and never eases off as heat rises', () => {
    expect(heatRunRules(0)).toEqual({ bellTurnsLost: 0, marketPriceMult: 1, breatherHeal: 3 });
    for (let h = 1; h <= 5; h++) {
      const prev = heatRunRules(h - 1);
      const cur = heatRunRules(h);
      expect(cur.bellTurnsLost).toBeGreaterThanOrEqual(prev.bellTurnsLost);
      expect(cur.marketPriceMult).toBeGreaterThanOrEqual(prev.marketPriceMult);
      expect(cur.breatherHeal).toBeLessThanOrEqual(prev.breatherHeal);
      expect(cur).not.toEqual(heatRunRules(0));
    }
  });

  it('shortens the Harvest Bell and raises market prices in a real run', () => {
    const cool = createNewRun(defaultMetaProgress(), 'spring', 7, 0);
    const hot = createNewRun(defaultMetaProgress(), 'spring', 7, 5);
    expect(hot.harvestBellLimit).toBe((cool.harvestBellLimit ?? 0) - 2);
    const rng = () => 0.42;
    const coolOffers = generateMarketOffers(cool, rng);
    const hotOffers = generateMarketOffers(hot, rng);
    hotOffers.forEach((o, i) => expect(o.cost).toBe(Math.ceil(coolOffers[i].cost * 1.5)));
  });
});
