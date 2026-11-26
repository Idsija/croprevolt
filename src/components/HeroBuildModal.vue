<script setup lang="ts">
import { bondStatuses } from '../engine/bonds';
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { GRAFT_REGISTRY } from '../data/grafts';
import {
  canUnlockPerk,
  getHeroSkillTree,
  getXpToNextLevel,
  MAX_HERO_LEVEL,
  SKILL_PERKS,
  type SkillPathDef,
} from '../data/skills';
import { buildScaledWeaponForHero, getSpeciesWeapons } from '../data/weapons';
import { getFamilyLabel } from '../engine/hooks';
import {
  equipWeapon,
  gameStore,
  respecPerks,
  toggleSquadMember,
  unlockPerk,
} from '../stores/gameStore';
import CraftIcon from './CraftIcon.vue';

const props = defineProps<{
  initialHeroUid?: string | null;
}>();

const emit = defineEmits<{
  close: [];
}>();

function onModalKeyDown(e: KeyboardEvent): void {
  if (e.key === 'Escape') emit('close');
}

onMounted(() => window.addEventListener('keydown', onModalKeyDown));
onBeforeUnmount(() => window.removeEventListener('keydown', onModalKeyDown));

const run = computed(() => gameStore.run!);
const squadBonds = computed(() =>
  bondStatuses(run.value.roster.filter((h) => !h.harvested && run.value.activeSquadUids.includes(h.uid)))
);
const openBondId = ref<string | null>(null);
const openBond = computed(() => squadBonds.value.find((b) => b.def.id === openBondId.value) ?? null);

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

const heroTree = computed(() =>
  selectedHero.value ? getHeroSkillTree(selectedHero.value.species) : null
);

const heroPaths = computed<SkillPathDef[]>(() =>
  heroTree.value ? [heroTree.value.pathA, heroTree.value.pathB] : []
);

const isSelectedActive = computed(() =>
  selectedHero.value ? run.value.activeSquadUids.includes(selectedHero.value.uid) : false
);

const selectedHeroArmory = computed(() => {
  const h = selectedHero.value;
  if (!h) return null;
  const pair = getSpeciesWeapons(h.species);
  const unlocked = new Set(run.value.unlockedWeaponIds ?? []);
  const altUnlocked = unlocked.has(pair.alt.weapon.id);
  const equippedId = h.equippedWeaponId ?? h.weapon.id;
  return {
    base: buildScaledWeaponForHero(h, pair.base),
    alt: buildScaledWeaponForHero(h, pair.alt.weapon),
    altTagline: pair.alt.tagline,
    altUnlocked,
    equippedId,
  };
});

function handleEquipWeapon(weaponId: string): void {
  if (!selectedHero.value || selectedHero.value.harvested) return;
  equipWeapon(selectedHero.value.uid, weaponId);
}

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

function handleRespec(): void {
  if (!selectedHero.value || selectedHero.value.harvested || selectedHero.value.perkIds.length === 0) {
    return;
  }
  respecPerks(selectedHero.value.uid);
}

function perkState(perkId: string): 'unlocked' | 'ready' | 'locked' {
  const h = selectedHero.value;
  if (!h) return 'locked';
  if (h.perkIds.includes(perkId)) return 'unlocked';
  if (!h.harvested && canUnlockPerk(h.perkIds, h.skillPoints, perkId, h.species)) return 'ready';
  return 'locked';
}

function unlockedCountInPath(path: SkillPathDef): number {
  const h = selectedHero.value;
  if (!h) return 0;
  return path.perks.filter((p) => h.perkIds.includes(p.id)).length;
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
          <h2>Unique Character Skill Trees &amp; Armory</h2>
          <small>
            Active Squad: {{ run.activeSquadUids.length }}/4 ·
            <strong v-if="totalUnspentSp > 0" class="sp-highlight">
              ★ {{ totalUnspentSp }} Skill Point{{ totalUnspentSp > 1 ? 's' : '' }} ready to spend!
            </strong>
            <span v-else>Every hero has 2 bespoke build paths — free respec anytime</span>
          </small>
        </div>
        <button class="paper-btn icon-only" aria-label="Close" @click="emit('close')">
          <CraftIcon name="close" :size="17" />
        </button>
      </header>

      <!-- Squad Bonds: what this mix of heroes earns at the start of a battle -->
      <div class="bond-strip">
        <span class="bond-strip-label">Squad Bonds</span>
        <button
          v-for="sb in squadBonds"
          :key="sb.def.id"
          class="bond-chip"
          :class="{ on: sb.tier > 0, two: sb.tier > 1, open: openBondId === sb.def.id }"
          @click="openBondId = openBondId === sb.def.id ? null : sb.def.id"
        >
          <span>{{ sb.def.icon }}</span>
          <span>{{ sb.def.name }}{{ sb.tier > 1 ? ' II' : sb.tier === 0 ? ` ${sb.count}/${sb.def.thresholds[0]}` : '' }}</span>
        </button>
        <p v-if="openBond" class="bond-detail">
          <strong>{{ openBond.def.icon }} {{ openBond.def.name }}</strong>
          ({{ openBond.def.who }}: {{ openBond.count }}).
          <template v-if="openBond.tier > 0">Active: {{ openBond.effect }}</template>
          <template v-else>At {{ openBond.def.thresholds[0] }}: {{ openBond.def.tiers[0] }}</template>
          <template v-if="openBond.tier > 0 && openBond.missing > 0">
            At {{ openBond.def.thresholds[openBond.tier] }}: {{ openBond.def.tiers[openBond.tier] }}
          </template>
        </p>
      </div>

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

        <!-- Right Hero Build Sheet, Armory & Illustrated 2-Path Botanical Skill Tree -->
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
                v-if="!selectedHero.harvested && selectedHero.perkIds.length > 0"
                class="paper-btn respec-btn"
                title="Refund all spent Skill Points for free"
                @click="handleRespec"
              >
                ↺ Reset Perks
              </button>
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

          <!-- Armory Weapon Switcher (Base vs Unlocked Alternate Weapon!) -->
          <div v-if="selectedHeroArmory" class="armory-bar">
            <button
              class="weapon-opt"
              :class="{ equipped: selectedHeroArmory.equippedId === selectedHeroArmory.base.id }"
              :disabled="selectedHero.harvested"
              @click="handleEquipWeapon(selectedHeroArmory.base.id)"
            >
              <div class="wo-head">
                <strong>🎯 {{ selectedHeroArmory.base.name }}</strong>
                <span class="wo-badge">{{ selectedHeroArmory.equippedId === selectedHeroArmory.base.id ? 'EQUIPPED' : 'BASE' }}</span>
              </div>
              <small class="wo-stats">
                {{ selectedHeroArmory.base.damage }} DMG · R{{ selectedHeroArmory.base.minRange }}-{{ selectedHeroArmory.base.maxRange }} · {{ selectedHeroArmory.base.arc.toUpperCase() }}
                <template v-if="selectedHeroArmory.base.knockback"> · ⇄ Push</template>
              </small>
              <small class="wo-desc">{{ selectedHeroArmory.base.description }}</small>
            </button>

            <button
              class="weapon-opt alt"
              :class="{
                equipped: selectedHeroArmory.equippedId === selectedHeroArmory.alt.id,
                locked: !selectedHeroArmory.altUnlocked,
              }"
              :disabled="selectedHero.harvested || !selectedHeroArmory.altUnlocked"
              @click="handleEquipWeapon(selectedHeroArmory.alt.id)"
            >
              <div class="wo-head">
                <strong>⚔️ {{ selectedHeroArmory.alt.name }}</strong>
                <span class="wo-badge">
                  {{
                    selectedHeroArmory.equippedId === selectedHeroArmory.alt.id
                      ? 'EQUIPPED'
                      : selectedHeroArmory.altUnlocked
                        ? 'EQUIP ALT'
                        : '🔒 ARMORY / ELITE'
                  }}
                </span>
              </div>
              <small class="wo-stats">
                {{ selectedHeroArmory.alt.damage }} DMG · R{{ selectedHeroArmory.alt.minRange }}-{{ selectedHeroArmory.alt.maxRange }} · {{ selectedHeroArmory.alt.arc.toUpperCase() }}
                <template v-if="selectedHeroArmory.alt.knockback"> · ⇄ Push</template>
                <template v-if="selectedHeroArmory.alt.appliesStatus"> · +{{ selectedHeroArmory.alt.appliesStatus.kind }}</template>
              </small>
              <small class="wo-desc">{{ selectedHeroArmory.alt.description }}</small>
            </button>
          </div>

          <!-- Illustrated 2-Path Botanical Vine Skill Tree -->
          <div class="tree-paths-grid">
            <div
              v-for="path in heroPaths"
              :key="path.key"
              class="path-panel"
              :style="{
                '--path-col': path.color,
                '--path-bg': path.accent,
              }"
            >
              <div class="path-banner">
                <div class="pb-left">
                  <span class="pb-icon">{{ path.icon }}</span>
                  <div>
                    <strong>{{ path.name }}</strong>
                    <small>{{ path.tagline }}</small>
                  </div>
                </div>
                <span class="pb-prog">{{ unlockedCountInPath(path) }}/3</span>
              </div>

              <div class="vine-tree">
                <template v-for="(perk, idx) in path.perks" :key="perk.id">
                  <!-- Illustrated Botanical Vine Connector between Tier 1 -> 2 -> 3 -->
                  <div
                    v-if="idx > 0"
                    class="vine-connector"
                    :class="{
                      lit: selectedHero.perkIds.includes(path.perks[idx - 1].id),
                      golden: selectedHero.perkIds.includes(perk.id),
                    }"
                    aria-hidden="true"
                  >
                    <svg viewBox="0 0 64 26" width="64" height="26">
                      <path
                        class="vine-stem"
                        d="M32 0 C28 9, 36 17, 32 26"
                        fill="none"
                        stroke-width="3.5"
                        stroke-linecap="round"
                      />
                      <ellipse class="vine-leaf" cx="24" cy="11" rx="5.5" ry="3" transform="rotate(-24 24 11)" />
                      <ellipse class="vine-leaf" cx="40" cy="15" rx="5.5" ry="3" transform="rotate(24 40 15)" />
                    </svg>
                  </div>

                  <!-- Illustrated Perk Node Card -->
                  <button
                    class="perk-node"
                    :class="[
                      perkState(perk.id),
                      { capstone: perk.tier === 3 },
                    ]"
                    :disabled="perkState(perk.id) !== 'ready'"
                    @click="handleUnlock(perk.id)"
                  >
                    <div class="pn-medallion">
                      <span>{{ perk.icon }}</span>
                    </div>

                    <div class="pn-body">
                      <div class="pn-top">
                        <div class="pn-title-wrap">
                          <strong>{{ perk.name }}</strong>
                          <span v-if="perk.tier === 3" class="tier-tag cap">★ CAPSTONE</span>
                          <span v-else class="tier-tag">Tier {{ perk.tier }}</span>
                        </div>
                        <span v-if="perkState(perk.id) === 'unlocked'" class="wax-seal done" title="Unlocked">
                          ✓
                        </span>
                        <span v-else class="wax-seal cost">{{ perk.cost }} SP</span>
                      </div>
                      <span class="pn-short">{{ perk.shortDesc }}</span>
                      <p class="pn-desc">{{ perk.description }}</p>
                      <small
                        v-if="perk.requires && !selectedHero.perkIds.includes(perk.requires)"
                        class="req-note"
                      >
                        Requires: {{ SKILL_PERKS[perk.requires]?.name }}
                      </small>
                    </div>
                  </button>
                </template>
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
  width: min(1020px, 100%);
  max-height: min(92dvh, 760px);
  display: flex;
  flex-direction: column;
  padding: 16px 18px 18px;
  gap: 11px;
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
  font-size: 1.24rem;
  color: var(--ink);
}

.build-head small {
  color: var(--ink-soft);
  font-size: 0.8rem;
}

.sp-highlight {
  color: #a65c00;
}

.build-body {
  display: grid;
  grid-template-columns: 196px minmax(0, 1fr);
  gap: 12px;
  min-height: 0;
  flex: 1;
}

.roster-rail {
  display: flex;
  flex-direction: column;
  gap: 6px;
  overflow-y: auto;
  padding-right: 4px;
}

.roster-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
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
  width: 38px;
  height: 38px;
  border-radius: 10px;
  background: #efe0bf;
  border: 1.5px solid var(--ink);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.rb-port img {
  width: 32px;
  height: 32px;
  object-fit: contain;
}

.rb-lvl {
  position: absolute;
  bottom: -4px;
  left: -4px;
  background: #4a2c17;
  color: #ffe99e;
  font-size: 0.6rem;
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
  font-size: 0.62rem;
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
  font-size: 0.83rem;
  color: var(--ink);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.rb-copy small {
  font-size: 0.7rem;
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
  gap: 10px;
  padding: 9px 12px;
  flex-wrap: wrap;
}

.hs-left {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 1;
  min-width: 210px;
}

.hs-sprite {
  width: 52px;
  height: 52px;
  object-fit: contain;
  background: #f0e1c2;
  border: 2px solid var(--ink);
  border-radius: 12px;
  padding: 3px;
}

.hs-meta {
  display: flex;
  flex-direction: column;
  gap: 2px;
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
  font-size: 1.05rem;
  color: var(--ink);
}

.lvl-pill {
  background: #4a2c17;
  color: #ffe891;
  font-size: 0.7rem;
  font-weight: 800;
  padding: 2px 7px;
  border-radius: 999px;
}

.tier-pill {
  background: #e5f3d8;
  color: #2f6b1c;
  border: 1.5px solid #598f3a;
  font-size: 0.66rem;
  font-weight: 800;
  padding: 1px 6px;
  border-radius: 999px;
  text-transform: uppercase;
}

.hs-sub {
  font-size: 0.76rem;
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
  max-width: 180px;
  height: 7px;
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
  font-size: 0.7rem;
  font-weight: 700;
  color: #255a85;
}

.hs-actions {
  display: flex;
  align-items: center;
  gap: 7px;
  flex-wrap: wrap;
}

.sp-badge {
  background: #ece0c8;
  border: 2px solid var(--ink);
  border-radius: 10px;
  padding: 5px 10px;
  font-weight: 900;
  font-size: 0.84rem;
  color: var(--ink-soft);
}

.sp-badge.hot {
  background: linear-gradient(180deg, #ffe680 0%, #f2b729 100%);
  color: #422200;
  box-shadow: 0 2px 0 var(--ink);
}

.respec-btn {
  padding: 6px 10px;
  font-size: 0.76rem;
  background: #fff3d6;
  color: #7a3c0c;
}

.squad-swap-btn {
  padding: 6px 10px;
  font-size: 0.76rem;
}

.stat-ribbon {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.stat-chip {
  background: #f8edd5;
  border: 1.5px solid rgba(74, 44, 23, 0.42);
  border-radius: 999px;
  padding: 3px 9px;
  font-size: 0.74rem;
  font-weight: 700;
  color: var(--ink);
}

.stat-chip.graft {
  background: #fff2be;
  border-color: #c28717;
}

/* Armory Switcher */
.armory-bar {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.weapon-opt {
  border: 2px solid var(--ink);
  border-radius: 12px;
  padding: 7px 10px;
  background: #fbf4e4;
  text-align: left;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 2px;
  transition: transform 0.12s ease, background-color 0.12s ease;
}

.weapon-opt:hover:not(:disabled) {
  transform: translateY(-1px);
  background: #fffdf5;
}

.weapon-opt.equipped {
  background: linear-gradient(180deg, #fff5c4 0%, #ffe382 100%);
  border-color: #a66200;
  box-shadow: 0 3px 0 #7a4600;
}

.weapon-opt.locked {
  opacity: 0.62;
  background: #ece2cd;
  cursor: not-allowed;
}

.wo-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 6px;
}

.wo-head strong {
  font-size: 0.82rem;
  color: var(--ink);
}

.wo-badge {
  font-size: 0.6rem;
  font-weight: 900;
  padding: 2px 6px;
  border-radius: 999px;
  border: 1.4px solid var(--ink);
  background: #fff8e6;
  color: var(--ink);
  white-space: nowrap;
}

.weapon-opt.equipped .wo-badge {
  background: #4e8c28;
  color: #fffef5;
  border-color: #264d12;
}

.wo-stats {
  font-size: 0.7rem;
  font-weight: 800;
  color: #7a3e0a;
}

.wo-desc {
  font-size: 0.7rem;
  color: var(--ink-soft);
  line-height: 1.26;
}

/* ===== Illustrated 2-Path Botanical Vine Skill Tree ===== */
.tree-paths-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.path-panel {
  background: linear-gradient(180deg, #fdf7ea 0%, #f5e9ce 100%);
  border: 2.2px solid var(--ink);
  border-radius: 16px;
  padding: 10px 11px 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.path-banner {
  background: var(--path-bg);
  border: 2px solid var(--path-col);
  border-radius: 12px;
  padding: 7px 10px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.pb-left {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.pb-icon {
  font-size: 1.35rem;
  line-height: 1;
}

.pb-left strong {
  display: block;
  color: var(--path-col);
  font-size: 0.92rem;
  line-height: 1.15;
}

.pb-left small {
  display: block;
  font-size: 0.7rem;
  color: #4a3520;
  line-height: 1.2;
}

.pb-prog {
  background: var(--path-col);
  color: #fffdf5;
  font-size: 0.72rem;
  font-weight: 900;
  padding: 2px 8px;
  border-radius: 999px;
  flex-shrink: 0;
}

.vine-tree {
  display: flex;
  flex-direction: column;
  align-items: stretch;
}

.vine-connector {
  display: flex;
  justify-content: center;
  height: 22px;
  margin: -2px 0;
}

.vine-stem {
  stroke: #b9a482;
  transition: stroke 0.25s ease;
}

.vine-leaf {
  fill: #c7b597;
  transition: fill 0.25s ease;
}

.vine-connector.lit .vine-stem {
  stroke: #58a63c;
}

.vine-connector.lit .vine-leaf {
  fill: #70bf4e;
}

.vine-connector.golden .vine-stem {
  stroke: #d99518;
}

.vine-connector.golden .vine-leaf {
  fill: #f2be35;
}

.perk-node {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  border: 2.2px solid var(--ink);
  border-radius: 13px;
  padding: 9px 10px;
  background: #fffbf0;
  text-align: left;
  cursor: pointer;
  transition: transform 0.14s ease, box-shadow 0.14s ease, background-color 0.14s ease;
}

.perk-node.capstone {
  border-width: 2.5px;
}

.perk-node.ready {
  border-color: var(--path-col);
  background: #fffef8;
  box-shadow: 0 3px 0 var(--path-col);
}

.perk-node.ready:hover {
  transform: translateY(-2px);
  background: var(--path-bg);
}

.perk-node.unlocked {
  background: linear-gradient(180deg, #ebf9dd 0%, #d5f0be 100%);
  border-color: #3f7e24;
  cursor: default;
}

.perk-node.unlocked.capstone {
  background: linear-gradient(180deg, #fff6cc 0%, #ffe285 100%);
  border-color: #b56f00;
  box-shadow: 0 3px 0 #8a5200;
}

.perk-node.locked {
  opacity: 0.64;
  background: #efe5d1;
  cursor: not-allowed;
}

.pn-medallion {
  width: 38px;
  height: 38px;
  border-radius: 50%;
  border: 2px solid var(--ink);
  background: var(--path-bg);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.18rem;
  flex-shrink: 0;
  box-shadow: inset 0 -2px 0 rgba(74, 44, 23, 0.18);
}

.perk-node.unlocked .pn-medallion {
  background: #fff9db;
  border-color: #3f7e24;
}

.perk-node.unlocked.capstone .pn-medallion {
  background: #ffd74a;
  border-color: #8a5200;
}

.pn-body {
  display: flex;
  flex-direction: column;
  gap: 3px;
  flex: 1;
  min-width: 0;
}

.pn-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}

.pn-title-wrap {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.pn-title-wrap strong {
  font-size: 0.86rem;
  color: var(--ink);
}

.tier-tag {
  font-size: 0.58rem;
  font-weight: 900;
  padding: 1px 6px;
  border-radius: 999px;
  background: rgba(74, 44, 23, 0.1);
  color: var(--ink-soft);
  text-transform: uppercase;
}

.tier-tag.cap {
  background: #4a2c17;
  color: #ffe885;
}

.wax-seal {
  font-size: 0.68rem;
  font-weight: 900;
  padding: 2px 8px;
  border-radius: 999px;
  border: 1.6px solid var(--ink);
  white-space: nowrap;
  flex-shrink: 0;
}

.wax-seal.done {
  background: #4e9c2e;
  color: #fffef5;
  border-color: #244d12;
}

.wax-seal.cost {
  background: #ffe694;
  color: #4a2c17;
}

.pn-short {
  font-size: 0.72rem;
  font-weight: 800;
  color: var(--path-col);
}

.pn-desc {
  margin: 0;
  font-size: 0.73rem;
  color: var(--ink-soft);
  line-height: 1.32;
}

.req-note {
  font-size: 0.67rem;
  color: #8f3f1d;
  font-weight: 700;
}

@media (max-width: 820px) {
  .build-body {
    grid-template-columns: 1fr;
  }

  .roster-rail {
    flex-direction: row;
    overflow-x: auto;
    overflow-y: hidden;
  }

  .roster-btn {
    flex: 0 0 auto;
  }

  .armory-bar,
  .tree-paths-grid {
    grid-template-columns: 1fr;
  }
}
.bond-strip {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin: 0 0 10px;
}
.bond-strip-label {
  font-family: 'Fredoka', sans-serif;
  font-size: 0.78rem;
  font-weight: 700;
  color: var(--ink-soft);
}
.bond-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 9px;
  border-radius: 999px;
  border: 1.6px dashed #8a7a5c;
  background: #f4ecd8;
  color: #6b5a3c;
  font-family: 'Fredoka', sans-serif;
  font-size: 0.74rem;
  font-weight: 700;
  cursor: pointer;
}
.bond-chip.on {
  border: 1.8px solid var(--ink);
  background: linear-gradient(180deg, #ffe9a0 0%, #f6cf58 100%);
  color: #3e2600;
}
.bond-chip.two {
  background: linear-gradient(180deg, #ffd27a 0%, #f0a325 100%);
}
.bond-chip.open {
  outline: 2px solid #c98a1b;
  outline-offset: 1px;
}
.bond-detail {
  flex-basis: 100%;
  margin: 2px 0 0;
  font-size: 0.78rem;
  line-height: 1.3;
  color: var(--ink);
}
</style>
