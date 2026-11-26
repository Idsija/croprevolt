import { ENEMY_BLUEPRINTS } from '../data/enemies';
import { ITEM_REGISTRY } from '../data/items';
import { MAP_TEMPLATES } from '../data/maps';
import { PRODUCE_BLUEPRINTS } from '../data/produce';
import { computePushDirection, forecastAttack } from './combat';
import {
  MAX_ENEMIES_PER_BATTLE,
  REGULAR_ENEMY_POOL,
  TUNING,
  type BattleDifficulty,
} from './difficulty';
import type { Rng } from './mapgen';
import {
  chebyshev,
  createCover,
  getNeighbors,
  inBounds,
  isHazardLiquid,
  manhattan,
  posKey,
  samePos,
  tileAt,
  unitAt,
} from './grid';
import {
  applyStatusToUnit,
  getCooldownForUnit,
  getMaxDashesForUnit,
  getMaxOverwatchCharges,
  getUnitPerkEffects,
  hasGraft,
  hasRelic,
  hasStatus,
  spendMove,
} from './hooks';
import {
  computeDashOptions,
  computeMovableTiles,
  computeTeamJumpOptions,
} from './pathfinding';
import type {
  BattleState,
  BoardTheme,
  BattleUnit,
  GridPos,
  MapTemplate,
  RosterHero,
  StatusKind,
  Tile,
} from './types';

/**
 * Optional run-time variation for a battle. Without it a map is built exactly as authored
 * (tests and fixed scenarios rely on that).
 */
export interface BattleSetup {
  rng?: Rng;
  difficulty?: BattleDifficulty;
  /** Palette override, e.g. Autumn reusing Spring layouts. */
  theme?: BoardTheme;
  /** Enable Mario+Rabbids Pre-Battle Tactical Prep Phase (swap spawn positions & bench heroes). */
  enablePrepPhase?: boolean;
  /** Harvest Heat ascension level (0-5). */
  harvestHeat?: number;
  /** One-battle buff granted by a Boardgame Travel Card or Watering Shrine! */
  nextBattleBuff?: { boost?: boolean; shield?: boolean; moveBonus?: number } | null;
  /** True when the player lingered past the Harvest Bell — empowers the Act Boss! */
  bossEmpowered?: boolean;
}

function mirrorTemplate(map: MapTemplate): MapTemplate {
  const fx = (x: number) => map.width - 1 - x;
  const flip = (p: GridPos): GridPos => ({ x: fx(p.x), y: p.y });
  return {
    ...map,
    tiles: map.tiles.map((t) => ({ ...t, x: fx(t.x) })),
    playerSpawns: map.playerSpawns.map(flip),
    enemySpawns: map.enemySpawns.map((e) => ({ ...e, x: fx(e.x) })),
    gateTiles: map.gateTiles?.map(flip),
    cagePos: map.cagePos ? flip(map.cagePos) : undefined,
    burrowPairs: map.burrowPairs?.map(([a, b]) => [flip(a), flip(b)]),
    escortStartPos: map.escortStartPos ? flip(map.escortStartPos) : undefined,
  };
}

function shuffle<T>(items: T[], rng: Rng): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Re-roll regular farmhands and add reinforcements in the enemy half of the board. */
function varyEnemySpawns(
  map: MapTemplate,
  rng: Rng,
  difficulty: BattleDifficulty
): MapTemplate['enemySpawns'] {
  const spawns = map.enemySpawns.map((spawn) => {
    if (ENEMY_BLUEPRINTS[spawn.blueprintId]?.isBoss) return { ...spawn };
    if (rng() >= TUNING.rerollChance) return { ...spawn };
    const pool = REGULAR_ENEMY_POOL.filter((id) => id !== spawn.blueprintId);
    return { ...spawn, blueprintId: pool[Math.floor(rng() * pool.length)] };
  });

  const room = Math.max(0, MAX_ENEMIES_PER_BATTLE - spawns.length);
  const extra = Math.min(room, difficulty.extraEnemies);
  if (extra === 0) return spawns;

  const blocked = new Set<string>([
    ...map.tiles.filter((t) => t.cover || (t.terrain && isHazardLiquid(t.terrain))).map((t) => posKey(t)),
    ...spawns.map((sp) => posKey(sp)),
    ...map.playerSpawns.map(posKey),
    ...(map.gateTiles ?? []).map(posKey),
    ...(map.escortStartPos ? [posKey(map.escortStartPos)] : []),
  ]);
  const playerTop = Math.min(...map.playerSpawns.map((p) => p.y));
  const candidates: GridPos[] = [];
  for (let y = 0; y < map.height; y++) {
    // Reinforcements arrive in the enemy half and never within 3 rows of the squad.
    if (y > playerTop - 4 || y > Math.floor(map.height / 2)) continue;
    for (let x = 0; x < map.width; x++) {
      if (!blocked.has(posKey({ x, y }))) candidates.push({ x, y });
    }
  }
  for (const pos of shuffle(candidates, rng).slice(0, extra)) {
    const blueprintId = REGULAR_ENEMY_POOL[Math.floor(rng() * REGULAR_ENEMY_POOL.length)];
    spawns.push({ blueprintId, x: pos.x, y: pos.y });
  }
  return spawns;
}

function applyDifficultyToEnemy(unit: BattleUnit, difficulty: BattleDifficulty): void {
  unit.maxHp = Math.ceil(unit.maxHp * difficulty.hpMult);
  unit.hp = unit.maxHp;
  if (difficulty.damageBonus > 0) {
    unit.weapon.damage += difficulty.damageBonus;
    if (unit.ability?.damage) unit.ability.damage += difficulty.damageBonus;
  }
}

function promoteToVeteran(unit: BattleUnit): void {
  unit.isVeteran = true;
  unit.title = `Veteran ${unit.title}`;
  unit.maxHp = Math.ceil(unit.maxHp * 1.5);
  unit.hp = unit.maxHp;
  unit.weapon.damage += 1;
  applyStatusToUnit(unit, 'shield', 1);
}

function emptyActions() {
  return {
    hasMoved: false,
    moveSpent: 0,
    hasDashed: false,
    dashesUsed: 0,
    dashedEnemyIds: [] as string[],
    hasJumped: false,
    hasAttacked: false,
    hasUsedSkill: false,
    overwatchCharges: 0,
  };
}

export function createBattleUnitFromHero(hero: RosterHero, pos: GridPos): BattleUnit {
  const unit: BattleUnit = {
    id: `hero_${hero.uid}`,
    rosterUid: hero.uid,
    blueprintId: hero.blueprintId,
    team: 'player',
    name: hero.name,
    title: hero.title,
    visualKind: hero.species,
    family: hero.family,
    isAnimal: hero.isAnimal,
    coopPassive: hero.coopPassive,
    ignoresMud: hero.ignoresMud,
    livingHalfCover: hero.livingHalfCover,
    launchpadCoop: hero.launchpadCoop,
    pos: { ...pos },
    facing: 'right',
    hp: Math.max(1, hero.hp),
    maxHp: hero.maxHp,
    moveRange: hero.moveRange,
    jumpRange: hero.jumpRange,
    dashDamage: hero.dashDamage,
    dashKnockback: hero.dashKnockback,
    dashStatus: hero.dashStatus ? { ...hero.dashStatus } : undefined,
    weapon: { ...hero.weapon, appliesStatus: hero.weapon.appliesStatus ? { ...hero.weapon.appliesStatus } : undefined },
    ability: { ...hero.ability, appliesStatus: hero.ability.appliesStatus ? { ...hero.ability.appliesStatus } : undefined },
    abilityCooldown: 0,
    graftIds: [...hero.graftIds],
    level: hero.level ?? 1,
    perkIds: [...(hero.perkIds ?? [])],
    tier: hero.tier,
    statuses: [],
    actions: emptyActions(),
    tempAttackBonus: 0,
    alive: true,
    color: hero.color,
    accentColor: hero.accentColor,
  };
  if (hero.livingHalfCover) {
    applyStatusToUnit(unit, 'shield', 1);
  }
  const fx = getUnitPerkEffects(unit);
  if (fx.startShieldTurns > 0) {
    applyStatusToUnit(unit, 'shield', fx.startShieldTurns);
  }
  if (fx.startBoostTurns > 0) {
    applyStatusToUnit(unit, 'boosted', fx.startBoostTurns);
  }
  return unit;
}

export function createEscortSeedCart(pos: GridPos): BattleUnit {
  return {
    id: 'escort_seed_cart',
    blueprintId: 'seed_cart',
    team: 'player',
    name: 'Golden Seed Cart',
    title: 'Escort Convoy',
    visualKind: 'seed_cart',
    family: 'neutral',
    isEscortCart: true,
    pos: { ...pos },
    facing: 'right',
    hp: 16,
    maxHp: 16,
    moveRange: 0,
    jumpRange: 0,
    dashDamage: 0,
    weapon: {
      id: 'cart_bell',
      name: 'Brass Bell',
      arc: 'melee',
      minRange: 1,
      maxRange: 1,
      damage: 0,
      coverDamage: 0,
      description: 'Autonomous Heirloom Seed Cart — rolls 2 tiles north each turn!',
    },
    abilityCooldown: 99,
    graftIds: [],
    tier: 'heirloom',
    statuses: [],
    actions: {
      hasMoved: true,
      hasDashed: true,
      dashesUsed: 1,
      dashedEnemyIds: [],
      hasJumped: true,
      hasAttacked: true,
      hasUsedSkill: true,
      overwatchCharges: 0,
    },
    tempAttackBonus: 0,
    alive: true,
    color: '#f5cc42',
    accentColor: '#8d5524',
  };
}

export function createBattleUnitFromEnemy(blueprintId: string, index: number, pos: GridPos): BattleUnit {
  const bp = ENEMY_BLUEPRINTS[blueprintId];
  if (!bp) throw new Error(`Unknown enemy blueprint: ${blueprintId}`);
  const isHeavyDiggerVariant = blueprintId === 'digger' && index % 2 === 1;
  const enemyUnit: BattleUnit = {
    id: `enemy_${blueprintId}_${index}`,
    blueprintId: bp.id,
    team: 'enemy',
    name: isHeavyDiggerVariant ? 'Burt Mudboots' : bp.name,
    title: isHeavyDiggerVariant ? 'Heavy Spade Brute' : bp.title,
    visualKind: isHeavyDiggerVariant ? 'digger_heavy' : bp.archetype,
    family: bp.family,
    isBoss: bp.isBoss,
    pos: { ...pos },
    facing: pos.x < 3 ? 'right' : 'left',
    hp: bp.maxHp,
    maxHp: bp.maxHp,
    moveRange: bp.moveRange,
    jumpRange: 0,
    dashDamage: bp.dashDamage,
    dashKnockback: bp.dashKnockback ?? (bp.isBoss && bp.archetype === 'tractor' ? 1 : undefined),
    weapon: { ...bp.weapon, appliesStatus: bp.weapon.appliesStatus ? { ...bp.weapon.appliesStatus } : undefined },
    ability: bp.ability
      ? { ...bp.ability, appliesStatus: bp.ability.appliesStatus ? { ...bp.ability.appliesStatus } : undefined }
      : undefined,
    abilityCooldown: 0,
    graftIds: [],
    tier: 'seedling',
    statuses: [],
    actions: emptyActions(),
    tempAttackBonus: 0,
    alive: true,
    color: bp.color,
    accentColor: bp.accentColor,
  };
  if (bp.isBoss) {
    applyStatusToUnit(enemyUnit, 'shield', 1);
  }
  if (bp.startsShielded) {
    applyStatusToUnit(enemyUnit, 'shield', 2);
  }
  return enemyUnit;
}

export function createBattleFromMap(
  mapId: string,
  activeHeroes: RosterHero[],
  relicIds: string[],
  items: Record<string, number>,
  captiveInfo?: { hero?: RosterHero; blueprintId?: string },
  setup?: BattleSetup
): BattleState {
  const template = MAP_TEMPLATES[mapId];
  if (!template) throw new Error(`Unknown map template: ${mapId}`);
  let map: MapTemplate = template;
  if (setup?.rng) {
    if (setup.rng() < 0.5) map = mirrorTemplate(map);
    if (setup.difficulty) {
      map = { ...map, enemySpawns: varyEnemySpawns(map, setup.rng, setup.difficulty) };
    }
  }

  const harvestHeat = setup?.harvestHeat ?? 0;

  const tiles: Tile[][] = [];
  for (let y = 0; y < map.height; y++) {
    const row: Tile[] = [];
    for (let x = 0; x < map.width; x++) {
      row.push({ x, y, terrain: 'grass', elevation: 0, cover: null });
    }
    tiles.push(row);
  }

  for (const spec of map.tiles) {
    if (spec.y < 0 || spec.y >= map.height || spec.x < 0 || spec.x >= map.width) continue;
    const tile = tiles[spec.y][spec.x];
    if (spec.terrain) tile.terrain = spec.terrain;
    if (spec.elevation !== undefined) tile.elevation = spec.elevation;
    if (spec.cover) {
      const captiveId =
        spec.cover === 'cage'
          ? captiveInfo?.hero
            ? `hero:${captiveInfo.hero.uid}`
            : `bp:${captiveInfo?.blueprintId ?? 'carrot'}`
          : undefined;
      tile.cover = createCover(
        spec.cover,
        captiveId,
        spec.cover === 'cage' ? captiveInfo?.hero : undefined
      );
      // Harvest Heat 3+: wooden crates start brittle (-2 HP)!
      if (harvestHeat >= 3 && tile.cover.kind === 'crate') {
        tile.cover.hp = Math.max(2, tile.cover.hp - 2);
      }
    }
  }

  // Initialize Collapsible Wooden Bridges (detect whether bridge spans lava or water)
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const t = tiles[y][x];
      if (t.terrain === 'bridge') {
        const adjLava = [
          tiles[y]?.[x - 1],
          tiles[y]?.[x + 1],
          tiles[y - 1]?.[x],
          tiles[y + 1]?.[x],
        ].some((n) => n?.terrain === 'lava');
        t.bridgeHp = 5;
        t.bridgeMaxHp = 5;
        t.bridgeOver = adjLava ? 'lava' : 'water';
      }
    }
  }

  const units: BattleUnit[] = [];
  activeHeroes.slice(0, map.playerSpawns.length).forEach((hero, i) => {
    const spawnPos = map.playerSpawns[i];
    const unit = createBattleUnitFromHero(hero, spawnPos);
    unit.facing = spawnPos.x >= map.width / 2 ? 'left' : 'right';
    // Apply battle-start relics & grafts
    if (hasRelic(relicIds, 'rich_loam')) {
      unit.hp = Math.min(unit.maxHp, unit.hp + 2);
    }
    if (hasGraft(unit, 'pumpkin_rind')) {
      applyStatusToUnit(unit, 'shield', 1);
    }
    if (setup?.nextBattleBuff?.boost) {
      applyStatusToUnit(unit, 'boosted', 2);
    }
    if (setup?.nextBattleBuff?.shield) {
      applyStatusToUnit(unit, 'shield', 2);
    }
    if (setup?.nextBattleBuff?.moveBonus) {
      unit.moveRange += setup.nextBattleBuff.moveBonus;
    }
    units.push(unit);
  });

  // Spawn Golden Seed Cart on Escort missions!
  if (map.objective === 'escort' && map.escortStartPos) {
    units.push(createEscortSeedCart(map.escortStartPos));
  }

  let diggerCounter = 0;
  map.enemySpawns.forEach((spawn, i) => {
    const variantIdx = spawn.blueprintId === 'digger' ? diggerCounter++ : i;
    const enemy = createBattleUnitFromEnemy(spawn.blueprintId, variantIdx, { x: spawn.x, y: spawn.y });
    enemy.id = `enemy_${spawn.blueprintId}_${i}`;
    enemy.facing = spawn.x < map.width / 2 ? 'right' : 'left';
    if (setup?.difficulty) applyDifficultyToEnemy(enemy, setup.difficulty);
    if (enemy.isBoss && setup?.bossEmpowered) {
      enemy.maxHp = Math.ceil(enemy.maxHp * 1.15);
      enemy.hp = enemy.maxHp;
      applyStatusToUnit(enemy, 'shield', 2);
    }
    units.push(enemy);
  });

  if (setup?.difficulty && setup.difficulty.veterans > 0) {
    const regulars = units.filter((u) => u.team === 'enemy' && !u.isBoss);
    const rng = setup.rng ?? Math.random;
    for (const unit of shuffle(regulars, rng).slice(0, setup.difficulty.veterans)) {
      promoteToVeteran(unit);
      unit.weapon.damage += setup.difficulty.veteranDamageBonus ?? 0;
    }
  }

  const prepPhase = Boolean(setup?.enablePrepPhase);

  return {
    mapId: map.id,
    mapName: map.name,
    theme: setup?.theme ?? map.theme ?? 'spring',
    objective: map.objective,
    objectiveLabel: map.objectiveLabel,
    width: map.width,
    height: map.height,
    tiles,
    units,
    turn: 1,
    phase: 'player',
    status: 'ongoing',
    prepPhase,
    playerSpawnPositions: map.playerSpawns.map((p) => ({ ...p })),
    surviveTurns: map.surviveTurns ?? (map.objective === 'survive' ? 4 : undefined),
    harvestHeat,
    relicIds: [...relicIds],
    items: { ...items },
    gateTiles: map.gateTiles ? map.gateTiles.map((g) => ({ ...g })) : [],
    burrowPairs: map.burrowPairs
      ? map.burrowPairs.map(([a, b]) => [{ ...a }, { ...b }])
      : [],
    bossPhase: 1,
    bossTelegraphs: [],
    rescuedHeroUids: [],
    rescuedNewBlueprintIds: [],
    combatLog: [`Battle started: ${map.name} — ${map.objectiveLabel}`],
    pendingEvents: [
      {
        type: 'banner',
        text: prepPhase ? 'TACTICAL PREP — POSITION YOUR SQUAD!' : 'PRODUCE PHASE — TURN 1',
        tone: 'player',
      },
    ],
    undoSnapshot: null,
  };
}

/**
 * Pre-Battle Tactical Prep: swap a hero onto another glowing spawn tile (swapping if occupied).
 */
export function swapPrepHeroPositions(
  state: BattleState,
  fromPos: GridPos,
  toPos: GridPos
): boolean {
  if (!state.prepPhase || state.status !== 'ongoing') return false;
  if (samePos(fromPos, toPos)) return false;
  const spawns = state.playerSpawnPositions ?? [];
  const isTargetSpawn = spawns.some((p) => samePos(p, toPos));
  if (!isTargetSpawn) return false;

  const movingHero = unitAt(state, fromPos);
  if (!movingHero || movingHero.team !== 'player' || movingHero.isEscortCart) return false;

  const other = unitAt(state, toPos);
  if (other && (other.team !== 'player' || other.isEscortCart)) return false;

  movingHero.pos = { ...toPos };
  movingHero.facing = toPos.x >= state.width / 2 ? 'left' : 'right';
  if (other) {
    other.pos = { ...fromPos };
    other.facing = fromPos.x >= state.width / 2 ? 'left' : 'right';
  }
  pushLog(
    state,
    other
      ? `Prep: Swapped ${movingHero.name} & ${other.name}'s starting positions.`
      : `Prep: Repositioned ${movingHero.name} to (${toPos.x}, ${toPos.y}).`
  );
  return true;
}

/**
 * Pre-Battle Tactical Prep: swap an active hero on the field with a bench hero at the exact same tile.
 */
export function swapPrepHeroWithBench(
  state: BattleState,
  fieldUnitId: string,
  benchHero: RosterHero
): BattleUnit | null {
  if (!state.prepPhase || state.status !== 'ongoing' || benchHero.harvested) return null;
  const idx = state.units.findIndex(
    (u) => u.id === fieldUnitId && u.team === 'player' && !u.isEscortCart && u.alive
  );
  if (idx < 0) return null;
  if (state.units.some((u) => u.rosterUid === benchHero.uid)) return null;

  const oldUnit = state.units[idx];
  const newUnit = createBattleUnitFromHero(benchHero, oldUnit.pos);
  newUnit.facing = oldUnit.facing;
  if (hasRelic(state.relicIds, 'rich_loam')) {
    newUnit.hp = Math.min(newUnit.maxHp, newUnit.hp + 2);
  }
  if (hasGraft(newUnit, 'pumpkin_rind')) {
    applyStatusToUnit(newUnit, 'shield', 1);
  }
  state.units[idx] = newUnit;
  pushLog(state, `Prep: Deployed ${newUnit.name} in place of ${oldUnit.name}!`);
  return newUnit;
}

/**
 * Locks in squad positioning and begins Turn 1!
 */
export function finishPrepPhase(state: BattleState): boolean {
  if (!state.prepPhase || state.status !== 'ongoing') return false;
  state.prepPhase = false;
  state.pendingEvents.push({
    type: 'banner',
    text: 'PRODUCE PHASE — TURN 1',
    tone: 'player',
  });
  pushLog(state, 'Squad ready! Produce Phase — Turn 1 begins!');
  return true;
}

export function getUnitById(state: BattleState, id: string): BattleUnit | undefined {
  return state.units.find((u) => u.id === id);
}

function saveUndoSnapshot(state: BattleState): void {
  const clone: BattleState = {
    ...state,
    pendingEvents: [],
    undoSnapshot: null,
  };
  state.undoSnapshot = JSON.stringify(clone);
}

export function undoLastAction(state: BattleState): BattleState | null {
  if (!state.undoSnapshot || state.phase !== 'player' || state.status !== 'ongoing') {
    return null;
  }
  const restored = JSON.parse(state.undoSnapshot) as BattleState;
  restored.undoSnapshot = null;
  restored.pendingEvents = [];
  return restored;
}

function pushLog(state: BattleState, message: string): void {
  state.combatLog.push(message);
  if (state.combatLog.length > 40) state.combatLog.shift();
}

function checkBattleEnd(state: BattleState): void {
  if (state.status !== 'ongoing') return;

  const alivePlayers = state.units.filter((u) => u.team === 'player' && u.alive && !u.isEscortCart);
  const aliveEnemies = state.units.filter((u) => u.team === 'enemy' && u.alive);

  if (alivePlayers.length === 0) {
    state.status = 'defeat';
    state.pendingEvents.push({ type: 'banner', text: 'SQUAD HARVESTED!', tone: 'defeat' });
    pushLog(state, 'All produce heroes were bagged by the farmers!');
    return;
  }

  if (state.objective === 'escort') {
    const cart = state.units.find((u) => u.isEscortCart);
    if (!cart || !cart.alive) {
      state.status = 'defeat';
      state.pendingEvents.push({ type: 'banner', text: 'SEED CART DESTROYED!', tone: 'defeat' });
      pushLog(state, 'The Golden Seed Cart was smashed by the farmers!');
      return;
    }
    if (state.gateTiles.some((g) => samePos(cart.pos, g))) {
      state.status = 'victory';
      state.pendingEvents.push({ type: 'banner', text: 'SEED CART DELIVERED! VICTORY!', tone: 'victory' });
      pushLog(state, 'The Golden Seed Cart rolled safely through the North Gate!');
      return;
    }
    if (aliveEnemies.length === 0) {
      state.status = 'victory';
      state.pendingEvents.push({ type: 'banner', text: 'ESCORT ROUTE CLEARED! VICTORY!', tone: 'victory' });
      pushLog(state, 'All raiders routed — the Golden Seed Cart rolls home safely!');
      return;
    }
    return;
  }

  if (state.objective === 'survive') {
    const targetTurns = state.surviveTurns ?? 4;
    if (state.turn > targetTurns) {
      state.status = 'victory';
      state.pendingEvents.push({ type: 'banner', text: 'PATCH HELD! VICTORY!', tone: 'victory' });
      pushLog(state, `Your squad held the patch for all ${targetTurns} turns!`);
      return;
    }
    if (aliveEnemies.length === 0 && state.turn >= 3) {
      state.status = 'victory';
      state.pendingEvents.push({ type: 'banner', text: 'SIEGE BROKEN! VICTORY!', tone: 'victory' });
      pushLog(state, 'Every wave of farmers was driven back!');
      return;
    }
    return;
  }

  if (state.objective === 'boss') {
    const bossAlive = aliveEnemies.some((e) => e.isBoss);
    if (!bossAlive) {
      state.status = 'victory';
      state.pendingEvents.push({ type: 'banner', text: 'HARVEST REVOLT VICTORY!', tone: 'victory' });
      pushLog(state, 'The season boss toppled! The garden is yours!');
      return;
    }
  }

  if (state.objective === 'reach_gate' && state.gateTiles.length > 0) {
    const reached = alivePlayers.some((p) =>
      state.gateTiles.some((g) => samePos(p.pos, g))
    );
    if (reached) {
      state.status = 'victory';
      state.pendingEvents.push({ type: 'banner', text: 'GATE BREACHED! VICTORY!', tone: 'victory' });
      pushLog(state, 'A produce hero broke through the Garden Gate!');
      return;
    }
  }

  if (state.objective === 'barn_rescue') {
    const cageStillStanding = state.tiles.some((row) =>
      row.some((t) => t.cover?.isObjectiveCage)
    );
    if (cageStillStanding) {
      return;
    }
    if (aliveEnemies.length === 0) {
      state.status = 'victory';
      state.pendingEvents.push({ type: 'banner', text: 'BARN RESCUE COMPLETE!', tone: 'victory' });
      pushLog(state, 'Barn cleared and ally freed!');
      return;
    }
    return;
  }

  if (aliveEnemies.length === 0) {
    state.status = 'victory';
    state.pendingEvents.push({ type: 'banner', text: 'PATCH DEFENDED! VICTORY!', tone: 'victory' });
    pushLog(state, 'All farmers routed from the garden!');
    return;
  }

  checkBossPhase2(state);
}

/**
 * Triggers a Boss's dramatic Phase 2 Enraged transformation at <= 50% HP!
 */
export function checkBossPhase2(state: BattleState): void {
  if (state.status !== 'ongoing' || (state.bossPhase ?? 1) >= 2) return;
  const boss = state.units.find((u) => u.isBoss && u.alive);
  if (!boss) return;
  if (boss.hp <= Math.ceil(boss.maxHp * 0.5)) {
    state.bossPhase = 2;
    applyStatusToUnit(boss, 'shield', 1);
    applyStatusToUnit(boss, 'boosted', 2);
    state.pendingEvents.push({
      type: 'boss_phase',
      bossId: boss.id,
      bossName: boss.name,
      phase: 2,
      pos: { ...boss.pos },
    });
    state.pendingEvents.push({
      type: 'banner',
      text: `${boss.name.toUpperCase()} — PHASE 2 ENRAGED!`,
      tone: 'enemy',
    });
    pushLog(state, `PHASE 2! ${boss.name} entered an enraged frenzy (Shield + Boosted)!`);
  }
}

/**
 * Locks a 1-turn Red Warning Telegraph pattern onto the board for an Act Boss's signature super-attack!
 */
export function scheduleBossTelegraph(state: BattleState, boss: BattleUnit): void {
  if (state.status !== 'ongoing' || !boss.alive || !boss.isBoss) return;
  const players = state.units.filter((u) => u.team === 'player' && u.alive);
  if (players.length === 0) return;

  const isPhase2 = (state.bossPhase ?? 1) >= 2;
  const heatTelegraphBonus = (state.harvestHeat ?? 0) >= 4 ? 1 : 0;
  const tiles: GridPos[] = [];
  const seen = new Set<string>();
  const addTile = (p: GridPos) => {
    if (!inBounds(state, p)) return;
    const k = posKey(p);
    if (!seen.has(k)) {
      seen.add(k);
      tiles.push({ ...p });
    }
  };

  let name = 'Crow Storm';
  let damage = (isPhase2 ? 5 : 4) + heatTelegraphBonus;
  let status: StatusKind | undefined = 'feared';

  if (boss.visualKind === 'tractor') {
    name = isPhase2 ? 'Overdrive Plow' : 'Harvester Charge';
    damage = (isPhase2 ? 6 : 5) + heatTelegraphBonus;
    status = 'burn';
    // Target the closest hero's column with a deadly south-plowing lane
    const anchor = [...players].sort((a, b) => manhattan(boss.pos, a.pos) - manhattan(boss.pos, b.pos))[0];
    const cols = isPhase2 ? [anchor.pos.x, Math.min(state.width - 1, anchor.pos.x + 1)] : [anchor.pos.x];
    for (const cx of cols) {
      for (let dy = -1; dy <= 2; dy++) {
        addTile({ x: cx, y: anchor.pos.y + dy });
      }
    }
  } else if (boss.visualKind === 'harvester') {
    name = isPhase2 ? 'Crimson Bramble Surge' : 'Bramble Barrage';
    damage = (isPhase2 ? 5 : 4) + heatTelegraphBonus;
    status = 'rooted';
    const picks = players.slice(0, isPhase2 ? 2 : 1);
    for (const h of picks) {
      addTile(h.pos);
      for (const n of getNeighbors(state, h.pos)) addTile(n);
    }
  } else {
    // Captain Scarecrow: Crow Storm cross (Phase 1) or full 3x3 (Phase 2)!
    name = isPhase2 ? 'Blazing Crow Storm' : 'Crow Storm';
    damage = (isPhase2 ? 5 : 4) + heatTelegraphBonus;
    status = 'feared';
    const anchor = [...players].sort((a, b) => {
      const ca = players.filter((o) => chebyshev(a.pos, o.pos) <= 1).length;
      const cb = players.filter((o) => chebyshev(b.pos, o.pos) <= 1).length;
      return cb - ca;
    })[0];
    if (isPhase2) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          addTile({ x: anchor.pos.x + dx, y: anchor.pos.y + dy });
        }
      }
    } else {
      addTile(anchor.pos);
      for (const n of getNeighbors(state, anchor.pos)) addTile(n);
    }
  }

  if (tiles.length === 0) return;
  state.bossTelegraphs = [
    ...(state.bossTelegraphs ?? []).filter((t) => t.bossId !== boss.id),
    { bossId: boss.id, name, tiles, damage, status },
  ];
  pushLog(state, `WARNING! ${boss.name} is telegraphing ${name} (${damage} DMG) — dodge the red tiles!`);
}

/**
 * Detonates any pending Boss Telegraphs at the start of Enemy Phase!
 */
export function resolveBossTelegraphs(state: BattleState): void {
  const pending = state.bossTelegraphs ?? [];
  if (pending.length === 0) return;
  state.bossTelegraphs = [];

  for (const tel of pending) {
    const boss = getUnitById(state, tel.bossId);
    if (!boss || !boss.alive) continue;

    const hitIds: string[] = [];
    for (const p of tel.tiles) {
      const victim = unitAt(state, p);
      if (victim && victim.alive && victim.team === 'player') {
        let dmg = tel.damage;
        if (hasStatus(victim, 'shield')) dmg = Math.max(1, dmg - 2);
        victim.hp -= dmg;
        if (tel.status && victim.hp > 0) {
          applyStatusToUnit(victim, tel.status, 1);
        }
        hitIds.push(victim.id);
        handleUnitKO(state, victim);
      }
    }

    state.pendingEvents.push({
      type: 'boss_telegraph_strike',
      bossId: boss.id,
      name: tel.name,
      tiles: tel.tiles.map((t) => ({ ...t })),
      hitIds,
      damage: tel.damage,
    });
    pushLog(
      state,
      hitIds.length > 0
        ? `${boss.name}'s ${tel.name} struck ${hitIds.length} hero(es) for ${tel.damage} DMG!`
        : `${boss.name}'s ${tel.name} slammed empty ground — clean dodge!`
    );
  }
  checkBattleEnd(state);
}

function handleUnitKO(state: BattleState, unit: BattleUnit): void {
  if (unit.hp > 0 || !unit.alive) return;
  unit.hp = 0;
  unit.alive = false;
  state.pendingEvents.push({
    type: 'unit_ko',
    unitId: unit.id,
    pos: { ...unit.pos },
    team: unit.team,
    unitName: unit.name,
  });
  pushLog(
    state,
    unit.team === 'player'
      ? `${unit.name} was Harvested into a farmer's burlap sack!`
      : `${unit.name} was driven off the patch!`
  );
}

/**
 * Finds the nearest safe dry walkable tile when a collapsible bridge drops beneath a unit.
 */
function findNearestDryLanding(state: BattleState, origin: GridPos): GridPos | null {
  let best: GridPos | null = null;
  let bestDist = Infinity;
  for (let y = 0; y < state.height; y++) {
    for (let x = 0; x < state.width; x++) {
      const p = { x, y };
      if (samePos(p, origin)) continue;
      const t = tileAt(state, p);
      if (!t || t.cover || isHazardLiquid(t.terrain)) continue;
      if (unitAt(state, p)) continue;
      const d = manhattan(origin, p);
      if (d < bestDist) {
        bestDist = d;
        best = p;
      }
    }
  }
  return best;
}

/**
 * Collapsible Wooden Bridge: attacking or blasting a bridge damages its planks; at 0 HP
 * it collapses into water or lava underneath, splashing anyone standing on it!
 */
export function damageBridgeAt(state: BattleState, pos: GridPos, amount: number): boolean {
  const tile = tileAt(state, pos);
  if (!tile || tile.terrain !== 'bridge' || (tile.bridgeHp ?? 0) <= 0) return false;

  tile.bridgeHp = Math.max(0, (tile.bridgeHp ?? 5) - amount);
  if (tile.bridgeHp > 0) {
    pushLog(state, `Cracked wooden bridge at (${pos.x}, ${pos.y}) (${tile.bridgeHp}/${tile.bridgeMaxHp ?? 5} HP left)!`);
    return false;
  }

  const liquid: 'water' | 'lava' = tile.bridgeOver ?? 'water';
  tile.terrain = liquid;
  tile.bridgeHp = 0;
  const victim = unitAt(state, pos);

  state.pendingEvents.push({
    type: 'bridge_collapse',
    pos: { ...pos },
    liquid,
    affectedUnitId: victim?.id,
  });
  pushLog(state, `BRIDGE COLLAPSED! Planks gave way into ${liquid} at (${pos.x}, ${pos.y})!`);

  if (victim && victim.alive) {
    const isLava = liquid === 'lava';
    const hazDmg = isLava ? 4 : 3;
    victim.hp -= hazDmg;
    if (isLava) {
      applyStatusToUnit(victim, 'burn', 2);
    } else {
      victim.statuses = victim.statuses.filter((s) => s.kind !== 'burn');
    }
    state.pendingEvents.push({
      type: 'terrain_hazard',
      kind: liquid,
      unitId: victim.id,
      pos: { ...pos },
      damage: hazDmg,
    });
    pushLog(
      state,
      isLava
        ? `LAVA DROP! ${victim.name} fell through the bridge (-${hazDmg} HP + Burn)!`
        : `SPLASH! ${victim.name} plunged into the creek (-${hazDmg} HP)!`
    );
    handleUnitKO(state, victim);
    if (victim.alive) {
      const landing = findNearestDryLanding(state, pos);
      if (landing) {
        victim.pos = { ...landing };
      }
    }
  }

  return true;
}

/**
 * Rolling Pumpkin Boulder: bowling a carved giant pumpkin straight away from the attacker up to 5 tiles,
 * dealing 4 DMG + knockback to every unit in its lane & smashing crates along the way!
 */
function rollPumpkinBoulder(
  state: BattleState,
  origin: GridPos,
  dir: GridPos,
  attackerTeam: 'player' | 'enemy',
  rosterLookup?: RosterHero[],
  visitedHazards: Set<string> = new Set()
): void {
  const pushDir = dir.x === 0 && dir.y === 0 ? { x: 0, y: -1 } : dir;
  const path: GridPos[] = [{ ...origin }];
  const hitIds: string[] = [];
  let prevElev = tileAt(state, origin)?.elevation ?? 0;

  for (let step = 1; step <= 5; step++) {
    const p: GridPos = { x: origin.x + pushDir.x * step, y: origin.y + pushDir.y * step };
    if (!inBounds(state, p)) break;
    const t = tileAt(state, p);
    if (!t) break;
    if ((t.elevation ?? 0) > prevElev) break; // Can't roll uphill
    prevElev = t.elevation ?? 0;

    if (t.cover && !t.cover.destructible) {
      break; // Stone pillar stops the pumpkin
    }

    path.push({ ...p });

    if (t.cover && t.cover.destructible) {
      damageCoverAt(state, p, 6, attackerTeam, rosterLookup, visitedHazards, pushDir);
    }

    const u = unitAt(state, p);
    if (u && u.alive) {
      u.hp -= 4;
      hitIds.push(u.id);
      pushLog(state, `PUMPKIN BOWL! Rolling boulder flattened ${u.name} for 4 DMG!`);
      handleUnitKO(state, u);
      if (u.alive) {
        applyKnockback(state, u, pushDir, rosterLookup, visitedHazards);
      }
    }

    if (isHazardLiquid(t.terrain)) {
      break; // Splashes into water/lava!
    }
  }

  const endPos = path[path.length - 1] ?? origin;
  state.pendingEvents.push({
    type: 'pumpkin_roll',
    from: { ...origin },
    to: { ...endPos },
    path,
    hitIds,
    damage: 4,
  });
  pushLog(
    state,
    hitIds.length > 0
      ? `ROLLING PUMPKIN bowled ${path.length - 1} tiles and crushed ${hitIds.length} target(s)!`
      : `ROLLING PUMPKIN tumbled ${Math.max(1, path.length - 1)} tiles across the patch!`
  );
}

/**
 * Directional Knockback & Bump Crunch (Into the Breach style):
 * - Slides target 1 tile in `dir` if walkable & empty.
 * - If blocked by a unit, cover, or board edge, deals +2 BUMP! damage (and +2 to blocking unit,
 *   or 4 crunch damage to destructible cover — letting you slam foes into Beehives, Sprinklers & Pumpkins!).
 */
export function applyKnockback(
  state: BattleState,
  target: BattleUnit,
  dir: GridPos,
  rosterLookup?: RosterHero[],
  visitedHazards: Set<string> = new Set(),
  bonusBumpDmg = 0
): void {
  if (!target.alive) return;
  if (dir.x === 0 && dir.y === 0) return;

  const curTile = tileAt(state, target.pos);
  const nextPos: GridPos = { x: target.pos.x + dir.x, y: target.pos.y + dir.y };
  const inGrid = inBounds(state, nextPos);
  const nextTile = inGrid ? tileAt(state, nextPos) : null;
  const blockerUnit = inGrid ? unitAt(state, nextPos) : undefined;

  // Environmental Liquid Hazards (Water Splash / Lava Plunge — bounces back onto the rim!)
  if (inGrid && nextTile && isHazardLiquid(nextTile.terrain)) {
    const isLava = nextTile.terrain === 'lava';
    const hazDmg = isLava ? 4 : 3;
    target.hp -= hazDmg;
    if (isLava) {
      applyStatusToUnit(target, 'burn', 2);
    } else {
      target.statuses = target.statuses.filter((s) => s.kind !== 'burn');
    }
    state.pendingEvents.push({
      type: 'terrain_hazard',
      kind: isLava ? 'lava' : 'water',
      unitId: target.id,
      pos: { ...nextPos },
      damage: hazDmg,
    });
    pushLog(
      state,
      isLava
        ? `LAVA PLUNGE! ${target.name} scorched in molten lava (-${hazDmg} HP + Burn)!`
        : `SPLASH! ${target.name} dunked in deep water (-${hazDmg} HP)!`
    );
    handleUnitKO(state, target);
    return;
  }

  if (inGrid && nextTile && !nextTile.cover && !blockerUnit) {
    const from = { ...target.pos };
    const fromElev = curTile?.elevation ?? 0;
    const toElev = nextTile.elevation ?? 0;
    target.pos = { ...nextPos };
    state.pendingEvents.push({
      type: 'knockback',
      unitId: target.id,
      from,
      to: { ...nextPos },
      bumped: false,
    });
    if (fromElev > toElev) {
      const dropDmg = 2;
      target.hp -= dropDmg;
      state.pendingEvents.push({
        type: 'terrain_hazard',
        kind: 'drop',
        unitId: target.id,
        pos: { ...nextPos },
        damage: dropDmg,
      });
      pushLog(state, `CLIFF DROP! ${target.name} tumbled off high ground (-${dropDmg} HP)!`);
      handleUnitKO(state, target);
    } else {
      pushLog(state, `${target.name} was knocked back!`);
    }
    return;
  }

  // BUMP CRUNCH!
  const bumpDmg = 2 + bonusBumpDmg;
  target.hp -= bumpDmg;

  if (blockerUnit && blockerUnit.alive) {
    blockerUnit.hp -= bumpDmg;
    state.pendingEvents.push({
      type: 'knockback',
      unitId: target.id,
      from: { ...target.pos },
      to: { ...target.pos },
      bumped: true,
      bumpDamage: bumpDmg,
      bumpedUnitId: blockerUnit.id,
    });
    pushLog(state, `BUMP! ${target.name} slammed into ${blockerUnit.name} (-${bumpDmg} HP each)!`);
    handleUnitKO(state, blockerUnit);
  } else if (nextTile?.cover) {
    state.pendingEvents.push({
      type: 'knockback',
      unitId: target.id,
      from: { ...target.pos },
      to: { ...target.pos },
      bumped: true,
      bumpDamage: bumpDmg,
    });
    pushLog(state, `CRUNCH! ${target.name} slammed into ${nextTile.cover.kind} (-${bumpDmg} HP)!`);
    if (nextTile.cover.destructible) {
      damageCoverAt(state, nextPos, 4, 'player', rosterLookup, visitedHazards, dir);
    }
  } else {
    state.pendingEvents.push({
      type: 'knockback',
      unitId: target.id,
      from: { ...target.pos },
      to: { ...target.pos },
      bumped: true,
      bumpDamage: bumpDmg,
    });
    pushLog(state, `BUMP! ${target.name} slammed against the board edge (-${bumpDmg} HP)!`);
  }

  handleUnitKO(state, target);
}

function damageCoverAt(
  state: BattleState,
  pos: GridPos,
  amount: number,
  attackerTeam: 'player' | 'enemy',
  rosterLookup?: RosterHero[],
  visitedHazards: Set<string> = new Set(),
  pushDir?: GridPos
): boolean {
  const tile = tileAt(state, pos);
  if (!tile?.cover || !tile.cover.destructible) return false;

  tile.cover.hp -= amount;
  if (tile.cover.hp > 0) return false;

  const destroyedCover = tile.cover;
  tile.cover = null;

  const splash =
    attackerTeam === 'player' && hasRelic(state.relicIds, 'splintering_compost') ? 2 : 0;

  state.pendingEvents.push({
    type: 'cover_break',
    pos: { ...pos },
    kind: destroyedCover.kind,
    splashDamage: splash || undefined,
  });
  pushLog(state, `Smashed ${destroyedCover.kind} at (${pos.x}, ${pos.y})!`);

  // Splintering Compost relic deals 2 AoE damage to adjacent enemies when cover shatters!
  if (splash > 0) {
    for (const adj of getNeighbors(state, pos)) {
      const adjEnemy = unitAt(state, adj);
      if (adjEnemy && adjEnemy.team === 'enemy') {
        adjEnemy.hp -= splash;
        handleUnitKO(state, adjEnemy);
      }
    }
  }

  // Interactive Hazard 0: Rolling Pumpkin Boulder!
  const hazKey = posKey(pos);
  if (destroyedCover.kind === 'pumpkin' && !visitedHazards.has(hazKey)) {
    visitedHazards.add(hazKey);
    rollPumpkinBoulder(
      state,
      pos,
      pushDir ?? { x: 0, y: -1 },
      attackerTeam,
      rosterLookup,
      visitedHazards
    );
  }

  // Interactive Hazard 1: Explosive Beehive (3x3 angry bee swarm: 3 dmg + push outward + chain cover/bridge crunch!)
  if (destroyedCover.kind === 'beehive' && !visitedHazards.has(hazKey)) {
    visitedHazards.add(hazKey);
    state.pendingEvents.push({ type: 'hazard', kind: 'beehive', pos: { ...pos }, damage: 3 });
    pushLog(state, `BEEHIVE BOOM! Angry bees swarmed 3×3 for 3 dmg & knocked everyone back!`);
    const victims: BattleUnit[] = [];
    for (let y = pos.y - 1; y <= pos.y + 1; y++) {
      for (let x = pos.x - 1; x <= pos.x + 1; x++) {
        const p = { x, y };
        if (samePos(p, pos) || !inBounds(state, p)) continue;
        const u = unitAt(state, p);
        if (u && u.alive) victims.push(u);
        const adjTile = tileAt(state, p);
        if (adjTile?.cover?.destructible) {
          damageCoverAt(state, p, 4, attackerTeam, rosterLookup, visitedHazards, computePushDirection(pos, p));
        }
        if (adjTile?.terrain === 'bridge') {
          damageBridgeAt(state, p, 3);
        }
      }
    }
    for (const v of victims) {
      if (!v.alive) continue;
      v.hp -= 3;
      handleUnitKO(state, v);
      if (v.alive) {
        applyKnockback(state, v, computePushDirection(pos, v.pos), rosterLookup, visitedHazards);
      }
    }
  }

  // Interactive Hazard 2: Irrigation Sprinkler (N/S/E/W water jet up to 2 tiles: pushes units, douses Burn, 2 dmg to foes!)
  if (destroyedCover.kind === 'sprinkler' && !visitedHazards.has(hazKey)) {
    visitedHazards.add(hazKey);
    state.pendingEvents.push({ type: 'hazard', kind: 'sprinkler', pos: { ...pos }, damage: 2 });
    pushLog(state, `SPRINKLER BLAST! Cross water jets pushed units & extinguished Burn!`);
    const dirs: GridPos[] = [
      { x: 1, y: 0 },
      { x: -1, y: 0 },
      { x: 0, y: 1 },
      { x: 0, y: -1 },
    ];
    for (const d of dirs) {
      for (let step = 1; step <= 2; step++) {
        const p = { x: pos.x + d.x * step, y: pos.y + d.y * step };
        if (!inBounds(state, p)) break;
        if (tileAt(state, p)?.cover) break;
        const u = unitAt(state, p);
        if (u && u.alive) {
          u.statuses = u.statuses.filter((s) => s.kind !== 'burn');
          if (u.team === 'enemy') {
            u.hp -= 2;
            handleUnitKO(state, u);
          }
          if (u.alive) {
            applyKnockback(state, u, d, rosterLookup, visitedHazards);
          }
          break;
        }
      }
    }
  }

  // Barn Rescue Cage broken -> free bagged hero or recruitable ally right onto the battlefield!
  if (destroyedCover.isObjectiveCage && destroyedCover.captiveUnitId) {
    const cid = destroyedCover.captiveUnitId;
    if (cid.startsWith('hero:')) {
      const uid = cid.slice(5);
      state.rescuedHeroUids.push(uid);
      const savedHero = destroyedCover.captiveHero ?? rosterLookup?.find((h) => h.uid === uid);
      if (savedHero) {
        const freedUnit = createBattleUnitFromHero(
          { ...savedHero, hp: Math.max(4, Math.round(savedHero.maxHp * 0.7)), harvested: false },
          pos
        );
        state.units.push(freedUnit);
        state.pendingEvents.push({ type: 'rescue', pos: { ...pos }, unitName: freedUnit.name });
        pushLog(state, `FREED ${freedUnit.name} from the Burlap Cage — ready to fight!`);
      }
    } else if (cid.startsWith('bp:')) {
      const bpId = cid.slice(3);
      const bp = PRODUCE_BLUEPRINTS[bpId] ?? PRODUCE_BLUEPRINTS.carrot;
      state.rescuedNewBlueprintIds.push(bp.id);
      const tempHero: RosterHero = {
        uid: `rescued_${bp.id}_${Date.now()}`,
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
        hp: bp.maxHp,
        maxHp: bp.maxHp,
        moveRange: bp.moveRange,
        jumpRange: bp.jumpRange,
        dashDamage: bp.dashDamage,
        dashStatus: bp.dashStatus,
        weapon: bp.weapon,
        ability: bp.ability,
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
      const freedUnit = createBattleUnitFromHero(tempHero, pos);
      state.units.push(freedUnit);
      state.pendingEvents.push({ type: 'rescue', pos: { ...pos }, unitName: freedUnit.name });
      pushLog(state, `RESCUED captive ${freedUnit.name} (${freedUnit.title})! They join the fight!`);
    }
  }

  return true;
}

/**
 * Mario + Rabbids Hero Sight (Overwatch):
 * Whenever an opposing unit moves/dashes into range of an Overwatching hero,
 * the hero automatically interrupts and fires a reaction shot!
 */
function triggerOverwatchInterrupts(state: BattleState, mover: BattleUnit): void {
  if (!mover.alive || state.status !== 'ongoing') return;

  for (const watcher of state.units) {
    if (!mover.alive || state.status !== 'ongoing') break;
    if (!watcher.alive || watcher.team === mover.team) continue;
    const charges = watcher.actions.overwatchCharges ?? 0;
    if (charges <= 0 || !hasStatus(watcher, 'overwatch')) continue;

    const fc = forecastAttack(state, watcher, mover.pos, true);
    if (!fc.canAttack) continue;

    const watcherFx = getUnitPerkEffects(watcher);
    const dmg = fc.finalDamage + watcherFx.bonusOverwatchDmg;
    watcher.actions.overwatchCharges = charges - 1;
    if (watcher.actions.overwatchCharges <= 0) {
      watcher.statuses = watcher.statuses.filter((s) => s.kind !== 'overwatch');
    }
    if (mover.pos.x !== watcher.pos.x) {
      watcher.facing = mover.pos.x > watcher.pos.x ? 'right' : 'left';
    }

    mover.hp -= dmg;
    if (watcherFx.overwatchRoots && mover.hp > 0) {
      applyStatusToUnit(mover, 'rooted', 1);
    }
    state.pendingEvents.push({
      type: 'overwatch_shot',
      attackerId: watcher.id,
      attackerKind: watcher.visualKind,
      targetId: mover.id,
      from: { ...watcher.pos },
      to: { ...mover.pos },
      damage: dmg,
    });
    pushLog(
      state,
      `HERO SIGHT! ${watcher.name} intercepted ${mover.name} for ${dmg} dmg${watcherFx.overwatchRoots ? ' (+Rooted!)' : ''}!`
    );
    handleUnitKO(state, mover);
  }
}

export function executeOverwatch(state: BattleState, unitId: string): boolean {
  if (state.status !== 'ongoing' || state.phase !== 'player' || state.prepPhase) return false;
  const unit = getUnitById(state, unitId);
  if (!unit || !unit.alive || unit.isEscortCart || unit.team !== 'player' || unit.actions.hasAttacked) return false;

  saveUndoSnapshot(state);
  unit.actions.hasAttacked = true;
  unit.actions.overwatchCharges = getMaxOverwatchCharges(unit);
  applyStatusToUnit(unit, 'overwatch', 1);

  state.pendingEvents.push({
    type: 'ability',
    unitId: unit.id,
    abilityName: `Hero Sight (×${unit.actions.overwatchCharges})`,
    from: { ...unit.pos },
    to: { ...unit.pos },
    affectedIds: [unit.id],
    status: 'overwatch',
  });
  pushLog(
    state,
    `${unit.name} entered HERO SIGHT Overwatch (${unit.actions.overwatchCharges} reaction shot${unit.actions.overwatchCharges > 1 ? 's' : ''})!`
  );
  return true;
}

export function executeMove(state: BattleState, unitId: string, dest: GridPos): boolean {
  if (state.status !== 'ongoing' || state.prepPhase) return false;
  const unit = getUnitById(state, unitId);
  if (!unit || !unit.alive || unit.isEscortCart || unit.actions.hasMoved) return false;

  const movable = computeMovableTiles(state, unit);
  const node = movable.get(posKey(dest));
  if (!node) return false;

  if (unit.team === 'player') {
    saveUndoSnapshot(state);
  }

  if (dest.x !== unit.pos.x) {
    unit.facing = dest.x > unit.pos.x ? 'right' : 'left';
  }
  unit.pos = { ...dest };
  spendMove(unit, node.cost);

  state.pendingEvents.push({
    type: 'move',
    unitId: unit.id,
    path: node.path.map((p) => ({ ...p })),
  });

  // Detect Gopher Burrow Warp Pipe OR Bouncy Mushroom Launchpad leap in path!
  for (let i = 0; i < node.path.length - 1; i++) {
    if (manhattan(node.path[i], node.path[i + 1]) > 1) {
      const originTile = tileAt(state, node.path[i]);
      if (originTile?.terrain === 'bounce_pad') {
        state.pendingEvents.push({
          type: 'bounce_launch',
          unitId: unit.id,
          from: { ...node.path[i] },
          to: { ...node.path[i + 1] },
        });
        pushLog(state, `BOING! ${unit.name} launched off a Bouncy Mushroom!`);
      } else {
        state.pendingEvents.push({
          type: 'burrow_warp',
          unitId: unit.id,
          from: { ...node.path[i] },
          to: { ...node.path[i + 1] },
        });
        pushLog(state, `${unit.name} zipped through a Gopher Burrow!`);
      }
      break;
    }
  }

  triggerOverwatchInterrupts(state, unit);
  checkBattleEnd(state);
  return true;
}

export function executeDash(state: BattleState, unitId: string, targetEnemyId: string): boolean {
  if (state.status !== 'ongoing' || state.prepPhase) return false;
  const unit = getUnitById(state, unitId);
  const dashesUsed = unit?.actions.dashesUsed ?? (unit?.actions.hasDashed ? 1 : 0);
  if (!unit || !unit.alive || unit.isEscortCart || dashesUsed >= getMaxDashesForUnit(unit)) {
    return false;
  }

  const options = computeDashOptions(state, unit);
  const opt = options.find((o) => o.enemyId === targetEnemyId);
  if (!opt) return false;

  const target = getUnitById(state, targetEnemyId);
  if (!target || !target.alive) return false;

  if (unit.team === 'player') {
    saveUndoSnapshot(state);
  }

  const from = { ...unit.pos };
  if (target.pos.x !== unit.pos.x) {
    unit.facing = target.pos.x > unit.pos.x ? 'right' : 'left';
  }

  // Move to stopPos adjacent to enemy, paying for the steps out of this turn's movement budget.
  // The hero keeps whatever movement is left to Multi-Dash, walk on, or Team-Jump.
  unit.pos = { ...opt.stopPos };
  spendMove(unit, opt.cost);
  const nextDashes = dashesUsed + 1;
  unit.actions.dashesUsed = nextDashes;
  unit.actions.dashedEnemyIds = [...(unit.actions.dashedEnemyIds ?? []), target.id];
  unit.actions.hasDashed = nextDashes >= getMaxDashesForUnit(unit);

  let dmg = opt.damage;
  if (hasStatus(target, 'acid')) dmg += 2;
  if (hasStatus(target, 'shield')) dmg = Math.max(1, dmg - 2);

  target.hp -= dmg;
  if (opt.appliesStatus) {
    applyStatusToUnit(target, opt.appliesStatus, 2);
  }

  state.pendingEvents.push({
    type: 'dash',
    unitId: unit.id,
    targetId: target.id,
    from,
    to: { ...opt.stopPos },
    targetPos: { ...target.pos },
    damage: dmg,
    status: opt.appliesStatus,
  });
  pushLog(
    state,
    `${unit.name} DASHED ${target.name} for ${dmg} dmg${opt.appliesStatus ? ` (+${opt.appliesStatus})` : ''}!`
  );

  const dashFx = getUnitPerkEffects(unit);
  const wasTargetAlive = target.alive;
  handleUnitKO(state, target);
  if (wasTargetAlive && !target.alive && dashFx.killRefreshesDash) {
    unit.actions.dashesUsed = Math.max(0, (unit.actions.dashesUsed ?? 1) - 1);
    unit.actions.hasDashed = false;
    pushLog(state, `${unit.name} chained a KO — Dash refreshed!`);
  }
  if (target.alive && opt.knockback && opt.knockback > 0) {
    applyKnockback(
      state,
      target,
      computePushDirection(opt.stopPos, target.pos),
      undefined,
      new Set(),
      dashFx.bonusBumpDmg
    );
  }
  triggerOverwatchInterrupts(state, unit);
  checkBattleEnd(state);
  return true;
}

export function executeTeamJump(state: BattleState, unitId: string, dest: GridPos): boolean {
  if (state.status !== 'ongoing' || state.prepPhase) return false;
  const unit = getUnitById(state, unitId);
  if (!unit || !unit.alive || unit.isEscortCart || unit.team !== 'player' || unit.actions.hasJumped) {
    return false;
  }

  const jumpOptions = computeTeamJumpOptions(state, unit);
  const opt = jumpOptions.get(posKey(dest));
  if (!opt) return false;

  saveUndoSnapshot(state);

  const from = { ...unit.pos };
  if (dest.x !== unit.pos.x) {
    unit.facing = dest.x > unit.pos.x ? 'right' : 'left';
  }
  unit.pos = { ...dest };
  unit.actions.hasJumped = true;
  // Walking up to the springboard ally costs movement; the launch itself is free,
  // so the hero can keep walking with whatever budget is left after landing.
  spendMove(unit, opt.approachCost);

  let coopBoost: string | undefined;
  if (hasRelic(state.relicIds, 'bouncy_mulch')) {
    unit.tempAttackBonus = Math.min(3, unit.tempAttackBonus + 2);
    coopBoost = 'BOUNCY MULCH +2!';
    pushLog(state, `Bouncy Mulch energized ${unit.name} (+2 Attack this turn)!`);
  }

  // Barnyard Co-op: Team-Jumping off Cluck Norris launches +2 tiles & grants +2 Attack!
  const springboardAlly = getUnitById(state, opt.allyId);
  const springboardFx = getUnitPerkEffects(springboardAlly);
  const unitFx = getUnitPerkEffects(unit);

  if (springboardAlly?.launchpadCoop) {
    unit.tempAttackBonus = Math.min(3, unit.tempAttackBonus + 2);
    coopBoost = `CLUCK LAUNCH +${unit.tempAttackBonus} ATK!`;
    pushLog(state, `CO-OP LAUNCH! ${springboardAlly.name} boosted ${unit.name} (+${unit.tempAttackBonus} Attack this turn)!`);
  }

  // Ally Jump Heal & Ally Jump Boost character perks!
  if (springboardAlly && springboardFx.allyJumpHeal > 0 && unit.hp < unit.maxHp) {
    const healed = Math.min(springboardFx.allyJumpHeal, unit.maxHp - unit.hp);
    unit.hp += healed;
    state.pendingEvents.push({
      type: 'heal',
      unitId: unit.id,
      pos: { ...dest },
      amount: healed,
      source: springboardAlly.name,
    });
    coopBoost = coopBoost ?? `+${healed} HP VAULT!`;
  }
  if (springboardAlly && springboardFx.allyJumpBoost) {
    applyStatusToUnit(unit, 'boosted', 1);
    applyStatusToUnit(springboardAlly, 'boosted', 1);
    coopBoost = 'SPRINGBOARD +2 ATK!';
    pushLog(state, `SPRINGBOARD BOOST! ${springboardAlly.name} & ${unit.name} fired up (+2 ATK)!`);
  }

  state.pendingEvents.push({
    type: 'jump',
    unitId: unit.id,
    allyPos: { ...opt.allyPos },
    from,
    to: { ...dest },
    coopBoost,
  });
  pushLog(state, `${unit.name} Team-Jumped across the garden!`);

  // Jump Stomp character perks (Spudnik Tater Quake, Chili Ember Leap, Carroteer Pop-Up, Rooster Divebomb, Sheep Avalanche!)
  if (unitFx.jumpStompDmg > 0) {
    if (unitFx.jumpStompBoost) {
      unit.tempAttackBonus = Math.min(4, unit.tempAttackBonus + 2);
    }
    const stompDmg = unitFx.jumpStompDmg;
    const hitIds: string[] = [];
    for (const adj of getNeighbors(state, dest)) {
      const foe = unitAt(state, adj);
      if (foe && foe.team !== unit.team && foe.alive) {
        foe.hp -= stompDmg;
        hitIds.push(foe.id);
        handleUnitKO(state, foe);
      }
    }
    state.pendingEvents.push({
      type: 'stomp',
      unitId: unit.id,
      pos: { ...dest },
      damage: stompDmg,
      hitIds,
    });
    if (hitIds.length > 0) {
      pushLog(state, `JUMP STOMP! ${unit.name} slammed ${hitIds.length} nearby foe(s) for ${stompDmg} dmg!`);
    }
  }

  checkBattleEnd(state);
  return true;
}

export function executeAttack(
  state: BattleState,
  unitId: string,
  targetPos: GridPos,
  rng: () => number = Math.random,
  rosterLookup?: RosterHero[]
): boolean {
  if (state.status !== 'ongoing' || state.prepPhase) return false;
  const attacker = getUnitById(state, unitId);
  if (!attacker || !attacker.alive || attacker.isEscortCart) return false;

  const fc = forecastAttack(state, attacker, targetPos);
  if (!fc.canAttack) return false;

  // Combat commits state (no RNG undo savescumming)
  state.undoSnapshot = null;
  attacker.actions.hasAttacked = true;
  if (targetPos.x !== attacker.pos.x) {
    attacker.facing = targetPos.x > attacker.pos.x ? 'right' : 'left';
  }

  const targetTile = tileAt(state, targetPos);
  const defender = fc.targetUnitId ? getUnitById(state, fc.targetUnitId) : undefined;

  const attackerFx = getUnitPerkEffects(attacker);

  // Case A: Attacking destructible cover / Barn Cage / Pumpkin / Collapsible Bridge directly (or lobbing at empty tile)
  if (!defender) {
    let coverDestroyed = false;
    const attackDir = computePushDirection(attacker.pos, targetPos);
    if (fc.isBridgeTarget) {
      coverDestroyed = damageBridgeAt(state, targetPos, fc.coverDamage);
    } else if (targetTile?.cover) {
      coverDestroyed = damageCoverAt(
        state,
        targetPos,
        fc.coverDamage,
        attacker.team,
        rosterLookup,
        new Set(),
        attackDir
      );
    }

    if (coverDestroyed && attackerFx.coverBreakSplash > 0) {
      for (const adj of getNeighbors(state, targetPos)) {
        const foe = unitAt(state, adj);
        if (foe && foe.team !== attacker.team && foe.alive) {
          foe.hp -= attackerFx.coverBreakSplash;
          state.pendingEvents.push({
            type: 'status_tick',
            unitId: foe.id,
            pos: { ...foe.pos },
            status: 'burn',
            damage: attackerFx.coverBreakSplash,
          });
          handleUnitKO(state, foe);
        }
      }
      pushLog(state, `SPLINTER BLAST! Shattered debris hit adjacent foes for ${attackerFx.coverBreakSplash} dmg!`);
    }

    state.pendingEvents.push({
      type: 'attack',
      attackerId: attacker.id,
      attackerKind: attacker.visualKind,
      from: { ...attacker.pos },
      to: { ...targetPos },
      arc: attacker.weapon.arc,
      hit: true,
      damage: fc.coverDamage,
      matchup: 'neutral',
      coverHitPos: targetTile?.cover || coverDestroyed || fc.isBridgeTarget ? { ...targetPos } : undefined,
      coverDestroyed,
    });

    // Lobbed AoE splash on empty/cover/bridge tile!
    if (attacker.weapon.aoeRadius && attacker.weapon.aoeRadius > 0) {
      applyWeaponSplash(state, attacker, targetPos, undefined, rosterLookup);
    }

    checkBattleEnd(state);
    return true;
  }

  // Case B: Attacking an enemy unit
  const roll = rng() * 100;
  const hit = fc.hitChance >= 100 || roll < fc.hitChance;

  if (!hit) {
    // Mario + Rabbids signature touch: a missed 50% shot hits & chips the protecting Half Cover!
    let coverDestroyed = false;
    if (fc.coverPos) {
      coverDestroyed = damageCoverAt(
        state,
        fc.coverPos,
        fc.coverDamage,
        attacker.team,
        rosterLookup,
        new Set(),
        computePushDirection(attacker.pos, fc.coverPos)
      );
    }
    state.pendingEvents.push({
      type: 'attack',
      attackerId: attacker.id,
      attackerKind: attacker.visualKind,
      from: { ...attacker.pos },
      to: { ...targetPos },
      arc: attacker.weapon.arc,
      hit: false,
      damage: 0,
      targetId: defender.id,
      matchup: fc.matchup,
      coverHitPos: fc.coverPos ? { ...fc.coverPos } : undefined,
      coverDestroyed,
    });
    pushLog(state, `${attacker.name}'s ${attacker.weapon.name} clipped ${defender.name}'s cover!`);
    checkBattleEnd(state);
    return true;
  }

  // HIT!
  const wasDefenderAcid = hasStatus(defender, 'acid');
  defender.hp -= fc.finalDamage;
  let appliedStatusKind = fc.appliesStatus;
  if (attacker.weapon.appliesStatus) {
    applyStatusToUnit(defender, attacker.weapon.appliesStatus.kind, attacker.weapon.appliesStatus.turns);
  }
  if (attackerFx.attackStatus) {
    applyStatusToUnit(defender, attackerFx.attackStatus, 2);
    if (!appliedStatusKind) appliedStatusKind = attackerFx.attackStatus;
  }
  if (fc.hitChance === 100 && hasGraft(attacker, 'spicy_shot')) {
    applyStatusToUnit(defender, 'burn', 2);
    if (!appliedStatusKind) appliedStatusKind = 'burn';
  }

  state.pendingEvents.push({
    type: 'attack',
    attackerId: attacker.id,
    attackerKind: attacker.visualKind,
    from: { ...attacker.pos },
    to: { ...targetPos },
    arc: attacker.weapon.arc,
    hit: true,
    damage: fc.finalDamage,
    targetId: defender.id,
    matchup: fc.matchup,
    status: appliedStatusKind,
  });

  const matchupTag =
    fc.matchup === 'advantage' ? ' [STRONG!]' : fc.matchup === 'disadvantage' ? ' [WEAK]' : '';
  pushLog(
    state,
    `${attacker.name} hit ${defender.name} with ${attacker.weapon.name} for ${fc.finalDamage} dmg${matchupTag}!`
  );

  // Bramble Thorns Graft + Character Thorns perks recoil!
  const defenderFx = getUnitPerkEffects(defender);
  const totalThorns = (hasGraft(defender, 'thorn_recoil') ? 2 : 0) + defenderFx.thornsDmg;
  if (totalThorns > 0 && attacker.alive) {
    attacker.hp -= totalThorns;
    state.pendingEvents.push({
      type: 'status_tick',
      unitId: attacker.id,
      pos: { ...attacker.pos },
      status: 'rooted',
      damage: totalThorns,
    });
    pushLog(state, `${defender.name}'s Thorns pricked ${attacker.name} for ${totalThorns} dmg!`);
    handleUnitKO(state, attacker);
  }

  const defenderWasAlive = defender.alive;
  handleUnitKO(state, defender);

  // Mario + Rabbids Partner Follow-Up Assist (+1/+2 bonus DMG from an ally!)
  if (defender.alive && fc.partnerAssistUnitId && fc.partnerAssistDamage) {
    const assistAlly = getUnitById(state, fc.partnerAssistUnitId);
    if (assistAlly && assistAlly.alive && !hasStatus(assistAlly, 'rooted')) {
      if (defender.pos.x !== assistAlly.pos.x) {
        assistAlly.facing = defender.pos.x > assistAlly.pos.x ? 'right' : 'left';
      }
      defender.hp -= fc.partnerAssistDamage;
      state.pendingEvents.push({
        type: 'partner_assist',
        allyId: assistAlly.id,
        allyKind: assistAlly.visualKind,
        targetId: defender.id,
        from: { ...assistAlly.pos },
        to: { ...defender.pos },
        damage: fc.partnerAssistDamage,
      });
      pushLog(
        state,
        `PARTNER ASSIST! ${assistAlly.name} piled on ${defender.name} for +${fc.partnerAssistDamage} DMG!`
      );
      handleUnitKO(state, defender);
    }
  }

  // On-Kill Character Perk Synergies (Citric Meltdown 3x3 Acid, Dash Refresh & Skill CD Reset!)
  if (defenderWasAlive && !defender.alive) {
    if (attackerFx.acidExplosionOnKill && (wasDefenderAcid || appliedStatusKind === 'acid')) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const p = { x: defender.pos.x + dx, y: defender.pos.y + dy };
          const foe = inBounds(state, p) ? unitAt(state, p) : undefined;
          if (foe && foe.team !== attacker.team && foe.alive) {
            foe.hp -= 3;
            applyStatusToUnit(foe, 'acid', 2);
            state.pendingEvents.push({
              type: 'status_tick',
              unitId: foe.id,
              pos: { ...foe.pos },
              status: 'acid',
              damage: 3,
            });
            handleUnitKO(state, foe);
          }
        }
      }
      pushLog(state, `CITRIC MELTDOWN! ${defender.name} burst in a 3×3 Acid splash (-3 DMG)!`);
    }
    if (attackerFx.killRefreshesDash) {
      attacker.actions.dashesUsed = Math.max(0, (attacker.actions.dashesUsed ?? 1) - 1);
      attacker.actions.hasDashed = false;
    }
    if (attackerFx.killRefundsCd) {
      attacker.abilityCooldown = 0;
    }
  }

  // Weapon Knockback (+ extraKnockback & bonusBumpDmg perks!)
  const totalKnockback = (attacker.weapon.knockback ?? 0) + attackerFx.extraKnockback;
  if (defender.alive && totalKnockback > 0) {
    const pushDir = fc.knockbackDir ?? computePushDirection(attacker.pos, defender.pos);
    applyKnockback(state, defender, pushDir, rosterLookup, new Set(), attackerFx.bonusBumpDmg);
  }

  // Lobbed AoE splash (e.g. Zestia's Citrus Mortar, Corn-elius, Pesticide Pete, Captain Scarecrow)
  if (attacker.weapon.aoeRadius && attacker.weapon.aoeRadius > 0) {
    applyWeaponSplash(state, attacker, targetPos, defender.id, rosterLookup);
  }

  // Pierce weapon (Carroteer / Snap-Pea Railpod / Citric Beam): skewers 1 tile behind target along cardinal line!
  if (attacker.weapon.arc === 'pierce') {
    const dx = targetPos.x - attacker.pos.x;
    const dy = targetPos.y - attacker.pos.y;
    if (dx === 0 || dy === 0) {
      const behind: GridPos = {
        x: targetPos.x + Math.sign(dx),
        y: targetPos.y + Math.sign(dy),
      };
      if (inBounds(state, behind)) {
        const behindUnit = unitAt(state, behind);
        const behindTile = tileAt(state, behind);
        if (behindUnit && behindUnit.team !== attacker.team) {
          const pierceDmg = Math.max(1, Math.round(fc.finalDamage * 0.75));
          behindUnit.hp -= pierceDmg;
          state.pendingEvents.push({
            type: 'status_tick',
            unitId: behindUnit.id,
            pos: { ...behind },
            status: 'acid',
            damage: pierceDmg,
          });
          pushLog(state, `${attacker.weapon.name} pierced through to ${behindUnit.name} for ${pierceDmg} dmg!`);
          handleUnitKO(state, behindUnit);
        } else if (behindTile?.cover) {
          damageCoverAt(
            state,
            behind,
            fc.coverDamage,
            attacker.team,
            rosterLookup,
            new Set(),
            { x: Math.sign(dx), y: Math.sign(dy) }
          );
        }
      }
    }
  }

  checkBattleEnd(state);
  return true;
}

function applyWeaponSplash(
  state: BattleState,
  attacker: BattleUnit,
  center: GridPos,
  excludeUnitId: string | undefined,
  rosterLookup?: RosterHero[]
): void {
  const radius = attacker.weapon.aoeRadius ?? 0;
  const splashDmg = Math.max(1, Math.floor(attacker.weapon.damage / 2));

  for (let y = center.y - radius; y <= center.y + radius; y++) {
    for (let x = center.x - radius; x <= center.x + radius; x++) {
      const p = { x, y };
      if (samePos(p, center) || !inBounds(state, p)) continue;
      if (chebyshev(center, p) > radius) continue;

      const t = tileAt(state, p);
      const covDmg = Math.max(2, Math.floor(attacker.weapon.coverDamage / 2));
      if (t?.cover && t.cover.destructible) {
        damageCoverAt(state, p, covDmg, attacker.team, rosterLookup, new Set(), computePushDirection(center, p));
      }
      if (t?.terrain === 'bridge') {
        damageBridgeAt(state, p, covDmg);
      }

      const u = unitAt(state, p);
      if (u && u.id !== excludeUnitId && u.team !== attacker.team) {
        u.hp -= splashDmg;
        if (attacker.weapon.appliesStatus) {
          applyStatusToUnit(u, attacker.weapon.appliesStatus.kind, attacker.weapon.appliesStatus.turns);
        }
        state.pendingEvents.push({
          type: 'status_tick',
          unitId: u.id,
          pos: { ...u.pos },
          status: attacker.weapon.appliesStatus?.kind ?? 'burn',
          damage: splashDmg,
        });
        pushLog(state, `${attacker.weapon.name} splashed ${u.name} for ${splashDmg} dmg!`);
        handleUnitKO(state, u);
      }
    }
  }
}

export function getAbilityTargetTiles(state: BattleState, unit: BattleUnit): GridPos[] {
  if (unit.isEscortCart || !unit.ability || unit.actions.hasUsedSkill || unit.abilityCooldown > 0) return [];
  const ab = unit.ability;
  if (ab.targetType === 'self' || ab.targetType === 'aoe_self') {
    return [{ ...unit.pos }];
  }
  const out: GridPos[] = [];
  for (let y = 0; y < state.height; y++) {
    for (let x = 0; x < state.width; x++) {
      const p = { x, y };
      if (manhattan(unit.pos, p) > ab.range) continue;
      const occupant = unitAt(state, p);
      if (ab.targetType === 'ally' && occupant && occupant.team === unit.team) {
        out.push(p);
      } else if (ab.targetType === 'enemy' && occupant && occupant.team !== unit.team) {
        out.push(p);
      } else if (ab.targetType === 'tile') {
        out.push(p);
      }
    }
  }
  return out;
}

export function executeAbility(state: BattleState, unitId: string, targetPos: GridPos): boolean {
  if (state.status !== 'ongoing' || state.prepPhase) return false;
  const unit = getUnitById(state, unitId);
  if (!unit || !unit.alive || unit.isEscortCart || !unit.ability || unit.actions.hasUsedSkill || unit.abilityCooldown > 0) {
    return false;
  }

  const ab = unit.ability;
  const dist = manhattan(unit.pos, targetPos);
  if (ab.targetType !== 'self' && ab.targetType !== 'aoe_self' && dist > ab.range) return false;

  // Validate unit targets BEFORE consuming skill slot / cooldown / undo snapshot
  if (ab.targetType === 'ally') {
    const ally = unitAt(state, targetPos);
    if (!ally || ally.team !== unit.team) return false;
  } else if (ab.targetType === 'enemy') {
    const enemy = unitAt(state, targetPos);
    if (!enemy || enemy.team === unit.team) return false;
  }

  state.undoSnapshot = null;
  unit.actions.hasUsedSkill = true;
  unit.abilityCooldown = getCooldownForUnit(state, ab.cooldown, unit.team, unit);

  const fx = getUnitPerkEffects(unit);
  const effHeal = (ab.heal ?? 0) + (ab.heal ? fx.skillHealDelta : 0);
  const effDmg = (ab.damage ?? 0) + (ab.damage ? fx.skillDmgDelta : 0);
  const effRadius = (ab.aoeRadius ?? (ab.targetType === 'aoe_self' ? 2 : 0)) + fx.skillRadiusDelta;
  const cleanseUnit = (target: BattleUnit) => {
    if (!fx.cleanseOnSkillCast) return;
    target.statuses = target.statuses.filter(
      (s) => s.kind !== 'burn' && s.kind !== 'acid' && s.kind !== 'rooted' && s.kind !== 'feared'
    );
  };

  const affectedIds: string[] = [];

  if (ab.targetType === 'self') {
    if (effHeal > 0) {
      unit.hp = Math.min(unit.maxHp, unit.hp + effHeal);
    }
    cleanseUnit(unit);
    if (ab.appliesStatus) {
      applyStatusToUnit(unit, ab.appliesStatus.kind, ab.appliesStatus.turns);
    }
    affectedIds.push(unit.id);
  } else if (ab.targetType === 'aoe_self') {
    for (const ally of state.units) {
      if (!ally.alive || ally.team !== unit.team) continue;
      if (manhattan(unit.pos, ally.pos) <= effRadius) {
        if (effHeal > 0) ally.hp = Math.min(ally.maxHp, ally.hp + effHeal);
        cleanseUnit(ally);
        if (ab.appliesStatus) applyStatusToUnit(ally, ab.appliesStatus.kind, ab.appliesStatus.turns);
        affectedIds.push(ally.id);
      }
    }
    if (fx.skillPushes) {
      for (const foe of state.units) {
        if (!foe.alive || foe.team === unit.team) continue;
        if (manhattan(unit.pos, foe.pos) <= Math.max(1, effRadius)) {
          applyKnockback(state, foe, computePushDirection(unit.pos, foe.pos), undefined, new Set(), fx.bonusBumpDmg);
        }
      }
    }
  } else if (ab.targetType === 'ally') {
    const ally = unitAt(state, targetPos);
    if (!ally || ally.team !== unit.team) return false;
    if (effHeal > 0) ally.hp = Math.min(ally.maxHp, ally.hp + effHeal);
    cleanseUnit(ally);
    if (ab.appliesStatus) applyStatusToUnit(ally, ab.appliesStatus.kind, ab.appliesStatus.turns);
    affectedIds.push(ally.id);
  } else if (ab.targetType === 'enemy') {
    const enemy = unitAt(state, targetPos);
    if (!enemy || enemy.team === unit.team) return false;
    if (effDmg > 0) {
      enemy.hp -= effDmg;
      handleUnitKO(state, enemy);
    }
    if (ab.appliesStatus && enemy.alive) {
      applyStatusToUnit(enemy, ab.appliesStatus.kind, ab.appliesStatus.turns);
    }
    affectedIds.push(enemy.id);
  } else if (ab.targetType === 'tile') {
    for (let y = targetPos.y - effRadius; y <= targetPos.y + effRadius; y++) {
      for (let x = targetPos.x - effRadius; x <= targetPos.x + effRadius; x++) {
        const p = { x, y };
        if (!inBounds(state, p) || chebyshev(targetPos, p) > effRadius) continue;
        const target = unitAt(state, p);
        if (target && target.team !== unit.team) {
          if (effDmg > 0) {
            target.hp -= effDmg;
            handleUnitKO(state, target);
          }
          if (ab.appliesStatus && target.alive) {
            applyStatusToUnit(target, ab.appliesStatus.kind, ab.appliesStatus.turns);
          }
          if (((ab.knockback && ab.knockback > 0) || fx.skillPushes) && target.alive) {
            const origin = samePos(target.pos, targetPos) ? unit.pos : targetPos;
            applyKnockback(state, target, computePushDirection(origin, target.pos), undefined, new Set(), fx.bonusBumpDmg);
          }
          affectedIds.push(target.id);
        }
      }
    }
  }

  // Self-heal & Free-Move skill cast perks!
  if (fx.healOnSkillCast > 0 && unit.alive && unit.hp < unit.maxHp) {
    const bloomHeal = Math.min(fx.healOnSkillCast, unit.maxHp - unit.hp);
    unit.hp += bloomHeal;
    state.pendingEvents.push({
      type: 'heal',
      unitId: unit.id,
      pos: { ...unit.pos },
      amount: bloomHeal,
      source: ab.name,
    });
  }
  if (fx.skillGrantsFreeMove && unit.alive) {
    unit.actions.hasMoved = false;
    unit.actions.moveSpent = 0;
    pushLog(state, `${unit.name} gained a FREE Move from ${ab.name}!`);
  }

  state.pendingEvents.push({
    type: 'ability',
    unitId: unit.id,
    abilityName: ab.name,
    from: { ...unit.pos },
    to: { ...targetPos },
    affectedIds,
    heal: effHeal || undefined,
    damage: effDmg || undefined,
    status: ab.appliesStatus?.kind,
  });
  pushLog(state, `${unit.name} used ${ab.name}!`);
  checkBattleEnd(state);
  return true;
}

export function getItemTargetTiles(state: BattleState, unit: BattleUnit, itemId: string): GridPos[] {
  const item = ITEM_REGISTRY[itemId];
  if (unit.isEscortCart || !item || unit.actions.hasUsedSkill || (state.items[itemId] ?? 0) <= 0) return [];

  const out: GridPos[] = [];
  for (let y = 0; y < state.height; y++) {
    for (let x = 0; x < state.width; x++) {
      const p = { x, y };
      if (manhattan(unit.pos, p) > item.range) continue;
      if (item.targetType === 'ally') {
        const u = unitAt(state, p);
        if (u && u.team === unit.team) out.push(p);
      } else {
        out.push(p);
      }
    }
  }
  return out;
}

export function executeItem(
  state: BattleState,
  unitId: string,
  itemId: string,
  targetPos: GridPos,
  rosterLookup?: RosterHero[]
): boolean {
  if (state.status !== 'ongoing' || state.prepPhase) return false;
  const unit = getUnitById(state, unitId);
  const item = ITEM_REGISTRY[itemId];
  if (!unit || !unit.alive || unit.isEscortCart || !item || unit.actions.hasUsedSkill) return false;
  if ((state.items[itemId] ?? 0) <= 0) return false;
  if (manhattan(unit.pos, targetPos) > item.range) return false;

  // Validate ally target BEFORE consuming item or skill slot
  if (item.targetType === 'ally') {
    const ally = unitAt(state, targetPos);
    if (!ally || ally.team !== unit.team) return false;
  }

  state.undoSnapshot = null;
  state.items[itemId] = (state.items[itemId] ?? 1) - 1;
  unit.actions.hasUsedSkill = true;

  const affectedIds: string[] = [];

  if (item.targetType === 'ally') {
    const ally = unitAt(state, targetPos);
    if (!ally || ally.team !== unit.team) return false;
    if (item.heal) {
      ally.hp = Math.min(ally.maxHp, ally.hp + item.heal);
    }
    affectedIds.push(ally.id);
  } else {
    const r = item.aoeRadius;
    for (let y = targetPos.y - r; y <= targetPos.y + r; y++) {
      for (let x = targetPos.x - r; x <= targetPos.x + r; x++) {
        const p = { x, y };
        if (!inBounds(state, p) || chebyshev(targetPos, p) > r) continue;

        const t = tileAt(state, p);
        if (t?.cover && item.coverDamage) {
          damageCoverAt(
            state,
            p,
            item.coverDamage,
            unit.team,
            rosterLookup,
            new Set(),
            samePos(p, targetPos) ? computePushDirection(unit.pos, p) : computePushDirection(targetPos, p)
          );
        }
        if (t?.terrain === 'bridge' && item.coverDamage) {
          damageBridgeAt(state, p, item.coverDamage);
        }

        const enemy = unitAt(state, p);
        if (enemy && enemy.team !== unit.team) {
          if (item.damage) {
            enemy.hp -= item.damage;
            handleUnitKO(state, enemy);
          }
          if (item.appliesStatus && enemy.alive) {
            applyStatusToUnit(enemy, item.appliesStatus.kind, item.appliesStatus.turns);
          }
          affectedIds.push(enemy.id);
        }
      }
    }
  }

  state.pendingEvents.push({
    type: 'item',
    unitId: unit.id,
    itemName: item.name,
    from: { ...unit.pos },
    to: { ...targetPos },
    affectedIds,
    heal: item.heal,
    damage: item.damage,
    status: item.appliesStatus?.kind,
  });
  pushLog(state, `${unit.name} used ${item.name}!`);
  checkBattleEnd(state);
  return true;
}

/**
 * Spawns enemy reinforcement waves on 'survive' ("Hold the Patch") missions at Turns 2 & 3!
 */
function spawnSurviveReinforcements(state: BattleState): void {
  if (state.objective !== 'survive' || (state.turn !== 2 && state.turn !== 3)) return;
  const candidateSpots: GridPos[] = [];
  // Prefer northern burrows first, then open north edge tiles (y <= 1)
  for (let y = 0; y <= 2; y++) {
    for (let x = 0; x < state.width; x++) {
      const t = state.tiles[y][x];
      if (t.terrain === 'burrow' && !t.cover && !unitAt(state, { x, y })) {
        candidateSpots.push({ x, y });
      }
    }
  }
  for (let y = 0; y <= 1; y++) {
    for (let x = 0; x < state.width; x++) {
      const t = state.tiles[y][x];
      if (
        !t.cover &&
        !isHazardLiquid(t.terrain) &&
        !unitAt(state, { x, y }) &&
        !candidateSpots.some((c) => samePos(c, { x, y }))
      ) {
        candidateSpots.push({ x, y });
      }
    }
  }

  const waveBlueprints = state.turn === 2 ? ['trimmer', 'digger'] : ['mower', 'sprayer'];
  let spawned = 0;
  for (let i = 0; i < waveBlueprints.length && i < candidateSpots.length; i++) {
    const pos = candidateSpots[i];
    const bpId = waveBlueprints[i];
    const enemy = createBattleUnitFromEnemy(bpId, state.units.length + i, pos);
    enemy.id = `reinf_${bpId}_t${state.turn}_${i}`;
    enemy.facing = pos.x < state.width / 2 ? 'right' : 'left';
    if ((state.harvestHeat ?? 0) >= 1) {
      enemy.maxHp = Math.ceil(enemy.maxHp * 1.15);
      enemy.hp = enemy.maxHp;
    }
    if ((state.harvestHeat ?? 0) >= 5) {
      enemy.weapon.damage += 1;
    }
    state.units.push(enemy);
    state.pendingEvents.push({
      type: 'reinforcement_spawn',
      unitId: enemy.id,
      unitName: enemy.name,
      pos: { ...pos },
    });
    spawned += 1;
  }
  if (spawned > 0) {
    pushLog(state, `REINFORCEMENTS! ${spawned} fresh farmhand(s) burst from the northern burrows!`);
  }
}

/**
 * Advances the Golden Seed Cart up to 2 tiles north toward the Gate on 'escort' missions!
 */
function advanceEscortSeedCart(state: BattleState): void {
  if (state.objective !== 'escort') return;
  const cart = state.units.find((u) => u.isEscortCart && u.alive);
  if (!cart) return;

  const targetGate = state.gateTiles[Math.floor(state.gateTiles.length / 2)] ?? {
    x: Math.floor(state.width / 2),
    y: 0,
  };
  const startPos = { ...cart.pos };

  for (let step = 0; step < 2; step++) {
    if (state.gateTiles.some((g) => samePos(cart.pos, g))) break;
    const dxToGate = Math.sign(targetGate.x - cart.pos.x);
    const tryOrder: GridPos[] = [
      { x: cart.pos.x, y: cart.pos.y - 1 },
      ...(dxToGate !== 0 ? [{ x: cart.pos.x + dxToGate, y: cart.pos.y }] : []),
      { x: cart.pos.x - 1, y: cart.pos.y },
      { x: cart.pos.x + 1, y: cart.pos.y },
    ];
    let stepped = false;
    for (const next of tryOrder) {
      if (!inBounds(state, next)) continue;
      const nt = tileAt(state, next);
      if (!nt || nt.cover || isHazardLiquid(nt.terrain)) continue;
      if (unitAt(state, next)) continue;
      cart.pos = { ...next };
      stepped = true;
      break;
    }
    if (!stepped) break;
  }

  if (!samePos(startPos, cart.pos)) {
    state.pendingEvents.push({
      type: 'escort_move',
      unitId: cart.id,
      from: startPos,
      to: { ...cart.pos },
    });
    pushLog(state, `Golden Seed Cart rolled north to (${cart.pos.x}, ${cart.pos.y})!`);
  }
}

export function startPhase(state: BattleState, nextPhase: 'player' | 'enemy'): void {
  if (state.status !== 'ongoing' || state.prepPhase) return;
  const prevPhase = state.phase;
  state.undoSnapshot = null;

  // End-of-phase duration ticks BEFORE switching phases:
  // - Movement debuffs (rooted, feared) tick down when the affected team finishes its turn
  //   so 1-turn Rooted/Feared always lasts through the target's full turn!
  // - Acid ticks down when the opposing attacking team finishes its turn.
  for (const unit of state.units) {
    if (!unit.alive) continue;
    if (unit.team === prevPhase) {
      unit.statuses = unit.statuses
        .map((s) =>
          s.kind === 'rooted' || s.kind === 'feared' ? { ...s, turns: s.turns - 1 } : s
        )
        .filter((s) => s.turns > 0);
    } else {
      unit.statuses = unit.statuses
        .map((s) => (s.kind === 'acid' ? { ...s, turns: s.turns - 1 } : s))
        .filter((s) => s.turns > 0);
    }
  }

  state.phase = nextPhase;

  if (nextPhase === 'player') {
    state.turn += 1;
    // Check survive victory right when entering turn > surviveTurns!
    if (state.objective === 'survive' && state.turn > (state.surviveTurns ?? 4)) {
      checkBattleEnd(state);
      return;
    }
    state.pendingEvents.push({
      type: 'banner',
      text: `PRODUCE PHASE — TURN ${state.turn}`,
      tone: 'player',
    });
    spawnSurviveReinforcements(state);
    advanceEscortSeedCart(state);
    checkBattleEnd(state);
    if (state.status !== 'ongoing') return;
  } else {
    state.pendingEvents.push({
      type: 'banner',
      text: 'FARMER PHASE',
      tone: 'enemy',
    });
    resolveBossTelegraphs(state);
    if (state.status !== 'ongoing') return;
  }

  for (const unit of state.units) {
    if (!unit.alive || unit.team !== nextPhase) continue;

    if (!unit.isEscortCart) {
      unit.actions = emptyActions();
      unit.tempAttackBonus = 0;
      if (unit.abilityCooldown > 0) unit.abilityCooldown -= 1;
    }

    // Burn damage tick (deals damage first, then ticks down)
    const burn = unit.statuses.find((s) => s.kind === 'burn' && s.turns > 0);
    if (burn) {
      unit.hp -= 2;
      state.pendingEvents.push({
        type: 'status_tick',
        unitId: unit.id,
        pos: { ...unit.pos },
        status: 'burn',
        damage: 2,
      });
      pushLog(state, `${unit.name} sizzled from Burn (-2 HP)!`);
      handleUnitKO(state, unit);
    }

    if (!unit.alive) continue;

    // Start-of-phase duration ticks for Burn (post-tick), Overwatch expiry, and self/ally buffs
    unit.statuses = unit.statuses
      .map((s) =>
        s.kind === 'burn' || s.kind === 'shield' || s.kind === 'boosted' || s.kind === 'overwatch'
          ? { ...s, turns: s.turns - 1 }
          : s
      )
      .filter((s) => s.turns > 0);

    // Rich Compost terrain heal (+2 HP for produce!)
    const standingTile = tileAt(state, unit.pos);
    if (unit.team === 'player' && standingTile?.terrain === 'compost' && unit.hp < unit.maxHp) {
      const heal = Math.min(2, unit.maxHp - unit.hp);
      unit.hp += heal;
      state.pendingEvents.push({
        type: 'heal',
        unitId: unit.id,
        pos: { ...unit.pos },
        amount: heal,
        source: 'Compost',
      });
      pushLog(state, `${unit.name} healed +${heal} HP on Rich Compost!`);
    }

    // Sweet Nectar graft regeneration (+2 HP!)
    if (hasGraft(unit, 'sweet_nectar') && unit.hp < unit.maxHp) {
      const heal = Math.min(2, unit.maxHp - unit.hp);
      unit.hp += heal;
      state.pendingEvents.push({
        type: 'heal',
        unitId: unit.id,
        pos: { ...unit.pos },
        amount: heal,
        source: 'Sweet Nectar',
      });
      pushLog(state, `${unit.name} regenerated +${heal} HP from Sweet Nectar!`);
    }
  }

  // Squad Rally / Springboard Boost character perks: Start-of-turn Boosted (+2 ATK) to adjacent allies!
  for (const unit of state.units) {
    if (!unit.alive || unit.team !== nextPhase) continue;
    if (!getUnitPerkEffects(unit).allyJumpBoost) continue;
    for (const adj of getNeighbors(state, unit.pos)) {
      const ally = unitAt(state, adj);
      if (ally && ally.alive && ally.team === unit.team) {
        applyStatusToUnit(ally, 'boosted', 1);
      }
    }
  }

  checkBattleEnd(state);
}
