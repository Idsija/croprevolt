import { reactive } from 'vue';
import { ITEM_REGISTRY } from '../data/items';
import { RECRUITABLE_BLUEPRINT_IDS } from '../data/produce';
import { runEnemyUnitTurn } from '../engine/ai';
import { battleRng, difficultyFor } from '../engine/difficulty';
import {
  createBattleFromMap,
  executeAbility,
  executeAttack,
  executeDash,
  executeItem,
  executeMove,
  executeTeamJump,
  getAbilityTargetTiles,
  getItemTargetTiles,
  getUnitById,
  startPhase,
  undoLastAction,
} from '../engine/battle';
import {
  forecastAttack,
  hasAnyPlayerActionRemaining,
  unitHasMeaningfulAction,
} from '../engine/combat';
import { posKey, samePos, unitAt } from '../engine/grid';
import {
  computeDashOptions,
  computeMovableTiles,
  computeTeamJumpOptions,
} from '../engine/pathfinding';
import {
  applyBattleOutcomeToRun,
  applyGraftToHero,
  buyMarketOffer,
  claimRecruitReward,
  claimRelicReward,
  clearSavedRun,
  createNewRun,
  finishRewardsAndReturnToMap,
  loadMetaProgress,
  loadSavedRun,
  openVaultNode,
  purchaseMetaUnlock,
  saveRun,
  toggleHeroActiveSquad,
} from '../engine/run';
import type {
  BattleEvent,
  BattleState,
  GridPos,
  MetaProgress,
  RunState,
  SeasonId,
} from '../engine/types';
import type { InteractionMode } from '../renderer/canvas';
import type { BoardViewMode } from '../renderer/iso';
import { sfx } from '../renderer/sfx';

const VIEW_MODE_KEY = 'crop_revolt_view_v2';
const AUTO_END_KEY = 'crop_revolt_auto_end_v1';

function loadInitialViewMode(): BoardViewMode {
  try {
    if (typeof localStorage !== 'undefined') {
      const saved = localStorage.getItem(VIEW_MODE_KEY);
      if (saved === 'iso' || saved === 'topdown') return saved;
    }
  } catch {
    // ignore
  }
  // Vertical 2.5D Tabletop is the browser- & mobile-first default!
  return 'topdown';
}

function loadAutoEndPref(): boolean {
  try {
    if (typeof localStorage !== 'undefined') {
      const saved = localStorage.getItem(AUTO_END_KEY);
      if (saved === '0') return false;
    }
  } catch {
    // ignore
  }
  return true;
}

export type ScreenView = 'title' | 'run';

export interface PreviewActionOption {
  kind: 'move' | 'jump' | 'dash' | 'attack' | 'ability' | 'item';
  label: string;
  tone: 'sky' | 'danger' | 'gold' | 'plum' | 'primary';
}

export interface GameStoreState {
  screen: ScreenView;
  meta: MetaProgress;
  run: RunState | null;
  savedRunAvailable: boolean;
  battle: BattleState | null;
  selectedUnitId: string | null;
  inspectedEnemyId: string | null;
  showAllDangerZone: boolean;
  mode: InteractionMode;
  selectedItemId: string | null;
  hoveredTile: GridPos | null;
  previewTile: GridPos | null;
  isTouchMode: boolean;
  viewMode: BoardViewMode;
  autoEndTurnEnabled: boolean;
  autoEndPending: boolean;
  enemyTurnRunning: boolean;
  muted: boolean;
  eventQueueVersion: number;
}

const initialMeta = loadMetaProgress();
const existingRun = loadSavedRun();

export const gameStore = reactive<GameStoreState>({
  screen: 'title',
  meta: initialMeta,
  run: null,
  savedRunAvailable: Boolean(
    existingRun && existingRun.status !== 'victory' && existingRun.status !== 'defeat'
  ),
  battle: null,
  selectedUnitId: null,
  inspectedEnemyId: null,
  showAllDangerZone: false,
  mode: 'move',
  selectedItemId: null,
  hoveredTile: null,
  previewTile: null,
  isTouchMode: false,
  viewMode: loadInitialViewMode(),
  autoEndTurnEnabled: loadAutoEndPref(),
  autoEndPending: false,
  enemyTurnRunning: false,
  muted: sfx.isMuted(),
  eventQueueVersion: 0,
});

export const AUTO_END_GRACE_MS = 2400;

const eventListeners = new Set<(events: BattleEvent[]) => void>();
const focusListeners = new Set<(pos: GridPos) => void>();
const undoResetListeners = new Set<() => void>();
let autoEndTimer: ReturnType<typeof setTimeout> | null = null;
let battleSessionId = 0;
let lastUndoUnitId: string | null = null;
let lastAutoAdvanceAt = 0;
let lastAutoAdvancePos: GridPos | null = null;

export function subscribeBattleEvents(fn: (events: BattleEvent[]) => void): () => void {
  eventListeners.add(fn);
  return () => eventListeners.delete(fn);
}

export function subscribeCameraFocus(fn: (pos: GridPos) => void): () => void {
  focusListeners.add(fn);
  return () => focusListeners.delete(fn);
}

export function subscribeUndoReset(fn: () => void): () => void {
  undoResetListeners.add(fn);
  return () => undoResetListeners.delete(fn);
}

function emitUndoReset(): void {
  for (const fn of undoResetListeners) fn();
}

function requestCameraFocus(pos: GridPos): void {
  for (const fn of focusListeners) fn(pos);
}

function dispatchBattleEvents(events: BattleEvent[]): void {
  if (events.length === 0) return;
  gameStore.eventQueueVersion += 1;
  for (const fn of eventListeners) {
    fn(events);
  }
}

function flushBattleEvents(): void {
  if (!gameStore.battle || gameStore.battle.pendingEvents.length === 0) return;
  const events = gameStore.battle.pendingEvents.splice(0);
  dispatchBattleEvents(events);
}

export function clearAutoEndTimer(): void {
  if (autoEndTimer !== null) {
    clearTimeout(autoEndTimer);
    autoEndTimer = null;
  }
  gameStore.autoEndPending = false;
}

function scheduleAutoEndCheck(): void {
  clearAutoEndTimer();
  const b = gameStore.battle;
  if (
    !b ||
    !gameStore.autoEndTurnEnabled ||
    b.status !== 'ongoing' ||
    b.phase !== 'player' ||
    gameStore.enemyTurnRunning
  ) {
    return;
  }
  if (!hasAnyPlayerActionRemaining(b)) {
    gameStore.autoEndPending = true;
    autoEndTimer = setTimeout(() => {
      autoEndTimer = null;
      gameStore.autoEndPending = false;
      if (
        gameStore.battle &&
        gameStore.battle.status === 'ongoing' &&
        gameStore.battle.phase === 'player' &&
        !hasAnyPlayerActionRemaining(gameStore.battle)
      ) {
        void endPlayerTurn();
      }
    }, AUTO_END_GRACE_MS);
  }
}

export function toggleAudioMute(): void {
  gameStore.muted = sfx.toggleMute();
}

export function toggleAllDangerZone(): boolean {
  sfx.click();
  gameStore.showAllDangerZone = !gameStore.showAllDangerZone;
  return gameStore.showAllDangerZone;
}

export function toggleInspectEnemy(enemyId: string): void {
  sfx.click();
  gameStore.inspectedEnemyId = gameStore.inspectedEnemyId === enemyId ? null : enemyId;
}

export function toggleAutoEndTurn(): boolean {
  sfx.click();
  gameStore.autoEndTurnEnabled = !gameStore.autoEndTurnEnabled;
  if (!gameStore.autoEndTurnEnabled) clearAutoEndTimer();
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(AUTO_END_KEY, gameStore.autoEndTurnEnabled ? '1' : '0');
    }
  } catch {
    // ignore
  }
  return gameStore.autoEndTurnEnabled;
}

export function toggleBoardViewMode(): BoardViewMode {
  sfx.click();
  gameStore.viewMode = gameStore.viewMode === 'iso' ? 'topdown' : 'iso';
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(VIEW_MODE_KEY, gameStore.viewMode);
    }
  } catch {
    // ignore
  }
  return gameStore.viewMode;
}

export function buyMetaUnlock(key: keyof MetaProgress['unlocks']): boolean {
  const ok = purchaseMetaUnlock(gameStore.meta, key);
  if (ok) sfx.rescue();
  return ok;
}

export function startNewSeasonRun(seasonId: SeasonId = 'spring'): void {
  sfx.click();
  battleSessionId += 1;
  lastUndoUnitId = null;
  clearAutoEndTimer();
  clearSavedRun();
  const run = createNewRun(gameStore.meta, seasonId);
  gameStore.run = run;
  gameStore.battle = null;
  gameStore.enemyTurnRunning = false;
  gameStore.selectedUnitId = null;
  gameStore.previewTile = null;
  gameStore.inspectedEnemyId = null;
  gameStore.screen = 'run';
  gameStore.savedRunAvailable = true;
  saveRun(run);
}

export function continueSavedRun(): void {
  const saved = loadSavedRun();
  if (!saved) {
    startNewSeasonRun();
    return;
  }
  sfx.click();
  battleSessionId += 1;
  lastUndoUnitId = null;
  clearAutoEndTimer();
  if (saved.status === 'battle') {
    saved.status = 'map';
  }
  gameStore.run = saved;
  gameStore.battle = null;
  gameStore.enemyTurnRunning = false;
  gameStore.selectedUnitId = null;
  gameStore.previewTile = null;
  gameStore.inspectedEnemyId = null;
  gameStore.screen = 'run';
}

export function returnToTitle(): void {
  sfx.click();
  battleSessionId += 1;
  lastUndoUnitId = null;
  clearAutoEndTimer();
  gameStore.enemyTurnRunning = false;
  if (gameStore.run && gameStore.run.status !== 'victory' && gameStore.run.status !== 'defeat') {
    saveRun(gameStore.run);
    gameStore.savedRunAvailable = true;
  } else {
    gameStore.savedRunAvailable = Boolean(loadSavedRun());
  }
  gameStore.battle = null;
  gameStore.selectedUnitId = null;
  gameStore.previewTile = null;
  gameStore.inspectedEnemyId = null;
  gameStore.screen = 'title';
}

export function enterSeasonNode(nodeId: string): void {
  const run = gameStore.run;
  if (!run) return;
  const node = run.nodes.find((n) => n.id === nodeId);
  if (!node) return;
  sfx.click();
  battleSessionId += 1;
  lastUndoUnitId = null;
  clearAutoEndTimer();

  if (node.type === 'vault' || node.type === 'shop') {
    openVaultNode(run, nodeId);
    saveRun(run);
    return;
  }

  if (!node.mapId) return;
  run.currentNodeId = nodeId;
  run.status = 'battle';

  const activeHeroes = run.activeSquadUids
    .map((uid) => run.roster.find((h) => h.uid === uid && !h.harvested))
    .filter((h): h is NonNullable<typeof h> => Boolean(h));

  const harvestedHero = run.roster.find((h) => h.harvested);
  const ownedBps = new Set(run.roster.map((h) => h.blueprintId));
  const fallbackBp = RECRUITABLE_BLUEPRINT_IDS.find((bp) => !ownedBps.has(bp)) ?? 'carrot';

  const battle = createBattleFromMap(
    node.mapId,
    activeHeroes,
    run.relicIds,
    run.items,
    harvestedHero ? { hero: harvestedHero } : { blueprintId: fallbackBp },
    {
      // Seeded per node: the same run seed always produces the same battles (daily runs).
      rng: battleRng(run.seed, node.id),
      difficulty: difficultyFor(run.act, node.stage, node.type),
    }
  );

  gameStore.battle = battle;
  gameStore.mode = 'move';
  gameStore.selectedItemId = null;
  gameStore.hoveredTile = null;
  gameStore.previewTile = null;
  gameStore.inspectedEnemyId = null;
  gameStore.showAllDangerZone = false;
  gameStore.enemyTurnRunning = false;
  const firstHero = battle.units.find((u) => u.team === 'player' && u.alive);
  gameStore.selectedUnitId = firstHero?.id ?? null;

  saveRun(run);
  setTimeout(() => flushBattleEvents(), 60);
}

/**
 * Cleanly clears all active selection, enemy threat inspection, hover, and tile preview.
 */
export function deselectAll(playClick = false): void {
  const hadAnything = Boolean(
    gameStore.selectedUnitId ||
      gameStore.inspectedEnemyId ||
      gameStore.previewTile ||
      gameStore.mode !== 'move'
  );
  if (playClick && hadAnything) sfx.click();
  gameStore.selectedUnitId = null;
  gameStore.inspectedEnemyId = null;
  gameStore.previewTile = null;
  gameStore.selectedItemId = null;
  gameStore.mode = 'move';
}

/**
 * Called when the user switches browser tabs or the window loses focus:
 * ensures ZERO focus, hover, selection, or enemy inspection stays visually active!
 */
export function clearFocusOnTabAway(): void {
  clearAutoEndTimer();
  gameStore.hoveredTile = null;
  gameStore.previewTile = null;
  gameStore.inspectedEnemyId = null;
  gameStore.selectedUnitId = null;
  gameStore.selectedItemId = null;
  gameStore.mode = 'move';
}

/**
 * Selects a friendly hero, OR toggles them OFF (deselects) if they are already selected!
 * Always starts in neutral 'move' mode — NEVER auto-enters 'ability' mode.
 */
export function selectBattleUnit(unitId: string, focusCamera = true, allowToggleOff = true): void {
  const b = gameStore.battle;
  if (!b || b.phase !== 'player' || gameStore.enemyTurnRunning) return;
  const u = getUnitById(b, unitId);
  if (!u || !u.alive || u.team !== 'player') return;

  sfx.click();
  clearAutoEndTimer();

  if (allowToggleOff && gameStore.selectedUnitId === u.id) {
    deselectAll(false);
    return;
  }

  gameStore.selectedUnitId = u.id;
  gameStore.inspectedEnemyId = null;
  gameStore.previewTile = null;
  gameStore.selectedItemId = null;
  // Always start in default unified mode — never auto-switch into Skill/Ability!
  gameStore.mode = 'move';
  if (focusCamera) requestCameraFocus(u.pos);
}

export function inspectEnemyUnit(enemyId: string | null): void {
  if (!enemyId || gameStore.inspectedEnemyId === enemyId) {
    gameStore.inspectedEnemyId = null;
    gameStore.previewTile = null;
    return;
  }
  gameStore.inspectedEnemyId = enemyId;
  if (gameStore.battle) {
    const e = getUnitById(gameStore.battle, enemyId);
    if (e) requestCameraFocus(e.pos);
  }
}

/**
 * Explicitly switches interaction mode.
 * IMPORTANT: Never auto-fires self/AoE skills on mode switch!
 * Instead, entering 'ability' mode previews the skill area/info and lets the player confirm or cancel.
 */
export function setInteractionMode(mode: InteractionMode, itemId?: string): void {
  if (gameStore.enemyTurnRunning) return;
  if (mode === 'item' && gameStore.battle && gameStore.selectedUnitId) {
    const selected = getUnitById(gameStore.battle, gameStore.selectedUnitId);
    if (!selected || selected.actions.hasUsedSkill) return;
  }
  sfx.click();
  clearAutoEndTimer();
  gameStore.mode = mode;
  gameStore.selectedItemId = mode === 'item' ? (itemId ?? null) : null;
  gameStore.previewTile = null;
  gameStore.inspectedEnemyId = null;

  // For self / aura skills, pre-focus the caster tile so the player immediately sees the
  // exact aura radius + skill description + explicit [Cast] confirmation button!
  if (mode === 'ability' && gameStore.battle && gameStore.selectedUnitId) {
    const u = getUnitById(gameStore.battle, gameStore.selectedUnitId);
    if (
      u?.ability &&
      !u.actions.hasUsedSkill &&
      u.abilityCooldown === 0 &&
      (u.ability.targetType === 'self' || u.ability.targetType === 'aoe_self')
    ) {
      gameStore.previewTile = { ...u.pos };
    }
  }
}

export function setHoveredTile(pos: GridPos | null): void {
  const prev = gameStore.hoveredTile;
  if (prev === null && pos === null) return;
  if (prev && pos && prev.x === pos.x && prev.y === pos.y) return;
  gameStore.hoveredTile = pos;
}

export function cancelPreviewAction(): void {
  gameStore.previewTile = null;
  gameStore.inspectedEnemyId = null;
  if (gameStore.mode === 'ability' || gameStore.mode === 'item') {
    gameStore.mode = 'move';
    gameStore.selectedItemId = null;
  }
}

/**
 * Computes contextual action options for a given tile without mutating store state.
 */
export function getActionOptionsForTile(pos: GridPos | null): PreviewActionOption[] {
  const b = gameStore.battle;
  if (!b || !pos || b.status !== 'ongoing' || b.phase !== 'player') return [];
  const selected = gameStore.selectedUnitId ? getUnitById(b, gameStore.selectedUnitId) : undefined;
  if (!selected || !selected.alive) return [];

  const options: PreviewActionOption[] = [];
  const key = posKey(pos);

  if (gameStore.mode === 'ability' && selected.ability) {
    const valid = getAbilityTargetTiles(b, selected).some((p) => samePos(p, pos));
    if (valid) {
      options.push({ kind: 'ability', label: `Cast ${selected.ability.name}`, tone: 'plum' });
    }
    return options;
  }

  if (gameStore.mode === 'item' && gameStore.selectedItemId) {
    const item = ITEM_REGISTRY[gameStore.selectedItemId];
    const valid = getItemTargetTiles(b, selected, gameStore.selectedItemId).some((p) =>
      samePos(p, pos)
    );
    if (item && valid) {
      options.push({ kind: 'item', label: `Use ${item.name}`, tone: 'primary' });
    }
    return options;
  }

  // Unified contextual choices across Move / Dash / Jump / Attack!
  const clickedUnit = unitAt(b, pos);

  if (clickedUnit && clickedUnit.team === 'enemy') {
    const dash = computeDashOptions(b, selected).find((d) => d.enemyId === clickedUnit.id);
    if (dash) {
      options.push({ kind: 'dash', label: `Dash -${dash.damage}`, tone: 'gold' });
    }
    const fc = forecastAttack(b, selected, pos);
    if (fc.canAttack) {
      options.push({
        kind: 'attack',
        label: `Attack ${fc.hitChance}% (-${fc.finalDamage})`,
        tone: 'danger',
      });
    }
    return options;
  }

  // Empty tile or destructible cover
  if (gameStore.mode === 'attack') {
    const fc = forecastAttack(b, selected, pos);
    if (fc.canAttack) {
      options.push({
        kind: 'attack',
        label: fc.coverDamage && b.tiles[pos.y]?.[pos.x]?.cover
          ? `Smash Cover (-${fc.coverDamage})`
          : `Lob Here (-${fc.finalDamage})`,
        tone: 'danger',
      });
    }
    return options;
  }

  if (computeTeamJumpOptions(b, selected).has(key)) {
    options.push({ kind: 'jump', label: 'Team-Jump', tone: 'gold' });
    return options;
  }

  if (computeMovableTiles(b, selected).has(key)) {
    options.push({ kind: 'move', label: 'Move Here', tone: 'sky' });
    return options;
  }

  // Clicking destructible cover directly while in default mode also offers quick Smash if in attack range!
  const coverFc = forecastAttack(b, selected, pos);
  if (coverFc.canAttack && b.tiles[pos.y]?.[pos.x]?.cover?.destructible) {
    options.push({
      kind: 'attack',
      label: `Smash Cover (-${coverFc.coverDamage})`,
      tone: 'danger',
    });
  }

  return options;
}

export function getPreviewActionOptions(): PreviewActionOption[] {
  return getActionOptionsForTile(gameStore.previewTile);
}

/**
 * Clean post-action flow:
 * - NEVER auto-switches into 'ability' mode!
 * - Always returns to default unified 'move' mode so skills are ONLY used intentionally.
 * - Auto-advances to the next ready hero only when the current hero has NO remaining actions.
 */
function autoAdvanceAfterAction(unitId: string, actionPos?: GridPos): void {
  const b = gameStore.battle;
  if (!b || b.status !== 'ongoing') {
    clearAutoEndTimer();
    return;
  }
  const u = getUnitById(b, unitId);

  if (u && u.alive && unitHasMeaningfulAction(b, u)) {
    // Stay on this unit in neutral unified mode (never auto-select Skill!)
    gameStore.mode = 'move';
  } else {
    // Hero has finished all meaningful actions -> smoothly advance to next ready ally (if any)
    const nextReady = b.units.find(
      (other) => other.id !== unitId && unitHasMeaningfulAction(b, other)
    );
    lastAutoAdvanceAt = Date.now();
    lastAutoAdvancePos = actionPos ? { ...actionPos } : null;
    if (nextReady) {
      gameStore.selectedUnitId = nextReady.id;
      gameStore.mode = 'move';
      requestCameraFocus(nextReady.pos);
    } else {
      gameStore.selectedUnitId = null;
      gameStore.mode = 'move';
    }
  }
  gameStore.selectedItemId = null;
  gameStore.previewTile = null;
  gameStore.inspectedEnemyId = null;
  scheduleAutoEndCheck();
}

export function executePreviewOption(kind: PreviewActionOption['kind'], explicitPos?: GridPos): boolean {
  const b = gameStore.battle;
  const run = gameStore.run;
  const pos = explicitPos ?? gameStore.previewTile;
  if (!b || !run || !pos || b.status !== 'ongoing' || b.phase !== 'player') return false;
  const selected = gameStore.selectedUnitId ? getUnitById(b, gameStore.selectedUnitId) : undefined;
  if (!selected || !selected.alive) return false;

  clearAutoEndTimer();
  let ok = false;

  if (kind === 'move') {
    ok = executeMove(b, selected.id, pos);
    if (ok) lastUndoUnitId = selected.id;
  } else if (kind === 'jump') {
    ok = executeTeamJump(b, selected.id, pos);
    if (ok) lastUndoUnitId = selected.id;
  } else if (kind === 'dash') {
    const enemy = unitAt(b, pos);
    if (enemy && enemy.team === 'enemy') {
      ok = executeDash(b, selected.id, enemy.id);
      if (ok) {
        lastUndoUnitId = selected.id;
        gameStore.previewTile = null;
        gameStore.inspectedEnemyId = null;
        gameStore.mode = 'move';
        flushBattleEvents();
        scheduleAutoEndCheck();
        return true;
      }
    }
  } else if (kind === 'attack') {
    ok = executeAttack(b, selected.id, pos, Math.random, run.roster);
    if (ok) lastUndoUnitId = null;
  } else if (kind === 'ability') {
    ok = executeAbility(b, selected.id, pos);
    if (ok) lastUndoUnitId = null;
  } else if (kind === 'item' && gameStore.selectedItemId) {
    ok = executeItem(b, selected.id, gameStore.selectedItemId, pos, run.roster);
    if (ok) lastUndoUnitId = null;
  }

  if (ok) {
    flushBattleEvents();
    autoAdvanceAfterAction(selected.id, pos);
  }
  return ok;
}

/**
 * Called when tapping outside the grid (on the wooden desk backdrop):
 * cleanly deselects active unit, enemy threat zone, and preview!
 */
export function handleOffBoardTap(): void {
  if (gameStore.enemyTurnRunning) return;
  clearAutoEndTimer();
  deselectAll(true);
}

/**
 * Unified Intuitive Tap Handler:
 * - Tap selected ally again -> UNCLICK / DESELECT cleanly!
 * - Tap another ally -> switch to that ally!
 * - Tap an out-of-range enemy (or with no ally selected) -> Tap 1 inspects Threat Zone; Tap 2 toggles OFF cleanly!
 * - Tap an actionable tile/enemy ->
 *     * Touch: Tap 1 previews (shows Forecast / Action confirmation); Tap 2 executes!
 *     * Mouse: 1-click executes when unambiguous (or shows choice pills if both Dash & Attack are available)!
 * - Tap empty non-actionable grass -> clears selection & enemy focus completely!
 */
export function handleBattleTileTap(pos: GridPos, pointerType = 'mouse'): void {
  const b = gameStore.battle;
  const run = gameStore.run;
  if (!b || !run || b.status !== 'ongoing' || b.phase !== 'player' || gameStore.enemyTurnRunning) {
    return;
  }

  clearAutoEndTimer();
  const isTouch = pointerType !== 'mouse';
  if (isTouch) gameStore.isTouchMode = true;

  // Guard against desktop double-click spillover onto the newly auto-advanced hero
  if (
    !isTouch &&
    lastAutoAdvancePos &&
    samePos(lastAutoAdvancePos, pos) &&
    Date.now() - lastAutoAdvanceAt < 220
  ) {
    return;
  }

  const clickedUnit = unitAt(b, pos);
  const selected = gameStore.selectedUnitId ? getUnitById(b, gameStore.selectedUnitId) : undefined;
  const wasSelectedHero = Boolean(selected && clickedUnit && clickedUnit.id === selected.id);
  const wasInspectedEnemy = Boolean(
    clickedUnit && clickedUnit.team === 'enemy' && gameStore.inspectedEnemyId === clickedUnit.id
  );

  // 1. Clicking a friendly hero
  if (clickedUnit && clickedUnit.team === 'player') {
    // Allow targeting allies/self when explicitly in Ability or Item targeting mode
    if (selected && (gameStore.mode === 'ability' || gameStore.mode === 'item')) {
      const opts = getActionOptionsForTile(pos);
      if (opts.length > 0) {
        if (isTouch && !(gameStore.previewTile && samePos(gameStore.previewTile, pos))) {
          sfx.click();
          gameStore.previewTile = { ...pos };
          return;
        }
        executePreviewOption(opts[0].kind, pos);
        return;
      }
    }

    // Clicking the currently selected hero again UNCLICKS / DESELECTS them!
    if (wasSelectedHero) {
      deselectAll(true);
      return;
    }

    // Clicking a different hero switches selection immediately
    selectBattleUnit(clickedUnit.id, true, false);
    return;
  }

  // 2. No friendly hero currently selected
  if (!selected || !selected.alive) {
    if (clickedUnit && clickedUnit.team === 'enemy') {
      sfx.click();
      if (wasInspectedEnemy) {
        // Second click toggles enemy inspection cleanly OFF!
        gameStore.inspectedEnemyId = null;
        gameStore.previewTile = null;
      } else {
        gameStore.inspectedEnemyId = clickedUnit.id;
        gameStore.previewTile = null;
      }
    } else {
      // Tapping empty ground / cover when nothing selected clears any enemy focus
      deselectAll(false);
    }
    return;
  }

  // 3. A friendly hero IS selected — check actionable options on this tile
  const opts = getActionOptionsForTile(pos);

  // 3A. Clicking an enemy unit
  if (clickedUnit && clickedUnit.team === 'enemy') {
    if (opts.length === 0) {
      // Out of range / cannot act on this enemy -> toggle Threat Zone inspection cleanly!
      sfx.click();
      if (wasInspectedEnemy) {
        gameStore.inspectedEnemyId = null;
        gameStore.previewTile = null;
      } else {
        gameStore.inspectedEnemyId = clickedUnit.id;
        gameStore.previewTile = null;
      }
      return;
    }

    // Actionable enemy (Dash, Attack, Ability, or Item)
    if (isTouch) {
      if (gameStore.previewTile && samePos(gameStore.previewTile, pos)) {
        const preferred =
          gameStore.mode === 'attack'
            ? opts.find((o) => o.kind === 'attack') ?? opts[0]
            : opts.find((o) => o.kind === 'dash') ?? opts.find((o) => o.kind === 'attack') ?? opts[0];
        executePreviewOption(preferred.kind, pos);
        return;
      }
      sfx.click();
      gameStore.previewTile = { ...pos };
      // Keep own weapon range & attack preview crisp; player can tap ⚠ Zone on card to peek enemy danger zone
      gameStore.inspectedEnemyId = null;
      return;
    }

    // Desktop Mouse: if BOTH Dash & Attack are available in unified mode, show clear choice pills first
    // (second click executes Attack directly, or click Dash/Attack pill!).
    if (opts.length > 1 && gameStore.mode === 'move') {
      if (gameStore.previewTile && samePos(gameStore.previewTile, pos)) {
        const preferred = opts.find((o) => o.kind === 'attack') ?? opts[0];
        executePreviewOption(preferred.kind, pos);
      } else {
        sfx.click();
        gameStore.previewTile = { ...pos };
        gameStore.inspectedEnemyId = null;
      }
      return;
    }

    const preferred =
      gameStore.mode === 'attack'
        ? opts.find((o) => o.kind === 'attack') ?? opts[0]
        : opts[0];
    executePreviewOption(preferred.kind, pos);
    return;
  }

  // 3B. Clicking an empty tile or cover
  if (opts.length > 0) {
    gameStore.inspectedEnemyId = null;
    if (isTouch) {
      if (gameStore.previewTile && samePos(gameStore.previewTile, pos)) {
        executePreviewOption(opts[0].kind, pos);
        return;
      }
      sfx.click();
      gameStore.previewTile = { ...pos };
      return;
    }
    executePreviewOption(opts[0].kind, pos);
    return;
  }

  // 3C. Clicked empty non-actionable tile -> clear preview/targeting mode first, or deselect cleanly!
  if (isTouch && gameStore.previewTile) {
    sfx.click();
    gameStore.previewTile = null;
    gameStore.inspectedEnemyId = null;
    return;
  }
  if (gameStore.mode === 'attack' || gameStore.mode === 'ability' || gameStore.mode === 'item') {
    sfx.click();
    gameStore.mode = 'move';
    gameStore.selectedItemId = null;
    gameStore.previewTile = null;
    gameStore.inspectedEnemyId = null;
  } else {
    deselectAll(true);
  }
}

export function triggerUndoMove(): void {
  const b = gameStore.battle;
  if (!b || b.phase !== 'player' || gameStore.enemyTurnRunning) return;
  clearAutoEndTimer();
  const restored = undoLastAction(b);
  if (!restored) return;
  sfx.click();
  gameStore.battle = restored;
  if (lastUndoUnitId) {
    const undoneHero = getUnitById(restored, lastUndoUnitId);
    if (undoneHero && undoneHero.alive && undoneHero.team === 'player') {
      gameStore.selectedUnitId = undoneHero.id;
      requestCameraFocus(undoneHero.pos);
    }
    lastUndoUnitId = null;
  }
  gameStore.previewTile = null;
  gameStore.inspectedEnemyId = null;
  gameStore.mode = 'move';
  emitUndoReset();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function endPlayerTurn(): Promise<void> {
  const b = gameStore.battle;
  if (!b || b.status !== 'ongoing' || b.phase !== 'player' || gameStore.enemyTurnRunning) return;

  const session = battleSessionId;
  clearAutoEndTimer();
  lastUndoUnitId = null;
  sfx.click();
  gameStore.enemyTurnRunning = true;
  gameStore.hoveredTile = null;
  gameStore.previewTile = null;
  gameStore.inspectedEnemyId = null;
  gameStore.mode = 'move';
  gameStore.selectedItemId = null;
  startPhase(b, 'enemy');
  flushBattleEvents();

  if (b.status !== 'ongoing') {
    gameStore.enemyTurnRunning = false;
    return;
  }

  await sleep(850);
  if (session !== battleSessionId || !gameStore.battle) {
    gameStore.enemyTurnRunning = false;
    return;
  }

  const enemyIds = gameStore.battle.units
    .filter((u) => u.team === 'enemy' && u.alive)
    .map((u) => u.id);

  for (const eid of enemyIds) {
    if (session !== battleSessionId || !gameStore.battle || gameStore.battle.status !== 'ongoing') {
      break;
    }
    const acted = runEnemyUnitTurn(gameStore.battle, eid);
    if (acted) {
      // Split movement/dash from attacks/abilities so players can read every farmer's beat clearly!
      const allEvents = gameStore.battle.pendingEvents.splice(0);
      const moveEvents = allEvents.filter(
        (ev) => ev.type === 'move' || ev.type === 'dash' || ev.type === 'jump'
      );
      const combatEvents = allEvents.filter(
        (ev) => ev.type !== 'move' && ev.type !== 'dash' && ev.type !== 'jump'
      );

      if (moveEvents.length > 0) {
        dispatchBattleEvents(moveEvents);
        await sleep(combatEvents.length > 0 ? 340 : 520);
        if (session !== battleSessionId || !gameStore.battle) {
          gameStore.enemyTurnRunning = false;
          return;
        }
      }
      if (combatEvents.length > 0) {
        dispatchBattleEvents(combatEvents);
        await sleep(560);
      }
    }
  }

  if (session !== battleSessionId) {
    gameStore.enemyTurnRunning = false;
    return;
  }

  if (gameStore.battle && gameStore.battle.status === 'ongoing') {
    startPhase(gameStore.battle, 'player');
    flushBattleEvents();
    const firstAlive = gameStore.battle.units.find((u) => u.team === 'player' && u.alive);
    gameStore.selectedUnitId = firstAlive?.id ?? null;
    gameStore.mode = 'move';
    if (firstAlive) requestCameraFocus(firstAlive.pos);
  }

  gameStore.enemyTurnRunning = false;
}

export function finalizeBattleAndProceed(): void {
  const b = gameStore.battle;
  const run = gameStore.run;
  if (!b || !run || b.status === 'ongoing') return;
  battleSessionId += 1;
  lastUndoUnitId = null;
  clearAutoEndTimer();
  sfx.click();
  applyBattleOutcomeToRun(run, b, gameStore.meta);
  gameStore.battle = null;
  gameStore.selectedUnitId = null;
  gameStore.previewTile = null;
  gameStore.inspectedEnemyId = null;
  if (run.status !== 'victory' && run.status !== 'defeat') {
    saveRun(run);
  } else {
    gameStore.savedRunAvailable = false;
  }
}

export function graftHero(heroUid: string, graftId: string): boolean {
  if (!gameStore.run) return false;
  const ok = applyGraftToHero(gameStore.run, heroUid, graftId);
  if (ok) {
    sfx.rescue();
    saveRun(gameStore.run);
  }
  return ok;
}

export function pickRelic(relicId: string): boolean {
  if (!gameStore.run) return false;
  const ok = claimRelicReward(gameStore.run, relicId);
  if (ok) {
    sfx.heal();
    saveRun(gameStore.run);
  }
  return ok;
}

export function pickRecruit(blueprintId: string): boolean {
  if (!gameStore.run) return false;
  const bonusHp = gameStore.meta.unlocks.heirloomSoil ? 2 : 0;
  const ok = claimRecruitReward(gameStore.run, blueprintId, bonusHp);
  if (ok) {
    sfx.rescue();
    saveRun(gameStore.run);
  }
  return ok;
}

export function toggleSquadMember(heroUid: string): boolean {
  if (!gameStore.run) return false;
  const ok = toggleHeroActiveSquad(gameStore.run, heroUid);
  if (ok) {
    sfx.click();
    saveRun(gameStore.run);
  }
  return ok;
}

export function purchaseMarketOffer(offerId: string, targetHeroUid?: string): boolean {
  if (!gameStore.run) return false;
  const ok = buyMarketOffer(gameStore.run, offerId, targetHeroUid);
  if (ok) {
    sfx.rescue();
    saveRun(gameStore.run);
  }
  return ok;
}

export function closeRewardsToMap(): void {
  if (!gameStore.run) return;
  sfx.click();
  finishRewardsAndReturnToMap(gameStore.run);
  saveRun(gameStore.run);
}
