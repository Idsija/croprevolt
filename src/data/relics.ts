import type { RelicDef } from '../engine/types';

export const RELIC_REGISTRY: Record<string, RelicDef> = {
  rich_loam: {
    id: 'rich_loam',
    name: 'Rich Loam',
    effect: 'rich_loam',
    color: '#8c5a32',
    icon: '🪴',
    description: 'All produce heroes heal 2 HP at the start of every battle.',
  },
  splintering_compost: {
    id: 'splintering_compost',
    name: 'Splintering Compost',
    effect: 'splintering_compost',
    color: '#c97b2b',
    icon: '💥',
    description: 'Destroying any cover block deals 2 splash damage to adjacent enemies.',
  },
  bouncy_mulch: {
    id: 'bouncy_mulch',
    name: 'Bouncy Mulch',
    effect: 'bouncy_mulch',
    color: '#5fa853',
    icon: '🦘',
    description: 'Performing a Team-Jump grants +2 Attack damage until end of turn.',
  },
  heirloom_fertilizer: {
    id: 'heirloom_fertilizer',
    name: 'Heirloom Fertilizer',
    effect: 'heirloom_fertilizer',
    color: '#d4a72c',
    icon: '✨',
    description: 'All produce signature abilities recharge 1 turn faster (minimum 1).',
  },
  sharp_trowel: {
    id: 'sharp_trowel',
    name: 'Stolen Trowel',
    effect: 'sharp_trowel',
    color: '#5d7b93',
    icon: '⚔️',
    description: 'Produce vs. Tool Advantage bonus increases from +30% to +50% damage.',
  },
  lucky_clover: {
    id: 'lucky_clover',
    name: 'Four-Leaf Clover',
    effect: 'lucky_clover',
    color: '#2e9e5b',
    icon: '🍀',
    description: '50% Half-Cover shots upgrade to 70% accuracy for your squad.',
  },
};

export const ALL_RELIC_IDS = Object.keys(RELIC_REGISTRY);
