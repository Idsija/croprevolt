<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { HARVEST_HEAT_LEVELS, MAX_HARVEST_HEAT } from '../engine/difficulty';
import {
  fetchTopScores,
  flushQueuedScores,
  loadPlayerName,
  MAX_NAME_LENGTH,
  onlineConfig,
  savePlayerName,
  type OnlineScoreRow,
} from '../engine/onlineScores';
import { META_UNLOCK_COSTS } from '../engine/run';
import { dailyKeyFor, loadScores, topDailyScores, topStandardScores } from '../engine/score';
import type { MetaProgress } from '../engine/types';
import { TitleBackdropRenderer } from '../renderer3d/TitleBackdropRenderer';
import {
  buyMetaUnlock,
  continueSavedRun,
  gameStore,
  setSelectedHeat,
  startDailyRun,
  startNewSeasonRun,
  toggleAudioMute,
  toggleMusicMute,
} from '../stores/gameStore';
import AlmanacModal from './AlmanacModal.vue';
import CraftIcon from './CraftIcon.vue';
import CropRevoltLogo from './CropRevoltLogo.vue';

const activeModal = ref<'none' | 'shed' | 'guide' | 'almanac' | 'scores'>('none');

const todayKey = dailyKeyFor();
const scoreTab = ref<'daily' | 'standard'>('daily');
// Read once per visit to the title: scores only change when a run ends, which remounts this screen.
const allScores = loadScores();
const dailyBoard = topDailyScores(allScores, todayKey);
const standardBoard = topStandardScores(allScores);
interface BoardRow {
  id: string;
  score: number;
  victory: boolean;
  act: number;
  battlesWon: number;
  heat: number;
  at: string;
  name?: string;
}

/** The shared board is offered only when the build has Supabase settings. */
const online = onlineConfig();
const scoreScope = ref<'device' | 'everyone'>(online ? 'everyone' : 'device');
const playerName = ref(online ? loadPlayerName() : '');
const onlineRows = ref<OnlineScoreRow[] | null>(null);
const onlineState = ref<'idle' | 'loading' | 'ready' | 'error'>('idle');
let onlineRequest = 0;

async function refreshOnlineBoard(): Promise<void> {
  if (!online || activeModal.value !== 'scores' || scoreScope.value !== 'everyone') return;
  const request = ++onlineRequest;
  onlineState.value = 'loading';
  const rows = await fetchTopScores(
    online,
    scoreTab.value === 'daily' ? { mode: 'daily', dailyKey: todayKey } : { mode: 'standard' }
  );
  if (request !== onlineRequest) return; // a newer tab or scope was picked meanwhile
  onlineRows.value = rows;
  onlineState.value = rows ? 'ready' : 'error';
}

function commitPlayerName(): void {
  playerName.value = savePlayerName(playerName.value);
}

const shownBoard = computed<BoardRow[]>(() => {
  if (scoreScope.value === 'everyone') {
    return (onlineRows.value ?? []).map((r) => ({
      id: r.run_id,
      score: r.score,
      victory: r.victory,
      act: r.act,
      battlesWon: r.battles_won,
      heat: r.heat,
      at: r.created_at ?? '',
      name: r.player_name,
    }));
  }
  return scoreTab.value === 'daily' ? dailyBoard : standardBoard;
});
const boardLoading = computed(() => scoreScope.value === 'everyone' && onlineState.value === 'loading');
const boardError = computed(() => scoreScope.value === 'everyone' && onlineState.value === 'error');
const dailyBest = dailyBoard[0]?.score ?? null;
const fmt = (n: number) => n.toLocaleString('en-US');
const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const backdropCanvasRef = ref<HTMLCanvasElement | null>(null);
const webglReady = ref(false);
let backdropRenderer: TitleBackdropRenderer | null = null;

const maxHeatUnlocked = computed(() =>
  Math.max(1, Math.min(MAX_HARVEST_HEAT, gameStore.meta.maxHeatUnlocked ?? 1))
);
const currentHeat = computed(() =>
  Math.max(0, Math.min(maxHeatUnlocked.value, gameStore.meta.selectedHeat ?? 0))
);
const currentHeatInfo = computed(() => HARVEST_HEAT_LEVELS[currentHeat.value] ?? HARVEST_HEAT_LEVELS[0]);

const unlockKeys: Array<keyof MetaProgress['unlocks']> = [
  'extraItemSatchel',
  'heirloomSoil',
  'starterRelic',
];

watch([activeModal, scoreTab, scoreScope], refreshOnlineBoard);

onMounted(() => {
  // Send any scores that could not be uploaded when their run ended.
  if (online) void flushQueuedScores(online);
  if (!backdropCanvasRef.value) return;
  try {
    backdropRenderer = new TitleBackdropRenderer(backdropCanvasRef.value);
    webglReady.value = true;
  } catch (err) {
    console.warn('3D Title Diorama WebGL unavailable, using classic 2D showcase:', err);
    webglReady.value = false;
  }
});

onBeforeUnmount(() => {
  backdropRenderer?.destroy();
  backdropRenderer = null;
});
</script>

<template>
  <div class="title-stage" :class="{ 'has-3d': webglReady }">
    <!-- Live Orbiting 3D Paper Mario Diorama Canvas -->
    <canvas ref="backdropCanvasRef" class="title-webgl-bg"></canvas>
    <div v-if="webglReady" class="title-vignette"></div>

    <!-- Top floating audio & seed pills -->
    <div class="top-bar">
      <button class="paper-pill seed-badge" @click="activeModal = 'shed'">
        <CraftIcon name="seed" :size="15" />
        <span>{{ gameStore.meta.heirloomSeeds }} Seeds</span>
      </button>
      <div class="audio-controls">
        <button
          class="paper-btn icon-only music-btn"
          :class="{ off: gameStore.musicMuted }"
          :title="gameStore.musicMuted ? 'Unmute Storybook Music' : 'Mute Storybook Music'"
          aria-label="Toggle music"
          @click="toggleMusicMute"
        >
          <span>{{ gameStore.musicMuted ? '🔇' : '🎵' }}</span>
        </button>
        <button
          class="paper-btn icon-only"
          :title="gameStore.muted ? 'Unmute Sound Effects' : 'Mute Sound Effects'"
          aria-label="Toggle sound effects"
          @click="toggleAudioMute"
        >
          <CraftIcon :name="gameStore.muted ? 'sound_off' : 'sound_on'" :size="18" />
        </button>
      </div>
    </div>

    <!-- Main Centered Paper-Craft Game Cover -->
    <main class="cover-card corrugated-slab pinned-card" :class="{ 'compact-3d': webglReady }">
      <div class="washi-tape"></div>
      <span class="brass-pin tl"></span>
      <span class="brass-pin tr"></span>

      <div class="title-lockup">
        <CropRevoltLogo />
        <p class="tagline">
          3D Paper-Craft Tactical Roguelite — Produce vs. Farmers
        </p>
      </div>

      <!-- Classic 2D Mini Diorama Strip (only shown if WebGL is unavailable) -->
      <div v-if="!webglReady" class="diorama-showcase">
        <div class="standee-row">
          <div class="team-left">
            <img class="st st-1" src="/sprites/lettuce.png" alt="Crisphead" />
            <img class="st st-2" src="/sprites/pea.png" alt="Hero" />
            <img class="st st-3" src="/sprites/lemon.png" alt="Zestia" />
            <img class="st st-4" src="/sprites/cow.png" alt="Stitch" />
          </div>
          <img
            class="st st-crate"
            src="/sprites/crate.png"
            alt="Garden Prop"
          />
          <div class="team-right">
            <img
              class="st st-5"
              src="/sprites/digger.png"
              alt="Hazard or Farmer"
            />
            <img class="st st-trim" src="/sprites/trimmer.png" alt="Snips McGee" />
            <img
              class="st st-6"
              src="/sprites/scarecrow.png"
              alt="Captain Scarecrow"
            />
          </div>
        </div>
        <div class="cardboard-grass-strip">
          <div class="corrugated-edge"></div>
        </div>
      </div>

      <!-- Harvest Heat Ascension Selector (0-5) -->
      <div class="heat-panel">
        <div class="heat-top">
          <strong>🔥 Harvest Heat</strong>
          <span class="heat-bonus" v-if="currentHeatInfo.seedBonusPct > 0">
            +{{ currentHeatInfo.seedBonusPct }}% Heirloom Seeds
          </span>
          <span class="heat-bonus muted" v-else>Standard Mode</span>
        </div>
        <div class="heat-pills">
          <button
            v-for="h in HARVEST_HEAT_LEVELS"
            :key="h.level"
            class="heat-pill"
            :class="{
              active: currentHeat === h.level,
              locked: h.level > maxHeatUnlocked,
            }"
            :disabled="h.level > maxHeatUnlocked"
            :title="h.level > maxHeatUnlocked ? 'Win a run at lower Heat to unlock' : `${h.name}: ${h.desc}`"
            @click="setSelectedHeat(h.level)"
          >
            {{ h.level > maxHeatUnlocked ? `🔒${h.level}` : `H${h.level}` }}
          </button>
        </div>
        <small class="heat-desc">{{ currentHeatInfo.name }} — {{ currentHeatInfo.desc }}</small>
      </div>

      <!-- Primary Thumb-Ready CTA Stack -->
      <div class="cta-stack">
        <button
          v-if="gameStore.savedRunAvailable"
          class="paper-btn gold diecut cta-main"
          @click="continueSavedRun"
        >
          <CraftIcon name="play" :size="18" />
          <span>Continue Saved Run</span>
        </button>

        <button
          class="paper-btn primary diecut cta-main"
          @click="startNewSeasonRun()"
        >
          <CraftIcon name="play" :size="18" />
          <span>
            {{ gameStore.savedRunAvailable ? 'Start Fresh Run' : 'Play Run' }}
            <template v-if="currentHeat > 0"> (Heat {{ currentHeat }})</template>
          </span>
        </button>

        <div class="secondary-row daily-row">
          <button class="paper-btn sky diecut daily-btn" @click="startDailyRun()">
            <span class="daily-copy">
              <strong>Daily Run</strong>
              <small>{{ dailyBest !== null ? `Your best today: ${fmt(dailyBest)}` : 'Same garden for everyone today' }}</small>
            </span>
          </button>
          <button class="paper-btn sec-btn scores-btn" @click="activeModal = 'scores'">
            <CraftIcon name="trophy" :size="15" />
            <span>Scores</span>
          </button>
        </div>

        <div class="secondary-row three-col">
          <button class="paper-btn sec-btn" @click="activeModal = 'shed'">
            <CraftIcon name="shed" :size="15" />
            <span>Seed Shed</span>
            <span class="mini-count">{{ gameStore.meta.heirloomSeeds }}</span>
          </button>

          <button class="paper-btn gold sec-btn" @click="activeModal = 'almanac'">
            <span>📖 Almanac</span>
          </button>

          <button class="paper-btn sec-btn" @click="activeModal = 'guide'">
            <CraftIcon name="book" :size="15" />
            <span>Guide</span>
          </button>
        </div>
      </div>
    </main>

    <!-- Storybook Field Almanac Compendium Modal -->
    <AlmanacModal v-if="activeModal === 'almanac'" @close="activeModal = 'none'" />

    <!-- On-Device Leaderboard Modal -->
    <div v-if="activeModal === 'scores'" class="modal-backdrop" @click.self="activeModal = 'none'">
      <section class="paper-card modal-sheet scroll-soft">
        <div class="washi-tape"></div>
        <div class="modal-head">
          <div>
            <h2>Harvest Scores</h2>
            <small>{{ scoreScope === 'everyone' ? 'Best runs from all players' : 'Best runs played on this device' }}</small>
          </div>
          <button class="paper-btn icon-only" aria-label="Close" @click="activeModal = 'none'">
            <CraftIcon name="close" :size="17" />
          </button>
        </div>

        <template v-if="online">
          <div class="score-tabs scope-tabs" role="tablist" aria-label="Whose scores">
            <button
              class="paper-btn score-tab"
              :class="{ sky: scoreScope === 'everyone' }"
              role="tab"
              :aria-selected="scoreScope === 'everyone'"
              @click="scoreScope = 'everyone'"
            >
              Everyone
            </button>
            <button
              class="paper-btn score-tab"
              :class="{ sky: scoreScope === 'device' }"
              role="tab"
              :aria-selected="scoreScope === 'device'"
              @click="scoreScope = 'device'"
            >
              This Device
            </button>
          </div>
          <label class="name-field">
            <span>Your name on the board</span>
            <input
              v-model="playerName"
              type="text"
              :maxlength="MAX_NAME_LENGTH"
              autocomplete="nickname"
              spellcheck="false"
              @change="commitPlayerName"
            />
          </label>
        </template>

        <div class="score-tabs" role="tablist">
          <button
            class="paper-btn score-tab"
            :class="{ gold: scoreTab === 'daily' }"
            role="tab"
            :aria-selected="scoreTab === 'daily'"
            @click="scoreTab = 'daily'"
          >
            Today's Daily
          </button>
          <button
            class="paper-btn score-tab"
            :class="{ gold: scoreTab === 'standard' }"
            role="tab"
            :aria-selected="scoreTab === 'standard'"
            @click="scoreTab = 'standard'"
          >
            All Runs
          </button>
        </div>

        <p v-if="boardLoading" class="score-empty">Fetching the shared board…</p>
        <p v-else-if="boardError" class="score-empty">
          Couldn't reach the shared board. Check your connection, or switch to This Device.
        </p>
        <ol v-else-if="shownBoard.length > 0" class="score-board">
          <li v-for="(entry, i) in shownBoard" :key="entry.id" class="seed-packet score-row">
            <span class="score-rank">{{ i + 1 }}</span>
            <span class="score-meta">
              <strong>{{ fmt(entry.score) }}<span v-if="entry.name" class="score-name"> · {{ entry.name }}</span></strong>
              <small>
                {{ entry.victory ? 'Garden freed' : `Fell in Act ${entry.act}` }} ·
                {{ entry.battlesWon }} battles<template v-if="entry.heat > 0"> · Heat {{ entry.heat }}</template>
              </small>
            </span>
            <small v-if="entry.at" class="score-date">{{ shortDate(entry.at) }}</small>
          </li>
        </ol>
        <p v-else class="score-empty">
          {{ scoreScope === 'everyone'
            ? 'No scores here yet. Finish a run to be the first on the board.'
            : scoreTab === 'daily'
            ? "No daily run finished yet today. The daily garden is the same for everyone and changes at midnight UTC."
            : 'Finish a run to put your first score on the board.' }}
        </p>
      </section>
    </div>

    <!-- Seed Shed Meta-Progression Modal -->
    <div v-if="activeModal === 'shed'" class="modal-backdrop" @click.self="activeModal = 'none'">
      <section class="paper-card modal-sheet scroll-soft">
        <div class="washi-tape"></div>
        <div class="modal-head">
          <div>
            <h2>Seed Shed Upgrades</h2>
            <small>Permanent Heirloom perks unlocked across runs</small>
          </div>
          <button class="paper-btn icon-only" aria-label="Close" @click="activeModal = 'none'">
            <CraftIcon name="close" :size="17" />
          </button>
        </div>

        <div class="shed-stats">
          <span class="paper-pill gold-pill">
            <CraftIcon name="seed" :size="14" /> {{ gameStore.meta.heirloomSeeds }} Heirloom Seeds
          </span>
          <span class="paper-pill">
            <CraftIcon name="trophy" :size="14" /> {{ gameStore.meta.runsWon }} / {{ gameStore.meta.runsPlayed }} Wins
          </span>
        </div>

        <div class="unlock-list">
          <div
            v-for="key in unlockKeys"
            :key="key"
            class="seed-packet unlock-card"
            :class="{ owned: gameStore.meta.unlocks[key] }"
          >
            <div class="unlock-copy">
              <strong>{{ META_UNLOCK_COSTS[key].title }}</strong>
              <small>{{ META_UNLOCK_COSTS[key].desc }}</small>
            </div>
            <button
              v-if="!gameStore.meta.unlocks[key]"
              class="paper-btn gold buy-btn"
              :disabled="gameStore.meta.heirloomSeeds < META_UNLOCK_COSTS[key].cost"
              @click="buyMetaUnlock(key)"
            >
              <CraftIcon name="seed" :size="14" />
              <span>{{ META_UNLOCK_COSTS[key].cost }}</span>
            </button>
            <span v-else class="paper-pill owned-pill">
              <CraftIcon name="check" :size="13" /> Active
            </span>
          </div>
        </div>
      </section>
    </div>

    <!-- Illustrated Field Guide Modal -->
    <div v-if="activeModal === 'guide'" class="modal-backdrop" @click.self="activeModal = 'none'">
      <section class="paper-card modal-sheet scroll-soft">
        <div class="washi-tape"></div>
        <div class="modal-head">
          <div>
            <h2>Garden Field Guide</h2>
            <small>Core tactical rules &amp; produce matchups</small>
          </div>
          <button class="paper-btn icon-only" aria-label="Close" @click="activeModal = 'none'">
            <CraftIcon name="close" :size="17" />
          </button>
        </div>

        <div class="guide-grid">
          <div class="guide-item">
            <div class="g-badge sky"><CraftIcon name="move" :size="17" /></div>
            <div>
              <strong>3 Action Slots, Any Order</strong>
              <small>Move, Attack, and Skill/Bag (shared utility slot) can be used in any order. Skills always preview before casting.</small>
            </div>
          </div>
          <div class="guide-item">
            <div class="g-badge gold"><CraftIcon name="skill" :size="17" /></div>
            <div>
              <strong>Dash &amp; Team-Jump</strong>
              <small>Dash orange-ringed farmers before finishing Move (still walk after!), or tap gold tiles to vault off allies.</small>
            </div>
          </div>
          <div class="guide-item">
            <div class="g-badge tan"><CraftIcon name="shield_half" :size="17" /></div>
            <div>
              <strong>Discrete Destructible Cover</strong>
              <small>Exposed 100% · Half Crate 50% · Full Haystack/Stone 0%. Flank, lob, or smash cover!</small>
            </div>
          </div>
          <div class="guide-item">
            <div class="g-badge green"><CraftIcon name="heart" :size="17" /></div>
            <div>
              <strong>Tap Again to Deselect</strong>
              <small>Tap an active hero, inspected farmer, or outside the board to clear focus cleanly.</small>
            </div>
          </div>
        </div>

        <div class="triangle-panel">
          <strong>Matchup Triangle (+30% Strong / -20% Weak)</strong>
          <div class="tri-rows">
            <div class="tri-row">
              <img src="/sprites/potato.png" alt="Root" />
              <span><strong>Roots</strong> beat <strong>Sprayers</strong></span>
              <img src="/sprites/sprayer.png" alt="Sprayer" />
            </div>
            <div class="tri-row">
              <img src="/sprites/pea.png" alt="Vine" />
              <span><strong>Vines</strong> beat <strong>Diggers</strong></span>
              <img src="/sprites/digger.png" alt="Digger" />
            </div>
            <div class="tri-row">
              <img src="/sprites/lemon.png" alt="Fruit" />
              <span><strong>Fruits</strong> beat <strong>Blades</strong></span>
              <img src="/sprites/trimmer.png" alt="Blade" />
            </div>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.title-stage {
  width: 100%;
  height: 100dvh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: calc(14px + var(--safe-top)) calc(14px + var(--safe-right))
    calc(16px + var(--safe-bottom)) calc(14px + var(--safe-left));
  position: relative;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
}

.title-stage.has-3d {
  justify-content: flex-end;
  padding-bottom: calc(28px + var(--safe-bottom));
}

.title-webgl-bg {
  position: fixed;
  inset: 0;
  width: 100%;
  height: 100%;
  display: block;
  z-index: 0;
  pointer-events: none;
}

.title-vignette {
  position: fixed;
  inset: 0;
  z-index: 1;
  pointer-events: none;
  background: radial-gradient(
    ellipse at 50% 42%,
    rgba(30, 14, 4, 0) 35%,
    rgba(28, 12, 4, 0.45) 100%
  );
}

.top-bar {
  position: fixed;
  top: calc(10px + var(--safe-top));
  left: calc(12px + var(--safe-left));
  right: calc(12px + var(--safe-right));
  display: flex;
  justify-content: space-between;
  align-items: center;
  z-index: 10;
  pointer-events: none;
}

.top-bar > * {
  pointer-events: auto;
}

.seed-badge {
  cursor: pointer;
  background: #fde89b;
  padding: 5px 11px;
  font-size: 0.82rem;
  color: var(--ink);
}

.icon-only {
  min-width: 38px;
  min-height: 38px;
  padding: 7px;
}

.cover-card {
  position: relative;
  z-index: 5;
  width: 100%;
  max-width: 490px;
  padding: 22px 20px 18px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  text-align: center;
}

.cover-card.compact-3d {
  max-width: 430px;
  padding: 16px 18px 15px;
  gap: 11px;
  background: rgba(248, 236, 208, 0.94);
  backdrop-filter: blur(4px);
}

.title-lockup {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  width: 100%;
}

.tagline {
  margin: 0;
  font-size: 0.86rem;
  font-weight: 700;
  color: var(--ink-soft);
}

/* Mini Paper-Craft Diorama Strip */
.diorama-showcase {
  width: 100%;
  padding-top: 6px;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.standee-row {
  width: 100%;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  gap: 4px;
  padding: 0 4px;
  margin-bottom: -9px;
  position: relative;
  z-index: 2;
}

.team-left,
.team-right {
  display: flex;
  align-items: flex-end;
}

.st {
  height: 70px;
  width: auto;
  object-fit: contain;
  filter: drop-shadow(0 4px 4px rgba(42, 20, 6, 0.32));
  animation: standeeBob 3.2s ease-in-out infinite;
}

.st-1 { height: 68px; margin-right: -8px; animation-delay: 0s; }
.st-2 { height: 74px; margin-right: -8px; animation-delay: 0.4s; }
.st-3 { height: 58px; margin-right: -6px; animation-delay: 0.8s; }
.st-4 { height: 62px; animation-delay: 1.2s; }
.st-crate { height: 46px; margin: 0 3px; animation: none; }
.st-5 { height: 78px; margin-right: -14px; animation-delay: 0.5s; }
.st-trim { height: 82px; margin-right: -12px; animation-delay: 0.7s; }
.st-6 { height: 96px; animation-delay: 0.9s; }

@keyframes standeeBob {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-2.5px); }
}

.cardboard-grass-strip {
  width: 100%;
  height: 20px;
  background:
    var(--tex-tooth) center / 220px 220px repeat,
    linear-gradient(180deg, #8db74e 0%, #6f9837 100%);
  border: 2px solid var(--ink);
  border-radius: 9px 9px 5px 5px;
  position: relative;
  overflow: hidden;
  box-shadow: 0 3px 0 #7b522a, 0 5px 0 var(--ink), 0 8px 14px rgba(42, 20, 6, 0.28);
}

.corrugated-edge {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 7px;
  background: repeating-linear-gradient(
    90deg,
    #6b4422 0px,
    #6b4422 5px,
    #9e6d3d 5px,
    #9e6d3d 10px
  );
  border-top: 1.4px solid var(--ink);
}

.audio-controls {
  display: flex;
  gap: 6px;
}

.music-btn.off {
  opacity: 0.65;
}

.heat-panel {
  width: 100%;
  background: rgba(255, 250, 236, 0.9);
  border: 2px solid var(--ink);
  border-radius: 12px;
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  text-align: left;
}

.heat-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  font-size: 0.8rem;
}

.heat-bonus {
  background: #ffd978;
  border: 1.4px solid var(--ink);
  border-radius: 999px;
  padding: 1px 8px;
  font-size: 0.69rem;
  font-weight: 800;
  color: #5e2c00;
}

.heat-bonus.muted {
  background: #ece0c8;
  color: var(--ink-soft);
}

.heat-pills {
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  gap: 5px;
}

.heat-pill {
  border: 1.8px solid var(--ink);
  border-radius: 8px;
  padding: 4px 2px;
  font-size: 0.72rem;
  font-weight: 900;
  background: #f5e6c5;
  color: var(--ink);
  cursor: pointer;
}

.heat-pill.active {
  background: linear-gradient(180deg, #ff9938 0%, #e04d1f 100%);
  color: #fffef5;
  box-shadow: 0 2px 0 var(--ink);
}

.heat-pill.locked {
  opacity: 0.45;
  cursor: not-allowed;
  background: #e4d8bf;
}

.heat-desc {
  font-size: 0.71rem;
  color: var(--ink-soft);
  line-height: 1.25;
}

.cta-stack {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 2px;
}

.cta-main {
  width: 100%;
  min-height: 46px;
  font-size: 1.02rem;
}

.secondary-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.secondary-row.three-col {
  grid-template-columns: 1.15fr 1fr 0.85fr;
  gap: 6px;
}

.sec-btn {
  min-height: 40px;
  font-size: 0.82rem;
  padding-inline: 8px;
}

.mini-count {
  background: #fde68a;
  border: 1.3px solid var(--ink);
  border-radius: 999px;
  padding: 0 6px;
  font-size: 0.74rem;
}

.daily-row {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 8px;
}

.daily-btn {
  justify-content: flex-start;
  text-align: left;
  min-height: 46px;
}

.daily-copy {
  display: flex;
  flex-direction: column;
  line-height: 1.15;
}

.daily-copy small {
  font-weight: 500;
  opacity: 0.9;
}

.score-tabs {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  margin: 12px 0;
}

.scope-tabs {
  margin-bottom: 8px;
}

.name-field {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  font-size: 0.86rem;
  color: var(--ink-soft);
}

.name-field input {
  flex: 0 1 11.5em;
  min-width: 0;
  font: inherit;
  font-family: 'Fredoka', sans-serif;
  color: var(--ink);
  background: #fffaf0;
  border: 2px solid var(--ink);
  border-radius: 10px;
  padding: 6px 10px;
}

.score-name {
  font-weight: 500;
  font-size: 0.92rem;
}

.score-tab {
  min-height: 40px;
}

.score-board {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 7px;
}

.score-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 9px 12px;
  color: var(--ink);
}

.score-rank {
  font-family: 'Fredoka', sans-serif;
  font-weight: 700;
  width: 1.6em;
  text-align: center;
  color: var(--ink-soft);
}

.score-meta {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.score-meta strong {
  font-family: 'Fredoka', sans-serif;
  font-size: 1.1rem;
  font-variant-numeric: tabular-nums;
}

.score-meta small,
.score-date {
  color: var(--ink-soft);
}

.score-empty {
  color: var(--ink-soft);
  text-align: center;
  margin: 18px 6px;
}

/* Modals */
.modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(38, 17, 4, 0.62);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: calc(16px + var(--safe-top)) 14px calc(16px + var(--safe-bottom));
  z-index: 40;
}

.modal-sheet {
  width: 100%;
  max-width: 500px;
  max-height: calc(100dvh - 40px - var(--safe-top) - var(--safe-bottom));
  padding: 20px 18px;
  display: flex;
  flex-direction: column;
  gap: 13px;
}

.modal-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 10px;
}

.modal-head small {
  color: var(--ink-soft);
  font-size: 0.8rem;
}

.shed-stats {
  display: flex;
  gap: 7px;
  flex-wrap: wrap;
}

.gold-pill {
  background: #fde89b;
}

.unlock-list {
  display: flex;
  flex-direction: column;
  gap: 9px;
}

.unlock-card {
  padding: 15px 13px 11px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.unlock-card.owned {
  background: #e6f5dc;
  border-color: var(--leaf-dark);
}

.unlock-copy strong {
  display: block;
  font-family: 'Fredoka', sans-serif;
  font-size: 0.92rem;
}

.unlock-copy small {
  display: block;
  font-size: 0.78rem;
  color: var(--ink-soft);
  line-height: 1.3;
}

.buy-btn {
  min-width: 66px;
  flex-shrink: 0;
}

.owned-pill {
  background: #c8ebb5;
  color: #205218;
  flex-shrink: 0;
}

.guide-grid {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.guide-item {
  display: flex;
  align-items: flex-start;
  gap: 9px;
  background: rgba(255, 251, 240, 0.85);
  border: 1.6px solid rgba(69, 42, 22, 0.24);
  border-radius: 11px;
  padding: 9px 10px;
}

.g-badge {
  width: 30px;
  height: 30px;
  border-radius: 9px;
  border: 1.7px solid var(--ink);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.g-badge.sky { background: #b4e5f5; }
.g-badge.gold { background: #fde68a; }
.g-badge.tan { background: #e8cfa6; }
.g-badge.green { background: #c9eeb9; }

.guide-item strong {
  display: block;
  font-family: 'Fredoka', sans-serif;
  font-size: 0.88rem;
}

.guide-item small {
  display: block;
  font-size: 0.76rem;
  color: var(--ink-soft);
  line-height: 1.3;
}

.triangle-panel {
  background: #f5e6c3;
  border: 1.8px solid var(--ink);
  border-radius: 11px;
  padding: 10px 11px;
  display: flex;
  flex-direction: column;
  gap: 7px;
  font-size: 0.82rem;
}

.tri-rows {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.tri-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: #fffaf0;
  border: 1.5px solid rgba(69, 42, 22, 0.28);
  border-radius: 9px;
  padding: 4px 9px;
}

.tri-row img {
  height: 32px;
  width: 32px;
  object-fit: contain;
}

@media (max-width: 480px) {
  .cover-card {
    padding: 18px 14px 15px;
    gap: 11px;
  }
  .st-1 { height: 50px; }
  .st-2 { height: 55px; }
  .st-3 { height: 44px; }
  .st-4 { height: 48px; }
  .st-crate { height: 35px; }
  .st-5 { height: 58px; margin-right: -12px; }
  .st-trim { height: 62px; margin-right: -10px; }
  .st-6 { height: 74px; }
}
</style>
