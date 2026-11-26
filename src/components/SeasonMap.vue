<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { RELIC_REGISTRY } from '../data/relics';
import { ACTS, FLOORS_PER_ACT } from '../engine/mapgen';
import { getAvailableNextNodeIds } from '../engine/run';
import type { BoardTheme, NodeType, SeasonNode } from '../engine/types';
import { OverworldMapRenderer } from '../renderer3d/OverworldMapRenderer';
import {
  enterSeasonNode,
  gameStore,
  returnToTitle,
  toggleMusicMute,
} from '../stores/gameStore';
import AlmanacModal from './AlmanacModal.vue';
import CraftIcon from './CraftIcon.vue';
import HeroBuildModal from './HeroBuildModal.vue';

const run = computed(() => gameStore.run!);
const actDef = computed(() => ACTS[run.value.act] ?? ACTS[0]);
const actTheme = computed<BoardTheme>(() =>
  run.value.act === 1 ? 'greenhouse' : run.value.act === 2 ? 'autumn' : 'spring'
);

const webglCanvasRef = ref<HTMLCanvasElement | null>(null);
const overlayCanvasRef = ref<HTMLCanvasElement | null>(null);
const webglFailed = ref(false);

const selectedNodeId = ref<string | null>(null);
const hoveredNodeId = ref<string | null>(null);
const showBuildModal = ref(false);
const buildModalHeroUid = ref<string | null>(null);
const showAlmanac = ref(false);
const showRelicsPopover = ref(false);
const isTraveling = ref(false);

let mapRenderer: OverworldMapRenderer | null = null;

const availableIds = computed(() => new Set(getAvailableNextNodeIds(run.value)));
const completedIds = computed(() => new Set(run.value.completedNodeIds));

const availableNodes = computed(() =>
  run.value.nodes
    .filter((n) => availableIds.value.has(n.id))
    .sort((a, b) => a.lane - b.lane)
);

const activeHeroes = computed(() =>
  run.value.activeSquadUids
    .map((uid) => run.value.roster.find((h) => h.uid === uid))
    .filter((h): h is NonNullable<typeof h> => Boolean(h))
);

const totalUnspentSp = computed(() =>
  run.value.roster.reduce((sum, h) => sum + (h.harvested ? 0 : h.skillPoints), 0)
);

const currentFloorDisplay = computed(() => {
  if (run.value.completedNodeIds.length === 0) return 1;
  const last = run.value.nodes.find(
    (n) => n.id === run.value.completedNodeIds[run.value.completedNodeIds.length - 1]
  );
  return Math.min(FLOORS_PER_ACT + 1, (last?.stage ?? 0) + 2);
});

const leadHeroKind = computed(() => {
  const first = activeHeroes.value[0] ?? run.value.roster[0];
  return first?.species ?? 'cow';
});

const bossKind = computed(() => {
  if (run.value.act === 1) return 'tractor';
  if (run.value.act === 2) return 'harvester';
  return 'scarecrow';
});

// Auto-pick the first reachable stop whenever available stops change!
watch(
  availableNodes,
  (list) => {
    if (!selectedNodeId.value || !run.value.nodes.some((n) => n.id === selectedNodeId.value)) {
      selectedNodeId.value = list[0]?.id ?? run.value.nodes[0]?.id ?? null;
    } else if (list.length > 0 && !availableIds.value.has(selectedNodeId.value)) {
      selectedNodeId.value = list[0].id;
    }
  },
  { immediate: true }
);

const selectedNode = computed<SeasonNode | null>(() => {
  const id = selectedNodeId.value;
  if (!id) return availableNodes.value[0] ?? null;
  return run.value.nodes.find((n) => n.id === id) ?? availableNodes.value[0] ?? null;
});

const isSelectedAvailable = computed(() =>
  Boolean(selectedNode.value && availableIds.value.has(selectedNode.value.id))
);

const isSelectedCompleted = computed(() =>
  Boolean(selectedNode.value && completedIds.value.has(selectedNode.value.id))
);

const NODE_META: Record<NodeType, { label: string; icon: string; tone: string }> = {
  skirmish: { label: 'Battle', icon: '⚔️', tone: 'battle' },
  escape: { label: 'Breakout', icon: '🏃', tone: 'sky' },
  barn_rescue: { label: 'Barn Rescue', icon: '🔓', tone: 'gold' },
  elite: { label: 'Elite Fight', icon: '💀', tone: 'elite' },
  shop: { label: 'Market', icon: '🛒', tone: 'green' },
  vault: { label: 'Seed Vault', icon: '🌱', tone: 'gold' },
  event: { label: 'Mystery', icon: '❓', tone: 'plum' },
  boss: { label: 'Act Boss', icon: '👑', tone: 'boss' },
};

function syncRenderer(): void {
  if (!mapRenderer) return;
  mapRenderer.sync({
    actIndex: run.value.act,
    theme: actTheme.value,
    nodes: run.value.nodes,
    completedIds: completedIds.value,
    availableIds: availableIds.value,
    currentNodeId: run.value.currentNodeId,
    selectedNodeId: selectedNode.value?.id ?? null,
    leadHeroKind: leadHeroKind.value,
    bossKind: bossKind.value,
  });
}

async function travelAndEnterNode(nodeId: string): Promise<void> {
  if (isTraveling.value || !availableIds.value.has(nodeId)) return;
  isTraveling.value = true;
  try {
    if (mapRenderer && !webglFailed.value) {
      await mapRenderer.hopLeaderToNode(nodeId);
    }
  } finally {
    isTraveling.value = false;
  }
  enterSeasonNode(nodeId);
}

function selectStop(nodeId: string, enterIfReady = false): void {
  if (isTraveling.value) return;
  selectedNodeId.value = nodeId;
  mapRenderer?.focusNode(nodeId);
  syncRenderer();
  if (enterIfReady && availableIds.value.has(nodeId)) {
    void travelAndEnterNode(nodeId);
  }
}

function enterSelectedStop(): void {
  if (!selectedNode.value || !isSelectedAvailable.value || isTraveling.value) return;
  void travelAndEnterNode(selectedNode.value.id);
}

function openHeroBuilds(uid?: string): void {
  buildModalHeroUid.value = uid ?? activeHeroes.value[0]?.uid ?? null;
  showBuildModal.value = true;
}

function recenterMap(): void {
  mapRenderer?.recenter(false);
}

watch(
  [
    () => run.value.act,
    () => run.value.completedNodeIds.length,
    () => run.value.currentNodeId,
    selectedNodeId,
    leadHeroKind,
  ],
  () => {
    syncRenderer();
  }
);

onMounted(() => {
  if (!webglCanvasRef.value) return;
  try {
    mapRenderer = new OverworldMapRenderer(webglCanvasRef.value, overlayCanvasRef.value, {
      onHoverNode: (id) => {
        hoveredNodeId.value = id;
      },
      onSelectNode: (id, alreadySelected) => {
        selectStop(id, alreadySelected);
      },
    });
    syncRenderer();
  } catch (err) {
    console.warn('3D Overworld WebGL unavailable, using compact trail fallback:', err);
    webglFailed.value = true;
  }
});

onBeforeUnmount(() => {
  mapRenderer?.destroy();
  mapRenderer = null;
});
</script>

<template>
  <div class="overworld-shell">
    <!-- Full-Viewport Interactive 3D Paper Mario Act Diorama -->
    <template v-if="!webglFailed">
      <canvas ref="webglCanvasRef" class="overworld-canvas"></canvas>
      <canvas ref="overlayCanvasRef" class="overworld-overlay"></canvas>
    </template>

    <!-- Graceful Compact Fallback if WebGL unavailable -->
    <div v-else class="fallback-stage">
      <div class="corrugated-slab fallback-card">
        <h3>{{ run.seasonName }}</h3>
        <p>{{ actDef.trailHint }}</p>
        <div class="fallback-list">
          <button
            v-for="node in availableNodes"
            :key="node.id"
            class="paper-btn gold"
            @click="enterSeasonNode(node.id)"
          >
            {{ NODE_META[node.type].icon }} {{ node.name }} →
          </button>
        </div>
      </div>
    </div>

    <!-- Minimal Floating Top Bar -->
    <header class="ow-top-bar">
      <div class="kraft-ribbon ow-act-pill">
        <span class="act-stamp">ACT {{ run.act + 1 }}/3</span>
        <div class="act-copy">
          <strong>{{ actDef.name }}</strong>
          <small>Stop {{ currentFloorDisplay }}/{{ FLOORS_PER_ACT + 1 }} · Drag to explore · Click a lit stop</small>
        </div>
      </div>

      <div class="ow-top-right">
        <span v-if="(run.harvestHeat ?? 0) > 0" class="paper-pill ow-heat-pill" :title="`Harvest Heat ${run.harvestHeat}`">
          🔥 Heat {{ run.harvestHeat }}
        </span>

        <span class="paper-pill ow-seed-pill">
          <CraftIcon name="seed" :size="14" /> {{ run.seeds }}
        </span>

        <button
          v-if="run.relicIds.length > 0"
          class="paper-pill ow-relic-btn"
          @click="showRelicsPopover = !showRelicsPopover"
        >
          🏅 {{ run.relicIds.length }} Relic{{ run.relicIds.length > 1 ? 's' : '' }}
        </button>

        <button
          class="paper-btn icon-tool"
          title="Storybook Field Almanac"
          aria-label="Open Field Almanac"
          @click="showAlmanac = true"
        >
          <span>📖</span>
        </button>

        <button
          class="paper-btn icon-tool"
          :title="gameStore.musicMuted ? 'Unmute Soundtrack' : 'Mute Soundtrack'"
          :aria-label="gameStore.musicMuted ? 'Unmute Soundtrack' : 'Mute Soundtrack'"
          @click="toggleMusicMute"
        >
          <span>{{ gameStore.musicMuted ? '🔇' : '🎵' }}</span>
        </button>

        <button
          v-if="!webglFailed"
          class="paper-btn icon-tool"
          title="Recenter Camera"
          aria-label="Recenter camera"
          @click="recenterMap"
        >
          <CraftIcon name="center" :size="15" />
        </button>

        <button class="paper-btn icon-tool" title="Save & Return to Title" @click="returnToTitle">
          <span>Title</span>
        </button>
      </div>
    </header>

    <!-- Optional Compact Relics Popover -->
    <div v-if="showRelicsPopover && run.relicIds.length > 0" class="corrugated-slab relics-pop">
      <div class="rp-head">
        <strong>Active Soil Relics</strong>
        <button class="mini-x" @click="showRelicsPopover = false">✕</button>
      </div>
      <div v-for="rid in run.relicIds" :key="rid" class="rp-row">
        <span>{{ RELIC_REGISTRY[rid]?.icon }} <strong>{{ RELIC_REGISTRY[rid]?.name }}</strong></span>
        <small>{{ RELIC_REGISTRY[rid]?.description }}</small>
      </div>
    </div>

    <!-- Floating Bottom Dock: Left Squad Strip + Center Selected Stop Card -->
    <footer class="ow-bottom-dock">
      <!-- Compact Bottom-Left Squad & Skill Tree Bar -->
      <div class="ow-squad-dock">
        <button
          v-for="hero in activeHeroes"
          :key="hero.uid"
          class="ow-hero-chip"
          :title="`${hero.name} (Lv.${hero.level}) — Open Skill Tree & Squad`"
          @click="openHeroBuilds(hero.uid)"
        >
          <div class="ow-hero-img-wrap">
            <img :src="`/sprites/${hero.species}.png`" :alt="hero.name" />
            <span class="ow-lvl">L{{ hero.level }}</span>
            <span v-if="hero.skillPoints > 0" class="ow-sp">+{{ hero.skillPoints }}</span>
          </div>
          <div class="ow-hp-mini">
            <div
              class="ow-hp-mini-fill"
              :style="{ width: `${Math.max(4, Math.round((hero.hp / Math.max(1, hero.maxHp)) * 100))}%` }"
            ></div>
          </div>
        </button>

        <button
          class="paper-btn ow-builds-btn"
          :class="{ gold: totalUnspentSp > 0 }"
          @click="openHeroBuilds()"
        >
          <span>★ Builds</span>
          <span v-if="totalUnspentSp > 0" class="sp-count-pill">{{ totalUnspentSp }} SP</span>
        </button>
      </div>

      <!-- Crisp Floating Selected Stop Card -->
      <div v-if="selectedNode" class="corrugated-slab ow-stop-card">
        <!-- Quick switcher pills when multiple next stops are available -->
        <div v-if="availableNodes.length > 1" class="next-tabs">
          <button
            v-for="opt in availableNodes"
            :key="opt.id"
            class="next-tab"
            :class="{ active: selectedNode.id === opt.id }"
            @click="selectStop(opt.id, false)"
          >
            {{ NODE_META[opt.type].icon }} {{ NODE_META[opt.type].label }}
          </button>
        </div>

        <div class="stop-main-row">
          <div class="stop-copy">
            <div class="stop-title-row">
              <span class="stop-type-pill" :class="NODE_META[selectedNode.type].tone">
                {{ NODE_META[selectedNode.type].icon }} {{ NODE_META[selectedNode.type].label }}
              </span>
              <strong>{{ selectedNode.name }}</strong>
            </div>
            <small>{{ selectedNode.subtitle }}</small>
          </div>

          <button
            v-if="isSelectedAvailable"
            class="paper-btn primary stop-go-btn"
            :disabled="isTraveling"
            @click="enterSelectedStop"
          >
            <span>{{ isTraveling ? 'Hopping...' : 'Go →' }}</span>
          </button>
          <span v-else-if="isSelectedCompleted" class="paper-pill stop-state done">
            ✓ Cleared
          </span>
          <span v-else class="paper-pill stop-state locked">
            Ahead
          </span>
        </div>
      </div>
    </footer>

    <!-- Hero Level-Up & 3-Branch Skill Tree Drawer -->
    <HeroBuildModal
      v-if="showBuildModal"
      :initial-hero-uid="buildModalHeroUid"
      @close="showBuildModal = false"
    />

    <!-- Storybook Field Almanac -->
    <AlmanacModal v-if="showAlmanac" @close="showAlmanac = false" />
  </div>
</template>

<style scoped>
.overworld-shell {
  width: 100%;
  height: 100dvh;
  position: relative;
  overflow: hidden;
  background: #6a4424;
}

.overworld-canvas {
  width: 100%;
  height: 100%;
  display: block;
  touch-action: none;
}

.overworld-overlay {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  z-index: 4;
}

.fallback-stage {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
}

.fallback-card {
  max-width: 460px;
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.fallback-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

/* ===== Minimal Floating Top Bar ===== */
.ow-top-bar {
  position: fixed;
  top: calc(10px + var(--safe-top));
  left: calc(12px + var(--safe-left));
  right: calc(12px + var(--safe-right));
  z-index: 15;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  pointer-events: none;
}

.ow-act-pill,
.ow-top-right {
  pointer-events: auto;
}

.ow-act-pill {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 12px;
}

.act-stamp {
  background: #4e321a;
  color: #ffe891;
  font-size: 0.72rem;
  font-weight: 900;
  padding: 4px 8px;
  border-radius: 8px;
  letter-spacing: 0.04em;
  white-space: nowrap;
}

.act-copy {
  display: flex;
  flex-direction: column;
  line-height: 1.15;
}

.act-copy strong {
  font-size: 0.96rem;
  color: var(--ink);
}

.act-copy small {
  font-size: 0.72rem;
  color: var(--ink-soft);
}

.ow-top-right {
  display: flex;
  align-items: center;
  gap: 7px;
}

.ow-seed-pill {
  background: #fff2b8;
  font-weight: 800;
}

.ow-relic-btn {
  cursor: pointer;
  background: #f8edd6;
  font-weight: 800;
}

.icon-tool {
  padding: 7px 11px;
  min-height: 36px;
  font-size: 0.8rem;
}

.relics-pop {
  position: fixed;
  top: calc(60px + var(--safe-top));
  right: calc(14px + var(--safe-right));
  width: min(310px, calc(100vw - 28px));
  padding: 12px;
  z-index: 22;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.rp-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.mini-x {
  background: none;
  border: none;
  font-weight: 900;
  cursor: pointer;
  color: var(--ink);
}

.rp-row {
  display: flex;
  flex-direction: column;
  font-size: 0.8rem;
  padding-top: 6px;
  border-top: 1px dashed rgba(74, 44, 23, 0.28);
}

.rp-row small {
  color: var(--ink-soft);
  font-size: 0.73rem;
}

/* ===== Floating Bottom Dock ===== */
.ow-bottom-dock {
  position: fixed;
  left: calc(12px + var(--safe-left));
  right: calc(12px + var(--safe-right));
  bottom: calc(12px + var(--safe-bottom));
  z-index: 15;
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 12px;
  pointer-events: none;
}

.ow-squad-dock,
.ow-stop-card {
  pointer-events: auto;
}

.ow-squad-dock {
  display: flex;
  align-items: center;
  gap: 6px;
  background: rgba(251, 243, 223, 0.94);
  border: 2.5px solid var(--ink);
  border-radius: 15px;
  padding: 6px 8px;
  box-shadow: 0 4px 0 var(--ink), 0 10px 22px rgba(24, 12, 4, 0.35);
}

.ow-hero-chip {
  background: #f2e3c3;
  border: 2px solid var(--ink);
  border-radius: 11px;
  padding: 4px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  cursor: pointer;
  transition: transform 0.12s ease;
}

.ow-hero-chip:hover {
  transform: translateY(-2px);
  background: #fff4d4;
}

.ow-hero-img-wrap {
  position: relative;
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.ow-hero-img-wrap img {
  width: 32px;
  height: 32px;
  object-fit: contain;
}

.ow-lvl {
  position: absolute;
  bottom: -3px;
  left: -4px;
  background: #4a2c17;
  color: #ffe891;
  font-size: 0.56rem;
  font-weight: 900;
  padding: 0 3px;
  border-radius: 4px;
}

.ow-sp {
  position: absolute;
  top: -5px;
  right: -5px;
  background: #e89b14;
  color: #fffef5;
  border: 1.5px solid var(--ink);
  font-size: 0.6rem;
  font-weight: 900;
  padding: 0 4px;
  border-radius: 999px;
}

.ow-hp-mini {
  width: 34px;
  height: 4px;
  border-radius: 999px;
  background: #cfbe9c;
  overflow: hidden;
}

.ow-hp-mini-fill {
  height: 100%;
  background: #58b842;
}

.ow-builds-btn {
  padding: 8px 11px;
  font-size: 0.8rem;
  display: flex;
  align-items: center;
  gap: 5px;
}

.sp-count-pill {
  background: #4a2c17;
  color: #ffe891;
  font-size: 0.68rem;
  font-weight: 900;
  padding: 1px 6px;
  border-radius: 999px;
}

/* Crisp Selected Stop Floating Card */
.ow-stop-card {
  width: min(460px, 100%);
  padding: 10px 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.next-tabs {
  display: flex;
  gap: 5px;
  flex-wrap: wrap;
}

.next-tab {
  border: 1.5px solid var(--ink);
  border-radius: 999px;
  background: #f5e6c8;
  color: var(--ink);
  font-size: 0.72rem;
  font-weight: 800;
  padding: 3px 9px;
  cursor: pointer;
}

.next-tab.active {
  background: #ffe066;
  box-shadow: 0 2px 0 var(--ink);
}

.stop-main-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.stop-copy {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.stop-title-row {
  display: flex;
  align-items: center;
  gap: 7px;
  flex-wrap: wrap;
}

.stop-title-row strong {
  font-size: 0.96rem;
  color: var(--ink);
}

.stop-copy small {
  font-size: 0.76rem;
  color: var(--ink-soft);
  line-height: 1.25;
}

.stop-type-pill {
  font-size: 0.68rem;
  font-weight: 900;
  padding: 2px 7px;
  border-radius: 999px;
  border: 1.5px solid var(--ink);
  background: #ffe2cc;
  color: #6b240c;
  white-space: nowrap;
}

.stop-type-pill.sky {
  background: #d4f1ff;
  color: #0e4f6e;
}

.stop-type-pill.gold {
  background: #fff0b3;
  color: #6e4500;
}

.stop-type-pill.green {
  background: #dcf5d2;
  color: #215e16;
}

.stop-type-pill.plum {
  background: #f0dcff;
  color: #541c78;
}

.stop-type-pill.elite,
.stop-type-pill.boss {
  background: #ffd4d8;
  color: #7c1420;
}

.stop-go-btn {
  padding: 10px 18px;
  font-size: 0.94rem;
  font-weight: 900;
  flex-shrink: 0;
}

.stop-state {
  font-size: 0.76rem;
  font-weight: 800;
  flex-shrink: 0;
}

.stop-state.done {
  background: #daf5cf;
  color: #215e16;
}

.ow-heat-pill {
  background: linear-gradient(180deg, #ff7a33 0%, #c8331a 100%);
  color: #fff8e6;
  border-color: #4f160a;
  font-weight: 900;
  font-size: 0.78rem;
}

@media (max-width: 820px) {
  .act-copy small {
    display: none;
  }

  .ow-bottom-dock {
    flex-direction: column;
    align-items: stretch;
    gap: 7px;
  }

  .ow-squad-dock {
    justify-content: space-between;
  }

  .ow-stop-card {
    width: 100%;
  }
}
</style>
