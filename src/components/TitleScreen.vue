<script setup lang="ts">
import { ref } from 'vue';
import { META_UNLOCK_COSTS } from '../engine/run';
import type { MetaProgress } from '../engine/types';
import {
  buyMetaUnlock,
  continueSavedRun,
  gameStore,
  startNewSeasonRun,
  toggleAudioMute,
} from '../stores/gameStore';
import CraftIcon from './CraftIcon.vue';
import CropRevoltLogo from './CropRevoltLogo.vue';

const activeModal = ref<'none' | 'shed' | 'guide'>('none');

const unlockKeys: Array<keyof MetaProgress['unlocks']> = [
  'extraItemSatchel',
  'heirloomSoil',
  'starterRelic',
];
</script>

<template>
  <div class="title-stage">
    <!-- Top floating audio & seed pills -->
    <div class="top-bar">
      <button class="paper-pill seed-badge" @click="activeModal = 'shed'">
        <CraftIcon name="seed" :size="15" />
        <span>{{ gameStore.meta.heirloomSeeds }} Seeds</span>
      </button>
      <button class="paper-btn icon-only" aria-label="Toggle sound" @click="toggleAudioMute">
        <CraftIcon :name="gameStore.muted ? 'sound_off' : 'sound_on'" :size="18" />
      </button>
    </div>

    <!-- Main Centered Paper-Craft Game Cover -->
    <main class="cover-card corrugated-slab pinned-card">
      <div class="washi-tape"></div>
      <span class="brass-pin tl"></span>
      <span class="brass-pin tr"></span>

      <div class="title-lockup">
        <CropRevoltLogo />
        <p class="tagline">
          Vertical paper-craft tactical roguelite — produce vs. farmers
        </p>
      </div>

      <!-- Mini Live Paper-Craft Diorama Strip -->
      <div class="diorama-showcase">
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
          </span>
        </button>

        <div class="secondary-row">
          <button class="paper-btn sec-btn" @click="activeModal = 'shed'">
            <CraftIcon name="shed" :size="16" />
            <span>Seed Shed</span>
            <span class="mini-count">{{ gameStore.meta.heirloomSeeds }}</span>
          </button>

          <button class="paper-btn sec-btn" @click="activeModal = 'guide'">
            <CraftIcon name="book" :size="16" />
            <span>Field Guide</span>
          </button>
        </div>
      </div>
    </main>

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
  width: 100%;
  max-width: 490px;
  padding: 22px 20px 18px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  text-align: center;
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

.sec-btn {
  min-height: 40px;
  font-size: 0.86rem;
}

.mini-count {
  background: #fde68a;
  border: 1.3px solid var(--ink);
  border-radius: 999px;
  padding: 0 6px;
  font-size: 0.74rem;
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
