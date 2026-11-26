<script setup lang="ts">
import { computed } from 'vue';
import BattleView from './components/BattleView.vue';
import EventModal from './components/EventModal.vue';
import RewardModal from './components/RewardModal.vue';
import RunSummary from './components/RunSummary.vue';
import SeasonMap from './components/SeasonMap.vue';
import TitleScreen from './components/TitleScreen.vue';
import { gameStore } from './stores/gameStore';

const activeSceneKey = computed(() => {
  if (gameStore.screen === 'title' || !gameStore.run) return 'title';
  const st = gameStore.run.status;
  if (st === 'battle' && gameStore.battle) return `battle_${gameStore.battle.mapId}`;
  if ((st === 'reward' || st === 'vault' || st === 'shop') && gameStore.run.pendingReward) return `reward_${st}`;
  if (st === 'event' && gameStore.run.pendingEvent) return 'event';
  if (st === 'victory' || st === 'defeat') return `summary_${st}`;
  return `map_act_${gameStore.run.act}`;
});
</script>

<template>
  <div class="origami-stage">
    <Transition name="origami-flip" mode="out-in">
      <div :key="activeSceneKey" class="origami-page">
        <TitleScreen v-if="gameStore.screen === 'title' || !gameStore.run" />
        <BattleView v-else-if="gameStore.run.status === 'battle' && gameStore.battle" />
        <RewardModal
          v-else-if="(gameStore.run.status === 'reward' || gameStore.run.status === 'vault' || gameStore.run.status === 'shop') && gameStore.run.pendingReward"
        />
        <EventModal v-else-if="gameStore.run.status === 'event' && gameStore.run.pendingEvent" />
        <RunSummary
          v-else-if="gameStore.run.status === 'victory' || gameStore.run.status === 'defeat'"
        />
        <SeasonMap v-else />
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.origami-stage {
  width: 100%;
  height: 100dvh;
  perspective: 1400px;
  overflow: hidden;
  background: #3d2412;
}

.origami-page {
  width: 100%;
  height: 100%;
  transform-origin: 0% 50%;
  backface-visibility: hidden;
}

.origami-flip-enter-active {
  transition: transform 0.34s cubic-bezier(0.22, 0.85, 0.34, 1), opacity 0.24s ease;
}

.origami-flip-leave-active {
  transition: transform 0.22s cubic-bezier(0.55, 0.08, 0.85, 0.35), opacity 0.18s ease;
}

.origami-flip-enter-from {
  opacity: 0;
  transform: rotateY(-18deg) scale(0.97);
}

.origami-flip-leave-to {
  opacity: 0;
  transform: rotateY(16deg) scale(0.97);
}
</style>
