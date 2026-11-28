import { describe, expect, it } from 'vitest';
import { ENEMY_BLUEPRINTS } from '../../data/enemies';
import {
  FACTION_DOSSIERS,
  HERO_LORE_QUOTES,
  SEASON_ACT_INTROS,
  SEASON_WEATHER_INFO,
  WORLD_LORE_CHRONICLES,
} from '../../data/lore';
import { MAP_TEMPLATES } from '../../data/maps';
import { PRODUCE_BLUEPRINTS } from '../../data/produce';
import { ALL_SKILL_PERK_IDS, getHeroSkillTree, MAX_HERO_LEVEL } from '../../data/skills';
import {
  DUAL_WEAPON_KITS,
  ensureHeroDualWeapons,
  getWeaponForgeOptions,
} from '../../data/weapons';
import {
  createBattleFromMap,
  executeAttack,
  executeDash,
  finishPrepPhase,
  startPhase,
  switchActiveWeapon,
} from '../battle';
import { forecastAttack } from '../combat';
import { ACTS, actRng, generateActNodes } from '../mapgen';
import {
  claimLoreReward,
  createEndlessRun,
  createHeroFromBlueprint,
  createNewRun,
  defaultMetaProgress,
  forgeHeroWeapon,
  leaveForgeNode,
  openForgeNode,
  openLoreNode,
  resolveEndlessBonusChoice,
  unlockHeroPerk,
} from '../run';

describe('World Expansion v2: Dual Weapons, Branching Forge, Winter Act 4, Ice/Frost, Lore & 4-Tier Trees', () => {
  it('equips every one of the 19 playable heroes with a Primary Ranged AND Secondary Melee/Gimmick weapon with visualKind', () => {
    const heroes = Object.values(PRODUCE_BLUEPRINTS);
    expect(heroes).toHaveLength(19);
    for (const bp of heroes) {
      const kit = DUAL_WEAPON_KITS[bp.species];
      expect(kit).toBeDefined();
      expect(kit.primary.slot).toBe('primary');
      expect(kit.secondary.slot).toBe('secondary');
      expect(kit.primary.visualKind).toBeTruthy();
      expect(kit.secondary.visualKind).toBeTruthy();
      expect(kit.secondary.gimmick).toBeTruthy();
      expect(kit.primary.maxRange).toBeGreaterThanOrEqual(3);
      expect(HERO_LORE_QUOTES[bp.species]).toBeTruthy();

      const hero = createHeroFromBlueprint(bp.id);
      ensureHeroDualWeapons(hero);
      expect(hero.primaryWeapon?.id).toBe(kit.primary.id);
      expect(hero.secondaryWeapon?.id).toBe(kit.secondary.id);
    }
  });

  it('switches freely between Primary Ranged and Secondary Melee/Gimmick mid-battle without spending actions', () => {
    const pea = createHeroFromBlueprint('pea');
    const battle = createBattleFromMap('vegetable_patch', [pea], [], {});
    finishPrepPhase(battle);
    const peaUnit = battle.units.find((u) => u.visualKind === 'pea')!;

    expect(peaUnit.activeWeaponSlot).toBe('primary');
    expect(peaUnit.weapon.id).toBe(DUAL_WEAPON_KITS.pea.primary.id);

    battle.pendingEvents = [];
    expect(switchActiveWeapon(battle, peaUnit.id, 'secondary')).toBe(true);
    expect(peaUnit.activeWeaponSlot).toBe('secondary');
    expect(peaUnit.weapon.id).toBe(DUAL_WEAPON_KITS.pea.secondary.id);
    expect(peaUnit.weapon.gimmick).toBe('vacuum_pull');
    expect(peaUnit.actions.hasAttacked).toBe(false);
    expect(peaUnit.actions.hasMoved).toBe(false);
    expect(battle.pendingEvents.some((e) => e.type === 'weapon_swap' && e.slot === 'secondary')).toBe(true);

    // Toggle back to primary
    expect(switchActiveWeapon(battle, peaUnit.id)).toBe(true);
    expect(peaUnit.activeWeaponSlot).toBe('primary');
  });

  it('executes Vacuum Duster Pull, Glaze Ice +1 extra slide, Hammer Cleave sweep, and Boomerang cover-curve', () => {
    const pea = createHeroFromBlueprint('pea');
    const cow = createHeroFromBlueprint('cow');
    const lettuce = createHeroFromBlueprint('lettuce');
    const battle = createBattleFromMap('frost_brook_ridge', [pea, cow, lettuce], [], {});
    expect(battle.seasonId).toBe('winter');
    finishPrepPhase(battle);

    // Clear central arena for deterministic positioning
    for (let y = 0; y < battle.height; y++) {
      for (let x = 0; x < battle.width; x++) {
        battle.tiles[y][x].cover = null;
        battle.tiles[y][x].elevation = 0;
        battle.tiles[y][x].terrain = 'grass';
      }
    }

    const peaUnit = battle.units.find((u) => u.visualKind === 'pea')!;
    const cowUnit = battle.units.find((u) => u.visualKind === 'cow')!;
    const letUnit = battle.units.find((u) => u.visualKind === 'lettuce')!;
    const enemies = battle.units.filter((u) => u.team === 'enemy');
    const foeA = enemies[0];
    const foeB = enemies[1];
    foeA.hp = 30;
    foeA.maxHp = 30;
    foeB.hp = 30;
    foeB.maxHp = 30;

    // 1. Snap-Pea Vacuum Duster Pull + Glaze Ice Slide!
    switchActiveWeapon(battle, peaUnit.id, 'secondary');
    peaUnit.pos = { x: 4, y: 6 };
    foeA.pos = { x: 4, y: 2 };
    battle.tiles[3][4].terrain = 'ice'; // foeA pulled onto (4,3) ice -> slides extra tile to (4,4)!
    battle.tiles[4][4].terrain = 'grass';

    const pullFc = forecastAttack(battle, peaUnit, foeA.pos);
    expect(pullFc.canAttack).toBe(true);
    expect(pullFc.pullDir).toEqual({ x: 0, y: 1 });

    battle.pendingEvents = [];
    expect(executeAttack(battle, peaUnit.id, foeA.pos, () => 0)).toBe(true);
    expect(foeA.pos.y).toBeGreaterThanOrEqual(4); // pulled + slid across ice!
    expect(battle.pendingEvents.some((e) => e.type === 'pull' && e.slidIce === true)).toBe(true);

    // 2. Stitch Hammer Cleave hits foeA AND adjacent foeB!
    cowUnit.pos = { x: 4, y: 5 };
    foeA.pos = { x: 4, y: 4 };
    foeB.pos = { x: 5, y: 4 }; // adjacent to foeA & within cleave reach
    const foeBHpBefore = foeB.hp;
    const cleaveFc = forecastAttack(battle, cowUnit, foeA.pos);
    expect(cleaveFc.cleaveUnitIds).toContain(foeB.id);
    expect(executeAttack(battle, cowUnit.id, foeA.pos, () => 0)).toBe(true);
    expect(foeB.hp).toBeLessThan(foeBHpBefore);

    // 3. Crisphead Boomerang curves past Half Cover for 100% accuracy!
    switchActiveWeapon(battle, letUnit.id, 'secondary');
    letUnit.pos = { x: 2, y: 6 };
    foeB.pos = { x: 2, y: 3 };
    battle.tiles[4][2].cover = { kind: 'crate', level: 'half', hp: 5, maxHp: 5, destructible: true };
    const boomFc = forecastAttack(battle, letUnit, foeB.pos);
    expect(boomFc.hitChance).toBe(100);
  });

  it('supports Branching Weapon Forge (Tier 1 -> Tactical II vs Elemental II -> Masterwork III) and Free Forge Vouchers', () => {
    const meta = defaultMetaProgress();
    const run = createNewRun(meta, 'spring', 77);
    const pea = run.roster.find((h) => h.species === 'pea')!;
    ensureHeroDualWeapons(pea);

    const opts1 = getWeaponForgeOptions(pea.primaryWeapon!, 'pea', pea.weaponForge?.primary);
    expect(opts1).toHaveLength(2);
    expect(opts1.map((o) => o.branch)).toEqual(['tactical', 'elemental']);

    // Use a Free Forge Voucher to forge Primary -> Tactical Tier 2 for 0 Seeds!
    run.forgeVouchers = 1;
    const seedsBefore = run.seeds;
    expect(forgeHeroWeapon(run, pea.uid, 'primary', 'tactical', true)).toBe(true);
    expect(run.forgeVouchers).toBe(0);
    expect(run.seeds).toBe(seedsBefore);
    expect(pea.weaponForge?.primary).toEqual({ tier: 2, branch: 'tactical' });
    expect(pea.primaryWeapon!.forgeTier).toBe(2);
    expect(pea.primaryWeapon!.maxRange).toBeGreaterThan(DUAL_WEAPON_KITS.pea.primary.maxRange);

    // Next tier locks into Tactical Tier 3 Masterwork!
    const opts2 = getWeaponForgeOptions(pea.primaryWeapon!, 'pea', pea.weaponForge?.primary);
    expect(opts2).toHaveLength(1);
    expect(opts2[0].targetTier).toBe(3);

    // Forge Secondary -> Elemental Tier 2 at a Tinker Forge stop (25% discount)
    const forgeNode = run.nodes.find((n) => n.type === 'forge')!;
    expect(forgeNode).toBeDefined();
    expect(openForgeNode(run, forgeNode.id)).toBe(true);
    expect(run.status).toBe('forge');
    run.seeds = 100;
    expect(forgeHeroWeapon(run, pea.uid, 'secondary', 'elemental', false)).toBe(true);
    expect(pea.weaponForge?.secondary).toEqual({ tier: 2, branch: 'elemental' });
    expect(pea.secondaryWeapon!.appliesStatus).toBeDefined();
    leaveForgeNode(run);
    expect(run.status).toBe('map');
    expect(forgeNode.completed).toBe(true);
  });

  it('tracks Lore Monuments, World Chronicles (16 entries), Weather Passives, Combo Chains, and Frost status', () => {
    expect(WORLD_LORE_CHRONICLES).toHaveLength(16);
    expect(Object.keys(SEASON_WEATHER_INFO)).toEqual(['spring', 'summer', 'autumn', 'winter']);
    expect(Object.keys(SEASON_ACT_INTROS)).toEqual(['spring', 'summer', 'autumn', 'winter']);
    expect(FACTION_DOSSIERS).toHaveLength(3);

    const meta = defaultMetaProgress();
    const run = createNewRun(meta, 'spring', 2026);
    const loreNode = run.nodes.find((n) => n.type === 'lore')!;
    expect(loreNode).toBeDefined();
    expect(openLoreNode(run, loreNode.id, meta)).toBe(true);
    expect(run.status).toBe('lore');
    expect(run.pendingLore).toBeTruthy();
    expect(meta.discoveredLoreIds).toContain(run.pendingLore!.loreId);

    const spBefore = run.roster[0].skillPoints;
    expect(claimLoreReward(run, 'sp')).toBe(true);
    expect(run.status).toBe('map');
    expect(run.roster[0].skillPoints).toBe(spBefore + 1);

    // Mario+Rabbids Combo Chain + Frost Melee Vulnerability check
    const cow = createHeroFromBlueprint('cow');
    const battle = createBattleFromMap('frostplow_citadel', [cow], [], {});
    expect(battle.seasonId).toBe('winter');
    finishPrepPhase(battle);
    const cowUnit = battle.units.find((u) => u.visualKind === 'cow')!;
    const boss = battle.units.find((u) => u.isBoss)!;
    expect(boss.visualKind).toBe('frostboss');
    expect(boss.isBoss).toBe(true);

    // Clear obstacles between cow and boss
    for (let y = 0; y < battle.height; y++) {
      for (let x = 0; x < battle.width; x++) {
        battle.tiles[y][x].cover = null;
        battle.tiles[y][x].elevation = 0;
        battle.tiles[y][x].terrain = 'grass';
      }
    }
    cowUnit.pos = { x: 4, y: 6 };
    boss.pos = { x: 4, y: 4 };
    boss.statuses = [];
    const baseFc = forecastAttack(battle, cowUnit, boss.pos);
    boss.statuses = [{ kind: 'frost', turns: 2 }];
    const frostFc = forecastAttack(battle, cowUnit, boss.pos);
    expect(frostFc.finalDamage).toBe(baseFc.finalDamage + 1); // Frost grants +1 Melee/Gimmick DMG!

    // Dash builds Combo Chain
    cowUnit.pos = { x: 4, y: 6 };
    boss.pos = { x: 4, y: 4 };
    expect(executeDash(battle, cowUnit.id, boss.id)).toBe(true);
    expect(battle.comboChain).toBeGreaterThanOrEqual(1);
    startPhase(battle, 'player');
    expect(battle.comboChain).toBe(0); // resets cleanly on new player turn
  });

  it('wires Winter Act 4, all 4 Winter battle maps, 3 non-animal Winter contraptions, and Tier-4 Skill Tree Capstones', () => {
    expect(ACTS).toHaveLength(4);
    expect(ACTS[3].id).toBe('winter');
    expect(generateActNodes(3, actRng(42, 3))).toHaveLength(22);

    for (const mapId of [
      'frost_brook_ridge',
      'hearth_greenhouse_courtyard',
      'icicle_supply_run',
      'frostplow_citadel',
    ]) {
      expect(MAP_TEMPLATES[mapId]).toBeDefined();
      expect(MAP_TEMPLATES[mapId].theme).toBe('winter');
    }

    // Confirm ZERO animal enemies across all 16 enemy blueprints
    expect(ENEMY_BLUEPRINTS.snowplow).toBeDefined();
    expect(ENEMY_BLUEPRINTS.frostblower).toBeDefined();
    expect(ENEMY_BLUEPRINTS.frostboss).toBeDefined();
    for (const bp of Object.values(ENEMY_BLUEPRINTS)) {
      const desc = `${bp.name} ${bp.title} ${bp.blurb}`.toLowerCase();
      expect(desc).not.toMatch(/\bhound\b|\bdog\b|\bgoose\b|\bmole\b|\bfox\b|\bwolf\b|\brat\b/);
    }

    // 4-Tier Capstones (228 total perks, MAX_HERO_LEVEL 10)
    expect(MAX_HERO_LEVEL).toBe(10);
    expect(ALL_SKILL_PERK_IDS).toHaveLength(228);
    const run = createNewRun(defaultMetaProgress(), 'spring', 11);
    const cow = run.roster.find((h) => h.species === 'cow')!;
    cow.skillPoints = 6;
    const pathA = getHeroSkillTree('cow').pathA;
    expect(pathA.perks).toHaveLength(4);
    for (const p of pathA.perks) {
      expect(unlockHeroPerk(run, cow.uid, p.id)).toBe(true);
    }
    expect(cow.perkIds).toContain(pathA.perks[3].id);
  });

  it('verifies Wave 2 Game Dev Panel fixes: Combo Chain scaling (+1/+2/+3), Lore SP for ALL living heroes, Starter Forge Voucher & Endless Tinkerer Voucher', () => {
    const meta = defaultMetaProgress();
    const run = createNewRun(meta, 'spring', 313);
    expect(run.forgeVouchers).toBe(1);

    // Lore Monument SP reward grants +1 SP to EVERY living hero (not just hero[0])
    const loreNode = run.nodes.find((n) => n.type === 'lore')!;
    const beforeSp = run.roster.map((h) => h.skillPoints);
    expect(openLoreNode(run, loreNode.id, meta)).toBe(true);
    expect(claimLoreReward(run, 'sp')).toBe(true);
    run.roster.forEach((h, i) => {
      if (!h.harvested) {
        expect(h.skillPoints).toBe(beforeSp[i] + 1);
      }
    });

    // Combo Chain momentum bonus scales cleanly (+1 at 2x, +2 at 4x, +3 at 6x, capped at +3)
    const pea = createHeroFromBlueprint('pea');
    const battle = createBattleFromMap('vegetable_patch', [pea], [], {});
    finishPrepPhase(battle);
    const peaUnit = battle.units.find((u) => u.visualKind === 'pea')!;
    const foe = battle.units.find((u) => u.team === 'enemy')!;
    for (let y = 0; y < battle.height; y++) {
      for (let x = 0; x < battle.width; x++) {
        battle.tiles[y][x].cover = null;
        battle.tiles[y][x].elevation = 0;
        battle.tiles[y][x].terrain = 'grass';
      }
    }
    peaUnit.pos = { x: 4, y: 6 };
    foe.pos = { x: 4, y: 4 };
    foe.family = 'neutral';
    battle.comboChain = 0;
    const fc0 = forecastAttack(battle, peaUnit, foe.pos);
    battle.comboChain = 2;
    const fc2 = forecastAttack(battle, peaUnit, foe.pos);
    battle.comboChain = 4;
    const fc4 = forecastAttack(battle, peaUnit, foe.pos);
    battle.comboChain = 6;
    const fc6 = forecastAttack(battle, peaUnit, foe.pos);
    expect(fc2.finalDamage).toBe(fc0.finalDamage + 1);
    expect(fc4.finalDamage).toBe(fc0.finalDamage + 2);
    expect(fc6.finalDamage).toBe(fc0.finalDamage + 3);

    // Endless Tinkerer Bonus Room 'weapon' grants +1 Free Forge Voucher
    const endlessRun = createEndlessRun(meta, 505);
    const startVouchers = endlessRun.forgeVouchers ?? 0;
    endlessRun.status = 'bonus_room';
    endlessRun.endless!.activeBonus = {
      kind: 'tinkerer',
      title: "Tinkerer's Shed",
      claimed: false,
    };
    resolveEndlessBonusChoice(endlessRun, meta, 'weapon');
    expect(endlessRun.forgeVouchers).toBe(startVouchers + 1);
  });
});
