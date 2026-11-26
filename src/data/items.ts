import type { ItemDef } from '../engine/types';

export const ITEM_REGISTRY: Record<string, ItemDef> = {
  watering_can: {
    id: 'watering_can',
    name: 'Watering Can',
    targetType: 'ally',
    range: 4,
    aoeRadius: 0,
    heal: 6,
    color: '#4ea8de',
    icon: '🚿',
    description: 'Splash an ally (or self) for +6 HP. Uses your Ability/Item action.',
  },
  fertilizer_bomb: {
    id: 'fertilizer_bomb',
    name: 'Fertilizer Bomb',
    targetType: 'tile',
    range: 5,
    aoeRadius: 1,
    damage: 4,
    coverDamage: 8,
    color: '#d97724',
    icon: '💣',
    description: 'Lob an explosive compost sack over cover: 4 AoE damage and obliterates crates!',
  },
  honey_pot: {
    id: 'honey_pot',
    name: 'Sticky Honey Pot',
    targetType: 'tile',
    range: 5,
    aoeRadius: 1,
    damage: 1,
    appliesStatus: { kind: 'rooted', turns: 1 },
    color: '#eab308',
    icon: '🍯',
    description: 'Lob a sticky pot over cover: 1 dmg and Roots all enemies in a 3x3 area.',
  },
};

export const ALL_ITEM_IDS = Object.keys(ITEM_REGISTRY);
