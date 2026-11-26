import { describe, expect, it } from 'vitest';
import {
  createDailyRun,
  createNewRun,
  defaultMetaProgress,
  generateMarketOffers,
  generateRewardForNode,
  META_UNLOCK_COSTS,
  rerollGraftChoices,
} from '../run';
import type { MetaProgress } from '../types';

function metaWith(...keys: Array<keyof MetaProgress['unlocks']>): MetaProgress {
  const meta = defaultMetaProgress();
  for (const k of keys) meta.unlocks[k] = true;
  return meta;
}

describe('Seed Shed perks', () => {
  it('has a priced entry for every unlock', () => {
    expect(Object.keys(META_UNLOCK_COSTS).sort()).toEqual(Object.keys(defaultMetaProgress().unlocks).sort());
    for (const def of Object.values(META_UNLOCK_COSTS)) expect(def.cost).toBeGreaterThan(0);
  });

  it('applies starting perks to a new run', () => {
    const plain = createNewRun(defaultMetaProgress(), 'spring', 5, 0);
    const run = createNewRun(metaWith('seedPouch', 'honeyReserve', 'seasonedSeedlings', 'patientBell'), 'spring', 5, 0);
    expect(run.seeds).toBe(plain.seeds + 15);
    expect(run.items.honey_pot).toBe((plain.items.honey_pot ?? 0) + 1);
    expect(run.roster[0].skillPoints).toBe(plain.roster[0].skillPoints + 1);
    expect(run.harvestBellLimit).toBe((plain.harvestBellLimit ?? 0) + 1);
  });

  it('lowers market prices with the coupon', () => {
    const rng = () => 0.3;
    const plain = generateMarketOffers(createNewRun(defaultMetaProgress(), 'spring', 5, 0), rng);
    const cheap = generateMarketOffers(createNewRun(metaWith('marketCoupon'), 'spring', 5, 0), rng);
    cheap.forEach((o, i) => expect(o.cost).toBe(Math.ceil(plain[i].cost * 0.85)));
  });

  it('rerolls a graft offer once per run, to different stickers', () => {
    const run = createNewRun(metaWith('graftReroll'), 'spring', 5, 0);
    const node = run.nodes.find((n) => n.type === 'skirmish')!;
    run.currentNodeId = node.id;
    run.pendingReward = generateRewardForNode(run, node);
    const before = [...run.pendingReward.graftChoices];
    expect(rerollGraftChoices(run)).toBe(true);
    expect(run.pendingReward.graftChoices).toHaveLength(before.length);
    for (const id of run.pendingReward.graftChoices) expect(before).not.toContain(id);
    expect(rerollGraftChoices(run)).toBe(false);
  });

  it('gives no perks without the unlock or in a daily run', () => {
    const run = createNewRun(defaultMetaProgress(), 'spring', 5, 0);
    const node = run.nodes.find((n) => n.type === 'skirmish')!;
    run.pendingReward = generateRewardForNode(run, node);
    expect(rerollGraftChoices(run)).toBe(false);
    expect(createDailyRun().perks).toEqual({ breatherBonus: 0, marketPriceMult: 1, bellBonus: 0, graftRerollsLeft: 0 });
  });
});
