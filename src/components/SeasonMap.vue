<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { GRAFT_REGISTRY } from '../data/grafts';
import { ITEM_REGISTRY } from '../data/items';
import { RELIC_REGISTRY } from '../data/relics';
import { threatFor } from '../engine/difficulty';
import { ACTS, FLOORS_PER_ACT, MAX_LANES } from '../engine/mapgen';
import { getAvailableNextNodeIds } from '../engine/run';
import type { SeasonNode } from '../engine/types';
import {
  enterSeasonNode,
  gameStore,
  returnToTitle,
  toggleAudioMute,
  toggleSquadMember,
} from '../stores/gameStore';
import CraftIcon from './CraftIcon.vue';

const run = computed(() => gameStore.run!);
const availableIds = computed(() => new Set(getAvailableNextNodeIds(run.value)));

const mobileTab = ref<'trail' | 'squad'>('trail');
const inspectedInfo = ref<{ title: string; desc: string } | null>(null);

const act = computed(() => ACTS[run.value.act] ?? ACTS[0]);

/** Floors top-to-bottom for rendering: boss first, floor 0 last (the trail climbs upward). */
const floors = computed(() => {
  const grouped: SeasonNode[][] = Array.from({ length: FLOORS_PER_ACT + 1 }, () => []);
  for (const n of run.value.nodes) {
    (grouped[n.stage] ??= []).push(n);
  }
  return grouped
    .map((nodes, floor) => ({ floor, nodes, isBoss: nodes.some((n) => n.type === 'boss') }))
    .filter((row) => row.nodes.length > 0) // older saves have fewer floors
    .reverse();
});

const completedIds = computed(() => new Set(run.value.completedNodeIds));

// ---------- Selection (tap once to inspect, tap again or press Enter to go) ----------
const selectedId = ref<string | null>(null);
const hoveredId = ref<string | null>(null);
const focusNode = computed(() => {
  const id = hoveredId.value ?? selectedId.value;
  return id ? run.value.nodes.find((n) => n.id === id) ?? null : null;
});

function onNodeClick(node: SeasonNode): void {
  if (!availableIds.value.has(node.id)) {
    selectedId.value = node.id;
    return;
  }
  if (selectedId.value === node.id) {
    enterSeasonNode(node.id);
    return;
  }
  selectedId.value = node.id;
}

function enterSelected(): void {
  if (selectedId.value && availableIds.value.has(selectedId.value)) {
    enterSeasonNode(selectedId.value);
  }
}

// ---------- Trail lines (SVG drawn between node cards) ----------
const graphRef = ref<HTMLElement | null>(null);
const nodeEls = new Map<string, HTMLElement>();
const lines = ref<Array<{ key: string; d: string; state: 'done' | 'open' | 'idle' }>>([]);
const graphSize = ref({ w: 0, h: 0 });

function setNodeEl(id: string, el: unknown): void {
  if (el instanceof HTMLElement) nodeEls.set(id, el);
  else nodeEls.delete(id);
}

function anchor(el: HTMLElement, edge: 'top' | 'bottom'): { x: number; y: number } {
  // offset* ignores CSS transforms, so the pulsing cards don't make the lines wobble.
  return {
    x: el.offsetLeft + el.offsetWidth / 2,
    y: edge === 'top' ? el.offsetTop : el.offsetTop + el.offsetHeight,
  };
}

function layoutLines(): void {
  const graph = graphRef.value;
  if (!graph) return;
  graphSize.value = { w: graph.scrollWidth, h: graph.scrollHeight };
  const lastDone = run.value.completedNodeIds[run.value.completedNodeIds.length - 1];
  const out: typeof lines.value = [];
  for (const node of run.value.nodes) {
    const fromEl = nodeEls.get(node.id);
    if (!fromEl) continue;
    for (const nextId of node.nextIds) {
      const toEl = nodeEls.get(nextId);
      if (!toEl) continue;
      // Lower floors sit below, so lines run from the top of a node to the bottom of the next.
      const a = anchor(fromEl, 'top');
      const b = anchor(toEl, 'bottom');
      const midY = (a.y + b.y) / 2;
      const state =
        completedIds.value.has(node.id) && completedIds.value.has(nextId)
          ? 'done'
          : node.id === lastDone && availableIds.value.has(nextId)
            ? 'open'
            : 'idle';
      out.push({
        key: `${node.id}>${nextId}`,
        d: `M ${a.x} ${a.y} C ${a.x} ${midY}, ${b.x} ${midY}, ${b.x} ${b.y}`,
        state,
      });
    }
  }
  lines.value = out;
}

function scrollToCurrentFloor(): void {
  const firstAvailable = [...availableIds.value].map((id) => nodeEls.get(id)).find(Boolean);
  firstAvailable?.scrollIntoView({ block: 'center', inline: 'nearest' });
}

let resizeObserver: ResizeObserver | null = null;
onMounted(async () => {
  await nextTick();
  layoutLines();
  scrollToCurrentFloor();
  if (typeof ResizeObserver !== 'undefined' && graphRef.value) {
    resizeObserver = new ResizeObserver(() => layoutLines());
    resizeObserver.observe(graphRef.value);
  }
});
onBeforeUnmount(() => resizeObserver?.disconnect());

watch(
  () => [run.value.act, run.value.nodes.length, run.value.completedNodeIds.length],
  async () => {
    selectedId.value = null;
    await nextTick();
    layoutLines();
    scrollToCurrentFloor();
  }
);

function floorLabel(row: { floor: number; isBoss: boolean }): string {
  return row.isBoss ? 'ACT BOSS' : `FLOOR ${row.floor + 1}`;
}

function nodeSprite(type: SeasonNode['type']): string {
  switch (type) {
    case 'skirmish':
      return act.value.id === 'summer' ? '/sprites/beehive.png' : '/sprites/digger.png';
    case 'escape':
      return act.value.id === 'summer' ? '/sprites/sprinkler.png' : '/sprites/mower.png';
    case 'vault':
      return '/sprites/carrot.png';
    case 'shop':
      return '/sprites/corn.png';
    case 'event':
      return '';
    case 'barn_rescue':
      return '/sprites/cage.png';
    case 'elite':
      return act.value.id === 'summer' ? '/sprites/beehive.png' : '/sprites/sprayer.png';
    case 'boss':
      return act.value.id === 'autumn'
        ? '/sprites/harvester.png'
        : act.value.id === 'summer'
          ? '/sprites/tractor.png'
          : '/sprites/scarecrow.png';
  }
}

function nodeTypeTag(type: SeasonNode['type']): string {
  switch (type) {
    case 'skirmish':
      return 'Skirmish';
    case 'escape':
      return 'Breakout';
    case 'vault':
      return 'Safe Vault';
    case 'shop':
      return 'Compost Market';
    case 'event':
      return 'Mystery';
    case 'barn_rescue':
      return 'Barn Rescue';
    case 'elite':
      return 'Elite Fight';
    case 'boss':
      return 'Act Boss';
  }
}

function showDetail(title: string, desc?: string): void {
  if (!desc) return;
  inspectedInfo.value = { title, desc };
}

const harvestedCount = computed(() => run.value.roster.filter((h) => h.harvested).length);
</script>

<template>
  <div class="map-page">
    <!-- Top Kraft Ribbon Header -->
    <header class="map-topbar kraft-ribbon pinned-card">
      <span class="brass-pin tl"></span>
      <span class="brass-pin tr"></span>
      <div class="brand-left">
        <div class="season-title">
          <CraftIcon name="map" :size="20" />
          <h2>{{ run.seasonName }}</h2>
        </div>
        <div class="top-pills">
          <span class="paper-pill seed-pill">
            <CraftIcon name="seed" :size="14" /> {{ run.seeds }}
          </span>
          <span class="paper-pill">
            <CraftIcon name="trophy" :size="14" /> {{ run.battlesWon }}
          </span>
          <span v-if="harvestedCount > 0" class="paper-pill bagged-pill">
            <CraftIcon name="bag" :size="14" /> {{ harvestedCount }} Bagged
          </span>
        </div>
      </div>

      <div class="brand-right">
        <button class="paper-btn icon-btn" aria-label="Toggle Sound" @click="toggleAudioMute">
          <CraftIcon :name="gameStore.muted ? 'sound_off' : 'sound_on'" :size="18" />
        </button>
        <button class="paper-btn" @click="returnToTitle">← Title</button>
      </div>
    </header>

    <div class="map-layout">
      <!-- Illustrated Branching Parchment Garden Trail (outer shell prevents washi-tape clipping!) -->
      <section class="paper-card route-shell" :class="{ 'hide-mobile': mobileTab !== 'trail' }">
        <div class="washi-tape"></div>
        <div class="route-board">
          <div class="route-head">
            <h3>{{ act.trailTitle }}</h3>
            <small>{{ act.trailHint }}</small>
          </div>

          <!-- Inspect strip: what the hovered / tapped stop is, with an explicit Enter button -->
          <div class="node-detail" :class="{ empty: !focusNode }" aria-live="polite">
            <template v-if="focusNode">
              <span v-if="focusNode.type === 'event'" class="mystery-glyph detail-sprite">?</span>
              <img v-else class="detail-sprite" :src="nodeSprite(focusNode.type)" alt="" />
              <div class="detail-text">
                <span class="type-tag">
                  {{ nodeTypeTag(focusNode.type) }}
                  <span v-if="focusNode.mapId" class="threat-tag">· Threat {{ threatFor(run.act, focusNode.stage) }}</span>
                </span>
                <strong class="node-name">{{ focusNode.name }}</strong>
                <small class="node-sub">{{ focusNode.subtitle }}</small>
              </div>
              <button
                v-if="selectedId === focusNode.id && availableIds.has(focusNode.id)"
                class="paper-btn primary diecut enter-btn"
                @click="enterSelected"
              >
                <CraftIcon name="play" :size="14" /> Go
              </button>
            </template>
            <small v-else class="node-sub">Tap a glowing stop to see what's there, then tap it again to go.</small>
          </div>

          <div class="trail-scroll scroll-soft">
            <div
              ref="graphRef"
              class="trail-graph"
              :style="{ '--lanes': MAX_LANES }"
            >
              <svg
                class="trail-lines"
                :width="graphSize.w"
                :height="graphSize.h"
                :viewBox="`0 0 ${graphSize.w} ${graphSize.h}`"
                aria-hidden="true"
              >
                <path v-for="l in lines" :key="l.key" :d="l.d" :class="['trail-line', l.state]" />
              </svg>

              <div
                v-for="row in floors"
                :key="row.floor"
                class="floor-row"
                :class="{ 'boss-row': row.isBoss }"
              >
                <div class="stage-label">{{ floorLabel(row) }}</div>
                <div class="floor-lanes">
                  <button
                    v-for="node in row.nodes"
                    :key="node.id"
                    :ref="(el) => setNodeEl(node.id, el)"
                    class="seed-packet node-card compact"
                    :class="{
                      available: availableIds.has(node.id),
                      completed: node.completed,
                      selected: selectedId === node.id,
                      boss: node.type === 'boss',
                      vault: node.type === 'vault',
                      shop: node.type === 'shop',
                      rescue: node.type === 'barn_rescue',
                      elite: node.type === 'elite',
                    }"
                    :style="node.type === 'boss' ? undefined : { gridColumn: node.lane + 1 }"
                    :aria-label="`${nodeTypeTag(node.type)}: ${node.name}`"
                    :aria-disabled="!availableIds.has(node.id)"
                    @click="onNodeClick(node)"
                    @mouseenter="hoveredId = node.id"
                    @mouseleave="hoveredId = null"
                    @focus="hoveredId = node.id"
                    @blur="hoveredId = null"
                  >
                    <span v-if="node.type === 'event'" class="mystery-glyph node-sprite">?</span>
                    <img v-else class="node-sprite" :src="nodeSprite(node.type)" alt="" />
                    <span class="type-tag">{{ nodeTypeTag(node.type) }}</span>
                    <span v-if="node.completed" class="done-mark"><CraftIcon name="check" :size="11" /></span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- Squad, Relics, Satchel Panel -->
      <aside class="sidebar" :class="{ 'hide-mobile': mobileTab !== 'squad' }">
        <div class="paper-card squad-panel scroll-soft">
          <div class="panel-head">
            <h3>Revolt Squad ({{ run.activeSquadUids.length }}/4 Active)</h3>
            <small v-if="run.roster.length > 4">Tap a hero to swap Active / Bench</small>
          </div>

          <div class="hero-list">
            <div
              v-for="hero in run.roster"
              :key="hero.uid"
              class="hero-row"
              :class="{
                active: run.activeSquadUids.includes(hero.uid),
                harvested: hero.harvested,
                clickable: !hero.harvested && run.roster.length > 4,
              }"
              @click="!hero.harvested && run.roster.length > 4 && toggleSquadMember(hero.uid)"
            >
              <div class="hero-avatar">
                <img :src="`/sprites/${hero.species}.png`" :alt="hero.name" />
              </div>
              <div class="hero-meta">
                <div class="hero-name-line">
                  <strong>{{ hero.name }}</strong>
                  <span class="tier-tag" :class="hero.tier">{{ hero.tier }}</span>
                  <button
                    v-if="hero.coopPassive"
                    class="coop-tag"
                    @click.stop="showDetail(`${hero.name} Co-op Trait`, hero.coopPassive)"
                  >
                    Barnyard Co-op
                  </button>
                  <span v-if="hero.harvested" class="bag-tag">Bagged!</span>
                  <span v-else-if="run.roster.length > 4" class="bench-tag">
                    {{ run.activeSquadUids.includes(hero.uid) ? 'Active' : 'Bench' }}
                  </span>
                </div>
                <div class="hp-row">
                  <div class="hp-track">
                    <div
                      class="hp-fill"
                      :style="{ width: `${Math.round((hero.hp / hero.maxHp) * 100)}%` }"
                    ></div>
                  </div>
                  <small>{{ hero.hp }}/{{ hero.maxHp }} HP · {{ hero.weapon.damage }} ATK</small>
                </div>
                <div v-if="hero.graftIds.length > 0" class="graft-row">
                  <button
                    v-for="gid in hero.graftIds"
                    :key="gid"
                    class="graft-chip"
                    @click.stop="
                      showDetail(
                        `${GRAFT_REGISTRY[gid]?.badgeIcon} ${GRAFT_REGISTRY[gid]?.name}`,
                        GRAFT_REGISTRY[gid]?.description
                      )
                    "
                  >
                    {{ GRAFT_REGISTRY[gid]?.badgeIcon }} {{ GRAFT_REGISTRY[gid]?.name }}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="paper-card inventory-panel">
          <div v-if="inspectedInfo" class="tap-detail" @click="inspectedInfo = null">
            <strong>{{ inspectedInfo.title }}</strong>
            <small>{{ inspectedInfo.desc }}</small>
          </div>

          <div class="inv-block">
            <h4>Soil Relics <small class="tap-hint">(tap to inspect)</small></h4>
            <div v-if="run.relicIds.length === 0" class="empty-note">
              None yet — clear Breakout, Seed Vault, Barn Rescue, or Elite stops!
            </div>
            <div v-else class="pill-wrap">
              <button
                v-for="rid in run.relicIds"
                :key="rid"
                class="paper-pill pill-btn"
                @click="
                  showDetail(
                    `${RELIC_REGISTRY[rid]?.icon} ${RELIC_REGISTRY[rid]?.name}`,
                    RELIC_REGISTRY[rid]?.description
                  )
                "
              >
                {{ RELIC_REGISTRY[rid]?.icon }} {{ RELIC_REGISTRY[rid]?.name }}
              </button>
            </div>
          </div>

          <div class="inv-block">
            <h4>Garden Satchel</h4>
            <div class="pill-wrap">
              <button
                v-for="(count, iid) in run.items"
                :key="iid"
                class="paper-pill pill-btn"
                :class="{ zero: count <= 0 }"
                @click="
                  showDetail(
                    `${ITEM_REGISTRY[iid]?.icon} ${ITEM_REGISTRY[iid]?.name}`,
                    ITEM_REGISTRY[iid]?.description
                  )
                "
              >
                {{ ITEM_REGISTRY[iid]?.icon }} {{ ITEM_REGISTRY[iid]?.name }} ×{{ count }}
              </button>
            </div>
          </div>
        </div>
      </aside>
    </div>

    <!-- Bottom Sticky Corrugated Thumb Tab Switcher on Mobile -->
    <nav class="mobile-bottom-nav corrugated-slab">
      <button
        class="paper-btn nav-tab"
        :class="{ gold: mobileTab === 'trail' }"
        @click="mobileTab = 'trail'"
      >
        <CraftIcon name="map" :size="18" />
        <span>Garden Trail</span>
      </button>
      <button
        class="paper-btn nav-tab"
        :class="{ gold: mobileTab === 'squad' }"
        @click="mobileTab = 'squad'"
      >
        <CraftIcon name="squad" :size="18" />
        <span>Squad ({{ run.activeSquadUids.length }}/4) &amp; Bag</span>
      </button>
    </nav>
  </div>
</template>

<style scoped>
.map-page {
  width: 100%;
  height: 100dvh;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: calc(10px + var(--safe-top)) calc(12px + var(--safe-right))
    calc(18px + var(--safe-bottom)) calc(12px + var(--safe-left));
}

.map-topbar {
  padding: 7px 12px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-shrink: 0;
}

.brand-left,
.brand-right {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.season-title {
  display: flex;
  align-items: center;
  gap: 7px;
}

.season-title h2 {
  font-size: 1.2rem;
}

.top-pills {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.seed-pill {
  background: #fde89b;
}

.bagged-pill {
  background: #fde2d9;
  color: #8f2418;
}

.icon-btn {
  min-width: 40px;
  padding: 7px;
}

.map-layout {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: 1.6fr 1fr;
  gap: 14px;
}

.route-shell {
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: visible;
  margin-top: 6px;
}

.route-board {
  flex: 1;
  min-height: 0;
  padding: 20px 18px 18px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.route-head small {
  color: var(--ink-soft);
  font-size: 0.84rem;
}



.stage-label {
  text-align: center;
  font-family: 'Fredoka', sans-serif;
  font-size: 0.74rem;
  font-weight: 700;
  letter-spacing: 0.9px;
  color: var(--ink-soft);
}




.route-board {
  overflow: hidden;
}

.node-detail {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 64px;
  padding: 8px 12px;
  border-radius: 12px;
  border: 2px solid rgba(69, 42, 22, 0.28);
  background: rgba(255, 251, 240, 0.86);
  flex-shrink: 0;
}

.node-detail.empty {
  border-style: dashed;
  justify-content: center;
  text-align: center;
}

.detail-sprite {
  width: 44px;
  height: 44px;
  object-fit: contain;
  filter: drop-shadow(0 3px 3px rgba(42, 20, 6, 0.28));
  flex-shrink: 0;
}

.detail-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  flex: 1;
}

.mystery-glyph {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-family: 'Fredoka', sans-serif;
  font-weight: 800;
  font-size: 1.7rem;
  line-height: 1;
  color: #7a3fb0;
  background: rgba(244, 232, 255, 0.92);
  border: 2px solid var(--ink);
  border-radius: 999px;
  box-shadow: 0 2px 0 rgba(48, 28, 12, 0.25);
}

.threat-tag {
  color: #a3341f;
}

.enter-btn {
  flex-shrink: 0;
  padding: 8px 14px;
}

.trail-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  -webkit-overflow-scrolling: touch;
  padding: 4px 2px 10px;
}

.trail-graph {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 22px;
  padding: 6px 4px;
}

.trail-lines {
  position: absolute;
  inset: 0;
  pointer-events: none;
  overflow: visible;
}

.trail-line {
  fill: none;
  stroke: rgba(112, 76, 47, 0.38);
  stroke-width: 3;
  stroke-dasharray: 2 7;
  stroke-linecap: round;
}

.trail-line.done {
  stroke: rgba(74, 122, 40, 0.75);
  stroke-dasharray: none;
  stroke-width: 3.5;
}

.trail-line.open {
  stroke: #c2731c;
  stroke-dasharray: 6 6;
  stroke-width: 3.5;
}

.floor-row {
  display: grid;
  grid-template-columns: 62px 1fr;
  align-items: center;
  gap: 8px;
}

.floor-row .stage-label {
  text-align: left;
}

.floor-lanes {
  display: grid;
  grid-template-columns: repeat(var(--lanes, 4), minmax(0, 1fr));
  gap: 12px;
}

.boss-row .floor-lanes {
  grid-template-columns: 1fr;
  justify-items: center;
}

.node-card.compact {
  position: relative;
  z-index: 1;
  align-items: center;
  text-align: center;
  gap: 3px;
  padding: 9px 4px 7px;
  min-width: 0;
}

.node-card.compact .type-tag {
  font-size: 0.6rem;
  line-height: 1.1;
}

.boss-row .node-card.compact {
  width: min(180px, 60%);
  padding: 10px 8px 8px;
}

.boss-row .node-card.compact .node-sprite {
  width: 60px;
  height: 60px;
}

.node-card.compact[aria-disabled='true'] {
  opacity: 0.56;
  cursor: default;
}

.node-card.compact[aria-disabled='true'].completed {
  opacity: 0.88;
}

.node-card.compact.selected {
  box-shadow: 0 0 0 3px #c2731c, var(--shadow-cutout);
  animation: none;
  transform: translateY(-2px);
}

.done-mark {
  position: absolute;
  top: -6px;
  right: -6px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: 999px;
  background: #e2f5cf;
  border: 1.6px solid var(--ink);
}

.node-card {
  text-align: left;
  padding: 15px 11px 11px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  color: var(--ink);
  transition: transform 0.12s ease, box-shadow 0.12s ease;
  touch-action: manipulation;
}

.node-card:disabled {
  opacity: 0.56;
  cursor: default;
}

.node-card.available {
  opacity: 1;
  cursor: pointer;
  background:
    linear-gradient(180deg, rgba(255, 252, 232, 0.92) 0%, rgba(250, 228, 158, 0.92) 100%),
    var(--tex-paper) center / 300px 300px repeat;
  border-color: #964410;
  box-shadow: 0 0 0 2.5px rgba(246, 204, 82, 0.62), var(--shadow-cutout);
  animation: pulseCard 2.2s infinite ease-in-out;
}

.node-card.available:hover {
  transform: translateY(-2px);
}

@keyframes pulseCard {
  0%, 100% {
    transform: translateY(0) scale(1);
  }
  50% {
    transform: translateY(-2px) scale(1.015);
  }
}

.node-card.completed {
  background:
    linear-gradient(180deg, rgba(240, 250, 228, 0.92) 0%, rgba(222, 240, 204, 0.92) 100%),
    var(--tex-paper) center / 300px 300px repeat;
  opacity: 0.88;
}

.node-card.boss.available {
  background:
    linear-gradient(180deg, rgba(255, 240, 222, 0.92) 0%, rgba(245, 192, 148, 0.94) 100%),
    var(--tex-paper) center / 300px 300px repeat;
}

.node-card.shop.available {
  background:
    linear-gradient(180deg, rgba(255, 250, 214, 0.94) 0%, rgba(248, 218, 122, 0.94) 100%),
    var(--tex-paper) center / 300px 300px repeat;
}

.node-art-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.node-sprite {
  height: 46px;
  width: 46px;
  object-fit: contain;
  filter: drop-shadow(0 3px 3px rgba(42, 20, 6, 0.28));
}

.node-badges {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4px;
}

.type-tag {
  font-size: 0.68rem;
  font-weight: 800;
  text-transform: uppercase;
  color: var(--ink-soft);
}

.state-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-family: 'Fredoka', sans-serif;
  font-size: 0.72rem;
  font-weight: 700;
  padding: 2px 8px;
  border-radius: 999px;
  background: rgba(255, 252, 240, 0.88);
  border: 1.6px solid var(--ink);
}

.node-name {
  font-family: 'Fredoka', sans-serif;
  font-size: 0.94rem;
  line-height: 1.15;
}

.node-sub {
  font-size: 0.74rem;
  color: var(--ink-soft);
  line-height: 1.28;
}

.sidebar {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-height: 0;
}

.squad-panel {
  flex: 1;
  padding: 14px 15px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.panel-head small {
  color: var(--ink-soft);
  font-size: 0.78rem;
}

.hero-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.hero-row {
  display: flex;
  gap: 10px;
  align-items: center;
  padding: 8px 10px;
  border-radius: 12px;
  border: 2px solid rgba(69, 42, 22, 0.28);
  background: rgba(255, 251, 240, 0.84);
}

.hero-row.active {
  border-color: var(--leaf-dark);
  background: #f3fce7;
}

.hero-row.harvested {
  background: #f5e2dd;
  border-style: dashed;
  opacity: 0.78;
}

.hero-row.clickable {
  cursor: pointer;
}

.hero-avatar {
  width: 48px;
  height: 48px;
  border-radius: 12px;
  border: 2px solid var(--paper-edge);
  box-shadow: 0 0 0 1.6px var(--ink), 0 2px 5px rgba(42, 20, 6, 0.20);
  background:
    linear-gradient(180deg, rgba(255, 253, 247, 0.90) 0%, rgba(246, 236, 216, 0.92) 100%),
    var(--tex-paper) center / 220px 220px repeat;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 2px;
  flex-shrink: 0;
  position: relative;
}

.coop-tag {
  font-size: 0.66rem;
  font-weight: 800;
  padding: 1px 6px;
  border-radius: 6px;
  border: 1.4px solid var(--ink);
  background: #fde8b2;
  color: #6b3c0b;
  cursor: pointer;
}

.hero-avatar img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  filter: drop-shadow(0 2px 2px rgba(42, 20, 6, 0.25));
}

.hero-meta {
  flex: 1;
  min-width: 0;
}

.hero-name-line {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.tier-tag {
  font-size: 0.66rem;
  text-transform: uppercase;
  font-weight: 800;
  padding: 1px 6px;
  border-radius: 6px;
  border: 1.5px solid var(--ink);
  background: #f2e5c9;
}

.tier-tag.ripe { background: #d8f3c6; }
.tier-tag.heirloom { background: #fde078; }

.bag-tag {
  font-size: 0.72rem;
  font-weight: 800;
  color: #9e271b;
}

.bench-tag {
  margin-left: auto;
  font-size: 0.7rem;
  font-weight: 800;
  color: var(--ink-soft);
}

.hp-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 4px;
}

.hp-track {
  width: 74px;
  height: 8px;
  background: #dfd0b4;
  border: 1.5px solid var(--ink);
  border-radius: 999px;
  overflow: hidden;
}

.hp-fill {
  height: 100%;
  background: #5cb848;
}

.graft-row {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 4px;
}

.graft-chip {
  font-size: 0.72rem;
  padding: 2px 7px;
  border-radius: 6px;
  background: #fff6dc;
  border: 1.4px solid var(--ink);
  color: var(--ink);
  cursor: pointer;
}

.inventory-panel {
  padding: 12px 15px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.tap-detail {
  background: #fff4c8;
  border: 2px solid var(--ink);
  border-radius: 10px;
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  cursor: pointer;
}

.tap-detail small {
  font-size: 0.76rem;
  color: var(--ink-soft);
}

.inv-block h4 {
  font-size: 0.88rem;
  margin-bottom: 5px;
}

.tap-hint {
  font-weight: 600;
  color: var(--ink-soft);
  font-size: 0.74rem;
}

.empty-note {
  font-size: 0.78rem;
  color: var(--ink-soft);
}

.pill-wrap {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.pill-btn {
  cursor: pointer;
  color: var(--ink);
}

.paper-pill.zero {
  opacity: 0.45;
}

.mobile-bottom-nav {
  display: none;
  padding: 6px;
  gap: 8px;
  flex-shrink: 0;
}

.nav-tab {
  flex: 1;
  min-height: 44px;
}

@media (max-width: 860px) {
  .map-layout {
    grid-template-columns: 1fr;
    overflow: hidden;
  }

  .hide-mobile {
    display: none !important;
  }

  .mobile-bottom-nav {
    display: flex;
  }

  .route-board {
    padding: 18px 14px 16px;
  }




  .season-title h2 {
    font-size: 0.96rem;
  }

  .map-topbar {
    padding: 7px 10px;
    gap: 6px;
  }

  .brand-left {
    gap: 5px;
    min-width: 0;
  }

  .brand-right {
    gap: 5px;
    flex-shrink: 0;
    flex-wrap: nowrap;
  }

  .sidebar {
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
  }

  .squad-panel {
    flex: 0 0 auto;
  }

  .node-sprite {
    height: 34px;
    width: 34px;
  }

  .floor-row {
    grid-template-columns: 1fr;
    gap: 4px;
  }

  .floor-lanes {
    gap: 8px;
  }

  .trail-graph {
    gap: 16px;
  }
}

</style>
