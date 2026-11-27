<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, toRaw, watch } from 'vue';
import { getAbilityTargetTiles } from '../engine/battle';
import { bondStatuses, type BondStatus } from '../engine/bonds';
import { GRAFT_REGISTRY } from '../data/grafts';
import { ITEM_REGISTRY } from '../data/items';
import { RELIC_REGISTRY } from '../data/relics';
import {
  forecastAttack,
  getAttackableTiles,
  getWeaponRangeTiles,
  unitHasMeaningfulAction,
} from '../engine/combat';
import { getAdjacentCoverBadges, posKey, samePos, tileAt, unitAt } from '../engine/grid';
import {
  getFamilyLabel,
  getMatchup,
  getMaxDashesForUnit,
  getMaxOverwatchCharges,
  getRemainingMove,
  hasRelic,
} from '../engine/hooks';
import { computeDashOptions, computeTeamJumpOptions } from '../engine/pathfinding';
import { GRADE_LABELS, gradeBattle } from '../engine/par';
import type { StatusKind } from '../engine/types';
import { type InteractionMode, PaperCraftRenderer } from '../renderer/canvas';
import { PaperDioramaRenderer } from '../renderer3d/PaperDioramaRenderer';
import { resolveVariantSpriteKey } from '../renderer3d/textures';
import type {
  BattleRendererHandle,
  CameraMode3D,
  PhaseBannerOverlay,
  ScreenAnchor,
} from '../renderer3d/types';
import {
  AUTO_END_GRACE_MS,
  cancelPreviewAction,
  clearAutoEndTimer,
  clearFocusOnTabAway,
  confirmPrepPhase,
  cycleAimTarget,
  deselectAll,
  dismissCoopHandoff,
  dismissFarmerRecap,
  endPlayerTurn,
  executePreviewOption,
  finalizeBattleAndProceed,
  gameStore,
  getAttackTargetsForSelected,
  getPreviewActionOptions,
  handleBattleTileTap,
  handleOffBoardTap,
  handleRightClickCancel,
  type PreviewActionOption,
  returnToTitle,
  selectBattleUnit,
  setHoveredTile,
  setInteractionMode,
  setPreviewOverwatch,
  subscribeBattleEvents,
  subscribeCameraFocus,
  subscribeUndoReset,
  swapPrepBenchHero,
  toggleAllDangerZone,
  toggleAudioMute,
  toggleAutoEndTurn,
  toggleBoardViewMode,
  toggleCoopFreeOrder,
  toggleEnemySpeed,
  toggleGuidedHints,
  toggleInspectEnemy,
  toggleMusicMute,
  toggleRendererKind,
  triggerOverwatch,
  triggerUndoMove,
} from '../stores/gameStore';
import AlmanacModal from './AlmanacModal.vue';
import CraftIcon, { type CraftIconName } from './CraftIcon.vue';
import HeroBuildModal from './HeroBuildModal.vue';

const COACH_STORAGE_KEY = 'crop_revolt_coach_3d_v2';
const COACH_TIPS_DESKTOP = [
  {
    title: '1/3 · Move, then shoot',
    body: 'Click a hero, click a blue tile to move, then press Weapon and click a farmer. Every hero can do both each turn.',
  },
  {
    title: '2/3 · Dash and Team-Jump',
    body: 'While moving, run through an orange farmer to Dash it for free damage. Gold tiles bounce you off a friend for extra distance.',
  },
  {
    title: '3/3 · End the turn',
    body: 'When your heroes are done, press End Turn (Enter). Right-click cancels, Q/E turns the camera, F opens the Aim Cam.',
  },
] as const;
const COACH_TIPS_TOUCH = [
  {
    title: '1/3 · Move, then shoot',
    body: 'Tap a hero, tap a blue tile twice to move, then tap Weapon and a farmer. Every hero can do both each turn.',
  },
  {
    title: '2/3 · Dash and Team-Jump',
    body: 'Run through an orange farmer to Dash it for free damage. Gold tiles bounce you off a friend for extra distance.',
  },
  {
    title: '3/3 · End the turn',
    body: 'When your heroes are done, tap End. Drag the board to look around and pinch to zoom.',
  },
] as const;
const COACH_TIPS = computed(() => (gameStore.isTouchMode ? COACH_TIPS_TOUCH : COACH_TIPS_DESKTOP));

function loadCoachStep(): number {
  try {
    if (typeof localStorage !== 'undefined' && localStorage.getItem(COACH_STORAGE_KEY) === 'done') {
      return -1;
    }
  } catch {
    // ignore
  }
  return 0;
}

const webglCanvasRef = ref<HTMLCanvasElement | null>(null);
const overlayCanvasRef = ref<HTMLCanvasElement | null>(null);
const canvas2dRef = ref<HTMLCanvasElement | null>(null);

const showItemsMenu = ref(false);
const showUtilityMenu = ref(false);
const showAlmanac = ref(false);
const showPrepArmory = ref(false);
const showPrepBonds = ref(false);
const prepSwapNotice = ref<string | null>(null);
let prepSwapNoticeTimer: ReturnType<typeof setTimeout> | null = null;
const logExpanded = ref(false);
const inspectedNote = ref<{ title: string; desc: string } | null>(null);
const zoomPercent = ref(100);
const cameraMode = ref<CameraMode3D>('tactical');
const focusAnchor = ref<ScreenAnchor | null>(null);
const phaseBanner = ref<PhaseBannerOverlay | null>(null);
const endConfirmPending = ref(false);
const coachStep = ref<number>(loadCoachStep());
const webglFallbackNotice = ref(false);
let endConfirmTimer: ReturnType<typeof setTimeout> | null = null;

function handlePrepBenchSwap(benchHero: { uid: string; name: string }): void {
  const prevName = selectedUnit.value?.name.split(' ')[0] ?? playerUnits.value[0]?.name.split(' ')[0] ?? 'Hero';
  if (swapPrepBenchHero(benchHero.uid)) {
    prepSwapNotice.value = `Swapped ${prevName} ⇄ ${benchHero.name.split(' ')[0]}!`;
    if (prepSwapNoticeTimer) clearTimeout(prepSwapNoticeTimer);
    prepSwapNoticeTimer = setTimeout(() => {
      prepSwapNotice.value = null;
    }, 2400);
  }
}

const hasMobileMenuAlert = computed(
  () => gameStore.showAllDangerZone || gameStore.enemySpeedFast || cameraMode.value === 'tacticam'
);

function advanceCoach(): void {
  if (coachStep.value < COACH_TIPS.value.length - 1) {
    coachStep.value += 1;
  } else {
    dismissCoach();
  }
}

function dismissCoach(): void {
  coachStep.value = -1;
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(COACH_STORAGE_KEY, 'done');
    }
  } catch {
    // ignore
  }
}

function replayCoachTips(): void {
  showUtilityMenu.value = false;
  coachStep.value = 0;
}

let activeRenderer: BattleRendererHandle | null = null;
let unsubscribeEvents: (() => void) | null = null;
let unsubscribeFocus: (() => void) | null = null;
let unsubscribeUndoReset: (() => void) | null = null;

const is3D = computed(() => gameStore.rendererKind === '3d');
const battle = computed(() => gameStore.battle!);
const playerUnits = computed(() =>
  battle.value.units.filter((u) => u.team === 'player' && !u.isEscortCart)
);
const escortCart = computed(
  () => battle.value.units.find((u) => u.isEscortCart) ?? null
);
const prepBenchHeroes = computed(() => {
  const run = gameStore.run;
  if (!run) return [];
  const activeSet = new Set(run.activeSquadUids);
  return run.roster.filter((h) => !h.harvested && !activeSet.has(h.uid));
});
const aliveEnemiesCount = computed(
  () => battle.value.units.filter((u) => u.team === 'enemy' && u.alive).length
);

const selectedUnit = computed(
  () =>
    battle.value.units.find(
      (u) => u.id === gameStore.selectedUnitId && u.alive && !u.isEscortCart
    ) ?? null
);

const inspectedEnemy = computed(() =>
  gameStore.inspectedEnemyId
    ? battle.value.units.find(
        (u) => u.id === gameStore.inspectedEnemyId && u.alive && u.team === 'enemy'
      ) ?? null
    : null
);

const activeFocusTile = computed(() => gameStore.previewTile ?? gameStore.hoveredTile);

const focusedTile = computed(() =>
  activeFocusTile.value ? tileAt(battle.value, activeFocusTile.value) ?? null : null
);

const focusedUnit = computed(() =>
  activeFocusTile.value ? unitAt(battle.value, activeFocusTile.value) ?? null : null
);

const focusedCover = computed(() => focusedTile.value?.cover ?? null);

const previewOptions = computed(() => getPreviewActionOptions());

const isCombatPreview = computed(() =>
  previewOptions.value.some((o) => o.kind === 'attack' || o.kind === 'dash')
);

const isMovePreview = computed(() =>
  previewOptions.value.some((o) => o.kind === 'move' || o.kind === 'jump')
);

const isSkillOrItemMode = computed(
  () => Boolean(selectedUnit.value && (gameStore.mode === 'ability' || gameStore.mode === 'item'))
);

const activeAbilityBanner = computed(() => {
  if (gameStore.mode !== 'ability' || !selectedUnit.value?.ability) return null;
  const ab = selectedUnit.value.ability;
  const targetHint =
    ab.targetType === 'self'
      ? 'Self'
      : ab.targetType === 'aoe_self'
        ? `Aura R${ab.aoeRadius ?? 2}`
        : ab.targetType === 'ally'
          ? `Ally · R${ab.range}`
          : ab.targetType === 'enemy'
            ? `Foe · R${ab.range}`
            : `Area · R${ab.range}`;
  return {
    name: ab.name,
    desc: ab.description,
    cooldown: ab.cooldown,
    targetHint,
    isSelfTarget: ab.targetType === 'self' || ab.targetType === 'aoe_self',
  };
});

const activeItemBanner = computed(() => {
  if (gameStore.mode !== 'item' || !gameStore.selectedItemId) return null;
  const item = ITEM_REGISTRY[gameStore.selectedItemId];
  if (!item) return null;
  return {
    icon: item.icon,
    name: item.name,
    desc: item.description,
  };
});

const moveDestinationSummary = computed(() => {
  if (!isMovePreview.value || !selectedUnit.value || !gameStore.previewTile) return null;
  const dest = gameStore.previewTile;
  const isJump = previewOptions.value.some((o) => o.kind === 'jump');
  const badges = getAdjacentCoverBadges(battle.value, dest, 'player');
  const bestCover: 'full' | 'half' | 'none' = badges.some((b) => b.level === 'full')
    ? 'full'
    : badges.some((b) => b.level === 'half')
      ? 'half'
      : 'none';

  let projectedFoes = 0;
  if (!selectedUnit.value.actions.hasAttacked) {
    const reachKeys = new Set(getWeaponRangeTiles(battle.value, selectedUnit.value, dest).map(posKey));
    projectedFoes = battle.value.units.filter(
      (u) => u.alive && u.team === 'enemy' && reachKeys.has(posKey(u.pos))
    ).length;
  }

  const destTile = tileAt(battle.value, dest);
  const destTerrain = destTile?.terrain ?? 'grass';
  const destElev = destTile?.elevation ?? 0;
  const terrainNote =
    destTerrain === 'bounce_pad'
      ? '🍄 Bouncy Mushroom (Launch 3 tiles / +2 height!)'
      : destTerrain === 'burrow'
        ? '🕳️ Gopher Burrow (1-Move Warp Pipe!)'
        : destTerrain === 'sunbeam'
          ? '☀ Sunbeam (+2 ATK)'
          : destTerrain === 'compost'
            ? '🌿 Compost (+2 HP/turn)'
            : destTerrain === 'mud'
              ? '💧 Mud (2 Move cost)'
              : destTerrain === 'gate'
                ? '▲ Exit Gate (Win!)'
                : destTerrain === 'bridge'
                  ? '🪵 Bridge Crossing (Collapsible!)'
                  : destTerrain === 'ramp'
                    ? '↗ Ramp (No climb penalty)'
                    : destElev >= 2
                      ? `▲ Summit Lv.${destElev} (+3 DMG & Uphill Shield!)`
                      : destElev > 0
                        ? `▲ High Ground Lv.${destElev} (+2 DMG!)`
                        : null;

  return {
    isJump,
    bestCover,
    projectedFoes,
    terrainNote,
    destElev,
  };
});

const activeBossTelegraphs = computed(() => battle.value.bossTelegraphs ?? []);

function isLowHpUnit(u: { alive: boolean; hp: number; maxHp: number }): boolean {
  return u.alive && u.hp / Math.max(1, u.maxHp) <= 0.35;
}

function unitPortraitSrc(u: {
  id?: string;
  visualKind: string;
  alive: boolean;
  hp: number;
  maxHp: number;
  isBoss?: boolean;
  pos?: { x: number; y: number };
  team?: 'player' | 'enemy';
  statuses?: Array<{ kind: string; turns: number }>;
}): string {
  // Zero-404 guard: seed_cart is rendered procedurally in 3D and as an emoji badge in HUD.
  if (u.visualKind === 'seed_cart') return '/sprites/potato.png';
  const isBossEnraged = Boolean(u.isBoss && (battle.value.bossPhase ?? 1) >= 2);
  if (isBossEnraged) return `/sprites/${resolveVariantSpriteKey(u.visualKind, 'enraged')}.png`;
  const isOverwatching = Boolean(u.statuses?.some((s) => s.kind === 'overwatch' && s.turns > 0));
  const isAimingThis =
    Boolean(u.id && u.id === gameStore.selectedUnitId) &&
    (gameStore.mode === 'attack' || gameStore.mode === 'ability' || gameStore.mode === 'item') &&
    battle.value.phase === 'player';
  if (isAimingThis || isOverwatching) {
    return `/sprites/${resolveVariantSpriteKey(u.visualKind, 'action')}.png`;
  }
  if (u.alive && u.pos && u.team && !u.isBoss) {
    const badges = getAdjacentCoverBadges(toRaw(battle.value), u.pos, u.team);
    if (badges.length > 0) {
      return `/sprites/${resolveVariantSpriteKey(u.visualKind, 'cover')}.png`;
    }
  }
  const variant = isLowHpUnit(u) ? 'lowhp' : 'base';
  return `/sprites/${resolveVariantSpriteKey(u.visualKind, variant)}.png`;
}

const aimTargets = computed(() => {
  void gameStore.eventQueueVersion;
  void gameStore.selectedUnitId;
  void battle.value.turn;
  return getAttackTargetsForSelected();
});

const activeAimTargetIndex = computed(() => {
  if (!gameStore.previewTile || aimTargets.value.length === 0) return -1;
  return aimTargets.value.findIndex((t) => samePos(t.pos, gameStore.previewTile!));
});

const activeForecast = computed(() => {
  if (
    battle.value.prepPhase ||
    (gameStore.mode !== 'attack' && gameStore.mode !== 'move') ||
    !selectedUnit.value ||
    selectedUnit.value.actions.hasAttacked ||
    !activeFocusTile.value ||
    battle.value.phase !== 'player'
  ) {
    return null;
  }
  const targetIsEnemy = Boolean(focusedUnit.value && focusedUnit.value.team === 'enemy');
  const targetIsDestructibleCover = Boolean(focusedCover.value?.destructible);
  const targetIsCollapsibleBridge = Boolean(
    !focusedUnit.value &&
      focusedTile.value?.terrain === 'bridge' &&
      (focusedTile.value.bridgeHp ?? 0) > 0
  );
  if (
    !targetIsEnemy &&
    !targetIsDestructibleCover &&
    !targetIsCollapsibleBridge &&
    !(gameStore.mode === 'attack' && selectedUnit.value.weapon.arc === 'lobbed')
  ) {
    return null;
  }
  const fc = forecastAttack(battle.value, selectedUnit.value, activeFocusTile.value);
  if (!fc.canAttack && fc.hitChance === 0 && fc.reason?.startsWith('Out of range')) {
    return null;
  }
  return fc;
});

const previewDashDamage = computed(() => {
  if (battle.value.prepPhase || !selectedUnit.value || !focusedUnit.value || focusedUnit.value.team !== 'enemy') {
    return null;
  }
  const dash = computeDashOptions(battle.value, selectedUnit.value).find(
    (d) => d.enemyId === focusedUnit.value!.id
  );
  return dash ? dash.damage : null;
});

const showWorldForecastPill = computed(() => {
  if (!is3D.value || !focusAnchor.value?.visible || battle.value.phase !== 'player' || battle.value.prepPhase) {
    return false;
  }
  return Boolean(activeForecast.value || previewDashDamage.value !== null);
});

const worldForecastInteractive = computed(() =>
  Boolean(showWorldForecastPill.value && gameStore.previewTile && isCombatPreview.value && previewOptions.value.length > 0)
);

const worldForecastRef = ref<HTMLElement | null>(null);
const worldForecastStyle = computed(() => {
  if (!focusAnchor.value) return {};
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1200;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
  const cx = Math.max(134, Math.min(vw - 134, focusAnchor.value.x));
  // Keep the whole card below the top bar: its bottom edge sits at cy, so leave room for its height.
  const pillH = worldForecastRef.value?.offsetHeight ?? 150;
  const cy = Math.max(64 + pillH, Math.min(vh - 210, focusAnchor.value.y - 16));
  return {
    transform: `translate3d(${cx}px, ${cy}px, 0) translate(-50%, -100%)`,
  };
});

function hazardBonusDamage(haz?: 'bump' | 'water' | 'lava' | 'drop'): number {
  if (haz === 'lava') return 4;
  if (haz === 'water') return 3;
  if (haz === 'drop' || haz === 'bump') return 2;
  return 0;
}

function hazardTagLabel(haz?: 'bump' | 'water' | 'lava' | 'drop'): string {
  if (haz === 'lava') return '🔥 LAVA +4';
  if (haz === 'water') return '🌊 SPLASH +3';
  if (haz === 'drop') return '↓ DROP +2';
  if (haz === 'bump') return '⇄ BUMP +2';
  return '⇄ Push';
}

const forecastHpBars = computed(() => {
  const fc = activeForecast.value;
  if (focusedUnit.value) {
    const max = Math.max(1, focusedUnit.value.maxHp);
    const cur = Math.max(0, focusedUnit.value.hp);
    const extraHaz = fc?.canAttack
      ? hazardBonusDamage(fc.knockbackHazard ?? (fc.knockbackWillBump ? 'bump' : undefined))
      : 0;
    const assistDmg = fc?.canAttack ? (fc.partnerAssistDamage ?? 0) : 0;
    const dmg = fc?.canAttack ? fc.finalDamage + assistDmg + extraHaz : (previewDashDamage.value ?? 0);
    const rem = Math.max(0, cur - dmg);
    return {
      currentPct: (cur / max) * 100,
      remainingPct: (rem / max) * 100,
      damagePct: ((cur - rem) / max) * 100,
      cur,
      max,
      rem,
      dmg,
    };
  }
  if (focusedCover.value) {
    const max = Math.max(1, focusedCover.value.maxHp);
    const cur = Math.max(0, focusedCover.value.hp);
    const dmg = fc?.canAttack ? fc.coverDamage : 0;
    const rem = Math.max(0, cur - dmg);
    return {
      currentPct: (cur / max) * 100,
      remainingPct: (rem / max) * 100,
      damagePct: ((cur - rem) / max) * 100,
      cur,
      max,
      rem,
      dmg,
    };
  }
  if (fc?.isBridgeTarget && focusedTile.value && (focusedTile.value.bridgeHp ?? 0) > 0) {
    const max = Math.max(1, focusedTile.value.bridgeMaxHp ?? 4);
    const cur = Math.max(0, focusedTile.value.bridgeHp ?? 0);
    const dmg = fc.canAttack ? fc.coverDamage : 0;
    const rem = Math.max(0, cur - dmg);
    return {
      currentPct: (cur / max) * 100,
      remainingPct: (rem / max) * 100,
      damagePct: ((cur - rem) / max) * 100,
      cur,
      max,
      rem,
      dmg,
    };
  }
  return null;
});

const inspectedEnemyMatchup = computed(() => {
  if (!selectedUnit.value || !inspectedEnemy.value) return 'neutral';
  return getMatchup(selectedUnit.value.family, inspectedEnemy.value.family);
});

const advantagePctLabel = computed(() =>
  hasRelic(battle.value.relicIds, 'sharp_trowel') ? '+50%' : '+30%'
);

const latestLogLine = computed(() =>
  battle.value.combatLog.length > 0 ? battle.value.combatLog[battle.value.combatLog.length - 1] : ''
);

const STATUS_META: Record<StatusKind, { short: string; title: string; desc: string }> = {
  burn: { short: 'Burn', title: 'Burn', desc: 'Takes 2 fire damage at the start of its turn.' },
  rooted: { short: 'Root', title: 'Rooted', desc: 'Tangled in vines — cannot Move, Dash, or Team-Jump.' },
  acid: { short: 'Acid', title: 'Acid', desc: 'Corroded — takes +2 bonus damage from every attack.' },
  feared: { short: 'Fear', title: 'Feared', desc: 'Rattled by crows — Move range reduced by 2 tiles.' },
  shield: { short: 'Shield', title: 'Shield', desc: 'Braced — takes 2 less damage from incoming attacks.' },
  boosted: { short: 'Boost', title: 'Boosted', desc: 'Fired up — deals +2 Attack and +2 Dash damage.' },
  overwatch: {
    short: 'Watch',
    title: 'Watch',
    desc: 'On Watch: fires a reaction shot when a farmer moves into weapon range.',
  },
};

function inspectStatus(kind: StatusKind, turns: number): void {
  const info = STATUS_META[kind];
  if (!info) return;
  inspectedNote.value = { title: `${info.title} (${turns}t)`, desc: info.desc };
}

function clearEndConfirm(): void {
  endConfirmPending.value = false;
  if (endConfirmTimer !== null) {
    clearTimeout(endConfirmTimer);
    endConfirmTimer = null;
  }
}

function requestEndTurn(): void {
  if (battle.value.phase !== 'player' || gameStore.enemyTurnRunning || battle.value.status !== 'ongoing') {
    return;
  }
  showItemsMenu.value = false;
  // Heroes can still act: ask once, and keep asking until the player answers. The question
  // goes away only when they confirm, decline, or do something else.
  if (readyHeroesCount.value > 0 && !endConfirmPending.value) {
    endConfirmPending.value = true;
    return;
  }
  clearEndConfirm();
  void endPlayerTurn();
}

function selectSquadCard(unitId: string): void {
  showItemsMenu.value = false;
  clearEndConfirm();
  selectBattleUnit(unitId, true, false);
}

const enemiesInAttackRange = computed(() => {
  if (!selectedUnit.value || battle.value.phase !== 'player' || selectedUnit.value.actions.hasAttacked) {
    return 0;
  }
  const tiles = getAttackableTiles(battle.value, selectedUnit.value);
  return tiles.filter((pos) => {
    const u = unitAt(battle.value, pos);
    return u && u.team === 'enemy' && forecastAttack(battle.value, selectedUnit.value!, pos).canAttack;
  }).length;
});

const dashHintCount = computed(() =>
  selectedUnit.value && battle.value.phase === 'player'
    ? computeDashOptions(battle.value, selectedUnit.value).length
    : 0
);

const jumpHintCount = computed(() =>
  selectedUnit.value && battle.value.phase === 'player'
    ? computeTeamJumpOptions(battle.value, selectedUnit.value).size
    : 0
);

const heroDoneMap = computed(() => {
  void gameStore.eventQueueVersion;
  void battle.value.phase;
  void battle.value.turn;
  void totalItemsLeft.value;
  void aliveEnemiesCount.value;
  const map: Record<string, boolean> = {};
  const rawBattle = toRaw(battle.value);
  for (const u of playerUnits.value) {
    void u.alive;
    void u.actions.hasMoved;
    void u.actions.moveSpent;
    void u.actions.hasAttacked;
    void u.actions.hasUsedSkill;
    void u.abilityCooldown;
    void u.statuses.length;
    void u.pos.x;
    void u.pos.y;
    map[u.id] = !u.alive || !unitHasMeaningfulAction(rawBattle, toRaw(u));
  }
  return map;
});

/** Heroes that have not attacked, cast a skill or gone on Watch this turn. Leftover steps do not count. */
const readyHeroesCount = computed(
  () =>
    playerUnits.value.filter(
      (u) =>
        u.alive &&
        !u.isEscortCart &&
        !heroDoneMap.value[u.id] &&
        !u.actions.hasAttacked &&
        !u.actions.hasUsedSkill &&
        !u.statuses.some((st) => st.kind === 'overwatch')
    ).length
);

const totalItemsLeft = computed(() =>
  Object.values(battle.value.items).reduce((acc, n) => acc + n, 0)
);

const showBottomConsoleDeck = computed(() =>
  Boolean(selectedUnit.value || inspectedEnemy.value)
);

function isHeroDone(unitId: string): boolean {
  return heroDoneMap.value[unitId] ?? true;
}

function hpColor(hp: number, maxHp: number): string {
  const r = hp / Math.max(1, maxHp);
  if (r > 0.55) return '#58b842';
  if (r > 0.28) return '#edb328';
  return '#df4a3a';
}

function optionIcon(kind: PreviewActionOption['kind']): CraftIconName {
  switch (kind) {
    case 'move':
      return 'move';
    case 'jump':
      return 'star';
    case 'dash':
      return 'dash';
    case 'attack':
      return 'attack';
    case 'ability':
      return 'skill';
    case 'item':
      return 'bag';
  }
}

function toggleMode(targetMode: InteractionMode): void {
  showItemsMenu.value = false;
  clearEndConfirm();
  if (gameStore.mode === targetMode) {
    setInteractionMode('move');
  } else {
    setInteractionMode(targetMode);
  }
}

function pickItem(itemId: string): void {
  showItemsMenu.value = false;
  clearEndConfirm();
  setInteractionMode('item', itemId);
}

function recenterBoard(): void {
  activeRenderer?.resetCamera();
}

function zoomBoard(delta: number): void {
  activeRenderer?.adjustZoom(delta);
}

function rotate3DCamera(dir: -1 | 1): void {
  activeRenderer?.rotateCamera?.(dir * (Math.PI / 4));
}

function handleToggleTacticam(): void {
  if (!is3D.value) {
    switchBoardView();
    return;
  }
  const next = activeRenderer?.toggleTacticam?.();
  if (next) cameraMode.value = next;
}

function switchBoardView(): void {
  const next = toggleBoardViewMode();
  activeRenderer?.resetCamera(next);
}

function switchRendererKind(): void {
  showUtilityMenu.value = false;
  webglFallbackNotice.value = false;
  toggleRendererKind();
}

function inspectGraft(gid: string): void {
  const g = GRAFT_REGISTRY[gid];
  if (!g) return;
  inspectedNote.value = { title: `${g.badgeIcon} ${g.name}`, desc: g.description };
}

function inspectRelic(rid: string): void {
  const r = RELIC_REGISTRY[rid];
  if (!r) return;
  inspectedNote.value = { title: `${r.icon} ${r.name}`, desc: r.description };
}

/**
 * On phones the bottom deck covers a third of the screen, so tell the 3D camera to frame the
 * board in the space above it. The inset is fixed per phase (the taller deployment deck, then
 * the normal command deck) so the board never slides while the player is tapping tiles.
 */
const bottomHudRef = ref<HTMLElement | null>(null);
function syncHudInsets(): void {
  if (typeof window === 'undefined') return;
  if (!gameStore.battle) {
    activeRenderer?.setHudInsets?.(0, 0);
    return;
  }
  const prep = Boolean(gameStore.battle.prepPhase);
  const measured = bottomHudRef.value?.offsetHeight ?? 0;
  if (window.innerWidth >= 768) {
    // Desktop: only the tall deploy panel hides tiles, so lift the board above it while deploying.
    activeRenderer?.setHudInsets?.(0, prep ? Math.min(measured, window.innerHeight * 0.4) : 0);
    return;
  }
  activeRenderer?.setHudInsets?.(84, prep ? Math.max(260, measured) : 200);
}

watch(
  () => [gameStore.selectedUnitId, gameStore.mode, gameStore.previewTile, gameStore.battle?.turn, gameStore.battle?.phase],
  () => clearEndConfirm()
);

watch(
  () => [gameStore.mode, gameStore.selectedItemId],
  () => {
    if (gameStore.mode !== 'move') dismissFarmerRecap();
  }
);

/** What to tap while a skill or item is armed, in words that match what is glowing. */
const skillTargetPrompt = computed(() => {
  const u = selectedUnit.value;
  const verb = gameStore.isTouchMode ? 'Tap' : 'Click';
  if (!u) return `${verb} a glowing tile`;
  if (gameStore.mode === 'ability' && u.ability) {
    const count = getAbilityTargetTiles(battle.value, u).length;
    if (u.ability.targetType === 'enemy') {
      return count > 0 ? `${verb} a glowing farmer` : `No farmer within ${u.ability.range} tiles. Move closer.`;
    }
    if (u.ability.targetType === 'ally') return `${verb} a glowing ally`;
    return `${verb} a glowing purple tile`;
  }
  return `${verb} a glowing white tile`;
});

// Notes and hints are short-lived: they close on their own and never sit over the board.
let noteTimer: ReturnType<typeof setTimeout> | null = null;
watch(inspectedNote, (note) => {
  if (noteTimer !== null) clearTimeout(noteTimer);
  noteTimer = note ? setTimeout(() => (inspectedNote.value = null), 6000) : null;
});
watch(
  () => [gameStore.battle?.prepPhase, gameStore.battle?.phase, gameStore.battle?.turn],
  () => (inspectedNote.value = null)
);
const boardHintText = ref<string | null>(null);
let hintTimer: ReturnType<typeof setTimeout> | null = null;
watch(
  () => gameStore.boardHint?.id,
  () => {
    if (!gameStore.boardHint) return;
    boardHintText.value = gameStore.boardHint.text;
    if (hintTimer !== null) clearTimeout(hintTimer);
    hintTimer = setTimeout(() => (boardHintText.value = null), 2600);
  }
);

const objectiveLine = computed(() => {
  void gameStore.eventQueueVersion;
  const b = battle.value;
  const foes = aliveEnemiesCount.value;
  if (b.objective === 'smash_crates') {
    const left = b.tiles.reduce(
      (sum, row) => sum + row.filter((t) => t.cover?.isObjectiveCrate).length,
      0
    );
    return `📦 Smash ${left} Supply Crate${left === 1 ? '' : 's'} · ${foes} foes`;
  }
  if (b.objective === 'survive') {
    const total = b.surviveTurns ?? 4;
    return `🛡️ Hold Turn ${Math.min(b.turn, total)}/${total} · ${foes} foes`;
  }
  if (b.objective === 'escort' && escortCart.value) {
    return `🛒 Seed Cart ${escortCart.value.hp}/${escortCart.value.maxHp} HP · ${foes} foes`;
  }
  if (b.objective === 'rout') return `🏃 Rout · bonk ${routLeft.value} more · ${foes} foes`;
  return `${b.objectiveLabel} · ${foes} ${foes === 1 ? 'foe' : 'foes'} left`;
});

const coopPlayers = computed(() =>
  battle.value.coopPlayers && battle.value.coopPlayers.length > 1 ? battle.value.coopPlayers : null
);

const activeCoopPlayer = computed(() => {
  if (!coopPlayers.value) return null;
  const idx = battle.value.activeCoopPlayerIdx ?? 0;
  return coopPlayers.value[idx] ?? coopPlayers.value[0];
});

const battleMaxElevation = computed(() => {
  let maxE = 0;
  for (const row of battle.value.tiles) {
    for (const tile of row) {
      if ((tile.elevation ?? 0) > maxE) maxE = tile.elevation ?? 0;
    }
  }
  return maxE;
});

function unitCoopBadge(u: { ownerPlayerIdx?: number }) {
  if (!coopPlayers.value || typeof u.ownerPlayerIdx !== 'number') return null;
  return coopPlayers.value[u.ownerPlayerIdx] ?? null;
}

/** Squad Bonds for the heroes on the board: live while deploying, fixed once Turn 1 starts. */
const squadBonds = computed<BondStatus[]>(() => {
  const b = battle.value;
  if (!b) return [];
  const heroes = b.units.filter((u) => u.team === 'player' && !u.isEscortCart);
  const all = bondStatuses(heroes);
  if (!b.bondsApplied) return all;
  const locked = new Map((b.activeBonds ?? []).map((a) => [a.id, a.tier]));
  return all
    .map((s) => {
      const tier = (locked.get(s.def.id) ?? 0) as 0 | 1 | 2;
      return { ...s, tier, effect: s.def.tiers[Math.max(0, tier - 1)] ?? s.def.tiers[0] };
    })
    .filter((s) => s.tier > 0);
});
const activeSquadBonds = computed(() => squadBonds.value.filter((s) => s.tier > 0));

function bondChipLabel(s: BondStatus): string {
  if (s.tier > 0) return `${s.def.name}${s.tier > 1 ? ' II' : ''}`;
  return `${s.def.name} ${s.count}/${s.def.thresholds[0]}`;
}

function inspectBond(s: BondStatus): void {
  const next =
    s.tier > 0 && s.missing > 0
      ? ` Add ${s.missing} more for: ${s.def.tiers[s.tier]}`
      : s.tier === 0
        ? ` Needs ${s.def.thresholds[0]} (${s.def.who}); you have ${s.count}.`
        : '';
  inspectedNote.value = {
    title: `${s.def.icon} ${s.def.name}${s.tier > 1 ? ' II' : ''} · Squad Bond`,
    desc: `${s.effect}${next}`,
  };
}

function inspectAllBonds(): void {
  inspectedNote.value = {
    title: 'Squad Bonds',
    desc: activeSquadBonds.value.map((s) => `${s.def.icon} ${s.def.name}${s.tier > 1 ? ' II' : ''}: ${s.effect}`).join(' '),
  };
}

function inspectCoop(name: string, passive: string): void {
  inspectedNote.value = { title: `${name} Co-op Trait`, desc: passive };
}

function inspectSelectedHeroSummary(): void {
  const u = selectedUnit.value;
  if (!u) return;
  const skillPart = u.ability ? `Skill: ${u.ability.name} — ${u.ability.description}` : '';
  inspectedNote.value = {
    title: `${u.name} (${getFamilyLabel(u.family)})`,
    desc: `${u.weapon.name} (${u.weapon.damage} dmg, R${u.weapon.minRange}-${u.weapon.maxRange}) · Move ${u.moveRange}. ${skillPart}`,
  };
}

function handleTabAwayFocusClear(): void {
  showItemsMenu.value = false;
  showUtilityMenu.value = false;
  inspectedNote.value = null;
  clearEndConfirm();
  clearFocusOnTabAway();
  if (typeof document !== 'undefined' && document.activeElement instanceof HTMLElement) {
    document.activeElement.blur();
  }
}

function onVisibilityChange(): void {
  if (typeof document !== 'undefined' && document.hidden) {
    handleTabAwayFocusClear();
  }
}

const routLeft = computed(() => {
  void gameStore.eventQueueVersion;
  const bonked = battle.value.units.filter((u) => u.team === 'enemy' && !u.alive).length;
  return Math.max(0, (battle.value.routTarget ?? 0) - bonked);
});

const victoryGrade = computed(() =>
  battle.value.status === 'victory' ? gradeBattle(toRaw(battle.value)) : null
);

const selectedMoveLeft = computed(() => (selectedUnit.value ? getRemainingMove(selectedUnit.value) : 0));

const remainingDashesForSelected = computed(() => {
  const u = selectedUnit.value;
  if (!u) return 0;
  const used = u.actions.dashesUsed ?? (u.actions.hasDashed ? 1 : 0);
  return Math.max(0, getMaxDashesForUnit(u) - used);
});

const overwatchChargesForSelected = computed(() =>
  selectedUnit.value ? getMaxOverwatchCharges(selectedUnit.value, battle.value.relicIds) : 1
);

/** Live positioning & pose pills shown on the Command Deck for the active hero. */
const selectedStanceBadges = computed<Array<{ id: string; label: string; tone: string; desc: string }>>(() => {
  void gameStore.eventQueueVersion;
  const u = selectedUnit.value;
  if (!u || !u.alive) return [];
  const raw = toRaw(battle.value);
  const badges: Array<{ id: string; label: string; tone: string; desc: string }> = [];
  const adjCover = getAdjacentCoverBadges(raw, u.pos, u.team);
  if (adjCover.some((c) => c.level === 'full')) {
    badges.push({
      id: 'full_cover',
      label: '🛡️ Full Cover',
      tone: 'cover-full',
      desc: 'Taking Full Cover — blocks direct gunfire from covered sides (0% hit). Watch out for lobbed attacks and flanks!',
    });
  } else if (adjCover.length > 0) {
    badges.push({
      id: 'half_cover',
      label: '◐ Half Cover',
      tone: 'cover-half',
      desc: 'Taking Half Cover — lowers incoming direct gunfire to 50% hit chance from covered angles.',
    });
  }
  const t = tileAt(raw, u.pos);
  if (t && (t.elevation ?? 0) > 0) {
    const elev = t.elevation ?? 1;
    const baseHg = elev >= 2 ? 3 : 2;
    const hgDmg = baseHg + (hasRelic(raw.relicIds, 'copper_weathervane') ? 1 : 0);
    badges.push({
      id: 'high_ground',
      label: elev >= 2 ? `▲ Summit Lv.${elev} +${hgDmg}` : `▲ High Ground +${hgDmg}`,
      tone: 'high-ground',
      desc:
        elev >= 2
          ? `Summit cliff (Height ${elev}): +${hgDmg} DMG downward, ignores enemy Half Cover below, AND foes 2+ stories lower suffer 50% uphill cover!`
          : `Elevated perch (Height ${elev}): +${hgDmg} Attack damage & ignores enemy Half Cover below you!`,
    });
  }
  if (t?.terrain === 'sunbeam') {
    badges.push({
      id: 'sunbeam',
      label: '☀️ Sunbeam +2',
      tone: 'sunbeam',
      desc: 'Standing in a warm Sunbeam: +2 bonus Attack damage on every shot!',
    });
  }
  return badges;
});

function handleTriggerOverwatch(): void {
  showItemsMenu.value = false;
  clearEndConfirm();
  triggerOverwatch();
}

function onKeyDown(e: KeyboardEvent): void {
  if (gameStore.enemyTurnRunning || battle.value.status !== 'ongoing') return;

  if (gameStore.coopHandoffBanner) {
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') {
      e.preventDefault();
      dismissCoopHandoff();
    }
    return;
  }

  if (e.key === 'Escape') {
    showItemsMenu.value = false;
    showUtilityMenu.value = false;
    showAlmanac.value = false;
    showPrepArmory.value = false;
    inspectedNote.value = null;
    clearEndConfirm();
    deselectAll(true);
    return;
  }

  if (showAlmanac.value || showPrepArmory.value) return;

  // Hero quick-select 1..4
  if (e.key >= '1' && e.key <= '4') {
    const idx = Number(e.key) - 1;
    const hero = playerUnits.value[idx];
    if (hero && hero.alive) {
      selectSquadCard(hero.id);
    }
    return;
  }

  if (e.key === 'Tab') {
    e.preventDefault();
    const alive = playerUnits.value.filter((u) => u.alive);
    if (alive.length === 0) return;
    // Smart Tab: prefer heroes who still have remaining actions!
    const ready = alive.filter((u) => !isHeroDone(u.id));
    const pool = ready.length > 0 ? ready : alive;
    const curIdx = pool.findIndex((u) => u.id === gameStore.selectedUnitId);
    const next = pool[(curIdx + 1) % pool.length];
    if (next) selectSquadCard(next.id);
    return;
  }

  const lower = e.key.toLowerCase();
  if (lower === 'q') {
    rotate3DCamera(-1);
    return;
  } else if (lower === 'e') {
    rotate3DCamera(1);
    return;
  } else if (lower === 't') {
    handleToggleTacticam();
    return;
  } else if (lower === 'r') {
    recenterBoard();
    return;
  }

  if (battle.value.prepPhase) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      confirmPrepPhase();
    }
    return;
  }

  // Aim Cam target cycling with A/D or Left/Right!
  if (
    gameStore.mode === 'attack' &&
    aimTargets.value.length > 0 &&
    (lower === 'a' || lower === 'd' || e.key === 'ArrowLeft' || e.key === 'ArrowRight')
  ) {
    e.preventDefault();
    cycleAimTarget(lower === 'a' || e.key === 'ArrowLeft' ? -1 : 1);
    return;
  }

  if (lower === 'f' && selectedUnit.value && !selectedUnit.value.actions.hasAttacked) {
    toggleMode('attack');
  } else if (lower === 'o' && selectedUnit.value && !selectedUnit.value.actions.hasAttacked) {
    handleTriggerOverwatch();
  } else if (
    lower === 's' &&
    selectedUnit.value?.ability &&
    !selectedUnit.value.actions.hasUsedSkill &&
    selectedUnit.value.abilityCooldown === 0
  ) {
    toggleMode('ability');
  } else if (
    lower === 'b' &&
    selectedUnit.value &&
    !selectedUnit.value.actions.hasUsedSkill &&
    totalItemsLeft.value > 0
  ) {
    showItemsMenu.value = !showItemsMenu.value;
  } else if (lower === 'm' && selectedUnit.value) {
    setInteractionMode('move');
  } else if (lower === 'z' && battle.value.undoSnapshot) {
    triggerUndoMove();
  } else if ((e.key === 'Enter' || e.key === ' ') && previewOptions.value.length > 0) {
    e.preventDefault();
    // While aiming, Enter always fires; it never picks the Dash that may sit beside FIRE.
    const opts = previewOptions.value;
    const pick = gameStore.mode === 'attack' ? (opts.find((o) => o.kind === 'attack') ?? opts[0]) : opts[0];
    executePreviewOption(pick.kind);
  } else if (e.key === 'Enter') {
    // Nothing to confirm on the board: Enter asks to end the turn, and a second Enter confirms.
    e.preventDefault();
    requestEndTurn();
  } else if (e.key === 'Escape' && endConfirmPending.value) {
    clearEndConfirm();
  }
}

function readViewState() {
  if (!gameStore.battle) return null;
  return {
    battle: toRaw(gameStore.battle),
    selectedUnitId: gameStore.selectedUnitId,
    inspectedEnemyId: gameStore.inspectedEnemyId,
    showAllDangerZone: gameStore.showAllDangerZone,
    previewOverwatch: gameStore.previewOverwatch,
    mode: gameStore.mode,
    selectedItemId: gameStore.selectedItemId,
    hoveredTile: gameStore.hoveredTile ? toRaw(gameStore.hoveredTile) : null,
    previewTile: gameStore.previewTile ? toRaw(gameStore.previewTile) : null,
    viewMode: gameStore.viewMode,
  };
}

function handleCanvasTileTap(pos: { x: number; y: number }, pointerType: string): void {
  showItemsMenu.value = false;
  showUtilityMenu.value = false;
  inspectedNote.value = null;
  clearEndConfirm();
  handleBattleTileTap(pos, pointerType);
}

function handleCanvasOffBoardTap(): void {
  showItemsMenu.value = false;
  showUtilityMenu.value = false;
  inspectedNote.value = null;
  clearEndConfirm();
  handleOffBoardTap();
}

function handleCanvasRightClickCancel(): void {
  showItemsMenu.value = false;
  showUtilityMenu.value = false;
  inspectedNote.value = null;
  clearEndConfirm();
  handleRightClickCancel();
}

function destroyActiveRenderer(): void {
  activeRenderer?.destroy();
  activeRenderer = null;
  focusAnchor.value = null;
  phaseBanner.value = null;
}

function mountActiveRenderer(): void {
  destroyActiveRenderer();

  if (gameStore.rendererKind === '3d') {
    if (!webglCanvasRef.value) return;
    try {
      activeRenderer = new PaperDioramaRenderer(
        webglCanvasRef.value,
        overlayCanvasRef.value,
        {
          getState: readViewState,
          onHoverChange: (pos) => setHoveredTile(pos),
          onTileTap: handleCanvasTileTap,
          onOffBoardTap: handleCanvasOffBoardTap,
          onRightClickCancel: handleCanvasRightClickCancel,
          onZoomChange: (pct) => {
            zoomPercent.value = pct;
          },
          onCameraModeChange: (mode) => {
            cameraMode.value = mode;
          },
          onFocusAnchorChange: (anchor) => {
            focusAnchor.value = anchor;
          },
          onBannerChange: (banner) => {
            phaseBanner.value = banner;
          },
        }
      );
      cameraMode.value = activeRenderer.getCameraMode?.() ?? 'tactical';
      return;
    } catch (err) {
      console.warn('WebGL 3D Paper Diorama unavailable, falling back to 2D Canvas:', err);
      webglFallbackNotice.value = true;
      gameStore.rendererKind = '2d';
      return;
    }
  }

  if (!canvas2dRef.value) return;
  activeRenderer = new PaperCraftRenderer(
    canvas2dRef.value,
    readViewState,
    (pos) => setHoveredTile(pos),
    handleCanvasTileTap,
    handleCanvasOffBoardTap,
    (pct) => {
      zoomPercent.value = pct;
    }
  );
}

watch(
  () => gameStore.rendererKind,
  async () => {
    await nextTick();
    mountActiveRenderer();
  }
);

onMounted(() => {
  mountActiveRenderer();

  nextTick(syncHudInsets);
  window.addEventListener('resize', syncHudInsets);

  unsubscribeEvents = subscribeBattleEvents((events) => {
    activeRenderer?.consumeEvents(events);
  });
  unsubscribeFocus = subscribeCameraFocus((pos) => {
    activeRenderer?.focusOnGrid(pos);
  });
  unsubscribeUndoReset = subscribeUndoReset(() => {
    showItemsMenu.value = false;
    clearEndConfirm();
    activeRenderer?.cancelActiveAnims();
  });

  window.addEventListener('blur', handleTabAwayFocusClear);
  document.addEventListener('visibilitychange', onVisibilityChange);
  window.addEventListener('keydown', onKeyDown);
});

watch(
  () => [gameStore.battle?.prepPhase, gameStore.rendererKind],
  () => nextTick(syncHudInsets)
);

onBeforeUnmount(() => {
  window.removeEventListener('resize', syncHudInsets);
  unsubscribeEvents?.();
  unsubscribeFocus?.();
  unsubscribeUndoReset?.();
  clearEndConfirm();
  clearAutoEndTimer();
  destroyActiveRenderer();
  window.removeEventListener('blur', handleTabAwayFocusClear);
  document.removeEventListener('visibilitychange', onVisibilityChange);
  window.removeEventListener('keydown', onKeyDown);
});
</script>

<template>
  <div class="battle-shell">
    <!-- 3D Paper Mario WebGL Diorama + Crisp Projected 2D World-Overlay Canvas -->
    <template v-if="is3D">
      <canvas ref="webglCanvasRef" class="battle-canvas"></canvas>
      <canvas ref="overlayCanvasRef" class="battle-overlay-canvas"></canvas>
    </template>
    <!-- Classic 2D Paper-Craft Canvas (switchable in Field Notebook / automatic fallback) -->
    <canvas v-else ref="canvas2dRef" class="battle-canvas"></canvas>

    <!-- Full-Width Mario + Rabbids Slanted Phase Splash Banner -->
    <transition name="banner-sweep">
      <div v-if="phaseBanner" class="phase-splash-wrap" aria-live="polite">
        <div class="phase-splash-ribbon" :class="phaseBanner.tone">
          <span class="phase-splash-text">{{ phaseBanner.text }}</span>
        </div>
      </div>
    </transition>

    <!-- Floating World-Space Mario + Rabbids Target Forecast Pill (Anchored to 3D Target!) -->
    <div
      v-if="showWorldForecastPill"
      ref="worldForecastRef"
      class="world-forecast-pill"
      :class="{ interactive: worldForecastInteractive }"
      :style="worldForecastStyle"
    >
      <div class="wf-card">
        <div class="wf-top">
          <div class="wf-hit-col">
            <div
              v-if="activeForecast"
              class="wf-pct-badge"
              :class="{
                full: activeForecast.hitChance >= 100,
                half: activeForecast.hitChance > 0 && activeForecast.hitChance < 100,
                zero: activeForecast.hitChance === 0,
              }"
            >
              <CraftIcon
                v-if="activeForecast.coverLevel !== 'none'"
                :name="activeForecast.coverLevel === 'full' ? 'shield_full' : 'shield_half'"
                :size="13"
              />
              <span>{{ activeForecast.hitChance }}%</span>
            </div>
            <div v-else class="wf-pct-badge dash">⚡ DASH</div>
          </div>

          <div class="wf-info-col">
            <div class="wf-name-row">
              <strong>
                {{
                  focusedUnit
                    ? focusedUnit.name
                    : activeForecast?.isBridgeTarget
                      ? 'WOODEN BRIDGE'
                      : focusedCover?.kind === 'pumpkin'
                        ? 'ROLLING PUMPKIN'
                        : focusedCover?.kind.toUpperCase()
                }}
              </strong>
              <span
                v-if="focusedUnit && activeForecast && activeForecast.matchup !== 'neutral'"
                class="wf-match"
                :class="activeForecast.matchup"
              >
                {{ activeForecast.matchup === 'advantage' ? `▲ ${advantagePctLabel}` : '▼ -20%' }}
              </span>
              <span v-if="activeForecast?.isLethal" class="wf-ko-stamp">KO!</span>
            </div>

            <!-- Blinking Mario + Rabbids Predicted HP Loss Bar -->
            <div v-if="forecastHpBars" class="wf-hp-wrap">
              <div class="wf-hp-track">
                <div
                  class="wf-hp-rem"
                  :style="{ width: `${forecastHpBars.remainingPct}%` }"
                ></div>
                <div
                  v-if="forecastHpBars.damagePct > 0"
                  class="wf-hp-dmg"
                  :style="{
                    left: `${forecastHpBars.remainingPct}%`,
                    width: `${forecastHpBars.damagePct}%`,
                  }"
                ></div>
              </div>
              <span class="wf-hp-num">
                {{ forecastHpBars.cur }} → {{ forecastHpBars.rem }}
              </span>
            </div>

            <div class="wf-tags-row">
              <span v-if="activeForecast?.canAttack" class="wf-dmg-chip">
                -{{ activeForecast.isBridgeTarget || activeForecast.isPumpkinTarget ? activeForecast.coverDamage : activeForecast.finalDamage }} DMG
              </span>
              <span v-else-if="activeForecast && !activeForecast.canAttack" class="wf-blocked-chip">
                BLOCKED (Full Cover)
              </span>
              <span v-if="activeForecast?.partnerAssistDamage" class="wf-assist-chip">
                ★ +{{ activeForecast.partnerAssistDamage }} ASSIST
              </span>
              <span v-if="activeForecast?.isPumpkinTarget" class="wf-pumpkin-chip">
                🎃 BOWL 4 DMG
              </span>
              <span v-if="activeForecast?.isBridgeTarget" class="wf-bridge-chip">
                🪵 COLLAPSE
              </span>
              <span v-if="activeForecast?.highGroundBonus" class="wf-high-chip">
                ▲ HIGH +{{ activeForecast.highGroundBonus }}
              </span>
              <span v-if="activeForecast?.isCriticalFlank" class="wf-crit-chip">
                ★ FLANK CRIT
              </span>
              <span v-if="previewDashDamage !== null" class="wf-dash-chip">
                ⚡ Dash -{{ previewDashDamage }}
              </span>
              <span
                v-if="activeForecast?.knockbackDir"
                class="wf-kb-chip"
                :class="[
                  activeForecast.knockbackHazard ?? (activeForecast.knockbackWillBump ? 'bump' : ''),
                ]"
              >
                {{
                  hazardTagLabel(
                    activeForecast.knockbackHazard ?? (activeForecast.knockbackWillBump ? 'bump' : undefined)
                  )
                }}
              </span>
            </div>
          </div>
        </div>

        <!-- World-Anchored Quick Action Pills right over the locked target! -->
        <div v-if="worldForecastInteractive" class="wf-quick-bar">
          <button
            v-if="gameStore.mode === 'attack' && aimTargets.length > 1"
            class="wf-qbtn cycle"
            title="Previous Target (A)"
            @click.stop="cycleAimTarget(-1)"
          >
            ◀
          </button>
          <button
            v-for="opt in previewOptions"
            :key="opt.kind"
            class="wf-qbtn"
            :class="opt.kind"
            @click.stop="executePreviewOption(opt.kind)"
          >
            <template v-if="opt.kind === 'dash'">⚡ {{ opt.label }}</template>
            <template v-else-if="opt.kind === 'attack'">🎯 {{ focusedUnit ? 'FIRE!' : opt.label }}</template>
            <template v-else>{{ opt.label }}</template>
          </button>
          <button
            v-if="gameStore.mode === 'attack' && aimTargets.length > 1"
            class="wf-qbtn cycle"
            title="Next Target (D)"
            @click.stop="cycleAimTarget(1)"
          >
            ▶
          </button>
          <button
            class="wf-qbtn dismiss"
            title="Cancel (Right-Click / Esc)"
            @click.stop="cancelPreviewAction"
          >
            ✕
          </button>
        </div>
      </div>
      <div class="wf-pointer"></div>
    </div>

    <!-- Top Tactical Bar -->
    <header class="top-hud">
      <div class="mr-top-banner kraft-ribbon">
        <span class="turn-stamp" :class="battle.prepPhase ? 'prep' : battle.phase">
          {{
            battle.prepPhase
              ? 'PREP'
              : battle.phase === 'player'
                ? `TURN ${battle.turn}`
                : gameStore.enemyTurnProgress
                  ? `FARMER ${gameStore.enemyTurnProgress.index}/${gameStore.enemyTurnProgress.total}`
                  : 'FARMER'
          }}
        </span>
        <div class="status-copy desktop-only">
          <strong>{{ battle.mapName }}</strong>
          <small>{{ objectiveLine }}</small>
        </div>
        <span class="mobile-obj-inline mobile-only">{{ objectiveLine }}</span>
        <span
          v-if="battle.parTurns"
          class="cam-mode-pill par desktop-only"
          :class="{ over: !battle.prepPhase && battle.turn > battle.parTurns }"
          :title="`Win within ${battle.parTurns} turns for a Great Harvest, with no hero bagged for a Perfect Harvest`"
        >
          ⏱ Goal: {{ battle.parTurns }} turns
        </span>
        <button
          v-if="!battle.prepPhase && activeSquadBonds.length > 0"
          class="cam-mode-pill bonds desktop-only"
          title="Squad Bonds"
          aria-label="Show Squad Bonds"
          @click="inspectAllBonds"
        >
          {{ activeSquadBonds.map((s) => s.def.icon).join('') }}
        </button>
        <span v-if="(battle.harvestHeat ?? 0) > 0" class="cam-mode-pill heat">
          🔥 H{{ battle.harvestHeat }}
        </span>
        <span
          v-if="activeCoopPlayer && battle.phase === 'player' && !battle.prepPhase"
          class="cam-mode-pill coop-active-pill"
          :style="{ background: activeCoopPlayer.color }"
        >
          🎮 {{ battle.coopFreeOrder ? `${coopPlayers?.length}P Free` : `${activeCoopPlayer.badge} Turn` }}
        </span>
        <span
          v-if="(battle.coopComboCount ?? 0) > 0"
          class="cam-mode-pill coop-combo-pill desktop-only"
          title="Cross-Player Co-Op Combos triggered this battle!"
        >
          🤝 {{ battle.coopComboCount }} Combo{{ battle.coopComboCount === 1 ? '' : 's' }}
        </span>
        <span v-if="is3D && cameraMode === 'aim'" class="cam-mode-pill aim desktop-only">AIM CAM</span>
        <span v-else-if="is3D && cameraMode === 'tacticam'" class="cam-mode-pill tacticam desktop-only">TACTICAM</span>
      </div>

      <div class="top-actions">
        <div v-if="battle.relicIds.length > 0" class="kraft-ribbon relic-rack desktop-only">
          <button
            v-for="rid in battle.relicIds"
            :key="rid"
            class="relic-chip"
            :title="`${RELIC_REGISTRY[rid]?.name}: ${RELIC_REGISTRY[rid]?.description}`"
            @click="inspectRelic(rid)"
          >
            {{ RELIC_REGISTRY[rid]?.icon }}
          </button>
        </div>

        <!-- 3D Mario + Rabbids Camera Cluster (Desktop quick bar; mobile lives in Field Notebook menu) -->
        <div v-if="is3D" class="cam-cluster kraft-ribbon desktop-only">
          <button
            class="cam-btn"
            :class="{ active: cameraMode === 'tacticam' }"
            title="Toggle Tacticam Bird's-Eye View (T)"
            @click="handleToggleTacticam"
          >
            <CraftIcon :name="cameraMode === 'tacticam' ? 'iso' : 'topdown'" :size="15" />
            <span>Tacticam</span>
          </button>
          <button
            class="cam-btn"
            title="Orbit Left (Q)"
            aria-label="Rotate camera left"
            @click="rotate3DCamera(-1)"
          >
            ⟲
          </button>
          <button
            class="cam-btn"
            title="Orbit Right (E)"
            aria-label="Rotate camera right"
            @click="rotate3DCamera(1)"
          >
            ⟳
          </button>
          <button
            class="cam-btn"
            title="Reset Camera (R)"
            aria-label="Reset camera"
            @click="recenterBoard"
          >
            <CraftIcon name="center" :size="14" />
          </button>
        </div>

        <!-- Quick Soundtrack Toggle -->
        <button
          class="paper-btn tool-btn desktop-only"
          :aria-label="gameStore.musicMuted ? 'Unmute Music' : 'Mute Music'"
          :title="gameStore.musicMuted ? 'Unmute Soundtrack' : 'Mute Soundtrack'"
          @click="toggleMusicMute"
        >
          <span>{{ gameStore.musicMuted ? '🔇' : '🎵' }}</span>
        </button>

        <!-- 1x / 2x Enemy Phase Speed Toggle (Desktop top bar; Mobile inside Menu) -->
        <button
          class="paper-btn tool-btn speed-btn desktop-only"
          :class="{ 'speed-fast': gameStore.enemySpeedFast }"
          :aria-label="gameStore.enemySpeedFast ? 'Enemy speed 2x (Fast)' : 'Enemy speed 1x (Normal)'"
          title="Toggle Farmer Phase Speed (1× / 2×)"
          @click="toggleEnemySpeed"
        >
          <span>{{ gameStore.enemySpeedFast ? '2×' : '1×' }}</span>
        </button>

        <!-- Global Enemy Danger Zone Toggle (Desktop top bar; Mobile inside Menu) -->
        <button
          class="paper-btn tool-btn desktop-only"
          :class="{ 'danger-on': gameStore.showAllDangerZone }"
          aria-label="Toggle all enemy danger zones"
          title="Show/Hide All Enemy Danger Zones"
          @click="toggleAllDangerZone"
        >
          <CraftIcon name="warning" :size="16" />
        </button>

        <button
          v-if="!battle.prepPhase"
          class="paper-btn tool-btn"
          :class="{ 'undo-ready': Boolean(battle.undoSnapshot) }"
          :disabled="!battle.undoSnapshot || battle.phase !== 'player' || gameStore.enemyTurnRunning"
          aria-label="Undo last move (Z)"
          title="Undo last move (Z)"
          @click="triggerUndoMove"
        >
          <CraftIcon name="undo" :size="16" />
        </button>

        <button
          class="paper-btn tool-btn menu-tool-btn"
          aria-label="Field Notebook Menu"
          title="Field Notebook, Camera, Bonds & Settings"
          @click="showUtilityMenu = !showUtilityMenu"
        >
          <CraftIcon name="menu" :size="16" />
          <span v-if="hasMobileMenuAlert" class="menu-active-dot mobile-only" aria-hidden="true"></span>
        </button>
      </div>
    </header>

    <!-- Farmer Turn: say that a tap fast-forwards it -->
    <div
      v-if="gameStore.enemyTurnRunning && battle.status === 'ongoing' && !gameStore.enemyHurry"
      class="hurry-hint"
      aria-hidden="true"
    >
      Tap the board to fast-forward ▸▸
    </div>

    <!-- Boss Telegraphed Super-Attack Alert Pill -->
    <div
      v-if="activeBossTelegraphs.length > 0 && battle.status === 'ongoing'"
      class="boss-telegraph-strip"
      role="status"
    >
      <span class="bt-icon">⚠️</span>
      <span class="bt-copy">
        <strong>{{ activeBossTelegraphs[0].name }}</strong>
        ({{ activeBossTelegraphs[0].damage }} DMG next Farmer Turn) — Move off red tiles!
      </span>
    </div>

    <!-- Turn-1 Sticky-Note Coachmarks -->
    <div
      v-if="
        (gameStore.meta.guidedHintsEnabled ?? true) &&
        !battle.prepPhase &&
        coachStep >= 0 &&
        battle.phase === 'player' &&
        battle.status === 'ongoing' &&
        gameStore.mode === 'move' &&
        !gameStore.previewTile &&
        !inspectedEnemy &&
        !gameStore.farmerRecap &&
        !gameStore.coopHandoffBanner
      "
      class="coach-note paper-card pinned-card"
    >
      <span class="brass-pin tl"></span>
      <div class="coach-copy">
        <strong>{{ COACH_TIPS[coachStep].title }}</strong>
        <small>{{ COACH_TIPS[coachStep].body }}</small>
      </div>
      <div class="coach-actions">
        <button class="paper-btn gold mini-act" @click="advanceCoach">
          {{ coachStep < COACH_TIPS.length - 1 ? 'Next →' : 'Got it!' }}
        </button>
        <button class="mini-close-x" aria-label="Dismiss tips" @click="dismissCoach">
          <CraftIcon name="close" :size="13" />
        </button>
      </div>
    </div>

    <!-- Local Co-Op Pass-and-Play Turn Handoff Banner -->
    <div
      v-if="gameStore.coopHandoffBanner && battle.status === 'ongoing'"
      class="coop-handoff-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Pass turn to next co-op player"
      @click.self="dismissCoopHandoff"
    >
      <section class="corrugated-slab coop-handoff-card">
        <div class="washi-tape"></div>
        <div
          class="coop-handoff-crest"
          :style="{ background: gameStore.coopHandoffBanner.color }"
        >
          {{ gameStore.coopHandoffBanner.badge }}
        </div>
        <span class="coop-handoff-kicker">🎮 LOCAL CO-OP HANDOFF</span>
        <h2>PASS TO {{ gameStore.coopHandoffBanner.name.toUpperCase() }}!</h2>
        <div class="coop-handoff-portraits">
          <span
            v-for="h in gameStore.coopHandoffBanner.heroes"
            :key="h.name"
            class="coop-portrait-chip"
            :style="{ borderColor: gameStore.coopHandoffBanner.color }"
          >
            <img :src="`/sprites/${h.species}.png`" :alt="h.name" />
            <strong>{{ h.name.split(' ')[0] }}</strong>
          </span>
        </div>
        <p class="coop-handoff-tip">
          💡 Team-Jump or Partner-Assist a teammate's hero for a <strong>+1 Co-Op Combo</strong>!
        </p>
        <div class="coop-handoff-actions">
          <button class="paper-btn primary coop-handoff-go" @click="dismissCoopHandoff">
            Ready! Take Turn → <kbd class="handoff-kbd">Enter</kbd>
          </button>
          <button
            class="paper-btn coop-handoff-free"
            @click="
              toggleCoopFreeOrder();
              dismissCoopHandoff();
            "
          >
            Switch to Free Order (No Prompts)
          </button>
        </div>
      </section>
    </div>

    <!-- What the Farmer Turn just did, in one place. Closes on a tap or when the player starts aiming. -->
    <transition name="hint-pop">
      <button
        v-if="gameStore.farmerRecap && battle.phase === 'player' && battle.status === 'ongoing' && !isCombatPreview"
        class="farmer-recap"
        @click="dismissFarmerRecap()"
      >
        <strong>Farmer Turn</strong>
        <span v-if="gameStore.farmerRecap.lines.length === 0">No hero was hurt.</span>
        <span v-for="line in gameStore.farmerRecap.lines" :key="line.name" :class="{ ko: line.ko }">
          {{ line.ko ? '✖' : '♥' }} {{ line.name }} {{ line.text }}
        </span>
        <span v-if="gameStore.farmerRecap.arrivals > 0" class="arrive">
          ＋ {{ gameStore.farmerRecap.arrivals }} new {{ gameStore.farmerRecap.arrivals === 1 ? 'farmer' : 'farmers' }} arrived
        </span>
        <small>{{ gameStore.isTouchMode ? 'Tap' : 'Click' }} to close</small>
      </button>
    </transition>

    <!-- Why a tap did nothing -->
    <transition name="hint-pop">
      <div v-if="boardHintText" :key="boardHintText" class="board-hint" role="status" aria-live="polite">
        {{ boardHintText }}
      </div>
    </transition>

    <!-- Tap-to-Inspect Toast -->
    <div v-if="inspectedNote" class="paper-card inspect-toast craft-fold" @click="inspectedNote = null">
      <strong>{{ inspectedNote.title }}</strong>
      <small>{{ inspectedNote.desc }}</small>
    </div>

    <!-- Compact Right-Side Combat Log & Zoom Strip (Desktop) -->
    <aside class="side-utility desktop-only">
      <div class="scale-strip kraft-ribbon">
        <button class="sc-btn" aria-label="Zoom out" title="Zoom out" @click="zoomBoard(-0.16)">−</button>
        <button
          class="sc-btn sc-pct"
          aria-label="Reset zoom & center"
          title="Reset camera (R)"
          @click="recenterBoard"
        >
          {{ zoomPercent }}%
        </button>
        <button class="sc-btn" aria-label="Zoom in" title="Zoom in" @click="zoomBoard(0.16)">+</button>
      </div>

      <div v-if="focusedCover && !activeForecast && !isMovePreview" class="paper-card inspector-ribbon">
        <div v-if="focusedCover.kind === 'pumpkin'" class="fc-emoji-badge" aria-hidden="true">🎃</div>
        <img v-else class="fc-sprite" :src="`/sprites/${focusedCover.kind}.png`" :alt="focusedCover.kind" />
        <div class="insp-copy">
          <div class="insp-top">
            <strong>
              {{
                focusedCover.isObjectiveCrate
                  ? 'Farmer Supply Crate'
                  : focusedCover.isObjectiveCage
                    ? 'Burlap Rescue Cage'
                    : focusedCover.kind === 'pumpkin'
                      ? 'Rolling Pumpkin'
                      : focusedCover.kind.toUpperCase()
              }}
            </strong>
            <span class="paper-pill mini-fam">{{ focusedCover.level }}</span>
          </div>
          <small v-if="focusedCover.isObjectiveCrate">
            Smash ({{ focusedCover.hp }}/{{ focusedCover.maxHp }} HP) to sabotage farmer supplies!
          </small>
          <small v-else-if="focusedCover.isObjectiveCage">
            Smash ({{ focusedCover.hp }}/{{ focusedCover.maxHp }} HP) to free a bagged ally!
          </small>
          <small v-else-if="focusedCover.kind === 'pumpkin'">
            Rolling Pumpkin ({{ focusedCover.hp }}/{{ focusedCover.maxHp }} HP) — Shoot to bowl 5 tiles for 4 DMG + knockback!
          </small>
          <small v-else-if="focusedCover.kind === 'beehive'">
            Explosive Beehive ({{ focusedCover.hp }}/{{ focusedCover.maxHp }}) — 3×3 Bees + Push!
          </small>
          <small v-else-if="focusedCover.kind === 'sprinkler'">
            Garden Sprinkler ({{ focusedCover.hp }}/{{ focusedCover.maxHp }}) — Cross Water Push!
          </small>
          <small v-else-if="focusedCover.destructible">
            Destructible ({{ focusedCover.hp }}/{{ focusedCover.maxHp }} HP)
          </small>
          <small v-else>Indestructible Full Cover — flank or lob over!</small>
        </div>
      </div>

      <button
        v-if="battle.combatLog.length > 0"
        class="paper-card desktop-log-pill"
        :class="{ expanded: logExpanded }"
        :title="logExpanded ? 'Collapse battle log' : 'Expand recent battle log'"
        @click="logExpanded = !logExpanded"
      >
        <div class="log-pill-head">
          <span class="log-latest">{{ latestLogLine }}</span>
          <span class="log-caret">{{ logExpanded ? '▴' : '▾' }}</span>
        </div>
        <div v-if="logExpanded && battle.combatLog.length > 1" class="log-history">
          <div
            v-for="(line, i) in battle.combatLog.slice(-5, -1).reverse()"
            :key="i"
            class="log-line"
          >
            {{ line }}
          </div>
        </div>
      </button>
    </aside>

    <!-- Field Notebook Menu Drawer -->
    <div v-if="showUtilityMenu" class="menu-backdrop" @click.self="showUtilityMenu = false">
      <section class="corrugated-slab utility-sheet scroll-soft">
        <div class="washi-tape"></div>
        <div class="sheet-head">
          <h3>Garden Field Notebook</h3>
          <button class="paper-btn tool-btn" aria-label="Close" @click="showUtilityMenu = false">
            <CraftIcon name="close" :size="16" />
          </button>
        </div>

        <p v-if="webglFallbackNotice" class="fallback-warn">
          WebGL wasn't available in this browser, so Classic 2D Paper-Craft mode is active.
        </p>

        <div class="quick-toggles">
          <button class="paper-btn gold" @click="switchRendererKind">
            <CraftIcon :name="is3D ? 'iso' : 'topdown'" :size="16" />
            <span>{{ is3D ? '3D Diorama (Active)' : 'Classic 2D (Switch to 3D)' }}</span>
          </button>
          <button v-if="is3D" class="paper-btn" @click="handleToggleTacticam">
            <CraftIcon name="topdown" :size="16" />
            <span>{{ cameraMode === 'tacticam' ? 'Exit Tacticam' : 'Tacticam View' }}</span>
          </button>
          <button v-else class="paper-btn" @click="switchBoardView">
            <CraftIcon :name="gameStore.viewMode === 'iso' ? 'topdown' : 'iso'" :size="16" />
            <span>{{ gameStore.viewMode === 'iso' ? 'Vertical 2D' : '2.5D Iso' }}</span>
          </button>
          <button class="paper-btn" @click="toggleAudioMute">
            <CraftIcon :name="gameStore.muted ? 'sound_off' : 'sound_on'" :size="16" />
            <span>{{ gameStore.muted ? 'SFX Off' : 'SFX On' }}</span>
          </button>
          <button class="paper-btn" @click="toggleMusicMute">
            <span>{{ gameStore.musicMuted ? '🔇 Music Off' : '🎵 Music On' }}</span>
          </button>
          <button
            class="paper-btn"
            :class="{ gold: gameStore.enemySpeedFast }"
            @click="toggleEnemySpeed"
          >
            <span>⚡ Enemy Speed: {{ gameStore.enemySpeedFast ? '2× Fast' : '1× Normal' }}</span>
          </button>
          <button
            class="paper-btn"
            :class="{ danger: gameStore.showAllDangerZone }"
            @click="toggleAllDangerZone"
          >
            <CraftIcon name="warning" :size="16" />
            <span>All Threats: {{ gameStore.showAllDangerZone ? 'ON' : 'OFF' }}</span>
          </button>
          <button class="paper-btn" @click="recenterBoard">
            <CraftIcon name="center" :size="16" />
            <span>Reset Camera</span>
          </button>
          <button
            class="paper-btn"
            @click="
              showUtilityMenu = false;
              showAlmanac = true;
            "
          >
            <span>📖 Field Almanac</span>
          </button>
          <button
            v-if="coopPlayers"
            class="paper-btn toggle-wide"
            :class="{ gold: battle.coopFreeOrder }"
            @click="toggleCoopFreeOrder"
          >
            <span>🎮 Co-Op Free Order: {{ battle.coopFreeOrder ? 'ON (Any Hero)' : 'OFF (Guided Turns)' }}</span>
          </button>
          <button
            class="paper-btn toggle-wide"
            :class="{ gold: gameStore.meta.guidedHintsEnabled ?? true }"
            @click="toggleGuidedHints"
          >
            <span>💡 Guided Tips: {{ (gameStore.meta.guidedHintsEnabled ?? true) ? 'ON' : 'OFF' }}</span>
          </button>
          <button
            class="paper-btn toggle-wide"
            :class="{ primary: gameStore.autoEndTurnEnabled }"
            @click="toggleAutoEndTurn"
          >
            <CraftIcon name="auto_end" :size="16" />
            <span>Auto End Turn: {{ gameStore.autoEndTurnEnabled ? 'ON' : 'OFF' }}</span>
          </button>
          <button class="paper-btn toggle-wide" @click="replayCoachTips">
            <CraftIcon name="book" :size="16" />
            <span>Replay Quick Tips</span>
          </button>
        </div>

        <div class="menu-section">
          <h4>3D Controls &amp; Board Toys</h4>
          <ul class="mini-rules">
            <li v-if="gameStore.isTouchMode"><strong>Camera:</strong> Drag the board to pan · Pinch to zoom.</li>
            <li v-else><strong>Camera:</strong> Right-drag (or <strong>Q / E</strong>) orbits 3D view · Left-drag pans · Scroll zooms · <strong>T</strong> toggles Tacticam · <strong>R</strong> resets.</li>
            <li><strong>Tactics:</strong> <strong>🍄 Mushrooms</strong> launch 3 tiles/+2 elev · <strong>🎃 Pumpkins</strong> bowl 5 tiles for 4 DMG · <strong>🪵 Bridges</strong> collapse when shot · Adjacent allies deal <strong>+1 Assist DMG</strong>!</li>
            <li><strong>Strong (+30%):</strong> Roots &gt; Sprayers · Vines &gt; Diggers · Fruits &gt; Blades.</li>
          </ul>
        </div>

        <div v-if="activeSquadBonds.length > 0" class="menu-section">
          <h4>Active Squad Bonds</h4>
          <div class="menu-relics">
            <div v-for="sb in activeSquadBonds" :key="sb.def.id" class="menu-relic-row">
              <strong>{{ sb.def.icon }} {{ bondChipLabel(sb) }}</strong>
              <small>{{ sb.effect }}</small>
            </div>
          </div>
        </div>

        <div v-if="battle.relicIds.length > 0" class="menu-section">
          <h4>Active Soil Relics</h4>
          <div class="menu-relics">
            <div v-for="rid in battle.relicIds" :key="rid" class="menu-relic-row">
              <strong>{{ RELIC_REGISTRY[rid]?.icon }} {{ RELIC_REGISTRY[rid]?.name }}</strong>
              <small>{{ RELIC_REGISTRY[rid]?.description }}</small>
            </div>
          </div>
        </div>

        <div class="menu-section">
          <h4>Status Effects</h4>
          <ul class="mini-rules">
            <li><strong>Burn (B):</strong> -2 HP at start of turn · <strong>Acid (A):</strong> +2 damage taken.</li>
            <li><strong>Rooted (R):</strong> Cannot move · <strong>Feared (!):</strong> -2 Move range.</li>
            <li><strong>Shield (S):</strong> -2 damage taken · <strong>Boosted (+):</strong> +2 Attack &amp; Dash.</li>
          </ul>
        </div>

        <div class="menu-section">
          <h4>Recent Battle Log</h4>
          <div class="menu-log">
            <div v-for="(line, i) in battle.combatLog.slice(-6)" :key="i">• {{ line }}</div>
          </div>
        </div>

        <button
          class="paper-btn"
          :disabled="gameStore.enemyTurnRunning"
          @click="returnToTitle"
        >
          ← Save &amp; Return to Title
        </button>
      </section>
    </div>

    <!-- Mario + Rabbids Bottom HUD Stage (Bottom-Left Squad Cards + Bottom-Center Command Deck!) -->
    <footer v-if="battle.status === 'ongoing'" ref="bottomHudRef" class="mr-bottom-hud">
      <!-- Auto-End Turn Grace Strip -->
      <div v-if="gameStore.autoEndPending" class="paper-card auto-end-banner">
        <div class="auto-top-row">
          <div class="auto-copy">
            <CraftIcon name="auto_end" :size="15" />
            <span>All heroes acted — Farmer Phase...</span>
          </div>
          <div class="auto-btns">
            <button
              v-if="battle.undoSnapshot"
              class="paper-btn gold mini-act"
              @click="triggerUndoMove"
            >
              <CraftIcon name="undo" :size="14" />
              <span>Undo</span>
            </button>
            <button class="paper-btn mini-act" @click="clearAutoEndTimer">Stay</button>
          </div>
        </div>
        <div class="auto-bar-track">
          <div
            class="auto-bar-fill"
            :style="{ animationDuration: `${AUTO_END_GRACE_MS}ms` }"
          ></div>
        </div>
      </div>

      <!-- End Turn question: stays until answered -->
      <div v-if="endConfirmPending && !gameStore.autoEndPending" class="paper-card auto-end-banner end-confirm-banner" role="alertdialog" aria-label="End the turn?">
        <div class="auto-top-row">
          <div class="auto-copy">
            <CraftIcon name="end_turn" :size="15" />
            <span>
              End the turn? {{ readyHeroesCount }} hero{{ readyHeroesCount === 1 ? ' has' : 'es have' }} not attacked yet.
            </span>
          </div>
          <div class="auto-btns">
            <button class="paper-btn mini-act" @click="clearEndConfirm">Keep playing</button>
            <button class="paper-btn danger mini-act" @click="requestEndTurn">End Turn</button>
          </div>
        </div>
      </div>

      <div class="mr-hud-row" :class="{ 'is-prep': battle.prepPhase }">
        <!-- Bottom-Left Squad Portrait Cards (Active Battle only — Prep has its own unified Deploy & Swap Bar) -->
        <div v-if="!battle.prepPhase" class="mr-squad-rail">
          <button
            v-for="(u, idx) in playerUnits"
            :key="u.id"
            class="mr-hero-card"
            :class="{
              selected: u.id === gameStore.selectedUnitId,
              done: u.alive && isHeroDone(u.id),
              'low-hp': isLowHpUnit(u),
              ko: !u.alive,
            }"
            :disabled="!u.alive"
            :aria-label="`Select ${u.name}`"
            @click="selectSquadCard(u.id)"
          >
            <span class="mr-hotkey desktop-only">{{ idx + 1 }}</span>
            <span
              v-if="unitCoopBadge(u)"
              class="mr-coop-chip"
              :style="{ background: unitCoopBadge(u)!.color }"
              :title="unitCoopBadge(u)!.name"
            >
              {{ unitCoopBadge(u)!.badge }}
            </span>
            <div class="mr-portrait-box">
              <img class="mr-portrait-img" :src="unitPortraitSrc(u)" :alt="u.name" />
              <span v-if="u.alive && (u.level ?? 1) > 1" class="mr-lvl-chip">L{{ u.level }}</span>
              <span v-if="u.alive && u.statuses.some((s) => s.kind === 'overwatch')" class="mr-watch-seal" title="On Watch">
                👁
              </span>
              <span v-else-if="u.alive && isHeroDone(u.id)" class="mr-done-seal">
                <CraftIcon name="check" :size="11" />
              </span>
            </div>
            <div class="mr-hero-meta">
              <div class="mr-hero-name-row">
                <strong>{{ u.name.split(' ')[0] }}</strong>
              </div>
              <div class="mr-hp-inline">
                <div class="mr-hp-bar">
                  <div
                    class="mr-hp-fill"
                    :style="{
                      width: `${Math.max(0, Math.min(100, (u.hp / Math.max(1, u.maxHp)) * 100))}%`,
                      backgroundColor: hpColor(u.hp, u.maxHp),
                    }"
                  ></div>
                </div>
                <span class="mr-hp-txt">{{ u.hp }}/{{ u.maxHp }}</span>
              </div>
              <!-- Mario + Rabbids 3 Action Pips: Move / Weapon / Technique -->
              <div class="mr-action-pips" title="Move · Weapon · Technique">
                <span
                  class="mr-pip move"
                  :class="{
                    spent: !u.alive || u.actions.hasMoved,
                    partial: u.alive && !u.actions.hasMoved && (u.actions.moveSpent ?? 0) > 0,
                  }"
                ></span>
                <span
                  class="mr-pip atk"
                  :class="{ spent: !u.alive || u.actions.hasAttacked }"
                ></span>
                <span
                  class="mr-pip skl"
                  :class="{ spent: !u.alive || u.actions.hasUsedSkill || u.abilityCooldown > 0 }"
                ></span>
              </div>
            </div>
          </button>
        </div>

        <!-- Bottom-Center Mario + Rabbids Command Deck -->
        <div class="mr-command-wrap" :class="{ 'prep-wide': battle.prepPhase }">
          <!-- Garden Satchel Popover -->
          <div
            v-if="showItemsMenu && selectedUnit && !selectedUnit.actions.hasUsedSkill"
            class="corrugated-slab bag-popover scroll-soft"
          >
            <div class="bag-head-row">
              <span class="bag-note">Garden Satchel · uses Technique slot</span>
              <button
                class="bag-close-btn"
                aria-label="Close satchel"
                @click="showItemsMenu = false"
              >
                <CraftIcon name="close" :size="13" />
              </button>
            </div>
            <button
              v-for="(count, iid) in battle.items"
              :key="iid"
              class="seed-packet bag-opt"
              :disabled="count <= 0"
              @click="pickItem(iid)"
            >
              <div class="bag-opt-head">
                <strong>{{ ITEM_REGISTRY[iid]?.icon }} {{ ITEM_REGISTRY[iid]?.name }}</strong>
                <span class="paper-pill">×{{ count }}</span>
              </div>
              <small>{{ ITEM_REGISTRY[iid]?.description }}</small>
            </button>
          </div>

          <!-- Pre-Battle Unified Tactical Deployment & Explicit Swap Deck -->
          <div v-if="battle.prepPhase" class="corrugated-slab mr-deck deck-prep">
            <div class="prep-top-bar">
              <div class="prep-top-left">
                <strong>⚔️ DEPLOY SQUAD</strong>
                <span class="prep-arena-pill">
                  {{ battle.width }}×{{ battle.height }} · Elev 0–{{ battleMaxElevation }}
                </span>
                <button
                  v-if="squadBonds.length > 0"
                  class="prep-bonds-toggle"
                  :class="{ active: showPrepBonds }"
                  @click="showPrepBonds = !showPrepBonds"
                >
                  ✨ {{ activeSquadBonds.length }} Bond{{ activeSquadBonds.length === 1 ? '' : 's' }} {{ showPrepBonds ? '▴' : '▾' }}
                </button>
              </div>
              <div class="prep-top-actions">
                <button
                  v-if="gameStore.run"
                  class="paper-btn gold prep-armory-btn"
                  title="Swap Alternate Weapons, Bench Heroes & spend Skill Points before battle"
                  @click="showPrepArmory = true"
                >
                  <span>⚔️ Armory{{ prepBenchHeroes.length > 0 ? ` · ${prepBenchHeroes.length} Bench` : '' }}</span>
                </button>
                <button
                  class="paper-btn primary prep-go-btn"
                  title="Lock formation and start Turn 1 (Enter)"
                  @click="confirmPrepPhase"
                >
                  <span>Start Battle →</span>
                </button>
              </div>
            </div>

            <!-- Collapsible Squad Bonds Drawer inside Prep (keeps default view clean!) -->
            <div v-if="showPrepBonds && squadBonds.length > 0" class="prep-bench-row prep-bond-row">
              <button
                v-for="sb in squadBonds"
                :key="sb.def.id"
                class="bond-chip"
                :class="{ on: sb.tier > 0, two: sb.tier > 1 }"
                @click="inspectBond(sb)"
              >
                <span>{{ sb.def.icon }}</span>
                <span>{{ bondChipLabel(sb) }}</span>
              </button>
            </div>

            <!-- Clear Always-Visible Contextual Guidance -->
            <div class="prep-guide-line" role="status">
              <span v-if="prepSwapNotice" class="prep-swap-ok">✓ {{ prepSwapNotice }}</span>
              <span v-else-if="selectedUnit">
                <strong>{{ selectedUnit.name.split(' ')[0] }}</strong> selected · Tap a glowing green tile to move{{ prepBenchHeroes.length > 0 ? ', or tap Bench below to swap ⇄' : '' }}
              </span>
              <span v-else>
                Tap a hero on the field to reposition or swap with the bench ⇄
              </span>
            </div>

            <!-- Explicit 4-Slot On-Field Squad Strip -->
            <div class="prep-slots-grid" aria-label="Deployed Squad">
              <button
                v-for="u in playerUnits"
                :key="u.id"
                class="prep-slot-btn"
                :class="{ selected: u.id === gameStore.selectedUnitId }"
                @click="selectSquadCard(u.id)"
              >
                <img :src="unitPortraitSrc(u)" :alt="u.name" />
                <div class="prep-slot-copy">
                  <strong>{{ u.name.split(' ')[0] }}</strong>
                  <small>{{ u.hp }}/{{ u.maxHp }} HP</small>
                </div>
                <span v-if="u.id === gameStore.selectedUnitId" class="prep-slot-tag">SWAP</span>
              </button>
            </div>

            <!-- Explicit Bench Swap Row naming who is being replaced -->
            <div v-if="prepBenchHeroes.length > 0" class="prep-bench-row">
              <span class="prep-bench-label">
                ⇄ Swap {{ selectedUnit ? selectedUnit.name.split(' ')[0] : 'Hero' }}:
              </span>
              <button
                v-for="bh in prepBenchHeroes"
                :key="bh.uid"
                class="prep-bench-chip"
                :title="`Replace ${selectedUnit?.name ?? 'selected hero'} with ${bh.name} (Lv.${bh.level})`"
                @click="handlePrepBenchSwap(bh)"
              >
                <span class="bench-swap-glyph" aria-hidden="true">⇄</span>
                <img :src="`/sprites/${bh.species}.png`" :alt="bh.name" />
                <div class="bench-chip-copy">
                  <strong>{{ bh.name.split(' ')[0] }}</strong>
                  <small>L{{ bh.level }} · {{ bh.hp }}HP</small>
                </div>
              </button>
            </div>
          </div>

          <!-- Clean End Turn float when no hero/enemy is focused -->
          <div v-else-if="!showBottomConsoleDeck" class="mr-end-only">
            <button
              class="paper-btn mr-skew-btn"
              :class="{ primary: readyHeroesCount === 0, danger: endConfirmPending }"
              :disabled="battle.phase !== 'player' || gameStore.enemyTurnRunning"
              @click="requestEndTurn"
            >
              <CraftIcon name="end_turn" :size="16" />
              <span>{{ endConfirmPending ? 'Confirm End?' : readyHeroesCount === 0 ? 'End Turn!' : 'End Turn' }}</span>
            </button>
          </div>

          <!-- Morphing Corrugated Mario + Rabbids Action Deck -->
          <div
            v-else
            class="corrugated-slab mr-deck"
            :class="{
              'deck-threat': Boolean(inspectedEnemy && !isCombatPreview && !isMovePreview && !isSkillOrItemMode),
              'deck-skill': isSkillOrItemMode,
              'deck-aim': gameStore.mode === 'attack',
            }"
          >
            <!-- STATE 1: Mario + Rabbids Aim Cam & Combat Confirm Deck (with ◀/▶ Target Cycling & FIRE!) -->
            <template v-if="isCombatPreview && selectedUnit">
              <div class="morph-head">
                <div class="mh-left">
                  <img
                    v-if="focusedUnit"
                    class="mh-sprite"
                    :src="unitPortraitSrc(focusedUnit)"
                    :alt="focusedUnit.name"
                  />
                  <div
                    v-else-if="activeForecast?.isBridgeTarget"
                    class="mh-emoji-badge"
                    aria-hidden="true"
                  >
                    🪵
                  </div>
                  <div
                    v-else-if="focusedCover && focusedCover.kind === 'pumpkin'"
                    class="mh-emoji-badge"
                    aria-hidden="true"
                  >
                    🎃
                  </div>
                  <img
                    v-else-if="focusedCover"
                    class="mh-sprite"
                    :src="`/sprites/${focusedCover.kind}.png`"
                    :alt="focusedCover.kind"
                  />
                  <div class="mh-copy">
                    <div class="mh-title-row">
                      <strong>
                        {{
                          focusedUnit
                            ? focusedUnit.name
                            : activeForecast?.isBridgeTarget
                              ? 'WOODEN BRIDGE'
                              : focusedCover?.kind === 'pumpkin'
                                ? 'ROLLING PUMPKIN'
                                : focusedCover?.kind.toUpperCase()
                        }}
                      </strong>
                      <span v-if="activeForecast?.partnerAssistDamage" class="deck-bonus-tag assist">
                        ★ +{{ activeForecast.partnerAssistDamage }} ASSIST
                      </span>
                      <span v-if="activeForecast?.isPumpkinTarget" class="deck-bonus-tag pumpkin">
                        🎃 BOWL 4 DMG
                      </span>
                      <span v-if="activeForecast?.isBridgeTarget" class="deck-bonus-tag bridge">
                        🪵 COLLAPSE
                      </span>
                      <span v-if="activeForecast?.highGroundBonus" class="deck-bonus-tag high">
                        ▲ HIGH +{{ activeForecast.highGroundBonus }}
                      </span>
                      <span v-if="activeForecast?.isCriticalFlank" class="deck-bonus-tag crit">
                        ★ CRIT
                      </span>
                      <span
                        v-if="activeForecast?.knockbackHazard"
                        class="deck-bonus-tag"
                        :class="activeForecast.knockbackHazard"
                      >
                        {{ hazardTagLabel(activeForecast.knockbackHazard) }}
                      </span>
                    </div>
                    <small v-if="focusedUnit">
                      HP {{ focusedUnit.hp }}/{{ focusedUnit.maxHp }} · {{ getFamilyLabel(focusedUnit.family) }}
                      <template v-if="gameStore.mode === 'attack' && aimTargets.length > 1 && activeAimTargetIndex >= 0">
                        · Target {{ activeAimTargetIndex + 1 }}/{{ aimTargets.length }}
                      </template>
                    </small>
                    <small v-else-if="activeForecast?.isBridgeTarget && focusedTile">
                      Bridge {{ focusedTile.bridgeHp ?? 0 }}/{{ focusedTile.bridgeMaxHp ?? 4 }} HP — Collapse to plunge foes!
                    </small>
                    <small v-else-if="focusedCover && focusedCover.kind === 'pumpkin'">
                      Rolling Pumpkin ({{ focusedCover.hp }}/{{ focusedCover.maxHp }} HP) — Bowls 5 tiles for 4 DMG!
                    </small>
                    <small v-else-if="focusedCover">
                      {{ focusedCover.hp }}/{{ focusedCover.maxHp }} Cover HP
                    </small>
                  </div>
                </div>
                <div class="mh-stats">
                  <span
                    v-if="activeForecast"
                    class="hit-stamp"
                    :class="{
                      full: activeForecast.hitChance >= 100,
                      half: activeForecast.hitChance > 0 && activeForecast.hitChance < 100,
                      zero: activeForecast.hitChance === 0,
                    }"
                  >
                    {{ activeForecast.hitChance }}%
                  </span>
                  <span v-if="activeForecast?.isLethal" class="ko-tag">KO!</span>
                  <button
                    v-if="focusedUnit && focusedUnit.team === 'enemy'"
                    class="mini-zone-btn"
                    :class="{ active: gameStore.inspectedEnemyId === focusedUnit.id }"
                    title="Peek enemy Danger Zone"
                    @click="toggleInspectEnemy(focusedUnit.id)"
                  >
                    <CraftIcon name="warning" :size="13" />
                  </button>
                </div>
              </div>
              <div class="confirm-strip">
                <button
                  v-if="gameStore.mode === 'attack' && aimTargets.length > 1"
                  class="paper-btn aim-cycle-btn"
                  title="Previous Target (A / ◀)"
                  aria-label="Previous target"
                  @click="cycleAimTarget(-1)"
                >
                  ◀
                </button>
                <button
                  v-for="opt in previewOptions"
                  :key="opt.kind"
                  class="paper-btn confirm-btn"
                  :class="[opt.tone, { 'fire-cta': opt.kind === 'attack' }]"
                  @click="executePreviewOption(opt.kind)"
                >
                  <CraftIcon :name="optionIcon(opt.kind)" :size="16" />
                  <span>
                    {{ opt.kind === 'attack' && focusedUnit ? `FIRE! ${opt.label.replace(/^Attack /, '')}` : opt.label }}
                  </span>
                </button>
                <button
                  v-if="gameStore.mode === 'attack' && aimTargets.length > 1"
                  class="paper-btn aim-cycle-btn"
                  title="Next Target (D / ▶)"
                  aria-label="Next target"
                  @click="cycleAimTarget(1)"
                >
                  ▶
                </button>
                <button class="paper-btn cancel-btn" aria-label="Cancel" @click="cancelPreviewAction">
                  <CraftIcon name="close" :size="16" />
                </button>
              </div>
            </template>

            <!-- STATE 2: Move / Team-Jump Destination Confirm -->
            <template v-else-if="isMovePreview && moveDestinationSummary && selectedUnit">
              <div class="morph-head">
                <div class="mh-copy">
                  <strong>{{ moveDestinationSummary.isJump ? '★ Team-Jump Landing' : 'Move Destination' }}</strong>
                  <small>{{ moveDestinationSummary.terrainNote ?? 'Tap again or press Confirm' }}</small>
                </div>
                <div class="mh-stats">
                  <span class="dest-pill" :class="moveDestinationSummary.bestCover">
                    <CraftIcon
                      v-if="moveDestinationSummary.bestCover !== 'none'"
                      :name="moveDestinationSummary.bestCover === 'full' ? 'shield_full' : 'shield_half'"
                      :size="12"
                    />
                    <span>
                      {{
                        moveDestinationSummary.bestCover === 'full'
                          ? 'Full Cover'
                          : moveDestinationSummary.bestCover === 'half'
                            ? 'Half Cover'
                            : 'Exposed'
                      }}
                    </span>
                  </span>
                  <span
                    v-if="!selectedUnit.actions.hasAttacked"
                    class="dest-pill"
                    :class="moveDestinationSummary.projectedFoes > 0 ? 'foes-hot' : 'foes-none'"
                  >
                    {{ moveDestinationSummary.projectedFoes }} in range
                  </span>
                </div>
              </div>
              <div class="confirm-strip">
                <button
                  v-for="opt in previewOptions"
                  :key="opt.kind"
                  class="paper-btn confirm-btn"
                  :class="opt.tone"
                  @click="executePreviewOption(opt.kind)"
                >
                  <CraftIcon :name="optionIcon(opt.kind)" :size="16" />
                  <span>{{ opt.label }}</span>
                </button>
                <button class="paper-btn cancel-btn" aria-label="Cancel" @click="cancelPreviewAction">
                  <CraftIcon name="close" :size="16" />
                </button>
              </div>
            </template>

            <!-- STATE 3: Technique / Satchel Item Target Mode -->
            <template v-else-if="isSkillOrItemMode && selectedUnit">
              <div class="morph-head">
                <div v-if="activeAbilityBanner" class="mh-copy">
                  <div class="mh-title-row">
                    <strong>★ {{ activeAbilityBanner.name }}</strong>
                    <span class="paper-pill mini-fam">
                      {{ activeAbilityBanner.targetHint }} · ready again after {{ activeAbilityBanner.cooldown }} turns
                    </span>
                  </div>
                  <small>{{ activeAbilityBanner.desc }}</small>
                </div>
                <div v-else-if="activeItemBanner" class="mh-copy">
                  <strong>{{ activeItemBanner.icon }} {{ activeItemBanner.name }}</strong>
                  <small>{{ activeItemBanner.desc }}</small>
                </div>
              </div>
              <div class="confirm-strip">
                <template v-if="previewOptions.length > 0">
                  <button
                    v-for="opt in previewOptions"
                    :key="opt.kind"
                    class="paper-btn confirm-btn"
                    :class="opt.tone"
                    @click="executePreviewOption(opt.kind)"
                  >
                    <CraftIcon :name="optionIcon(opt.kind)" :size="16" />
                    <span>{{ opt.label }}</span>
                  </button>
                </template>
                <div v-else class="target-prompt-pill">{{ skillTargetPrompt }}</div>
                <button class="paper-btn cancel-btn-wide" @click="setInteractionMode('move')">
                  <CraftIcon name="close" :size="15" />
                  <span>Cancel</span>
                </button>
              </div>
            </template>

            <!-- STATE 4: Out-of-Range Enemy Threat Zone Inspector -->
            <template v-else-if="inspectedEnemy">
              <div class="morph-head">
                <div class="mh-left">
                  <img
                    class="mh-sprite"
                    :src="unitPortraitSrc(inspectedEnemy)"
                    :alt="inspectedEnemy.name"
                  />
                  <div class="mh-copy">
                    <div class="mh-title-row">
                      <strong>{{ inspectedEnemy.name }}</strong>
                      <span
                        v-if="inspectedEnemyMatchup !== 'neutral'"
                        class="match-stamp"
                        :class="inspectedEnemyMatchup"
                      >
                        {{ inspectedEnemyMatchup === 'advantage' ? `▲ Your type ${advantagePctLabel}` : '▼ Your type -20%' }}
                      </span>
                      <span v-else class="paper-pill mini-fam">{{ getFamilyLabel(inspectedEnemy.family) }}</span>
                    </div>
                    <small>
                      HP {{ inspectedEnemy.hp }}/{{ inspectedEnemy.maxHp }} · Mv {{ inspectedEnemy.moveRange }} ·
                      Rng {{ inspectedEnemy.weapon.maxRange }} ({{ inspectedEnemy.weapon.damage }} dmg)
                    </small>
                  </div>
                </div>
              </div>
              <div class="confirm-strip">
                <div class="threat-pill-bar">
                  <CraftIcon name="warning" :size="14" />
                  <span>Showing Enemy Danger Zone</span>
                </div>
                <button class="paper-btn cancel-btn-wide" @click="cancelPreviewAction">
                  <CraftIcon name="close" :size="15" />
                  <span>Hide</span>
                </button>
              </div>
            </template>

            <!-- STATE 5: Mario + Rabbids Hero Command Deck -->
            <template v-else-if="selectedUnit">
              <div class="mr-deck-header">
                <button class="hero-id-btn" title="Tap for hero stats, traits & weapon details" @click="inspectSelectedHeroSummary">
                  <strong>{{ selectedUnit.name.split(' ')[0] }}</strong>
                  <span class="lvl-tag">L{{ selectedUnit.level ?? 1 }}</span>
                  <span class="family-tag desktop-only">{{ getFamilyLabel(selectedUnit.family) }}</span>
                  <span class="weapon-mini desktop-only">
                    {{ selectedUnit.weapon.name }} · {{ selectedUnit.weapon.damage }} DMG · R{{ selectedUnit.weapon.minRange }}-{{ selectedUnit.weapon.maxRange }}
                  </span>
                </button>

                <div class="slot-pills">
                  <button
                    v-for="(badge, bIdx) in selectedStanceBadges"
                    :key="badge.id"
                    class="stance-chip"
                    :class="[badge.tone, { 'desktop-only': bIdx > 0 }]"
                    :title="badge.desc"
                    @click.stop="inspectedNote = { title: badge.label, desc: badge.desc }"
                  >
                    {{ badge.label }}
                  </button>
                  <button
                    v-if="battle.undoSnapshot && battle.phase === 'player' && !gameStore.enemyTurnRunning"
                    class="undo-thumb-chip desktop-only"
                    title="Undo Move (Z)"
                    @click="triggerUndoMove"
                  >
                    <CraftIcon name="undo" :size="11" />
                    <span>Undo</span>
                  </button>
                  <button
                    v-for="(st, stIdx) in selectedUnit.statuses.slice(0, 2)"
                    :key="st.kind"
                    class="status-chip"
                    :class="[st.kind, { 'desktop-only': stIdx > 0 || selectedStanceBadges.length > 0 }]"
                    @click.stop="inspectStatus(st.kind, st.turns)"
                  >
                    {{ STATUS_META[st.kind]?.short }} {{ st.turns }}T
                  </button>
                  <button
                    v-if="selectedUnit.coopPassive"
                    class="coop-pin desktop-only"
                    title="Barnyard Co-op Trait"
                    @click="inspectCoop(selectedUnit.name, selectedUnit.coopPassive)"
                  >
                    ★ Co-op
                  </button>
                  <button
                    v-for="gid in selectedUnit.graftIds"
                    :key="gid"
                    class="graft-pin desktop-only"
                    @click="inspectGraft(gid)"
                  >
                    {{ GRAFT_REGISTRY[gid]?.badgeIcon }}
                  </button>
                  <button
                    class="paper-btn deck-end-pill"
                    :class="{
                      primary: readyHeroesCount === 0 && !endConfirmPending,
                      danger: endConfirmPending,
                    }"
                    :disabled="battle.phase !== 'player' || gameStore.enemyTurnRunning || battle.status !== 'ongoing'"
                    title="End Player Turn"
                    @click="requestEndTurn"
                  >
                    <CraftIcon name="end_turn" :size="13" />
                    <span>
                      {{
                        endConfirmPending
                          ? 'End?'
                          : readyHeroesCount === 0
                            ? 'End Turn!'
                            : `End (${readyHeroesCount})`
                      }}
                    </span>
                  </button>
                </div>
              </div>

              <!-- 5 Roomy Hero Action Buttons (≥48px touch targets on mobile): Move / Weapon / Watch / Skill / Bag -->
              <div class="mr-action-bar">
                <button
                  class="paper-btn sky mr-act-btn"
                  :class="{ 'is-active': gameStore.mode === 'move' && !selectedUnit.actions.hasMoved }"
                  :disabled="selectedUnit.actions.hasMoved && dashHintCount === 0 && jumpHintCount === 0"
                  title="Move, Dash enemies, or Team-Jump allies (M)"
                  @click="setInteractionMode('move')"
                >
                  <span class="act-keycap desktop-only">M</span>
                  <CraftIcon name="move" :size="15" />
                  <div class="act-copy">
                    <span class="act-title">{{
                      selectedUnit.actions.hasMoved
                        ? 'Moved'
                        : (selectedUnit.actions.moveSpent ?? 0) > 0
                          ? `Move ${selectedMoveLeft}`
                          : 'Move'
                    }}</span>
                    <small v-if="dashHintCount > 0 || jumpHintCount > 0" class="act-sub">
                      {{ dashHintCount > 0 ? (remainingDashesForSelected > 1 ? `⚡Dash×${remainingDashesForSelected}` : '⚡Dash') : '' }}
                      {{ jumpHintCount > 0 ? '★Jump' : '' }}
                    </small>
                  </div>
                </button>

                <button
                  class="paper-btn danger mr-act-btn"
                  :class="{
                    'is-active': gameStore.mode === 'attack',
                    'pulse-ready': enemiesInAttackRange > 0 && !selectedUnit.actions.hasAttacked,
                  }"
                  :disabled="selectedUnit.actions.hasAttacked || battle.phase !== 'player' || gameStore.enemyTurnRunning"
                  :title="`${selectedUnit.weapon.name} (${selectedUnit.weapon.damage} dmg) — Aim Cam (F)`"
                  @click="toggleMode('attack')"
                >
                  <span class="act-keycap desktop-only">F</span>
                  <span v-if="enemiesInAttackRange > 0" class="tab-badge">{{ enemiesInAttackRange }}</span>
                  <CraftIcon name="attack" :size="15" />
                  <div class="act-copy">
                    <span class="act-title">{{ gameStore.mode === 'attack' ? 'Aiming' : 'Weapon' }}</span>
                    <small class="act-sub">{{ selectedUnit.weapon.damage }} DMG</small>
                  </div>
                </button>

                <button
                  class="paper-btn watch-btn mr-act-btn"
                  :class="{
                    'is-active': selectedUnit.statuses.some((s) => s.kind === 'overwatch'),
                  }"
                  :disabled="selectedUnit.actions.hasAttacked || battle.phase !== 'player' || gameStore.enemyTurnRunning"
                  :title="`Watch (O): uses your attack to fire ${overwatchChargesForSelected} reaction shot(s) at farmers who move into range`"
                  @mouseenter="setPreviewOverwatch(true)"
                  @mouseleave="setPreviewOverwatch(false)"
                  @focus="setPreviewOverwatch(true)"
                  @blur="setPreviewOverwatch(false)"
                  @click="handleTriggerOverwatch"
                >
                  <span class="act-keycap desktop-only">O</span>
                  <span class="watch-glyph">👁</span>
                  <div class="act-copy">
                    <span class="act-title">Watch</span>
                    <small class="act-sub">×{{ overwatchChargesForSelected }}</small>
                  </div>
                </button>

                <button
                  class="paper-btn plum mr-act-btn"
                  :class="{ 'is-active': gameStore.mode === 'ability' }"
                  :disabled="
                    !selectedUnit.ability ||
                    selectedUnit.actions.hasUsedSkill ||
                    selectedUnit.abilityCooldown > 0 ||
                    battle.phase !== 'player' ||
                    gameStore.enemyTurnRunning
                  "
                  :title="selectedUnit.ability ? `${selectedUnit.ability.name} (S): ${selectedUnit.ability.description}` : 'No skill'"
                  @click="toggleMode('ability')"
                >
                  <span class="act-keycap desktop-only">S</span>
                  <CraftIcon name="skill" :size="15" />
                  <div class="act-copy">
                    <span class="act-title">
                      {{ selectedUnit.abilityCooldown > 0 ? `CD ${selectedUnit.abilityCooldown}` : 'Skill' }}
                    </span>
                    <small v-if="selectedUnit.ability && selectedUnit.abilityCooldown === 0" class="act-sub desktop-only">
                      {{ selectedUnit.ability.name }}
                    </small>
                  </div>
                </button>

                <button
                  class="paper-btn gold mr-act-btn"
                  :class="{ 'is-active': showItemsMenu }"
                  :disabled="
                    selectedUnit.actions.hasUsedSkill ||
                    totalItemsLeft === 0 ||
                    battle.phase !== 'player' ||
                    gameStore.enemyTurnRunning
                  "
                  title="Garden Satchel (B) — shares Skill slot"
                  @click="showItemsMenu = !showItemsMenu"
                >
                  <span class="act-keycap desktop-only">B</span>
                  <CraftIcon name="bag" :size="15" />
                  <div class="act-copy">
                    <span class="act-title">Bag</span>
                    <small class="act-sub">×{{ totalItemsLeft }}</small>
                  </div>
                </button>
              </div>
            </template>
          </div>
        </div>
      </div>
    </footer>

    <!-- Battle Victory / Defeat Modal -->
    <div
      v-if="battle.status !== 'ongoing'"
      class="outcome-backdrop"
      :class="{ 'victory-clear': battle.status === 'victory' }"
    >
      <div class="corrugated-slab outcome-modal">
        <div class="washi-tape"></div>
        <div class="out-ribbon" :class="{ defeat: battle.status !== 'victory' }">
          <CraftIcon :name="battle.status === 'victory' ? 'trophy' : 'bag'" :size="18" />
          <span>{{ battle.status === 'victory' ? 'PATCH VICTORY!' : 'SQUAD HARVESTED!' }}</span>
        </div>
        <p v-if="battle.status === 'victory'">
          The farmers ran for the hills! Claim your Graft stickers, Seeds, and spoils before heading
          down the trail.
        </p>
        <p v-else-if="battle.objective === 'escort' && escortCart && !escortCart.alive">
          The Golden Seed Cart was smashed before reaching the Exit Gate — your Seeds still carry
          back to the Seed Shed!
        </p>
        <p v-else>
          All active produce heroes were bagged — your Seeds still carry back to the Seed Shed!
        </p>

        <div class="outcome-stats">
          <span v-if="victoryGrade" class="paper-pill grade-pill" :class="victoryGrade.grade">
            {{ GRADE_LABELS[victoryGrade.grade] }}
          </span>
          <span class="paper-pill">
            Turns: {{ victoryGrade ? victoryGrade.turns : battle.turn
            }}<template v-if="battle.parTurns && battle.status === 'victory'"> / goal {{ battle.parTurns }}</template>
          </span>
          <span class="paper-pill">
            Survivors: {{ battle.units.filter((u) => u.team === 'player' && u.alive && !u.isEscortCart).length }}
          </span>
          <span
            v-if="battle.rescuedHeroUids.length + battle.rescuedNewBlueprintIds.length > 0"
            class="paper-pill gold-pill"
          >
            Ally Rescued!
          </span>
        </div>

        <button class="paper-btn primary big-go" @click="finalizeBattleAndProceed">
          {{ battle.status === 'victory' ? 'Claim Harvest Spoils →' : 'View Run Summary →' }}
        </button>
      </div>
    </div>

    <!-- Storybook Field Almanac -->
    <AlmanacModal v-if="showAlmanac" @close="showAlmanac = false" />

    <!-- Pre-Battle Prep Armory & Skill Perks Modal -->
    <HeroBuildModal
      v-if="showPrepArmory && gameStore.run"
      :initial-hero-uid="selectedUnit?.rosterUid ?? null"
      @close="showPrepArmory = false"
    />
  </div>
</template>

<style scoped>
.battle-shell {
  width: 100%;
  height: 100dvh;
  position: relative;
  overflow: hidden;
}

.battle-canvas {
  width: 100%;
  height: 100%;
  display: block;
  touch-action: none;
}

.battle-overlay-canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  z-index: 4;
}

/* ===== Full-Width Mario + Rabbids Slanted Phase Banner ===== */
.phase-splash-wrap {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
  z-index: 35;
}

.phase-splash-ribbon {
  width: 100%;
  max-width: 680px;
  padding: 14px 28px;
  text-align: center;
  transform: skewX(-9deg);
  border: 3px solid var(--ink);
  border-radius: 14px;
  box-shadow:
    inset 0 2px 0 rgba(255, 255, 240, 0.55),
    0 6px 0 var(--ink),
    0 18px 32px rgba(24, 10, 2, 0.42);
}

.phase-splash-ribbon.player {
  background: linear-gradient(135deg, #569e36 0%, #3d7d23 100%);
  color: #fffdf5;
}

.phase-splash-ribbon.enemy {
  background: linear-gradient(135deg, #d14d38 0%, #9e2d1d 100%);
  color: #fffdf5;
}

.phase-splash-ribbon.victory {
  background: linear-gradient(135deg, #f5ce47 0%, #d8961e 100%);
  color: #3f220c;
}

.phase-splash-ribbon.defeat {
  background: linear-gradient(135deg, #6d3b2b 0%, #422016 100%);
  color: #ffdfd9;
}

.phase-splash-text {
  display: inline-block;
  transform: skewX(9deg);
  font-family: 'Fredoka', sans-serif;
  font-size: clamp(1.3rem, 3.2vw, 2rem);
  font-weight: 700;
  letter-spacing: 0.06em;
  text-shadow: 0 2px 0 rgba(35, 16, 4, 0.45);
}

.banner-sweep-enter-active,
.banner-sweep-leave-active {
  transition: opacity 0.22s ease, transform 0.24s cubic-bezier(0.22, 1, 0.36, 1);
}

.banner-sweep-enter-from {
  opacity: 0;
  transform: translateX(-48px) scale(0.95);
}

.banner-sweep-leave-to {
  opacity: 0;
  transform: translateX(48px) scale(0.95);
}

/* ===== Floating World-Space Mario + Rabbids Target Forecast Pill ===== */
.world-forecast-pill {
  position: fixed;
  top: 0;
  left: 0;
  z-index: 22;
  pointer-events: none;
  will-change: transform;
}

.world-forecast-pill.interactive {
  pointer-events: auto;
  z-index: 26;
}

.wf-card {
  min-width: 230px;
  max-width: 296px;
  padding: 8px 11px;
  background:
    linear-gradient(180deg, rgba(255, 253, 246, 0.97) 0%, rgba(245, 234, 210, 0.97) 100%);
  border: 2.5px solid var(--ink);
  border-radius: 13px;
  transform: skewX(-4deg);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.92),
    0 4px 0 var(--ink),
    0 12px 24px rgba(28, 12, 4, 0.36);
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.wf-quick-bar {
  display: flex;
  align-items: center;
  gap: 4px;
  padding-top: 5px;
  border-top: 1.5px dashed rgba(74, 44, 23, 0.28);
  transform: skewX(4deg);
}

.wf-qbtn {
  border: 2px solid var(--ink);
  border-radius: 8px;
  padding: 4px 8px;
  font-family: 'Fredoka', sans-serif;
  font-size: 0.74rem;
  font-weight: 800;
  cursor: pointer;
  background: #fff7e0;
  color: var(--ink);
  box-shadow: 0 2px 0 var(--ink);
  transition: transform 0.1s ease;
  white-space: nowrap;
}

.wf-qbtn:hover {
  transform: translateY(-1px);
}

.wf-qbtn.attack {
  flex: 1;
  background: linear-gradient(180deg, #ef5c47 0%, #c83322 100%);
  color: #fffef5;
}

.wf-qbtn.dash {
  flex: 1;
  background: linear-gradient(180deg, #ffbe4d 0%, #e58319 100%);
  color: #3d1d05;
}

.wf-qbtn.cycle {
  padding: 4px 7px;
  background: #f5e6c5;
}

.wf-qbtn.dismiss {
  padding: 4px 7px;
  background: #ede1c9;
  color: var(--ink-soft);
}

.wf-top {
  display: flex;
  align-items: center;
  gap: 9px;
  transform: skewX(4deg);
}

.wf-pct-badge {
  min-width: 58px;
  padding: 6px 8px;
  border-radius: 10px;
  border: 2px solid var(--ink);
  font-family: 'Fredoka', sans-serif;
  font-size: 1.08rem;
  font-weight: 700;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  line-height: 1.05;
  gap: 2px;
}

.wf-pct-badge.full {
  background: linear-gradient(180deg, #5cc244 0%, #3d8f29 100%);
  color: #fffef5;
}

.wf-pct-badge.half {
  background: linear-gradient(180deg, #f8cc4b 0%, #d8951e 100%);
  color: #3f220c;
}

.wf-pct-badge.zero {
  background: linear-gradient(180deg, #dc5242 0%, #a52d20 100%);
  color: #fff5f2;
}

.wf-pct-badge.dash {
  background: linear-gradient(180deg, #ff9938 0%, #d95d16 100%);
  color: #fffdf5;
  font-size: 0.78rem;
}

.wf-info-col {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.wf-name-row {
  display: flex;
  align-items: center;
  gap: 5px;
  flex-wrap: wrap;
}

.wf-name-row strong {
  font-family: 'Fredoka', sans-serif;
  font-size: 0.88rem;
  color: var(--ink);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.wf-match {
  font-size: 0.68rem;
  font-weight: 800;
  padding: 1px 5px;
  border-radius: 6px;
  border: 1.4px solid var(--ink);
}

.wf-match.advantage {
  background: #dcf5c6;
  color: #255c17;
}

.wf-match.disadvantage {
  background: #fde0d9;
  color: #8f2214;
}

.wf-ko-stamp {
  background: #d93b2b;
  color: #fffbe0;
  border: 1.5px solid var(--ink);
  border-radius: 6px;
  padding: 0.5px 5px;
  font-family: 'Fredoka', sans-serif;
  font-size: 0.7rem;
  font-weight: 700;
}

.wf-hp-wrap {
  display: flex;
  align-items: center;
  gap: 6px;
}

.wf-hp-track {
  position: relative;
  flex: 1;
  height: 9px;
  background: #cbb692;
  border: 1.5px solid var(--ink);
  border-radius: 99px;
  overflow: hidden;
}

.wf-hp-rem {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  background: #d94c3d;
}

.wf-hp-dmg {
  position: absolute;
  top: 0;
  bottom: 0;
  background: #ffe052;
  animation: dmgBlink 0.65s ease-in-out infinite alternate;
}

@keyframes dmgBlink {
  from { opacity: 0.38; }
  to { opacity: 1; }
}

.wf-hp-num {
  font-size: 0.72rem;
  font-weight: 800;
  color: var(--ink-soft);
  white-space: nowrap;
}

.wf-tags-row {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.wf-dmg-chip,
.wf-dash-chip,
.wf-kb-chip,
.wf-blocked-chip {
  font-family: 'Fredoka', sans-serif;
  font-size: 0.7rem;
  font-weight: 600;
  padding: 1px 6px;
  border-radius: 6px;
  border: 1.3px solid var(--ink);
}

.wf-dmg-chip {
  background: #ffe3d9;
  color: #962214;
}

.wf-dash-chip {
  background: #ffebd0;
  color: #9e4308;
}

.wf-kb-chip {
  background: #fff3c4;
  color: #6b4300;
}

.wf-kb-chip.bump {
  background: #ffcf96;
  color: #8c1e0c;
}

.wf-blocked-chip {
  background: #e9dcc6;
  color: #63442a;
}

.wf-pointer {
  width: 12px;
  height: 12px;
  margin: -5px auto 0;
  background: #f5ead2;
  border-right: 2.5px solid var(--ink);
  border-bottom: 2.5px solid var(--ink);
  transform: rotate(45deg);
}

/* ===== Top Tactical Bar ===== */
.top-hud {
  position: fixed;
  top: calc(10px + var(--safe-top));
  left: calc(12px + var(--safe-left));
  right: calc(12px + var(--safe-right));
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
  pointer-events: none;
  z-index: 20;
}

.mr-top-banner {
  pointer-events: auto;
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 6px 12px;
  max-width: min(620px, 64vw);
}

.turn-stamp {
  font-family: 'Fredoka', sans-serif;
  font-size: 0.78rem;
  font-weight: 700;
  padding: 4px 9px;
  border-radius: 8px;
  border: 1.8px solid var(--ink);
  white-space: nowrap;
  transform: skewX(-6deg);
}

.turn-stamp.player {
  background: #559c34;
  color: #fffdf5;
}

.turn-stamp.enemy {
  background: #cc4433;
  color: #fffdf5;
}

.status-copy {
  min-width: 0;
  display: flex;
  flex-direction: column;
  line-height: 1.15;
}

.status-copy strong {
  font-family: 'Fredoka', sans-serif;
  font-size: 0.92rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.status-copy small {
  font-size: 0.73rem;
  color: var(--ink-soft);
  font-weight: 700;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.cam-mode-pill {
  font-family: 'Fredoka', sans-serif;
  font-size: 0.68rem;
  font-weight: 700;
  padding: 2px 7px;
  border-radius: 999px;
  border: 1.6px solid var(--ink);
  white-space: nowrap;
}

.cam-mode-pill.aim {
  background: #d94c38;
  color: #fffef5;
}

.cam-mode-pill.tacticam {
  background: #f5cc45;
  color: #42240d;
}

.top-actions {
  pointer-events: auto;
  display: flex;
  align-items: center;
  gap: 7px;
}

.cam-cluster {
  display: flex;
  align-items: center;
  padding: 2px 4px;
  gap: 2px;
}

.cam-btn {
  border: none;
  background: transparent;
  color: var(--ink);
  font-family: 'Fredoka', sans-serif;
  font-size: 0.78rem;
  font-weight: 700;
  padding: 5px 8px;
  border-radius: 7px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.cam-btn:hover {
  background: rgba(74, 44, 23, 0.12);
}

.cam-btn.active {
  background: #f5cc45;
  box-shadow: inset 0 0 0 1.5px var(--ink);
}

.relic-rack {
  display: flex;
  align-items: center;
  padding: 3px 6px;
  gap: 4px;
}

.relic-chip {
  background: transparent;
  border: none;
  cursor: pointer;
  font-size: 1rem;
  padding: 2px 4px;
  border-radius: 6px;
}

.relic-chip:hover {
  background: rgba(74, 44, 23, 0.14);
}

.tool-btn {
  min-width: 38px;
  padding: 6px 9px;
}

.tool-btn.danger-on {
  background: #d94636;
  color: #fffef5;
}

.tool-btn.undo-ready {
  background: #f5cf5b;
}

/* ===== Side Utility (Zoom + Cover Info + Mini Log) ===== */
.side-utility {
  position: fixed;
  top: 66px;
  right: 14px;
  width: 244px;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 8px;
  pointer-events: none;
  z-index: 16;
}

.side-utility > * {
  pointer-events: auto;
}

.scale-strip {
  display: inline-flex;
  align-items: center;
  padding: 2px 4px;
  gap: 2px;
}

.sc-btn {
  border: none;
  background: transparent;
  color: var(--ink);
  font-family: 'Fredoka', sans-serif;
  font-weight: 700;
  font-size: 0.85rem;
  padding: 4px 8px;
  border-radius: 6px;
  cursor: pointer;
}

.sc-btn:hover {
  background: rgba(74, 44, 23, 0.12);
}

.sc-pct {
  font-size: 0.74rem;
  min-width: 44px;
}

.inspector-ribbon {
  width: 100%;
  padding: 8px 10px;
  display: flex;
  align-items: center;
  gap: 9px;
}

.fc-sprite {
  width: 40px;
  height: 40px;
  object-fit: contain;
  flex-shrink: 0;
}

.insp-copy {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.insp-top {
  display: flex;
  align-items: center;
  gap: 6px;
}

.insp-copy strong {
  font-family: 'Fredoka', sans-serif;
  font-size: 0.82rem;
}

.insp-copy small {
  font-size: 0.72rem;
  color: var(--ink-soft);
  line-height: 1.25;
}

.desktop-log-pill {
  width: 100%;
  padding: 6px 10px;
  font-size: 0.72rem;
  color: var(--ink-soft);
  line-height: 1.28;
  text-align: left;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.log-pill-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}

.log-latest {
  font-weight: 700;
  color: var(--ink);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.desktop-log-pill.expanded .log-latest {
  white-space: normal;
}

.log-caret {
  font-size: 0.7rem;
  color: var(--ink-soft);
  flex-shrink: 0;
}

.log-history {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding-top: 4px;
  border-top: 1px dashed rgba(74, 44, 23, 0.25);
}

.log-line + .log-line {
  padding-top: 3px;
  border-top: 1px dashed rgba(74, 44, 23, 0.16);
}

/* ===== Coach Note & Inspect Toast ===== */
.coach-note {
  position: fixed;
  top: calc(68px + var(--safe-top));
  left: calc(14px + var(--safe-left));
  width: min(350px, calc(100vw - 28px));
  padding: 10px 12px 10px 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  z-index: 25;
}

.coach-copy {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.coach-copy strong {
  font-family: 'Fredoka', sans-serif;
  font-size: 0.86rem;
}

.coach-copy small {
  font-size: 0.74rem;
  color: var(--ink-soft);
  line-height: 1.28;
}

.coach-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

.mini-act {
  min-height: 30px;
  padding: 4px 10px;
  font-size: 0.78rem;
}

.mini-close-x {
  border: none;
  background: transparent;
  color: var(--ink-soft);
  cursor: pointer;
  padding: 4px;
  border-radius: 6px;
}

.inspect-toast {
  position: fixed;
  top: 72px;
  left: 50%;
  transform: translateX(-50%);
  max-width: min(400px, calc(100vw - 32px));
  padding: 10px 14px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  z-index: 30;
  cursor: pointer;
}

.inspect-toast strong {
  font-family: 'Fredoka', sans-serif;
  font-size: 0.88rem;
}

.inspect-toast small {
  font-size: 0.76rem;
  color: var(--ink-soft);
}

/* ===== Mario + Rabbids Bottom HUD Stage ===== */
.mr-bottom-hud {
  position: fixed;
  left: calc(12px + var(--safe-left));
  right: calc(12px + var(--safe-right));
  bottom: calc(14px + var(--safe-bottom));
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  pointer-events: none;
  z-index: 20;
}

.mr-hud-row {
  width: 100%;
  max-width: 1180px;
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 14px;
}

/* Bottom-Left Mario + Rabbids Slanted Squad Cards */
.mr-squad-rail {
  pointer-events: auto;
  display: flex;
  align-items: flex-end;
  gap: 8px;
}

.mr-hero-card {
  position: relative;
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 140px;
  max-width: 174px;
  padding: 5px 9px 5px 7px;
  background:
    linear-gradient(180deg, rgba(255, 253, 246, 0.94) 0%, rgba(242, 229, 202, 0.94) 100%);
  border: 2.2px solid var(--ink);
  border-radius: 12px;
  transform: skewX(-6deg);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 252, 0.9),
    0 4px 0 #8a5e32,
    0 8px 16px rgba(32, 14, 4, 0.28);
  cursor: pointer;
  transition: transform 0.14s ease, box-shadow 0.14s ease, filter 0.14s ease;
  text-align: left;
  color: var(--ink);
}

.mr-hero-card > * {
  transform: skewX(6deg);
}

.mr-hero-card:hover:not(:disabled) {
  transform: skewX(-6deg) translateY(-4px);
}

.mr-hero-card.selected {
  transform: skewX(-6deg) translateY(-9px) scale(1.04);
  background:
    linear-gradient(180deg, #fffbe6 0%, #ffe89e 100%);
  border-color: #3d210e;
  box-shadow:
    inset 0 1px 0 #ffffff,
    0 0 0 2.5px #f5c338,
    0 6px 0 #7a4c14,
    0 12px 22px rgba(28, 12, 2, 0.38);
}

.mr-hero-card.done {
  filter: saturate(0.55) brightness(0.92);
}

.mr-hero-card.ko {
  opacity: 0.48;
  filter: grayscale(0.9);
  cursor: not-allowed;
}

.mr-hotkey {
  position: absolute;
  top: -8px;
  left: -6px;
  width: 18px;
  height: 18px;
  border-radius: 6px;
  background: var(--ink);
  color: #fffbe8;
  font-family: 'Fredoka', sans-serif;
  font-size: 0.68rem;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 3;
}

.mr-portrait-box {
  position: relative;
  width: 36px;
  height: 36px;
  border-radius: 9px;
  background: #ebe0c6;
  border: 1.6px solid var(--ink);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  overflow: hidden;
}

.mr-portrait-img {
  width: 32px;
  height: 32px;
  object-fit: contain;
}

.mr-done-seal {
  position: absolute;
  right: -2px;
  bottom: -2px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: #4f9432;
  color: #fff;
  border: 1.4px solid var(--ink);
  display: flex;
  align-items: center;
  justify-content: center;
}

.mr-hero-meta {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  gap: 2.5px;
}

.mr-hero-name-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 3px;
}

.mr-hero-name-row strong {
  font-family: 'Fredoka', sans-serif;
  font-size: 0.8rem;
  line-height: 1.1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.mr-hp-inline {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
}

.mr-hp-txt {
  font-size: 0.62rem;
  font-weight: 800;
  color: var(--ink-soft);
  white-space: nowrap;
  flex-shrink: 0;
}

.mr-hp-bar {
  flex: 1;
  min-width: 0;
  height: 6px;
  border-radius: 99px;
  background: #cbb692;
  border: 1.2px solid var(--ink);
  overflow: hidden;
}

.mr-hp-fill {
  height: 100%;
  transition: width 0.2s ease;
}

.mr-action-pips {
  display: flex;
  gap: 4px;
  margin-top: 1px;
}

.mr-pip {
  flex: 1;
  height: 5px;
  border-radius: 99px;
  border: 1px solid var(--ink);
}

.mr-pip.move {
  background: #33b5e8;
}

.mr-pip.atk {
  background: #e5493a;
}

.mr-pip.skl {
  background: #9f5ad6;
}

.mr-pip.spent {
  background: #cfc0a5;
  opacity: 0.45;
}
.mr-pip.partial {
  opacity: 0.6;
  box-shadow: inset 0 0 0 2px rgba(255, 255, 255, 0.55);
}

/* Bottom-Center Mario + Rabbids Command Deck */
.mr-command-wrap {
  pointer-events: auto;
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 5px;
  flex: 1;
  max-width: 560px;
}

.mr-deck {
  width: 100%;
  padding: 7px 10px 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.mr-deck.deck-aim {
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 250, 0.95),
    0 0 0 2.5px #e5493a,
    0 10px 22px rgba(38, 17, 4, 0.34);
}

.mr-deck.deck-skill {
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 250, 0.95),
    0 0 0 2.5px #9f5ad6,
    0 10px 22px rgba(38, 17, 4, 0.34);
}

.mr-deck.deck-threat {
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 250, 0.95),
    0 0 0 2.5px #d94636,
    0 10px 22px rgba(38, 17, 4, 0.34);
}

.mr-deck-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
}

.hero-id-btn {
  border: none;
  background: transparent;
  color: var(--ink);
  padding: 0;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.hero-id-btn strong {
  font-family: 'Fredoka', sans-serif;
  font-size: 0.94rem;
}

.family-tag {
  font-size: 0.7rem;
  font-weight: 800;
  padding: 1.5px 6px;
  border-radius: 999px;
  background: #e9d7b4;
  border: 1.2px solid var(--ink);
}

.weapon-mini {
  font-size: 0.73rem;
  font-weight: 700;
  color: var(--ink-soft);
}

.slot-pills {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
}

.undo-thumb-chip,
.coop-pin,
.graft-pin,
.status-chip {
  font-family: 'Fredoka', sans-serif;
  font-size: 0.69rem;
  font-weight: 600;
  padding: 2px 6px;
  border-radius: 7px;
  border: 1.4px solid var(--ink);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 3px;
}

.undo-thumb-chip {
  background: #f5cf5b;
  color: var(--ink);
}

.coop-pin {
  background: #fff2b8;
  color: #6b4300;
}

.graft-pin {
  background: #f4ead2;
}

.status-chip.burn { background: #ffe0c4; color: #9c2b0e; }
.status-chip.rooted { background: #daf4cd; color: #205c14; }
.status-chip.acid { background: #f3f7b0; color: #544b00; }
.status-chip.feared { background: #eed9ff; color: #5c1f7a; }
.status-chip.shield { background: #d4ecff; color: #134a78; }
.status-chip.boosted { background: #fff0b3; color: #7a4a00; }

.stance-chip {
  font-size: 0.68rem;
  font-weight: 800;
  padding: 2px 7px;
  border-radius: 999px;
  border: 1.5px solid #5c3a1e;
  cursor: pointer;
  white-space: nowrap;
  box-shadow: 0 1px 0 rgba(74, 44, 23, 0.35);
}
.stance-chip.cover-full { background: #d8ecf6; color: #174c6b; border-color: #2f6c8f; }
.stance-chip.cover-half { background: #f8edd0; color: #6e4814; border-color: #a1712a; }
.stance-chip.high-ground { background: #e1f2d8; color: #245c20; border-color: #468038; }
.stance-chip.sunbeam { background: #fff4c2; color: #7d4e06; border-color: #c28820; }

/* 6-Button Mario + Rabbids Action Row */
.mr-action-bar {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 6px;
}

.mr-act-btn {
  position: relative;
  padding: 5px 6px;
  min-height: 40px;
  transform: skewX(-4deg);
  justify-content: center;
  gap: 4px;
}

.mr-act-btn > * {
  transform: skewX(4deg);
}

.act-keycap {
  position: absolute;
  top: -6px;
  left: -4px;
  min-width: 15px;
  height: 15px;
  padding: 0 3px;
  border-radius: 4px;
  background: rgba(58, 33, 14, 0.92);
  color: #fff6d4;
  border: 1px solid rgba(255, 245, 210, 0.45);
  font-family: 'Fredoka', sans-serif;
  font-size: 0.58rem;
  font-weight: 800;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
  z-index: 2;
}

.mr-act-btn:hover:not(:disabled) {
  transform: skewX(-4deg) translateY(-2px);
}

.mr-act-btn.is-active {
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.7),
    0 0 0 2.5px #ffe159,
    0 3px 0 var(--ink);
}

.mr-act-btn.pulse-ready {
  animation: readyPulse 1.5s ease-in-out infinite;
}

@keyframes readyPulse {
  0%, 100% { filter: brightness(1); }
  50% { filter: brightness(1.1); }
}

.act-copy {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  line-height: 1.05;
  min-width: 0;
}

.act-title {
  font-size: 0.8rem;
  font-weight: 700;
  white-space: nowrap;
}

.act-sub {
  font-size: 0.64rem;
  opacity: 0.9;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 72px;
}

.tab-badge {
  position: absolute;
  top: -7px;
  right: -5px;
  min-width: 18px;
  height: 18px;
  padding: 0 4px;
  border-radius: 999px;
  background: #ffe052;
  color: #3f220c;
  border: 1.6px solid var(--ink);
  font-size: 0.68rem;
  font-weight: 800;
  display: flex;
  align-items: center;
  justify-content: center;
  transform: skewX(4deg);
}

/* Morphing Preview / Confirm States */
.morph-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.mh-left {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.mh-sprite {
  width: 36px;
  height: 36px;
  object-fit: contain;
  flex-shrink: 0;
}

.mh-copy {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.mh-copy strong {
  font-family: 'Fredoka', sans-serif;
  font-size: 0.88rem;
}

.mh-copy small {
  font-size: 0.72rem;
  color: var(--ink-soft);
}

.mh-title-row {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.mh-stats {
  display: flex;
  align-items: center;
  gap: 5px;
  flex-wrap: wrap;
}

.hit-stamp {
  font-family: 'Fredoka', sans-serif;
  font-size: 0.8rem;
  font-weight: 700;
  padding: 2px 7px;
  border-radius: 8px;
  border: 1.5px solid var(--ink);
}

.hit-stamp.full { background: #56b842; color: #fffdf5; }
.hit-stamp.half { background: #f5c946; color: #3f220c; }
.hit-stamp.zero { background: #d44939; color: #fffdf5; }

.ko-tag {
  background: #d93b2b;
  color: #fffbe0;
  font-family: 'Fredoka', sans-serif;
  font-size: 0.72rem;
  padding: 2px 6px;
  border-radius: 6px;
  border: 1.4px solid var(--ink);
}

.match-stamp {
  font-size: 0.7rem;
  font-weight: 800;
  padding: 1.5px 6px;
  border-radius: 6px;
  border: 1.4px solid var(--ink);
}

.match-stamp.advantage { background: #d9f5c4; color: #225c15; }
.match-stamp.disadvantage { background: #fde0d8; color: #8c2012; }

.dest-pill {
  font-family: 'Fredoka', sans-serif;
  font-size: 0.72rem;
  padding: 2px 7px;
  border-radius: 8px;
  border: 1.4px solid var(--ink);
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.dest-pill.full { background: #cde8ff; color: #144a7d; }
.dest-pill.half { background: #fff0c2; color: #754a00; }
.dest-pill.none { background: #eee3ce; color: var(--ink-soft); }
.dest-pill.foes-hot { background: #ffdcd6; color: #8f1d10; }
.dest-pill.foes-none { background: #eee3ce; color: var(--ink-soft); }

.confirm-strip {
  display: flex;
  align-items: center;
  gap: 6px;
}

.confirm-btn {
  flex: 1;
  min-height: 40px;
}

.cancel-btn {
  min-width: 40px;
  min-height: 40px;
}

.cancel-btn-wide {
  min-height: 40px;
  padding: 6px 12px;
}

.target-prompt-pill,
.threat-pill-bar {
  flex: 1;
  padding: 8px 10px;
  border-radius: 9px;
  background: #efe2c8;
  border: 1.5px dashed var(--ink);
  font-family: 'Fredoka', sans-serif;
  font-size: 0.8rem;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
}

.mini-zone-btn {
  border: 1.5px solid var(--ink);
  background: #f5e9ce;
  border-radius: 7px;
  padding: 4px 6px;
  cursor: pointer;
}

.mini-zone-btn.active {
  background: #d94636;
  color: #fff;
}

/* Garden Satchel Popover */
.bag-popover {
  position: absolute;
  bottom: calc(100% + 10px);
  right: 0;
  width: min(310px, calc(100vw - 24px));
  max-height: 260px;
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 7px;
  z-index: 32;
}

.bag-head-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.bag-note {
  font-family: 'Fredoka', sans-serif;
  font-size: 0.78rem;
  color: var(--ink-soft);
}

.bag-close-btn {
  border: none;
  background: transparent;
  color: var(--ink);
  cursor: pointer;
  padding: 3px;
}

.bag-opt {
  padding: 9px 10px;
  text-align: left;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 2px;
  color: var(--ink);
}

.bag-opt:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.bag-opt-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}

.bag-opt small {
  font-size: 0.72rem;
  color: var(--ink-soft);
}

/* Auto-End Turn Grace Banner */
.auto-end-banner {
  pointer-events: auto;
  width: min(420px, 100%);
  padding: 8px 11px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.auto-top-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.auto-copy {
  display: flex;
  align-items: center;
  gap: 6px;
  font-family: 'Fredoka', sans-serif;
  font-size: 0.8rem;
}

.auto-btns {
  display: flex;
  gap: 5px;
}

.auto-bar-track {
  height: 5px;
  border-radius: 99px;
  background: #dfd0b0;
  overflow: hidden;
}

.auto-bar-fill {
  height: 100%;
  background: #5ca838;
  animation-name: shrinkBar;
  animation-timing-function: linear;
  animation-fill-mode: forwards;
}

@keyframes shrinkBar {
  from { width: 100%; }
  to { width: 0%; }
}

.mr-end-only {
  display: flex;
  justify-content: flex-end;
}

.mr-skew-btn {
  transform: skewX(-6deg);
  padding: 9px 18px;
}

.mr-skew-btn > * {
  transform: skewX(6deg);
}

/* Field Notebook Drawer */
.menu-backdrop,
.outcome-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(28, 13, 4, 0.52);
  backdrop-filter: blur(2px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 18px;
  z-index: 45;
}

.outcome-backdrop.victory-clear {
  background: rgba(28, 13, 4, 0.16);
  backdrop-filter: none;
  align-items: flex-end;
  padding-bottom: 34px;
}

.utility-sheet {
  width: min(460px, 100%);
  max-height: 86dvh;
  padding: 18px 16px 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.sheet-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.fallback-warn {
  margin: 0;
  padding: 8px 10px;
  border-radius: 8px;
  background: #fff0c2;
  border: 1.5px solid var(--ink);
  font-size: 0.78rem;
}

.quick-toggles {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 7px;
}

.toggle-wide {
  grid-column: span 2;
}

.menu-section {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.menu-section h4 {
  font-size: 0.86rem;
}

.mini-rules {
  margin: 0;
  padding-left: 18px;
  font-size: 0.78rem;
  color: var(--ink-soft);
  line-height: 1.38;
}

.menu-relics {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.menu-relic-row {
  display: flex;
  flex-direction: column;
  padding: 6px 8px;
  border-radius: 8px;
  background: rgba(255, 252, 240, 0.7);
  border: 1.2px solid rgba(74, 44, 23, 0.25);
  font-size: 0.78rem;
}

.menu-log {
  font-size: 0.74rem;
  color: var(--ink-soft);
  display: flex;
  flex-direction: column;
  gap: 3px;
}

/* Outcome Modal */
.outcome-modal {
  width: min(420px, 100%);
  padding: 24px 20px 18px;
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
}

.out-ribbon {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 7px 16px;
  border-radius: 10px;
  background: #549c34;
  color: #fffdf5;
  border: 2px solid var(--ink);
  font-family: 'Fredoka', sans-serif;
  font-size: 1.1rem;
  font-weight: 700;
}

.out-ribbon.defeat {
  background: #b83d2e;
}

.outcome-modal p {
  margin: 0;
  font-size: 0.88rem;
  color: var(--ink-soft);
  line-height: 1.4;
}

.outcome-stats {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 6px;
}

.gold-pill {
  background: #ffe89e;
}

.big-go {
  width: 100%;
  min-height: 44px;
  font-size: 0.96rem;
}

/* Mobile Log Ticker */
.mobile-log-ticker {
  width: 100%;
  padding: 4px 10px;
  border-radius: 999px;
  border: 1.5px solid var(--ink);
  background: rgba(252, 246, 230, 0.9);
  color: var(--ink);
  font-size: 0.72rem;
  font-weight: 700;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.mobile-only {
  display: none;
}

@media (max-width: 960px) {
  .mr-hud-row {
    flex-direction: column;
    align-items: center;
    gap: 8px;
  }

  .mr-squad-rail {
    width: 100%;
    justify-content: center;
    gap: 5px;
  }

  .mr-hero-card {
    flex: 1;
    max-width: 120px;
    min-width: 0;
    padding: 5px 6px;
    gap: 5px;
  }

  .mr-portrait-box {
    width: 30px;
    height: 30px;
  }

  .mr-portrait-img {
    width: 26px;
    height: 26px;
  }

  .mr-command-wrap {
    width: 100%;
    max-width: 560px;
  }
}

@media (max-width: 767px) {
  .desktop-only {
    display: none !important;
  }

  .mobile-only {
    display: inline-flex;
  }

  .top-hud {
    left: calc(8px + var(--safe-left));
    right: calc(8px + var(--safe-right));
    gap: 6px;
  }

  .mr-top-banner {
    flex: 1;
    min-width: 0;
    max-width: none;
    padding: 5px 8px;
    gap: 6px;
  }

  .turn-stamp {
    font-size: 0.7rem;
    padding: 3px 6px;
  }

  /* Phones: the top bar keeps the turn and pills; the objective has its own strip below. */
  .status-copy {
    display: none;
  }

  .mr-top-banner {
    flex: 0 1 auto;
  }

  .coach-note,
  .boss-telegraph-strip {
    top: calc(90px + var(--safe-top));
  }

  .objective-strip {
    position: fixed;
    display: block;
    z-index: 19;
    top: calc(58px + var(--safe-top));
    left: calc(8px + var(--safe-left));
    max-width: calc(100% - 16px - var(--safe-left) - var(--safe-right));
    padding: 3px 10px;
    border-radius: 999px;
    border: 1.6px solid var(--ink);
    background: rgba(255, 250, 235, 0.94);
    font-family: 'Fredoka', sans-serif;
    font-size: 0.74rem;
    font-weight: 700;
    color: var(--ink);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    pointer-events: none;
  }

  /* The bottom deck already carries FIRE and target cycling on phones. */
  .wf-quick-bar {
    display: none;
  }

  .top-actions {
    gap: 4px;
    flex-shrink: 0;
  }

  .tool-btn {
    min-width: 34px;
    min-height: 36px;
    padding: 5px 7px;
  }

  .cam-btn {
    padding: 5px 6px;
  }

  .mr-action-bar {
    gap: 4px;
  }

  .mr-act-btn {
    flex-direction: column;
    padding: 5px 3px;
    min-height: 46px;
    gap: 2px;
  }

  .act-copy {
    align-items: center;
  }

  .act-title {
    font-size: 0.7rem;
  }

  .act-sub {
    font-size: 0.58rem;
  }
}

@media (max-width: 520px) {
  .mr-hero-name-row strong {
    display: none;
  }

  .mr-hero-name-row {
    justify-content: flex-start;
  }

  .mr-hp-txt {
    font-size: 0.68rem;
  }
}

/* ===== New Phase 3 Tactical HUD Badges & Controls ===== */
.wf-high-chip,
.wf-crit-chip,
.deck-bonus-tag {
  display: inline-flex;
  align-items: center;
  padding: 2px 6px;
  border-radius: 999px;
  font-size: 0.68rem;
  font-weight: 800;
  border: 1.5px solid var(--ink);
  white-space: nowrap;
}

.wf-high-chip,
.deck-bonus-tag.high {
  background: #e2f5ff;
  color: #10557c;
}

.wf-crit-chip,
.deck-bonus-tag.crit {
  background: #fff0a8;
  color: #7c3f00;
}

.wf-kb-chip.lava,
.deck-bonus-tag.lava {
  background: #ffd4b8;
  color: #8f1d00;
}

.wf-kb-chip.water,
.deck-bonus-tag.water {
  background: #d2f3ff;
  color: #0b5170;
}

.wf-kb-chip.drop,
.deck-bonus-tag.drop {
  background: #ffe8c2;
  color: #7a3e00;
}

.mr-lvl-chip {
  position: absolute;
  top: -5px;
  left: -5px;
  background: #4e321a;
  color: #ffea9c;
  border: 1.5px solid #fbf3df;
  border-radius: 6px;
  font-size: 0.58rem;
  font-weight: 800;
  padding: 0 3px;
  line-height: 1.3;
  z-index: 3;
}

.mr-watch-seal {
  position: absolute;
  bottom: -4px;
  right: -4px;
  width: 19px;
  height: 19px;
  border-radius: 50%;
  background: #f5b82e;
  border: 1.5px solid var(--ink);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.68rem;
  box-shadow: 0 2px 0 rgba(56, 32, 14, 0.4);
}

.lvl-tag {
  background: #4e321a;
  color: #ffe99e;
  font-size: 0.68rem;
  font-weight: 800;
  padding: 1px 6px;
  border-radius: 999px;
}

.mr-action-bar.six-col {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 6px;
}

.mr-action-bar.six-col .mr-act-btn {
  min-width: 0;
  overflow: hidden;
  padding-left: 6px;
  padding-right: 6px;
}

.mr-action-bar.six-col .act-copy {
  min-width: 0;
  max-width: 100%;
  overflow: hidden;
}

.mr-action-bar.six-col .act-sub {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.watch-btn {
  background: linear-gradient(180deg, #ffe285 0%, #efb432 100%);
  color: #3f2200;
}

.watch-btn.is-active {
  background: linear-gradient(180deg, #ffb824 0%, #d98212 100%);
  color: #fffef5;
  box-shadow: 0 0 0 2px #fff2a6, 0 3px 0 var(--ink);
}

.watch-glyph {
  font-size: 0.92rem;
  line-height: 1;
}

.aim-cycle-btn {
  min-width: 40px;
  padding: 6px 10px;
  font-weight: 900;
  background: #f8edd6;
  color: var(--ink);
}

.fire-cta {
  font-weight: 900;
  letter-spacing: 0.02em;
}

.status-chip.overwatch {
  background: #f5b82e;
  color: #3b2100;
}

.speed-btn {
  min-width: 40px;
  font-weight: 900;
  font-size: 0.78rem;
  letter-spacing: 0.02em;
}

.speed-btn.speed-fast {
  background: linear-gradient(180deg, #ffe278 0%, #f0b32c 100%);
  color: #3f2200;
  box-shadow: 0 3px 0 var(--ink);
}

.boss-telegraph-strip {
  position: fixed;
  top: calc(64px + var(--safe-top));
  left: 50%;
  transform: translateX(-50%);
  z-index: 26;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 6px 14px;
  border-radius: 999px;
  background: linear-gradient(180deg, #d93526 0%, #9c1a12 100%);
  color: #fff6dc;
  border: 2.5px solid #ffd166;
  box-shadow: 0 4px 0 #3f130b, 0 10px 22px rgba(45, 6, 2, 0.45);
  font-size: 0.8rem;
  font-weight: 700;
  max-width: calc(100vw - 24px);
  pointer-events: none;
  animation: telegraph-pulse 1.35s ease-in-out infinite;
}

.boss-telegraph-strip strong {
  color: #ffe278;
}

@keyframes telegraph-pulse {
  0%,
  100% {
    box-shadow: 0 4px 0 #3f130b, 0 0 0 0 rgba(255, 209, 102, 0.55);
  }
  50% {
    box-shadow: 0 4px 0 #3f130b, 0 0 0 6px rgba(255, 209, 102, 0);
  }
}

.mr-hero-card.low-hp {
  border-color: #d93526;
  background: linear-gradient(180deg, #fff1ec 0%, #ffd8cf 100%);
  animation: lowhp-card-pulse 1.4s ease-in-out infinite;
}

@keyframes lowhp-card-pulse {
  0%,
  100% {
    box-shadow: 0 4px 0 var(--ink), 0 0 0 0 rgba(217, 53, 38, 0.55);
  }
  50% {
    box-shadow: 0 4px 0 var(--ink), 0 0 0 5px rgba(217, 53, 38, 0);
  }
}

@media (max-width: 520px) {
  .mr-action-bar.six-col {
    gap: 4px;
  }

  .mr-action-bar.six-col .mr-act-btn {
    padding: 6px 2px;
  }

  .mr-action-bar.six-col .act-title {
    font-size: 0.68rem;
    letter-spacing: -0.02em;
  }

  .mr-action-bar.six-col .act-sub {
    font-size: 0.58rem;
  }
}

.turn-stamp.prep {
  background: linear-gradient(180deg, #32a852 0%, #1d7a36 100%);
  color: #fffef4;
}

.cam-mode-pill.par {
  background: #f3e7c9;
  color: #5b4a2c;
}
.cam-mode-pill.par.over {
  background: #e9d2b4;
  color: #8a5a2b;
  opacity: 0.8;
}
.grade-pill.perfect {
  background: #f6d66b;
  color: #5a3d00;
  font-weight: 800;
}
.grade-pill.great {
  background: #cfe8b5;
  color: #2f4f1a;
  font-weight: 700;
}
.hurry-hint {
  position: fixed;
  left: 50%;
  bottom: calc(150px + var(--safe-bottom, 0px));
  transform: translateX(-50%);
  z-index: 24;
  padding: 3px 12px;
  border-radius: 999px;
  background: rgba(40, 28, 16, 0.72);
  color: #fff8e6;
  font-family: 'Fredoka', sans-serif;
  font-size: 0.72rem;
  font-weight: 600;
  pointer-events: none;
  animation: hurry-fade 2.4s ease-in-out infinite;
}
@keyframes hurry-fade {
  0%,
  100% {
    opacity: 0.35;
  }
  50% {
    opacity: 0.9;
  }
}
@media (prefers-reduced-motion: reduce) {
  .hurry-hint {
    animation: none;
    opacity: 0.8;
  }
}
@media (max-width: 767px) {
  .hurry-hint {
    bottom: calc(252px + var(--safe-bottom, 0px));
  }
}
.cam-mode-pill.bonds {
  background: #fff3c4;
  color: #42240d;
  cursor: pointer;
  pointer-events: auto;
  letter-spacing: 1px;
}
.bond-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 9px;
  border-radius: 999px;
  border: 1.6px dashed #8a7a5c;
  background: #f4ecd8;
  color: #6b5a3c;
  font-family: 'Fredoka', sans-serif;
  font-size: 0.72rem;
  font-weight: 700;
  cursor: pointer;
}
.bond-chip.on {
  border: 1.8px solid var(--ink);
  background: linear-gradient(180deg, #ffe9a0 0%, #f6cf58 100%);
  color: #3e2600;
}
.bond-chip.two {
  background: linear-gradient(180deg, #ffd27a 0%, #f0a325 100%);
}
.cam-mode-pill.heat {
  background: linear-gradient(180deg, #ff7a33 0%, #c8331a 100%);
  color: #fff8e6;
  border-color: #4f160a;
}

.wf-assist-chip,
.deck-bonus-tag.assist {
  background: linear-gradient(180deg, #ffe37a 0%, #f0b225 100%);
  color: #3e2000;
  border: 1.5px solid #4a2400;
  border-radius: 999px;
  padding: 2px 7px;
  font-size: 0.68rem;
  font-weight: 900;
}

.wf-pumpkin-chip,
.deck-bonus-tag.pumpkin {
  background: linear-gradient(180deg, #ff9933 0%, #d45b12 100%);
  color: #fffaf0;
  border: 1.5px solid #4d1b00;
  border-radius: 999px;
  padding: 2px 7px;
  font-size: 0.68rem;
  font-weight: 900;
}

.wf-bridge-chip,
.deck-bonus-tag.bridge {
  background: linear-gradient(180deg, #c78b4b 0%, #8a5624 100%);
  color: #fffaf0;
  border: 1.5px solid #3c2008;
  border-radius: 999px;
  padding: 2px 7px;
  font-size: 0.68rem;
  font-weight: 900;
}

.fc-emoji-badge,
.mh-emoji-badge {
  width: 40px;
  height: 40px;
  border-radius: 10px;
  border: 2px solid var(--ink);
  background: linear-gradient(180deg, #fff5dc 0%, #f0d7a8 100%);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 1.45rem;
  flex-shrink: 0;
  box-shadow: 0 2px 0 var(--ink);
}

.deck-prep {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 14px;
  border-color: #246b35;
  background: linear-gradient(180deg, #f3fae6 0%, #dfecc8 100%);
}

.prep-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
}

.prep-title-copy {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.prep-title-copy strong {
  font-family: 'Fredoka', sans-serif;
  font-size: 0.9rem;
  color: #1f542a;
  letter-spacing: 0.02em;
}

.prep-title-copy small {
  font-size: 0.74rem;
  color: #465d3d;
  font-weight: 600;
}

.prep-selected-pill {
  background: #fff9e6;
  border: 2px solid var(--ink);
  border-radius: 999px;
  padding: 2px 10px;
  font-size: 0.72rem;
  font-weight: 800;
  color: #3d240c;
}

.prep-bench-row {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.prep-bench-label {
  font-size: 0.72rem;
  font-weight: 800;
  color: #4a3520;
}

.prep-bench-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 9px 3px 5px;
  border-radius: 999px;
  border: 2px solid var(--ink);
  background: #fffdf5;
  font-family: inherit;
  font-size: 0.72rem;
  font-weight: 800;
  color: var(--ink);
  cursor: pointer;
  box-shadow: 0 2px 0 var(--ink);
  transition: transform 0.12s ease;
}

.mobile-obj-inline {
  font-family: 'Fredoka', sans-serif;
  font-size: 0.74rem;
  font-weight: 700;
  color: var(--ink);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}

.menu-tool-btn {
  position: relative;
}

.menu-active-dot {
  position: absolute;
  top: 4px;
  right: 4px;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #e6492d;
  border: 1.5px solid #fffdf5;
}

.deck-end-pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  min-height: 30px;
  font-size: 0.74rem;
  font-weight: 900;
  white-space: nowrap;
}

.mr-hud-row.is-prep {
  justify-content: center;
}

.mr-command-wrap.prep-wide {
  max-width: 680px;
  align-items: center;
}

.prep-top-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
}

.prep-top-left {
  display: flex;
  align-items: center;
  gap: 6px;
}

.prep-top-left strong {
  font-family: 'Fredoka', sans-serif;
  font-size: 0.88rem;
  color: #1f542a;
  letter-spacing: 0.02em;
}

.prep-bonds-toggle {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 2px 8px;
  border-radius: 999px;
  border: 1.6px solid var(--ink);
  background: linear-gradient(180deg, #ffe9a0 0%, #f5cb54 100%);
  color: #3e2600;
  font-family: 'Fredoka', sans-serif;
  font-size: 0.7rem;
  font-weight: 800;
  cursor: pointer;
}

.prep-top-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

.prep-guide-line {
  font-size: 0.74rem;
  font-weight: 600;
  color: #3b4f32;
  background: rgba(255, 250, 234, 0.85);
  border: 1.4px dashed #7f996d;
  border-radius: 9px;
  padding: 4px 9px;
  line-height: 1.25;
}

.prep-guide-line strong {
  color: #1a4d22;
  font-weight: 800;
}

.prep-swap-ok {
  color: #1d6322;
  font-weight: 800;
}

.prep-slots-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 6px;
}

.prep-slot-btn {
  position: relative;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 7px;
  min-height: 46px;
  border-radius: 11px;
  border: 2px solid var(--ink);
  background: #fffdf4;
  box-shadow: 0 2px 0 rgba(74, 44, 23, 0.32);
  cursor: pointer;
  text-align: left;
  transition: transform 0.1s ease, background 0.1s ease;
}

.prep-slot-btn.selected {
  border-color: #c9860d;
  background: linear-gradient(180deg, #fff5c8 0%, #ffe388 100%);
  box-shadow: 0 0 0 2px #fff9e6, 0 3px 0 #7a4b00;
  transform: translateY(-1px);
}

.prep-slot-btn img {
  width: 28px;
  height: 28px;
  object-fit: contain;
  flex-shrink: 0;
}

.prep-slot-copy {
  display: flex;
  flex-direction: column;
  min-width: 0;
  flex: 1;
}

.prep-slot-copy strong {
  font-family: 'Fredoka', sans-serif;
  font-size: 0.74rem;
  color: var(--ink);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.prep-slot-copy small {
  font-size: 0.62rem;
  font-weight: 700;
  color: var(--ink-soft);
}

.prep-slot-tag {
  position: absolute;
  top: -7px;
  right: 5px;
  background: #c97d0c;
  color: #fffef4;
  border: 1.4px solid var(--ink);
  border-radius: 999px;
  padding: 0 5px;
  font-size: 0.54rem;
  font-weight: 900;
  letter-spacing: 0.04em;
}

.prep-bench-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 9px 4px 6px;
  min-height: 40px;
  border-radius: 11px;
  border: 2px solid var(--ink);
  background: #fff8e2;
  color: var(--ink);
  font-family: 'Fredoka', sans-serif;
  cursor: pointer;
  box-shadow: 0 2px 0 rgba(74, 44, 23, 0.3);
}

.prep-bench-chip:hover {
  transform: translateY(-1px);
  background: #ffeeb3;
}

.bench-swap-glyph {
  font-size: 0.8rem;
  font-weight: 900;
  color: #9e5f0d;
}

.prep-bench-chip img {
  width: 24px;
  height: 24px;
  object-fit: contain;
}

.bench-chip-copy {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  line-height: 1.08;
}

.bench-chip-copy strong {
  font-size: 0.74rem;
}

.bench-chip-copy small {
  font-size: 0.6rem;
  color: var(--ink-soft);
}

.prep-armory-btn {
  padding: 6px 11px;
  font-size: 0.78rem;
  font-weight: 800;
  min-height: 36px;
}

.prep-go-btn {
  padding: 6px 14px;
  font-size: 0.84rem;
  font-weight: 900;
  min-height: 36px;
}

/* Phones: calm single-row top bar, crisp hero cards, roomy 5-col actions & clear prep swap */
@media (max-width: 767px) {
  .mr-top-banner {
    flex: 1;
    min-width: 0;
    padding: 5px 9px;
    gap: 6px;
  }

  .mr-hero-card {
    padding: 4px 5px;
    gap: 4px;
  }

  .mr-hp-bar {
    display: none;
  }

  .mr-hp-txt {
    font-size: 0.66rem;
    font-weight: 900;
    color: var(--ink);
  }

  .mr-act-btn {
    min-height: 50px;
    padding: 5px 2px;
  }

  .deck-end-pill {
    padding: 4px 9px;
    min-height: 32px;
    font-size: 0.72rem;
  }

  .deck-prep {
    gap: 6px;
    padding: 8px 9px;
  }

  .prep-top-left strong {
    font-size: 0.78rem;
  }

  .prep-slots-grid {
    gap: 4px;
  }

  .prep-slot-btn {
    flex-direction: column;
    justify-content: center;
    align-items: center;
    gap: 2px;
    padding: 5px 3px 4px;
    min-height: 54px;
    text-align: center;
  }

  .prep-slot-btn img {
    width: 24px;
    height: 24px;
  }

  .prep-slot-copy strong {
    font-size: 0.66rem;
  }

  .prep-slot-copy small {
    font-size: 0.56rem;
  }

  .prep-bench-row {
    flex-wrap: nowrap;
    overflow-x: auto;
    scrollbar-width: none;
    -webkit-overflow-scrolling: touch;
  }

  .prep-bench-row::-webkit-scrollbar {
    display: none;
  }

  .prep-bench-row > * {
    flex-shrink: 0;
  }

  /* Dock Turn-1 coach tips cleanly above bottom HUD + Co-Op P1/P2 chips on phones */
  .coach-note {
    top: auto;
    bottom: calc(188px + var(--safe-bottom, 0px));
    padding: 6px 8px 6px 12px;
    gap: 6px;
    max-width: calc(100vw - 16px);
  }

  .coop-active-pill {
    padding: 2px 7px;
    font-size: 0.68rem;
  }

  .mobile-objective-inline {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }

  .coach-copy strong {
    font-size: 0.74rem;
  }

  .coach-copy small {
    font-size: 0.66rem;
    line-height: 1.22;
    white-space: normal;
  }

  .boss-telegraph-strip {
    top: calc(54px + var(--safe-top));
  }
}

.end-confirm-banner {
  border-color: #b23a2a;
  align-self: center;
}
.end-confirm-banner .auto-copy span {
  font-weight: 700;
}

.board-hint {
  position: fixed;
  left: 50%;
  bottom: calc(232px + var(--safe-bottom, 0px));
  transform: translateX(-50%);
  z-index: 31;
  max-width: min(360px, calc(100vw - 32px));
  padding: 7px 14px;
  border-radius: 14px;
  border: 2px solid var(--ink);
  background: #fff6d8;
  color: var(--ink);
  font-family: 'Fredoka', sans-serif;
  font-size: 0.82rem;
  font-weight: 600;
  text-align: center;
  box-shadow: 0 3px 0 rgba(60, 40, 20, 0.35);
  pointer-events: none;
}
.farmer-recap {
  position: fixed;
  left: 50%;
  top: calc(118px + var(--safe-top, 0px));
  transform: translateX(-50%);
  z-index: 31;
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 200px;
  max-width: min(340px, calc(100vw - 32px));
  padding: 8px 14px;
  border-radius: 14px;
  border: 2px solid var(--ink);
  background: #fff6d8;
  color: var(--ink);
  font-family: 'Fredoka', sans-serif;
  font-size: 0.84rem;
  font-weight: 600;
  text-align: left;
  box-shadow: 0 3px 0 rgba(60, 40, 20, 0.35);
  cursor: pointer;
}
.farmer-recap strong {
  font-size: 0.72rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: #8f1d10;
}
.farmer-recap .ko {
  color: #8f1d10;
}
.farmer-recap .arrive {
  color: #6b4700;
}
.farmer-recap small {
  font-size: 0.66rem;
  font-weight: 500;
  opacity: 0.7;
}
.hint-pop-enter-active,
.hint-pop-leave-active {
  transition: opacity 0.18s ease, transform 0.18s ease;
}
.hint-pop-enter-from,
.hint-pop-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(6px);
}
@media (min-width: 768px) {
  .board-hint {
    bottom: calc(120px + var(--safe-bottom, 0px));
  }
}

/* Local Co-Op Pills, Handoff Banner & Hero Owner Chips */
.coop-active-pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 10px;
  border-radius: 999px;
  border: 2px solid var(--ink);
  color: #fffef6;
  font-family: 'Fredoka', sans-serif;
  font-size: 0.76rem;
  font-weight: 800;
  text-shadow: 0 1px 0 rgba(0, 0, 0, 0.35);
  box-shadow: 0 2px 0 rgba(62, 46, 28, 0.35);
  cursor: pointer;
  white-space: nowrap;
}
.coop-active-pill.free-order {
  border-style: dashed;
}
.coop-combo-pill {
  background: #fff2be;
  color: #7a3e00;
  border: 2px solid #b46c14;
  font-weight: 800;
  font-size: 0.74rem;
  padding: 3px 9px;
  white-space: nowrap;
}
.mr-coop-chip {
  position: absolute;
  top: -6px;
  right: -4px;
  z-index: 4;
  padding: 1px 5px;
  border-radius: 999px;
  border: 1.6px solid var(--ink);
  color: #fffdf5;
  font-family: 'Fredoka', sans-serif;
  font-size: 0.62rem;
  font-weight: 800;
  line-height: 1.15;
  box-shadow: 0 1.5px 0 rgba(50, 34, 18, 0.35);
  pointer-events: none;
}
.coop-handoff-backdrop {
  position: fixed;
  inset: 0;
  z-index: 75;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 18px;
  background: rgba(34, 24, 14, 0.56);
  backdrop-filter: blur(3px);
}
.coop-handoff-card {
  position: relative;
  width: min(410px, 94vw);
  padding: 24px 22px 20px;
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  background: linear-gradient(180deg, #fffdf4 0%, #f5ebd2 100%);
  animation: coopPopIn 0.24s cubic-bezier(0.22, 1.35, 0.36, 1);
}
@keyframes coopPopIn {
  from {
    opacity: 0;
    transform: scale(0.88) translateY(10px);
  }
  to {
    opacity: 1;
    transform: scale(1) translateY(0);
  }
}
.coop-handoff-crest {
  width: 62px;
  height: 62px;
  border-radius: 50%;
  border: 3px solid var(--ink);
  color: #fffef8;
  display: grid;
  place-items: center;
  font-family: 'Fredoka', sans-serif;
  font-size: 1.4rem;
  font-weight: 800;
  box-shadow: 0 4px 0 rgba(55, 36, 18, 0.32);
}
.coop-handoff-kicker {
  font-size: 0.72rem;
  font-weight: 800;
  letter-spacing: 0.08em;
  color: #7d5b34;
}
.coop-handoff-card h2 {
  margin: 0;
  font-family: 'Fredoka', sans-serif;
  font-size: 1.5rem;
  color: var(--ink);
}
.coop-handoff-portraits {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 8px;
  margin: 2px 0 4px;
}
.coop-portrait-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px 4px 5px;
  border-radius: 999px;
  background: #fffdf4;
  border: 2.5px solid #4e351e;
  box-shadow: 0 2px 0 rgba(58, 35, 16, 0.16);
  font-size: 0.84rem;
  color: #3c2614;
}
.coop-portrait-chip img {
  width: 30px;
  height: 30px;
  object-fit: contain;
  border-radius: 50%;
  background: #f5ebd2;
}
.handoff-kbd {
  display: inline-block;
  margin-left: 6px;
  padding: 1px 6px;
  border-radius: 6px;
  font-size: 0.72rem;
  font-family: inherit;
  background: rgba(255, 255, 255, 0.24);
  border: 1px solid rgba(255, 255, 255, 0.45);
  vertical-align: middle;
}
.prep-arena-pill {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: 999px;
  background: #f3e4c4;
  border: 1.5px solid #967247;
  font-size: 0.7rem;
  font-weight: 800;
  color: #54371c;
  white-space: nowrap;
}
.coop-handoff-tip {
  margin: 0;
  padding: 7px 12px;
  border-radius: 12px;
  background: #fff4cc;
  border: 1.5px dashed #b98524;
  font-size: 0.78rem;
  color: #634106;
  line-height: 1.35;
}
.coop-handoff-actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
  margin-top: 4px;
}
.coop-handoff-go {
  width: 100%;
  padding: 12px 16px;
  font-size: 1rem;
  justify-content: center;
}
.coop-handoff-free {
  width: 100%;
  padding: 8px 12px;
  font-size: 0.78rem;
  justify-content: center;
}
.mr-hero-card.low-hp:not(.ko) {
  border-color: #d93829 !important;
  animation: lowHpPulse 1.5s ease-in-out infinite;
}
@keyframes lowHpPulse {
  0%, 100% {
    box-shadow: 0 3px 0 #7a1c14, 0 0 0 0 rgba(217, 56, 41, 0.35);
  }
  50% {
    box-shadow: 0 3px 0 #7a1c14, 0 0 0 5px rgba(217, 56, 41, 0.22);
  }
}
</style>
