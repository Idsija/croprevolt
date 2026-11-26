import { ALL_GRAFT_IDS, GRAFT_REGISTRY } from '../data/grafts';
import { ALL_ITEM_IDS, ITEM_REGISTRY } from '../data/items';
import { PRODUCE_BLUEPRINTS, RECRUITABLE_BLUEPRINT_IDS, STARTER_BLUEPRINT_IDS } from '../data/produce';
import { MAP_TEMPLATES } from '../data/maps';
import { ALL_RELIC_IDS } from '../data/relics';
import { ACTS, actIndexForSeason, actRng, generateActNodes, randomSeed } from './mapgen';
import type {
  BattleState,
  MarketOffer,
  MetaProgress,
  PromotionTier,
  RewardBundle,
  RosterHero,
  RunState,
  SeasonId,
  SeasonNode,
} from './types';

const META_STORAGE_KEY = 'crop_revolt_meta_v1';
const RUN_STORAGE_KEY = 'crop_revolt_run_v1';

export function defaultMetaProgress(): MetaProgress {
  return {
    heirloomSeeds: 0,
    runsPlayed: 0,
    runsWon: 0,
    unlocks: {
      extraItemSatchel: false,
      heirloomSoil: false,
      starterRelic: false,
    },
  };
}

export function loadMetaProgress(): MetaProgress {
  try {
    if (typeof localStorage === 'undefined') return defaultMetaProgress();
    const raw = localStorage.getItem(META_STORAGE_KEY);
    if (!raw) return defaultMetaProgress();
    const parsed = JSON.parse(raw) as Partial<MetaProgress>;
    return {
      ...defaultMetaProgress(),
      ...parsed,
      unlocks: {
        ...defaultMetaProgress().unlocks,
        ...(parsed.unlocks ?? {}),
      },
    };
  } catch {
    return defaultMetaProgress();
  }
}

export function saveMetaProgress(meta: MetaProgress): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(META_STORAGE_KEY, JSON.stringify(meta));
  } catch {
    // Ignore storage quota errors
  }
}

export function loadSavedRun(): RunState | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(RUN_STORAGE_KEY);
    if (!raw) return null;
    return migrateSavedRun(JSON.parse(raw) as RunState);
  } catch {
    return null;
  }
}

export function saveRun(run: RunState): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(RUN_STORAGE_KEY, JSON.stringify(run));
  } catch {
    // Ignore storage quota errors
  }
}

export function clearSavedRun(): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.removeItem(RUN_STORAGE_KEY);
  } catch {
    // Ignore storage errors
  }
}

export const META_UNLOCK_COSTS: Record<keyof MetaProgress['unlocks'], { cost: number; title: string; desc: string }> = {
  extraItemSatchel: {
    cost: 25,
    title: 'Garden Toolbelt',
    desc: 'Begin every run with +1 Fertilizer Bomb and +1 Watering Can.',
  },
  heirloomSoil: {
    cost: 40,
    title: 'Heirloom Potting Mix',
    desc: 'All starter produce heroes begin every run with +2 Max HP.',
  },
  starterRelic: {
    cost: 55,
    title: 'Compost Blessing',
    desc: 'Begin every run with the Rich Loam Soil Relic (+2 HP at battle start).',
  },
};

export function purchaseMetaUnlock(
  meta: MetaProgress,
  key: keyof MetaProgress['unlocks']
): boolean {
  if (meta.unlocks[key]) return false;
  const cost = META_UNLOCK_COSTS[key].cost;
  if (meta.heirloomSeeds < cost) return false;
  meta.heirloomSeeds -= cost;
  meta.unlocks[key] = true;
  saveMetaProgress(meta);
  return true;
}

export function createHeroFromBlueprint(blueprintId: string, bonusMaxHp = 0): RosterHero {
  const bp = PRODUCE_BLUEPRINTS[blueprintId];
  if (!bp) throw new Error(`Unknown produce blueprint: ${blueprintId}`);
  const maxHp = bp.maxHp + bonusMaxHp;
  return {
    uid: `${bp.id}_${Math.random().toString(36).slice(2, 8)}`,
    blueprintId: bp.id,
    name: bp.name,
    species: bp.species,
    title: bp.title,
    family: bp.family,
    isAnimal: bp.isAnimal,
    coopPassive: bp.coopPassive,
    ignoresMud: bp.ignoresMud,
    livingHalfCover: bp.livingHalfCover,
    launchpadCoop: bp.launchpadCoop,
    hp: maxHp,
    maxHp,
    moveRange: bp.moveRange,
    jumpRange: bp.jumpRange,
    dashDamage: bp.dashDamage,
    dashKnockback: bp.dashKnockback,
    dashStatus: bp.dashStatus ? { ...bp.dashStatus } : undefined,
    weapon: { ...bp.weapon, appliesStatus: bp.weapon.appliesStatus ? { ...bp.weapon.appliesStatus } : undefined },
    ability: { ...bp.ability, appliesStatus: bp.ability.appliesStatus ? { ...bp.ability.appliesStatus } : undefined },
    graftIds: [],
    tier: 'seedling',
    harvested: false,
    color: bp.color,
    accentColor: bp.accentColor,
  };
}

export function createNewRun(
  meta: MetaProgress,
  seasonId: SeasonId = 'spring',
  seed: number = randomSeed()
): RunState {
  const hpBonus = meta.unlocks.heirloomSoil ? 2 : 0;
  // Starter squad: Spudnik, Snap-Pea, Zestia & Truffle Boar active + Habanero on bench (swap anytime!)
  const roster = STARTER_BLUEPRINT_IDS.map((id) => createHeroFromBlueprint(id, hpBonus));
  const relicIds = meta.unlocks.starterRelic ? ['rich_loam'] : [];
  const items: Record<string, number> = {
    watering_can: meta.unlocks.extraItemSatchel ? 2 : 1,
    fertilizer_bomb: meta.unlocks.extraItemSatchel ? 2 : 1,
    honey_pot: 1,
  };
  const act = actIndexForSeason(seasonId);

  const run: RunState = {
    id: `run_${Date.now()}`,
    seasonId: ACTS[act].id,
    seasonName: actTitle(act),
    act,
    seed: seed >>> 0,
    recruitBonusHp: hpBonus,
    seenEventIds: [],
    pendingEvent: null,
    nodes: [],
    currentNodeId: null,
    completedNodeIds: [],
    roster,
    activeSquadUids: roster.slice(0, 4).map((h) => h.uid),
    relicIds,
    items,
    seeds: act > 0 ? 8 * act : 0,
    battlesWon: 0,
    enemiesDefeated: 0,
    pendingReward: null,
    status: 'map',
  };
  run.nodes = generateActNodes(act, actRng(run.seed, act), mapDisplayName);
  return run;
}

export function actTitle(act: number): string {
  return `Act ${act + 1} · ${ACTS[act]?.name ?? ACTS[0].name}`;
}

function mapDisplayName(mapId: string): string {
  return MAP_TEMPLATES[mapId]?.name ?? mapId;
}

export function isFinalAct(run: RunState): boolean {
  return run.act >= ACTS.length - 1;
}

/** Move the run on to the next act's freshly generated map (after beating an act boss). */
export function advanceToNextAct(run: RunState): void {
  const next = Math.min(run.act + 1, ACTS.length - 1);
  run.act = next;
  run.seasonId = ACTS[next].id;
  run.seasonName = actTitle(next);
  run.nodes = generateActNodes(next, actRng(run.seed, next), mapDisplayName);
  run.completedNodeIds = [];
  run.currentNodeId = null;
  // Breather between acts: patch up the surviving squad.
  for (const hero of run.roster) {
    if (!hero.harvested) {
      hero.hp = Math.min(hero.maxHp, hero.hp + Math.ceil((hero.maxHp - hero.hp) / 2));
    }
  }
}

/** Bring a save from an older version up to the current RunState shape. */
export function migrateSavedRun(run: RunState): RunState {
  if (typeof run.act !== 'number') {
    run.act = actIndexForSeason(run.seasonId);
  }
  if (typeof run.seed !== 'number') {
    run.seed = randomSeed();
  }
  return run;
}

export function getAvailableNextNodeIds(run: RunState): string[] {
  if (run.completedNodeIds.length === 0) {
    // Any first-floor node is a valid start.
    return run.nodes.filter((n) => n.stage === 0).map((n) => n.id);
  }
  const lastId = run.completedNodeIds[run.completedNodeIds.length - 1];
  const lastNode = run.nodes.find((n) => n.id === lastId);
  if (!lastNode) return [];
  return lastNode.nextIds.filter((id) => !run.completedNodeIds.includes(id));
}

function pickRandomDistinct<T>(pool: readonly T[], count: number, rng = Math.random): T[] {
  const copy = [...pool];
  const out: T[] = [];
  while (out.length < count && copy.length > 0) {
    const idx = Math.floor(rng() * copy.length);
    out.push(copy.splice(idx, 1)[0]);
  }
  return out;
}

export function generateMarketOffers(run: RunState, rng = Math.random): MarketOffer[] {
  const graftPicks = pickRandomDistinct(ALL_GRAFT_IDS, 2, rng);
  const offers: MarketOffer[] = graftPicks.map((gid, i) => {
    const g = GRAFT_REGISTRY[gid];
    return {
      id: `mkt_graft_${i}_${gid}`,
      kind: 'graft',
      title: g.name,
      desc: g.description,
      icon: g.badgeIcon,
      cost: 10,
      graftId: gid,
      purchased: false,
    };
  });

  const bomb = ITEM_REGISTRY.fertilizer_bomb;
  const can = ITEM_REGISTRY.watering_can;
  offers.push(
    {
      id: 'mkt_item_bomb',
      kind: 'item',
      title: `+1 ${bomb.name}`,
      desc: bomb.description,
      icon: bomb.icon,
      cost: 6,
      itemId: 'fertilizer_bomb',
      purchased: false,
    },
    {
      id: 'mkt_item_can',
      kind: 'item',
      title: `+1 ${can.name}`,
      desc: can.description,
      icon: can.icon,
      cost: 5,
      itemId: 'watering_can',
      purchased: false,
    },
    {
      id: 'mkt_heal_spa',
      kind: 'heal',
      title: 'Compost Spa (+6 HP)',
      desc: 'Restore +6 HP to every active & bench hero.',
      icon: '🌿',
      cost: 7,
      purchased: false,
    }
  );

  if (run.roster.some((h) => h.harvested)) {
    offers.push({
      id: 'mkt_rescue_bail',
      kind: 'rescue',
      title: 'Barn Bailout',
      desc: 'Bribe the farmhand to free one bagged hero immediately at 70% HP!',
      icon: '🔓',
      cost: 12,
      purchased: false,
    });
  }

  return offers;
}

export function generateRewardForNode(run: RunState, node: SeasonNode, rng = Math.random): RewardBundle {
  const ownedRelics = new Set(run.relicIds);
  const availableRelics = ALL_RELIC_IDS.filter((id) => !ownedRelics.has(id));
  const ownedBlueprints = new Set(run.roster.map((h) => h.blueprintId));
  const recruitPool = RECRUITABLE_BLUEPRINT_IDS.filter((id) => !ownedBlueprints.has(id));

  if (node.type === 'vault' || node.type === 'shop') {
    const picks = pickRandomDistinct(recruitPool, 3, rng);
    return {
      seedsEarned: node.type === 'shop' ? 8 : 6,
      graftChoices: [],
      relicChoices: [],
      recruitChoices: picks,
      freeHealAmount: node.type === 'vault' ? 6 : 3,
      itemGrant: node.type === 'vault' ? { itemId: 'watering_can', count: 1 } : undefined,
      marketOffers: generateMarketOffers(run, rng),
      claimedGraft: true,
      claimedRelic: true,
      claimedRecruit: picks.length === 0,
    };
  }

  const grantsRelic = node.type === 'elite' || node.type === 'escape' || node.type === 'barn_rescue';
  const grantsRecruit =
    recruitPool.length > 0 && (node.type === 'skirmish' || node.type === 'barn_rescue');
  const recruitPicks = grantsRecruit ? pickRandomDistinct(recruitPool, 2, rng) : [];
  const randomItem =
    node.type === 'elite'
      ? 'fertilizer_bomb'
      : ALL_ITEM_IDS[Math.floor(rng() * ALL_ITEM_IDS.length)];

  return {
    seedsEarned: node.type === 'elite' ? 24 : node.type === 'escape' ? 16 : node.type === 'boss' ? 40 : 12,
    graftChoices: pickRandomDistinct(ALL_GRAFT_IDS, node.type === 'elite' ? 4 : 3, rng),
    relicChoices: grantsRelic ? pickRandomDistinct(availableRelics, 3, rng) : [],
    recruitChoices: recruitPicks,
    itemGrant: { itemId: randomItem, count: node.type === 'elite' ? 2 : 1 },
    freeHealAmount: node.type === 'escape' ? 4 : 3,
    claimedGraft: false,
    claimedRelic: !grantsRelic || availableRelics.length === 0,
    claimedRecruit: recruitPicks.length === 0,
  };
}

export function openVaultNode(run: RunState, nodeId: string): boolean {
  const node = run.nodes.find((n) => n.id === nodeId);
  if (!node || (node.type !== 'vault' && node.type !== 'shop')) return false;
  run.currentNodeId = nodeId;
  const freeHeal = node.type === 'vault' ? 6 : 3;
  // Heal squad at Vault / Market immediately!
  for (const hero of run.roster) {
    if (!hero.harvested) {
      hero.hp = Math.min(hero.maxHp, hero.hp + freeHeal);
    }
  }
  run.pendingReward = generateRewardForNode(run, node);
  if (run.pendingReward.itemGrant) {
    const { itemId, count } = run.pendingReward.itemGrant;
    run.items[itemId] = (run.items[itemId] ?? 0) + count;
  }
  run.seeds += run.pendingReward.seedsEarned;
  node.completed = true;
  if (!run.completedNodeIds.includes(nodeId)) {
    run.completedNodeIds.push(nodeId);
  }
  run.status = node.type === 'shop' ? 'shop' : 'vault';
  return true;
}

export function buyMarketOffer(run: RunState, offerId: string, targetHeroUid?: string): boolean {
  const offers = run.pendingReward?.marketOffers;
  if (!offers) return false;
  const offer = offers.find((o) => o.id === offerId && !o.purchased);
  if (!offer || run.seeds < offer.cost) return false;

  if (offer.kind === 'graft') {
    if (!offer.graftId || !targetHeroUid) return false;
    const prevClaimed = run.pendingReward!.claimedGraft;
    const ok = applyGraftToHero(run, targetHeroUid, offer.graftId);
    run.pendingReward!.claimedGraft = prevClaimed;
    if (!ok) return false;
  } else if (offer.kind === 'item' && offer.itemId) {
    run.items[offer.itemId] = (run.items[offer.itemId] ?? 0) + 1;
  } else if (offer.kind === 'heal') {
    for (const h of run.roster) {
      if (!h.harvested) h.hp = Math.min(h.maxHp, h.hp + 6);
    }
  } else if (offer.kind === 'rescue') {
    const bagged = run.roster.find((h) => h.harvested);
    if (!bagged) return false;
    bagged.harvested = false;
    bagged.hp = Math.max(4, Math.round(bagged.maxHp * 0.7));
    if (run.activeSquadUids.length < 4 && !run.activeSquadUids.includes(bagged.uid)) {
      run.activeSquadUids.push(bagged.uid);
    }
  }

  run.seeds -= offer.cost;
  offer.purchased = true;
  return true;
}

export function applyBattleOutcomeToRun(
  run: RunState,
  battle: BattleState,
  meta: MetaProgress
): void {
  // Sync remaining garden items
  run.items = { ...battle.items };

  // Count defeated enemies
  const defeatedEnemies = battle.units.filter((u) => u.team === 'enemy' && !u.alive).length;
  run.enemiesDefeated += defeatedEnemies;

  // Sync player heroes HP & Harvested status!
  for (const unit of battle.units) {
    if (unit.team !== 'player' || !unit.rosterUid) continue;
    const hero = run.roster.find((h) => h.uid === unit.rosterUid);
    if (!hero) continue;
    if (!unit.alive) {
      hero.hp = 0;
      hero.harvested = true;
    } else {
      hero.hp = Math.min(hero.maxHp, Math.max(1, unit.hp));
      hero.harvested = false;
    }
  }

  // Apply Barn Rescue freed allies
  for (const uid of battle.rescuedHeroUids) {
    const hero = run.roster.find((h) => h.uid === uid);
    if (hero) {
      hero.harvested = false;
      const battleCopy = battle.units.find((u) => u.rosterUid === uid);
      hero.hp = battleCopy && battleCopy.alive
        ? Math.max(1, battleCopy.hp)
        : Math.max(4, Math.round(hero.maxHp * 0.7));
    }
  }
  for (const bpId of battle.rescuedNewBlueprintIds) {
    if (!run.roster.some((h) => h.blueprintId === bpId)) {
      const bonusHp = meta.unlocks.heirloomSoil ? 2 : 0;
      const newHero = createHeroFromBlueprint(bpId, bonusHp);
      run.roster.push(newHero);
      if (run.activeSquadUids.length < 4) {
        run.activeSquadUids.push(newHero.uid);
      }
    }
  }

  // Keep activeSquadUids pointing to non-harvested heroes (auto-sub from bench if needed!)
  run.activeSquadUids = run.activeSquadUids.filter((uid) => {
    const h = run.roster.find((r) => r.uid === uid);
    return Boolean(h && !h.harvested);
  });
  for (const benchHero of run.roster) {
    if (run.activeSquadUids.length >= 4) break;
    if (!benchHero.harvested && !run.activeSquadUids.includes(benchHero.uid)) {
      run.activeSquadUids.push(benchHero.uid);
    }
  }

  const node = run.nodes.find((n) => n.id === run.currentNodeId);

  if (battle.status === 'defeat' || run.activeSquadUids.length === 0) {
    run.status = 'defeat';
    const consolationSeeds = Math.max(10, run.seeds + defeatedEnemies * 2);
    meta.heirloomSeeds += consolationSeeds;
    meta.runsPlayed += 1;
    saveMetaProgress(meta);
    clearSavedRun();
    return;
  }

  // Victory!
  run.battlesWon += 1;
  if (node) {
    node.completed = true;
    if (!run.completedNodeIds.includes(node.id)) {
      run.completedNodeIds.push(node.id);
    }
  }

  // Light post-battle breather heal (+3 HP for surviving heroes)
  for (const hero of run.roster) {
    if (!hero.harvested) {
      hero.hp = Math.min(hero.maxHp, hero.hp + 3);
    }
  }

  if (node?.type === 'boss' && !isFinalAct(run)) {
    // Act cleared: bank the boss reward, then continue on the next act's map.
    const reward = generateRewardForNode(run, node);
    run.seeds += reward.seedsEarned;
    if (reward.itemGrant) {
      run.items[reward.itemGrant.itemId] =
        (run.items[reward.itemGrant.itemId] ?? 0) + reward.itemGrant.count;
    }
    advanceToNextAct(run);
    run.pendingReward = reward;
    run.status = 'reward';
    return;
  }

  if (node?.type === 'boss') {
    run.seeds += 40;
    run.status = 'victory';
    meta.heirloomSeeds += run.seeds;
    meta.runsPlayed += 1;
    meta.runsWon += 1;
    saveMetaProgress(meta);
    clearSavedRun();
    return;
  }

  if (node) {
    const reward = generateRewardForNode(run, node);
    run.seeds += reward.seedsEarned;
    if (reward.itemGrant) {
      run.items[reward.itemGrant.itemId] =
        (run.items[reward.itemGrant.itemId] ?? 0) + reward.itemGrant.count;
    }
    run.pendingReward = reward;
    run.status = 'reward';
  } else {
    run.status = 'map';
  }
}

function getTierForGraftCount(count: number): PromotionTier {
  if (count >= 2) return 'heirloom';
  if (count >= 1) return 'ripe';
  return 'seedling';
}

export const MAX_GRAFTS_PER_HERO = 2;

export function applyGraftToHero(run: RunState, heroUid: string, graftId: string): boolean {
  const hero = run.roster.find((h) => h.uid === heroUid && !h.harvested);
  const graft = GRAFT_REGISTRY[graftId];
  if (!hero || !graft) return false;
  if (hero.graftIds.includes(graftId) || hero.graftIds.length >= MAX_GRAFTS_PER_HERO) return false;

  const prevTier = hero.tier;
  hero.graftIds.push(graftId);

  if (graft.bonusMaxHp) {
    hero.maxHp += graft.bonusMaxHp;
    hero.hp = Math.min(hero.maxHp, hero.hp + graft.bonusMaxHp);
  }
  if (graft.bonusAttack) hero.weapon = { ...hero.weapon, damage: hero.weapon.damage + graft.bonusAttack };
  if (graft.bonusCoverDamage) {
    hero.weapon = { ...hero.weapon, coverDamage: hero.weapon.coverDamage + graft.bonusCoverDamage };
  }
  if (graft.bonusDash) hero.dashDamage += graft.bonusDash;
  if (graft.bonusJump) hero.jumpRange += graft.bonusJump;
  if (graft.bonusMove) hero.moveRange += graft.bonusMove;

  // Automatic Promotion Tier bonus (Seedling -> Ripe -> Heirloom!)
  const newTier = getTierForGraftCount(hero.graftIds.length);
  if (newTier !== prevTier) {
    hero.tier = newTier;
    if (newTier === 'ripe') {
      hero.maxHp += 2;
      hero.hp = Math.min(hero.maxHp, hero.hp + 2);
      hero.weapon = { ...hero.weapon, damage: hero.weapon.damage + 1 };
    } else if (newTier === 'heirloom') {
      hero.maxHp += 3;
      hero.hp = Math.min(hero.maxHp, hero.hp + 3);
      hero.weapon = { ...hero.weapon, damage: hero.weapon.damage + 1 };
      hero.moveRange += 1;
    }
  }

  if (run.pendingReward) {
    run.pendingReward.claimedGraft = true;
  }
  return true;
}

export function claimRelicReward(run: RunState, relicId: string): boolean {
  if (run.relicIds.includes(relicId)) return false;
  run.relicIds.push(relicId);
  if (run.pendingReward) {
    run.pendingReward.claimedRelic = true;
  }
  return true;
}

export function claimRecruitReward(run: RunState, blueprintId: string, bonusMaxHp = 0): boolean {
  if (run.roster.some((h) => h.blueprintId === blueprintId)) return false;
  const hero = createHeroFromBlueprint(blueprintId, bonusMaxHp);
  run.roster.push(hero);
  if (run.activeSquadUids.length < 4) {
    run.activeSquadUids.push(hero.uid);
  }
  if (run.pendingReward) {
    run.pendingReward.claimedRecruit = true;
  }
  return true;
}

export function toggleHeroActiveSquad(run: RunState, heroUid: string): boolean {
  const hero = run.roster.find((h) => h.uid === heroUid && !h.harvested);
  if (!hero) return false;
  const idx = run.activeSquadUids.indexOf(heroUid);
  if (idx >= 0) {
    if (run.activeSquadUids.length <= 1) return false; // Must keep at least 1 active
    run.activeSquadUids.splice(idx, 1);
    return true;
  }
  if (run.activeSquadUids.length >= 4) return false;
  run.activeSquadUids.push(heroUid);
  return true;
}

export function finishRewardsAndReturnToMap(run: RunState): void {
  run.pendingReward = null;
  run.status = 'map';
}
