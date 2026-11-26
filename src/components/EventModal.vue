<script setup lang="ts">
import { computed } from 'vue';
import { EVENT_REGISTRY } from '../engine/events';
import { chooseEventOption, closeEventToMap, gameStore } from '../stores/gameStore';
import CraftIcon from './CraftIcon.vue';

const run = computed(() => gameStore.run!);
const pending = computed(() => run.value.pendingEvent!);
const event = computed(() => EVENT_REGISTRY[pending.value.eventId]);
const resolved = computed(() => pending.value.outcome !== null);
</script>

<template>
  <div class="event-page">
    <div class="corrugated-slab event-shell pinned-card">
      <div class="washi-tape"></div>
      <span class="brass-pin tl"></span>
      <span class="brass-pin tr"></span>

      <header class="event-head">
        <span class="type-chip">? Mystery</span>
        <h2>{{ event.title }}</h2>
        <div class="spoils-strip">
          <span class="paper-pill seed-pill"><CraftIcon name="seed" :size="14" /> {{ run.seeds }} Run Seeds</span>
        </div>
      </header>

      <div class="event-body scroll-soft">
        <div class="vignette seed-packet">
          <img class="vignette-sprite" :src="event.sprite" alt="" />
          <p>{{ event.text }}</p>
        </div>

        <div v-if="!resolved" class="choice-list">
          <button
            v-for="(choice, i) in event.choices"
            :key="choice.label"
            class="seed-packet choice-btn"
            :disabled="Boolean(choice.blockedReason?.(run))"
            @click="chooseEventOption(i)"
          >
            <strong>{{ choice.label }}</strong>
            <small>{{ choice.blockedReason?.(run) ?? choice.hint }}</small>
          </button>
        </div>

        <div v-else class="outcome seed-packet" aria-live="polite">
          <small class="picked">You chose: {{ event.choices[pending.choiceIndex ?? 0]?.label }}</small>
          <ul>
            <li v-for="(line, i) in pending.outcome" :key="i">{{ line }}</li>
          </ul>
        </div>
      </div>

      <footer v-if="resolved" class="event-foot">
        <button class="paper-btn primary diecut done-btn" @click="closeEventToMap">
          <CraftIcon name="map" :size="18" />
          <span>Continue to Garden Trail →</span>
        </button>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.event-page {
  width: 100%;
  height: 100dvh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: calc(12px + var(--safe-top)) calc(12px + var(--safe-right))
    calc(12px + var(--safe-bottom)) calc(12px + var(--safe-left));
}

.event-shell {
  width: 100%;
  max-width: 620px;
  max-height: calc(100dvh - 34px - var(--safe-top) - var(--safe-bottom));
  display: flex;
  flex-direction: column;
  overflow: visible;
}

.event-head {
  padding: 22px 20px 12px;
  border-bottom: 2px dashed rgba(69, 42, 22, 0.24);
  flex-shrink: 0;
}

.type-chip {
  display: inline-block;
  font-family: 'Fredoka', sans-serif;
  font-size: 0.72rem;
  font-weight: 800;
  letter-spacing: 0.6px;
  text-transform: uppercase;
  color: #7a3fb0;
  margin-bottom: 4px;
}

.spoils-strip {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
}

.seed-pill {
  background: #fde89b;
}

.event-body {
  flex: 1;
  min-height: 0;
  padding: 16px 20px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.vignette {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 16px 14px 14px;
  color: var(--ink);
}

.vignette-sprite {
  width: 72px;
  height: 72px;
  object-fit: contain;
  flex-shrink: 0;
  filter: drop-shadow(0 3px 3px rgba(42, 20, 6, 0.28));
}

.vignette p {
  margin: 0;
  line-height: 1.45;
}

.choice-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.choice-btn {
  text-align: left;
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 14px 14px 12px;
  color: var(--ink);
  cursor: pointer;
  touch-action: manipulation;
  transition: transform 0.12s ease, box-shadow 0.12s ease;
}

.choice-btn strong {
  font-family: 'Fredoka', sans-serif;
  font-size: 1rem;
}

.choice-btn small {
  color: var(--ink-soft);
}

.choice-btn:not(:disabled):hover {
  transform: translateY(-2px);
  border-color: #964410;
  box-shadow: 0 0 0 2.5px rgba(246, 204, 82, 0.62), var(--shadow-cutout);
}

.choice-btn:disabled {
  opacity: 0.55;
  cursor: default;
}

.outcome {
  padding: 14px 16px;
  color: var(--ink);
  background:
    linear-gradient(180deg, rgba(240, 250, 228, 0.92) 0%, rgba(222, 240, 204, 0.92) 100%),
    var(--tex-paper) center / 300px 300px repeat;
}

.outcome .picked {
  color: var(--ink-soft);
}

.outcome ul {
  margin: 6px 0 0;
  padding-left: 18px;
  font-family: 'Fredoka', sans-serif;
  line-height: 1.5;
}

.event-foot {
  padding: 12px 20px 14px;
  border-top: 2px dashed rgba(69, 42, 22, 0.24);
  background: rgba(251, 244, 225, 0.92);
  border-radius: 0 0 10px 10px;
  flex-shrink: 0;
}

.done-btn {
  width: 100%;
  min-height: 48px;
  font-size: 1.02rem;
}

@media (max-width: 600px) {
  .event-head { padding: 18px 14px 10px; }
  .event-body { padding: 12px 14px; }
  .event-foot { padding: 10px 14px 12px; }
  .vignette-sprite { width: 56px; height: 56px; }
}
</style>
