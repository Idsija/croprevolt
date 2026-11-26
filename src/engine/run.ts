import { ALL_GRAFT_IDS, GRAFT_REGISTRY } from '../data/grafts';
import { ALL_ITEM_IDS, ITEM_REGISTRY } from '../data/items';
import { PRODUCE_BLUEPRINTS, RECRUITABLE_BLUEPRINT_IDS, STARTER_BLUEPRINT_IDS } from '../data/produce';
import { MAP_TEMPLATES } from '../data/maps';
import { ALL_RELIC_IDS } from '../data/relics';
import { canUnlockPerk, getXpToNextLevel, MAX_HERO_LEVEL, SKILL_PERKS } from '../data/skills';
import {
  ALL_ALT_WEAPON_IDS,
  ALT_WEAPON_REGISTRY,
  buildScaledWeaponForHero,
  STARTER_UNLOCKED_WEAPONS,
} from '../data/weapons';
import { battleRng, getHeatSeedMultiplier, heatRunRules, MAX_HARVEST_HEAT } from './difficulty';
import { loadDailyState, recordDailyFinish } from './daily';
import { recordRunHistory } from './history';
import { dailyKeyFor, dailySeedFor, recordRunScore } from './score';
import {
  ACTS,
  actIndexForSeason,
  actRng,
  drawTravelHand,
  generateActNodes,
  getReachableBoardTargets,
  HARVEST_BELL_LIMIT,
  randomSeed,
  startNodeId,
} from './mapgen';
import type {
  RunPerks,
  BattleState,
  HeroLevelUpSummary,
  MarketOffer,
  MetaProgress,
  NodeType,
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
    maxHeatUnlocked: 1,
    selectedHeat: 0,
    unlocks: {
      extraItemSatchel: false,
      heirloomSoil: false,
      starterRelic: false,
      seedPouch: false,
      honeyReserve: false,
      seasonedSeedlings: false,
      restfulCamp: false,
      marketCoupon: false,
      patientBell: false,
      graftReroll: false,
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
  seedPouch: {
    cost: 30,
    title: 'Seed Pouch',
    desc: 'Begin every run with 15 seeds to spend at the first market.',
  },
  honeyReserve: {
    cost: 35,
    title: 'Honey Reserve',
    desc: 'Begin every run with +1 Honey Pot.',
  },
  seasonedSeedlings: {
    cost: 60,
    title: 'Seasoned Seedlings',
    desc: 'Every starter hero begins with +1 skill point.',
  },
  restfulCamp: {
    cost: 70,
    title: 'Restful Camp',
    desc: 'Surviving heroes heal +1 extra HP after every won battle.',
  },
  marketCoupon: {
    cost: 80,
    title: 'Market Coupon',
    desc: 'Every market price is 15% lower.',
  },
  patientBell: {
    cost: 100,
    title: 'Patient Bell',
    desc: 'The Harvest Bell rings 1 turn later in every act.',
  },
  graftReroll: {
    cost: 120,
    title: 'Second Opinion',
    desc: 'Once per run, reroll the graft stickers a reward offers.',
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
    equippedWeaponId: bp.weapon.id,
    ability: { ...bp.ability, appliesStatus: bp.ability.appliesStatus ? { ...bp.ability.appliesStatus } : undefined },
    graftIds: [],
    level: 1,
    xp: 0,
    skillPoints: 1,
    perkIds: [],
    tier: 'seedling',
    harvested: false,
    color: bp.color,
    accentColor: bp.accentColor,
  };
}

/**
 * Today's daily run: one shared seed per UTC day, Heat 0 and the standard loadout
 * (no Seed Shed perks), so every player starts the same garden on equal footing.
 */
export function createDailyRun(now: Date = new Date()): RunState {
  const dailyKey = dailyKeyFor(now);
  const run = createNewRun(defaultMetaProgress(), 'spring', dailySeedFor(dailyKey), 0);
  run.mode = 'daily';
  run.dailyKey = dailyKey;
  return run;
}

export function createNewRun(
  meta: MetaProgress,
  seasonId: SeasonId = 'spring',
  seed: number = randomSeed(),
  harvestHeat?: number
): RunState {
  const hpBonus = meta.unlocks.heirloomSoil ? 2 : 0;
  // Starter squad: Stitch, Crisphead, Snap-Pea & Zestia active + Spudnik, Truffle Boar, Habanero on bench!
  const roster = STARTER_BLUEPRINT_IDS.map((id) => createHeroFromBlueprint(id, hpBonus));
  if (meta.unlocks.seasonedSeedlings) {
    for (const hero of roster) hero.skillPoints += 1;
  }
  const perks: RunPerks = {
    breatherBonus: meta.unlocks.restfulCamp ? 1 : 0,
    marketPriceMult: meta.unlocks.marketCoupon ? 0.85 : 1,
    bellBonus: meta.unlocks.patientBell ? 1 : 0,
    graftRerollsLeft: meta.unlocks.graftReroll ? 1 : 0,
  };
  const relicIds = meta.unlocks.starterRelic ? ['rich_loam'] : [];
  const items: Record<string, number> = {
    watering_can: meta.unlocks.extraItemSatchel ? 2 : 1,
    fertilizer_bomb: meta.unlocks.extraItemSatchel ? 2 : 1,
    honey_pot: meta.unlocks.honeyReserve ? 2 : 1,
  };
  const act = actIndexForSeason(seasonId);
  const resolvedHeat = Math.max(
    0,
    Math.min(MAX_HARVEST_HEAT, Math.floor(harvestHeat ?? meta.selectedHeat ?? 0))
  );
  const rng = actRng(seed >>> 0, act);
  const nodes = generateActNodes(act, rng, mapDisplayName);
  const startId = nodes.find((n) => n.type === 'start')?.id ?? startNodeId(act);

  const run: RunState = {
    id: `run_${Date.now()}`,
    seasonId: ACTS[act].id,
    seasonName: actTitle(act),
    act,
    seed: seed >>> 0,
    harvestHeat: resolvedHeat,
    unlockedWeaponIds: [...STARTER_UNLOCKED_WEAPONS],
    recruitBonusHp: hpBonus,
    seenEventIds: [],
    pendingEvent: null,
    pendingShrine: null,
    nodes,
    currentNodeId: startId,
    completedNodeIds: [startId],
    travelHand: drawTravelHand(rng),
    boardTurn: 0,
    harvestBellLimit: HARVEST_BELL_LIMIT - heatRunRules(resolvedHeat).bellTurnsLost + perks.bellBonus,
    perks,
    nextBattleBuff: null,
    roster,
    activeSquadUids: roster.slice(0, 4).map((h) => h.uid),
    relicIds,
    items,
    seeds: (act > 0 ? 8 * act : 0) + (meta.unlocks.seedPouch ? 15 : 0),
    battlesWon: 0,
    enemiesDefeated: 0,
    pendingReward: null,
    status: 'map',
  };
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

/** Move the run on to the next act's freshly generated watercolor board (after beating an act boss). */
export function advanceToNextAct(run: RunState): void {
  const next = Math.min(run.act + 1, ACTS.length - 1);
  run.act = next;
  run.seasonId = ACTS[next].id;
  run.seasonName = actTitle(next);
  const rng = actRng(run.seed, next);
  run.nodes = generateActNodes(next, rng, mapDisplayName);
  const startId = run.nodes.find((n) => n.type === 'start')?.id ?? startNodeId(next);
  run.completedNodeIds = [startId];
  run.currentNodeId = startId;
  run.travelHand = drawTravelHand(rng);
  run.boardTurn = 0;
  run.harvestBellLimit =
    HARVEST_BELL_LIMIT - heatRunRules(run.harvestHeat).bellTurnsLost + (run.perks?.bellBonus ?? 0);
  run.pendingShrine = null;
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
  if (typeof run.harvestHeat !== 'number') {
    run.harvestHeat = 0;
  }
  if (!Array.isArray(run.unlockedWeaponIds)) {
    run.unlockedWeaponIds = [...STARTER_UNLOCKED_WEAPONS];
  }
  if (!Array.isArray(run.travelHand) || run.travelHand.length === 0) {
    run.travelHand = drawTravelHand(actRng(run.seed, run.act));
  }
  if (typeof run.boardTurn !== 'number') {
    run.boardTurn = Math.max(0, (run.completedNodeIds?.length ?? 1) - 1);
  }
  if (typeof run.harvestBellLimit !== 'number') {
    run.harvestBellLimit = HARVEST_BELL_LIMIT;
  }
  // If migrating a legacy save without boardgame coordinates, ensure currentNodeId points cleanly
  if (run.nodes.length > 0 && typeof run.nodes[0].boardX !== 'number') {
    const fresh = generateActNodes(run.act, actRng(run.seed, run.act), mapDisplayName);
    const startId = fresh.find((n) => n.type === 'start')?.id ?? startNodeId(run.act);
    run.nodes = fresh;
    run.currentNodeId = startId;
    run.completedNodeIds = [startId];
  }
  if (Array.isArray(run.roster)) {
    for (const hero of run.roster) {
      if (typeof hero.level !== 'number') hero.level = 1;
      if (typeof hero.xp !== 'number') hero.xp = 0;
      if (typeof hero.skillPoints !== 'number') hero.skillPoints = 1;
      if (!Array.isArray(hero.perkIds)) hero.perkIds = [];
      // Refund any legacy shared perk IDs that aren't in the new character-specific SKILL_PERKS!
      const validPerks = hero.perkIds.filter((pid) => Boolean(SKILL_PERKS[pid]));
      const refunded = hero.perkIds.length - validPerks.length;
      if (refunded > 0) {
        hero.perkIds = validPerks;
        hero.skillPoints += refunded;
      }
      if (!hero.equippedWeaponId) hero.equippedWeaponId = hero.weapon.id;
    }
  }
  return run;
}

export function getBoardPathsForCard(run: RunState, cardId?: string | null): Map<string, string[]> {
  const hand = run.travelHand && run.travelHand.length > 0 ? run.travelHand : drawTravelHand();
  const card = (cardId ? hand.find((c) => c.id === cardId) : undefined) ?? hand[0];
  if (!card) return new Map();
  const curId =
    run.currentNodeId ??
    run.completedNodeIds[run.completedNodeIds.length - 1] ??
    run.nodes.find((n) => n.type === 'start')?.id ??
    null;
  return getReachableBoardTargets(run.nodes, curId, card);
}

export function getAvailableNextNodeIds(run: RunState, cardId?: string | null): string[] {
  if (cardId) {
    return Array.from(getBoardPathsForCard(run, cardId).keys());
  }
  const hand = run.travelHand && run.travelHand.length > 0 ? run.travelHand : [];
  if (hand.length > 0) {
    const union = new Set<string>();
    for (const card of hand) {
      for (const destId of getBoardPathsForCard(run, card.id).keys()) {
        union.add(destId);
      }
    }
    return Array.from(union);
  }
  const curId = run.currentNodeId ?? run.completedNodeIds[run.completedNodeIds.length - 1];
  const curNode = run.nodes.find((n) => n.id === curId);
  if (!curNode) return run.nodes.filter((n) => n.stage <= 1 && n.type !== 'start').map((n) => n.id);
  return [...curNode.nextIds, ...(curNode.shortcutIds ?? [])].filter(
    (id) => !run.completedNodeIds.includes(id)
  );
}

/**
 * Plays a Travel Hand Card to march along the seasonal watercolor boardgame track,
 * applying the card's travel perk (+2 HP, +3 Seeds, or Next-Battle Boost),
 * advancing the Harvest Bell turn counter, and drawing a fresh 3-card hand!
 */
export function applyTravelCardMove(
  run: RunState,
  cardId: string,
  destNodeId: string,
  // Seeded per board turn, so a daily run deals everyone the same travel hands.
  rng: () => number = battleRng(run.seed, `hand:${run.act}:${run.boardTurn ?? 0}`)
): string[] | null {
  const hand = run.travelHand ?? [];
  const card = hand.find((c) => c.id === cardId);
  if (!card) return null;
  const paths = getBoardPathsForCard(run, card.id);
  const path = paths.get(destNodeId);
  if (!path) return null;

  if (card.bonus === 'heal2') {
    for (const h of run.roster) {
      if (!h.harvested) h.hp = Math.min(h.maxHp, h.hp + 2);
    }
  } else if (card.bonus === 'seeds3') {
    run.seeds += 3;
  } else if (card.bonus === 'boost') {
    run.nextBattleBuff = { ...(run.nextBattleBuff ?? {}), boost: true };
  }

  run.boardTurn = (run.boardTurn ?? 0) + 1;
  run.travelHand = drawTravelHand(rng);
  return path;
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

function getLockedWeaponPool(run: RunState): string[] {
  const unlocked = new Set(run.unlockedWeaponIds ?? []);
  const rosterSpecies = new Set(run.roster.map((h) => h.species));
  const preferred = ALL_ALT_WEAPON_IDS.filter(
    (id) => !unlocked.has(id) && rosterSpecies.has(ALT_WEAPON_REGISTRY[id].species)
  );
  if (preferred.length > 0) return preferred;
  return ALL_ALT_WEAPON_IDS.filter((id) => !unlocked.has(id));
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

  // Offer 1 locked Alternate Weapon for the Armory!
  const lockedWeapons = getLockedWeaponPool(run);
  if (lockedWeapons.length > 0) {
    const wid = pickRandomDistinct(lockedWeapons, 1, rng)[0];
    const entry = ALT_WEAPON_REGISTRY[wid];
    const ownerName = PRODUCE_BLUEPRINTS[entry.species]?.name ?? entry.species;
    offers.push({
      id: `mkt_weapon_${wid}`,
      kind: 'weapon',
      title: `${entry.weapon.name} (${ownerName})`,
      desc: `${entry.tagline} · ${entry.weapon.description}`,
      icon: '⚔️',
      cost: entry.cost,
      weaponUnlockId: wid,
      purchased: false,
    });
  }

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

  const priceMult = heatRunRules(run.harvestHeat).marketPriceMult * (run.perks?.marketPriceMult ?? 1);
  if (priceMult !== 1) {
    for (const offer of offers) offer.cost = Math.ceil(offer.cost * priceMult);
  }
  return offers;
}

/**
 * Second Opinion perk: swap the graft stickers of the open reward for a fresh set, once per
 * run. Seeded, so reloading can't fish for a better reroll.
 */
export function rerollGraftChoices(run: RunState): boolean {
  const reward = run.pendingReward;
  if (!reward || reward.claimedGraft || reward.graftChoices.length === 0) return false;
  if (!run.perks || run.perks.graftRerollsLeft <= 0) return false;
  const rng = battleRng(run.seed, `reroll:${run.currentNodeId}:${run.battlesWon}`);
  const fresh = ALL_GRAFT_IDS.filter((id) => !reward.graftChoices.includes(id));
  if (fresh.length < reward.graftChoices.length) return false;
  reward.graftChoices = pickRandomDistinct(fresh, reward.graftChoices.length, rng);
  run.perks.graftRerollsLeft -= 1;
  return true;
}

export function generateRewardForNode(
  run: RunState,
  node: SeasonNode,
  // Seeded per node, so the same seed (e.g. a daily run) offers everyone the same rewards.
  rng: () => number = battleRng(run.seed, `reward:${node.id}`)
): RewardBundle {
  const ownedRelics = new Set(run.relicIds);
  const availableRelics = ALL_RELIC_IDS.filter((id) => !ownedRelics.has(id));
  const ownedBlueprints = new Set(run.roster.map((h) => h.blueprintId));
  const recruitPool = RECRUITABLE_BLUEPRINT_IDS.filter((id) => !ownedBlueprints.has(id));
  const lockedWeapons = getLockedWeaponPool(run);

  if (node.type === 'vault' || node.type === 'shop' || node.type === 'armory') {
    const picks = node.type === 'armory' ? [] : pickRandomDistinct(recruitPool, 3, rng);
    return {
      seedsEarned: node.type === 'shop' ? 8 : node.type === 'armory' ? 10 : 6,
      graftChoices: [],
      relicChoices: [],
      recruitChoices: picks,
      weaponChoices: [],
      freeHealAmount: node.type === 'vault' ? 6 : 3,
      itemGrant: node.type === 'vault' ? { itemId: 'watering_can', count: 1 } : undefined,
      marketOffers: generateMarketOffers(run, rng),
      claimedGraft: true,
      claimedRelic: true,
      claimedRecruit: picks.length === 0,
      claimedWeapon: true,
    };
  }

  const grantsRelic = node.type === 'elite' || node.type === 'escape' || node.type === 'barn_rescue';
  const grantsWeapon = (node.type === 'elite' || node.type === 'boss') && lockedWeapons.length > 0;
  const weaponChoices = grantsWeapon ? pickRandomDistinct(lockedWeapons, 2, rng) : [];
  const grantsRecruit =
    recruitPool.length > 0 && (node.type === 'skirmish' || node.type === 'barn_rescue');
  const recruitPicks = grantsRecruit ? pickRandomDistinct(recruitPool, 2, rng) : [];
  const randomItem =
    node.type === 'elite'
      ? 'fertilizer_bomb'
      : ALL_ITEM_IDS[Math.floor(rng() * ALL_ITEM_IDS.length)];
  const swiftBossBonus =
    node.type === 'boss' && (run.boardTurn ?? 0) <= (run.harvestBellLimit ?? HARVEST_BELL_LIMIT)
      ? 15
      : 0;

  return {
    seedsEarned:
      (node.type === 'elite' ? 24 : node.type === 'escape' ? 16 : node.type === 'boss' ? 40 : 12) +
      swiftBossBonus,
    graftChoices: pickRandomDistinct(ALL_GRAFT_IDS, node.type === 'elite' ? 4 : 3, rng),
    relicChoices: grantsRelic ? pickRandomDistinct(availableRelics, 3, rng) : [],
    recruitChoices: recruitPicks,
    weaponChoices,
    itemGrant: { itemId: randomItem, count: node.type === 'elite' ? 2 : 1 },
    freeHealAmount: node.type === 'escape' ? 4 : 3,
    claimedGraft: false,
    claimedRelic: !grantsRelic || availableRelics.length === 0,
    claimedRecruit: recruitPicks.length === 0,
    claimedWeapon: weaponChoices.length === 0,
  };
}

export function openVaultNode(run: RunState, nodeId: string): boolean {
  const node = run.nodes.find((n) => n.id === nodeId);
  if (!node || (node.type !== 'vault' && node.type !== 'shop' && node.type !== 'armory')) return false;
  run.currentNodeId = nodeId;
  const freeHeal = node.type === 'vault' ? 6 : 3;
  // Heal squad at Vault / Market / Armory immediately!
  for (const hero of run.roster) {
    if (!hero.harvested) {
      hero.hp = Math.min(hero.maxHp, hero.hp + freeHeal);
    }
  }
  const bundle = generateRewardForNode(run, node);
  if (node.type === 'armory') {
    // Armory Wagon stocks up to 2 extra unlocked Alternate Weapons + gives a free weapon choice if locked weapons remain!
    const locked = getLockedWeaponPool(run);
    const armoryChoices = pickRandomDistinct(locked, 2, battleRng(run.seed, `armory:${node.id}`));
    bundle.weaponChoices = armoryChoices;
    bundle.claimedWeapon = armoryChoices.length === 0;
    bundle.graftChoices = [];
    bundle.claimedGraft = true;
  }
  run.pendingReward = bundle;
  if (run.pendingReward.itemGrant) {
    const { itemId, count } = run.pendingReward.itemGrant;
    run.items[itemId] = (run.items[itemId] ?? 0) + count;
  }
  run.seeds += run.pendingReward.seedsEarned;
  node.completed = true;
  if (!run.completedNodeIds.includes(nodeId)) {
    run.completedNodeIds.push(nodeId);
  }
  run.status = node.type === 'shop' || node.type === 'armory' ? 'shop' : 'vault';
  return true;
}

export function openShrineNode(run: RunState, nodeId: string): boolean {
  const node = run.nodes.find((n) => n.id === nodeId);
  if (!node || node.type !== 'shrine') return false;
  run.currentNodeId = nodeId;
  run.pendingShrine = { nodeId, claimed: false };
  run.status = 'shrine';
  return true;
}

export function claimShrineBlessing(
  run: RunState,
  choice: 'heal' | 'blessing' | 'seeds'
): boolean {
  if (!run.pendingShrine || run.pendingShrine.claimed) return false;
  const nodeId = run.pendingShrine.nodeId;
  if (choice === 'heal') {
    for (const hero of run.roster) {
      if (!hero.harvested) {
        hero.hp = hero.maxHp;
      }
    }
  } else if (choice === 'blessing') {
    run.nextBattleBuff = {
      boost: true,
      shield: true,
      moveBonus: (run.nextBattleBuff?.moveBonus ?? 0) + 1,
    };
  } else if (choice === 'seeds') {
    run.seeds += 14;
  }

  run.pendingShrine.claimed = true;
  const node = run.nodes.find((n) => n.id === nodeId);
  if (node) node.completed = true;
  if (!run.completedNodeIds.includes(nodeId)) {
    run.completedNodeIds.push(nodeId);
  }
  run.pendingShrine = null;
  run.status = 'map';
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
  } else if (offer.kind === 'weapon' && offer.weaponUnlockId) {
    unlockRunWeapon(run, offer.weaponUnlockId);
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

export function awardBattleXpAndLevels(
  run: RunState,
  battle: BattleState,
  nodeType: NodeType = 'skirmish'
): { xpEarned: number; levelUps: HeroLevelUpSummary[] } {
  const defeated = battle.units.filter((u) => u.team === 'enemy' && !u.alive).length;
  const baseXp =
    nodeType === 'boss' ? 95 : nodeType === 'elite' ? 70 : nodeType === 'barn_rescue' ? 55 : 48;
  const xpEarned = baseXp + defeated * 8;
  const activeSet = new Set(run.activeSquadUids);
  const levelUps: HeroLevelUpSummary[] = [];

  for (const hero of run.roster) {
    if (hero.harvested) continue;
    const gain = activeSet.has(hero.uid) ? xpEarned : Math.round(xpEarned * 0.65);
    const oldLevel = hero.level;
    let bonusHp = 0;
    let bonusAttack = 0;
    let spGained = 0;

    if (hero.level < MAX_HERO_LEVEL) {
      hero.xp += gain;
      while (hero.level < MAX_HERO_LEVEL && hero.xp >= getXpToNextLevel(hero.level)) {
        hero.xp -= getXpToNextLevel(hero.level);
        hero.level += 1;
        hero.skillPoints += 1;
        spGained += 1;
        hero.maxHp += 2;
        hero.hp = Math.min(hero.maxHp, hero.hp + 2);
        bonusHp += 2;
        if (hero.level === 3 || hero.level === 5) {
          hero.weapon = { ...hero.weapon, damage: hero.weapon.damage + 1 };
          bonusAttack += 1;
        }
      }
      if (hero.level >= MAX_HERO_LEVEL) {
        hero.xp = 0;
      }
    }

    if (hero.level > oldLevel) {
      levelUps.push({
        heroUid: hero.uid,
        heroName: hero.name,
        blueprintId: hero.blueprintId,
        species: hero.species,
        oldLevel,
        newLevel: hero.level,
        skillPointsGained: spGained,
        bonusHp,
        bonusAttack,
      });
    }
  }

  return { xpEarned, levelUps };
}

/** A run just ended: put it on the boards, the streak, the history, and pay out achievements. */
function finishRunRecords(run: RunState, meta: MetaProgress): void {
  recordRunScore(run);
  recordDailyFinish(run);
  const earned = recordRunHistory(run, loadDailyState().streak.best);
  run.earnedAchievementIds = earned.map((a) => a.id);
  meta.heirloomSeeds += earned.reduce((sum, a) => sum + a.seeds, 0);
}

export function applyBattleOutcomeToRun(
  run: RunState,
  battle: BattleState,
  meta: MetaProgress
): void {
  // Sync remaining garden items
  run.items = { ...battle.items };

  run.battleTurns = (run.battleTurns ?? 0) + Math.max(1, battle.turn);

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
    const heatMult = getHeatSeedMultiplier(run.harvestHeat ?? 0);
    const consolationSeeds = Math.round(Math.max(10, run.seeds + defeatedEnemies * 2) * heatMult);
    meta.heirloomSeeds += consolationSeeds;
    meta.runsPlayed += 1;
    finishRunRecords(run, meta);
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

  // Light post-battle breather heal (+3 HP for surviving heroes, +1 from Heat 3)
  const breatherHeal = heatRunRules(run.harvestHeat).breatherHeal + (run.perks?.breatherBonus ?? 0);
  for (const hero of run.roster) {
    if (!hero.harvested) {
      hero.hp = Math.min(hero.maxHp, hero.hp + breatherHeal);
    }
  }

  // Award XP & Level-Ups to the squad!
  const { xpEarned, levelUps } = awardBattleXpAndLevels(run, battle, node?.type ?? 'skirmish');

  if (node?.type === 'boss' && !isFinalAct(run)) {
    // Act cleared: bank the boss reward, then continue on the next act's map.
    const reward = generateRewardForNode(run, node);
    reward.xpEarned = xpEarned;
    reward.levelUps = levelUps;
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
    const heatMult = getHeatSeedMultiplier(run.harvestHeat ?? 0);
    run.seeds = Math.round((run.seeds + 40) * heatMult);
    run.status = 'victory';
    meta.heirloomSeeds += run.seeds;
    meta.runsPlayed += 1;
    meta.runsWon += 1;
    const nextHeat = Math.min(MAX_HARVEST_HEAT, (run.harvestHeat ?? 0) + 1);
    meta.maxHeatUnlocked = Math.max(meta.maxHeatUnlocked ?? 1, nextHeat);
    finishRunRecords(run, meta);
    saveMetaProgress(meta);
    clearSavedRun();
    return;
  }

  if (node) {
    const reward = generateRewardForNode(run, node);
    reward.xpEarned = xpEarned;
    reward.levelUps = levelUps;
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

export function unlockRunWeapon(run: RunState, weaponId: string): boolean {
  if (!ALT_WEAPON_REGISTRY[weaponId]) return false;
  if (!Array.isArray(run.unlockedWeaponIds)) run.unlockedWeaponIds = [];
  if (run.unlockedWeaponIds.includes(weaponId)) return false;
  run.unlockedWeaponIds.push(weaponId);
  return true;
}

export function claimWeaponReward(run: RunState, weaponId: string): boolean {
  if (!ALT_WEAPON_REGISTRY[weaponId]) return false;
  unlockRunWeapon(run, weaponId);
  // Auto-equip if that species is in the roster and still using their base weapon? Leave choice to Armory!
  if (run.pendingReward) {
    run.pendingReward.claimedWeapon = true;
  }
  return true;
}

export function equipHeroWeapon(run: RunState, heroUid: string, weaponId: string): boolean {
  const hero = run.roster.find((h) => h.uid === heroUid && !h.harvested);
  if (!hero) return false;
  const bp = PRODUCE_BLUEPRINTS[hero.blueprintId];
  if (!bp) return false;

  if (weaponId === bp.weapon.id) {
    hero.weapon = buildScaledWeaponForHero(hero, bp.weapon);
    hero.equippedWeaponId = bp.weapon.id;
    return true;
  }

  const altEntry = ALT_WEAPON_REGISTRY[weaponId];
  if (!altEntry || altEntry.species !== hero.species) return false;
  if (!(run.unlockedWeaponIds ?? []).includes(weaponId)) return false;

  hero.weapon = buildScaledWeaponForHero(hero, altEntry.weapon);
  hero.equippedWeaponId = altEntry.weapon.id;
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

export function unlockHeroPerk(run: RunState, heroUid: string, perkId: string): boolean {
  const hero = run.roster.find((h) => h.uid === heroUid && !h.harvested);
  const perk = SKILL_PERKS[perkId];
  if (!hero || !perk) return false;
  if (!canUnlockPerk(hero.perkIds, hero.skillPoints, perkId, hero.species)) return false;

  hero.skillPoints -= perk.cost;
  hero.perkIds.push(perkId);

  const e = perk.effects;
  if (e.bonusHp) {
    hero.maxHp += e.bonusHp;
    hero.hp = Math.min(hero.maxHp, hero.hp + e.bonusHp);
  }
  if (e.bonusMove) hero.moveRange += e.bonusMove;
  if (e.bonusJump) hero.jumpRange += e.bonusJump;
  if (e.bonusAttack || e.bonusRange) {
    hero.weapon = {
      ...hero.weapon,
      damage: hero.weapon.damage + (e.bonusAttack ?? 0),
      maxRange: hero.weapon.maxRange + (e.bonusRange ?? 0),
    };
  }

  return true;
}

/**
 * Free 1-click Skill Tree Respec! Refunds every spent SP on this hero and cleanly
 * reverses all permanent stat deltas from previously unlocked perks.
 */
export function respecHeroPerks(run: RunState, heroUid: string): boolean {
  const hero = run.roster.find((h) => h.uid === heroUid && !h.harvested);
  if (!hero || hero.perkIds.length === 0) return false;

  let refundedSp = 0;
  let hpDelta = 0;
  let moveDelta = 0;
  let jumpDelta = 0;
  let atkDelta = 0;
  let rangeDelta = 0;

  for (const pid of hero.perkIds) {
    const def = SKILL_PERKS[pid];
    if (!def) continue;
    refundedSp += def.cost;
    hpDelta += def.effects.bonusHp ?? 0;
    moveDelta += def.effects.bonusMove ?? 0;
    jumpDelta += def.effects.bonusJump ?? 0;
    atkDelta += def.effects.bonusAttack ?? 0;
    rangeDelta += def.effects.bonusRange ?? 0;
  }

  hero.perkIds = [];
  hero.skillPoints += refundedSp;
  hero.maxHp = Math.max(6, hero.maxHp - hpDelta);
  hero.hp = Math.min(hero.maxHp, Math.max(1, hero.hp));
  hero.moveRange = Math.max(2, hero.moveRange - moveDelta);
  hero.jumpRange = Math.max(2, hero.jumpRange - jumpDelta);
  if (atkDelta > 0 || rangeDelta > 0) {
    hero.weapon = {
      ...hero.weapon,
      damage: Math.max(1, hero.weapon.damage - atkDelta),
      maxRange: Math.max(hero.weapon.minRange, hero.weapon.maxRange - rangeDelta),
    };
  }
  return true;
}

export function finishRewardsAndReturnToMap(run: RunState): void {
  run.pendingReward = null;
  run.status = 'map';
}
