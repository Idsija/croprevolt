import { ENEMY_BLUEPRINTS } from '../data/enemies';
import { ITEM_REGISTRY } from '../data/items';
import { MAP_TEMPLATES } from '../data/maps';
import { PRODUCE_BLUEPRINTS } from '../data/produce';
import { forecastAttack } from './combat';
import {
  chebyshev,
  createCover,
  getNeighbors,
  inBounds,
  manhattan,
  posKey,
  samePos,
  tileAt,
  unitAt,
} from './grid';
import {
  applyStatusToUnit,
  getCooldownForUnit,
  hasGraft,
  hasRelic,
  hasStatus,
} from './hooks';
import {
  computeDashOptions,
  computeMovableTiles,
  computeTeamJumpOptions,
} from './pathfinding';
import type {
  BattleState,
  BattleUnit,
  GridPos,
  RosterHero,
  Tile,
} from './types';

function emptyActions() {
  return {
    hasMoved: false,
    hasDashed: false,
    hasJumped: false,
    hasAttacked: false,
    hasUsedSkill: false,
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
    dashStatus: hero.dashStatus ? { ...hero.dashStatus } : undefined,
    weapon: { ...hero.weapon, appliesStatus: hero.weapon.appliesStatus ? { ...hero.weapon.appliesStatus } : undefined },
    ability: { ...hero.ability, appliesStatus: hero.ability.appliesStatus ? { ...hero.ability.appliesStatus } : undefined },
    abilityCooldown: 0,
    graftIds: [...hero.graftIds],
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
  return unit;
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
  return enemyUnit;
}

export function createBattleFromMap(
  mapId: string,
  activeHeroes: RosterHero[],
  relicIds: string[],
  items: Record<string, number>,
  captiveInfo?: { hero?: RosterHero; blueprintId?: string }
): BattleState {
  const map = MAP_TEMPLATES[mapId];
  if (!map) throw new Error(`Unknown map template: ${mapId}`);

  const tiles: Tile[][] = [];
  for (let y = 0; y < map.height; y++) {
    const row: Tile[] = [];
    for (let x = 0; x < map.width; x++) {
      row.push({ x, y, terrain: 'grass', cover: null });
    }
    tiles.push(row);
  }

  for (const spec of map.tiles) {
    if (spec.y < 0 || spec.y >= map.height || spec.x < 0 || spec.x >= map.width) continue;
    const tile = tiles[spec.y][spec.x];
    if (spec.terrain) tile.terrain = spec.terrain;
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
    units.push(unit);
  });

  let diggerCounter = 0;
  map.enemySpawns.forEach((spawn, i) => {
    const variantIdx = spawn.blueprintId === 'digger' ? diggerCounter++ : i;
    const enemy = createBattleUnitFromEnemy(spawn.blueprintId, variantIdx, { x: spawn.x, y: spawn.y });
    enemy.id = `enemy_${spawn.blueprintId}_${i}`;
    enemy.facing = spawn.x < map.width / 2 ? 'right' : 'left';
    units.push(enemy);
  });

  return {
    mapId: map.id,
    mapName: map.name,
    objective: map.objective,
    objectiveLabel: map.objectiveLabel,
    width: map.width,
    height: map.height,
    tiles,
    units,
    turn: 1,
    phase: 'player',
    status: 'ongoing',
    relicIds: [...relicIds],
    items: { ...items },
    gateTiles: map.gateTiles ? map.gateTiles.map((g) => ({ ...g })) : [],
    rescuedHeroUids: [],
    rescuedNewBlueprintIds: [],
    combatLog: [`Battle started: ${map.name} — ${map.objectiveLabel}`],
    pendingEvents: [{ type: 'banner', text: 'PRODUCE PHASE — TURN 1', tone: 'player' }],
    undoSnapshot: null,
  };
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

  const alivePlayers = state.units.filter((u) => u.team === 'player' && u.alive);
  const aliveEnemies = state.units.filter((u) => u.team === 'enemy' && u.alive);

  if (alivePlayers.length === 0) {
    state.status = 'defeat';
    state.pendingEvents.push({ type: 'banner', text: 'SQUAD HARVESTED!', tone: 'defeat' });
    pushLog(state, 'All produce heroes were bagged by the farmers!');
    return;
  }

  if (state.objective === 'boss') {
    const bossAlive = aliveEnemies.some((e) => e.isBoss);
    if (!bossAlive) {
      state.status = 'victory';
      state.pendingEvents.push({ type: 'banner', text: 'HARVEST REVOLT VICTORY!', tone: 'victory' });
      pushLog(state, 'Captain Scarecrow toppled! The garden is yours!');
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
  }
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

function damageCoverAt(
  state: BattleState,
  pos: GridPos,
  amount: number,
  attackerTeam: 'player' | 'enemy',
  rosterLookup?: RosterHero[]
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

export function executeMove(state: BattleState, unitId: string, dest: GridPos): boolean {
  if (state.status !== 'ongoing') return false;
  const unit = getUnitById(state, unitId);
  if (!unit || !unit.alive || unit.actions.hasMoved) return false;

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
  unit.actions.hasMoved = true;

  state.pendingEvents.push({
    type: 'move',
    unitId: unit.id,
    path: node.path.map((p) => ({ ...p })),
  });

  checkBattleEnd(state);
  return true;
}

export function executeDash(state: BattleState, unitId: string, targetEnemyId: string): boolean {
  if (state.status !== 'ongoing') return false;
  const unit = getUnitById(state, unitId);
  if (!unit || !unit.alive || unit.actions.hasDashed || unit.actions.hasMoved) return false;

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

  // Move to stopPos adjacent to enemy; hero can STILL finish normal Move or Team-Jump afterwards!
  unit.pos = { ...opt.stopPos };
  unit.actions.hasDashed = true;

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

  handleUnitKO(state, target);
  checkBattleEnd(state);
  return true;
}

export function executeTeamJump(state: BattleState, unitId: string, dest: GridPos): boolean {
  if (state.status !== 'ongoing') return false;
  const unit = getUnitById(state, unitId);
  if (!unit || !unit.alive || unit.team !== 'player' || unit.actions.hasMoved || unit.actions.hasJumped) {
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
  unit.actions.hasMoved = true;

  if (hasRelic(state.relicIds, 'bouncy_mulch')) {
    unit.tempAttackBonus = Math.min(3, unit.tempAttackBonus + 2);
    pushLog(state, `Bouncy Mulch energized ${unit.name} (+2 Attack this turn)!`);
  }

  // Barnyard Co-op: Team-Jumping off Cluck Norris launches +2 tiles & grants +2 Attack (stacked jump bonus caps at +3)!
  const springboardAlly = getUnitById(state, opt.allyId);
  if (springboardAlly?.launchpadCoop) {
    unit.tempAttackBonus = Math.min(3, unit.tempAttackBonus + 2);
    pushLog(state, `CO-OP LAUNCH! ${springboardAlly.name} boosted ${unit.name} (+${unit.tempAttackBonus} Attack this turn)!`);
  }

  state.pendingEvents.push({
    type: 'jump',
    unitId: unit.id,
    allyPos: { ...opt.allyPos },
    from,
    to: { ...dest },
  });
  pushLog(state, `${unit.name} Team-Jumped across the garden!`);

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
  if (state.status !== 'ongoing') return false;
  const attacker = getUnitById(state, unitId);
  if (!attacker || !attacker.alive) return false;

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

  // Case A: Attacking destructible cover / Barn Cage directly (or lobbing at empty tile)
  if (!defender) {
    let coverDestroyed = false;
    if (targetTile?.cover) {
      coverDestroyed = damageCoverAt(state, targetPos, fc.coverDamage, attacker.team, rosterLookup);
    }

    state.pendingEvents.push({
      type: 'attack',
      attackerId: attacker.id,
      from: { ...attacker.pos },
      to: { ...targetPos },
      arc: attacker.weapon.arc,
      hit: true,
      damage: fc.coverDamage,
      matchup: 'neutral',
      coverHitPos: targetTile?.cover || coverDestroyed ? { ...targetPos } : undefined,
      coverDestroyed,
    });

    // Lobbed AoE splash on empty/cover tile!
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
      coverDestroyed = damageCoverAt(state, fc.coverPos, fc.coverDamage, attacker.team, rosterLookup);
    }
    state.pendingEvents.push({
      type: 'attack',
      attackerId: attacker.id,
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
  defender.hp -= fc.finalDamage;
  let appliedStatusKind = fc.appliesStatus;
  if (attacker.weapon.appliesStatus) {
    applyStatusToUnit(defender, attacker.weapon.appliesStatus.kind, attacker.weapon.appliesStatus.turns);
  }
  if (fc.hitChance === 100 && hasGraft(attacker, 'spicy_shot')) {
    applyStatusToUnit(defender, 'burn', 2);
    if (!appliedStatusKind) appliedStatusKind = 'burn';
  }

  state.pendingEvents.push({
    type: 'attack',
    attackerId: attacker.id,
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

  // Bramble Thorns Graft recoil!
  if (hasGraft(defender, 'thorn_recoil') && attacker.alive) {
    attacker.hp -= 2;
    state.pendingEvents.push({
      type: 'status_tick',
      unitId: attacker.id,
      pos: { ...attacker.pos },
      status: 'rooted',
      damage: 2,
    });
    pushLog(state, `${defender.name}'s Bramble Thorns pricked ${attacker.name} for 2 dmg!`);
    handleUnitKO(state, attacker);
  }

  handleUnitKO(state, defender);

  // Lobbed AoE splash (e.g. Zestia's Citrus Mortar, Pesticide Pete, Captain Scarecrow)
  if (attacker.weapon.aoeRadius && attacker.weapon.aoeRadius > 0) {
    applyWeaponSplash(state, attacker, targetPos, defender.id, rosterLookup);
  }

  // Pierce weapon (Carroteer): skewers 1 tile behind target along cardinal line!
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
          pushLog(state, `Taproot Lance pierced through to ${behindUnit.name} for ${pierceDmg} dmg!`);
          handleUnitKO(state, behindUnit);
        } else if (behindTile?.cover) {
          damageCoverAt(state, behind, fc.coverDamage, attacker.team, rosterLookup);
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
      if (t?.cover && t.cover.destructible) {
        damageCoverAt(state, p, Math.max(2, Math.floor(attacker.weapon.coverDamage / 2)), attacker.team, rosterLookup);
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
  if (!unit.ability || unit.actions.hasUsedSkill || unit.abilityCooldown > 0) return [];
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
  if (state.status !== 'ongoing') return false;
  const unit = getUnitById(state, unitId);
  if (!unit || !unit.alive || !unit.ability || unit.actions.hasUsedSkill || unit.abilityCooldown > 0) {
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
  unit.abilityCooldown = getCooldownForUnit(state, ab.cooldown, unit.team);

  const affectedIds: string[] = [];

  if (ab.targetType === 'self') {
    if (ab.heal) {
      unit.hp = Math.min(unit.maxHp, unit.hp + ab.heal);
    }
    if (ab.appliesStatus) {
      applyStatusToUnit(unit, ab.appliesStatus.kind, ab.appliesStatus.turns);
    }
    affectedIds.push(unit.id);
  } else if (ab.targetType === 'aoe_self') {
    const r = ab.aoeRadius ?? 2;
    for (const ally of state.units) {
      if (!ally.alive || ally.team !== unit.team) continue;
      if (manhattan(unit.pos, ally.pos) <= r) {
        if (ab.heal) ally.hp = Math.min(ally.maxHp, ally.hp + ab.heal);
        if (ab.appliesStatus) applyStatusToUnit(ally, ab.appliesStatus.kind, ab.appliesStatus.turns);
        affectedIds.push(ally.id);
      }
    }
  } else if (ab.targetType === 'ally') {
    const ally = unitAt(state, targetPos);
    if (!ally || ally.team !== unit.team) return false;
    if (ab.heal) ally.hp = Math.min(ally.maxHp, ally.hp + ab.heal);
    if (ab.appliesStatus) applyStatusToUnit(ally, ab.appliesStatus.kind, ab.appliesStatus.turns);
    affectedIds.push(ally.id);
  } else if (ab.targetType === 'enemy') {
    const enemy = unitAt(state, targetPos);
    if (!enemy || enemy.team === unit.team) return false;
    if (ab.damage) {
      enemy.hp -= ab.damage;
      handleUnitKO(state, enemy);
    }
    if (ab.appliesStatus && enemy.alive) {
      applyStatusToUnit(enemy, ab.appliesStatus.kind, ab.appliesStatus.turns);
    }
    affectedIds.push(enemy.id);
  } else if (ab.targetType === 'tile') {
    const r = ab.aoeRadius ?? 0;
    for (let y = targetPos.y - r; y <= targetPos.y + r; y++) {
      for (let x = targetPos.x - r; x <= targetPos.x + r; x++) {
        const p = { x, y };
        if (!inBounds(state, p) || chebyshev(targetPos, p) > r) continue;
        const target = unitAt(state, p);
        if (target && target.team !== unit.team) {
          if (ab.damage) {
            target.hp -= ab.damage;
            handleUnitKO(state, target);
          }
          if (ab.appliesStatus && target.alive) {
            applyStatusToUnit(target, ab.appliesStatus.kind, ab.appliesStatus.turns);
          }
          affectedIds.push(target.id);
        }
      }
    }
  }

  state.pendingEvents.push({
    type: 'ability',
    unitId: unit.id,
    abilityName: ab.name,
    from: { ...unit.pos },
    to: { ...targetPos },
    affectedIds,
    heal: ab.heal,
    damage: ab.damage,
    status: ab.appliesStatus?.kind,
  });
  pushLog(state, `${unit.name} used ${ab.name}!`);
  checkBattleEnd(state);
  return true;
}

export function getItemTargetTiles(state: BattleState, unit: BattleUnit, itemId: string): GridPos[] {
  const item = ITEM_REGISTRY[itemId];
  if (!item || unit.actions.hasUsedSkill || (state.items[itemId] ?? 0) <= 0) return [];

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
  if (state.status !== 'ongoing') return false;
  const unit = getUnitById(state, unitId);
  const item = ITEM_REGISTRY[itemId];
  if (!unit || !unit.alive || !item || unit.actions.hasUsedSkill) return false;
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
          damageCoverAt(state, p, item.coverDamage, unit.team, rosterLookup);
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

export function startPhase(state: BattleState, nextPhase: 'player' | 'enemy'): void {
  if (state.status !== 'ongoing') return;
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
    state.pendingEvents.push({
      type: 'banner',
      text: `PRODUCE PHASE — TURN ${state.turn}`,
      tone: 'player',
    });
  } else {
    state.pendingEvents.push({
      type: 'banner',
      text: 'FARMER PHASE',
      tone: 'enemy',
    });
  }

  for (const unit of state.units) {
    if (!unit.alive || unit.team !== nextPhase) continue;

    unit.actions = emptyActions();
    unit.tempAttackBonus = 0;
    if (unit.abilityCooldown > 0) unit.abilityCooldown -= 1;

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

    // Start-of-phase duration ticks for Burn (post-tick) and self/ally buffs (shield, boosted)
    unit.statuses = unit.statuses
      .map((s) =>
        s.kind === 'burn' || s.kind === 'shield' || s.kind === 'boosted'
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

  checkBattleEnd(state);
}
