<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, toRaw, watch } from 'vue';
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
  hasRelic,
} from '../engine/hooks';
import { computeDashOptions, computeTeamJumpOptions } from '../engine/pathfinding';
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
  endPlayerTurn,
  executePreviewOption,
  finalizeBattleAndProceed,
  gameStore,
  getAttackTargetsForSelected,
  getPreviewActionOptions,
  handleBattleTileTap,
  handleOffBoardTap,
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
  toggleEnemySpeed,
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
const COACH_TIPS = [
  {
    title: '1/3 · High Ground, Bridges & Hazards',
    body: 'Climb ramps onto cliffs for +2 DMG High Ground & cover bypass! Knock farmers into Water (-3), Lava (-4 + Burn), or off cliffs (-2)!',
  },
  {
    title: '2/3 · Move, Dash & Team-Jump',
    body: 'Dash orange foes mid-move (twice with Multi-Dash!), Team-Jump gold tiles over allies, or hold ground with Hero Sight Overwatch (O)!',
  },
  {
    title: '3/3 · Aim Cam & Target Cycling',
    body: 'Tap Weapon (or press F) for Over-the-Shoulder Aim Cam — cycle targets with ◀ / ▶ (or A/D) and hit FIRE! Right-drag or Q/E orbits 3D.',
  },
] as const;

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
const inspectedNote = ref<{ title: string; desc: string } | null>(null);
const zoomPercent = ref(100);
const cameraMode = ref<CameraMode3D>('tactical');
const focusAnchor = ref<ScreenAnchor | null>(null);
const phaseBanner = ref<PhaseBannerOverlay | null>(null);
const endConfirmPending = ref(false);
const coachStep = ref<number>(loadCoachStep());
const webglFallbackNotice = ref(false);
let endConfirmTimer: ReturnType<typeof setTimeout> | null = null;

function advanceCoach(): void {
  if (coachStep.value < COACH_TIPS.length - 1) {
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
  visualKind: string;
  alive: boolean;
  hp: number;
  maxHp: number;
  isBoss?: boolean;
}): string {
  // Zero-404 guard: seed_cart is rendered procedurally in 3D and as an emoji badge in HUD.
  if (u.visualKind === 'seed_cart') return '/sprites/potato.png';
  const isBossEnraged = Boolean(u.isBoss && (battle.value.bossPhase ?? 1) >= 2);
  const variant = isBossEnraged ? 'enraged' : isLowHpUnit(u) ? 'lowhp' : 'base';
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
      (focusedTile.value.bridgeHp ?? 0) > 0 &&
      gameStore.mode === 'attack'
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

const worldForecastStyle = computed(() => {
  if (!focusAnchor.value) return {};
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1200;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
  const cx = Math.max(134, Math.min(vw - 134, focusAnchor.value.x));
  const cy = Math.max(96, Math.min(vh - 210, focusAnchor.value.y - 16));
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
  shield: { short: 'Shld', title: 'Shield', desc: 'Braced — takes 2 less damage from incoming attacks.' },
  boosted: { short: 'Bst', title: 'Boosted', desc: 'Fired up — deals +2 Attack and +2 Dash damage.' },
  overwatch: {
    short: 'Watch',
    title: 'Hero Sight',
    desc: 'Overwatch — automatically fires a reaction shot when an enemy moves into weapon range!',
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
  if (readyHeroesCount.value > 0 && !endConfirmPending.value) {
    endConfirmPending.value = true;
    if (endConfirmTimer !== null) clearTimeout(endConfirmTimer);
    endConfirmTimer = setTimeout(() => {
      endConfirmPending.value = false;
      endConfirmTimer = null;
    }, 2800);
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

const readyHeroesCount = computed(
  () => playerUnits.value.filter((u) => u.alive && !heroDoneMap.value[u.id]).length
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

const remainingDashesForSelected = computed(() => {
  const u = selectedUnit.value;
  if (!u) return 0;
  const used = u.actions.dashesUsed ?? (u.actions.hasDashed ? 1 : 0);
  return Math.max(0, getMaxDashesForUnit(u) - used);
});

const overwatchChargesForSelected = computed(() =>
  selectedUnit.value ? getMaxOverwatchCharges(selectedUnit.value) : 1
);

function handleTriggerOverwatch(): void {
  showItemsMenu.value = false;
  clearEndConfirm();
  triggerOverwatch();
}

function onKeyDown(e: KeyboardEvent): void {
  if (gameStore.enemyTurnRunning || battle.value.status !== 'ongoing') return;

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
    const curIdx = alive.findIndex((u) => u.id === gameStore.selectedUnitId);
    const next = alive[(curIdx + 1) % alive.length];
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
  } else if (lower === 'm' && selectedUnit.value) {
    setInteractionMode('move');
  } else if (lower === 'z' && battle.value.undoSnapshot) {
    triggerUndoMove();
  } else if ((e.key === 'Enter' || e.key === ' ') && previewOptions.value.length > 0) {
    e.preventDefault();
    executePreviewOption(previewOptions.value[0].kind);
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

onBeforeUnmount(() => {
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
      class="world-forecast-pill"
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
                : 'FARMER TURN'
          }}
        </span>
        <div class="status-copy">
          <strong>{{ battle.mapName }}</strong>
          <small v-if="battle.objective === 'survive'">
            🛡️ Hold Turn {{ Math.min(battle.turn, battle.surviveTurns ?? 4) }}/{{ battle.surviveTurns ?? 4 }} · {{ aliveEnemiesCount }} foes
          </small>
          <small v-else-if="battle.objective === 'escort' && escortCart">
            🛒 Seed Cart {{ escortCart.hp }}/{{ escortCart.maxHp }} HP · {{ aliveEnemiesCount }} foes
          </small>
          <small v-else>{{ battle.objectiveLabel }} · {{ aliveEnemiesCount }} foes left</small>
        </div>
        <span v-if="(battle.harvestHeat ?? 0) > 0" class="cam-mode-pill heat">
          🔥 H{{ battle.harvestHeat }}
        </span>
        <span v-if="is3D && cameraMode === 'aim'" class="cam-mode-pill aim">AIM CAM</span>
        <span v-else-if="is3D && cameraMode === 'tacticam'" class="cam-mode-pill tacticam">TACTICAM</span>
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

        <!-- 3D Mario + Rabbids Camera Cluster -->
        <div v-if="is3D" class="cam-cluster kraft-ribbon">
          <button
            class="cam-btn"
            :class="{ active: cameraMode === 'tacticam' }"
            title="Toggle Tacticam Bird's-Eye View (T)"
            @click="handleToggleTacticam"
          >
            <CraftIcon :name="cameraMode === 'tacticam' ? 'iso' : 'topdown'" :size="15" />
            <span class="desktop-only">Tacticam</span>
          </button>
          <button
            class="cam-btn desktop-only"
            title="Orbit Left (Q)"
            aria-label="Rotate camera left"
            @click="rotate3DCamera(-1)"
          >
            ⟲
          </button>
          <button
            class="cam-btn desktop-only"
            title="Orbit Right (E)"
            aria-label="Rotate camera right"
            @click="rotate3DCamera(1)"
          >
            ⟳
          </button>
          <button
            class="cam-btn desktop-only"
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

        <!-- 1x / 2x Enemy Phase Speed Toggle -->
        <button
          class="paper-btn tool-btn speed-btn"
          :class="{ 'speed-fast': gameStore.enemySpeedFast }"
          :aria-label="gameStore.enemySpeedFast ? 'Enemy speed 2x (Fast)' : 'Enemy speed 1x (Normal)'"
          title="Toggle Farmer Phase Speed (1× / 2×)"
          @click="toggleEnemySpeed"
        >
          <span>{{ gameStore.enemySpeedFast ? '2×' : '1×' }}</span>
        </button>

        <!-- Global Enemy Danger Zone Toggle -->
        <button
          class="paper-btn tool-btn"
          :class="{ 'danger-on': gameStore.showAllDangerZone }"
          aria-label="Toggle all enemy danger zones"
          title="Show/Hide All Enemy Danger Zones"
          @click="toggleAllDangerZone"
        >
          <CraftIcon name="warning" :size="16" />
        </button>

        <button
          class="paper-btn tool-btn"
          :class="{ 'undo-ready': Boolean(battle.undoSnapshot) }"
          :disabled="battle.prepPhase || !battle.undoSnapshot || battle.phase !== 'player' || gameStore.enemyTurnRunning"
          aria-label="Undo last move (Z)"
          title="Undo last move (Z)"
          @click="triggerUndoMove"
        >
          <CraftIcon name="undo" :size="16" />
        </button>

        <button
          class="paper-btn tool-btn"
          aria-label="Field Notebook Menu"
          title="Field Notebook & Settings"
          @click="showUtilityMenu = !showUtilityMenu"
        >
          <CraftIcon name="menu" :size="16" />
        </button>
      </div>
    </header>

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
      v-if="!battle.prepPhase && coachStep >= 0 && battle.phase === 'player' && battle.status === 'ongoing'"
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
                focusedCover.isObjectiveCage
                  ? 'Burlap Rescue Cage'
                  : focusedCover.kind === 'pumpkin'
                    ? 'Rolling Pumpkin'
                    : focusedCover.kind.toUpperCase()
              }}
            </strong>
            <span class="paper-pill mini-fam">{{ focusedCover.level }}</span>
          </div>
          <small v-if="focusedCover.isObjectiveCage">
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

      <div class="paper-card desktop-log">
        <div v-for="(line, i) in battle.combatLog.slice(-2)" :key="i" class="log-line">{{ line }}</div>
      </div>
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
            <li><strong>Camera:</strong> Right-drag (or <strong>Q / E</strong>) orbits 3D view · Left-drag pans · Scroll zooms · <strong>T</strong> toggles Tacticam · <strong>R</strong> resets.</li>
            <li><strong>Tactics:</strong> <strong>🍄 Mushrooms</strong> launch 3 tiles/+2 elev · <strong>🎃 Pumpkins</strong> bowl 5 tiles for 4 DMG · <strong>🪵 Bridges</strong> collapse when shot · Adjacent allies deal <strong>+1 Assist DMG</strong>!</li>
            <li><strong>Strong (+30%):</strong> Roots &gt; Sprayers · Vines &gt; Diggers · Fruits &gt; Blades.</li>
          </ul>
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
    <footer v-if="battle.status === 'ongoing'" class="mr-bottom-hud">
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

      <div class="mr-hud-row">
        <!-- Bottom-Left Mario + Rabbids Slanted Squad Portrait Cards -->
        <div class="mr-squad-rail">
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
            <div class="mr-portrait-box">
              <img class="mr-portrait-img" :src="unitPortraitSrc(u)" :alt="u.name" />
              <span v-if="u.alive && (u.level ?? 1) > 1" class="mr-lvl-chip">L{{ u.level }}</span>
              <span v-if="u.alive && u.statuses.some((s) => s.kind === 'overwatch')" class="mr-watch-seal" title="Hero Sight Overwatch Active">
                👁
              </span>
              <span v-else-if="u.alive && isHeroDone(u.id)" class="mr-done-seal">
                <CraftIcon name="check" :size="11" />
              </span>
            </div>
            <div class="mr-hero-meta">
              <div class="mr-hero-name-row">
                <strong>{{ u.name.split(' ')[0] }}</strong>
                <span class="mr-hp-txt">{{ u.hp }}/{{ u.maxHp }}</span>
              </div>
              <div class="mr-hp-bar">
                <div
                  class="mr-hp-fill"
                  :style="{
                    width: `${Math.max(0, Math.min(100, (u.hp / Math.max(1, u.maxHp)) * 100))}%`,
                    backgroundColor: hpColor(u.hp, u.maxHp),
                  }"
                ></div>
              </div>
              <!-- Mario + Rabbids 3 Action Pips: Move / Weapon / Technique -->
              <div class="mr-action-pips" title="Move · Weapon · Technique">
                <span
                  class="mr-pip move"
                  :class="{ spent: !u.alive || u.actions.hasMoved }"
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
        <div class="mr-command-wrap">
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

          <!-- Mobile 1-line Last-Action Ticker -->
          <button
            v-if="latestLogLine && !showItemsMenu && !isCombatPreview && !isMovePreview && !isSkillOrItemMode && !inspectedEnemy"
            class="mobile-log-ticker mobile-only"
            @click="showUtilityMenu = true"
          >
            {{ latestLogLine }}
          </button>

          <!-- Pre-Battle Tactical Deployment Prep Deck -->
          <div v-if="battle.prepPhase" class="corrugated-slab mr-deck deck-prep">
            <div class="prep-head">
              <div class="prep-title-copy">
                <strong>⚔️ TACTICAL PREP · DEPLOY YOUR SQUAD</strong>
                <small>
                  Tap a hero &amp; any glowing green spawn tile to swap positions before Turn 1!
                </small>
              </div>
              <span v-if="selectedUnit" class="prep-selected-pill">
                Selected: {{ selectedUnit.name.split(' ')[0] }} ({{ selectedUnit.weapon.name }})
              </span>
            </div>

            <div v-if="prepBenchHeroes.length > 0" class="prep-bench-row">
              <span class="prep-bench-label">Bench Swap:</span>
              <button
                v-for="bh in prepBenchHeroes"
                :key="bh.uid"
                class="prep-bench-chip"
                :title="`Swap ${selectedUnit?.name ?? 'selected hero'} with ${bh.name} (Lv.${bh.level})`"
                @click="swapPrepBenchHero(bh.uid)"
              >
                <img :src="`/sprites/${bh.species}.png`" :alt="bh.name" />
                <span>{{ bh.name.split(' ')[0] }} L{{ bh.level }}</span>
              </button>
            </div>

            <div class="prep-actions">
              <button
                v-if="gameStore.run"
                class="paper-btn gold prep-armory-btn"
                title="Swap Alternate Weapons & spend Skill Points before battle"
                @click="showPrepArmory = true"
              >
                <span>⚔️ Armory &amp; Perks</span>
              </button>
              <button
                class="paper-btn primary prep-go-btn"
                title="Lock formation and start Turn 1 (Enter)"
                @click="confirmPrepPhase"
              >
                <span>Start Battle! →</span>
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
                      {{ activeAbilityBanner.targetHint }} · CD {{ activeAbilityBanner.cooldown }}t
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
                <div v-else class="target-prompt-pill">Click a highlighted 3D tile</div>
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
                        {{ inspectedEnemyMatchup === 'advantage' ? `▲ You ${advantagePctLabel}` : '▼ You -20%' }}
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
                <button class="hero-id-btn" title="Hero details" @click="inspectSelectedHeroSummary">
                  <strong>{{ selectedUnit.name }}</strong>
                  <span class="lvl-tag">Lv.{{ selectedUnit.level ?? 1 }}</span>
                  <span class="family-tag">{{ getFamilyLabel(selectedUnit.family) }}</span>
                  <span class="weapon-mini desktop-only">
                    {{ selectedUnit.weapon.name }} · {{ selectedUnit.weapon.damage }} DMG · R{{ selectedUnit.weapon.minRange }}-{{ selectedUnit.weapon.maxRange }}
                  </span>
                </button>

                <div class="slot-pills">
                  <button
                    v-if="battle.undoSnapshot && battle.phase === 'player' && !gameStore.enemyTurnRunning"
                    class="undo-thumb-chip"
                    title="Undo Move (Z)"
                    @click="triggerUndoMove"
                  >
                    <CraftIcon name="undo" :size="11" />
                    <span>Undo</span>
                  </button>
                  <button
                    v-for="st in selectedUnit.statuses.slice(0, 2)"
                    :key="st.kind"
                    class="status-chip"
                    :class="st.kind"
                    @click.stop="inspectStatus(st.kind, st.turns)"
                  >
                    {{ STATUS_META[st.kind]?.short }} {{ st.turns }}t
                  </button>
                  <button
                    v-if="selectedUnit.coopPassive"
                    class="coop-pin"
                    title="Barnyard Co-op Trait"
                    @click="inspectCoop(selectedUnit.name, selectedUnit.coopPassive)"
                  >
                    ★ Co-op
                  </button>
                  <button
                    v-for="gid in selectedUnit.graftIds"
                    :key="gid"
                    class="graft-pin"
                    @click="inspectGraft(gid)"
                  >
                    {{ GRAFT_REGISTRY[gid]?.badgeIcon }}
                  </button>
                </div>
              </div>

              <!-- 6 Mario + Rabbids Action Buttons: Move / Weapon / Hero Sight Watch / Skill / Bag / End -->
              <div class="mr-action-bar six-col">
                <button
                  class="paper-btn sky mr-act-btn"
                  :class="{ 'is-active': gameStore.mode === 'move' && !selectedUnit.actions.hasMoved }"
                  :disabled="selectedUnit.actions.hasMoved && dashHintCount === 0 && jumpHintCount === 0"
                  title="Move, Dash enemies, or Team-Jump allies (M)"
                  @click="setInteractionMode('move')"
                >
                  <CraftIcon name="move" :size="15" />
                  <div class="act-copy">
                    <span class="act-title">{{ selectedUnit.actions.hasMoved ? 'Moved' : 'Move' }}</span>
                    <small v-if="dashHintCount > 0 || jumpHintCount > 0" class="act-sub">
                      {{ dashHintCount > 0 ? `⚡${remainingDashesForSelected}` : '' }}
                      {{ jumpHintCount > 0 ? `★${jumpHintCount}` : '' }}
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
                  <span v-if="enemiesInAttackRange > 0" class="tab-badge">{{ enemiesInAttackRange }}</span>
                  <CraftIcon name="attack" :size="15" />
                  <div class="act-copy">
                    <span class="act-title">{{ gameStore.mode === 'attack' ? 'Aiming' : 'Weapon' }}</span>
                    <small class="act-sub desktop-only">{{ selectedUnit.weapon.damage }} DMG</small>
                  </div>
                </button>

                <button
                  class="paper-btn watch-btn mr-act-btn"
                  :class="{
                    'is-active': selectedUnit.statuses.some((s) => s.kind === 'overwatch'),
                  }"
                  :disabled="selectedUnit.actions.hasAttacked || battle.phase !== 'player' || gameStore.enemyTurnRunning"
                  :title="`Hero Sight Overwatch (O) — Intercepts moving foes with ${overwatchChargesForSelected} reaction shot(s)`"
                  @mouseenter="setPreviewOverwatch(true)"
                  @mouseleave="setPreviewOverwatch(false)"
                  @focus="setPreviewOverwatch(true)"
                  @blur="setPreviewOverwatch(false)"
                  @click="handleTriggerOverwatch"
                >
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
                  title="Garden Satchel (shares Skill slot)"
                  @click="showItemsMenu = !showItemsMenu"
                >
                  <CraftIcon name="bag" :size="15" />
                  <div class="act-copy">
                    <span class="act-title">Bag</span>
                    <small class="act-sub">×{{ totalItemsLeft }}</small>
                  </div>
                </button>

                <button
                  class="paper-btn mr-act-btn end-btn"
                  :class="{
                    primary: readyHeroesCount === 0 && !endConfirmPending,
                    danger: endConfirmPending,
                  }"
                  :disabled="battle.phase !== 'player' || gameStore.enemyTurnRunning || battle.status !== 'ongoing'"
                  @click="requestEndTurn"
                >
                  <CraftIcon name="end_turn" :size="15" />
                  <div class="act-copy">
                    <span class="act-title">
                      {{ endConfirmPending ? 'End?' : readyHeroesCount === 0 ? 'End!' : 'End' }}
                    </span>
                    <small v-if="readyHeroesCount > 0 && !endConfirmPending" class="act-sub desktop-only">
                      {{ readyHeroesCount }} left
                    </small>
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
          <span class="paper-pill">Turns: {{ battle.turn }}</span>
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

.wf-card {
  min-width: 224px;
  max-width: 276px;
  padding: 8px 11px;
  background:
    linear-gradient(180deg, rgba(255, 253, 246, 0.96) 0%, rgba(245, 234, 210, 0.96) 100%);
  border: 2.5px solid var(--ink);
  border-radius: 13px;
  transform: skewX(-4deg);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.92),
    0 4px 0 var(--ink),
    0 12px 24px rgba(28, 12, 4, 0.36);
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
  max-width: min(460px, 60vw);
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

.desktop-log {
  width: 100%;
  padding: 7px 10px;
  font-size: 0.73rem;
  color: var(--ink-soft);
  line-height: 1.3;
}

.log-line + .log-line {
  margin-top: 3px;
  padding-top: 3px;
  border-top: 1px dashed rgba(74, 44, 23, 0.2);
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
  width: 144px;
  padding: 6px 9px 6px 7px;
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
  width: 38px;
  height: 38px;
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
  width: 34px;
  height: 34px;
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
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.mr-hero-name-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 3px;
}

.mr-hero-name-row strong {
  font-family: 'Fredoka', sans-serif;
  font-size: 0.76rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.mr-hp-txt {
  font-size: 0.65rem;
  font-weight: 800;
  color: var(--ink-soft);
}

.mr-hp-bar {
  width: 100%;
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

/* Bottom-Center Mario + Rabbids Command Deck */
.mr-command-wrap {
  pointer-events: auto;
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 6px;
  flex: 1;
  max-width: 560px;
}

.mr-deck {
  width: 100%;
  padding: 8px 10px 9px;
  display: flex;
  flex-direction: column;
  gap: 7px;
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

/* 5-Button Mario + Rabbids Action Row */
.mr-action-bar {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 6px;
}

.mr-act-btn {
  padding: 6px 7px;
  min-height: 44px;
  transform: skewX(-4deg);
  justify-content: center;
  gap: 5px;
}

.mr-act-btn > * {
  transform: skewX(4deg);
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

  .status-copy strong {
    font-size: 0.8rem;
  }

  .status-copy small {
    font-size: 0.68rem;
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

.prep-bench-chip:hover {
  transform: translateY(-1px);
  background: #fff3c4;
}

.prep-bench-chip img {
  width: 22px;
  height: 22px;
  object-fit: contain;
}

.prep-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
}

.prep-armory-btn {
  padding: 8px 14px;
  font-size: 0.82rem;
  font-weight: 800;
}

.prep-go-btn {
  padding: 8px 20px;
  font-size: 0.92rem;
  font-weight: 900;
}
</style>
