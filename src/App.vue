<script setup lang="ts">
import BattleView from './components/BattleView.vue';
import RewardModal from './components/RewardModal.vue';
import RunSummary from './components/RunSummary.vue';
import SeasonMap from './components/SeasonMap.vue';
import TitleScreen from './components/TitleScreen.vue';
import { gameStore } from './stores/gameStore';
</script>

<template>
  <TitleScreen v-if="gameStore.screen === 'title' || !gameStore.run" />
  <BattleView v-else-if="gameStore.run.status === 'battle' && gameStore.battle" />
  <RewardModal
    v-else-if="(gameStore.run.status === 'reward' || gameStore.run.status === 'vault') && gameStore.run.pendingReward"
  />
  <RunSummary
    v-else-if="gameStore.run.status === 'victory' || gameStore.run.status === 'defeat'"
  />
  <SeasonMap v-else />
</template>
