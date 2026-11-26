import { describe, expect, it } from 'vitest';
import { ENEMY_BLUEPRINTS } from '../../data/enemies';
import { MAP_TEMPLATES } from '../../data/maps';
import { PRODUCE_BLUEPRINTS } from '../../data/produce';
import { ALL_SKILL_PERK_IDS, HERO_SKILL_TREES, canUnlockPerk, getXpToNextLevel } from '../../data/skills';
import { ALT_WEAPONS, ALT_WEAPONS_BY_SPECIES, STARTER_UNLOCKED_WEAPONS } from '../../data/weapons';
import { runEnemyUnitTurn } from '../ai';
import {
  createBattleFromMap,
  createBattleUnitFromEnemy,
  damageBridgeAt,
  executeAbility,
  executeAttack,
  executeDash,
  executeMove,
  executeOverwatch,
  executeTeamJump,
  finishPrepPhase,
  startPhase,
  swapPrepHeroPositions,
  swapPrepHeroWithBench,
} from '../battle';
import { forecastAttack } from '../combat';
import { difficultyFor, getHeatSeedMultiplier } from '../difficulty';
import { createCover, getAdjacentCoverBadges, posKey, tileAt } from '../grid';
import { createRng, generateActNodes } from '../mapgen';
import { computeDashOptions, computeMovableTiles, getLinkedBurrowDest } from '../pathfinding';
import {
  applyBattleOutcomeToRun,
  claimShrineBlessing,
  claimWeaponReward,
  createHeroFromBlueprint,
  createNewRun,
  defaultMetaProgress,
  equipHeroWeapon,
  generateRewardForNode,
  openShrineNode,
  respecHeroPerks,
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

  it('executes Mario + Rabbids Hero Sight Overwatch reaction shots (with Snap-Pea Double Hero Sight + Pinning Volley Root)', () => {
    const run = createNewRun(defaultMetaProgress());
    const peaHero = run.roster.find((h) => h.blueprintId === 'pea')!;
    peaHero.skillPoints = 4;
    expect(unlockHeroPerk(run, peaHero.uid, 'pea_hawk_pod')).toBe(true);
    expect(unlockHeroPerk(run, peaHero.uid, 'pea_double_watch')).toBe(true);
    expect(unlockHeroPerk(run, peaHero.uid, 'pea_suppress')).toBe(true);

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

    // Enter Hero Sight Overwatch (spends Attack slot, loads 2 reaction shots via pea_double_watch!)
    expect(executeOverwatch(battle, pea.id)).toBe(true);
    expect(pea.actions.hasAttacked).toBe(true);
    expect(pea.actions.overwatchCharges).toBe(2);
    expect(pea.statuses.some((s) => s.kind === 'overwatch')).toBe(true);

    // Enemy Phase: both foes move into Pea's range, get intercepted AND Rooted by Pinning Volley!
    startPhase(battle, 'enemy');
    expect(executeMove(battle, foeA.id, { x: 3, y: 3 })).toBe(true);
    expect(foeA.hp).toBeLessThan(20);
    expect(foeA.statuses.some((s) => s.kind === 'rooted')).toBe(true);
    expect(pea.actions.overwatchCharges).toBe(1);

    expect(executeMove(battle, foeB.id, { x: 4, y: 3 })).toBe(true);
    expect(foeB.hp).toBeLessThan(20);
    expect(pea.actions.overwatchCharges).toBe(0);
    expect(pea.statuses.some((s) => s.kind === 'overwatch')).toBe(false);
    expect(battle.pendingEvents.filter((e) => e.type === 'overwatch_shot')).toHaveLength(2);
  });

  it('supports unique per-hero Skill Trees, cross-species guards, Multi-Dash, Tater Quake Stomp, Morning Mist, and Free Respec', () => {
    const meta = defaultMetaProgress();
    const run = createNewRun(meta);
    const spudHero = run.roster.find((h) => h.blueprintId === 'potato')!;
    const cowHero = run.roster.find((h) => h.blueprintId === 'cow')!;
    const lettuceHero = run.roster.find((h) => h.blueprintId === 'lettuce')!;

    // Heroes start at Level 1 with 1 SP; cannot unlock another species' perk or skip prerequisite!
    expect(spudHero.level).toBe(1);
    expect(spudHero.skillPoints).toBe(1);
    expect(canUnlockPerk(spudHero.perkIds, 5, 'cow_double_gore', 'potato')).toBe(false);
    expect(canUnlockPerk(spudHero.perkIds, 5, 'pot_stomp', 'potato')).toBe(false);

    // Cow unlocks Double Gore (+1 Move, 2× Dashes/turn, +1 Dash DMG)
    const cowBaseMove = cowHero.moveRange;
    expect(unlockHeroPerk(run, cowHero.uid, 'cow_double_gore')).toBe(true);
    expect(cowHero.moveRange).toBe(cowBaseMove + 1);

    // Spudnik unlocks Heavy Masher -> Tater Quake (Jump Stomp 3 AoE!)
    spudHero.skillPoints += 2;
    expect(unlockHeroPerk(run, spudHero.uid, 'pot_heavy_mash')).toBe(true);
    expect(unlockHeroPerk(run, spudHero.uid, 'pot_stomp')).toBe(true);

    // Crisphead unlocks Morning Mist (-1 Dewy Refresh CD + 2 HP self-heal on cast!)
    expect(unlockHeroPerk(run, lettuceHero.uid, 'let_morning_mist')).toBe(true);

    const squad = run.roster.filter((h) => ['potato', 'cow', 'lettuce', 'lemon'].includes(h.blueprintId));
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
    const cow = battle.units.find((u) => u.visualKind === 'cow')!;
    const lettuce = battle.units.find((u) => u.visualKind === 'lettuce')!;
    const [foeA, foeB] = battle.units.filter((u) => u.team === 'enemy');
    foeA.hp = 15;
    foeB.hp = 15;

    // Multi-Dash 2 different enemies with Cow's Double Gore!
    cow.pos = { x: 3, y: 6 };
    foeA.pos = { x: 3, y: 4 };
    foeB.pos = { x: 5, y: 4 };
    spud.pos = { x: 1, y: 8 };
    lettuce.pos = { x: 6, y: 8 };

    expect(executeDash(battle, cow.id, foeA.id)).toBe(true);
    expect(cow.actions.hasDashed).toBe(false);
    const secondDashes = computeDashOptions(battle, cow);
    expect(secondDashes.some((d) => d.enemyId === foeA.id)).toBe(false);
    expect(secondDashes.some((d) => d.enemyId === foeB.id)).toBe(true);
    expect(executeDash(battle, cow.id, foeB.id)).toBe(true);
    expect(cow.actions.hasDashed).toBe(true);

    // Spudnik Tater Quake Jump Stomp deals 3 AoE dmg to adjacent enemy on landing!
    battle.units.filter((u) => u.team === 'enemy' && u.id !== foeA.id).forEach((e, i) => {
      e.pos = { x: 0, y: i };
    });
    spud.pos = { x: 3, y: 7 };
    lettuce.pos = { x: 3, y: 4 };
    foeA.pos = { x: 3, y: 0 };
    const foeHpBeforeStomp = foeA.hp;
    expect(executeTeamJump(battle, spud.id, { x: 3, y: 1 })).toBe(true);
    expect(foeA.hp).toBe(foeHpBeforeStomp - 3);
    expect(battle.pendingEvents.some((e) => e.type === 'stomp')).toBe(true);

    // Crisphead Morning Mist reduces Dewy Refresh cooldown by 1 & heals +5 (base 3 + 2 delta) + 2 self-heal!
    lettuce.hp = 3;
    const baseCd = lettuce.ability!.cooldown;
    expect(executeAbility(battle, lettuce.id, lettuce.pos)).toBe(true);
    expect(lettuce.abilityCooldown).toBe(Math.max(1, baseCd - 1));
    expect(lettuce.hp).toBeGreaterThanOrEqual(8);

    // Victory awards XP and triggers Level-Up into Lv.2 (+2 Max HP, +1 SP)!
    battle.units.filter((u) => u.team === 'enemy').forEach((e) => {
      e.hp = 0;
      e.alive = false;
    });
    battle.status = 'victory';
    run.currentNodeId = run.nodes.find((n) => n.stage === 1)!.id;
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

  it('warps units across rivers & cliffs via linked Gopher Burrow pipes for 1 Move cost', () => {
    const run = createNewRun(defaultMetaProgress());
    const battle = createBattleFromMap('creek_crossing', run.roster.slice(0, 4), [], run.items);
    expect(battle.burrowPairs && battle.burrowPairs.length > 0).toBe(true);

    const [burrowA, burrowB] = battle.burrowPairs![0];
    expect(getLinkedBurrowDest(battle, burrowA)).toEqual(burrowB);
    expect(getLinkedBurrowDest(battle, burrowB)).toEqual(burrowA);

    const hero = battle.units.find((u) => u.team === 'player')!;
    // Move allies & enemies out of the burrow endpoints
    battle.units.forEach((u, idx) => {
      if (u.id !== hero.id) u.pos = { x: idx % battle.width, y: u.team === 'enemy' ? 0 : battle.height - 1 };
    });
    hero.pos = { ...burrowA };

    const movable = computeMovableTiles(battle, hero);
    const destNode = movable.get(posKey(burrowB));
    expect(destNode).toBeDefined();
    expect(destNode!.cost).toBe(1);

    battle.pendingEvents = [];
    expect(executeMove(battle, hero.id, burrowB)).toBe(true);
    expect(hero.pos).toEqual(burrowB);
    expect(battle.pendingEvents.some((e) => e.type === 'burrow_warp')).toBe(true);
  });

  it('triggers Boss Phase 2 Enrage at <= 50% HP and resolves dodgeable Telegraphed Boss super-attacks', () => {
    const run = createNewRun(defaultMetaProgress());
    const battle = createBattleFromMap('scarecrow_stand', run.roster.slice(0, 4), [], run.items);
    const boss = battle.units.find((u) => u.isBoss)!;
    const hero = battle.units.find((u) => u.team === 'player')!;
    expect(boss).toBeDefined();
    expect(battle.bossPhase).toBe(1);

    // Clear cover so Pea/hero has clear shot, drop boss near half HP, then hit it across <= 50% threshold!
    for (let y = 0; y < battle.height; y++) {
      for (let x = 0; x < battle.width; x++) {
        battle.tiles[y][x].cover = null;
      }
    }
    boss.pos = { x: 4, y: 4 };
    hero.pos = { x: 4, y: 6 };
    boss.hp = Math.floor(boss.maxHp / 2) + 1;

    battle.pendingEvents = [];
    expect(executeAttack(battle, hero.id, boss.pos, () => 0)).toBe(true);
    expect(battle.bossPhase).toBe(2);
    expect(boss.statuses.some((s) => s.kind === 'shield')).toBe(true);
    expect(boss.statuses.some((s) => s.kind === 'boosted')).toBe(true);
    expect(battle.pendingEvents.some((e) => e.type === 'boss_phase')).toBe(true);

    // Boss runs its turn and schedules a 1-turn Red Warning Telegraphed super-attack!
    startPhase(battle, 'enemy');
    runEnemyUnitTurn(battle, boss.id);
    expect(battle.bossTelegraphs && battle.bossTelegraphs.length).toBeGreaterThan(0);
    const tel = battle.bossTelegraphs![0];
    expect(tel.tiles.length).toBeGreaterThan(0);

    // Place one hero INSIDE the red telegraph zone and one hero OUTSIDE (dodged!)
    const players = battle.units.filter((u) => u.team === 'player' && u.alive);
    const hitHero = players[0];
    const safeHero = players[1];
    hitHero.hp = 20;
    hitHero.maxHp = 20;
    safeHero.hp = 20;
    safeHero.maxHp = 20;
    hitHero.pos = { ...tel.tiles[0] };
    // Find a tile guaranteed NOT in tel.tiles
    const telKeys = new Set(tel.tiles.map(posKey));
    let safePos = { x: 0, y: 11 };
    for (let y = battle.height - 1; y >= 0; y--) {
      for (let x = 0; x < battle.width; x++) {
        if (!telKeys.has(posKey({ x, y })) && !battle.units.some((u) => u.alive && u.pos.x === x && u.pos.y === y)) {
          safePos = { x, y };
          break;
        }
      }
    }
    safeHero.pos = safePos;

    // Next Enemy Phase detonates the telegraph: hitHero takes damage, safeHero dodges cleanly!
    battle.pendingEvents = [];
    startPhase(battle, 'enemy');
    expect(battle.bossTelegraphs).toHaveLength(0);
    expect(hitHero.hp).toBeLessThan(20);
    expect(safeHero.hp).toBe(20);
    expect(battle.pendingEvents.some((e) => e.type === 'boss_telegraph_strike')).toBe(true);
  });

  it('triggers Partner Follow-Up Assist (+1 DMG) when an adjacent non-rooted ally flanks the target', () => {
    const run = createNewRun(defaultMetaProgress());
    const battle = createBattleFromMap('vegetable_patch', run.roster.slice(0, 4), [], run.items);
    for (let y = 0; y < battle.height; y++) {
      for (let x = 0; x < battle.width; x++) {
        battle.tiles[y][x].cover = null;
        battle.tiles[y][x].elevation = 0;
        battle.tiles[y][x].terrain = 'grass';
      }
    }

    const [shooter, partner, ...restHeroes] = battle.units.filter((u) => u.team === 'player');
    restHeroes.forEach((h, i) => {
      h.pos = { x: i, y: battle.height - 1 };
    });
    const enemy = battle.units.find((u) => u.team === 'enemy')!;
    enemy.hp = 25;
    enemy.maxHp = 25;

    shooter.pos = { x: 4, y: 6 };
    enemy.pos = { x: 4, y: 4 };
    partner.pos = { x: 0, y: 8 }; // far away — no assist

    const soloFc = forecastAttack(battle, shooter, enemy.pos);
    expect(soloFc.partnerAssistDamage ?? 0).toBe(0);

    // Move partner adjacent to enemy -> +1 Partner Follow-Up Assist!
    partner.pos = { x: 5, y: 4 };
    const assistFc = forecastAttack(battle, shooter, enemy.pos);
    expect(assistFc.partnerAssistDamage).toBe(1);
    expect(assistFc.partnerAssistUnitId).toBe(partner.id);

    // Rooted partner cannot assist!
    partner.statuses.push({ kind: 'rooted', turns: 1 });
    const rootedFc = forecastAttack(battle, shooter, enemy.pos);
    expect(rootedFc.partnerAssistDamage ?? 0).toBe(0);

    // Clear root & execute attack -> deals finalDamage + 1 assist & emits 'partner_assist'!
    partner.statuses = [];
    battle.pendingEvents = [];
    const hpBefore = enemy.hp;
    expect(executeAttack(battle, shooter.id, enemy.pos, () => 0)).toBe(true);
    expect(enemy.hp).toBe(hpBefore - assistFc.finalDamage - 1);
    expect(battle.pendingEvents.some((e) => e.type === 'partner_assist')).toBe(true);
  });

  it('launches units across water and +2 elevation via Bouncy Mushroom Launchpads for 1 Move', () => {
    const run = createNewRun(defaultMetaProgress());
    const battle = createBattleFromMap('creek_crossing', run.roster.slice(0, 4), [], run.items);
    for (let y = 0; y < battle.height; y++) {
      for (let x = 0; x < battle.width; x++) {
        battle.tiles[y][x].cover = null;
        battle.tiles[y][x].elevation = 0;
        battle.tiles[y][x].terrain = 'grass';
      }
    }

    const hero = battle.units.find((u) => u.team === 'player')!;
    battle.units.forEach((u, i) => {
      if (u.id !== hero.id) u.pos = { x: i % battle.width, y: u.team === 'enemy' ? 0 : battle.height - 1 };
    });

    // Place hero on bounce_pad at (4,7); river water at (4,6) & (4,5); elevated +2 cliff at (4,4)!
    battle.tiles[7][4].terrain = 'bounce_pad';
    battle.tiles[6][4].terrain = 'water';
    battle.tiles[5][4].terrain = 'water';
    battle.tiles[4][4].terrain = 'grass';
    battle.tiles[4][4].elevation = 2;
    hero.pos = { x: 4, y: 7 };

    const movable = computeMovableTiles(battle, hero);
    const launchNode = movable.get('4,4');
    expect(launchNode).toBeDefined();
    expect(launchNode!.cost).toBe(1);

    battle.pendingEvents = [];
    expect(executeMove(battle, hero.id, { x: 4, y: 4 })).toBe(true);
    expect(hero.pos).toEqual({ x: 4, y: 4 });
    expect(battle.pendingEvents.some((e) => e.type === 'bounce_launch')).toBe(true);
  });

  it('bowls Rolling Pumpkin Boulders up to 5 tiles for 4 DMG + crate smash + knockback', () => {
    const run = createNewRun(defaultMetaProgress());
    const battle = createBattleFromMap('vegetable_patch', run.roster.slice(0, 4), [], run.items);
    for (let y = 0; y < battle.height; y++) {
      for (let x = 0; x < battle.width; x++) {
        battle.tiles[y][x].cover = null;
        battle.tiles[y][x].elevation = 0;
        battle.tiles[y][x].terrain = 'grass';
      }
    }

    const shooter = battle.units.find((u) => u.team === 'player')!;
    const enemy = battle.units.find((u) => u.team === 'enemy')!;
    battle.units.forEach((u, i) => {
      if (u.id !== shooter.id && u.id !== enemy.id) {
        u.pos = { x: i % battle.width, y: u.team === 'enemy' ? 0 : battle.height - 1 };
      }
    });

    shooter.pos = { x: 4, y: 7 };
    battle.tiles[6][4].cover = createCover('pumpkin');
    battle.tiles[5][4].cover = createCover('crate');
    enemy.pos = { x: 4, y: 4 };
    enemy.hp = 20;
    enemy.maxHp = 20;

    const fc = forecastAttack(battle, shooter, { x: 4, y: 6 });
    expect(fc.canAttack).toBe(true);
    expect(fc.isPumpkinTarget).toBe(true);
    expect(fc.pumpkinRollDir).toEqual({ x: 0, y: -1 });

    battle.pendingEvents = [];
    expect(executeAttack(battle, shooter.id, { x: 4, y: 6 }, () => 0)).toBe(true);
    expect(battle.tiles[6][4].cover).toBeNull(); // pumpkin rolled off start tile
    expect(battle.tiles[5][4].cover).toBeNull(); // crate smashed in bowling lane!
    expect(enemy.hp).toBeLessThanOrEqual(16); // took at least 4 pumpkin DMG!
    expect(battle.pendingEvents.some((e) => e.type === 'pumpkin_roll')).toBe(true);
  });

  it('collapses Wooden Bridges under fire, turning them into water and splashing occupants', () => {
    const run = createNewRun(defaultMetaProgress());
    const battle = createBattleFromMap('creek_crossing', run.roster.slice(0, 4), [], run.items);
    // Find a wooden bridge tile with bridgeHp initialized
    let bridgePos: { x: number; y: number } | null = null;
    for (let y = 0; y < battle.height; y++) {
      for (let x = 0; x < battle.width; x++) {
        const t = battle.tiles[y][x];
        if (t.terrain === 'bridge' && (t.bridgeHp ?? 0) > 0) {
          bridgePos = { x, y };
          break;
        }
      }
      if (bridgePos) break;
    }
    expect(bridgePos).not.toBeNull();

    const enemy = battle.units.find((u) => u.team === 'enemy')!;
    enemy.pos = { ...bridgePos! };
    enemy.hp = 20;
    enemy.maxHp = 20;

    battle.pendingEvents = [];
    const collapsed = damageBridgeAt(battle, bridgePos!, 10);
    expect(collapsed).toBe(true);
    const tile = tileAt(battle, bridgePos!)!;
    expect(tile.terrain === 'water' || tile.terrain === 'lava').toBe(true);
    expect(battle.pendingEvents.some((e) => e.type === 'bridge_collapse')).toBe(true);
    // Occupant took splash damage & was moved onto nearest dry tile!
    expect(enemy.hp).toBeLessThan(20);
    const afterTile = tileAt(battle, enemy.pos)!;
    expect(afterTile.terrain).not.toBe('water');
    expect(afterTile.terrain).not.toBe('lava');
  });

  it('supports Pre-Battle Tactical Prep Phase spawn swaps, bench swaps, and Start Battle lock-in', () => {
    const run = createNewRun(defaultMetaProgress());
    const benchHero = createHeroFromBlueprint('chili');
    run.roster.push(benchHero);

    const activeSquad = run.activeSquadUids
      .map((uid) => run.roster.find((h) => h.uid === uid)!)
      .filter(Boolean);

    const battle = createBattleFromMap('creek_crossing', activeSquad, [], run.items, undefined, {
      enablePrepPhase: true,
    });
    expect(battle.prepPhase).toBe(true);
    expect(battle.playerSpawnPositions && battle.playerSpawnPositions.length >= activeSquad.length).toBe(true);

    const [heroA, heroB] = battle.units.filter((u) => u.team === 'player');
    const posABefore = { ...heroA.pos };
    const posBBefore = { ...heroB.pos };

    // Swap two heroes across spawn positions
    expect(swapPrepHeroPositions(battle, posABefore, posBBefore)).toBe(true);
    expect(heroA.pos).toEqual(posBBefore);
    expect(heroB.pos).toEqual(posABefore);

    // Swap heroB with bench hero Chili
    const swapped = swapPrepHeroWithBench(battle, heroB.id, benchHero);
    expect(swapped).not.toBeNull();
    expect(swapped!.visualKind).toBe('chili');
    expect(swapped!.pos).toEqual(posABefore);

    // Finish Prep Phase -> locks in Turn 1!
    expect(finishPrepPhase(battle)).toBe(true);
    expect(battle.prepPhase).toBe(false);
    // Further prep swaps blocked once battle starts
    expect(swapPrepHeroPositions(battle, posBBefore, posABefore)).toBe(false);
  });

  it('supports Armory Alternate Weapons unlocking, switching, and preserving upgrade deltas', () => {
    const run = createNewRun(defaultMetaProgress());
    expect(ALT_WEAPONS).toHaveLength(19);
    for (const wid of STARTER_UNLOCKED_WEAPONS) {
      expect(run.unlockedWeaponIds).toContain(wid);
    }

    const cow = run.roster.find((h) => h.species === 'cow')!;
    const baseWeaponId = cow.weapon.id;
    // Upgrade Cow's base weapon by +2 damage (simulating Workshop/Graft upgrade)
    cow.weapon.damage += 2;

    // Equip Cow's starter-unlocked Alt Weapon ('milk_jug_lob' — Creamery Lobber, base 4 dmg + 2 upgrade = 6!)
    expect(equipHeroWeapon(run, cow.uid, 'milk_jug_lob')).toBe(true);
    expect(cow.equippedWeaponId).toBe('milk_jug_lob');
    expect(cow.weapon.id).toBe('milk_jug_lob');
    expect(cow.weapon.arc).toBe('lobbed');
    expect(cow.weapon.damage).toBe(6);

    // Switching back to base weapon preserves the +2 upgrade delta!
    expect(equipHeroWeapon(run, cow.uid, baseWeaponId)).toBe(true);
    expect(cow.weapon.id).toBe(baseWeaponId);

    // Elite reward bundles offer unlockable Alternate Weapons!
    const eliteNode = {
      id: 'elite_test',
      act: 0,
      stage: 3,
      lane: 1,
      type: 'elite' as const,
      name: 'Test Elite',
      subtitle: 'Armory test',
      mapId: 'creek_crossing',
      nextIds: [],
      completed: false,
    };
    const reward = generateRewardForNode(run, eliteNode, () => 0.1);
    run.pendingReward = reward;
    expect(reward.weaponChoices && reward.weaponChoices.length > 0).toBe(true);
    const chosenWeaponId = reward.weaponChoices![0];
    expect(claimWeaponReward(run, chosenWeaponId)).toBe(true);
    expect(run.unlockedWeaponIds).toContain(chosenWeaponId);
  });

  it('runs Survive 4 Turns (barnyard_siege) reinforcements & Escort Seed Cart (harvest_railroad) objectives', () => {
    const run = createNewRun(defaultMetaProgress());
    const squad = run.roster.slice(0, 4);

    // 1. Survive 4 Turns on Barnyard Siege
    const siege = createBattleFromMap('barnyard_siege', squad, [], run.items);
    expect(siege.objective).toBe('survive');
    expect(siege.surviveTurns).toBe(4);
    const initialEnemyCount = siege.units.filter((u) => u.team === 'enemy').length;

    // Advance to Turn 2 -> spawns reinforcements!
    siege.pendingEvents = [];
    startPhase(siege, 'player');
    expect(siege.turn).toBe(2);
    expect(siege.units.filter((u) => u.team === 'enemy').length).toBeGreaterThan(initialEnemyCount);
    expect(siege.pendingEvents.some((e) => e.type === 'reinforcement_spawn')).toBe(true);

    // Advance Turns 3, 4, then Turn 5 -> Victory!
    startPhase(siege, 'player'); // Turn 3
    startPhase(siege, 'player'); // Turn 4
    expect(siege.status).toBe('ongoing');
    startPhase(siege, 'player'); // Survived 4 full turns!
    expect(siege.status).toBe('victory');

    // 2. Escort Golden Seed Cart on Harvest Railroad
    const escort = createBattleFromMap('harvest_railroad', squad, [], run.items);
    expect(escort.objective).toBe('escort');
    const cart = escort.units.find((u) => u.isEscortCart)!;
    expect(cart).toBeDefined();
    expect(cart.visualKind).toBe('seed_cart');
    const cartStartY = cart.pos.y;

    // Clear obstacles directly ahead of cart so it advances cleanly on Turn 2
    for (let y = 0; y < escort.height; y++) {
      escort.tiles[y][cart.pos.x].cover = null;
    }
    escort.units.forEach((u, i) => {
      if (u.id !== cart.id) u.pos = { x: i % 2 === 0 ? 0 : escort.width - 1, y: u.team === 'enemy' ? 1 : escort.height - 1 };
    });

    escort.pendingEvents = [];
    startPhase(escort, 'player');
    expect(cart.pos.y).toBeLessThan(cartStartY);
    expect(escort.pendingEvents.some((e) => e.type === 'escort_move')).toBe(true);

    // Place cart 1 tile south of the north gate -> next turn reaches Gate and wins!
    let gatePos: { x: number; y: number } | null = null;
    for (let y = 0; y < escort.height; y++) {
      for (let x = 0; x < escort.width; x++) {
        if (escort.tiles[y][x].terrain === 'gate') gatePos = { x, y };
      }
    }
    expect(gatePos).not.toBeNull();
    cart.pos = { x: gatePos!.x, y: gatePos!.y + 1 };
    startPhase(escort, 'player');
    expect(escort.status).toBe('victory');
  });

  it('scales Harvest Heat Ascension (0-5) difficulty, brittle crates, Heirloom Seed multiplier, and meta unlock', () => {
    const heat0 = difficultyFor(0, 1, 'skirmish', 0);
    const heat5 = difficultyFor(0, 1, 'skirmish', 5);
    expect(heat5.hpMult).toBeGreaterThan(heat0.hpMult);
    // Heat 5 sharpens bosses and Veterans; Heat 2 adds a Veteran to elites and late floors.
    expect(heat5.veteranDamageBonus).toBe(1);
    expect(difficultyFor(0, 5, 'boss', 5).damageBonus).toBeGreaterThan(difficultyFor(0, 5, 'boss', 0).damageBonus);
    expect(difficultyFor(0, 1, 'elite', 5).veterans).toBeGreaterThan(difficultyFor(0, 1, 'elite', 0).veterans);
    expect(difficultyFor(0, 4, 'skirmish', 5).veterans).toBeGreaterThan(heat0.veterans);
    expect(heat5.veterans).toBe(0);
    expect(getHeatSeedMultiplier(5)).toBeGreaterThan(getHeatSeedMultiplier(0));

    // Heat 3+ makes wooden crates start cracked (-2 HP)!
    const meta = defaultMetaProgress();
    const run = createNewRun(meta, 'spring', 12345, 3);
    const battle = createBattleFromMap('vegetable_patch', run.roster.slice(0, 4), [], run.items, undefined, {
      harvestHeat: 3,
    });
    const crates = battle.tiles
      .flat()
      .map((t) => t.cover)
      .filter((c) => c && c.kind === 'crate');
    expect(crates.length).toBeGreaterThan(0);
    for (const c of crates) {
      expect(c!.hp).toBe(c!.maxHp - 2);
    }

    // Winning the final Act 3 Boss at Heat 1 unlocks Harvest Heat 2 in MetaProgress!
    const winMeta = defaultMetaProgress();
    winMeta.maxHeatUnlocked = 1;
    const winRun = createNewRun(winMeta, 'spring', 999, 1);
    winRun.act = 2; // Final act
    const bossNode = winRun.nodes.find((n) => n.type === 'boss')!;
    winRun.currentNodeId = bossNode.id;
    const finalBattle = createBattleFromMap(bossNode.mapId!, winRun.roster.slice(0, 4), [], winRun.items, undefined, {
      harvestHeat: 1,
    });
    finalBattle.units.filter((u) => u.team === 'enemy').forEach((e) => {
      e.hp = 0;
      e.alive = false;
    });
    finalBattle.status = 'victory';
    applyBattleOutcomeToRun(winRun, finalBattle, winMeta);
    expect(winRun.status).toBe('victory');
    expect(winMeta.maxHeatUnlocked).toBe(2);
  });

  it('supports free perk respec, Living Barricade full cover, Citric Meltdown acid explosion, Salad Tornado free move, Shrine blessings, and Harvest Bell boss empowerment', () => {
    const meta = defaultMetaProgress();
    const run = createNewRun(meta, 'spring', 4242);
    const cowHero = run.roster.find((h) => h.blueprintId === 'cow')!;
    const lemonHero = run.roster.find((h) => h.blueprintId === 'lemon')!;
    const lettuceHero = run.roster.find((h) => h.blueprintId === 'lettuce')!;

    // 1. Free Respec refunds 100% SP and reverts permanent stat boosts cleanly!
    const baseCowHp = cowHero.maxHp;
    const baseCowMove = cowHero.moveRange;
    cowHero.skillPoints = 4;
    expect(unlockHeroPerk(run, cowHero.uid, 'cow_double_gore')).toBe(true);
    expect(unlockHeroPerk(run, cowHero.uid, 'cow_barricade')).toBe(true);
    expect(cowHero.moveRange).toBe(baseCowMove + 1);
    expect(cowHero.maxHp).toBeGreaterThan(baseCowHp);
    expect(cowHero.skillPoints).toBe(2);

    expect(respecHeroPerks(run, cowHero.uid)).toBe(true);
    expect(cowHero.perkIds).toHaveLength(0);
    expect(cowHero.skillPoints).toBe(4);
    expect(cowHero.moveRange).toBe(baseCowMove);
    expect(cowHero.maxHp).toBe(baseCowHp);

    // 2. Unlock bespoke perks across Cow, Lemon & Lettuce for live combat checks!
    expect(unlockHeroPerk(run, cowHero.uid, 'cow_barricade')).toBe(true);
    lemonHero.skillPoints = 5;
    expect(unlockHeroPerk(run, lemonHero.uid, 'lem_corrosive')).toBe(true);
    expect(unlockHeroPerk(run, lemonHero.uid, 'lem_splash_zone')).toBe(true);
    expect(unlockHeroPerk(run, lemonHero.uid, 'lem_meltdown')).toBe(true);
    lettuceHero.skillPoints = 5;
    expect(unlockHeroPerk(run, lettuceHero.uid, 'let_morning_mist')).toBe(true);
    expect(unlockHeroPerk(run, lettuceHero.uid, 'let_leaf_vault')).toBe(true);
    expect(unlockHeroPerk(run, lettuceHero.uid, 'let_salad_tornado')).toBe(true);

    // 3. Watering Shrine blessing grants nextBattleBuff (+Boosted, Shield, +1 Move)!
    const shrineNode = run.nodes.find((n) => n.type === 'shrine')!;
    expect(shrineNode).toBeDefined();
    expect(openShrineNode(run, shrineNode.id)).toBe(true);
    expect(run.status).toBe('shrine');
    expect(claimShrineBlessing(run, 'blessing')).toBe(true);
    expect(run.status).toBe('map');
    expect(run.nextBattleBuff?.boost).toBe(true);
    expect(run.nextBattleBuff?.shield).toBe(true);
    expect(run.nextBattleBuff?.moveBonus).toBe(1);

    // 4. Create battle with nextBattleBuff + bossEmpowered active!
    const squad = [cowHero, lemonHero, lettuceHero];
    const battle = createBattleFromMap('scarecrow_stand', squad, [], run.items, undefined, {
      nextBattleBuff: run.nextBattleBuff,
      bossEmpowered: true,
    });
    for (let y = 0; y < battle.height; y++) {
      for (let x = 0; x < battle.width; x++) {
        battle.tiles[y][x].cover = null;
        battle.tiles[y][x].elevation = 0;
        battle.tiles[y][x].terrain = 'grass';
      }
    }

    const cow = battle.units.find((u) => u.visualKind === 'cow')!;
    const lemon = battle.units.find((u) => u.visualKind === 'lemon')!;
    const lettuce = battle.units.find((u) => u.visualKind === 'lettuce')!;
    const boss = battle.units.find((u) => u.isBoss)!;

    // Verify Shrine nextBattleBuff applied to heroes & Harvest Bell empowerment applied to Boss!
    expect(cow.statuses.some((s) => s.kind === 'boosted')).toBe(true);
    expect(cow.statuses.some((s) => s.kind === 'shield')).toBe(true);
    expect(cow.moveRange).toBe(cowHero.moveRange + 1);
    expect(boss.maxHp).toBeGreaterThan(22);

    // 5. Living Barricade upgrades Stitch's adjacent livingHalfCover to FULL cover!
    cow.pos = { x: 4, y: 6 };
    const badges = getAdjacentCoverBadges(battle, { x: 4, y: 7 }, 'player');
    const cowBadge = badges.find((b) => b.coverPos.x === 4 && b.coverPos.y === 6);
    expect(cowBadge?.level).toBe('full');

    // 6. Crisphead Salad Tornado capstone resets hasMoved after casting Dewy Refresh!
    lettuce.pos = { x: 2, y: 7 };
    lettuce.actions.hasMoved = true;
    expect(executeAbility(battle, lettuce.id, lettuce.pos)).toBe(true);
    expect(lettuce.actions.hasMoved).toBe(false);

    // 7. Zestia Citric Meltdown capstone splashes Acid + 3 AoE DMG to nearby enemy on kill!
    const enemies = battle.units.filter((u) => u.team === 'enemy' && !u.isBoss);
    const victim = enemies[0];
    const bystander = enemies[1] ?? boss;
    lemon.pos = { x: 5, y: 7 };
    victim.pos = { x: 5, y: 5 };
    victim.hp = 1;
    bystander.pos = { x: 6, y: 5 };
    bystander.hp = 14;
    bystander.statuses = [];
    expect(executeAttack(battle, lemon.id, victim.pos, () => 0)).toBe(true);
    expect(victim.alive).toBe(false);
    expect(bystander.hp).toBeLessThan(14);
    expect(bystander.statuses.some((s) => s.kind === 'acid')).toBe(true);
  });

  it('supports all 19 heroes (114 bespoke perks & 19 Armory weapons), new allies, new enemies, and all 3 watercolor boards', () => {
    const allHeroes = Object.values(PRODUCE_BLUEPRINTS);
    expect(allHeroes).toHaveLength(19);
    expect(ALL_SKILL_PERK_IDS).toHaveLength(114);

    for (const bp of allHeroes) {
      const tree = HERO_SKILL_TREES[bp.species];
      expect(tree).toBeDefined();
      expect(tree.pathA.perks).toHaveLength(3);
      expect(tree.pathB.perks).toHaveLength(3);
      expect(ALT_WEAPONS_BY_SPECIES[bp.species]).toBeDefined();
    }

    // New Allies: Strawbina (starter bench + unlocked alt weapon), Cap-tain Shroom (launchpadCoop), Quackers (ignoresMud + knockback)
    const run = createNewRun(defaultMetaProgress());
    const strawbina = run.roster.find((h) => h.species === 'strawberry')!;
    expect(strawbina).toBeDefined();
    expect(equipHeroWeapon(run, strawbina.uid, 'berry_scatter')).toBe(true);
    expect(strawbina.weapon.id).toBe('berry_scatter');

    const shroomHero = createHeroFromBlueprint('mushroom');
    const duckHero = createHeroFromBlueprint('duck');
    expect(shroomHero.launchpadCoop).toBe(true);
    expect(duckHero.ignoresMud).toBe(true);
    expect(duckHero.weapon.knockback).toBe(1);

    // New Enemies: Farmer Gus (starts Shielded), Barkley (Move 5 + dashKnockback 1), Beekeeper Bert (lobbed Burn)
    expect(ENEMY_BLUEPRINTS.beekeeper.weapon.appliesStatus?.kind).toBe('burn');
    expect(ENEMY_BLUEPRINTS.beekeeper.weapon.arc).toBe('lobbed');
    const gus = createBattleUnitFromEnemy('pitchfork', 0, { x: 4, y: 4 });
    expect(gus.hp).toBe(16);
    expect(gus.statuses.some((s) => s.kind === 'shield')).toBe(true);
    const barkley = createBattleUnitFromEnemy('hound', 1, { x: 2, y: 2 });
    expect(barkley.moveRange).toBe(5);
    expect(barkley.dashKnockback).toBe(1);

    // All 3 redesigned seasonal cartoon boards generate 16 pinned spaces with guaranteed facilities and path to Boss
    for (let actIdx = 0; actIdx < 3; actIdx++) {
      const nodes = generateActNodes(actIdx, createRng(777 + actIdx));
      expect(nodes).toHaveLength(16);
      expect(nodes.some((n) => n.type === 'start')).toBe(true);
      expect(nodes.some((n) => n.type === 'boss')).toBe(true);
      expect(nodes.some((n) => n.type === 'shop')).toBe(true);
      expect(nodes.some((n) => n.type === 'shrine')).toBe(true);
      expect(nodes.some((n) => n.type === 'armory')).toBe(true);
      expect(nodes.filter((n) => n.type === 'vault')).toHaveLength(2);
      expect(nodes.filter((n) => n.type === 'elite')).toHaveLength(2);
      for (const n of nodes) {
        expect(n.boardX).toBeGreaterThanOrEqual(0.05);
        expect(n.boardX).toBeLessThanOrEqual(0.95);
        expect(n.boardY).toBeGreaterThanOrEqual(0.05);
        expect(n.boardY).toBeLessThanOrEqual(0.95);
      }
    }
  });
});
