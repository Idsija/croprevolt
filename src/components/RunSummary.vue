<script setup lang="ts">
import { computed } from 'vue';
import { GRAFT_REGISTRY } from '../data/grafts';
import { gameStore, returnToTitle, startNewSeasonRun } from '../stores/gameStore';
import CraftIcon from './CraftIcon.vue';

const run = computed(() => gameStore.run!);
const isVictory = computed(() => run.value.status === 'victory');
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
              ? run.seasonId === 'summer'
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
            ? run.seasonId === 'summer'
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
        <button class="paper-btn primary diecut act-btn" @click="startNewSeasonRun(run.seasonId)">
          <CraftIcon name="play" :size="18" /> Play Another Run
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
