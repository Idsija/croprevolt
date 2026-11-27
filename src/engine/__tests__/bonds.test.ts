import { describe, expect, it } from 'vitest';
import { createBattleFromMap, finishPrepPhase } from '../battle';
import { activeBonds, bondStatuses } from '../bonds';
import { hasStatus } from '../hooks';
import { createHeroFromBlueprint } from '../run';

const root = { family: 'root' };
const vine = { family: 'vine' };
const fruit = { family: 'fruit' };

describe('squad bonds', () => {
  it('switches a bond on at two of a kind and upgrades it at three', () => {
    expect(activeBonds([root, vine]).map((b) => b.def.id)).toEqual([]);
    const two = activeBonds([vine, vine, root]);
    expect(two.map((b) => [b.def.id, b.tier])).toEqual([['vine_volley', 1]]);
    const three = activeBonds([vine, vine, vine, root]);
    expect(three.find((b) => b.def.id === 'vine_volley')?.tier).toBe(2);
  });

  it('awards the Mixed Basket for one of each family and counts animals separately', () => {
    const ids = activeBonds([root, vine, fruit, { family: 'fruit', isAnimal: true }]).map((b) => b.def.id);
    expect(ids).toContain('mixed_basket');
    expect(ids).toContain('fruit_frenzy');
    expect(ids).not.toContain('barnyard_buddies');
    const statuses = bondStatuses([root, { family: 'root', isAnimal: true }]);
    expect(statuses.find((b) => b.def.id === 'barnyard_buddies')).toMatchObject({ tier: 0, count: 1, missing: 1 });
    expect(statuses[0].tier).toBeGreaterThan(0);
  });

  it('applies bonds to the deployed squad once, when Turn 1 starts', () => {
    const heroes = [
      createHeroFromBlueprint('cow'),
      createHeroFromBlueprint('pea'),
      createHeroFromBlueprint('lettuce'),
      createHeroFromBlueprint('lemon'),
    ];
    const vines = heroes.filter((h) => h.family === 'vine');
    expect(vines.length).toBeGreaterThanOrEqual(2);
    const baseCover = vines[0].weapon.coverDamage ?? vines[0].weapon.damage;
    heroes[0].hp = heroes[0].maxHp - 3;

    const battle = createBattleFromMap('vegetable_patch', heroes, [], {}, undefined, { enablePrepPhase: true });
    const vineUnit = battle.units.find((u) => u.rosterUid === vines[0].uid)!;
    // Nothing is applied while the squad can still be rearranged.
    expect(vineUnit.weapon.coverDamage ?? vineUnit.weapon.damage).toBe(baseCover);
    finishPrepPhase(battle);
    expect(vineUnit.weapon.coverDamage).toBe(baseCover + 2);
    // A second call changes nothing.
    finishPrepPhase(battle);
    expect(vineUnit.weapon.coverDamage).toBe(baseCover + 2);
    expect(battle.activeBonds?.map((b) => b.id)).toEqual(expect.arrayContaining(['vine_volley', 'mixed_basket']));
    expect(battle.units.find((u) => u.rosterUid === heroes[0].uid)!.hp).toBe(heroes[0].maxHp - 1);
    // The roster hero is untouched: bonds live on the battle unit only.
    expect(vines[0].weapon.coverDamage ?? vines[0].weapon.damage).toBe(baseCover);

    const roots = createBattleFromMap(
      'vegetable_patch',
      [heroes.find((h) => h.family === 'root')!, { ...heroes.find((h) => h.family === 'root')!, uid: 'twin' }],
      [],
      {}
    );
    expect(roots.units.filter((u) => u.team === 'player').every((u) => hasStatus(u, 'shield'))).toBe(true);
  });
});
