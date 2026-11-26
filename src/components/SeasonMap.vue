<script setup lang="ts">
import { computed, ref } from 'vue';
import { GRAFT_REGISTRY } from '../data/grafts';
import { ITEM_REGISTRY } from '../data/items';
import { RELIC_REGISTRY } from '../data/relics';
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

const stages = computed(() => {
  const grouped: SeasonNode[][] = [[], [], [], []];
  for (const n of run.value.nodes) {
    grouped[n.stage].push(n);
  }
  return grouped;
});

function nodeSprite(type: SeasonNode['type']): string {
  switch (type) {
    case 'skirmish':
      return '/sprites/digger.png';
    case 'escape':
      return '/sprites/mower.png';
    case 'vault':
      return '/sprites/carrot.png';
    case 'barn_rescue':
      return '/sprites/cage.png';
    case 'elite':
      return '/sprites/sprayer.png';
    case 'boss':
      return '/sprites/scarecrow.png';
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
    case 'barn_rescue':
      return 'Barn Rescue';
    case 'elite':
      return 'Elite Fight';
    case 'boss':
      return 'Season Boss';
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
      <!-- Illustrated Branching Parchment Garden Trail -->
      <section class="paper-card route-board scroll-soft" :class="{ 'hide-mobile': mobileTab !== 'trail' }">
        <div class="washi-tape"></div>
        <div class="route-head">
          <h3>Garden Trail Map</h3>
          <small>Choose a glowing stop to march toward Captain Scarecrow</small>
        </div>

        <div class="stages-track">
          <div v-for="(stageNodes, stageIdx) in stages" :key="stageIdx" class="stage-col">
            <div class="stage-label">
              {{ stageIdx === 3 ? 'FINAL BOSS' : `STAGE ${stageIdx + 1}` }}
            </div>

            <div class="stage-nodes" :class="{ 'branch-pair': stageNodes.length > 1 }">
              <button
                v-for="node in stageNodes"
                :key="node.id"
                class="seed-packet node-card"
                :class="{
                  available: availableIds.has(node.id),
                  completed: node.completed,
                  boss: node.type === 'boss',
                  vault: node.type === 'vault',
                  rescue: node.type === 'barn_rescue',
                }"
                :disabled="!availableIds.has(node.id)"
                @click="enterSeasonNode(node.id)"
              >
                <div class="node-art-row">
                  <img class="node-sprite" :src="nodeSprite(node.type)" :alt="node.name" />
                  <div class="node-badges">
                    <span class="type-tag">{{ nodeTypeTag(node.type) }}</span>
                    <span class="state-badge">
                      <template v-if="node.completed">
                        <CraftIcon name="check" :size="12" /> Cleared
                      </template>
                      <template v-else-if="availableIds.has(node.id)">
                        <CraftIcon name="play" :size="11" /> Play
                      </template>
                      <template v-else>Locked</template>
                    </span>
                  </div>
                </div>
                <strong class="node-name">{{ node.name }}</strong>
                <small class="node-sub">{{ node.subtitle }}</small>
              </button>
            </div>

            <div v-if="stageIdx < 3" class="trail-connector">
              <span class="conn-dots"></span>
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

.route-board {
  padding: 20px 18px 18px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.route-head small {
  color: var(--ink-soft);
  font-size: 0.84rem;
}

.stages-track {
  flex: 1;
  display: grid;
  grid-template-columns: repeat(4, minmax(150px, 1fr));
  gap: 14px;
  align-items: center;
}

.stage-col {
  display: flex;
  flex-direction: column;
  gap: 10px;
  align-items: stretch;
}

.stage-label {
  text-align: center;
  font-family: 'Fredoka', sans-serif;
  font-size: 0.74rem;
  font-weight: 700;
  letter-spacing: 0.9px;
  color: var(--ink-soft);
}

.stage-nodes {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.trail-connector {
  display: none;
  justify-content: center;
  padding: 2px 0;
}

.conn-dots {
  width: 4px;
  height: 18px;
  border-left: 3px dashed rgba(112, 76, 47, 0.45);
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
    box-shadow: 0 0 0 2px rgba(246, 200, 68, 0.45), var(--shadow-cutout);
  }
  50% {
    box-shadow: 0 0 0 5px rgba(246, 200, 68, 0.78), var(--shadow-cutout);
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

  .stages-track {
    grid-template-columns: 1fr;
    gap: 8px;
    align-items: stretch;
  }

  .stage-nodes.branch-pair {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 9px;
  }

  .trail-connector {
    display: flex;
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
  }

  .node-sprite {
    height: 38px;
    width: 38px;
  }
}
</style>
