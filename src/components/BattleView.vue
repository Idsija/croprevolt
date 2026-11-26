<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { GRAFT_REGISTRY } from '../data/grafts';
import { ITEM_REGISTRY } from '../data/items';
import { RELIC_REGISTRY } from '../data/relics';
import {
  forecastAttack,
  getAttackableTiles,
  getWeaponRangeTiles,
  unitHasMeaningfulAction,
} from '../engine/combat';
import { getAdjacentCoverBadges, posKey, tileAt, unitAt } from '../engine/grid';
import { getFamilyLabel, getMatchup } from '../engine/hooks';
import { computeDashOptions, computeTeamJumpOptions } from '../engine/pathfinding';
import { type InteractionMode, PaperCraftRenderer } from '../renderer/canvas';
import {
  cancelPreviewAction,
  clearAutoEndTimer,
  clearFocusOnTabAway,
  deselectAll,
  endPlayerTurn,
  executePreviewOption,
  finalizeBattleAndProceed,
  gameStore,
  getPreviewActionOptions,
  handleBattleTileTap,
  handleOffBoardTap,
  type PreviewActionOption,
  returnToTitle,
  selectBattleUnit,
  setHoveredTile,
  setInteractionMode,
  subscribeBattleEvents,
  subscribeCameraFocus,
  toggleAllDangerZone,
  toggleAudioMute,
  toggleAutoEndTurn,
  toggleBoardViewMode,
  toggleInspectEnemy,
  triggerUndoMove,
} from '../stores/gameStore';
import CraftIcon, { type CraftIconName } from './CraftIcon.vue';

const canvasRef = ref<HTMLCanvasElement | null>(null);
const showItemsMenu = ref(false);
const showUtilityMenu = ref(false);
const inspectedNote = ref<{ title: string; desc: string } | null>(null);
const zoomPercent = ref(100);

let renderer: PaperCraftRenderer | null = null;
let unsubscribeEvents: (() => void) | null = null;
let unsubscribeFocus: (() => void) | null = null;

const battle = computed(() => gameStore.battle!);
const playerUnits = computed(() => battle.value.units.filter((u) => u.team === 'player'));
const aliveEnemiesCount = computed(
  () => battle.value.units.filter((u) => u.team === 'enemy' && u.alive).length
);

const selectedUnit = computed(
  () => battle.value.units.find((u) => u.id === gameStore.selectedUnitId && u.alive) ?? null
);

const inspectedEnemy = computed(() =>
  gameStore.inspectedEnemyId
    ? battle.value.units.find(
        (u) => u.id === gameStore.inspectedEnemyId && u.alive && u.team === 'enemy'
      ) ?? null
    : null
);

const activeFocusTile = computed(() => gameStore.previewTile ?? gameStore.hoveredTile);

const focusedUnit = computed(() =>
  activeFocusTile.value ? unitAt(battle.value, activeFocusTile.value) ?? null : null
);

const focusedCover = computed(() =>
  activeFocusTile.value ? tileAt(battle.value, activeFocusTile.value)?.cover ?? null : null
);

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

/**
 * Live Move / Team-Jump destination preview readout:
 * Shows what cover protection you'll gain there AND how many enemies fall in weapon range!
 */
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

  return {
    isJump,
    bestCover,
    projectedFoes,
  };
});

/**
 * Unified Combat Forecast: activates in BOTH unified Move mode AND Attack mode
 * whenever hovering/tapping an enemy or destructible cover within weapon reach!
 */
const activeForecast = computed(() => {
  if (
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
  if (
    !targetIsEnemy &&
    !targetIsDestructibleCover &&
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
  if (!selectedUnit.value || !focusedUnit.value || focusedUnit.value.team !== 'enemy') return null;
  const dash = computeDashOptions(battle.value, selectedUnit.value).find(
    (d) => d.enemyId === focusedUnit.value!.id
  );
  return dash ? dash.damage : null;
});

const inspectedEnemyMatchup = computed(() => {
  if (!selectedUnit.value || !inspectedEnemy.value) return 'neutral';
  return getMatchup(selectedUnit.value.family, inspectedEnemy.value.family);
});

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

const readyHeroesCount = computed(
  () => playerUnits.value.filter((u) => unitHasMeaningfulAction(battle.value, u)).length
);

const totalItemsLeft = computed(() =>
  Object.values(battle.value.items).reduce((acc, n) => acc + n, 0)
);

const showBottomConsoleDeck = computed(() =>
  Boolean(selectedUnit.value || inspectedEnemy.value)
);

function isHeroDone(unitId: string): boolean {
  const u = battle.value.units.find((x) => x.id === unitId);
  if (!u || !u.alive) return true;
  return !unitHasMeaningfulAction(battle.value, u);
}

function hpRingOffset(hp: number, maxHp: number): number {
  const circumference = 2 * Math.PI * 21;
  const ratio = Math.max(0, Math.min(1, hp / Math.max(1, maxHp)));
  return circumference * (1 - ratio);
}

function hpRingColor(hp: number, maxHp: number): string {
  const r = hp / Math.max(1, maxHp);
  if (r > 0.55) return '#5fb845';
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
  if (gameStore.mode === targetMode) {
    setInteractionMode('move');
  } else {
    setInteractionMode(targetMode);
  }
}

function pickItem(itemId: string): void {
  showItemsMenu.value = false;
  setInteractionMode('item', itemId);
}

function recenterBoard(): void {
  renderer?.resetCamera();
}

function zoomBoard(delta: number): void {
  renderer?.adjustZoom(delta);
}

function switchBoardView(): void {
  const next = toggleBoardViewMode();
  renderer?.resetCamera(next);
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

function onKeyDown(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    showItemsMenu.value = false;
    showUtilityMenu.value = false;
    inspectedNote.value = null;
    deselectAll(true);
  }
}

onMounted(() => {
  if (!canvasRef.value) return;
  renderer = new PaperCraftRenderer(
    canvasRef.value,
    () => {
      if (!gameStore.battle) return null;
      return {
        battle: gameStore.battle,
        selectedUnitId: gameStore.selectedUnitId,
        inspectedEnemyId: gameStore.inspectedEnemyId,
        showAllDangerZone: gameStore.showAllDangerZone,
        mode: gameStore.mode,
        selectedItemId: gameStore.selectedItemId,
        hoveredTile: gameStore.hoveredTile,
        previewTile: gameStore.previewTile,
        viewMode: gameStore.viewMode,
      };
    },
    (pos) => setHoveredTile(pos),
    (pos, pointerType) => {
      showItemsMenu.value = false;
      showUtilityMenu.value = false;
      inspectedNote.value = null;
      handleBattleTileTap(pos, pointerType);
    },
    () => {
      showItemsMenu.value = false;
      showUtilityMenu.value = false;
      inspectedNote.value = null;
      handleOffBoardTap();
    },
    (pct) => {
      zoomPercent.value = pct;
    }
  );
  unsubscribeEvents = subscribeBattleEvents((events) => {
    renderer?.consumeEvents(events);
  });
  unsubscribeFocus = subscribeCameraFocus((pos) => {
    renderer?.focusOnGrid(pos);
  });

  window.addEventListener('blur', handleTabAwayFocusClear);
  document.addEventListener('visibilitychange', onVisibilityChange);
  window.addEventListener('keydown', onKeyDown);
});

onBeforeUnmount(() => {
  unsubscribeEvents?.();
  unsubscribeFocus?.();
  clearAutoEndTimer();
  renderer?.destroy();
  window.removeEventListener('blur', handleTabAwayFocusClear);
  document.removeEventListener('visibilitychange', onVisibilityChange);
  window.removeEventListener('keydown', onKeyDown);
});
</script>

<template>
  <div class="battle-shell">
    <!-- Full-Bleed Vertical-First Paper-Craft Diorama Canvas -->
    <canvas ref="canvasRef" class="battle-canvas"></canvas>

    <!-- Single-Row Ultra-Slim Paper-Craft Top Bar (Zero board occlusion on mobile!) -->
    <header class="top-hud">
      <div class="kraft-ribbon top-stamp-bar pinned-card">
        <span class="brass-pin tl"></span>
        <span class="turn-stamp" :class="battle.phase">
          {{ battle.phase === 'player' ? `T${battle.turn}` : 'AI' }}
        </span>
        <div class="status-copy">
          <strong>{{ battle.mapName }}</strong>
          <small>{{ battle.objectiveLabel }} · {{ aliveEnemiesCount }} foes</small>
        </div>
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

        <!-- Compact Iso / 2D Toggle right in top bar on mobile -->
        <button
          class="paper-btn tool-btn mobile-only"
          :aria-label="gameStore.viewMode === 'topdown' ? 'Switch to 2.5D Isometric' : 'Switch to Vertical 2D'"
          :title="gameStore.viewMode === 'topdown' ? '2.5D Iso' : 'Vertical 2D'"
          @click="switchBoardView"
        >
          <CraftIcon :name="gameStore.viewMode === 'topdown' ? 'iso' : 'topdown'" :size="16" />
        </button>

        <button
          class="paper-btn tool-btn"
          :class="{ 'undo-ready': Boolean(battle.undoSnapshot) }"
          :disabled="!battle.undoSnapshot || battle.phase !== 'player' || gameStore.enemyTurnRunning"
          aria-label="Undo last move"
          title="Undo last move"
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

    <!-- Desktop Scale Strip (Hidden on mobile unless pinched/zoomed away from 100%!) -->
    <div class="scale-strip kraft-ribbon desktop-only">
      <button
        class="sc-btn view-tag"
        :title="gameStore.viewMode === 'topdown' ? 'Switch to 2.5D Isometric' : 'Switch to Vertical Tabletop'"
        @click="switchBoardView"
      >
        <CraftIcon :name="gameStore.viewMode === 'topdown' ? 'iso' : 'topdown'" :size="14" />
      </button>
      <span class="sc-div"></span>
      <button class="sc-btn" aria-label="Zoom out" title="Zoom out" @click="zoomBoard(-0.18)">−</button>
      <button
        class="sc-btn sc-pct"
        aria-label="Reset zoom & center"
        title="Reset scale & recenter"
        @click="recenterBoard"
      >
        {{ zoomPercent }}%
      </button>
      <button class="sc-btn" aria-label="Zoom in" title="Zoom in" @click="zoomBoard(0.18)">+</button>
    </div>

    <!-- Mobile Recenter Pill ONLY when user zoomed away from default -->
    <button
      v-if="zoomPercent !== 100"
      class="kraft-ribbon mobile-reset-pill mobile-only"
      aria-label="Reset zoom and center board"
      @click="recenterBoard"
    >
      <CraftIcon name="center" :size="13" />
      <span>{{ zoomPercent }}%</span>
    </button>

    <!-- Tap-to-Inspect Toast (Hero Details, Grafts, Relics & Co-op Passives) -->
    <div v-if="inspectedNote" class="paper-card inspect-toast craft-fold" @click="inspectedNote = null">
      <strong>{{ inspectedNote.title }}</strong>
      <small>{{ inspectedNote.desc }}</small>
    </div>

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

        <div class="quick-toggles">
          <button class="paper-btn" @click="switchBoardView">
            <CraftIcon :name="gameStore.viewMode === 'iso' ? 'topdown' : 'iso'" :size="16" />
            <span>{{ gameStore.viewMode === 'iso' ? 'Vertical 2D' : '2.5D Iso' }}</span>
          </button>
          <button class="paper-btn" @click="toggleAudioMute">
            <CraftIcon :name="gameStore.muted ? 'sound_off' : 'sound_on'" :size="16" />
            <span>{{ gameStore.muted ? 'SFX Off' : 'SFX On' }}</span>
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
            <span>Recenter</span>
          </button>
          <button
            class="paper-btn toggle-wide"
            :class="{ primary: gameStore.autoEndTurnEnabled }"
            @click="toggleAutoEndTurn"
          >
            <CraftIcon name="auto_end" :size="16" />
            <span>Auto End Turn: {{ gameStore.autoEndTurnEnabled ? 'ON' : 'OFF' }}</span>
          </button>
        </div>

        <div class="menu-section">
          <h4>Quick Controls &amp; Matchups</h4>
          <ul class="mini-rules">
            <li><strong>Tap Once to Preview, Tap Again (or Button) to Act:</strong> Preview Move tiles to see cover &amp; live attack range from that tile before moving!</li>
            <li><strong>Direct Combat:</strong> Tap any farmer in range to choose <strong>Dash</strong> or <strong>Attack</strong> directly.</li>
            <li><strong>Danger Zones:</strong> Tap any out-of-range farmer (or <strong>⚠</strong> in top bar) to inspect Move + Attack reach.</li>
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
          <h4>Recent Battle Log</h4>
          <div class="menu-log">
            <div v-for="(line, i) in battle.combatLog.slice(-5)" :key="i">• {{ line }}</div>
          </div>
        </div>

        <button class="paper-btn" @click="returnToTitle">← Save &amp; Return to Title</button>
      </section>
    </div>

    <!-- Desktop-Only Right Side Hover Inspector (Mobile uses Single-Focus Bottom Deck so top rows NEVER get blocked!) -->
    <aside class="forecast-dock desktop-only">
      <div v-if="activeForecast && !isCombatPreview" class="paper-card forecast-card pinned-card">
        <span class="brass-pin tl"></span>
        <div class="fc-left">
          <img
            v-if="focusedUnit"
            class="fc-sprite"
            :src="`/sprites/${focusedUnit.visualKind}.png`"
            :alt="focusedUnit.name"
          />
          <img
            v-else-if="focusedCover"
            class="fc-sprite"
            :src="`/sprites/${focusedCover.kind}.png`"
            :alt="focusedCover.kind"
          />
          <div class="fc-id">
            <strong>{{ focusedUnit ? focusedUnit.name : focusedCover?.kind.toUpperCase() }}</strong>
            <small v-if="focusedUnit">
              {{ focusedUnit.hp }}/{{ focusedUnit.maxHp }} HP · {{ getFamilyLabel(focusedUnit.family) }}
            </small>
            <small v-else-if="focusedCover">
              {{ focusedCover.hp }}/{{ focusedCover.maxHp }} Cover HP
            </small>
          </div>
        </div>

        <div class="fc-mid">
          <span
            class="hit-stamp"
            :class="{
              full: activeForecast.hitChance >= 100,
              half: activeForecast.hitChance > 0 && activeForecast.hitChance < 100,
              zero: activeForecast.hitChance === 0,
            }"
          >
            <CraftIcon
              v-if="activeForecast.coverLevel !== 'none'"
              :name="activeForecast.coverLevel === 'full' ? 'shield_full' : 'shield_half'"
              :size="12"
            />
            <span>{{ activeForecast.hitChance }}%</span>
          </span>

          <span
            v-if="focusedUnit && activeForecast.matchup !== 'neutral'"
            class="match-stamp"
            :class="activeForecast.matchup"
          >
            {{ activeForecast.matchup === 'advantage' ? '+30%' : '-20%' }}
          </span>
        </div>

        <div class="fc-right">
          <strong class="dmg-big">
            {{ activeForecast.canAttack ? `-${activeForecast.finalDamage}` : '0' }}
          </strong>
          <span v-if="activeForecast.isLethal" class="ko-tag">KO!</span>
          <small v-else-if="!activeForecast.canAttack" class="blk-tag">Blocked</small>
        </div>
      </div>

      <div v-else-if="focusedCover && !isCombatPreview && !isMovePreview" class="paper-card inspector-ribbon">
        <img class="fc-sprite" :src="`/sprites/${focusedCover.kind}.png`" :alt="focusedCover.kind" />
        <div class="insp-copy">
          <div class="insp-top">
            <strong>{{ focusedCover.isObjectiveCage ? 'Burlap Rescue Cage' : focusedCover.kind.toUpperCase() }}</strong>
            <span class="paper-pill mini-fam">{{ focusedCover.level }} cover</span>
          </div>
          <small v-if="focusedCover.isObjectiveCage">
            Smash ({{ focusedCover.hp }}/{{ focusedCover.maxHp }} HP) to free a bagged ally!
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

    <!-- Single-Focus Morphing Mobile-First Paper-Craft Bottom Dock -->
    <footer v-if="battle.status === 'ongoing'" class="bottom-console-wrap">
      <div class="bottom-console">
        <!-- Auto-End Turn Grace Strip -->
        <div v-if="gameStore.autoEndPending" class="paper-card auto-end-banner">
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
              <CraftIcon name="undo" :size="13" />
              <span>Undo</span>
            </button>
            <button class="paper-btn mini-act" @click="clearAutoEndTimer">Stay</button>
          </div>
        </div>

        <!-- Circular Die-Cut Paper Hero Medallions -->
        <div class="medallion-dock" :class="{ standalone: !showBottomConsoleDeck }">
          <button
            v-for="u in playerUnits"
            :key="u.id"
            class="hero-medallion"
            :class="{
              selected: u.id === gameStore.selectedUnitId,
              done: u.alive && isHeroDone(u.id),
              ko: !u.alive,
            }"
            :disabled="!u.alive"
            :aria-label="u.id === gameStore.selectedUnitId ? `Deselect ${u.name}` : `Select ${u.name}`"
            @click="selectBattleUnit(u.id)"
          >
            <div class="medallion-disc">
              <svg class="hp-ring" viewBox="0 0 48 48" aria-hidden="true">
                <circle class="ring-track" cx="24" cy="24" r="21" />
                <circle
                  class="ring-fill"
                  cx="24"
                  cy="24"
                  r="21"
                  :stroke="hpRingColor(u.hp, u.maxHp)"
                  :stroke-dasharray="2 * Math.PI * 21"
                  :stroke-dashoffset="hpRingOffset(u.hp, u.maxHp)"
                />
              </svg>
              <img class="med-sprite" :src="`/sprites/${u.visualKind}.png`" :alt="u.name" />

              <span v-if="u.alive && isHeroDone(u.id)" class="done-seal" title="Done">
                <CraftIcon name="check" :size="10" />
              </span>

              <div v-if="u.alive && !isHeroDone(u.id)" class="med-beads">
                <span class="bead move" :class="{ spent: u.actions.hasMoved }"></span>
                <span class="bead atk" :class="{ spent: u.actions.hasAttacked }"></span>
                <span class="bead skl" :class="{ spent: u.actions.hasUsedSkill || u.abilityCooldown > 0 }"></span>
              </div>
            </div>
            <span class="med-label">{{ u.name.split(' ')[0] }}</span>
          </button>

          <!-- Clean End Turn button when no unit/enemy is focused -->
          <button
            v-if="!showBottomConsoleDeck"
            class="paper-btn end-float-btn"
            :class="{ primary: readyHeroesCount === 0 }"
            :disabled="battle.phase !== 'player' || gameStore.enemyTurnRunning"
            @click="endPlayerTurn"
          >
            <CraftIcon name="end_turn" :size="15" />
            <span>{{ readyHeroesCount === 0 ? 'End!' : 'End Turn' }}</span>
          </button>
        </div>

        <!-- Single-Focus Morphing Corrugated Console Deck -->
        <div
          v-if="showBottomConsoleDeck"
          class="corrugated-slab console-deck"
          :class="{
            'deck-threat': Boolean(inspectedEnemy && !isCombatPreview && !isMovePreview && !isSkillOrItemMode),
            'deck-skill': isSkillOrItemMode,
          }"
        >
          <!-- STATE 1: Combat Action Confirm Card (Unified Forecast + Direct Dash/Attack Buttons!) -->
          <template v-if="isCombatPreview && selectedUnit">
            <div class="morph-head combat-head">
              <div class="mh-left">
                <img
                  v-if="focusedUnit"
                  class="mh-sprite"
                  :src="`/sprites/${focusedUnit.visualKind}.png`"
                  :alt="focusedUnit.name"
                />
                <img
                  v-else-if="focusedCover"
                  class="mh-sprite"
                  :src="`/sprites/${focusedCover.kind}.png`"
                  :alt="focusedCover.kind"
                />
                <div class="mh-copy">
                  <strong>{{ focusedUnit ? focusedUnit.name : focusedCover?.kind.toUpperCase() }}</strong>
                  <small v-if="focusedUnit">
                    HP {{ focusedUnit.hp }}/{{ focusedUnit.maxHp }} · {{ getFamilyLabel(focusedUnit.family) }}
                  </small>
                  <small v-else-if="focusedCover">
                    {{ focusedCover.hp }}/{{ focusedCover.maxHp }} Cover HP
                  </small>
                </div>
              </div>

              <div class="mh-stats">
                <template v-if="activeForecast">
                  <span
                    class="hit-stamp"
                    :class="{
                      full: activeForecast.hitChance >= 100,
                      half: activeForecast.hitChance > 0 && activeForecast.hitChance < 100,
                      zero: activeForecast.hitChance === 0,
                    }"
                  >
                    <CraftIcon
                      v-if="activeForecast.coverLevel !== 'none'"
                      :name="activeForecast.coverLevel === 'full' ? 'shield_full' : 'shield_half'"
                      :size="12"
                    />
                    <span>{{ activeForecast.hitChance }}%</span>
                  </span>
                  <span
                    v-if="focusedUnit && activeForecast.matchup !== 'neutral'"
                    class="match-stamp"
                    :class="activeForecast.matchup"
                  >
                    {{ activeForecast.matchup === 'advantage' ? '+30%' : '-20%' }}
                  </span>
                  <span v-if="activeForecast.isLethal" class="ko-tag">KO!</span>
                </template>
                <span v-else-if="previewDashDamage !== null" class="hit-stamp half">
                  Dash -{{ previewDashDamage }}
                </span>

                <button
                  v-if="focusedUnit && focusedUnit.team === 'enemy'"
                  class="mini-zone-btn"
                  :class="{ active: gameStore.inspectedEnemyId === focusedUnit.id }"
                  title="Peek this enemy's Move + Attack Danger Zone"
                  @click="toggleInspectEnemy(focusedUnit.id)"
                >
                  <CraftIcon name="warning" :size="13" />
                </button>
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
              <button
                class="paper-btn cancel-btn"
                aria-label="Cancel action"
                @click="cancelPreviewAction"
              >
                <CraftIcon name="close" :size="16" />
              </button>
            </div>
          </template>

          <!-- STATE 2: Move / Team-Jump Destination Confirm Card (Shows Cover + Live Projected Targets!) -->
          <template v-else-if="isMovePreview && moveDestinationSummary && selectedUnit">
            <div class="morph-head">
              <div class="mh-copy">
                <strong>
                  {{ moveDestinationSummary.isJump ? '★ Team-Jump Landing' : 'Move Destination' }}
                </strong>
                <small>Tap tile again or press confirm</small>
              </div>
              <div class="mh-stats">
                <span
                  class="dest-pill"
                  :class="moveDestinationSummary.bestCover"
                >
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
                  <CraftIcon name="attack" :size="11" />
                  <span>
                    {{
                      moveDestinationSummary.projectedFoes > 0
                        ? `${moveDestinationSummary.projectedFoes} in range`
                        : '0 in range'
                    }}
                  </span>
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
              <button
                class="paper-btn cancel-btn"
                aria-label="Cancel move preview"
                @click="cancelPreviewAction"
              >
                <CraftIcon name="close" :size="16" />
              </button>
            </div>
          </template>

          <!-- STATE 3: Skill or Bag Item Targeting Card -->
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
              <div v-else class="target-prompt-pill">
                Tap a highlighted tile on the board
              </div>
              <button
                class="paper-btn cancel-btn-wide"
                @click="setInteractionMode('move')"
              >
                <CraftIcon name="close" :size="15" />
                <span>Cancel</span>
              </button>
            </div>
          </template>

          <!-- STATE 4: Out-of-Range Enemy Threat Zone Scout Card (Top half of map stays 100% open!) -->
          <template v-else-if="inspectedEnemy">
            <div class="morph-head">
              <div class="mh-left">
                <img
                  class="mh-sprite"
                  :src="`/sprites/${inspectedEnemy.visualKind}.png`"
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
                      {{ inspectedEnemyMatchup === 'advantage' ? 'You +30%' : 'You -20%' }}
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
                <span>Showing Enemy Move + Attack Danger Zone</span>
              </div>
              <button class="paper-btn cancel-btn-wide" @click="cancelPreviewAction">
                <CraftIcon name="close" :size="15" />
                <span>Hide</span>
              </button>
            </div>
          </template>

          <!-- STATE 5: Default Idle Selected Hero Deck (Clean Status Line + 44px Thumb Tabs!) -->
          <template v-else-if="selectedUnit">
            <div class="context-strip">
              <button class="hero-id-btn" title="Tap for hero weapon & skill details" @click="inspectSelectedHeroSummary">
                <strong>{{ selectedUnit.name }}</strong>
                <span class="hp-chip">{{ selectedUnit.hp }}/{{ selectedUnit.maxHp }}</span>
                <span v-if="selectedUnit.graftIds.length > 0" class="graft-dot">
                  {{ GRAFT_REGISTRY[selectedUnit.graftIds[0]]?.badgeIcon }}
                </span>
              </button>

              <div class="slot-pills">
                <span
                  class="slot-pill move"
                  :class="{ spent: selectedUnit.actions.hasMoved }"
                >
                  <CraftIcon v-if="selectedUnit.actions.hasMoved" name="check" :size="10" />
                  <span>{{ selectedUnit.actions.hasMoved ? 'Moved' : dashHintCount > 0 ? 'Move·Dash' : jumpHintCount > 0 ? 'Move·Jump' : 'Move' }}</span>
                </span>
                <span
                  class="slot-pill atk"
                  :class="{ spent: selectedUnit.actions.hasAttacked, dim: !selectedUnit.actions.hasAttacked && enemiesInAttackRange === 0 }"
                >
                  <CraftIcon v-if="selectedUnit.actions.hasAttacked" name="check" :size="10" />
                  <span>{{ selectedUnit.actions.hasAttacked ? 'Shot' : enemiesInAttackRange > 0 ? `Atk (${enemiesInAttackRange})` : 'Atk' }}</span>
                </span>
                <span
                  class="slot-pill skl"
                  :class="{ spent: selectedUnit.actions.hasUsedSkill }"
                >
                  <CraftIcon v-if="selectedUnit.actions.hasUsedSkill" name="check" :size="10" />
                  <span>
                    {{
                      selectedUnit.actions.hasUsedSkill
                        ? 'Skill'
                        : selectedUnit.abilityCooldown > 0
                          ? `CD ${selectedUnit.abilityCooldown}t`
                          : 'Skill'
                    }}
                  </span>
                </span>
                <button
                  v-if="selectedUnit.coopPassive"
                  class="coop-pin"
                  title="Barnyard Co-op Trait"
                  @click="inspectCoop(selectedUnit.name, selectedUnit.coopPassive)"
                >
                  ★
                </button>
                <button
                  v-for="gid in selectedUnit.graftIds"
                  :key="gid"
                  class="graft-pin desktop-only"
                  @click="inspectGraft(gid)"
                >
                  {{ GRAFT_REGISTRY[gid]?.badgeIcon }}
                </button>
              </div>
            </div>

            <!-- 4 Chunky 44px Thumb Action Pads -->
            <div class="action-row">
              <button
                class="paper-btn danger act-tab"
                :class="{
                  'is-active': gameStore.mode === 'attack',
                  'pulse-ready': enemiesInAttackRange > 0 && !selectedUnit.actions.hasAttacked,
                }"
                :disabled="selectedUnit.actions.hasAttacked || battle.phase !== 'player' || gameStore.enemyTurnRunning"
                :title="`${selectedUnit.weapon.name} (${selectedUnit.weapon.damage} dmg, R${selectedUnit.weapon.minRange}-${selectedUnit.weapon.maxRange})`"
                @click="toggleMode('attack')"
              >
                <span v-if="enemiesInAttackRange > 0" class="tab-badge">{{ enemiesInAttackRange }}</span>
                <CraftIcon name="attack" :size="16" />
                <span class="tab-lbl">{{ gameStore.mode === 'attack' ? 'Aiming' : 'Attack' }}</span>
              </button>

              <button
                class="paper-btn plum act-tab"
                :class="{ 'is-active': gameStore.mode === 'ability' }"
                :disabled="
                  !selectedUnit.ability ||
                  selectedUnit.actions.hasUsedSkill ||
                  selectedUnit.abilityCooldown > 0 ||
                  battle.phase !== 'player' ||
                  gameStore.enemyTurnRunning
                "
                :title="selectedUnit.ability ? `${selectedUnit.ability.name}: ${selectedUnit.ability.description}` : 'No skill'"
                @click="toggleMode('ability')"
              >
                <CraftIcon name="skill" :size="16" />
                <span class="tab-lbl">
                  {{
                    selectedUnit.abilityCooldown > 0
                      ? `CD ${selectedUnit.abilityCooldown}`
                      : 'Skill'
                  }}
                </span>
              </button>

              <div class="bag-wrap">
                <button
                  class="paper-btn gold act-tab"
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
                  <CraftIcon name="bag" :size="16" />
                  <span class="tab-lbl">Bag</span>
                  <span class="tab-count">{{ totalItemsLeft }}</span>
                </button>

                <div v-if="showItemsMenu" class="corrugated-slab bag-popover">
                  <div class="bag-note">Uses this hero's Skill slot</div>
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
              </div>

              <button
                class="paper-btn act-tab end-tab"
                :class="{
                  primary: readyHeroesCount === 0,
                  'end-idle': readyHeroesCount > 0,
                }"
                :disabled="battle.phase !== 'player' || gameStore.enemyTurnRunning || battle.status !== 'ongoing'"
                @click="endPlayerTurn"
              >
                <CraftIcon name="end_turn" :size="16" />
                <span class="tab-lbl">{{ readyHeroesCount === 0 ? 'End!' : 'End' }}</span>
              </button>
            </div>
          </template>
        </div>
      </div>
    </footer>

    <!-- Battle Victory / Defeat Modal -->
    <div v-if="battle.status !== 'ongoing'" class="outcome-backdrop">
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
        <p v-else>
          All active produce heroes were bagged — your Seeds still carry back to the Seed Shed!
        </p>

        <div class="outcome-stats">
          <span class="paper-pill">Turns: {{ battle.turn }}</span>
          <span class="paper-pill">
            Survivors: {{ battle.units.filter((u) => u.team === 'player' && u.alive).length }}
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
  cursor: pointer;
  touch-action: none;
}

.mobile-only {
  display: none;
}

/* ===== Single-Row Ultra-Slim Paper-Craft Top Bar ===== */
.top-hud {
  position: absolute;
  top: calc(7px + var(--safe-top));
  left: calc(8px + var(--safe-left));
  right: calc(8px + var(--safe-right));
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 6px;
  pointer-events: none;
  z-index: 14;
}

.top-stamp-bar,
.top-actions {
  pointer-events: auto;
  display: flex;
  align-items: center;
  gap: 5px;
}

.top-stamp-bar {
  padding: 4px 10px 4px 13px;
  min-width: 0;
  flex: 0 1 auto;
}

.turn-stamp {
  font-family: 'Fredoka', sans-serif;
  font-weight: 700;
  font-size: 0.78rem;
  padding: 2px 8px;
  border-radius: 999px;
  border: 1.7px solid var(--ink);
  background: #dcf5c6;
  box-shadow: inset 0 -1.5px 0 rgba(56, 113, 36, 0.24);
  flex-shrink: 0;
}

.turn-stamp.enemy {
  background: #f9cec5;
  color: #8f2014;
}

.status-copy {
  display: flex;
  flex-direction: column;
  line-height: 1.1;
  min-width: 0;
}

.status-copy strong {
  font-family: 'Fredoka', sans-serif;
  font-size: 0.82rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.status-copy small {
  font-size: 0.67rem;
  font-weight: 700;
  color: #4f3116;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.relic-rack {
  padding: 3px 7px;
  display: flex;
  gap: 3px;
}

.relic-chip {
  background: transparent;
  border: none;
  font-size: 1rem;
  cursor: pointer;
  padding: 2px;
}

.tool-btn {
  min-width: 38px;
  min-height: 38px;
  padding: 6px;
  border-radius: 10px;
}

.tool-btn.undo-ready:not(:disabled) {
  background: linear-gradient(180deg, #fff5be 0%, #f1ca52 100%);
}

.tool-btn.danger-on {
  background: linear-gradient(180deg, #ef725e 0%, #c63e2d 100%);
  color: #fffdf5;
}

/* ===== Desktop Corner Scale Strip & Mobile Reset Pill ===== */
.scale-strip {
  position: absolute;
  top: calc(52px + var(--safe-top));
  left: calc(8px + var(--safe-left));
  padding: 2px 4px;
  display: flex;
  align-items: center;
  gap: 2px;
  z-index: 12;
  border-radius: 9px;
}

.sc-btn {
  height: 26px;
  min-width: 24px;
  padding: 0 5px;
  border: none;
  border-radius: 6px;
  background: rgba(255, 250, 236, 0.48);
  color: var(--ink);
  font-family: 'Fredoka', sans-serif;
  font-size: 0.8rem;
  font-weight: 700;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.sc-btn:hover,
.sc-btn:active {
  background: #fff9e6;
}

.sc-pct {
  font-size: 0.68rem;
  padding: 0 4px;
  min-width: 34px;
}

.view-tag {
  background: #fce7a2;
  border: 1.2px solid rgba(71, 43, 22, 0.45);
}

.sc-div {
  width: 1.5px;
  height: 14px;
  background: rgba(71, 43, 22, 0.25);
  margin: 0 1px;
}

.mobile-reset-pill {
  position: absolute;
  top: calc(54px + var(--safe-top));
  left: calc(8px + var(--safe-left));
  padding: 4px 8px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-family: 'Fredoka', sans-serif;
  font-size: 0.72rem;
  font-weight: 700;
  cursor: pointer;
  z-index: 12;
}

/* ===== Tap-to-Inspect Toast ===== */
.inspect-toast {
  position: absolute;
  top: calc(54px + var(--safe-top));
  left: 50%;
  transform: translateX(-50%);
  padding: 8px 13px;
  max-width: min(320px, 88vw);
  z-index: 30;
  display: flex;
  flex-direction: column;
  gap: 2px;
  cursor: pointer;
}

.inspect-toast strong {
  font-family: 'Fredoka', sans-serif;
  font-size: 0.85rem;
}

.inspect-toast small {
  font-size: 0.75rem;
  color: var(--ink-soft);
  line-height: 1.3;
}

/* ===== Field Notebook Drawer ===== */
.menu-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(38, 17, 4, 0.56);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: calc(16px + var(--safe-top)) 14px calc(22px + var(--safe-bottom));
  z-index: 40;
}

.utility-sheet {
  width: 100%;
  max-width: 420px;
  max-height: 82dvh;
  padding: 18px 16px 16px;
  display: flex;
  flex-direction: column;
  gap: 11px;
}

.sheet-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.quick-toggles {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 7px;
}

.toggle-wide {
  grid-column: 1 / -1;
}

.menu-section {
  border-top: 1.5px dashed rgba(69, 42, 22, 0.24);
  padding-top: 9px;
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.menu-section h4 {
  font-size: 0.86rem;
}

.mini-rules {
  margin: 0;
  padding-left: 16px;
  font-size: 0.77rem;
  color: var(--ink-soft);
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.menu-relics {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.menu-relic-row {
  background: rgba(255, 250, 238, 0.8);
  border: 1.5px solid rgba(69, 42, 22, 0.25);
  border-radius: 9px;
  padding: 5px 8px;
  display: flex;
  flex-direction: column;
}

.menu-relic-row small {
  font-size: 0.73rem;
  color: var(--ink-soft);
}

.menu-log {
  font-size: 0.76rem;
  color: var(--ink-soft);
  display: flex;
  flex-direction: column;
  gap: 3px;
}

/* ===== Desktop Right Margin Hover Forecast & Log ===== */
.forecast-dock {
  position: absolute;
  top: calc(52px + var(--safe-top));
  right: calc(8px + var(--safe-right));
  width: min(312px, calc(100vw - 16px));
  display: flex;
  flex-direction: column;
  gap: 6px;
  pointer-events: none;
  z-index: 13;
}

.forecast-card,
.inspector-ribbon,
.desktop-log {
  pointer-events: auto;
  padding: 7px 10px;
  border-radius: 12px;
}

.forecast-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.fc-left {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
}

.fc-sprite {
  width: 34px;
  height: 34px;
  object-fit: contain;
  flex-shrink: 0;
  filter: drop-shadow(0 2px 2px rgba(42, 20, 6, 0.25));
}

.fc-id {
  display: flex;
  flex-direction: column;
  min-width: 0;
  line-height: 1.15;
}

.fc-id strong {
  font-family: 'Fredoka', sans-serif;
  font-size: 0.84rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.fc-id small {
  font-size: 0.7rem;
  color: var(--ink-soft);
}

.fc-mid {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
}

.hit-stamp {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 2px 7px;
  border-radius: 999px;
  border: 1.7px solid var(--ink);
  font-family: 'Fredoka', sans-serif;
  font-weight: 700;
  font-size: 0.74rem;
}

.hit-stamp.full { background: #c9f0b5; }
.hit-stamp.half { background: #fde68a; }
.hit-stamp.zero { background: #e6d5ca; color: #7c2d12; }

.match-stamp {
  font-family: 'Fredoka', sans-serif;
  font-size: 0.66rem;
  font-weight: 700;
  padding: 1.5px 6px;
  border-radius: 6px;
}

.match-stamp.advantage { background: #dcf5cc; color: #266b1a; }
.match-stamp.disadvantage { background: #fad8d1; color: #9c2418; }

.fc-right {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  line-height: 1.05;
  flex-shrink: 0;
}

.dmg-big {
  font-family: 'Fredoka', sans-serif;
  font-size: 1.15rem;
  color: #b53022;
}

.ko-tag {
  background: #fde078;
  border: 1.4px solid var(--ink);
  border-radius: 5px;
  padding: 1px 5px;
  font-family: 'Fredoka', sans-serif;
  font-size: 0.66rem;
  font-weight: 700;
}

.blk-tag {
  font-size: 0.65rem;
  color: #8f2014;
  font-weight: 800;
}

.inspector-ribbon {
  display: flex;
  align-items: center;
  gap: 8px;
}

.insp-copy {
  display: flex;
  flex-direction: column;
  min-width: 0;
  flex: 1;
}

.insp-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 5px;
}

.insp-copy strong {
  font-family: 'Fredoka', sans-serif;
  font-size: 0.84rem;
}

.insp-copy small {
  font-size: 0.7rem;
  color: var(--ink-soft);
}

.mini-fam {
  font-size: 0.66rem;
  padding: 1px 6px;
}

.desktop-log {
  font-size: 0.72rem;
  color: var(--ink-soft);
  display: flex;
  flex-direction: column;
  gap: 2px;
  opacity: 0.9;
}

/* ===== Auto-End Turn Grace Banner ===== */
.auto-end-banner {
  margin: 0 auto 6px;
  padding: 6px 10px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  background:
    linear-gradient(180deg, rgba(255, 249, 224, 0.95) 0%, rgba(248, 227, 158, 0.95) 100%),
    var(--tex-paper) center / 300px 300px repeat;
  border-radius: var(--radius-tag);
  width: 100%;
  max-width: 440px;
}

.auto-copy {
  display: flex;
  align-items: center;
  gap: 5px;
  font-family: 'Fredoka', sans-serif;
  font-size: 0.79rem;
  font-weight: 600;
}

.auto-btns {
  display: flex;
  gap: 5px;
}

.mini-act {
  min-height: 32px;
  padding: 4px 10px;
  font-size: 0.76rem;
  border-radius: 8px;
}

/* ===== Single-Focus Morphing Bottom Paper-Craft Dock ===== */
.bottom-console-wrap {
  position: absolute;
  bottom: calc(11px + var(--safe-bottom));
  left: calc(8px + var(--safe-left));
  right: calc(8px + var(--safe-right));
  display: flex;
  justify-content: center;
  pointer-events: none;
  z-index: 16;
}

.bottom-console {
  width: 100%;
  max-width: 510px;
  display: flex;
  flex-direction: column;
  pointer-events: auto;
}

.medallion-dock {
  display: flex;
  justify-content: center;
  align-items: flex-end;
  gap: 10px;
  padding: 0 6px;
  margin-bottom: -8px;
  position: relative;
  z-index: 4;
}

.medallion-dock.standalone {
  margin-bottom: 0;
  align-items: center;
}

.end-float-btn {
  min-height: 44px;
  padding: 6px 14px;
  font-size: 0.84rem;
  margin-left: 4px;
}

.hero-medallion {
  background: transparent;
  border: none;
  padding: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1px;
  cursor: pointer;
  touch-action: manipulation;
  transition: transform 0.14s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.14s ease;
  color: var(--ink);
}

.hero-medallion.selected {
  transform: translateY(-5px) scale(1.09);
  z-index: 5;
}

.hero-medallion.done:not(.selected) {
  opacity: 0.72;
}

.hero-medallion.ko {
  opacity: 0.4;
  filter: grayscale(0.85);
  cursor: default;
}

.medallion-disc {
  width: 46px;
  height: 46px;
  border-radius: 50%;
  background:
    radial-gradient(circle at 38% 30%, rgba(255, 253, 246, 0.92) 0%, rgba(242, 226, 194, 0.94) 100%),
    var(--tex-paper) center / 200px 200px repeat;
  border: 2.5px solid var(--paper-edge);
  box-shadow:
    0 0 0 1.8px var(--ink),
    0 4px 9px rgba(38, 17, 4, 0.26);
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
}

.hero-medallion.selected .medallion-disc {
  background:
    radial-gradient(circle at 38% 30%, rgba(255, 253, 238, 0.94) 0%, rgba(248, 222, 134, 0.94) 100%),
    var(--tex-paper) center / 200px 200px repeat;
  box-shadow:
    0 0 0 2.5px #fcf6df,
    0 0 0 4.4px var(--ink),
    0 5px 12px rgba(38, 17, 4, 0.30);
}

.hp-ring {
  position: absolute;
  inset: -2px;
  width: calc(100% + 4px);
  height: calc(100% + 4px);
  transform: rotate(-90deg);
  pointer-events: none;
}

.ring-track {
  fill: none;
  stroke: rgba(69, 42, 22, 0.16);
  stroke-width: 3.4;
}

.ring-fill {
  fill: none;
  stroke-width: 3.4;
  stroke-linecap: round;
  transition: stroke-dashoffset 0.25s ease;
}

.med-sprite {
  width: 36px;
  height: 36px;
  object-fit: contain;
  transform: translateY(-2px);
  filter: drop-shadow(0 2px 2px rgba(42, 20, 6, 0.25));
  pointer-events: none;
}

.done-seal {
  position: absolute;
  top: -3px;
  right: -3px;
  width: 17px;
  height: 17px;
  border-radius: 50%;
  background: #5cb848;
  color: #fffef5;
  border: 1.7px solid var(--ink);
  display: flex;
  align-items: center;
  justify-content: center;
}

.med-beads {
  position: absolute;
  bottom: -4px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  gap: 2.5px;
  background: #fcf4e0;
  border: 1.3px solid var(--ink);
  border-radius: 999px;
  padding: 1.5px 3.5px;
}

.bead {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  border: 0.9px solid var(--ink);
}

.bead.move { background: #45b6db; }
.bead.atk { background: #e55342; }
.bead.skl { background: #9b5de5; }
.bead.spent { background: #d4c4a8; opacity: 0.42; }

.med-label {
  font-family: 'Fredoka', sans-serif;
  font-size: 0.64rem;
  font-weight: 700;
  background: #fcf5e4;
  border: 1.4px solid var(--ink);
  border-radius: 999px;
  padding: 0 5px;
  line-height: 1.2;
  max-width: 64px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.hero-medallion.selected .med-label {
  background: #fde078;
}

/* Corrugated Console Deck + Morphing Visual Tones */
.console-deck {
  padding: 12px 9px 8px;
  display: flex;
  flex-direction: column;
  gap: 7px;
  z-index: 3;
}

.console-deck.deck-threat {
  background:
    linear-gradient(180deg, rgba(255, 246, 242, 0.94) 0%, rgba(248, 224, 214, 0.96) 100%),
    var(--tex-paper) center / 340px 340px repeat;
  border-color: #8f2a1d;
}

.console-deck.deck-skill {
  background:
    linear-gradient(180deg, rgba(250, 244, 255, 0.94) 0%, rgba(236, 222, 250, 0.96) 100%),
    var(--tex-paper) center / 340px 340px repeat;
  border-color: #5e318c;
}

/* Morphing Preview Card Header */
.morph-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-height: 32px;
}

.mh-left {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
  flex: 1;
}

.mh-sprite {
  width: 32px;
  height: 32px;
  object-fit: contain;
  flex-shrink: 0;
  filter: drop-shadow(0 2px 2px rgba(42, 20, 6, 0.24));
}

.mh-copy {
  display: flex;
  flex-direction: column;
  min-width: 0;
  line-height: 1.15;
}

.mh-title-row {
  display: flex;
  align-items: center;
  gap: 5px;
  flex-wrap: wrap;
}

.mh-copy strong {
  font-family: 'Fredoka', sans-serif;
  font-size: 0.86rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.mh-copy small {
  font-size: 0.72rem;
  color: var(--ink-soft);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.mh-stats {
  display: flex;
  align-items: center;
  gap: 5px;
  flex-shrink: 0;
}

.mini-zone-btn {
  width: 30px;
  height: 30px;
  border-radius: 8px;
  border: 1.7px solid var(--ink);
  background: #fff6e6;
  color: #9e2a1b;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}

.mini-zone-btn.active {
  background: #df4d3b;
  color: #fffdf5;
}

.dest-pill {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 2px 7px;
  border-radius: 999px;
  border: 1.5px solid var(--ink);
  font-family: 'Fredoka', sans-serif;
  font-size: 0.7rem;
  font-weight: 700;
}

.dest-pill.full { background: #cfe3f5; color: #1b4363; }
.dest-pill.half { background: #fde8a6; color: #6e450a; }
.dest-pill.none { background: #f2e4cc; color: var(--ink-soft); }
.dest-pill.foes-hot { background: #fad4cc; color: #8f1d14; }
.dest-pill.foes-none { background: #ece1cc; color: var(--ink-soft); }

.target-prompt-pill,
.threat-pill-bar {
  flex: 1;
  min-height: 44px;
  padding: 6px 10px;
  border-radius: 10px;
  border: 1.6px dashed rgba(74, 44, 23, 0.36);
  background: rgba(255, 252, 244, 0.72);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  font-family: 'Fredoka', sans-serif;
  font-size: 0.78rem;
  font-weight: 600;
  color: var(--ink);
}

.threat-pill-bar {
  color: #962216;
  border-color: rgba(166, 37, 25, 0.42);
  background: rgba(255, 248, 244, 0.78);
}

/* Idle Context Header */
.context-strip {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  min-height: 24px;
}

.hero-id-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  background: transparent;
  border: none;
  padding: 0 2px;
  color: var(--ink);
  font-family: 'Fredoka', sans-serif;
  font-size: 0.84rem;
  cursor: pointer;
  min-width: 0;
  flex-shrink: 1;
}

.hero-id-btn strong {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.hp-chip {
  font-size: 0.7rem;
  font-weight: 700;
  padding: 1px 6px;
  border-radius: 999px;
  background: #dff3d2;
  border: 1.3px solid var(--ink);
  color: #215218;
  flex-shrink: 0;
}

.graft-dot {
  font-size: 0.78rem;
}

.slot-pills {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

.slot-pill {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 1.5px 6px;
  border-radius: 999px;
  border: 1.3px solid var(--ink);
  font-family: 'Fredoka', sans-serif;
  font-size: 0.65rem;
  font-weight: 700;
  line-height: 1.25;
}

.slot-pill.move { background: #cdeef9; color: #165269; }
.slot-pill.atk { background: #fad6cf; color: #8a2016; }
.slot-pill.skl { background: #e9d8f8; color: #532582; }
.slot-pill.dim { opacity: 0.62; }

.slot-pill.spent {
  background: #e6dac3;
  color: #7c6750;
  border-color: rgba(71, 43, 22, 0.35);
  text-decoration: line-through;
  opacity: 0.72;
}

.graft-pin,
.coop-pin {
  background: #fde8b2;
  border: 1.3px solid var(--ink);
  border-radius: 6px;
  padding: 0 5px;
  font-family: 'Fredoka', sans-serif;
  font-size: 0.68rem;
  font-weight: 700;
  color: #6b3c0b;
  cursor: pointer;
}

/* Integrated 44px Thumb Confirm Row */
.confirm-strip {
  display: flex;
  gap: 6px;
  align-items: center;
}

.confirm-btn {
  flex: 1;
  min-height: 44px;
  font-size: 0.88rem;
  padding: 6px 10px;
}

.cancel-btn {
  min-width: 44px;
  min-height: 44px;
  padding: 6px;
}

.cancel-btn-wide {
  min-height: 44px;
  padding: 6px 12px;
  flex-shrink: 0;
}

/* 4 Chunky 44px Thumb Action Pads */
.action-row {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr 0.92fr;
  gap: 6px;
}

.act-tab {
  width: 100%;
  min-height: 44px;
  padding: 6px 6px;
  flex-direction: row;
  gap: 4px;
  border-radius: 11px;
  font-size: 0.84rem;
  position: relative;
}

.act-tab.is-active {
  outline: 2.5px solid #fff7be;
  transform: translateY(-1px);
}

.act-tab.pulse-ready:not(:disabled) {
  animation: readyPop 2.2s ease-in-out infinite;
}

@keyframes readyPop {
  0%, 100% { filter: brightness(1); }
  50% { filter: brightness(1.08); }
}

.tab-badge {
  position: absolute;
  top: -6px;
  right: -4px;
  min-width: 18px;
  height: 18px;
  padding: 0 4px;
  border-radius: 999px;
  background: #fde078;
  color: var(--ink);
  border: 1.6px solid var(--ink);
  font-family: 'Fredoka', sans-serif;
  font-size: 0.68rem;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  text-shadow: none;
}

.tab-count {
  font-size: 0.7rem;
  padding: 0 5px;
  border-radius: 999px;
  background: rgba(255, 251, 236, 0.75);
  border: 1.2px solid rgba(71, 43, 22, 0.45);
  line-height: 1.25;
}

.end-tab.end-idle {
  background:
    linear-gradient(180deg, rgba(250, 238, 212, 0.9) 0%, rgba(232, 206, 164, 0.92) 100%),
    var(--tex-kraft) center / 260px 260px repeat;
}

.tab-lbl {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.bag-wrap {
  position: relative;
}

.bag-popover {
  position: absolute;
  bottom: calc(100% + 12px);
  right: -36px;
  width: min(260px, calc(100vw - 20px));
  padding: 9px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  z-index: 30;
}

.bag-note {
  font-family: 'Fredoka', sans-serif;
  font-size: 0.7rem;
  color: var(--ink-soft);
  text-align: center;
  padding-bottom: 2px;
  border-bottom: 1.2px dashed rgba(71, 43, 22, 0.22);
}

.bag-opt {
  text-align: left;
  padding: 10px 9px 7px;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 2px;
  color: var(--ink);
}

.bag-opt:disabled {
  opacity: 0.42;
  cursor: not-allowed;
}

.bag-opt-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-family: 'Fredoka', sans-serif;
  font-size: 0.84rem;
}

.bag-opt small {
  font-size: 0.72rem;
  color: var(--ink-soft);
}

/* ===== Outcome Modal ===== */
.outcome-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(38, 17, 4, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 45;
  padding: 18px;
}

.outcome-modal {
  max-width: 420px;
  width: 100%;
  padding: 24px 20px 20px;
  text-align: center;
  display: flex;
  flex-direction: column;
  gap: 13px;
  align-items: center;
}

.out-ribbon {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-family: 'Fredoka', sans-serif;
  font-weight: 700;
  font-size: 1rem;
  padding: 6px 18px;
  border-radius: var(--radius-tag);
  border: 2px solid var(--ink);
  background:
    var(--tex-tooth) center / 200px 200px repeat,
    linear-gradient(178deg, #f5d674 0%, #e0ab3c 100%);
  box-shadow: 0 0 0 2.4px var(--paper-edge), 0 3px 6px rgba(38, 17, 4, 0.22);
  position: relative;
}

.out-ribbon::before {
  content: '';
  position: absolute;
  inset: 2.5px;
  border-radius: 8px;
  border: 1.1px dashed rgba(74, 44, 23, 0.28);
  pointer-events: none;
}

.out-ribbon.defeat {
  background:
    var(--tex-tooth) center / 200px 200px repeat,
    linear-gradient(178deg, #dc6650 0%, #b43e2d 100%);
  color: #fffdf5;
}

.out-ribbon.defeat::before {
  border-color: rgba(255, 246, 224, 0.45);
}

.outcome-modal p {
  margin: 0;
  color: var(--ink-soft);
  font-size: 0.88rem;
}

.outcome-stats {
  display: flex;
  gap: 7px;
  flex-wrap: wrap;
  justify-content: center;
}

.gold-pill {
  background: #fde89b;
}

.big-go {
  width: 100%;
  min-height: 46px;
  font-size: 0.98rem;
}

/* ===== Mobile Fine-Tuning (< 768px) ===== */
@media (max-width: 768px) {
  .desktop-only {
    display: none !important;
  }

  .mobile-only {
    display: inline-flex;
  }

  .top-stamp-bar {
    flex: 1;
    padding: 4px 8px 4px 12px;
  }

  .status-copy strong {
    font-size: 0.78rem;
  }

  .status-copy small {
    font-size: 0.65rem;
  }

  .tool-btn {
    min-width: 38px;
    min-height: 38px;
    padding: 5px;
  }

  .medallion-dock {
    gap: 8px;
    margin-bottom: -7px;
  }

  .medallion-disc {
    width: 44px;
    height: 44px;
  }

  .med-sprite {
    width: 34px;
    height: 34px;
  }

  .console-deck {
    padding: 11px 8px 7px;
    gap: 6px;
  }

  .hero-id-btn {
    font-size: 0.78rem;
  }

  .slot-pill {
    font-size: 0.61rem;
    padding: 1px 5px;
  }

  .action-row {
    gap: 5px;
  }

  .act-tab {
    min-height: 44px;
    padding: 5px 4px;
    font-size: 0.78rem;
    gap: 3px;
  }

  .confirm-btn {
    min-height: 44px;
    font-size: 0.83rem;
    padding: 6px 8px;
  }

  .tab-count {
    font-size: 0.64rem;
    padding: 0 4px;
  }

  .bag-popover {
    right: -52px;
  }
}
</style>
