<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { GRAFT_REGISTRY } from '../data/grafts';
import {
  canUnlockPerk,
  getPerksForBranch,
  getXpToNextLevel,
  MAX_HERO_LEVEL,
  SKILL_BRANCH_META,
  SKILL_PERKS,
  type SkillBranch,
} from '../data/skills';
import { getFamilyLabel } from '../engine/hooks';
import { gameStore, toggleSquadMember, unlockPerk } from '../stores/gameStore';
import CraftIcon from './CraftIcon.vue';

const props = defineProps<{
  initialHeroUid?: string | null;
}>();

const emit = defineEmits<{
  close: [];
}>();

const run = computed(() => gameStore.run!);
const branches: SkillBranch[] = ['mobility', 'firepower', 'survival'];

const selectedUid = ref<string>(
  props.initialHeroUid ??
    run.value.activeSquadUids[0] ??
    run.value.roster[0]?.uid ??
    ''
);

watch(
  () => props.initialHeroUid,
  (uid) => {
    if (uid) selectedUid.value = uid;
  }
);

const selectedHero = computed(
  () => run.value.roster.find((h) => h.uid === selectedUid.value) ?? run.value.roster[0] ?? null
);

const isSelectedActive = computed(() =>
  selectedHero.value ? run.value.activeSquadUids.includes(selectedHero.value.uid) : false
);

const xpNeeded = computed(() =>
  selectedHero.value ? getXpToNextLevel(selectedHero.value.level) : 50
);

const xpPercent = computed(() => {
  const h = selectedHero.value;
  if (!h) return 0;
  if (h.level >= MAX_HERO_LEVEL) return 100;
  return Math.min(100, Math.round((h.xp / Math.max(1, xpNeeded.value)) * 100));
});

const totalUnspentSp = computed(() =>
  run.value.roster.reduce((sum, h) => sum + (h.harvested ? 0 : h.skillPoints), 0)
);

function handleUnlock(perkId: string): void {
  if (!selectedHero.value || selectedHero.value.harvested) return;
  unlockPerk(selectedHero.value.uid, perkId);
}

function perkState(perkId: string): 'unlocked' | 'ready' | 'locked' {
  const h = selectedHero.value;
  if (!h) return 'locked';
  if (h.perkIds.includes(perkId)) return 'unlocked';
  if (!h.harvested && canUnlockPerk(h.perkIds, h.skillPoints, perkId)) return 'ready';
  return 'locked';
}
</script>

<template>
  <div class="build-backdrop" @click.self="emit('close')">
    <section class="corrugated-slab build-sheet pinned-card">
      <div class="washi-tape"></div>
      <span class="brass-pin tl"></span>
      <span class="brass-pin tr"></span>

      <!-- Header -->
      <header class="build-head">
        <div>
          <h2>Squad Builds &amp; Skill Trees</h2>
          <small>
            Active Squad: {{ run.activeSquadUids.length }}/4 ·
            <strong v-if="totalUnspentSp > 0" class="sp-highlight">
              ★ {{ totalUnspentSp }} Skill Point{{ totalUnspentSp > 1 ? 's' : '' }} ready to spend!
            </strong>
            <span v-else>Win battles to earn XP &amp; Skill Points</span>
          </small>
        </div>
        <button class="paper-btn icon-only" aria-label="Close" @click="emit('close')">
          <CraftIcon name="close" :size="17" />
        </button>
      </header>

      <div class="build-body">
        <!-- Left Roster Strip -->
        <aside class="roster-rail scroll-soft">
          <button
            v-for="hero in run.roster"
            :key="hero.uid"
            class="roster-btn"
            :class="{
              selected: selectedHero?.uid === hero.uid,
              active: run.activeSquadUids.includes(hero.uid),
              bagged: hero.harvested,
            }"
            @click="selectedUid = hero.uid"
          >
            <div class="rb-port">
              <img :src="`/sprites/${hero.species}.png`" :alt="hero.name" />
              <span class="rb-lvl">L{{ hero.level }}</span>
              <span v-if="!hero.harvested && hero.skillPoints > 0" class="rb-sp">
                +{{ hero.skillPoints }}
              </span>
            </div>
            <div class="rb-copy">
              <strong>{{ hero.name }}</strong>
              <small v-if="hero.harvested" class="bag-txt">Bagged in Barn</small>
              <small v-else>
                {{ run.activeSquadUids.includes(hero.uid) ? 'Active' : 'Bench' }} · {{ hero.hp }}/{{ hero.maxHp }} HP
              </small>
            </div>
          </button>
        </aside>

        <!-- Right Hero Build Sheet & 3-Branch Skill Tree -->
        <div v-if="selectedHero" class="hero-pane scroll-soft">
          <div class="hero-summary paper-card">
            <div class="hs-left">
              <img class="hs-sprite" :src="`/sprites/${selectedHero.species}.png`" :alt="selectedHero.name" />
              <div class="hs-meta">
                <div class="hs-title-row">
                  <h3>{{ selectedHero.name }}</h3>
                  <span class="lvl-pill">Lv.{{ selectedHero.level }}</span>
                  <span class="tier-pill">{{ selectedHero.tier }}</span>
                </div>
                <small class="hs-sub">
                  {{ selectedHero.title }} · {{ getFamilyLabel(selectedHero.family) }}
                </small>

                <!-- XP Bar -->
                <div class="xp-row">
                  <div class="xp-track">
                    <div class="xp-fill" :style="{ width: `${xpPercent}%` }"></div>
                  </div>
                  <small class="xp-txt">
                    {{
                      selectedHero.level >= MAX_HERO_LEVEL
                        ? 'MAX LV'
                        : `${selectedHero.xp}/${xpNeeded} XP`
                    }}
                  </small>
                </div>
              </div>
            </div>

            <div class="hs-actions">
              <div class="sp-badge" :class="{ hot: selectedHero.skillPoints > 0 }">
                ★ {{ selectedHero.skillPoints }} SP
              </div>
              <button
                v-if="!selectedHero.harvested"
                class="paper-btn squad-swap-btn"
                :class="{ primary: !isSelectedActive }"
                :disabled="
                  (isSelectedActive && run.activeSquadUids.length <= 1) ||
                  (!isSelectedActive && run.activeSquadUids.length >= 4)
                "
                @click="toggleSquadMember(selectedHero.uid)"
              >
                {{ isSelectedActive ? 'Move to Bench' : 'Deploy Active' }}
              </button>
            </div>
          </div>

          <!-- Compact Live Stat Ribbon -->
          <div class="stat-ribbon">
            <span class="stat-chip">❤️ {{ selectedHero.hp }}/{{ selectedHero.maxHp }}</span>
            <span class="stat-chip">🎯 {{ selectedHero.weapon.damage }} DMG (R{{ selectedHero.weapon.minRange }}-{{ selectedHero.weapon.maxRange }})</span>
            <span class="stat-chip">👟 Move {{ selectedHero.moveRange }}</span>
            <span class="stat-chip">★ Jump {{ selectedHero.jumpRange }}</span>
            <span class="stat-chip">⚡ Dash {{ selectedHero.dashDamage }}</span>
            <span
              v-for="gid in selectedHero.graftIds"
              :key="gid"
              class="stat-chip graft"
              :title="GRAFT_REGISTRY[gid]?.description"
            >
              {{ GRAFT_REGISTRY[gid]?.badgeIcon }} {{ GRAFT_REGISTRY[gid]?.name }}
            </span>
          </div>

          <!-- 3-Branch Skill Tree Grid -->
          <div class="tree-grid">
            <div
              v-for="branch in branches"
              :key="branch"
              class="branch-col"
              :style="{
                '--br-col': SKILL_BRANCH_META[branch].color,
                '--br-bg': SKILL_BRANCH_META[branch].accent,
              }"
            >
              <div class="branch-head">
                <strong>{{ SKILL_BRANCH_META[branch].label }}</strong>
                <small>{{ SKILL_BRANCH_META[branch].tagline }}</small>
              </div>

              <div class="perk-stack">
                <button
                  v-for="perk in getPerksForBranch(branch)"
                  :key="perk.id"
                  class="perk-card"
                  :class="[
                    perkState(perk.id),
                    { capstone: perk.tier === 2 },
                  ]"
                  :disabled="perkState(perk.id) !== 'ready'"
                  @click="handleUnlock(perk.id)"
                >
                  <div class="perk-top">
                    <span class="perk-icon">{{ perk.icon }}</span>
                    <div class="perk-title-wrap">
                      <strong>{{ perk.name }}</strong>
                      <span v-if="perk.tier === 2" class="cap-tag">CAPSTONE</span>
                    </div>
                    <span v-if="perkState(perk.id) === 'unlocked'" class="perk-stamp done">
                      ✓
                    </span>
                    <span v-else class="perk-stamp cost">{{ perk.cost }} SP</span>
                  </div>
                  <p class="perk-desc">{{ perk.description }}</p>
                  <small
                    v-if="perk.requires && !selectedHero.perkIds.includes(perk.requires)"
                    class="req-note"
                  >
                    Requires: {{ SKILL_PERKS[perk.requires]?.name }}
                  </small>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.build-backdrop {
  position: fixed;
  inset: 0;
  z-index: 60;
  background: rgba(28, 15, 6, 0.62);
  backdrop-filter: blur(3px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 14px;
}

.build-sheet {
  width: min(980px, 100%);
  max-height: min(90dvh, 720px);
  display: flex;
  flex-direction: column;
  padding: 16px 18px 18px;
  gap: 12px;
  position: relative;
}

.build-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.build-head h2 {
  margin: 0;
  font-size: 1.28rem;
  color: var(--ink);
}

.build-head small {
  color: var(--ink-soft);
  font-size: 0.82rem;
}

.sp-highlight {
  color: #a65c00;
}

.build-body {
  display: grid;
  grid-template-columns: 205px minmax(0, 1fr);
  gap: 12px;
  min-height: 0;
  flex: 1;
}

.roster-rail {
  display: flex;
  flex-direction: column;
  gap: 7px;
  overflow-y: auto;
  padding-right: 4px;
}

.roster-btn {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 7px 9px;
  background: #f9eed7;
  border: 2px solid var(--ink);
  border-radius: 12px;
  text-align: left;
  cursor: pointer;
  transition: transform 0.12s ease, background-color 0.12s ease;
}

.roster-btn:hover {
  transform: translateY(-1px);
  background: #fff7e6;
}

.roster-btn.selected {
  background: #ffe68c;
  box-shadow: 0 3px 0 var(--ink);
}

.roster-btn.bagged {
  opacity: 0.58;
}

.rb-port {
  position: relative;
  width: 40px;
  height: 40px;
  border-radius: 10px;
  background: #efe0bf;
  border: 1.5px solid var(--ink);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.rb-port img {
  width: 34px;
  height: 34px;
  object-fit: contain;
}

.rb-lvl {
  position: absolute;
  bottom: -4px;
  left: -4px;
  background: #4a2c17;
  color: #ffe99e;
  font-size: 0.62rem;
  font-weight: 800;
  padding: 0 4px;
  border-radius: 5px;
}

.rb-sp {
  position: absolute;
  top: -5px;
  right: -5px;
  background: #e89b14;
  color: #fffef5;
  border: 1.5px solid var(--ink);
  font-size: 0.64rem;
  font-weight: 900;
  padding: 0 4px;
  border-radius: 999px;
  animation: spPulse 1.5s infinite;
}

@keyframes spPulse {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.14); }
}

.rb-copy {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.rb-copy strong {
  font-size: 0.85rem;
  color: var(--ink);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.rb-copy small {
  font-size: 0.72rem;
  color: var(--ink-soft);
}

.bag-txt {
  color: #a82e24 !important;
  font-weight: 700;
}

.hero-pane {
  display: flex;
  flex-direction: column;
  gap: 10px;
  overflow-y: auto;
  padding-right: 4px;
}

.hero-summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px;
  flex-wrap: wrap;
}

.hs-left {
  display: flex;
  align-items: center;
  gap: 11px;
  flex: 1;
  min-width: 210px;
}

.hs-sprite {
  width: 56px;
  height: 56px;
  object-fit: contain;
  background: #f0e1c2;
  border: 2px solid var(--ink);
  border-radius: 12px;
  padding: 4px;
}

.hs-meta {
  display: flex;
  flex-direction: column;
  gap: 3px;
  flex: 1;
}

.hs-title-row {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.hs-title-row h3 {
  margin: 0;
  font-size: 1.08rem;
  color: var(--ink);
}

.lvl-pill {
  background: #4a2c17;
  color: #ffe891;
  font-size: 0.72rem;
  font-weight: 800;
  padding: 2px 7px;
  border-radius: 999px;
}

.tier-pill {
  background: #e5f3d8;
  color: #2f6b1c;
  border: 1.5px solid #598f3a;
  font-size: 0.68rem;
  font-weight: 800;
  padding: 1px 6px;
  border-radius: 999px;
  text-transform: uppercase;
}

.hs-sub {
  font-size: 0.78rem;
  color: var(--ink-soft);
}

.xp-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 2px;
}

.xp-track {
  flex: 1;
  max-width: 190px;
  height: 8px;
  background: #dfd0b0;
  border: 1.5px solid var(--ink);
  border-radius: 999px;
  overflow: hidden;
}

.xp-fill {
  height: 100%;
  background: linear-gradient(90deg, #52b7e8 0%, #3d8bd1 100%);
  transition: width 0.25s ease;
}

.xp-txt {
  font-size: 0.72rem;
  font-weight: 700;
  color: #255a85;
}

.hs-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.sp-badge {
  background: #ece0c8;
  border: 2px solid var(--ink);
  border-radius: 10px;
  padding: 5px 10px;
  font-weight: 900;
  font-size: 0.85rem;
  color: var(--ink-soft);
}

.sp-badge.hot {
  background: linear-gradient(180deg, #ffe680 0%, #f2b729 100%);
  color: #422200;
  box-shadow: 0 2px 0 var(--ink);
}

.squad-swap-btn {
  padding: 6px 11px;
  font-size: 0.78rem;
}

.stat-ribbon {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.stat-chip {
  background: #f8edd5;
  border: 1.5px solid rgba(74, 44, 23, 0.45);
  border-radius: 999px;
  padding: 3px 9px;
  font-size: 0.76rem;
  font-weight: 700;
  color: var(--ink);
}

.stat-chip.graft {
  background: #fff2be;
  border-color: #c28717;
}

.tree-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}

.branch-col {
  background: #fbf4e4;
  border: 2px solid var(--ink);
  border-radius: 14px;
  padding: 9px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.branch-head {
  background: var(--br-bg);
  border: 1.5px solid var(--br-col);
  border-radius: 10px;
  padding: 6px 8px;
  display: flex;
  flex-direction: column;
}

.branch-head strong {
  color: var(--br-col);
  font-size: 0.86rem;
}

.branch-head small {
  font-size: 0.69rem;
  color: #4a3520;
  line-height: 1.25;
}

.perk-stack {
  display: flex;
  flex-direction: column;
  gap: 7px;
}

.perk-card {
  border: 2px solid var(--ink);
  border-radius: 11px;
  padding: 8px 9px;
  background: #fffaf0;
  text-align: left;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 4px;
  transition: transform 0.12s ease, box-shadow 0.12s ease;
}

.perk-card.ready {
  background: #fffdf5;
  border-color: var(--br-col);
  box-shadow: 0 3px 0 var(--br-col);
}

.perk-card.ready:hover {
  transform: translateY(-2px);
  background: var(--br-bg);
}

.perk-card.unlocked {
  background: linear-gradient(180deg, #e7f8da 0%, #d4f0be 100%);
  border-color: #3f7e24;
  cursor: default;
}

.perk-card.locked {
  opacity: 0.62;
  background: #efe5d0;
  cursor: not-allowed;
}

.perk-card.capstone {
  border-style: double;
  border-width: 3px;
}

.perk-top {
  display: flex;
  align-items: center;
  gap: 6px;
}

.perk-icon {
  font-size: 1.05rem;
  line-height: 1;
}

.perk-title-wrap {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
}

.perk-title-wrap strong {
  font-size: 0.82rem;
  color: var(--ink);
}

.cap-tag {
  font-size: 0.56rem;
  font-weight: 900;
  color: var(--br-col);
  letter-spacing: 0.04em;
}

.perk-stamp {
  font-size: 0.68rem;
  font-weight: 900;
  padding: 2px 6px;
  border-radius: 999px;
  border: 1.5px solid var(--ink);
  white-space: nowrap;
}

.perk-stamp.cost {
  background: #ffe58a;
  color: #4f2a00;
}

.perk-stamp.done {
  background: #58b842;
  color: #ffffff;
  border-color: #2b5c1c;
}

.perk-desc {
  margin: 0;
  font-size: 0.74rem;
  line-height: 1.3;
  color: var(--ink-soft);
}

.req-note {
  font-size: 0.67rem;
  font-weight: 700;
  color: #9e3d24;
}

@media (max-width: 820px) {
  .build-body {
    grid-template-columns: 1fr;
  }

  .roster-rail {
    flex-direction: row;
    overflow-x: auto;
    overflow-y: hidden;
    padding-bottom: 4px;
  }

  .roster-btn {
    flex: 0 0 auto;
  }

  .tree-grid {
    grid-template-columns: 1fr;
  }
}
</style>
