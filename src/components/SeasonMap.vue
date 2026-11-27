<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { RELIC_REGISTRY } from '../data/relics';
import { ACTS, HARVEST_BELL_LIMIT } from '../engine/mapgen';
import { objectiveBlurb, rollObjectiveForNode } from '../engine/objectives';
import { getBoardPathsForCard } from '../engine/run';
import type { BoardTheme, BoardTravelCard, NodeType, SeasonNode } from '../engine/types';
import { OverworldMapRenderer } from '../renderer3d/OverworldMapRenderer';
import {
  enterSeasonNode,
  gameStore,
  pickShrineBlessing,
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

const selectedCardId = ref<string | null>(null);
const selectedNodeId = ref<string | null>(null);
const hoveredNodeId = ref<string | null>(null);
const showBuildModal = ref(false);
const buildModalHeroUid = ref<string | null>(null);
const showAlmanac = ref(false);
const showRelicsPopover = ref(false);
const showOwMenu = ref(false);
const isTraveling = ref(false);

let mapRenderer: OverworldMapRenderer | null = null;

const travelHand = computed<BoardTravelCard[]>(() => run.value.travelHand ?? []);

// Ensure a valid travel card is always selected
watch(
  travelHand,
  (hand) => {
    if (hand.length === 0) {
      selectedCardId.value = null;
      return;
    }
    if (!selectedCardId.value || !hand.some((c) => c.id === selectedCardId.value)) {
      selectedCardId.value = hand[0].id;
    }
  },
  { immediate: true, deep: true }
);

const selectedCard = computed<BoardTravelCard | null>(
  () => travelHand.value.find((c) => c.id === selectedCardId.value) ?? travelHand.value[0] ?? null
);

const activeCardPaths = computed<Map<string, string[]>>(() =>
  getBoardPathsForCard(run.value, selectedCard.value?.id)
);

const availableIds = computed(() => new Set(activeCardPaths.value.keys()));
const completedIds = computed(() => new Set(run.value.completedNodeIds));

const availableNodes = computed(() =>
  run.value.nodes
    .filter((n) => availableIds.value.has(n.id))
    .sort((a, b) => (a.boardX ?? a.lane) - (b.boardX ?? b.lane))
);

const previewPathIds = computed<string[]>(() => {
  const hov = hoveredNodeId.value;
  if (hov && activeCardPaths.value.has(hov)) {
    return activeCardPaths.value.get(hov) ?? [];
  }
  const sel = selectedNodeId.value;
  if (sel && activeCardPaths.value.has(sel)) {
    return activeCardPaths.value.get(sel) ?? [];
  }
  return [];
});

const boardTurn = computed(() => run.value.boardTurn ?? 0);
const bellLimit = computed(() => run.value.harvestBellLimit ?? HARVEST_BELL_LIMIT);
const turnsLeft = computed(() => bellLimit.value - boardTurn.value);
const isBellOverdue = computed(() => turnsLeft.value < 0);
const isBellUrgent = computed(() => turnsLeft.value >= 0 && turnsLeft.value <= 2);

const nextBattleBuffLabel = computed(() => {
  const b = run.value.nextBattleBuff;
  if (!b) return '';
  const parts: string[] = [];
  if (b.boost) parts.push('Boosted (+2 ATK)');
  if (b.shield) parts.push('Shield');
  if (b.moveBonus) parts.push(`+${b.moveBonus} Move`);
  return parts.length > 0 ? `Next Battle: ${parts.join(' · ')}` : '';
});

const activeHeroes = computed(() =>
  run.value.activeSquadUids
    .map((uid) => run.value.roster.find((h) => h.uid === uid))
    .filter((h): h is NonNullable<typeof h> => Boolean(h))
);

const totalUnspentSp = computed(() =>
  run.value.roster.reduce((sum, h) => sum + (h.harvested ? 0 : h.skillPoints), 0)
);

const leadHeroKind = computed(() => {
  const first = activeHeroes.value[0] ?? run.value.roster[0];
  return first?.species ?? 'cow';
});

const bossKind = computed(() => {
  if (run.value.act === 1) return 'tractor';
  if (run.value.act === 2) return 'harvester';
  return 'scarecrow';
});

// Auto-pick the first reachable space whenever the active card or board changes
watch(
  [availableNodes, selectedCardId],
  ([list]) => {
    if (list.length > 0) {
      if (!selectedNodeId.value || !availableIds.value.has(selectedNodeId.value)) {
        // Never pre-select the Act Boss when another stop is in reach: that is a choice to make on purpose.
        selectedNodeId.value = (list.find((n) => n.type !== 'boss') ?? list[0]).id;
      }
    } else if (!selectedNodeId.value) {
      selectedNodeId.value = run.value.currentNodeId ?? run.value.nodes[0]?.id ?? null;
    }
  },
  { immediate: true }
);

const selectedObjective = computed(() => {
  const node = selectedNode.value;
  if (!node || node.completed) return null;
  const rolled = rollObjectiveForNode(run.value.seed, node);
  return rolled ? objectiveBlurb(rolled) : null;
});

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

const selectedHopCount = computed(() => {
  if (!selectedNode.value) return 0;
  const path = activeCardPaths.value.get(selectedNode.value.id);
  return path ? Math.max(0, path.length - 1) : 0;
});

/** Stops the selected hop passes without visiting: the player should know what they give up. */
const skippedStops = computed<SeasonNode[]>(() => {
  if (!selectedNode.value) return [];
  const path = activeCardPaths.value.get(selectedNode.value.id) ?? [];
  return path
    .slice(1, -1)
    .map((id) => run.value.nodes.find((n) => n.id === id))
    .filter((n): n is SeasonNode => Boolean(n && n.type !== 'start' && !completedIds.value.has(n.id)));
});

/** Travel cards in hand that could reach the selected stop when the active card cannot. */
const cardsReachingSelected = computed<BoardTravelCard[]>(() => {
  const node = selectedNode.value;
  if (!node || isSelectedAvailable.value || isSelectedCompleted.value) return [];
  return travelHand.value.filter((c) => getBoardPathsForCard(run.value, c.id).has(node.id));
});

function useCardForSelected(cardId: string): void {
  const keep = selectedNodeId.value;
  selectTravelCard(cardId);
  selectedNodeId.value = keep;
}

function selectNearestReachable(): void {
  const first = availableNodes.value.find((n) => n.type !== 'boss') ?? availableNodes.value[0];
  if (first) selectStop(first.id, false);
}

const showBellHelp = ref(false);

const NODE_META: Record<NodeType, { label: string; icon: string; tone: string }> = {
  start: { label: 'Trailhead', icon: '⚑', tone: 'green' },
  skirmish: { label: 'Battle', icon: '⚔️', tone: 'battle' },
  escape: { label: 'Convoy', icon: '🏃', tone: 'sky' },
  barn_rescue: { label: 'Barn Rescue', icon: '🔓', tone: 'gold' },
  elite: { label: 'Elite Fight', icon: '💀', tone: 'elite' },
  shop: { label: 'Market', icon: '🛒', tone: 'green' },
  shrine: { label: 'Watering Shrine', icon: '💧', tone: 'teal' },
  armory: { label: 'Armory Wagon', icon: '⚒️', tone: 'gold' },
  vault: { label: 'Supply Camp', icon: '⛺', tone: 'gold' },
  event: { label: 'Lucky Clover', icon: '🍀', tone: 'plum' },
  boss: { label: 'Act Boss', icon: '👑', tone: 'boss' },
};

function selectTravelCard(cardId: string): void {
  if (isTraveling.value) return;
  selectedCardId.value = cardId;
}

function cardBonusShort(card: BoardTravelCard): string {
  switch (card.bonus) {
    case 'heal2':
      return '💚 +2 Squad HP';
    case 'seeds3':
      return '🌱 +3 Seeds';
    case 'boost':
      return '⚡ Next +2 ATK';
    case 'shield':
      return '🛡️ Next Shielded';
    case 'move1':
      return '🚜 Next +1 Move';
    case 'item':
      return '🧺 +1 Free Item';
    case 'flex':
      return '🕳️ 1–2 Spaces';
  }
}

function syncRenderer(): void {
  if (!mapRenderer) return;
  mapRenderer.sync({
    actIndex: run.value.act,
    theme: actTheme.value,
    nodes: run.value.nodes,
    completedIds: completedIds.value,
    availableIds: availableIds.value,
    previewPathIds: previewPathIds.value,
    currentNodeId: run.value.currentNodeId,
    selectedNodeId: selectedNode.value?.id ?? null,
    leadHeroKind: leadHeroKind.value,
    bossKind: bossKind.value,
    boardTurn: boardTurn.value,
    harvestBellLimit: bellLimit.value,
  });
}

async function travelAndEnterNode(nodeId: string): Promise<void> {
  if (isTraveling.value || !availableIds.value.has(nodeId)) return;
  const cardId = selectedCard.value?.id;
  const hopPath = activeCardPaths.value.get(nodeId) ?? [];
  isTraveling.value = true;
  try {
    if (mapRenderer && !webglFailed.value) {
      if (hopPath.length >= 2) {
        await mapRenderer.hopLeaderAlongPath(hopPath);
      } else {
        await mapRenderer.hopLeaderToNode(nodeId);
      }
    }
  } finally {
    isTraveling.value = false;
  }
  enterSeasonNode(nodeId, cardId);
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

function onMapKeyDown(e: KeyboardEvent): void {
  if (showBuildModal.value || showAlmanac.value || run.value.status === 'shrine' || isTraveling.value) {
    return;
  }
  if (e.key === '1' || e.key === '2' || e.key === '3') {
    const idx = Number(e.key) - 1;
    const card = travelHand.value[idx];
    if (card) selectTravelCard(card.id);
  } else if (e.key === 'Enter' && isSelectedAvailable.value) {
    enterSelectedStop();
  }
}

watch(
  [
    () => run.value.act,
    () => run.value.completedNodeIds.length,
    () => run.value.currentNodeId,
    () => run.value.boardTurn,
    selectedCardId,
    selectedNodeId,
    hoveredNodeId,
    leadHeroKind,
  ],
  () => {
    syncRenderer();
  }
);

onMounted(() => {
  window.addEventListener('keydown', onMapKeyDown);
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
    console.warn('3D Overworld WebGL unavailable, using compact board fallback:', err);
    webglFailed.value = true;
  }
});

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onMapKeyDown);
  mapRenderer?.destroy();
  mapRenderer = null;
});
</script>

<template>
  <div class="overworld-shell">
    <!-- Full-Viewport Interactive 3D Watercolor Boardgame Tabletop -->
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
            @click="enterSeasonNode(node.id, selectedCard?.id)"
          >
            {{ NODE_META[node.type].icon }} {{ node.name }} →
          </button>
        </div>
      </div>
    </div>

    <!-- Slim Watercolor Top Bar -->
    <header class="ow-top-bar">
      <div class="ow-left-cluster">
        <div class="kraft-ribbon ow-act-pill">
          <span class="act-stamp">ACT {{ run.act + 1 }}/3</span>
          <div class="act-copy">
            <strong>{{ actDef.name }}</strong>
            <small>Pick a Travel Card · Click a lit space to hop</small>
          </div>
        </div>

        <!-- Brass Harvest Bell Turn Pressure Dial -->
        <div
          class="bell-dial"
          role="button"
          tabindex="0"
          :class="{ urgent: isBellUrgent, overdue: isBellOverdue }"
          @click="showBellHelp = !showBellHelp"
          @keydown.enter="showBellHelp = !showBellHelp"
          :title="
            isBellOverdue
              ? 'Harvest Bell tolled! The Act Boss is Empowered (+3 HP & +1 ATK).'
              : `Beat the Act Boss within ${turnsLeft} more board turn(s) for +15 Swift Harvest Seeds!`
          "
        >
          <span class="bell-icon">{{ isBellOverdue ? '⚠️' : '🔔' }}</span>
          <div class="bell-copy">
            <strong>
              {{
                isBellOverdue
                  ? 'Farmers Alerted!'
                  : turnsLeft === 0
                    ? 'Final Bell Turn!'
                    : `${turnsLeft} ${turnsLeft === 1 ? 'Turn' : 'Turns'} Left`
              }}
            </strong>
            <small>
              {{ isBellOverdue ? 'Boss Empowered' : 'Swift Bonus: +15 🌱' }}
            </small>
          </div>
          <p v-if="showBellHelp" class="bell-help">
            Every Travel Card you play uses one turn. Beat the Act Boss before the bell rings and you earn +15 seeds.
            If it rings first, the boss gets tougher. Tap to close.
          </p>
        </div>

        <!-- Active Next-Battle Blessing / Sprint Buff Pill -->
        <span
          v-if="nextBattleBuffLabel"
          class="paper-pill ow-buff-pill"
          :title="nextBattleBuffLabel"
        >
          ✨ {{ nextBattleBuffLabel }}
        </span>
      </div>

      <div class="ow-top-right">
        <span
          v-if="(run.harvestHeat ?? 0) > 0"
          class="paper-pill ow-heat-pill"
          :title="`Harvest Heat ${run.harvestHeat}`"
        >
          🔥 Heat {{ run.harvestHeat }}
        </span>

        <span class="paper-pill ow-seed-pill">
          <CraftIcon name="seed" :size="14" /> {{ run.seeds }}
        </span>

        <button
          v-if="run.relicIds.length > 0"
          class="paper-pill ow-relic-btn ow-desktop-only"
          @click="showRelicsPopover = !showRelicsPopover"
        >
          🏅 {{ run.relicIds.length }}
        </button>

        <button
          class="paper-btn icon-tool ow-desktop-only"
          title="Storybook Field Almanac"
          aria-label="Open Field Almanac"
          @click="showAlmanac = true"
        >
          <span>📖</span>
        </button>

        <button
          class="paper-btn icon-tool ow-desktop-only"
          :title="gameStore.musicMuted ? 'Unmute Soundtrack' : 'Mute Soundtrack'"
          :aria-label="gameStore.musicMuted ? 'Unmute Soundtrack' : 'Mute Soundtrack'"
          @click="toggleMusicMute"
        >
          <span>{{ gameStore.musicMuted ? '🔇' : '🎵' }}</span>
        </button>

        <button
          v-if="!webglFailed"
          class="paper-btn icon-tool ow-desktop-only"
          title="Recenter Board"
          aria-label="Recenter board"
          @click="recenterMap"
        >
          <CraftIcon name="center" :size="15" />
        </button>

        <button class="paper-btn icon-tool ow-desktop-only" title="Save & Return to Title" @click="returnToTitle">
          <span>Title</span>
        </button>

        <!-- Mobile Single Menu Trigger -->
        <button
          class="paper-btn icon-tool ow-mobile-only"
          aria-label="Overworld Menu"
          title="Almanac, Relics, Audio & Title"
          @click="showOwMenu = !showOwMenu"
        >
          <CraftIcon name="menu" :size="16" />
        </button>
      </div>
    </header>

    <!-- Mobile Compact Overworld Menu Popover -->
    <div v-if="showOwMenu" class="corrugated-slab ow-menu-pop">
      <div class="rp-head">
        <strong>{{ actDef.name }}</strong>
        <button class="mini-x" @click="showOwMenu = false">✕</button>
      </div>
      <div class="ow-menu-grid">
        <button class="paper-btn" @click="showOwMenu = false; showAlmanac = true">📖 Almanac</button>
        <button class="paper-btn" @click="toggleMusicMute">
          {{ gameStore.musicMuted ? '🔇 Music Off' : '🎵 Music On' }}
        </button>
        <button v-if="!webglFailed" class="paper-btn" @click="recenterMap(); showOwMenu = false">
          ⌖ Recenter
        </button>
        <button v-if="run.relicIds.length > 0" class="paper-btn gold" @click="showOwMenu = false; showRelicsPopover = true">
          🏅 Relics ({{ run.relicIds.length }})
        </button>
        <button class="paper-btn" @click="returnToTitle">← Title</button>
      </div>
    </div>

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

    <!-- Floating Bottom Tabletop Dock: Squad (Left) + 3-Card Travel Hand Fan (Center) + Space CTA (Right) -->
    <footer class="ow-bottom-dock">
      <!-- Bottom-Left Squad & Skill Trees -->
      <div class="ow-squad-dock">
        <button
          v-for="hero in activeHeroes"
          :key="hero.uid"
          class="ow-hero-chip"
          :title="`${hero.name} (Lv.${hero.level}) — Open Squad, Swap & Skill Tree`"
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
          <span>★ Squad</span>
          <span v-if="totalUnspentSp > 0" class="sp-count-pill">{{ totalUnspentSp }}</span>
        </button>
      </div>

      <!-- Bottom-Center Tactile Watercolor Travel Hand Card Fan -->
      <div v-if="travelHand.length > 0" class="travel-hand-fan" aria-label="Travel Hand Cards">
        <button
          v-for="(card, idx) in travelHand"
          :key="card.id"
          class="travel-card"
          :class="[
            card.tint,
            { active: selectedCard?.id === card.id, tiltedLeft: idx === 0, tiltedRight: idx === 2 },
          ]"
          :title="card.desc"
          :disabled="isTraveling"
          @click="selectTravelCard(card.id)"
        >
          <div class="tc-top">
            <span class="tc-key">{{ idx + 1 }}</span>
            <span class="tc-pips" :title="card.flexible ? `1–${card.steps} spaces` : `${card.steps} space(s)`">
              <template v-if="card.flexible">1–{{ card.steps }} hops</template>
              <template v-else>{{ card.steps }} {{ card.steps === 1 ? 'hop' : 'hops' }}</template>
            </span>
          </div>
          <div class="tc-icon">{{ card.icon }}</div>
          <strong class="tc-name">{{ card.name }}</strong>
          <span class="tc-bonus">{{ cardBonusShort(card) }}</span>
        </button>
      </div>

      <!-- Bottom-Right Crisp Selected Space Preview & March CTA -->
      <div v-if="selectedNode" class="corrugated-slab ow-stop-card">
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
            <small>
              {{ selectedNode.subtitle }}
              <template v-if="selectedObjective"> · {{ selectedObjective }}</template>
              <template v-if="isSelectedAvailable && selectedHopCount > 0">
                · {{ selectedHopCount }} hop{{ selectedHopCount > 1 ? 's' : '' }}
              </template>
            </small>
          </div>

          <button
            v-if="isSelectedAvailable"
            class="paper-btn primary stop-go-btn"
            :disabled="isTraveling"
            @click="enterSelectedStop"
          >
            <span>{{ isTraveling ? 'Hopping...' : 'March →' }}</span>
          </button>
          <span v-else-if="isSelectedCompleted" class="paper-pill stop-state done">
            ✓ Cleared
          </span>
          <div v-else class="stop-reach-help">
            <button
              v-for="c in cardsReachingSelected"
              :key="c.id"
              class="paper-btn gold stop-card-btn"
              @click="useCardForSelected(c.id)"
            >
              Use {{ c.icon }} {{ c.name }}
            </button>
            <template v-if="cardsReachingSelected.length === 0">
              <span class="paper-pill stop-state locked">Too far this turn</span>
              <button v-if="availableNodes.length > 0" class="paper-btn stop-card-btn" @click="selectNearestReachable">
                Show stops in reach
              </button>
            </template>
          </div>
        </div>

        <p v-if="isSelectedAvailable && skippedStops.length > 0" class="stop-warning">
          Skips {{ skippedStops.map((n) => `${NODE_META[n.type].icon} ${NODE_META[n.type].label}`).join(', ') }}.
          You cannot walk back.
        </p>
        <p v-if="isSelectedAvailable && selectedNode.type === 'boss'" class="stop-warning boss">
          👑 Act Boss: this ends the act. Battles on the way make your squad stronger, and
          {{ turnsLeft > 0 ? `the Harvest Bell still gives you ${turnsLeft} turn${turnsLeft === 1 ? '' : 's'}.` : 'the Harvest Bell has rung.' }}
        </p>
      </div>
    </footer>

    <!-- Watering Shrine 3-Blessing Overlay Modal -->
    <div v-if="run.status === 'shrine'" class="shrine-backdrop">
      <section class="corrugated-slab shrine-sheet pinned-card">
        <div class="washi-tape"></div>
        <span class="brass-pin tl"></span>
        <span class="brass-pin tr"></span>

        <div class="shrine-head">
          <span class="shrine-badge">💧 WATERING SHRINE</span>
          <h2>Choose a Spring Blessing</h2>
          <p>Cool mossy springwater shimmers beside the painted trail. Take one blessing before marching on:</p>
        </div>

        <div class="shrine-grid">
          <button class="shrine-opt heal" @click="pickShrineBlessing('heal')">
            <span class="so-icon">💧</span>
            <strong>Full Squad Heal</strong>
            <small>Restore every active &amp; benched hero to 100% Max HP.</small>
            <span class="paper-btn primary so-cta">Drink Fresh Water</span>
          </button>

          <button class="shrine-opt blessing" @click="pickShrineBlessing('blessing')">
            <span class="so-icon">✨</span>
            <strong>Sunlit Battle Blessing</strong>
            <small>Next battle: all heroes start with +2 ATK, Shield (2t), and +1 Move!</small>
            <span class="paper-btn gold so-cta">Receive Blessing</span>
          </button>

          <button class="shrine-opt seeds" @click="pickShrineBlessing('seeds')">
            <span class="so-icon">🌱</span>
            <strong>Heirloom Seed Offering</strong>
            <small>Gather +14 Run Seeds from the shrine's wishing trough for Market &amp; Armory stops.</small>
            <span class="paper-btn so-cta">Collect +14 Seeds</span>
          </button>
        </div>
      </section>
    </div>

    <!-- Illustrated 2-Path Unique Hero Skill Trees & Armory Drawer -->
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
  background: #5a3a20;
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

/* ===== Slim Top Bar ===== */
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

.ow-left-cluster,
.ow-top-right {
  display: flex;
  align-items: center;
  gap: 8px;
  pointer-events: auto;
  flex-wrap: wrap;
}

.ow-act-pill {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 6px 12px;
}

.act-stamp {
  background: #4e321a;
  color: #ffe891;
  font-size: 0.7rem;
  font-weight: 900;
  padding: 3px 8px;
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
  font-size: 0.92rem;
  color: var(--ink);
}

.act-copy small {
  font-size: 0.69rem;
  color: var(--ink-soft);
}

/* Brass Harvest Bell Countdown Dial */
.bell-dial {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 5px 11px;
  border-radius: 13px;
  border: 2.2px solid #5c3a16;
  background: linear-gradient(180deg, #fff6d6 0%, #f1d382 100%);
  box-shadow: 0 3px 0 #5c3a16, 0 6px 14px rgba(24, 12, 4, 0.25);
  line-height: 1.12;
}

.bell-dial.urgent {
  background: linear-gradient(180deg, #ffe7b3 0%, #f5a642 100%);
  border-color: #7a2d0a;
}

.bell-dial.overdue {
  background: linear-gradient(180deg, #ff7961 0%, #c92b24 100%);
  border-color: #4f0e0b;
  color: #fff8eb;
}

.bell-icon {
  font-size: 1.08rem;
}

.bell-copy {
  display: flex;
  flex-direction: column;
}

.bell-copy strong {
  font-size: 0.78rem;
  font-weight: 900;
  color: inherit;
}

.bell-copy small {
  font-size: 0.65rem;
  opacity: 0.85;
  font-weight: 700;
}

.ow-buff-pill {
  background: linear-gradient(180deg, #e2f9ff 0%, #b5ebff 100%);
  border-color: #1f6b8a;
  color: #114357;
  font-size: 0.74rem;
  font-weight: 800;
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

.ow-heat-pill {
  background: linear-gradient(180deg, #ff7a33 0%, #c8331a 100%);
  color: #fff8e6;
  border-color: #4f160a;
  font-weight: 900;
  font-size: 0.76rem;
}

.icon-tool {
  padding: 6px 10px;
  min-height: 34px;
  font-size: 0.78rem;
}

.relics-pop {
  position: fixed;
  top: calc(58px + var(--safe-top));
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

/* ===== Bottom Tabletop Dock ===== */
.ow-bottom-dock {
  position: fixed;
  left: calc(12px + var(--safe-left));
  right: calc(12px + var(--safe-right));
  bottom: calc(10px + var(--safe-bottom));
  z-index: 15;
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 12px;
  pointer-events: none;
}

.ow-squad-dock,
.travel-hand-fan,
.ow-stop-card {
  pointer-events: auto;
}

.ow-squad-dock {
  display: flex;
  align-items: center;
  gap: 6px;
  background: rgba(251, 243, 223, 0.93);
  border: 2.2px solid var(--ink);
  border-radius: 14px;
  padding: 6px 8px;
  box-shadow: 0 4px 0 var(--ink), 0 10px 22px rgba(24, 12, 4, 0.32);
}

.ow-hero-chip {
  background: #f2e3c3;
  border: 2px solid var(--ink);
  border-radius: 10px;
  padding: 3px;
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
  width: 34px;
  height: 34px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.ow-hero-img-wrap img {
  width: 30px;
  height: 30px;
  object-fit: contain;
}

.ow-lvl {
  position: absolute;
  bottom: -3px;
  left: -4px;
  background: #4a2c17;
  color: #ffe891;
  font-size: 0.54rem;
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
  font-size: 0.58rem;
  font-weight: 900;
  padding: 0 4px;
  border-radius: 999px;
}

.ow-hp-mini {
  width: 32px;
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
  padding: 7px 10px;
  font-size: 0.78rem;
  display: flex;
  align-items: center;
  gap: 5px;
}

.sp-count-pill {
  background: #4a2c17;
  color: #ffe891;
  font-size: 0.66rem;
  font-weight: 900;
  padding: 1px 6px;
  border-radius: 999px;
}

/* ===== Tactile Watercolor Travel Hand Card Fan ===== */
.travel-hand-fan {
  display: flex;
  align-items: flex-end;
  justify-content: center;
  gap: 8px;
  padding: 4px 6px;
}

.travel-card {
  width: 124px;
  padding: 7px 8px 8px;
  border-radius: 14px;
  border: 2.5px solid #4a2c17;
  background: linear-gradient(180deg, #fffdf5 0%, #f6e7c4 100%);
  box-shadow: 0 4px 0 #4a2c17, 0 10px 18px rgba(24, 12, 4, 0.34);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  cursor: pointer;
  text-align: center;
  overflow: hidden;
  transition: transform 0.16s cubic-bezier(0.22, 1, 0.36, 1), box-shadow 0.16s ease, border-color 0.16s ease;
}

.travel-card.tiltedLeft {
  transform: rotate(-2.5deg) translateY(3px);
}

.travel-card.tiltedRight {
  transform: rotate(2.5deg) translateY(3px);
}

.travel-card:hover:not(:disabled) {
  transform: translateY(-7px) scale(1.03);
}

.travel-card.active {
  transform: translateY(-11px) scale(1.05);
  border-color: #d18200;
  background: linear-gradient(180deg, #fffef8 0%, #ffe99e 100%);
  box-shadow: 0 6px 0 #8a5200, 0 0 18px rgba(255, 214, 74, 0.65);
  z-index: 3;
}

.travel-card.mint {
  border-top: 5px solid #59a644;
}

.travel-card.gold {
  border-top: 5px solid #d99b26;
}

.travel-card.crimson {
  border-top: 5px solid #d94c38;
}

.travel-card.plum {
  border-top: 5px solid #7d4ca8;
}

.tc-top {
  width: 100%;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.tc-key {
  background: #4a2c17;
  color: #ffe891;
  font-size: 0.6rem;
  font-weight: 900;
  width: 16px;
  height: 16px;
  border-radius: 5px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.tc-pips {
  font-size: 0.68rem;
  font-weight: 900;
  letter-spacing: 0.06em;
  color: #7c450d;
}

.tc-icon {
  font-size: 1.38rem;
  line-height: 1.1;
}

.tc-name {
  font-size: 0.75rem;
  font-weight: 900;
  color: var(--ink);
  line-height: 1.15;
}

.tc-bonus {
  font-size: 0.64rem;
  font-weight: 800;
  background: rgba(74, 44, 23, 0.11);
  color: #4a2c17;
  padding: 2px 7px;
  border-radius: 999px;
  max-width: 100%;
  line-height: 1.2;
}

/* ===== Selected Space Card ===== */
.ow-stop-card {
  width: min(370px, 100%);
  padding: 9px 12px;
  display: flex;
  flex-direction: column;
  gap: 7px;
}

.next-tabs {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
}

.next-tab {
  border: 1.5px solid var(--ink);
  border-radius: 999px;
  background: #f5e6c8;
  color: var(--ink);
  font-size: 0.68rem;
  font-weight: 800;
  padding: 2px 8px;
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
  gap: 10px;
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
  gap: 6px;
  flex-wrap: wrap;
}

.stop-title-row strong {
  font-size: 0.9rem;
  color: var(--ink);
}

.stop-copy small {
  font-size: 0.72rem;
  color: var(--ink-soft);
  line-height: 1.25;
}

.stop-type-pill {
  font-size: 0.65rem;
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

.stop-type-pill.teal {
  background: #ccf7f3;
  color: #0c5957;
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
  padding: 9px 15px;
  font-size: 0.88rem;
  font-weight: 900;
  flex-shrink: 0;
}

.stop-state {
  font-size: 0.72rem;
  font-weight: 800;
  flex-shrink: 0;
}

.stop-state.done {
  background: #daf5cf;
  color: #215e16;
}

/* ===== Watering Shrine Overlay Modal ===== */
.shrine-backdrop {
  position: fixed;
  inset: 0;
  z-index: 55;
  background: rgba(20, 32, 34, 0.56);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
}

.shrine-sheet {
  width: min(760px, 100%);
  padding: 22px 22px 20px;
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.shrine-head {
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 5px;
}

.shrine-badge {
  background: #ccf7f3;
  color: #0d5c63;
  border: 2px solid #0d5c63;
  font-size: 0.72rem;
  font-weight: 900;
  padding: 3px 10px;
  border-radius: 999px;
  letter-spacing: 0.05em;
}

.shrine-head h2 {
  margin: 0;
  font-size: 1.38rem;
  color: var(--ink);
}

.shrine-head p {
  margin: 0;
  font-size: 0.84rem;
  color: var(--ink-soft);
}

.shrine-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

.shrine-opt {
  border: 2.5px solid var(--ink);
  border-radius: 15px;
  padding: 14px 12px;
  background: linear-gradient(180deg, #fffdf6 0%, #f5ead1 100%);
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 7px;
  cursor: pointer;
  transition: transform 0.14s ease, box-shadow 0.14s ease;
  box-shadow: 0 4px 0 var(--ink);
}

.shrine-opt:hover {
  transform: translateY(-4px);
  box-shadow: 0 7px 0 var(--ink);
}

.shrine-opt.heal {
  background: linear-gradient(180deg, #f3fffd 0%, #d4f7f0 100%);
}

.shrine-opt.blessing {
  background: linear-gradient(180deg, #fffdf0 0%, #ffefc2 100%);
}

.so-icon {
  font-size: 2rem;
}

.shrine-opt strong {
  font-size: 0.94rem;
  color: var(--ink);
}

.shrine-opt small {
  font-size: 0.76rem;
  color: var(--ink-soft);
  line-height: 1.32;
  flex: 1;
}

.so-cta {
  width: 100%;
  padding: 7px 10px;
  font-size: 0.78rem;
}

.ow-mobile-only {
  display: none;
}

.ow-menu-pop {
  position: fixed;
  top: calc(56px + var(--safe-top, 0px));
  right: calc(10px + var(--safe-right, 0px));
  z-index: 42;
  width: min(260px, calc(100vw - 20px));
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.ow-menu-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px;
}

.ow-menu-grid .paper-btn {
  padding: 8px 6px;
  font-size: 0.78rem;
  font-weight: 800;
  min-height: 40px;
}

@media (max-width: 980px) {
  .act-copy small {
    display: none;
  }

  .ow-bottom-dock {
    flex-direction: column;
    align-items: stretch;
    gap: 6px;
  }

  .ow-squad-dock {
    justify-content: space-between;
  }

  .travel-card {
    width: 102px;
    padding: 6px 7px;
  }

  .ow-stop-card {
    width: 100%;
  }

  .shrine-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 767px) {
  .ow-desktop-only {
    display: none !important;
  }

  .ow-mobile-only {
    display: inline-flex;
  }

  .ow-top-bar {
    flex-wrap: nowrap;
    align-items: center;
    padding: calc(6px + var(--safe-top, 0px)) 8px 0;
    gap: 6px;
  }

  .ow-left-cluster {
    flex-wrap: nowrap;
    gap: 5px;
    min-width: 0;
    flex: 1;
  }

  .ow-act-pill {
    padding: 4px 8px;
    gap: 5px;
    min-width: 0;
  }

  .act-copy strong {
    display: none;
  }

  .bell-dial {
    padding: 4px 8px;
    gap: 4px;
  }

  .bell-copy strong {
    font-size: 0.72rem;
  }

  .bell-copy small {
    display: none;
  }

  .ow-top-right {
    flex-wrap: nowrap;
    gap: 5px;
    flex-shrink: 0;
  }

  .ow-bottom-dock {
    padding: 0 8px calc(8px + var(--safe-bottom, 0px));
    gap: 5px;
  }

  .ow-squad-dock {
    padding: 4px 6px;
    gap: 4px;
  }

  .ow-hero-chip {
    padding: 2px 3px;
  }

  .ow-hero-img-wrap {
    width: 30px;
    height: 30px;
  }

  .ow-builds-btn {
    padding: 5px 10px;
    font-size: 0.74rem;
    min-height: 36px;
  }

  .travel-hand-fan {
    gap: 6px;
  }

  .travel-card {
    flex: 1;
    width: auto;
    min-width: 0;
    padding: 5px 6px;
    gap: 2px;
    transform: none !important;
  }

  .tc-icon {
    font-size: 1.15rem;
  }

  .tc-name {
    font-size: 0.7rem;
  }

  .tc-bonus {
    font-size: 0.62rem;
    padding: 2px 4px;
  }

  .ow-stop-card {
    padding: 6px 9px;
    gap: 4px;
  }

  .stop-copy small {
    display: none;
  }

  .stop-title-row strong {
    font-size: 0.84rem;
  }

  .stop-go-btn {
    padding: 6px 12px;
    font-size: 0.8rem;
    min-height: 38px;
  }
}

.stop-reach-help {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4px;
  flex-shrink: 0;
}
.stop-card-btn {
  padding: 5px 10px;
  font-size: 0.74rem;
  font-weight: 800;
  white-space: nowrap;
}
.stop-warning {
  margin: 6px 0 0;
  padding: 4px 8px;
  border-radius: 8px;
  background: #fff1cf;
  border: 1.5px dashed #b98524;
  color: #5a3d00;
  font-size: 0.72rem;
  font-weight: 700;
  line-height: 1.25;
}
.stop-warning.boss {
  background: #ffe1da;
  border-color: #b23a2a;
  color: #6b1c10;
}
.bell-dial {
  position: relative;
  cursor: pointer;
}
.bell-help {
  position: absolute;
  top: 100%;
  left: 0;
  z-index: 40;
  width: max-content;
  margin: 4px 0 0;
  max-width: 300px;
  padding: 6px 10px;
  border-radius: 10px;
  border: 1.6px solid var(--ink);
  background: #fffaeb;
  font-size: 0.72rem;
  font-weight: 600;
  line-height: 1.3;
  color: var(--ink);
}
</style>
