import { describe, expect, it } from 'vitest';
import { ENEMY_BLUEPRINTS } from '../../data/enemies';
import { MAP_TEMPLATES } from '../../data/maps';
import {
  HERO_UNLOCK_CATALOG,
  PRODUCE_BLUEPRINTS,
  RECRUITABLE_BLUEPRINT_IDS,
  STARTER_BLUEPRINT_IDS,
} from '../../data/produce';
import {
  ALL_SKILL_PERK_IDS,
  getHeroPerkDefs,
  getHeroSkillTree,
  MAX_HERO_LEVEL,
} from '../../data/skills';
import {
  createBattleFromMap,
  createBattleFromTemplate,
  executeAttack,
  executeTeamJump,
  getObjectiveProgressText,
  startPhase,
} from '../battle';
import { forecastAttack } from '../combat';
import { computeTeamJumpOptions } from '../pathfinding';
import {
  endlessDifficultyFor,
  generateEndlessFloorMap,
  rollEndlessFloorOptions,
} from '../proceduralMap';
import {
  applyBattleOutcomeToRun,
  assignCoopHeroOwners,
  createCoopPlayers,
  createEndlessRun,
  createHeroFromBlueprint,
  createNewRun,
  defaultMetaProgress,
  finishRewardsAndReturnToMap,
  leaveEndlessBonusRoom,
  openEndlessBonusRoom,
  purchaseHeroUnlock,
  respecHeroPerks,
  resolveEndlessBonusChoice,
  setGuidedHintsEnabled,
  setHeroCoopOwner,
  unlockHeroPerk,
  unlockHeroPermanently,
} from '../run';

describe('Mario + Rabbids Goal Pillars: Co-Op, Endless, 3-Branch Trees, Unlocks, Variety & Zero Animal Enemies', () => {
  it('enforces slimmed 5-hero iconic starter roster + 14 unlockable Greenhouse heroes', () => {
    expect(STARTER_BLUEPRINT_IDS).toEqual(['cow', 'pea', 'lemon', 'rooster', 'carrot']);
    expect(RECRUITABLE_BLUEPRINT_IDS).toHaveLength(14);
    expect(HERO_UNLOCK_CATALOG).toHaveLength(14);
    expect(Object.keys(PRODUCE_BLUEPRINTS)).toHaveLength(19);

    const meta = defaultMetaProgress();
    expect(meta.unlockedHeroIds).toEqual(STARTER_BLUEPRINT_IDS);
    expect(meta.guidedHintsEnabled).toBe(true);

    const run = createNewRun(meta);
    expect(run.roster).toHaveLength(5);
    expect(run.activeSquadUids).toHaveLength(4);
    const activeBps = run.activeSquadUids.map((uid) => run.roster.find((h) => h.uid === uid)?.blueprintId);
    expect(activeBps).toEqual(['cow', 'pea', 'lemon', 'rooster']);

    // Purchase unlock from Greenhouse with Heirloom Seeds
    meta.heirloomSeeds = 50;
    const owlEntry = HERO_UNLOCK_CATALOG.find((e) => e.id === 'owl')!;
    expect(owlEntry).toBeDefined();
    expect(purchaseHeroUnlock(meta, 'owl')).toBe(true);
    expect(meta.unlockedHeroIds).toContain('owl');
    expect(meta.heirloomSeeds).toBe(50 - owlEntry.cost);
    expect(purchaseHeroUnlock(meta, 'owl')).toBe(false); // Cannot double-buy

    // Permanent rescue unlock & Guided Tips toggle
    expect(unlockHeroPermanently(meta, 'duck')).toBe(true);
    expect(meta.unlockedHeroIds).toContain('duck');
    expect(unlockHeroPermanently(meta, 'duck')).toBe(false);
    setGuidedHintsEnabled(meta, false);
    expect(meta.guidedHintsEnabled).toBe(false);
  });

  it('provides 171 bespoke perks (19 heroes × 3 branches × 3 tiers) up to MAX_HERO_LEVEL 8 with full unlock + respec', () => {
    expect(MAX_HERO_LEVEL).toBe(8);
    expect(ALL_SKILL_PERK_IDS).toHaveLength(171);

    const meta = defaultMetaProgress();
    const run = createNewRun(meta);
    const pea = run.roster.find((h) => h.blueprintId === 'pea')!;
    const tree = getHeroSkillTree('pea');
    expect(tree.pathA.perks).toHaveLength(3);
    expect(tree.pathB.perks).toHaveLength(3);
    expect(tree.pathC.perks).toHaveLength(3);
    expect(getHeroPerkDefs('pea')).toHaveLength(9);

    // Unlock all 3 tiers of the brand-new 3rd branch (pathC) and respec cleanly
    pea.skillPoints = 4;
    const [t1, t2, t3] = tree.pathC.perks;
    expect(unlockHeroPerk(run, pea.uid, t2.id)).toBe(false); // Prerequisite enforced
    expect(unlockHeroPerk(run, pea.uid, t1.id)).toBe(true);
    expect(unlockHeroPerk(run, pea.uid, t2.id)).toBe(true);
    expect(unlockHeroPerk(run, pea.uid, t3.id)).toBe(true);
    expect(pea.perkIds).toEqual([t1.id, t2.id, t3.id]);

    expect(respecHeroPerks(run, pea.uid)).toBe(true);
    expect(pea.perkIds).toEqual([]);
    expect(pea.skillPoints).toBe(4);
  });

  it('supports Local Co-Op (2P–4P) hero ownership, reassignment, and Cross-Player Co-Op Combos on Team-Jump & Assist', () => {
    const meta = defaultMetaProgress();
    const run = createNewRun(meta, 'spring', 777, 0, 3);
    expect(run.coopPlayers).toHaveLength(3);
    expect(run.coopPlayers!.map((p) => p.badge)).toEqual(['P1', 'P2', 'P3']);

    // Assigns every active hero to a valid player index
    assignCoopHeroOwners(run);
    expect(Object.keys(run.heroOwnerByUid ?? {}).length).toBeGreaterThanOrEqual(4);
    expect(setHeroCoopOwner(run, run.activeSquadUids[0], 2)).toBe(true);
    expect(run.heroOwnerByUid?.[run.activeSquadUids[0]]).toBe(2);

    // Create 2P Co-Op battle and verify Cross-Player Co-Op Team-Jump (+1 tempAttackBonus) & Partner Assist (+1 DMG)
    const players2 = createCoopPlayers(2);
    const cowHero = createHeroFromBlueprint('cow');
    const peaHero = createHeroFromBlueprint('pea');
    const battle = createBattleFromMap('vegetable_patch', [cowHero, peaHero], [], {}, undefined, {
      coopPlayers: players2,
      heroOwnerByUid: { [cowHero.uid]: 0, [peaHero.uid]: 1 },
    });
    for (let y = 0; y < battle.height; y++) {
      for (let x = 0; x < battle.width; x++) {
        battle.tiles[y][x].cover = null;
        battle.tiles[y][x].elevation = 0;
        battle.tiles[y][x].terrain = 'grass';
      }
    }

    const cow = battle.units.find((u) => u.blueprintId === 'cow')!;
    const pea = battle.units.find((u) => u.blueprintId === 'pea')!;
    const enemies = battle.units.filter((u) => u.team === 'enemy');
    const foe = enemies[0];
    enemies.slice(1).forEach((e, idx) => {
      e.pos = { x: idx, y: 0 };
    });
    expect(cow.ownerPlayerIdx).toBe(0);
    expect(pea.ownerPlayerIdx).toBe(1);

    // Cross-player Team-Jump: P2's Pea jumps off P1's Cow -> +1 tempAttackBonus & coopComboCount++!
    pea.pos = { x: 3, y: 7 };
    cow.pos = { x: 3, y: 6 };
    foe.pos = { x: 3, y: 1 };
    const jumpOpts = Array.from(computeTeamJumpOptions(battle, pea).values());
    const farJump = jumpOpts.find((j) => j.dest.y <= 3) ?? jumpOpts[0];
    expect(farJump).toBeDefined();
    expect(executeTeamJump(battle, pea.id, farJump.dest)).toBe(true);
    expect(pea.tempAttackBonus).toBeGreaterThanOrEqual(1);
    expect(battle.coopComboCount).toBe(1);

    // Cross-player Partner Assist: P1's Cow stands adjacent to foe while P2's Pea shoots!
    pea.pos = { x: 3, y: 4 };
    cow.pos = { x: 4, y: 1 };
    foe.hp = 20;
    foe.maxHp = 20;
    const fc = forecastAttack(battle, pea, foe.pos);
    expect(fc.partnerAssistUnitId).toBe(cow.id);
    expect(fc.partnerAssistDamage).toBeGreaterThanOrEqual(2); // Base 1 + 1 Co-Op cross-player bonus!
    expect(executeAttack(battle, pea.id, foe.pos, () => 0)).toBe(true);
    expect(battle.coopComboCount).toBe(2);

    // New player phase resets activeCoopPlayerIdx cleanly
    startPhase(battle, 'player');
    expect(battle.activeCoopPlayerIdx).toBe(0);
  });

  it('supports Elevation 0-3 Summit High Ground (+3 DMG) and smash_crates Supply Sabotage maps', () => {
    const tower = MAP_TEMPLATES.cliff_watchtower;
    expect(tower.width).toBe(7);
    expect(tower.height).toBe(11);
    expect(Math.max(...tower.tiles.map((t) => t.elevation ?? 0))).toBe(3);

    const causeway = MAP_TEMPLATES.windmill_causeway;
    expect(causeway.width).toBe(11);
    expect(causeway.height).toBe(8);
    expect(causeway.objective).toBe('smash_crates');
    expect(causeway.objectiveCratePositions).toHaveLength(3);

    const squad = [
      createHeroFromBlueprint('cow'),
      createHeroFromBlueprint('pea'),
      createHeroFromBlueprint('lemon'),
      createHeroFromBlueprint('rooster'),
    ];
    // Test +3 Summit High Ground (elevationDiff >= 2)
    const towerBattle = createBattleFromMap('cliff_watchtower', squad, [], {});
    const pea = towerBattle.units.find((u) => u.blueprintId === 'pea')!;
    const foe = towerBattle.units.find((u) => u.team === 'enemy')!;
    towerBattle.tiles[1][3].elevation = 3;
    towerBattle.tiles[3][3].elevation = 0;
    towerBattle.tiles[2][3].cover = null;
    pea.pos = { x: 3, y: 1 };
    foe.pos = { x: 3, y: 3 };
    const summitFc = forecastAttack(towerBattle, pea, foe.pos);
    expect(summitFc.highGroundBonus).toBe(3);

    // Test smash_crates objective progress & victory on smashing all 3 Supply Crates
    const crateBattle = createBattleFromMap('windmill_causeway', squad, [], {});
    expect(getObjectiveProgressText(crateBattle)).toContain('3 Supply Crates');
    const lemon = crateBattle.units.find((u) => u.blueprintId === 'lemon')!;
    const cratePositions = causeway.objectiveCratePositions!;
    for (let i = 0; i < cratePositions.length; i++) {
      const pos = cratePositions[i];
      const tile = crateBattle.tiles[pos.y][pos.x];
      expect(tile.cover?.isObjectiveCrate).toBe(true);
      tile.cover!.hp = 1;
      lemon.pos = { x: pos.x, y: pos.y + 2 };
      lemon.actions.hasAttacked = false;
      expect(executeAttack(crateBattle, lemon.id, pos, () => 0)).toBe(true);
      expect(tile.cover).toBeNull();
    }
    expect(crateBattle.status).toBe('victory');
  });

  it('drives Endless Harvest runs with varied grid sizes, Elevation 3, Boss Floors (4/8), Bonus Rooms, and bestEndlessFloor', () => {
    const meta = defaultMetaProgress();
    const run = createEndlessRun(meta, 2, 2026);
    expect(run.mode).toBe('endless');
    expect(run.status).toBe('endless_hub');
    expect(run.endless?.floor).toBe(1);
    expect(run.endless!.nextOptions.length).toBeGreaterThanOrEqual(2);
    expect(run.coopPlayers).toHaveLength(2);

    // Scaling difficulty rises strictly across floors 1 -> 4 -> 8 -> 12
    const d1 = endlessDifficultyFor(1);
    const d4 = endlessDifficultyFor(4);
    const d8 = endlessDifficultyFor(8);
    expect(d4.hpMult).toBeGreaterThan(d1.hpMult);
    expect(d8.hpMult).toBeGreaterThan(d4.hpMult);

    // Procedural floor generator yields varied grid sizes, Boss on Floor 4, Double-Boss on Floor 8!
    const sizes = new Set<string>();
    for (let floor = 1; floor <= 8; floor++) {
      const opts = rollEndlessFloorOptions(floor, 2026);
      if (floor % 4 === 0) {
        expect(opts.some((o) => o.kind === 'boss')).toBe(true);
      }
      const battleOpt = opts.find((o) => o.kind === 'battle' || o.kind === 'boss')!;
      const tpl = generateEndlessFloorMap(floor, battleOpt);
      sizes.add(`${tpl.width}x${tpl.height}`);
      const battle = createBattleFromTemplate(tpl, run.roster.slice(0, 4), [], run.items);
      expect(battle.units.filter((u) => u.team === 'player')).toHaveLength(4);
      const bosses = battle.units.filter((u) => u.team === 'enemy' && u.isBoss);
      if (floor === 4) expect(bosses.length).toBeGreaterThanOrEqual(1);
      if (floor === 8) expect(bosses.length).toBeGreaterThanOrEqual(2);
    }
    expect(sizes.size).toBeGreaterThanOrEqual(3);

    // Interactive Bonus Rooms (Carnival, Tinkerer, Hot Spring)
    const bonusCases: Array<{ kind: 'carnival' | 'tinkerer' | 'hotspring'; choice: 'wheel' | 'weapon' | 'soak' }> = [
      { kind: 'carnival', choice: 'wheel' },
      { kind: 'tinkerer', choice: 'weapon' },
      { kind: 'hotspring', choice: 'soak' },
    ];
    for (const { kind, choice } of bonusCases) {
      expect(
        openEndlessBonusRoom(run, {
          id: `test_${kind}`,
          kind: 'bonus',
          bonusKind: kind,
          title: `Test ${kind}`,
          subtitle: 'Bonus test',
          icon: '🎪',
          theme: 'spring',
          seed: 123,
        })
      ).toBe(true);
      expect(run.status).toBe('bonus_room');
      const outcome = resolveEndlessBonusChoice(run, meta, choice);
      expect(outcome).toBeTruthy();
      leaveEndlessBonusRoom(run);
      expect(run.status).toBe('endless_hub');
    }

    // Winning an Endless battle advances floor, updates bestEndlessFloor, and routes back to endless_hub
    const floorBefore = run.endless!.floor;
    const fOpt = run.endless!.nextOptions.find((o) => o.kind !== 'bonus')!;
    const fTpl = generateEndlessFloorMap(floorBefore, fOpt);
    const battle = createBattleFromTemplate(fTpl, run.roster.slice(0, 4), [], run.items);
    battle.status = 'victory';
    applyBattleOutcomeToRun(run, battle, meta);
    expect(meta.bestEndlessFloor).toBeGreaterThanOrEqual(floorBefore);
    finishRewardsAndReturnToMap(run);
    expect(run.status).toBe('endless_hub');
    expect(run.endless!.floor).toBe(floorBefore + 1);
  });

  it('guarantees ZERO animal enemies anywhere in ENEMY_BLUEPRINTS or Endless procedural spawns', () => {
    const forbiddenAnimalWords = ['hound', 'dog', 'goose', 'mole', 'wolf', 'bear', 'fox', 'rat', 'boar', 'pig', 'owl', 'duck', 'crow'];
    for (const [id, bp] of Object.entries(ENEMY_BLUEPRINTS)) {
      const hay = `${id} ${bp.name} ${bp.title} ${bp.blurb}`.toLowerCase();
      for (const word of forbiddenAnimalWords) {
        expect(hay).not.toMatch(new RegExp(`\\b${word}\\b`));
      }
    }
    // Check contraption enemy names exist
    expect(ENEMY_BLUEPRINTS.barrow.name).toBe('Chug-Barrow');
    expect(ENEMY_BLUEPRINTS.blower.name).toBe('Gale-O-Matic');
    expect(ENEMY_BLUEPRINTS.sapper.name).toBe('Bore-Bot 3000');
  });
});
