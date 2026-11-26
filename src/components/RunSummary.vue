<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { GRAFT_REGISTRY } from '../data/grafts';
import {
  flushQueuedScores,
  loadPlayerName,
  onlineConfig,
  queueScore,
  toRow,
} from '../engine/onlineScores';
import { computeRunScore, loadScores, rankOf, scoreEntryForRun } from '../engine/score';
import { gameStore, playAgain, returnToTitle } from '../stores/gameStore';
import CraftIcon from './CraftIcon.vue';

const run = computed(() => gameStore.run!);
const isVictory = computed(() => run.value.status === 'victory');
const isDaily = computed(() => run.value.mode === 'daily');
const score = computed(() => computeRunScore(run.value));
/** 1-based place on this device's board (the run was recorded when it ended), 0 if off the board. */
const rank = computed(() => rankOf(loadScores(), scoreEntryForRun(run.value)));
const fmt = (n: number) => n.toLocaleString('en-US');

/** Upload to the shared board when one is configured; unsent scores stay queued for later. */
const online = onlineConfig();
const playerName = online ? loadPlayerName() : '';
const uploadState = ref<'sending' | 'sent' | 'queued'>('sending');
onMounted(async () => {
  if (!online) return;
  queueScore(toRow(scoreEntryForRun(run.value), playerName));
  uploadState.value = (await flushQueuedScores(online)) === 0 ? 'sent' : 'queued';
});
</script>

<template>
  <div class="summary-page">
    <div class="paper-card summary-card">
      <div class="washi-tape"></div>

      <div class="ribbon" :class="{ defeat: !isVictory }">
        <CraftIcon :name="isVictory ? 'trophy' : 'bag'" :size="18" />
        <span>
          {{
            isVictory
              ? run.seasonId === 'autumn'
                ? 'FULL HARVEST VICTORY!'
                : run.seasonId === 'summer'
                  ? 'SUMMER GREENHOUSE VICTORY!'
                  : 'SPRING REVOLT VICTORY!'
              : 'SQUAD HARVESTED!'
          }}
        </span>
      </div>

      <h1>{{ isVictory ? 'The Garden Stands Free!' : 'Bagged by the Farmers...' }}</h1>
      <p class="desc">
        {{
          isVictory
            ? run.seasonId === 'autumn'
              ? 'Lord Bramblecoat fell in a whirl of crimson leaves! Spring, Summer and Autumn: the whole garden is free.'
              : run.seasonId === 'summer'
              ? 'Baron Combine ground to a halt in a burst of steam and popcorn! Your heirloom squad rules the Summer Greenhouse.'
              : 'Captain Scarecrow toppled in a shower of straw! Your heirloom squad rules the Spring Patch.'
            : 'Every revolt plants stronger seeds. Visit the Seed Shed to unlock permanent perks for your next run!'
        }}
      </p>

      <div class="stat-pills">
        <span class="paper-pill">
          <CraftIcon name="trophy" :size="15" /> {{ run.battlesWon }} Battles Won
        </span>
        <span class="paper-pill">
          <CraftIcon name="attack" :size="15" /> {{ run.enemiesDefeated }} Routed
        </span>
        <span class="paper-pill seed-pill">
          <CraftIcon name="seed" :size="15" /> {{ gameStore.meta.heirloomSeeds }} Seeds
        </span>
      </div>

      <div class="seed-packet score-card" aria-label="Run score">
        <div class="score-head">
          <span class="score-kicker">{{ isDaily ? `Daily Run · ${run.dailyKey}` : 'Run Score' }}</span>
          <strong class="score-total">{{ fmt(score.total) }}</strong>
          <span v-if="rank === 1" class="paper-pill rank-pill best">★ New best on this device!</span>
          <span v-else-if="rank > 0" class="paper-pill rank-pill">#{{ rank }} on this device</span>
        </div>
        <small v-if="online" class="upload-note" aria-live="polite">
          {{
            uploadState === 'sent'
              ? `Posted to the shared board as ${playerName}.`
              : uploadState === 'queued'
                ? "Couldn't reach the shared board. Your score is saved and will be sent next time."
                : 'Posting to the shared board…'
          }}
        </small>
        <dl class="score-lines">
          <div v-for="line in score.lines" :key="line.label" class="score-line">
            <dt>{{ line.label }} <small>{{ line.detail }}</small></dt>
            <dd>{{ fmt(line.points) }}</dd>
          </div>
          <div v-if="score.heat > 0" class="score-line heat">
            <dt>Harvest Heat {{ score.heat }} <small>× {{ score.heatMult.toFixed(1) }}</small></dt>
            <dd>+{{ fmt(score.total - score.subtotal) }}</dd>
          </div>
        </dl>
      </div>

      <div class="final-squad">
        <h3>Final Produce Roster</h3>
        <div class="squad-chips">
          <div
            v-for="h in run.roster"
            :key="h.uid"
            class="seed-packet squad-chip"
            :class="{ bagged: h.harvested }"
          >
            <img class="sum-thumb" :src="`/sprites/${h.species}.png`" :alt="h.name" />
            <strong>{{ h.name }}</strong>
            <small>{{ h.harvested ? 'Bagged' : `${h.tier} · ${h.hp}/${h.maxHp} HP` }}</small>
            <div v-if="h.graftIds.length > 0" class="g-list">
              <span v-for="gid in h.graftIds" :key="gid">{{ GRAFT_REGISTRY[gid]?.badgeIcon }}</span>
            </div>
          </div>
        </div>
      </div>

      <div class="actions">
        <button class="paper-btn primary diecut act-btn" @click="playAgain()">
          <CraftIcon name="play" :size="18" /> {{ isDaily ? 'Retry Daily Run' : 'Play Another Run' }}
        </button>
        <button class="paper-btn gold diecut act-btn" @click="returnToTitle">
          <CraftIcon name="shed" :size="18" /> Seed Shed
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.summary-page {
  width: 100%;
  height: 100dvh;
  display: flex;
  align-items: safe center;
  justify-content: center;
  padding: calc(18px + var(--safe-top)) calc(14px + var(--safe-right))
    calc(18px + var(--safe-bottom)) calc(14px + var(--safe-left));
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
}

.summary-card {
  max-width: 580px;
  width: 100%;
  padding: 28px 24px 24px;
  text-align: center;
  display: flex;
  flex-direction: column;
  gap: 15px;
  align-items: center;
}

.ribbon {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-family: 'Fredoka', sans-serif;
  font-weight: 700;
  padding: 6px 18px;
  border-radius: var(--radius-tag);
  border: 2px solid var(--ink);
  background:
    var(--tex-tooth) center / 200px 200px repeat,
    linear-gradient(178deg, #f5d674 0%, #e0ab3c 100%);
  box-shadow: 0 0 0 2.5px var(--paper-edge), 0 3px 7px rgba(38, 17, 4, 0.22);
  position: relative;
}

.ribbon::before {
  content: '';
  position: absolute;
  inset: 2.5px;
  border-radius: 8px;
  border: 1.1px dashed rgba(74, 44, 23, 0.28);
  pointer-events: none;
}

.ribbon.defeat {
  background:
    var(--tex-tooth) center / 200px 200px repeat,
    linear-gradient(178deg, #dc6650 0%, #b43e2d 100%);
  color: #fffdf5;
}

.ribbon.defeat::before {
  border-color: rgba(255, 246, 224, 0.45);
}

.desc {
  margin: 0;
  color: var(--ink-soft);
  font-size: 0.92rem;
}

.stat-pills {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: center;
}

.seed-pill {
  background: #fde89b;
}

.score-card {
  width: 100%;
  padding: 14px 16px 12px;
  color: var(--ink);
  text-align: left;
}

.score-head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 10px;
}

.score-kicker {
  font-family: 'Fredoka', sans-serif;
  font-size: 0.72rem;
  font-weight: 800;
  letter-spacing: 0.6px;
  text-transform: uppercase;
  color: var(--ink-soft);
  flex-basis: 100%;
}

.score-total {
  font-family: 'Fredoka', sans-serif;
  font-size: 2.3rem;
  line-height: 1;
  font-variant-numeric: tabular-nums;
}

.rank-pill {
  align-self: center;
}

.rank-pill.best {
  background: #fde89b;
}

.upload-note {
  display: block;
  margin-top: 6px;
  color: var(--ink-soft);
}

.score-lines {
  margin: 10px 0 0;
  border-top: 2px dashed rgba(69, 42, 22, 0.22);
  padding-top: 8px;
  display: grid;
  gap: 3px;
}

.score-line {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  font-size: 0.9rem;
}

.score-line dt small {
  color: var(--ink-soft);
  margin-left: 4px;
}

.score-line dd {
  margin: 0;
  font-family: 'Fredoka', sans-serif;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.score-line.heat dd {
  color: #b4441a;
}

.final-squad {
  width: 100%;
  border-top: 2px dashed rgba(69, 42, 22, 0.25);
  padding-top: 12px;
}

.squad-chips {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(105px, 1fr));
  gap: 8px;
  margin-top: 10px;
}

.squad-chip {
  padding: 13px 8px 9px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
}

.sum-thumb {
  height: 50px;
  width: auto;
  object-fit: contain;
  filter: drop-shadow(0 3px 3px rgba(42, 20, 6, 0.26));
}

.squad-chip.bagged {
  opacity: 0.58;
  filter: grayscale(0.5);
}

.actions {
  width: 100%;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  margin-top: 4px;
}

.act-btn {
  min-height: 48px;
}

@media (max-width: 480px) {
  .summary-card {
    padding: 24px 16px 18px;
  }
  .actions {
    grid-template-columns: 1fr;
  }
}
</style>
