/**
 * Headless run simulator for balance checks. A bot plays whole runs through the real
 * engine: it travels the board, fights every battle and takes the first reward on offer.
 * In battle it dashes, moves to cover and high ground, steps off boss warning tiles, and
 * uses abilities and items. It still plays worse than a person (no team jumps, overwatch,
 * skill perks or market shopping), so read its numbers as a comparison between stages,
 * maps and heat levels, and treat its run win rate as a floor for what a player gets.
 */
import { RECRUITABLE_BLUEPRINT_IDS } from '../data/produce';
import { runEnemyUnitTurn } from '../engine/ai';
import {
  createBattleFromMap,
  executeAbility,
  executeAttack,
  executeDash,
  executeItem,
  executeMove,
  finishPrepPhase,
  getAbilityTargetTiles,
  getItemTargetTiles,
  startPhase,
  switchActiveWeapon,
} from '../engine/battle';
import { forecastAttack } from '../engine/combat';
import { battleRng, difficultyFor } from '../engine/difficulty';
import { leaveEvent, openEventNode, resolveEventChoice } from '../engine/events';
import { ITEM_REGISTRY } from '../data/items';
import { chebyshev, evaluateCover, manhattan, tileAt } from '../engine/grid';
import { ACTS, createRng, HARVEST_BELL_LIMIT, type Rng } from '../engine/mapgen';
import { computeDashOptions, computeMovableTiles } from '../engine/pathfinding';
import {
  applyBattleOutcomeToRun,
  applyGraftToHero,
  applyTravelCardMove,
  claimLoreReward,
  claimRecruitReward,
  claimRelicReward,
  claimShrineBlessing,
  claimWeaponReward,
  createNewRun,
  defaultMetaProgress,
  finishRewardsAndReturnToMap,
  forgeHeroWeapon,
  getBoardPathsForCard,
  leaveForgeNode,
  openForgeNode,
  openLoreNode,
  openShrineNode,
  openVaultNode,
} from '../engine/run';
import type { BattleState, BattleUnit, GridPos, NodeType, RunState } from '../engine/types';

export const MAX_BATTLE_TURNS = 30;
const MAX_BOARD_STEPS = 200;

export interface BattleLog {
  act: number;
  floor: number;
  nodeType: NodeType;
  mapId: string;
  outcome: 'victory' | 'defeat' | 'stalled';
  turns: number;
  /** Squad HP as a share of max HP, before and after the battle. */
  hpBefore: number;
  hpAfter: number;
  heroesLost: number;
}

export interface RunLog {
  seed: number;
  heat: number;
  victory: boolean;
  /** 1-based act the run ended in. */
  endedAct: number;
  battlesWon: number;
  battles: BattleLog[];
}

function squadHpShare(run: RunState): number {
  const squad = run.roster.filter((h) => run.activeSquadUids.includes(h.uid));
  const max = squad.reduce((s, h) => s + h.maxHp, 0);
  return max > 0 ? squad.reduce((s, h) => s + (h.harvested ? 0 : h.hp), 0) / max : 0;
}

/* ---------------------------------- Battle bot ---------------------------------- */

function bestAttackFrom(state: BattleState, hero: BattleUnit, pos: GridPos): { target: GridPos; score: number } | null {
  const original = hero.pos;
  hero.pos = pos;
  let best: { target: GridPos; score: number } | null = null;
  const consider = (target: GridPos, bonus: number) => {
    const fc = forecastAttack(state, hero, target);
    if (!fc.canAttack) return;
    let score = (fc.hitChance / 100) * fc.finalDamage * 10 + bonus;
    if (fc.isLethal) score += 35;
    if (!best || score > best.score) best = { target, score };
  };
  for (const enemy of state.units) {
    if (enemy.team === 'enemy' && enemy.alive) consider(enemy.pos, enemy.isBoss ? 6 : 0);
  }
  if (state.objective === 'smash_crates') {
    for (let y = 0; y < state.height; y++) {
      for (let x = 0; x < state.width; x++) {
        if (state.tiles[y][x].cover?.isObjectiveCrate) consider({ x, y }, 22);
      }
    }
  }
  if (!best) {
    // Nothing to shoot: break the rescue cage, objective supply crate, or a crate an enemy is hiding behind.
    for (let y = 0; y < state.height; y++) {
      for (let x = 0; x < state.width; x++) {
        const cov = state.tiles[y][x].cover;
        if (cov?.isObjectiveCage || cov?.isObjectiveCrate) consider({ x, y }, 8);
      }
    }
    for (const enemy of state.units) {
      if (enemy.team !== 'enemy' || !enemy.alive) continue;
      const cover = evaluateCover(state, pos, enemy.pos).coverPos;
      if (cover) consider(cover, 0);
    }
  }
  hero.pos = original;
  return best;
}

/** Where the bot heads when it has nothing to shoot: the gate on gate maps, crates on sabotage maps, else the nearest enemy. */
function goalTiles(state: BattleState): GridPos[] {
  if ((state.objective === 'reach_gate' || state.objective === 'escort') && state.gateTiles.length > 0) {
    return state.gateTiles;
  }
  if (state.objective === 'smash_crates') {
    const crates: GridPos[] = [];
    for (let y = 0; y < state.height; y++) {
      for (let x = 0; x < state.width; x++) {
        if (state.tiles[y][x].cover?.isObjectiveCrate) crates.push({ x, y });
      }
    }
    if (crates.length > 0) return crates;
  }
  return state.units.filter((u) => u.team === 'enemy' && u.alive).map((u) => u.pos);
}

/** How safe a tile is: cover against each nearby farmer, plus high ground. Mirrors the farmers' own AI. */
function safetyScore(state: BattleState, pos: GridPos): number {
  let score = 0;
  for (const enemy of state.units) {
    if (enemy.team !== 'enemy' || !enemy.alive) continue;
    const level = evaluateCover(state, enemy.pos, pos).level;
    if (level === 'full') score += 9;
    else if (level === 'half') score += 5;
    // Standing next to a brawler invites a dash.
    if (manhattan(enemy.pos, pos) <= 1 && enemy.weapon.arc === 'melee') score -= 4;
  }
  score += (tileAt(state, pos)?.elevation ?? 0) * 4.5;
  score = Math.min(24, score);
  // Never end the turn on a red boss warning tile.
  for (const tel of state.bossTelegraphs ?? []) {
    if (tel.tiles.some((t) => t.x === pos.x && t.y === pos.y)) score -= tel.damage * 12;
  }
  return score;
}

function aliveUnits(state: BattleState, team: 'player' | 'enemy'): BattleUnit[] {
  return state.units.filter((u) => u.team === team && u.alive && !u.isEscortCart);
}

/** Best tile for an area effect: most farmers caught, and never one that catches an ally. */
function bestBlastTile(state: BattleState, tiles: GridPos[], radius: number): GridPos | null {
  const enemies = aliveUnits(state, 'enemy');
  const allies = aliveUnits(state, 'player');
  let best: GridPos | null = null;
  let bestHits = 0;
  for (const t of tiles) {
    if (allies.some((a) => chebyshev(a.pos, t) <= radius)) continue;
    const hits = enemies.filter((e) => chebyshev(e.pos, t) <= radius).length;
    if (hits > bestHits) {
      bestHits = hits;
      best = t;
    }
  }
  return best;
}

/** Use the hero's ability, or failing that an item, when it clearly helps. */
function useSkillOrItem(state: BattleState, hero: BattleUnit): void {
  if (hero.isEscortCart || hero.actions.hasUsedSkill) return;
  const enemies = aliveUnits(state, 'enemy');
  const allies = aliveUnits(state, 'player');
  const ab = hero.ability;
  const tiles = getAbilityTargetTiles(state, hero);
  if (ab && tiles.length > 0) {
    const nearestEnemy = Math.min(99, ...enemies.map((e) => manhattan(e.pos, hero.pos)));
    if (ab.targetType === 'self' || ab.targetType === 'aoe_self') {
      // Buffs and shields are worth it once the fight is close.
      if (nearestEnemy <= 6 && executeAbility(state, hero.id, hero.pos)) return;
    } else if (ab.targetType === 'ally') {
      const hurt = allies
        .filter((a) => tiles.some((t) => t.x === a.pos.x && t.y === a.pos.y) && a.maxHp - a.hp >= Math.min(3, ab.heal ?? 3))
        .sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp)[0];
      if (hurt && executeAbility(state, hero.id, hurt.pos)) return;
    } else if (ab.targetType === 'enemy') {
      const target = enemies
        .filter((e) => tiles.some((t) => t.x === e.pos.x && t.y === e.pos.y))
        .sort((a, b) => a.hp - b.hp)[0];
      if (target && executeAbility(state, hero.id, target.pos)) return;
    } else {
      const target = bestBlastTile(state, tiles, ab.aoeRadius ?? 0);
      if (target && executeAbility(state, hero.id, target)) return;
    }
  }
  for (const itemId of Object.keys(state.items)) {
    if ((state.items[itemId] ?? 0) <= 0) continue;
    const item = ITEM_REGISTRY[itemId];
    if (!item) continue;
    const itemTiles = getItemTargetTiles(state, hero, itemId);
    if (itemTiles.length === 0) continue;
    if (item.targetType === 'ally') {
      const hurt = allies
        .filter((a) => itemTiles.some((t) => t.x === a.pos.x && t.y === a.pos.y) && a.maxHp - a.hp >= (item.heal ?? 0))
        .sort((a, b) => a.hp - b.hp)[0];
      if (hurt && executeItem(state, hero.id, itemId, hurt.pos)) return;
    } else {
      const target = bestBlastTile(state, itemTiles, item.aoeRadius ?? 0);
      const caught = target ? enemies.filter((e) => chebyshev(e.pos, target) <= (item.aoeRadius ?? 0)).length : 0;
      if (target && caught >= 2 && executeItem(state, hero.id, itemId, target)) return;
    }
  }
}

function playHeroTurn(state: BattleState, hero: BattleUnit, rng: Rng): void {
  const holding = state.objective === 'survive';
  if (!hero.isEscortCart) {
    const dashes = computeDashOptions(state, hero);
    if (dashes.length > 0) {
      dashes.sort((a, b) => b.damage - a.damage);
      executeDash(state, hero.id, dashes[0].enemyId);
      if (state.status !== 'ongoing' || !hero.alive) return;
    }
  }

  const goals = goalTiles(state);
  const candidates: GridPos[] = [hero.pos, ...Array.from(computeMovableTiles(state, hero).values()).map((n) => n.pos)];
  let bestPos = hero.pos;
  let bestScore = -Infinity;
  for (const pos of candidates) {
    const tile = tileAt(state, pos);
    if (!tile) continue;
    const attack = hero.isEscortCart ? null : bestAttackFrom(state, hero, pos);
    const goalDist = goals.length > 0 ? Math.min(...goals.map((g) => manhattan(pos, g))) : 0;
    const gateRun = state.objective === 'reach_gate' || hero.isEscortCart;
    let score = attack ? attack.score : 0;
    if (hero.isEscortCart) {
      score -= goalDist * 4;
    } else if (holding) {
      // Holding the patch: sit in cover and let the farmers come.
      score += safetyScore(state, pos) * 1.5 + Math.min(goalDist, 5);
    } else {
      score += safetyScore(state, pos);
      score -= goalDist * (attack && !gateRun ? 0.5 : 4);
    }
    if (score > bestScore) {
      bestScore = score;
      bestPos = pos;
    }
  }
  if (bestPos !== hero.pos) executeMove(state, hero.id, bestPos);
  if (state.status !== 'ongoing' || !hero.alive || hero.isEscortCart) return;
  useSkillOrItem(state, hero);
  if (state.status !== 'ongoing' || !hero.alive) return;
  let attack = bestAttackFrom(state, hero, hero.pos);
  if (hero.primaryWeapon && hero.secondaryWeapon) {
    const origSlot = hero.activeWeaponSlot ?? 'primary';
    const altSlot = origSlot === 'primary' ? 'secondary' : 'primary';
    const origWeapon = hero.weapon;
    hero.weapon = altSlot === 'secondary' ? hero.secondaryWeapon : hero.primaryWeapon;
    const altAttack = bestAttackFrom(state, hero, hero.pos);
    hero.weapon = origWeapon;
    if (altAttack && (!attack || altAttack.score > attack.score + 2)) {
      if (switchActiveWeapon(state, hero.id, altSlot)) {
        attack = altAttack;
      }
    }
  }
  if (attack) executeAttack(state, hero.id, attack.target, rng);
}

/** Play one battle to the end with the bot. Returns the turn it ended on. */
export function playBattle(state: BattleState, rng: Rng): 'victory' | 'defeat' | 'stalled' {
  if (state.prepPhase) finishPrepPhase(state);
  while (state.status === 'ongoing' && state.turn <= MAX_BATTLE_TURNS) {
    for (const hero of state.units.filter((u) => u.team === 'player' && u.alive)) {
      if (state.status !== 'ongoing') break;
      playHeroTurn(state, hero, rng);
    }
    if (state.status !== 'ongoing') break;
    startPhase(state, 'enemy');
    for (const id of state.units.filter((u) => u.team === 'enemy' && u.alive).map((u) => u.id)) {
      if (state.status !== 'ongoing') break;
      runEnemyUnitTurn(state, id, rng);
    }
    if (state.status !== 'ongoing') break;
    startPhase(state, 'player');
  }
  state.pendingEvents.length = 0;
  return state.status === 'ongoing' ? 'stalled' : state.status;
}

/* ----------------------------------- Run bot ----------------------------------- */

function takeRewards(run: RunState): void {
  const reward = run.pendingReward;
  if (reward) {
    const living = run.roster.filter((h) => !h.harvested);
    if (!reward.claimedGraft && reward.graftChoices.length > 0) {
      for (const hero of living) {
        if (applyGraftToHero(run, hero.uid, reward.graftChoices[0])) break;
      }
    }
    if (!reward.claimedRelic && reward.relicChoices.length > 0) claimRelicReward(run, reward.relicChoices[0]);
    if (!reward.claimedRecruit && reward.recruitChoices.length > 0) {
      claimRecruitReward(run, reward.recruitChoices[0], run.recruitBonusHp ?? 0);
    }
    if (!reward.claimedWeapon && (reward.weaponChoices?.length ?? 0) > 0) {
      claimWeaponReward(run, reward.weaponChoices![0]);
    }
  }
  finishRewardsAndReturnToMap(run);
}

/**
 * Pick a travel card and destination. The bot paces itself to arrive at the boss just as
 * the Harvest Bell is about to ring, so it fights about as many battles as a player would,
 * and detours to a shrine, vault or market when the squad is hurt.
 */
function pickMove(run: RunState, rng: Rng): { cardId: string; destId: string } | null {
  const options: Array<{ cardId: string; destId: string; stage: number; type: NodeType }> = [];
  for (const card of run.travelHand ?? []) {
    for (const destId of getBoardPathsForCard(run, card.id).keys()) {
      const node = run.nodes.find((n) => n.id === destId);
      if (node) options.push({ cardId: card.id, destId, stage: node.stage, type: node.type });
    }
  }
  if (options.length === 0) return null;
  const curStage = run.nodes.find((n) => n.id === run.currentNodeId)?.stage ?? 0;
  const bossStage = Math.max(...run.nodes.map((n) => n.stage));
  const turnsLeft = Math.max(1, (run.harvestBellLimit ?? HARVEST_BELL_LIMIT) - (run.boardTurn ?? 0));
  const idealStage = curStage + (bossStage - curStage) / turnsLeft;
  const hurt = squadHpShare(run) < 0.6;
  const restful = (t: NodeType) => t === 'shrine' || t === 'vault' || t === 'shop';
  const cost = (o: (typeof options)[number]) =>
    Math.abs(o.stage - idealStage) + (o.type === 'boss' && turnsLeft > 1 ? 3 : 0) - (hurt && restful(o.type) ? 1.5 : 0);
  const best = Math.min(...options.map(cost));
  const pool = options.filter((o) => cost(o) - best < 1e-9);
  return pool[Math.floor(rng() * pool.length)];
}

export function simulateRun(seed: number, heat = 0): RunLog {
  const meta = defaultMetaProgress();
  const run = createNewRun(meta, 'spring', seed, heat);
  const rng = createRng((seed ^ 0x9e3779b9) >>> 0);
  const battles: BattleLog[] = [];

  for (let step = 0; step < MAX_BOARD_STEPS && run.status === 'map'; step++) {
    const move = pickMove(run, rng);
    if (!move) break;
    const node = run.nodes.find((n) => n.id === move.destId)!;
    if (!applyTravelCardMove(run, move.cardId, move.destId)) break;

    if (node.type === 'shrine') {
      openShrineNode(run, node.id);
      claimShrineBlessing(run, squadHpShare(run) < 0.7 ? 'heal' : 'blessing');
      run.pendingShrine = null;
      if (!run.completedNodeIds.includes(node.id)) run.completedNodeIds.push(node.id);
      run.status = 'map';
      continue;
    }
    if (node.type === 'lore') {
      openLoreNode(run, node.id, meta);
      claimLoreReward(run, 'voucher');
      continue;
    }
    if (node.type === 'forge') {
      openForgeNode(run, node.id);
      const lead = run.roster.find((h) => !h.harvested && run.activeSquadUids.includes(h.uid));
      if (lead) forgeHeroWeapon(run, lead.uid, 'primary', 'elemental', true);
      leaveForgeNode(run);
      continue;
    }
    if (node.type === 'vault' || node.type === 'shop' || node.type === 'armory') {
      openVaultNode(run, node.id);
      if (!run.completedNodeIds.includes(node.id)) run.completedNodeIds.push(node.id);
      takeRewards(run);
      continue;
    }
    if (node.type === 'event') {
      openEventNode(run, node.id);
      resolveEventChoice(run, 0);
      leaveEvent(run);
      run.status = 'map';
      continue;
    }
    if (!node.mapId) continue;

    run.currentNodeId = node.id;
    run.status = 'battle';
    const heroes = run.activeSquadUids
      .map((uid) => run.roster.find((h) => h.uid === uid && !h.harvested))
      .filter((h): h is NonNullable<typeof h> => Boolean(h));
    const harvested = run.roster.find((h) => h.harvested);
    const owned = new Set(run.roster.map((h) => h.blueprintId));
    const fallbackBp = RECRUITABLE_BLUEPRINT_IDS.find((bp) => !owned.has(bp)) ?? 'carrot';
    const act = run.act;
    const hpBefore = squadHpShare(run);
    const lostBefore = run.roster.filter((h) => h.harvested).length;
    const battle = createBattleFromMap(
      node.mapId,
      heroes,
      run.relicIds,
      run.items,
      harvested ? { hero: harvested } : { blueprintId: fallbackBp },
      {
        rng: battleRng(run.seed, node.id),
        difficulty: difficultyFor(run.act, node.stage, node.type, heat),
        theme: ACTS[run.act]?.theme,
        enablePrepPhase: false,
        harvestHeat: heat,
        nextBattleBuff: run.nextBattleBuff ?? null,
        bossEmpowered: node.type === 'boss' && (run.boardTurn ?? 0) > (run.harvestBellLimit ?? HARVEST_BELL_LIMIT),
      }
    );
    battle.seasonId = run.seasonId ?? ACTS[run.act]?.id ?? 'spring';
    run.nextBattleBuff = null;
    const outcome = playBattle(battle, rng);
    const turns = battle.turn;
    // A battle the bot cannot finish counts as lost, and is reported separately.
    if (outcome === 'stalled') battle.status = 'defeat';
    applyBattleOutcomeToRun(run, battle, meta);
    battles.push({
      act: act + 1,
      floor: node.stage,
      nodeType: node.type,
      mapId: node.mapId,
      outcome,
      turns,
      hpBefore,
      hpAfter: outcome === 'victory' ? squadHpShare(run) : 0,
      heroesLost: run.roster.filter((h) => h.harvested).length - lostBefore,
    });
    if ((run.status as RunState['status']) === 'reward') takeRewards(run);
  }

  return {
    seed,
    heat,
    victory: run.status === 'victory',
    endedAct: run.act + 1,
    battlesWon: run.battlesWon,
    battles,
  };
}

/* ------------------------------------ Report ------------------------------------ */

export interface BalanceRow {
  label: string;
  battles: number;
  winRate: number;
  avgTurns: number;
  /** Average share of squad HP lost in won battles. */
  avgHpLost: number;
  stalled: number;
}

export interface BalanceReport {
  heat: number;
  runs: number;
  runWinRate: number;
  avgBattlesWon: number;
  /** Share of runs that ended in each act (1-based), index 0 = Act 1. */
  endedInAct: number[];
  byStage: BalanceRow[];
  /** Same numbers per battle map, most played first: shows which maps the bot struggles on. */
  byMap: BalanceRow[];
}

function row(label: string, logs: BattleLog[]): BalanceRow {
  const wins = logs.filter((b) => b.outcome === 'victory');
  return {
    label,
    battles: logs.length,
    winRate: logs.length > 0 ? wins.length / logs.length : 0,
    avgTurns: logs.length > 0 ? logs.reduce((s, b) => s + b.turns, 0) / logs.length : 0,
    avgHpLost: wins.length > 0 ? wins.reduce((s, b) => s + Math.max(0, b.hpBefore - b.hpAfter), 0) / wins.length : 0,
    stalled: logs.filter((b) => b.outcome === 'stalled').length,
  };
}

export function buildBalanceReport(logs: RunLog[], heat: number): BalanceReport {
  const all = logs.flatMap((l) => l.battles);
  const byStage: BalanceRow[] = [];
  for (let act = 1; act <= ACTS.length; act++) {
    const inAct = all.filter((b) => b.act === act);
    const floors = [...new Set(inAct.filter((b) => b.nodeType !== 'boss').map((b) => b.floor))].sort((a, b) => a - b);
    for (const floor of floors) {
      byStage.push(row(`Act ${act} floor ${floor}`, inAct.filter((b) => b.floor === floor && b.nodeType !== 'boss')));
    }
    const boss = inAct.filter((b) => b.nodeType === 'boss');
    if (boss.length > 0) byStage.push(row(`Act ${act} boss`, boss));
  }
  return {
    heat,
    runs: logs.length,
    runWinRate: logs.length > 0 ? logs.filter((l) => l.victory).length / logs.length : 0,
    avgBattlesWon: logs.length > 0 ? logs.reduce((s, l) => s + l.battlesWon, 0) / logs.length : 0,
    endedInAct: ACTS.map((_, i) => (logs.length > 0 ? logs.filter((l) => l.endedAct === i + 1).length / logs.length : 0)),
    byStage,
    byMap: [...new Set(all.map((b) => b.mapId))]
      .map((mapId) => row(mapId, all.filter((b) => b.mapId === mapId)))
      .sort((a, b) => b.battles - a.battles),
  };
}
