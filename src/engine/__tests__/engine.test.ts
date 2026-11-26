import { describe, expect, it } from 'vitest';
import { MAP_TEMPLATES } from '../../data/maps';
import { computeIsoMetrics, gridToScreen, screenToGrid } from '../../renderer/iso';
import {
  clearFocusOnTabAway,
  deselectAll,
  gameStore,
  handleBattleTileTap,
  handleOffBoardTap,
  selectBattleUnit,
  setInteractionMode,
  triggerUndoMove,
} from '../../stores/gameStore';
import { runEnemyUnitTurn } from '../ai';
import {
  createBattleFromMap,
  executeAbility,
  executeAttack,
  executeDash,
  executeItem,
  executeMove,
  executeTeamJump,
  startPhase,
  undoLastAction,
} from '../battle';
import {
  forecastAttack,
  getAllEnemiesThreatZone,
  getEnemyThreatZone,
  getWeaponRangeTiles,
  hasAnyPlayerActionRemaining,
  unitHasMeaningfulAction,
} from '../combat';
import { createCover, evaluateCover, posKey, tileAt } from '../grid';
import { applyStatusToUnit, getEffectiveMoveRange, getMatchup, getMatchupMultiplier } from '../hooks';
import { computeDashOptions, computeTeamJumpOptions } from '../pathfinding';
import {
  applyBattleOutcomeToRun,
  applyGraftToHero,
  claimRecruitReward,
  createNewRun,
  defaultMetaProgress,
  MAX_GRAFTS_PER_HERO,
} from '../run';

describe('Crop Revolt! Tactical Engine', () => {
  it('defines all maps with vertical mobile-first layout and zero spawn/cover overlap', () => {
    for (const map of Object.values(MAP_TEMPLATES)) {
      expect(map.height).toBeGreaterThan(map.width);
      const coverKeys = new Set(
        map.tiles.filter((t) => Boolean(t.cover)).map((t) => posKey({ x: t.x, y: t.y }))
      );
      for (const p of map.playerSpawns) {
        expect(p.y).toBeGreaterThanOrEqual(map.height - 2);
        expect(coverKeys.has(posKey(p))).toBe(false);
      }
      for (const e of map.enemySpawns) {
        expect(e.y).toBeLessThanOrEqual(Math.floor(map.height / 2));
        expect(coverKeys.has(posKey({ x: e.x, y: e.y }))).toBe(false);
      }
    }
  });

  it('evaluates Produce vs. Tool triangle advantages symmetrically', () => {
    expect(getMatchup('root', 'sprayer')).toBe('advantage');
    expect(getMatchup('vine', 'digger')).toBe('advantage');
    expect(getMatchup('fruit', 'blade')).toBe('advantage');

    expect(getMatchup('root', 'digger')).toBe('disadvantage');
    expect(getMatchup('vine', 'blade')).toBe('disadvantage');
    expect(getMatchup('fruit', 'sprayer')).toBe('disadvantage');

    expect(getMatchup('root', 'blade')).toBe('neutral');
    expect(getMatchupMultiplier('advantage', 'player', [])).toBe(1.3);
    expect(getMatchupMultiplier('advantage', 'player', ['sharp_trowel'])).toBe(1.5);
    expect(getMatchupMultiplier('disadvantage', 'player', [])).toBe(0.8);
  });

  it('resolves discrete 100% / 50% / 0% cover, flanking, lobbed shots, and cover chipping on miss', () => {
    const run = createNewRun(defaultMetaProgress());
    const battle = createBattleFromMap('vegetable_patch', run.roster, [], run.items);

    const pea = battle.units.find((u) => u.visualKind === 'pea')!;
    const lemon = battle.units.find((u) => u.visualKind === 'lemon')!;
    const enemy = battle.units.find((u) => u.team === 'enemy')!;

    for (let y = 0; y < battle.height; y++) {
      for (let x = 0; x < battle.width; x++) {
        battle.tiles[y][x].cover = null;
      }
    }
    pea.pos = { x: 3, y: 6 };
    lemon.pos = { x: 4, y: 6 };
    enemy.pos = { x: 3, y: 3 };
    battle.tiles[4][3].cover = createCover('crate');

    // Half cover between Pea (3,6) and Enemy (3,3) -> 50% hit!
    expect(evaluateCover(battle, pea.pos, enemy.pos).level).toBe('half');
    const halfFc = forecastAttack(battle, pea, enemy.pos);
    expect(halfFc.hitChance).toBe(50);
    expect(halfFc.canAttack).toBe(true);

    // Missed 50% shot chips the protecting crate!
    const crateHpBefore = battle.tiles[4][3].cover!.hp;
    executeAttack(battle, pea.id, enemy.pos, () => 0.99);
    expect(battle.tiles[4][3].cover!.hp).toBeLessThan(crateHpBefore);

    // Upgrade cover to Full Haystack -> Direct Pea is 0% BLOCKED, Lobbed Lemon is 100% HIT!
    pea.actions.hasAttacked = false;
    battle.tiles[4][3].cover = createCover('haystack');
    const blockedFc = forecastAttack(battle, pea, enemy.pos);
    expect(blockedFc.hitChance).toBe(0);
    expect(blockedFc.canAttack).toBe(false);

    const lobbedFc = forecastAttack(battle, lemon, enemy.pos);
    expect(lobbedFc.hitChance).toBe(100);
    expect(lobbedFc.canAttack).toBe(true);

    // Flanking from the side strips directional cover -> 100% HIT!
    pea.pos = { x: 1, y: 3 };
    const flankFc = forecastAttack(battle, pea, enemy.pos);
    expect(flankFc.coverLevel).toBe('none');
    expect(flankFc.hitChance).toBe(100);
  });

  it('supports flexible 3-action order, Dash mid-move, Team-Jump + Bouncy Mulch, and Undo', () => {
    const run = createNewRun(defaultMetaProgress());
    const veggieFour = run.roster.filter((h) => ['potato', 'pea', 'lemon', 'chili'].includes(h.blueprintId));
    const battle = createBattleFromMap('vegetable_patch', veggieFour, ['bouncy_mulch'], run.items);

    const chili = battle.units.find((u) => u.visualKind === 'chili')!;
    const potato = battle.units.find((u) => u.visualKind === 'potato')!;
    const enemy = battle.units.find((u) => u.team === 'enemy')!;

    for (let y = 0; y < battle.height; y++) {
      for (let x = 0; x < battle.width; x++) {
        battle.tiles[y][x].cover = null;
      }
    }

    chili.pos = { x: 3, y: 7 };
    potato.pos = { x: 3, y: 4 };
    enemy.pos = { x: 2, y: 5 };

    // 1. Use Ability FIRST (any-order actions!)
    expect(executeAbility(battle, chili.id, chili.pos)).toBe(true);
    expect(chili.actions.hasUsedSkill).toBe(true);
    expect(chili.actions.hasMoved).toBe(false);

    // 2. Dash enemy mid-move — deals Dash damage + Burn, leaves Move still open!
    const dashes = computeDashOptions(battle, chili);
    expect(dashes.some((d) => d.enemyId === enemy.id)).toBe(true);
    const enemyHpBefore = enemy.hp;
    expect(executeDash(battle, chili.id, enemy.id)).toBe(true);
    expect(enemy.hp).toBeLessThan(enemyHpBefore);
    expect(enemy.statuses.some((s) => s.kind === 'burn')).toBe(true);
    expect(chili.actions.hasDashed).toBe(true);
    expect(chili.actions.hasMoved).toBe(false);

    // 3. Team-Jump off Potato northward & gain Bouncy Mulch (+2 attack bonus!)
    const jumps = computeTeamJumpOptions(battle, chili);
    expect(jumps.size).toBeGreaterThan(0);
    const farJump = Array.from(jumps.values()).find((j) => j.dest.y <= 1)!;
    expect(farJump).toBeDefined();
    expect(executeTeamJump(battle, chili.id, farJump.dest)).toBe(true);
    expect(chili.pos).toEqual(farJump.dest);
    expect(chili.tempAttackBonus).toBe(2);

    // 4. Undo restores pre-jump position cleanly!
    const restored = undoLastAction(battle);
    expect(restored).not.toBeNull();
    expect(restored!.units.find((u) => u.id === chili.id)!.actions.hasMoved).toBe(false);
  });

  it('handles Barn Rescue cage breaking, Grafting promotions, and Reach-the-Gate victory on vertical maps', () => {
    const meta = defaultMetaProgress();
    const run = createNewRun(meta);

    const spud = run.roster[0];
    spud.harvested = true;
    run.activeSquadUids = run.roster.slice(1).map((h) => h.uid);

    const active = run.roster.filter((h) => !h.harvested);
    const battle = createBattleFromMap('barn_raid', active, [], run.items, { hero: spud });
    const cagePos = { x: 3, y: 1 };
    expect(tileAt(battle, cagePos)?.cover?.isObjectiveCage).toBe(true);

    const lemon = battle.units.find((u) => u.visualKind === 'lemon')!;
    lemon.pos = { x: 3, y: 3 };
    tileAt(battle, cagePos)!.cover!.hp = 3;

    expect(executeAttack(battle, lemon.id, cagePos, () => 0)).toBe(true);
    expect(tileAt(battle, cagePos)?.cover).toBeNull();
    expect(battle.rescuedHeroUids).toContain(spud.uid);
    expect(battle.units.some((u) => u.rosterUid === spud.uid && u.alive)).toBe(true);

    const peaHero = run.roster[1];
    expect(peaHero.tier).toBe('seedling');
    expect(applyGraftToHero(run, peaHero.uid, 'spring_sprout')).toBe(true);
    expect(peaHero.tier).toBe('ripe');
    expect(applyGraftToHero(run, peaHero.uid, 'spicy_shot')).toBe(true);
    expect(peaHero.tier).toBe('heirloom');

    // Reach-the-Gate at north edge (y = 0)
    const escapeBattle = createBattleFromMap('patch_breakout', active, [], run.items);
    const runner = escapeBattle.units.find((u) => u.team === 'player')!;
    runner.pos = { x: 3, y: 1 };
    expect(executeMove(escapeBattle, runner.id, { x: 3, y: 0 })).toBe(true);
    expect(escapeBattle.status).toBe('victory');
    expect(posKey(runner.pos)).toBe('3,0');

    run.currentNodeId = 'n1a';
    applyBattleOutcomeToRun(run, escapeBattle, meta);
    expect(run.battlesWon).toBe(1);
    expect(run.status).toBe('reward');
  });

  it('runs Enemy AI turns cleanly without errors', () => {
    const run = createNewRun(defaultMetaProgress());
    const battle = createBattleFromMap('vegetable_patch', run.roster, [], run.items);
    startPhase(battle, 'enemy');
    const enemies = battle.units.filter((u) => u.team === 'enemy' && u.alive);
    for (const e of enemies) {
      expect(runEnemyUnitTurn(battle, e.id, () => 0.1)).toBe(true);
    }
    startPhase(battle, 'player');
    expect(battle.turn).toBe(2);
    expect(battle.phase).toBe('player');
  });

  it('round-trips vertical top-down & isometric screen <-> grid coordinates cleanly under zoom & pan', () => {
    for (const viewMode of ['topdown', 'iso'] as const) {
      const m = computeIsoMetrics(390, 844, 7, 10, { panX: -36, panY: 28, zoom: 1.5 }, viewMode);
      for (const pos of [
        { x: 0, y: 0 },
        { x: 3, y: 5 },
        { x: 6, y: 9 },
      ]) {
        const pt = gridToScreen(pos.x, pos.y, m);
        const back = screenToGrid(pt.x, pt.y, m, 7, 10);
        expect(back).toEqual(pos);
      }
    }
  });

  it('runs Barnyard Animal characters with Co-op Living Wool Cover, Launchpad Jump, and Mud Runner', () => {
    const run = createNewRun(defaultMetaProgress());
    expect(run.roster.some((h) => h.blueprintId === 'pig')).toBe(true);

    expect(claimRecruitReward(run, 'rooster')).toBe(true);
    expect(claimRecruitReward(run, 'sheep')).toBe(true);
    expect(claimRecruitReward(run, 'goat')).toBe(true);

    const mixedSquad = run.roster.filter((h) =>
      ['pea', 'pig', 'rooster', 'sheep'].includes(h.blueprintId)
    );
    const battle = createBattleFromMap('vegetable_patch', mixedSquad, [], run.items);
    for (let y = 0; y < battle.height; y++) {
      for (let x = 0; x < battle.width; x++) {
        battle.tiles[y][x].cover = null;
      }
    }

    const pea = battle.units.find((u) => u.visualKind === 'pea')!;
    const boar = battle.units.find((u) => u.visualKind === 'pig')!;
    const rooster = battle.units.find((u) => u.visualKind === 'rooster')!;
    const sheep = battle.units.find((u) => u.visualKind === 'sheep')!;
    const enemy = battle.units.find((u) => u.team === 'enemy')!;

    expect(sheep.statuses.some((s) => s.kind === 'shield')).toBe(true);
    sheep.pos = { x: 3, y: 5 };
    pea.pos = { x: 3, y: 6 };
    enemy.pos = { x: 3, y: 3 };
    expect(evaluateCover(battle, enemy.pos, pea.pos, 'player').level).toBe('half');
    expect(forecastAttack(battle, enemy, pea.pos).hitChance).toBe(50);

    // Cluck Norris Launchpad Co-op northward: Pea jumpRange 4 + 2 = 6 tiles (y=7 -> y=1)
    pea.pos = { x: 1, y: 8 };
    rooster.pos = { x: 1, y: 7 };
    const jumps = computeTeamJumpOptions(battle, pea);
    const superVault = Array.from(jumps.values()).find((j) => j.dest.x === 1 && j.dest.y === 1);
    expect(superVault).toBeDefined();
    expect(executeTeamJump(battle, pea.id, superVault!.dest)).toBe(true);
    expect(pea.tempAttackBonus).toBe(2);

    // Truffle Boar Mud Runner northward
    battle.tiles[5][5].terrain = 'mud';
    battle.tiles[4][5].terrain = 'mud';
    boar.pos = { x: 5, y: 7 };
    expect(executeMove(battle, boar.id, { x: 5, y: 2 })).toBe(true);
  });

  it('computes simultaneous ally weapon ranges, enemy threat zones, and smart auto turn-end readiness', () => {
    const run = createNewRun(defaultMetaProgress());
    const battle = createBattleFromMap('vegetable_patch', run.roster.slice(0, 2), [], run.items);
    for (let y = 0; y < battle.height; y++) {
      for (let x = 0; x < battle.width; x++) {
        battle.tiles[y][x].cover = null;
      }
    }

    const spud = battle.units.find((u) => u.visualKind === 'potato')!;
    const pea = battle.units.find((u) => u.visualKind === 'pea')!;
    const enemy = battle.units.find((u) => u.team === 'enemy')!;

    spud.pos = { x: 2, y: 7 };
    const currentRange = new Set(getWeaponRangeTiles(battle, spud).map(posKey));
    expect(currentRange.has('2,6')).toBe(true);
    expect(currentRange.has('2,2')).toBe(false);

    const projectedRange = new Set(getWeaponRangeTiles(battle, spud, { x: 2, y: 3 }).map(posKey));
    expect(projectedRange.has('2,2')).toBe(true);

    enemy.pos = { x: 3, y: 1 };
    const threat = getEnemyThreatZone(battle, enemy);
    expect(threat.moveKeys.size).toBeGreaterThan(0);
    expect(threat.attackKeys.size).toBeGreaterThan(threat.moveKeys.size);
    expect(threat.attackKeys.has(posKey({ x: 3, y: 1 + enemy.moveRange + enemy.weapon.maxRange }))).toBe(true);

    // Combined global danger zone covers at least every tile of any single enemy's danger zone
    const allThreat = getAllEnemiesThreatZone(battle);
    expect(allThreat.attackKeys.size).toBeGreaterThanOrEqual(threat.attackKeys.size);
    expect(allThreat.moveKeys.size).toBeGreaterThanOrEqual(threat.moveKeys.size);

    expect(hasAnyPlayerActionRemaining(battle)).toBe(true);

    spud.pos = { x: 0, y: 8 };
    pea.pos = { x: 1, y: 8 };
    enemy.pos = { x: 6, y: 0 };
    for (const u of [spud, pea]) {
      u.actions.hasMoved = true;
      u.actions.hasUsedSkill = true;
      u.actions.hasAttacked = false;
    }
    expect(unitHasMeaningfulAction(battle, spud)).toBe(false);
    expect(unitHasMeaningfulAction(battle, pea)).toBe(false);
    expect(hasAnyPlayerActionRemaining(battle)).toBe(false);

    enemy.pos = { x: 1, y: 4 };
    expect(unitHasMeaningfulAction(battle, pea)).toBe(true);
    expect(hasAnyPlayerActionRemaining(battle)).toBe(true);

    pea.actions.hasAttacked = true;
    pea.actions.hasUsedSkill = false;
    pea.abilityCooldown = 0;
    expect(unitHasMeaningfulAction(battle, pea)).toBe(true);
  });

  it('supports unit unclick, enemy toggle-off, tab-blur focus clear, and never auto-uses skills', () => {
    const run = createNewRun(defaultMetaProgress());
    const battle = createBattleFromMap('vegetable_patch', run.roster.slice(0, 2), [], run.items);
    for (let y = 0; y < battle.height; y++) {
      for (let x = 0; x < battle.width; x++) {
        battle.tiles[y][x].cover = null;
      }
    }

    const spud = battle.units.find((u) => u.visualKind === 'potato')!;
    const enemy = battle.units.find((u) => u.team === 'enemy')!;
    spud.pos = { x: 1, y: 8 };
    enemy.pos = { x: 5, y: 0 };

    gameStore.run = run;
    gameStore.battle = battle;
    gameStore.enemyTurnRunning = false;
    gameStore.selectedUnitId = spud.id;
    gameStore.mode = 'move';
    gameStore.inspectedEnemyId = null;
    gameStore.previewTile = null;

    // 1. Clicking selected hero again UNCLICKS / deselects them cleanly!
    handleBattleTileTap(spud.pos, 'mouse');
    expect(gameStore.selectedUnitId).toBeNull();

    // 2. Clicking hero selects, clicking medallion again also deselects!
    selectBattleUnit(spud.id, false);
    expect(gameStore.selectedUnitId).toBe(spud.id);
    selectBattleUnit(spud.id, false);
    expect(gameStore.selectedUnitId).toBeNull();

    // 3. Clicking an enemy inspects them; clicking the SAME enemy again toggles visually OFF!
    handleBattleTileTap(enemy.pos, 'mouse');
    expect(gameStore.inspectedEnemyId).toBe(enemy.id);
    handleBattleTileTap(enemy.pos, 'mouse');
    expect(gameStore.inspectedEnemyId).toBeNull();

    // Same toggle-off when a hero IS selected and enemy is out of range!
    selectBattleUnit(spud.id, false);
    handleBattleTileTap(enemy.pos, 'mouse');
    expect(gameStore.inspectedEnemyId).toBe(enemy.id);
    handleBattleTileTap(enemy.pos, 'mouse');
    expect(gameStore.inspectedEnemyId).toBeNull();

    // 4. Tapping off-board clears all selection & inspection
    handleOffBoardTap();
    expect(gameStore.selectedUnitId).toBeNull();
    expect(gameStore.inspectedEnemyId).toBeNull();

    // 5. Moving when NO enemies are in attack range NEVER auto-uses or auto-switches to Skill!
    selectBattleUnit(spud.id, false);
    handleBattleTileTap({ x: 1, y: 7 }, 'mouse');
    expect(spud.actions.hasMoved).toBe(true);
    expect(spud.actions.hasUsedSkill).toBe(false);
    expect(gameStore.mode).toBe('move');

    // 6. Explicitly clicking Skill for a self-ability previews it WITHOUT auto-casting!
    setInteractionMode('ability');
    expect(gameStore.mode).toBe('ability');
    expect(spud.actions.hasUsedSkill).toBe(false);
    expect(gameStore.previewTile).toEqual(spud.pos);

    // 7. Tabbing away clears ALL active focus cleanly!
    gameStore.inspectedEnemyId = enemy.id;
    gameStore.hoveredTile = { x: 2, y: 2 };
    clearFocusOnTabAway();
    expect(gameStore.selectedUnitId).toBeNull();
    expect(gameStore.inspectedEnemyId).toBeNull();
    expect(gameStore.hoveredTile).toBeNull();
    expect(gameStore.previewTile).toBeNull();
    expect(gameStore.mode).toBe('move');

    deselectAll();
  });

  it('keeps 1-turn Rooted/Feared active through the target turn and prevents Barn Rescue victory bypass', () => {
    const run = createNewRun(defaultMetaProgress());
    const battle = createBattleFromMap('barn_raid', run.roster.slice(0, 4), [], run.items, {
      blueprintId: 'rooster',
    });

    const pea = battle.units.find((u) => u.visualKind === 'pea')!;
    const enemy = battle.units.find((u) => u.team === 'enemy')!;
    pea.pos = { x: 2, y: 5 };
    enemy.pos = { x: 2, y: 3 };

    // 1. 1-turn Rooted applied on Player Turn stays active throughout Enemy Turn, then expires!
    expect(executeAbility(battle, pea.id, enemy.pos)).toBe(true);
    expect(enemy.statuses.some((s) => s.kind === 'rooted' && s.turns === 1)).toBe(true);
    startPhase(battle, 'enemy');
    expect(getEffectiveMoveRange(enemy)).toBe(0);
    // Apply 1-turn Feared to player on Enemy Turn -> stays active on Player Turn 2!
    applyStatusToUnit(pea, 'feared', 1);
    startPhase(battle, 'player');
    expect(enemy.statuses.some((s) => s.kind === 'rooted')).toBe(false);
    expect(getEffectiveMoveRange(pea)).toBe(Math.max(1, pea.moveRange - 2));

    // 2. Killing all enemies on barn_raid MUST NOT trigger victory while the Burlap Cage still stands!
    for (const e of battle.units) {
      if (e.team === 'enemy') {
        e.hp = 0;
        e.alive = false;
      }
    }
    const lemon = battle.units.find((u) => u.visualKind === 'lemon')!;
    lemon.pos = { x: 3, y: 3 };
    tileAt(battle, { x: 3, y: 1 })!.cover!.hp = 2;
    // Move Lemon on open barn floor: status MUST stay ongoing while the Burlap Cage still stands!
    expect(executeMove(battle, lemon.id, { x: 3, y: 2 })).toBe(true);
    expect(battle.status).toBe('ongoing');
    // unitHasMeaningfulAction still sees the objective cage in range (Citrus Mortar minRange=2 from (3,3) or via moving back)
    lemon.pos = { x: 3, y: 3 };
    lemon.actions.hasMoved = true;
    lemon.actions.hasUsedSkill = true;
    expect(unitHasMeaningfulAction(battle, lemon)).toBe(true);

    // 3. Smashing the cage frees Cluck Norris WITH his Barnyard Co-op traits preserved and wins!
    expect(executeAttack(battle, lemon.id, { x: 3, y: 1 }, () => 0)).toBe(true);
    const freedRooster = battle.units.find((u) => u.visualKind === 'rooster');
    expect(freedRooster).toBeDefined();
    expect(freedRooster!.isAnimal).toBe(true);
    expect(freedRooster!.launchpadCoop).toBe(true);
    expect(battle.status).toBe('victory');
  });

  it('caps Grafts at 2, validates ability/item targets before spending, prefers Dash on touch move double-tap, and restores Undo focus', () => {
    const run = createNewRun(defaultMetaProgress());
    const hero = run.roster[0];
    expect(applyGraftToHero(run, hero.uid, 'spring_sprout')).toBe(true);
    expect(applyGraftToHero(run, hero.uid, 'spicy_shot')).toBe(true);
    expect(hero.graftIds.length).toBe(MAX_GRAFTS_PER_HERO);
    expect(applyGraftToHero(run, hero.uid, 'pumpkin_rind')).toBe(false);

    const battle = createBattleFromMap('vegetable_patch', run.roster.slice(0, 2), [], run.items);
    for (let y = 0; y < battle.height; y++) {
      for (let x = 0; x < battle.width; x++) {
        battle.tiles[y][x].cover = null;
      }
    }
    const spud = battle.units.find((u) => u.visualKind === 'potato')!;
    const pea = battle.units.find((u) => u.visualKind === 'pea')!;
    const enemy = battle.units.find((u) => u.team === 'enemy')!;
    spud.pos = { x: 3, y: 6 };
    pea.pos = { x: 5, y: 7 };
    enemy.pos = { x: 3, y: 4 };

    // Invalid enemy/ally targets must NOT consume Skill slot or Bag items!
    expect(executeAbility(battle, pea.id, { x: 0, y: 0 })).toBe(false);
    expect(pea.actions.hasUsedSkill).toBe(false);
    const cansBefore = battle.items.watering_can;
    expect(executeItem(battle, pea.id, 'watering_can', { x: 5, y: 5 })).toBe(false);
    expect(battle.items.watering_can).toBe(cansBefore);
    expect(pea.actions.hasUsedSkill).toBe(false);

    // unitHasMeaningfulAction still sees usable Bag items when skill is on cooldown!
    spud.actions.hasMoved = true;
    spud.actions.hasAttacked = true;
    spud.actions.hasUsedSkill = false;
    spud.abilityCooldown = 2;
    expect(unitHasMeaningfulAction(battle, spud)).toBe(true);

    // Touch double-tap on enemy in 'move' mode when BOTH Dash & Attack are available executes Dash!
    spud.actions.hasMoved = false;
    spud.actions.hasAttacked = false;
    spud.actions.hasDashed = false;
    gameStore.run = run;
    gameStore.battle = battle;
    gameStore.enemyTurnRunning = false;
    gameStore.selectedUnitId = spud.id;
    gameStore.mode = 'move';
    gameStore.previewTile = null;
    handleBattleTileTap(enemy.pos, 'touch'); // Tap 1 previews
    expect(gameStore.previewTile).toEqual(enemy.pos);
    handleBattleTileTap(enemy.pos, 'touch'); // Tap 2 prefers Dash in 'move' mode!
    expect(spud.actions.hasDashed).toBe(true);
    expect(spud.actions.hasAttacked).toBe(false);

    // Undo restores focus back to the undone hero even after auto-advance!
    spud.actions.hasAttacked = true;
    spud.actions.hasUsedSkill = true;
    handleBattleTileTap({ x: 3, y: 6 }, 'mouse'); // Move Spudnik (auto-advances to Pea)
    expect(gameStore.selectedUnitId).toBe(pea.id);
    triggerUndoMove();
    expect(gameStore.selectedUnitId).toBe(spud.id);
  });
});
