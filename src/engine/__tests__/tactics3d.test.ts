import { describe, expect, it } from 'vitest';
import { MAP_TEMPLATES } from '../../data/maps';
import { canUnlockPerk, getXpToNextLevel } from '../../data/skills';
import {
  createBattleFromMap,
  executeAbility,
  executeAttack,
  executeDash,
  executeMove,
  executeOverwatch,
  executeTeamJump,
  startPhase,
} from '../battle';
import { forecastAttack } from '../combat';
import { createCover, posKey, tileAt } from '../grid';
import { computeDashOptions, computeMovableTiles } from '../pathfinding';
import {
  applyBattleOutcomeToRun,
  createNewRun,
  defaultMetaProgress,
  unlockHeroPerk,
} from '../run';

describe('3D Multi-Elevation, Mario + Rabbids Combat & Skill Tree Progression', () => {
  it('enforces elevation steps, ramp cost savings, impassable water/lava, and walkable bridges', () => {
    const run = createNewRun(defaultMetaProgress());
    const battle = createBattleFromMap('creek_crossing', run.roster.slice(0, 4), [], run.items);

    const hero = battle.units.find((u) => u.team === 'player')!;
    // Clear cover & enemies out of the way
    for (let y = 0; y < battle.height; y++) {
      for (let x = 0; x < battle.width; x++) {
        battle.tiles[y][x].cover = null;
      }
    }
    battle.units.filter((u) => u.team === 'enemy').forEach((e, i) => {
      e.pos = { x: i, y: 0 };
    });
    battle.units.filter((u) => u.team === 'player' && u.id !== hero.id).forEach((ally, i) => {
      ally.pos = { x: 6 + i, y: 10 };
    });

    // Place hero right south of the water river at (2,8): bridge at (2,7) is walkable, water at (1,7) is blocked!
    hero.pos = { x: 2, y: 8 };
    const movable = computeMovableTiles(battle, hero);
    expect(movable.has('2,7')).toBe(true); // wooden bridge
    expect(movable.has('1,7')).toBe(false); // deep water blocked

    // Elevation 2 sheer wall cannot be climbed directly from elevation 0!
    battle.tiles[8][3].elevation = 2;
    battle.tiles[8][3].terrain = 'grass';
    const movable2 = computeMovableTiles(battle, hero);
    expect(movable2.has('3,8')).toBe(false);

    // Ramp reduces uphill climb cost vs direct cliff step
    battle.tiles[8][3].elevation = 1;
    battle.tiles[8][3].terrain = 'grass';
    battle.tiles[9][2].elevation = 0;
    battle.tiles[9][2].terrain = 'ramp';
    battle.tiles[9][3].elevation = 1;
    battle.tiles[9][3].terrain = 'grass';
    const mCliff = computeMovableTiles(battle, hero);
    // Stepping directly onto elev 1 costs 2 (1 + 1 climb), whereas stepping onto ramp costs 1 then onto elev 1 costs 1!
    expect(mCliff.get('3,8')?.cost).toBe(2);
    expect(mCliff.get('2,9')?.cost).toBe(1);
    expect(mCliff.get('3,9')?.cost).toBe(2);
  });

  it('applies High Ground +2 DMG and Half-Cover bypass from elevated ledges', () => {
    const run = createNewRun(defaultMetaProgress());
    const battle = createBattleFromMap('canyon_terrace', run.roster.slice(0, 4), [], run.items);
    for (let y = 0; y < battle.height; y++) {
      for (let x = 0; x < battle.width; x++) {
        battle.tiles[y][x].cover = null;
        battle.tiles[y][x].elevation = 0;
        battle.tiles[y][x].terrain = 'grass';
      }
    }

    const pea = battle.units.find((u) => u.visualKind === 'pea')!;
    const enemy = battle.units.find((u) => u.team === 'enemy')!;
    pea.pos = { x: 4, y: 6 };
    enemy.pos = { x: 4, y: 3 };
    battle.tiles[4][4].cover = createCover('crate'); // Half cover in front of enemy

    // Level ground: 50% hit chance
    const flatFc = forecastAttack(battle, pea, enemy.pos);
    expect(flatFc.hitChance).toBe(50);
    expect(flatFc.highGroundBonus ?? 0).toBe(0);

    // High Ground (elevation 1 vs 0): strips Half Cover -> 100% hit + +2 DMG!
    battle.tiles[6][4].elevation = 1;
    const highFc = forecastAttack(battle, pea, enemy.pos);
    expect(highFc.hitChance).toBe(100);
    expect(highFc.highGroundBonus).toBe(2);
    expect(highFc.finalDamage).toBeGreaterThanOrEqual(flatFc.finalDamage + 2);
  });

  it('triggers Water Splash (-3 + douse Burn), Lava Plunge (-4 + Burn), and Cliff Drop (-2) knockbacks', () => {
    const run = createNewRun(defaultMetaProgress());
    const squad = run.roster.filter((h) => ['potato', 'pea', 'lemon', 'cow'].includes(h.blueprintId));
    const battle = createBattleFromMap('molten_furnace', squad, [], run.items);
    for (let y = 0; y < battle.height; y++) {
      for (let x = 0; x < battle.width; x++) {
        battle.tiles[y][x].cover = null;
        battle.tiles[y][x].elevation = 0;
        battle.tiles[y][x].terrain = 'soil';
      }
    }

    const spud = battle.units.find((u) => u.visualKind === 'potato')!;
    const enemy = battle.units.find((u) => u.team === 'enemy')!;
    enemy.hp = 30;
    enemy.maxHp = 30;

    // 1. Lava Plunge (-4 HP + Burn 2t)
    battle.tiles[4][4].terrain = 'lava';
    spud.pos = { x: 4, y: 6 };
    enemy.pos = { x: 4, y: 5 };
    const lavaFc = forecastAttack(battle, spud, enemy.pos);
    expect(lavaFc.knockbackHazard).toBe('lava');
    const hpBeforeLava = enemy.hp;
    expect(executeAttack(battle, spud.id, enemy.pos, () => 0)).toBe(true);
    expect(enemy.hp).toBe(hpBeforeLava - lavaFc.finalDamage - 4);
    expect(enemy.statuses.some((s) => s.kind === 'burn')).toBe(true);
    expect(enemy.pos).toEqual({ x: 4, y: 5 }); // bounces back on rim

    // 2. Water Splash (-3 HP & extinguishes Burn!)
    spud.actions.hasAttacked = false;
    battle.tiles[4][4].terrain = 'water';
    const waterFc = forecastAttack(battle, spud, enemy.pos);
    expect(waterFc.knockbackHazard).toBe('water');
    const hpBeforeWater = enemy.hp;
    expect(executeAttack(battle, spud.id, enemy.pos, () => 0)).toBe(true);
    expect(enemy.hp).toBe(hpBeforeWater - waterFc.finalDamage - 3);
    expect(enemy.statuses.some((s) => s.kind === 'burn')).toBe(false);

    // 3. Cliff Drop (-2 HP when knocked off elev 1 -> elev 0!)
    spud.actions.hasAttacked = false;
    battle.tiles[4][4].terrain = 'soil';
    battle.tiles[4][4].elevation = 0;
    battle.tiles[5][4].elevation = 1;
    battle.tiles[6][4].elevation = 1;
    const dropFc = forecastAttack(battle, spud, enemy.pos);
    expect(dropFc.knockbackHazard).toBe('drop');
    const hpBeforeDrop = enemy.hp;
    expect(executeAttack(battle, spud.id, enemy.pos, () => 0)).toBe(true);
    expect(enemy.pos).toEqual({ x: 4, y: 4 });
    expect(enemy.hp).toBe(hpBeforeDrop - dropFc.finalDamage - 2);
  });

  it('executes Mario + Rabbids Hero Sight Overwatch reaction shots (with Hero Sight+ 2x charges)', () => {
    const run = createNewRun(defaultMetaProgress());
    const peaHero = run.roster.find((h) => h.blueprintId === 'pea')!;
    expect(unlockHeroPerk(run, peaHero.uid, 'hero_sight')).toBe(true);

    const battle = createBattleFromMap('vegetable_patch', run.roster.slice(0, 4), [], run.items);
    for (let y = 0; y < battle.height; y++) {
      for (let x = 0; x < battle.width; x++) {
        battle.tiles[y][x].cover = null;
        battle.tiles[y][x].elevation = 0;
        battle.tiles[y][x].terrain = 'grass';
      }
    }

    const pea = battle.units.find((u) => u.visualKind === 'pea')!;
    const enemies = battle.units.filter((u) => u.team === 'enemy');
    const foeA = enemies[0];
    const foeB = enemies[1];
    foeA.hp = 20;
    foeA.maxHp = 20;
    foeB.hp = 20;
    foeB.maxHp = 20;

    pea.pos = { x: 3, y: 6 };
    foeA.pos = { x: 3, y: 1 };
    foeB.pos = { x: 4, y: 1 };

    // Enter Hero Sight Overwatch (spends Attack slot, loads 2 reaction shots via hero_sight perk!)
    expect(executeOverwatch(battle, pea.id)).toBe(true);
    expect(pea.actions.hasAttacked).toBe(true);
    expect(pea.actions.overwatchCharges).toBe(2);
    expect(pea.statuses.some((s) => s.kind === 'overwatch')).toBe(true);

    // Enemy Phase: both foes move into Pea's range and get intercepted!
    startPhase(battle, 'enemy');
    expect(executeMove(battle, foeA.id, { x: 3, y: 3 })).toBe(true);
    expect(foeA.hp).toBeLessThan(20);
    expect(pea.actions.overwatchCharges).toBe(1);

    expect(executeMove(battle, foeB.id, { x: 4, y: 3 })).toBe(true);
    expect(foeB.hp).toBeLessThan(20);
    expect(pea.actions.overwatchCharges).toBe(0);
    expect(pea.statuses.some((s) => s.kind === 'overwatch')).toBe(false);
    expect(battle.pendingEvents.filter((e) => e.type === 'overwatch_shot')).toHaveLength(2);
  });

  it('supports Skill Tree leveling, prerequisites, Multi-Dash chains, Jump Stomp AoE, and Quick Bloom', () => {
    const meta = defaultMetaProgress();
    const run = createNewRun(meta);
    const spudHero = run.roster.find((h) => h.blueprintId === 'potato')!;
    const peaHero = run.roster.find((h) => h.blueprintId === 'pea')!;

    // Heroes start at Level 1 with 1 SP
    expect(spudHero.level).toBe(1);
    expect(spudHero.skillPoints).toBe(1);
    // Capstone Jump Stomp cannot be unlocked without Swift Roots prerequisite
    expect(canUnlockPerk(spudHero.perkIds, 5, 'stomp_landing')).toBe(false);

    // Unlock Swift Roots (+1 Move, +1 Jump) & give extra SP to test Capstone Jump Stomp + Multi-Dash
    const baseMove = spudHero.moveRange;
    expect(unlockHeroPerk(run, spudHero.uid, 'swift_roots')).toBe(true);
    expect(spudHero.moveRange).toBe(baseMove + 1);

    spudHero.skillPoints += 3;
    expect(unlockHeroPerk(run, spudHero.uid, 'double_dash')).toBe(true);
    expect(unlockHeroPerk(run, spudHero.uid, 'stomp_landing')).toBe(true);

    // Give Pea Quick Bloom (-1 skill CD + 2 HP self-heal on skill cast)
    expect(unlockHeroPerk(run, peaHero.uid, 'quick_bloom')).toBe(true);

    const squad = run.roster.filter((h) => ['potato', 'pea', 'lemon', 'cow'].includes(h.blueprintId));
    run.activeSquadUids = squad.map((h) => h.uid);
    const battle = createBattleFromMap('vegetable_patch', squad, [], run.items);
    for (let y = 0; y < battle.height; y++) {
      for (let x = 0; x < battle.width; x++) {
        battle.tiles[y][x].cover = null;
        battle.tiles[y][x].elevation = 0;
        battle.tiles[y][x].terrain = 'grass';
      }
    }

    const spud = battle.units.find((u) => u.visualKind === 'potato')!;
    const pea = battle.units.find((u) => u.visualKind === 'pea')!;
    const [foeA, foeB] = battle.units.filter((u) => u.team === 'enemy');
    foeA.hp = 15;
    foeB.hp = 15;

    // Multi-Dash 2 different enemies in one turn!
    spud.pos = { x: 3, y: 6 };
    foeA.pos = { x: 3, y: 4 };
    foeB.pos = { x: 5, y: 4 };
    pea.pos = { x: 3, y: 7 };

    expect(executeDash(battle, spud.id, foeA.id)).toBe(true);
    expect(spud.actions.hasDashed).toBe(false); // 1 dash still left!
    const secondDashes = computeDashOptions(battle, spud);
    expect(secondDashes.some((d) => d.enemyId === foeA.id)).toBe(false); // cannot dash same foe twice
    expect(secondDashes.some((d) => d.enemyId === foeB.id)).toBe(true);
    expect(executeDash(battle, spud.id, foeB.id)).toBe(true);
    expect(spud.actions.hasDashed).toBe(true);

    // Jump Stomp AoE deals 2 dmg to adjacent enemy on landing (beyond normal walk range!)
    battle.units.filter((u) => u.team === 'enemy' && u.id !== foeA.id).forEach((e, i) => {
      e.pos = { x: 0, y: i };
    });
    spud.pos = { x: 3, y: 8 };
    pea.pos = { x: 3, y: 4 };
    foeA.pos = { x: 3, y: 0 };
    const foeHpBeforeStomp = foeA.hp;
    expect(executeTeamJump(battle, spud.id, { x: 3, y: 1 })).toBe(true);
    expect(foeA.hp).toBe(foeHpBeforeStomp - 2);
    expect(battle.pendingEvents.some((e) => e.type === 'stomp')).toBe(true);

    // Quick Bloom reduces Pea's cooldown by 1 & heals +2 HP on cast!
    pea.hp = pea.maxHp - 3;
    pea.pos = { x: 3, y: 3 };
    const baseCd = pea.ability!.cooldown;
    expect(executeAbility(battle, pea.id, foeA.pos)).toBe(true);
    expect(pea.abilityCooldown).toBe(Math.max(1, baseCd - 1));
    expect(pea.hp).toBe(pea.maxHp - 1);

    // Victory awards XP and triggers Level-Up into Lv.2 (+2 Max HP, +1 SP)!
    battle.units.filter((u) => u.team === 'enemy').forEach((e) => {
      e.hp = 0;
      e.alive = false;
    });
    battle.status = 'victory';
    run.currentNodeId = run.nodes.find((n) => n.stage === 0)!.id;
    const spudMaxHpBefore = spudHero.maxHp;
    applyBattleOutcomeToRun(run, battle, meta);
    expect(run.pendingReward?.xpEarned).toBeGreaterThanOrEqual(getXpToNextLevel(1));
    expect(run.pendingReward?.levelUps?.some((l) => l.heroUid === spudHero.uid)).toBe(true);
    expect(spudHero.level).toBe(2);
    expect(spudHero.maxHp).toBe(spudMaxHpBefore + 2);
  });

  it('includes valid new showcase maps (creek_crossing, canyon_terrace, molten_furnace) with elevation, bridges & hazards', () => {
    for (const id of ['creek_crossing', 'canyon_terrace', 'molten_furnace'] as const) {
      const m = MAP_TEMPLATES[id];
      expect(m).toBeDefined();
      expect(m.width).toBeGreaterThanOrEqual(9);
      expect(m.height).toBeGreaterThanOrEqual(11);
      expect(m.tiles.some((t) => (t.elevation ?? 0) >= 1)).toBe(true);
      expect(m.tiles.some((t) => t.terrain === 'bridge')).toBe(true);
      expect(m.tiles.some((t) => t.terrain === 'water' || t.terrain === 'lava')).toBe(true);
      const battle = createBattleFromMap(id, createNewRun(defaultMetaProgress()).roster.slice(0, 4), [], {});
      for (const u of battle.units) {
        const t = tileAt(battle, u.pos);
        expect(t).not.toBeNull();
        expect(t!.terrain).not.toBe('water');
        expect(t!.terrain).not.toBe('lava');
        expect(t!.cover).toBeNull();
      }
      expect(posKey(battle.units[0].pos)).toBeTruthy();
    }
  });
});
