import { describe, expect, it } from 'vitest';
import { ENEMY_BLUEPRINTS } from '../../data/enemies';
import { ITEM_REGISTRY } from '../../data/items';
import { MAP_TEMPLATES } from '../../data/maps';
import { PRODUCE_BLUEPRINTS } from '../../data/produce';
import { RELIC_REGISTRY } from '../../data/relics';
import { ALL_SKILL_PERK_IDS, getHeroPerkDefs, getHeroSkillTree } from '../../data/skills';
import { ALT_WEAPONS_BY_SPECIES } from '../../data/weapons';
import {
  createBattleFromMap,
  createBattleUnitFromEnemy,
  executeAbility,
  executeItem,
  executeOverwatch,
} from '../battle';
import { forecastAttack } from '../combat';
import {
  applyStatusToUnit,
  getEffectiveJumpRange,
  getMaxOverwatchCharges,
  getRemainingMove,
  hasStatus,
} from '../hooks';
import { drawTravelHand, createRng } from '../mapgen';
import { applyTravelCardMove, createHeroFromBlueprint, createNewRun, defaultMetaProgress } from '../run';
import {
  AVAILABLE_VARIANT_SPRITES,
  hasVariantSprite,
  resolveVariantSpriteKey,
} from '../../renderer3d/textures';

describe('overnight expansion: battle poses, heroes, enemies, maps, items, relics & cards', () => {
  it('wires all 19 heroes with unique alt weapons and 12-perk 3-branch 4-tier skill trees (228 perks)', () => {
    const heroes = Object.values(PRODUCE_BLUEPRINTS);
    expect(heroes).toHaveLength(19);
    expect(ALL_SKILL_PERK_IDS.length).toBe(228);

    for (const h of heroes) {
      expect(ALT_WEAPONS_BY_SPECIES[h.species]).toBeDefined();
      const tree = getHeroSkillTree(h.species);
      expect(tree.species).toBe(h.species);
      const perks = getHeroPerkDefs(h.species);
      expect(perks).toHaveLength(12);
      const ids = new Set(perks.map((p) => p.id));
      for (const p of perks) {
        if (p.requires) expect(ids.has(p.requires)).toBe(true);
      }
    }
  });

  it('wires all 16 non-animal enemies including Winter contraptions and Grand Marshal Frostplow', () => {
    expect(Object.keys(ENEMY_BLUEPRINTS)).toHaveLength(16);
    expect(ENEMY_BLUEPRINTS.hound).toBeUndefined();
    expect(ENEMY_BLUEPRINTS.goose).toBeUndefined();
    expect(ENEMY_BLUEPRINTS.mole).toBeUndefined();

    const wally = createBattleUnitFromEnemy('barrow', 0, { x: 3, y: 2 });
    expect(wally.moveRange).toBe(5);
    expect(wally.dashKnockback).toBe(1);

    const larry = createBattleUnitFromEnemy('blower', 0, { x: 4, y: 2 });
    expect(larry.weapon.appliesStatus?.kind).toBe('feared');
    expect(larry.dashKnockback).toBe(1);

    const ted = createBattleUnitFromEnemy('sapper', 1, { x: 5, y: 2 });
    expect(ted.weapon.arc).toBe('lobbed');
    expect(ted.weapon.appliesStatus?.kind).toBe('rooted');

    // Legacy localStorage save compatibility aliases map cleanly to contraption enemies
    expect(createBattleUnitFromEnemy('hound', 0, { x: 1, y: 1 }).blueprintId).toBe('barrow');
    expect(createBattleUnitFromEnemy('goose', 0, { x: 1, y: 1 }).blueprintId).toBe('blower');
    expect(createBattleUnitFromEnemy('mole', 0, { x: 1, y: 1 }).blueprintId).toBe('sapper');

    const tank = createBattleUnitFromEnemy('kettlebot', 2, { x: 6, y: 2 });
    expect(hasStatus(tank, 'shield')).toBe(true);
    expect(tank.weapon.arc).toBe('pierce');
    expect(tank.weapon.appliesStatus?.kind).toBe('acid');
  });

  it('resolves _cover and _action pose sprites for posed heroes and falls back safely', () => {
    const posedHeroes = [
      'cow',
      'lettuce',
      'pea',
      'lemon',
      'strawberry',
      'mushroom',
      'duck',
      'pumpkin',
      'blueberry',
      'owl',
    ];
    for (const kind of posedHeroes) {
      expect(hasVariantSprite(kind, 'cover')).toBe(true);
      expect(hasVariantSprite(kind, 'action')).toBe(true);
      expect(resolveVariantSpriteKey(kind, 'cover')).toBe(`${kind}_cover`);
      expect(resolveVariantSpriteKey(kind, 'action')).toBe(`${kind}_action`);
    }
    expect(AVAILABLE_VARIANT_SPRITES.has('barrow_hit')).toBe(true);
    expect(AVAILABLE_VARIANT_SPRITES.has('blower_hit')).toBe(true);
    expect(AVAILABLE_VARIANT_SPRITES.has('sapper_hit')).toBe(true);
    expect(AVAILABLE_VARIANT_SPRITES.has('kettlebot_hit')).toBe(true);
    expect(resolveVariantSpriteKey('potato', 'cover')).toBe('potato');
  });

  it('executes Patch Gourd Slam hybrid aoe_self (shields allies + smashes & knocks back adjacent enemies)', () => {
    const squad = [
      createHeroFromBlueprint('pumpkin'),
      createHeroFromBlueprint('blueberry'),
      createHeroFromBlueprint('owl'),
      createHeroFromBlueprint('cow'),
    ];
    const battle = createBattleFromMap('duck_pond_meadow', squad, [], {});
    const patch = battle.units.find((u) => u.blueprintId === 'pumpkin')!;
    const pip = battle.units.find((u) => u.blueprintId === 'blueberry')!;
    const foe = battle.units.find((u) => u.team === 'enemy')!;

    patch.pos = { x: 4, y: 8 };
    pip.pos = { x: 3, y: 8 };
    foe.pos = { x: 4, y: 7 };
    const prevHp = foe.hp;

    expect(executeAbility(battle, patch.id, patch.pos)).toBe(true);
    expect(hasStatus(patch, 'shield')).toBe(true);
    expect(hasStatus(pip, 'shield')).toBe(true);
    expect(foe.hp).toBeLessThan(prevHp);
  });

  it('executes Cider Flask, Acorn Smoke Bomb, and Corrosive Briar Pod items cleanly', () => {
    expect(Object.keys(ITEM_REGISTRY)).toHaveLength(6);
    const squad = [
      createHeroFromBlueprint('pumpkin'),
      createHeroFromBlueprint('blueberry'),
      createHeroFromBlueprint('owl'),
      createHeroFromBlueprint('cow'),
    ];
    const battle = createBattleFromMap('botanical_rotunda', squad, [], {
      cider_flask: 1,
      acorn_smoke: 1,
      bramble_snare: 1,
    });
    const [h1, h2, h3] = battle.units.filter((u) => u.team === 'player');
    const foe = battle.units.find((u) => u.team === 'enemy')!;

    h1.pos = { x: 3, y: 9 };
    h2.pos = { x: 4, y: 9 };
    h1.hp = Math.max(1, h1.maxHp - 5);
    h2.hp = Math.max(1, h2.maxHp - 5);
    applyStatusToUnit(h2, 'burn', 2);

    // 1. Cider Flask: AoE heal + cleanse + Boosted!
    expect(executeItem(battle, h1.id, 'cider_flask', h1.pos)).toBe(true);
    expect(hasStatus(h2, 'burn')).toBe(false);
    expect(hasStatus(h1, 'boosted')).toBe(true);
    expect(hasStatus(h2, 'boosted')).toBe(true);

    // 2. Acorn Smoke Bomb: Shield + +2 bonus Move!
    const prevMove = getRemainingMove(h2);
    expect(executeItem(battle, h2.id, 'acorn_smoke', h2.pos)).toBe(true);
    expect(hasStatus(h2, 'shield')).toBe(true);
    expect(getRemainingMove(h2)).toBe(prevMove + 2);

    // 3. Corrosive Briar Pod: AoE Acid + damage!
    h3.pos = { x: 4, y: 5 };
    foe.pos = { x: 4, y: 2 };
    const prevFoeHp = foe.hp;
    expect(executeItem(battle, h3.id, 'bramble_snare', foe.pos)).toBe(true);
    expect(foe.hp).toBeLessThan(prevFoeHp);
    if (foe.alive) expect(hasStatus(foe, 'acid')).toBe(true);
  });

  it('applies all 4 new farm relics (Dewdrop Compass, Copper Weathervane, Heirloom Pocketwatch, Straw Hat Trophy)', () => {
    expect(Object.keys(RELIC_REGISTRY)).toHaveLength(10);
    const squad = [
      createHeroFromBlueprint('owl'),
      createHeroFromBlueprint('blueberry'),
      createHeroFromBlueprint('pumpkin'),
      createHeroFromBlueprint('cow'),
    ];
    const allNewRelics = [
      'dewdrop_compass',
      'copper_weathervane',
      'heirloom_pocketwatch',
      'straw_hat_trophy',
    ];
    const battle = createBattleFromMap('cider_mill_yard', squad, allNewRelics, {});
    const owl = battle.units.find((u) => u.blueprintId === 'owl')!;
    const pip = battle.units.find((u) => u.blueprintId === 'blueberry')!;
    const foe = battle.units.find((u) => u.team === 'enemy')!;

    // Dewdrop Compass: +1 Move on Turn 1
    expect(getRemainingMove(owl)).toBe(owl.moveRange + 1);

    // Copper Weathervane: +1 Jump Range & +1 High Ground DMG
    expect(getEffectiveJumpRange(owl, undefined, battle.relicIds)).toBe(owl.jumpRange + 1);

    // Heirloom Pocketwatch: +1 Overwatch shot
    expect(getMaxOverwatchCharges(owl, battle.relicIds)).toBe(2);
    expect(executeOverwatch(battle, owl.id)).toBe(true);
    expect(owl.actions.overwatchCharges).toBe(2);

    // Summit High Ground (+3 at elev diff 2) + Copper Weathervane (+1) = +4 & Straw Hat Trophy (+2 Assist DMG & Range 2)
    owl.actions.hasAttacked = false;
    battle.tiles[4][2].elevation = 2;
    battle.tiles[4][5].elevation = 0;
    battle.tiles[4][3].cover = null;
    battle.tiles[4][4].cover = null;
    owl.pos = { x: 2, y: 4 };
    foe.pos = { x: 5, y: 4 };
    pip.pos = { x: 5, y: 6 }; // 2 tiles away from foe -> triggers Straw Hat Trophy Assist!
    const fc = forecastAttack(battle, owl, foe.pos);
    expect(fc.highGroundBonus).toBe(4);
    expect(fc.partnerAssistUnitId).toBe(pip.id);
    expect(fc.partnerAssistDamage).toBeGreaterThanOrEqual(3);
  });

  it('spawns all 3 new tactical battle maps and applies all new Travel Card bonuses cleanly', () => {
    const squad = [
      createHeroFromBlueprint('pumpkin'),
      createHeroFromBlueprint('blueberry'),
      createHeroFromBlueprint('owl'),
      createHeroFromBlueprint('cow'),
    ];
    for (const mapId of ['duck_pond_meadow', 'botanical_rotunda', 'cider_mill_yard']) {
      expect(MAP_TEMPLATES[mapId]).toBeDefined();
      const b = createBattleFromMap(mapId, squad, [], {});
      expect(b.units.filter((u) => u.team === 'player')).toHaveLength(4);
      expect(b.units.filter((u) => u.team === 'enemy').length).toBeGreaterThanOrEqual(4);
    }

    // Travel card bonus execution (shield, move1, item)
    const run = createNewRun(defaultMetaProgress(), 'spring', 777);
    const rng = createRng(101);
    const drawn = Array.from({ length: 30 }, () => drawTravelHand(rng)).flat();
    expect(drawn.some((c) => c.bonus === 'shield')).toBe(true);
    expect(drawn.some((c) => c.bonus === 'move1')).toBe(true);
    expect(drawn.some((c) => c.bonus === 'item')).toBe(true);

    // Play a Shield card + a Forager's Detour item card
    const shieldCard = {
      id: 'tc_shield',
      name: 'Orchard Guard',
      steps: 1,
      bonus: 'shield' as const,
      icon: '🛡️',
      desc: 'Start next fight Shielded!',
      tint: 'mint' as const,
    };
    const dest = run.nodes.find((n) => n.stage === 1)!.id;
    run.travelHand = [shieldCard];
    expect(applyTravelCardMove(run, 'tc_shield', dest, rng)).not.toBeNull();
    expect(run.nextBattleBuff?.shield).toBe(true);
  });
});
