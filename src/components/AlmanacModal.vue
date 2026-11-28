<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { ENEMY_BLUEPRINTS } from '../data/enemies';
import { GRAFT_REGISTRY } from '../data/grafts';
import {
  FACTION_DOSSIERS,
  HERO_LORE_QUOTES,
  SEASON_WEATHER_INFO,
  WORLD_LORE_CHRONICLES,
} from '../data/lore';
import { HERO_UNLOCK_CATALOG, PRODUCE_BLUEPRINTS, STARTER_BLUEPRINT_IDS } from '../data/produce';
import { RELIC_REGISTRY } from '../data/relics';
import { getHeroSkillTree } from '../data/skills';
import { ALT_WEAPONS, getDualWeaponKit, getSpeciesWeapons } from '../data/weapons';
import { activeStreak, loadDailyState } from '../engine/daily';
import { ACHIEVEMENTS, loadHistory } from '../engine/history';
import { getFamilyLabel } from '../engine/hooks';
import { dailyKeyFor } from '../engine/score';
import type { SeasonId, WeaponGimmickKind } from '../engine/types';
import { hasVariantSprite, resolveVariantSpriteKey, type SpriteVariantKind } from '../renderer3d/textures';
import { getWeaponCutoutDataUrl } from '../renderer3d/weaponProps';
import { gameStore } from '../stores/gameStore';
import CraftIcon from './CraftIcon.vue';

const emit = defineEmits<{
  close: [];
}>();

function onAlmanacKeyDown(e: KeyboardEvent): void {
  if (e.key === 'Escape') emit('close');
}

onMounted(() => window.addEventListener('keydown', onAlmanacKeyDown));
onBeforeUnmount(() => window.removeEventListener('keydown', onAlmanacKeyDown));

type AlmanacTab = 'heroes' | 'enemies' | 'weapons' | 'lore' | 'relics' | 'records';
type HeroFilter = 'all' | 'starters' | 'barnyard' | 'root' | 'vine' | 'fruit';
type EnemyFilter = 'all' | 'contraptions' | 'farmhands' | 'bosses';

const CONTRAPTION_IDS = new Set([
  'barrow',
  'blower',
  'sapper',
  'mower',
  'kettlebot',
  'snowplow',
  'frostblower',
  'tractor',
  'harvester',
  'frostboss',
]);
const UNLOCK_COST_MAP = Object.fromEntries(HERO_UNLOCK_CATALOG.map((e) => [e.id, e.cost]));
const STARTER_SET = new Set<string>(STARTER_BLUEPRINT_IDS);

const GIMMICK_BADGE: Record<WeaponGimmickKind, string> = {
  vacuum_pull: '🌀 Vacuum Pull',
  hammer_cleave: '🔨 Cleave Sweep',
  boomerang: '↪ Curves Cover',
  grapple_yank: '🪝 Grapple Yank',
  cone_bellows: '🔥 Bellows Cone',
  sentry_pop: '⚡ Popper Burst',
  lunge_skewer: '⚔️ Rapier Lunge',
};

const history = loadHistory();
const dailyStreak = loadDailyState().streak;
const streakNow = activeStreak(dailyStreak, dailyKeyFor());
const earnedCount = ACHIEVEMENTS.filter((a) => history.achievements[a.id]).length;
const fmt = (n: number) => n.toLocaleString('en-US');
const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const records = [
  { label: 'Runs played', value: fmt(history.stats.runs) },
  { label: 'Runs won', value: fmt(history.stats.wins) },
  { label: 'Best Endless Floor', value: (gameStore.meta.bestEndlessFloor ?? 0) > 0 ? `Floor ${gameStore.meta.bestEndlessFloor}` : 'None yet' },
  { label: 'Best score', value: fmt(history.stats.bestScore) },
  { label: 'Best daily score', value: fmt(history.stats.bestDailyScore) },
  { label: 'Highest Heat won', value: history.stats.highestHeatWon >= 0 ? `Heat ${history.stats.highestHeatWon}` : 'None yet' },
  { label: 'Fastest win', value: history.stats.fastestWinTurns > 0 ? `${history.stats.fastestWinTurns} battle turns` : 'None yet' },
  { label: 'Farmers routed', value: fmt(history.stats.enemiesDefeated) },
  { label: 'Daily streak', value: `${streakNow} now · best ${dailyStreak.best}` },
];

const activeTab = ref<AlmanacTab>('heroes');
const heroFilter = ref<HeroFilter>('all');
const enemyFilter = ref<EnemyFilter>('all');
const loreSeasonFilter = ref<'all' | SeasonId>('all');
const heroesList = Object.values(PRODUCE_BLUEPRINTS);
const enemiesList = Object.values(ENEMY_BLUEPRINTS);
const relicsList = Object.values(RELIC_REGISTRY);
const graftsList = Object.values(GRAFT_REGISTRY);
const weatherList = Object.values(SEASON_WEATHER_INFO);
const discoveredLoreSet = computed(() => new Set<string>(gameStore.meta.discoveredLoreIds ?? []));
const filteredChronicles = computed(() =>
  loreSeasonFilter.value === 'all'
    ? WORLD_LORE_CHRONICLES
    : WORLD_LORE_CHRONICLES.filter((c) => c.seasonId === loreSeasonFilter.value)
);

const unlockedHeroSet = computed(
  () => new Set<string>([...STARTER_BLUEPRINT_IDS, ...(gameStore.meta.unlockedHeroIds ?? [])])
);

const filteredHeroes = computed(() => {
  switch (heroFilter.value) {
    case 'starters':
      return heroesList.filter((h) => STARTER_SET.has(h.id));
    case 'barnyard':
      return heroesList.filter((h) => h.isAnimal);
    case 'root':
    case 'vine':
    case 'fruit':
      return heroesList.filter((h) => h.family === heroFilter.value);
    default:
      return heroesList;
  }
});

const filteredEnemies = computed(() => {
  switch (enemyFilter.value) {
    case 'contraptions':
      return enemiesList.filter((e) => !e.isBoss && CONTRAPTION_IDS.has(e.id));
    case 'farmhands':
      return enemiesList.filter((e) => !e.isBoss && !CONTRAPTION_IDS.has(e.id));
    case 'bosses':
      return enemiesList.filter((e) => e.isBoss);
    default:
      return enemiesList;
  }
});

function setHeroFilter(f: HeroFilter): void {
  heroFilter.value = f;
  if (!filteredHeroes.value.some((h) => h.id === selectedHeroId.value) && filteredHeroes.value[0]) {
    selectHero(filteredHeroes.value[0].id);
  }
}

function setEnemyFilter(f: EnemyFilter): void {
  enemyFilter.value = f;
  if (!filteredEnemies.value.some((e) => e.id === selectedEnemyId.value) && filteredEnemies.value[0]) {
    selectEnemy(filteredEnemies.value[0].id);
  }
}

const selectedHeroId = ref<string>(heroesList[0]?.id ?? 'potato');
const selectedEnemyId = ref<string>(enemiesList[0]?.id ?? 'digger');
const activeVariant = ref<SpriteVariantKind>('base');

// Interactive 3D cardstock tilt state
const tiltX = ref(0);
const tiltY = ref(0);
const sheenX = ref(50);
const sheenY = ref(35);

const selectedHero = computed(() => PRODUCE_BLUEPRINTS[selectedHeroId.value] ?? heroesList[0]);
const selectedEnemy = computed(() => ENEMY_BLUEPRINTS[selectedEnemyId.value] ?? enemiesList[0]);

const activeVisualKind = computed(() =>
  activeTab.value === 'enemies' ? selectedEnemy.value.archetype : selectedHero.value.species
);

const availableVariants = computed<Array<{ kind: SpriteVariantKind; label: string }>>(() => {
  const vk = activeVisualKind.value;
  const list: Array<{ kind: SpriteVariantKind; label: string }> = [{ kind: 'base', label: 'Base' }];
  if (hasVariantSprite(vk, 'cover')) list.push({ kind: 'cover', label: '🛡️ Cover' });
  if (hasVariantSprite(vk, 'action')) list.push({ kind: 'action', label: '⚡ Jump / Action' });
  if (hasVariantSprite(vk, 'lowhp')) list.push({ kind: 'lowhp', label: '🩹 Wounded' });
  if (hasVariantSprite(vk, 'hit')) list.push({ kind: 'hit', label: '💥 Hit Recoil' });
  if (hasVariantSprite(vk, 'enraged')) list.push({ kind: 'enraged', label: '🔥 Enraged' });
  return list;
});

const activeSpriteSrc = computed(() => {
  const vk = activeVisualKind.value;
  const valid = availableVariants.value.some((v) => v.kind === activeVariant.value)
    ? activeVariant.value
    : 'base';
  return `/sprites/${resolveVariantSpriteKey(vk, valid)}.png`;
});

const selectedHeroWeapons = computed(() => getSpeciesWeapons(selectedHero.value.species));
const selectedHeroKit = computed(() => getDualWeaponKit(selectedHero.value.species));
const selectedHeroQuote = computed(() => HERO_LORE_QUOTES[selectedHero.value.species] ?? '');
const selectedHeroTree = computed(() => getHeroSkillTree(selectedHero.value.species));

function selectHero(id: string): void {
  selectedHeroId.value = id;
  activeVariant.value = 'base';
}

function selectEnemy(id: string): void {
  selectedEnemyId.value = id;
  activeVariant.value = 'base';
}

function onCardMove(e: MouseEvent): void {
  const el = e.currentTarget as HTMLElement | null;
  if (!el) return;
  const rect = el.getBoundingClientRect();
  const nx = (e.clientX - rect.left) / Math.max(1, rect.width) - 0.5;
  const ny = (e.clientY - rect.top) / Math.max(1, rect.height) - 0.5;
  tiltY.value = nx * 24;
  tiltX.value = -ny * 18;
  sheenX.value = Math.round((nx + 0.5) * 100);
  sheenY.value = Math.round((ny + 0.5) * 100);
}

function resetCardTilt(): void {
  tiltX.value = 0;
  tiltY.value = 0;
  sheenX.value = 50;
  sheenY.value = 35;
}

const cardTransformStyle = computed(() => ({
  transform: `perspective(680px) rotateX(${tiltX.value.toFixed(1)}deg) rotateY(${tiltY.value.toFixed(1)}deg)`,
  '--sheen-x': `${sheenX.value}%`,
  '--sheen-y': `${sheenY.value}%`,
}));
</script>

<template>
  <div class="almanac-backdrop" @click.self="emit('close')">
    <section class="corrugated-slab almanac-sheet pinned-card">
      <div class="washi-tape"></div>
      <span class="brass-pin tl"></span>
      <span class="brass-pin tr"></span>

      <header class="almanac-head">
        <div>
          <h2>📖 Storybook Field Almanac</h2>
          <small>Inspect 3D standee cards, Dual Weapons, World Chronicles, Weather &amp; Relics</small>
        </div>
        <button class="paper-btn icon-only" aria-label="Close Almanac" @click="emit('close')">
          <CraftIcon name="close" :size="17" />
        </button>
      </header>

      <!-- Tab Switcher -->
      <nav class="almanac-tabs">
        <button
          class="paper-btn tab-btn"
          :class="{ gold: activeTab === 'heroes' }"
          @click="activeTab = 'heroes'; activeVariant = 'base'"
        >
          🌱 Heroes ({{ heroesList.length }})
        </button>
        <button
          class="paper-btn tab-btn"
          :class="{ gold: activeTab === 'enemies' }"
          @click="activeTab = 'enemies'; activeVariant = 'base'"
        >
          🚜 Farmhands &amp; Bosses ({{ enemiesList.length }})
        </button>
        <button
          class="paper-btn tab-btn"
          :class="{ gold: activeTab === 'weapons' }"
          @click="activeTab = 'weapons'"
        >
          ⚔️ Alt Weapons ({{ ALT_WEAPONS.length }})
        </button>
        <button
          class="paper-btn tab-btn"
          :class="{ gold: activeTab === 'lore' }"
          @click="activeTab = 'lore'"
        >
          📜 World &amp; Lore ({{ discoveredLoreSet.size }}/{{ WORLD_LORE_CHRONICLES.length }})
        </button>
        <button
          class="paper-btn tab-btn"
          :class="{ gold: activeTab === 'relics' }"
          @click="activeTab = 'relics'"
        >
          ✨ Relics &amp; Grafts
        </button>
        <button
          class="paper-btn tab-btn"
          :class="{ gold: activeTab === 'records' }"
          @click="activeTab = 'records'"
        >
          🏅 Records ({{ earnedCount }}/{{ ACHIEVEMENTS.length }})
        </button>
      </nav>

      <!-- TAB 1 & 2: HEROES / ENEMIES WITH 3D TILTABLE PAPER CARD -->
      <div v-if="activeTab === 'heroes' || activeTab === 'enemies'" class="almanac-filter-row">
        <template v-if="activeTab === 'heroes'">
          <button
            v-for="f in [
              { id: 'all', label: `All (${heroesList.length})` },
              { id: 'starters', label: '★ Starters' },
              { id: 'barnyard', label: '🐾 Barnyard' },
              { id: 'root', label: '🥕 Roots' },
              { id: 'vine', label: '🌿 Vines' },
              { id: 'fruit', label: '🍋 Fruits' },
            ] as const"
            :key="f.id"
            class="alm-filter-pill"
            :class="{ active: heroFilter === f.id }"
            @click="setHeroFilter(f.id)"
          >
            {{ f.label }}
          </button>
        </template>
        <template v-else>
          <button
            v-for="f in [
              { id: 'all', label: `All (${enemiesList.length})` },
              { id: 'contraptions', label: '⚙️ Contraptions' },
              { id: 'farmhands', label: '🧑‍🌾 Farmhands' },
              { id: 'bosses', label: '👑 Bosses' },
            ] as const"
            :key="f.id"
            class="alm-filter-pill"
            :class="{ active: enemyFilter === f.id }"
            @click="setEnemyFilter(f.id)"
          >
            {{ f.label }}
          </button>
        </template>
      </div>

      <div v-if="activeTab === 'heroes' || activeTab === 'enemies'" class="almanac-split">
        <aside class="entry-rail scroll-soft">
          <template v-if="activeTab === 'heroes'">
            <button
              v-for="h in filteredHeroes"
              :key="h.id"
              class="entry-btn"
              :class="{ selected: selectedHero.id === h.id }"
              @click="selectHero(h.id)"
            >
              <img :src="`/sprites/${h.species}.png`" :alt="h.name" />
              <div class="eb-meta">
                <strong>
                  {{ h.name }}
                  <span v-if="!unlockedHeroSet.has(h.id)" class="eb-lock" title="Unlock in Hero Greenhouse or Barn Rescue">🔒</span>
                </strong>
                <small>{{ h.title }}</small>
              </div>
            </button>
          </template>
          <template v-else>
            <button
              v-for="e in filteredEnemies"
              :key="e.id"
              class="entry-btn"
              :class="{ selected: selectedEnemy.id === e.id, boss: e.isBoss }"
              @click="selectEnemy(e.id)"
            >
              <img :src="`/sprites/${e.archetype}.png`" :alt="e.name" />
              <div class="eb-meta">
                <strong>{{ e.name }}</strong>
                <small>{{ e.isBoss ? '★ BOSS' : e.title }}</small>
              </div>
            </button>
          </template>
        </aside>

        <div class="entry-detail scroll-soft">
          <div class="card-stage">
            <div
              class="tilt-card"
              :class="{ enraged: activeVariant === 'enraged', boss: activeTab === 'enemies' && selectedEnemy.isBoss }"
              :style="cardTransformStyle"
              @mousemove="onCardMove"
              @mouseleave="resetCardTilt"
            >
              <div class="tilt-sheen"></div>
              <span class="tilt-ribbon">
                {{
                  activeTab === 'heroes'
                    ? getFamilyLabel(selectedHero.family)
                    : selectedEnemy.isBoss
                      ? 'ACT BOSS'
                      : getFamilyLabel(selectedEnemy.family)
                }}
              </span>
              <img class="tilt-sprite" :src="activeSpriteSrc" :alt="activeVisualKind" />
              <div class="tilt-footer">
                <strong>{{ activeTab === 'heroes' ? selectedHero.name : selectedEnemy.name }}</strong>
                <small>{{ activeTab === 'heroes' ? selectedHero.title : selectedEnemy.title }}</small>
              </div>
            </div>

            <!-- Live Expression Variant Toggle Chips -->
            <div class="variant-row">
              <button
                v-for="v in availableVariants"
                :key="v.kind"
                class="var-chip"
                :class="{ active: activeVariant === v.kind }"
                @click="activeVariant = v.kind"
              >
                {{ v.label }}
              </button>
            </div>
            <small class="tilt-hint">Hover card to inspect 3D cardstock tilt</small>
          </div>

          <div v-if="activeTab === 'heroes'" class="detail-info">
            <div class="alm-unlock-row">
              <span v-if="STARTER_SET.has(selectedHero.id)" class="paper-pill alm-status starter">
                ★ Iconic Starter Hero
              </span>
              <span v-else-if="unlockedHeroSet.has(selectedHero.id)" class="paper-pill alm-status owned">
                ✓ Unlocked in Greenhouse (Ready on Turn 1 Bench)
              </span>
              <span v-else class="paper-pill alm-status locked">
                🔒 Unlock in Greenhouse ({{ UNLOCK_COST_MAP[selectedHero.id] ?? 25 }} 🌱) or Barn Rescue
              </span>
            </div>
            <p v-if="selectedHeroQuote" class="alm-hero-quote">{{ selectedHeroQuote }}</p>
            <p class="blurb">{{ selectedHero.blurb }}</p>
            <div class="stat-pills">
              <span class="paper-pill">❤️ {{ selectedHero.maxHp }} HP</span>
              <span class="paper-pill">👟 Move {{ selectedHero.moveRange }}</span>
              <span class="paper-pill">★ Jump {{ selectedHero.jumpRange }}</span>
              <span class="paper-pill">⚡ Dash {{ selectedHero.dashDamage }}</span>
            </div>
            <div v-if="selectedHero.coopPassive" class="info-box coop">
              <strong>🐾 Barnyard Passive</strong>
              <small>{{ selectedHero.coopPassive }}</small>
            </div>
            <div class="alm-dual-grid">
              <div class="info-box alm-wpn-card primary">
                <div class="alm-wpn-head">
                  <img
                    class="alm-wpn-art"
                    :src="getWeaponCutoutDataUrl(selectedHeroKit.primary.visualKind ?? 'blaster', 1)"
                    :alt="selectedHeroKit.primary.name"
                  />
                  <div>
                    <span class="alm-slot-tag ranged">🎯 PRIMARY RANGED</span>
                    <strong>{{ selectedHeroKit.primary.name }}</strong>
                  </div>
                </div>
                <small>
                  {{ selectedHeroKit.primary.damage }} DMG · R{{ selectedHeroKit.primary.minRange }}–{{ selectedHeroKit.primary.maxRange }} ({{ selectedHeroKit.primary.arc }}) — {{ selectedHeroKit.primary.description }}
                </small>
              </div>
              <div class="info-box alm-wpn-card secondary">
                <div class="alm-wpn-head">
                  <img
                    class="alm-wpn-art"
                    :src="getWeaponCutoutDataUrl(selectedHeroKit.secondary.visualKind ?? 'hammer', 1)"
                    :alt="selectedHeroKit.secondary.name"
                  />
                  <div>
                    <span class="alm-slot-tag gimmick">
                      {{ selectedHeroKit.secondary.gimmick ? GIMMICK_BADGE[selectedHeroKit.secondary.gimmick] : '🔨 SECONDARY' }}
                    </span>
                    <strong>{{ selectedHeroKit.secondary.name }}</strong>
                  </div>
                </div>
                <small>
                  {{ selectedHeroKit.secondary.damage }} DMG · R{{ selectedHeroKit.secondary.minRange }}–{{ selectedHeroKit.secondary.maxRange }} ({{ selectedHeroKit.secondary.arc }}) — {{ selectedHeroKit.secondary.description }}
                </small>
              </div>
            </div>
            <div class="info-box alt-wpn">
              <strong>⚒️ Armory Alt Primary: {{ selectedHeroWeapons.alt.weapon.name }}</strong>
              <small>
                {{ selectedHeroWeapons.alt.weapon.damage }} DMG · Range {{ selectedHeroWeapons.alt.weapon.minRange }}–{{ selectedHeroWeapons.alt.weapon.maxRange }} ({{ selectedHeroWeapons.alt.weapon.arc }}) — {{ selectedHeroWeapons.alt.weapon.description }}
              </small>
            </div>
            <div class="info-box">
              <strong>✨ Signature Skill: {{ selectedHero.ability.name }} (CD {{ selectedHero.ability.cooldown }})</strong>
              <small>{{ selectedHero.ability.description }}</small>
            </div>
            <div class="info-box tree-box">
              <strong>🌿 Deep Botanical Skill Trees (3 Paths · 12 Perks · 4 Tiers + Capstones)</strong>
              <small>
                <strong>{{ selectedHeroTree.pathA.icon }} {{ selectedHeroTree.pathA.name }}:</strong>
                {{ selectedHeroTree.pathA.tagline }}
              </small>
              <small>
                <strong>{{ selectedHeroTree.pathB.icon }} {{ selectedHeroTree.pathB.name }}:</strong>
                {{ selectedHeroTree.pathB.tagline }}
              </small>
              <small>
                <strong>{{ selectedHeroTree.pathC.icon }} {{ selectedHeroTree.pathC.name }}:</strong>
                {{ selectedHeroTree.pathC.tagline }}
              </small>
            </div>
          </div>

          <div v-else class="detail-info">
            <p class="blurb">{{ selectedEnemy.blurb }}</p>
            <div class="stat-pills">
              <span class="paper-pill">❤️ {{ selectedEnemy.maxHp }} HP</span>
              <span class="paper-pill">👟 Move {{ selectedEnemy.moveRange }}</span>
              <span class="paper-pill">⚡ Dash {{ selectedEnemy.dashDamage }}</span>
            </div>
            <div class="info-box">
              <strong>🔧 Weapon: {{ selectedEnemy.weapon.name }}</strong>
              <small>
                {{ selectedEnemy.weapon.damage }} DMG · Range {{ selectedEnemy.weapon.minRange }}–{{ selectedEnemy.weapon.maxRange }} ({{ selectedEnemy.weapon.arc }}) — {{ selectedEnemy.weapon.description }}
              </small>
            </div>
            <div v-if="selectedEnemy.ability" class="info-box boss-box">
              <strong>🔥 Boss Ability: {{ selectedEnemy.ability.name }}</strong>
              <small>{{ selectedEnemy.ability.description }}</small>
            </div>
            <div v-if="selectedEnemy.isBoss" class="info-box alt-wpn">
              <strong>⚠ Phase 2 Enraged (≤ 50% HP)</strong>
              <small>Gains Shield + Boosted, shifts into crimson enraged stance, and upgrades telegraphed board strikes!</small>
            </div>
          </div>
        </div>
      </div>

      <!-- TAB 3: ARMORY ALTERNATE WEAPONS -->
      <div v-else-if="activeTab === 'weapons'" class="grid-pane scroll-soft">
        <div class="catalog-grid">
          <div v-for="entry in ALT_WEAPONS" :key="entry.weapon.id" class="catalog-card seed-packet">
            <div class="cat-top">
              <img class="cat-spr" :src="`/sprites/${entry.species}.png`" :alt="entry.species" />
              <div>
                <strong>{{ entry.weapon.name }}</strong>
                <small>{{ PRODUCE_BLUEPRINTS[entry.species]?.name }} · {{ entry.tagline }}</small>
              </div>
            </div>
            <div class="cat-stats">
              <span>🎯 {{ entry.weapon.damage }} DMG</span>
              <span>R{{ entry.weapon.minRange }}-{{ entry.weapon.maxRange }}</span>
              <span>{{ entry.weapon.arc.toUpperCase() }}</span>
              <span v-if="entry.weapon.knockback">⇄ Push</span>
              <span v-if="entry.weapon.appliesStatus">+{{ entry.weapon.appliesStatus.kind }}</span>
            </div>
            <p class="cat-desc">{{ entry.weapon.description }}</p>
          </div>
        </div>
      </div>

      <!-- TAB 4: WORLD & LORE CHRONICLES, WEATHER & FACTIONS -->
      <div v-else-if="activeTab === 'lore'" class="grid-pane scroll-soft">
        <h3 class="sub-sec-head">🌦️ The Four Seasons &amp; Weather Passives</h3>
        <div class="lore-weather-grid">
          <div
            v-for="w in weatherList"
            :key="w.seasonId"
            class="seed-packet lore-weather-card"
            :style="{ '--w-accent': w.badgeColor }"
          >
            <strong>{{ w.icon }} {{ w.name }}</strong>
            <small class="lw-rule">{{ w.shortRule }}</small>
            <p class="cat-desc">{{ w.detail }}</p>
          </div>
        </div>

        <h3 class="sub-sec-head" style="margin-top: 12px">🚩 Faction Dossiers</h3>
        <div class="lore-faction-grid">
          <div
            v-for="fac in FACTION_DOSSIERS"
            :key="fac.id"
            class="seed-packet lore-faction-card"
            :style="{ '--fac-accent': fac.accent }"
          >
            <strong>{{ fac.icon }} {{ fac.name }}</strong>
            <em class="lf-motto">{{ fac.motto }}</em>
            <p class="cat-desc">{{ fac.summary }}</p>
          </div>
        </div>

        <div class="lore-chron-head">
          <h3 class="sub-sec-head" style="margin: 0">
            📜 Field Chronicles ({{ discoveredLoreSet.size }}/{{ WORLD_LORE_CHRONICLES.length }})
          </h3>
          <div class="almanac-filter-row" style="padding: 0">
            <button
              v-for="sf in [
                { id: 'all', label: 'All' },
                { id: 'spring', label: '🌸 Spring' },
                { id: 'summer', label: '☀️ Summer' },
                { id: 'autumn', label: '🍂 Autumn' },
                { id: 'winter', label: '❄️ Winter' },
              ] as const"
              :key="sf.id"
              class="alm-filter-pill"
              :class="{ active: loreSeasonFilter === sf.id }"
              @click="loreSeasonFilter = sf.id"
            >
              {{ sf.label }}
            </button>
          </div>
        </div>

        <div class="catalog-grid">
          <article
            v-for="entry in filteredChronicles"
            :key="entry.id"
            class="catalog-card seed-packet lore-entry-card"
            :class="{ locked: !discoveredLoreSet.has(entry.id) }"
          >
            <div class="le-top">
              <span class="le-num">#{{ entry.order }} · {{ entry.region }}</span>
              <span class="le-season">{{ SEASON_WEATHER_INFO[entry.seasonId].icon }}</span>
            </div>
            <strong>
              {{ discoveredLoreSet.has(entry.id) ? `${entry.icon} ${entry.title}` : `🔒 Undiscovered Monument` }}
            </strong>
            <template v-if="discoveredLoreSet.has(entry.id)">
              <p class="cat-desc">{{ entry.body }}</p>
              <small class="le-tip">🧭 {{ entry.tacticalNote }}</small>
            </template>
            <p v-else class="cat-desc">
              Visit a 📜 Lore Monument in {{ entry.region }} ({{ SEASON_WEATHER_INFO[entry.seasonId].name }} Act) to unlock this page!
            </p>
          </article>
        </div>
      </div>

      <!-- TAB 5: RECORDS, ACHIEVEMENTS & RUN HISTORY -->
      <div v-else-if="activeTab === 'records'" class="grid-pane scroll-soft">
        <h3 class="sub-sec-head">Records</h3>
        <dl class="record-grid">
          <div v-for="r in records" :key="r.label" class="seed-packet record-card">
            <dt>{{ r.label }}</dt>
            <dd>{{ r.value }}</dd>
          </div>
        </dl>

        <h3 class="sub-sec-head" style="margin-top: 12px">Achievements ({{ earnedCount }}/{{ ACHIEVEMENTS.length }})</h3>
        <div class="catalog-grid">
          <div
            v-for="a in ACHIEVEMENTS"
            :key="a.id"
            class="catalog-card seed-packet"
            :class="{ 'ach-locked': !history.achievements[a.id] }"
          >
            <strong>{{ a.icon }} {{ a.name }}</strong>
            <p class="cat-desc">{{ a.desc }}</p>
            <small class="ach-state">
              {{ history.achievements[a.id] ? `Earned ${shortDate(history.achievements[a.id])}` : `Reward: ${a.seeds} seeds` }}
            </small>
          </div>
        </div>

        <h3 class="sub-sec-head" style="margin-top: 12px">Recent Runs</h3>
        <ol v-if="history.runs.length > 0" class="run-list">
          <li v-for="r in history.runs" :key="r.id" class="seed-packet run-row">
            <strong>{{ fmt(r.score) }}</strong>
            <span>
              {{ r.victory ? 'Garden freed' : `Fell in Act ${r.act}` }} · {{ r.battlesWon }} battles
              <template v-if="r.heat > 0"> · Heat {{ r.heat }}</template>
              <template v-if="r.mode === 'daily'"> · Daily{{ r.practice ? ' practice' : '' }}</template>
            </span>
            <small>{{ shortDate(r.at) }}</small>
          </li>
        </ol>
        <p v-else class="cat-desc">Finish a run and it will show up here.</p>
      </div>

      <!-- TAB 4: RELICS & GRAFTS -->
      <div v-else class="grid-pane scroll-soft">
        <h3 class="sub-sec-head">Soil Relics ({{ relicsList.length }})</h3>
        <div class="catalog-grid">
          <div v-for="r in relicsList" :key="r.id" class="catalog-card seed-packet">
            <strong>{{ r.icon }} {{ r.name }}</strong>
            <p class="cat-desc">{{ r.description }}</p>
          </div>
        </div>
        <h3 class="sub-sec-head" style="margin-top: 12px">Graft Stickers ({{ graftsList.length }})</h3>
        <div class="catalog-grid">
          <div v-for="g in graftsList" :key="g.id" class="catalog-card seed-packet">
            <strong>{{ g.badgeIcon }} {{ g.name }}</strong>
            <p class="cat-desc">{{ g.description }}</p>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.almanac-backdrop {
  position: fixed;
  inset: 0;
  z-index: 70;
  background: rgba(24, 12, 4, 0.68);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 14px;
}

.almanac-sheet {
  width: min(980px, 100%);
  max-height: min(90dvh, 720px);
  display: flex;
  flex-direction: column;
  padding: 16px 18px 18px;
  gap: 11px;
  position: relative;
}

.almanac-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
}

.almanac-head h2 {
  margin: 0;
  font-size: 1.26rem;
  color: var(--ink);
}

.almanac-head small {
  color: var(--ink-soft);
  font-size: 0.8rem;
}

.almanac-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
}

.tab-btn {
  padding: 6px 12px;
  font-size: 0.8rem;
}

.almanac-split {
  display: grid;
  grid-template-columns: 215px minmax(0, 1fr);
  gap: 12px;
  min-height: 0;
  flex: 1;
}

.entry-rail {
  display: flex;
  flex-direction: column;
  gap: 6px;
  overflow-y: auto;
  padding-right: 4px;
}

.entry-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  background: #f9eed7;
  border: 2px solid var(--ink);
  border-radius: 11px;
  cursor: pointer;
  text-align: left;
  transition: transform 0.12s ease, background-color 0.12s ease;
}

.entry-btn:hover {
  transform: translateY(-1px);
  background: #fff8e8;
}

.entry-btn.selected {
  background: #ffe68a;
  box-shadow: 0 3px 0 var(--ink);
}

.entry-btn.boss {
  border-color: #9e2a1c;
}

.entry-btn img {
  width: 34px;
  height: 34px;
  object-fit: contain;
  flex-shrink: 0;
}

.eb-meta {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.eb-meta strong {
  font-size: 0.82rem;
  color: var(--ink);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.eb-meta small {
  font-size: 0.69rem;
  color: var(--ink-soft);
}

.entry-detail {
  display: grid;
  grid-template-columns: 245px minmax(0, 1fr);
  gap: 14px;
  overflow-y: auto;
  padding: 4px;
  align-items: start;
}

.card-stage {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

.tilt-card {
  position: relative;
  width: 224px;
  height: 274px;
  border-radius: 18px;
  border: 3px solid var(--ink);
  background: linear-gradient(165deg, #fffdf4 0%, #f5e2ba 58%, #e5c68a 100%);
  box-shadow: 0 12px 24px rgba(42, 20, 6, 0.34), inset 0 0 0 4px rgba(255, 250, 232, 0.72);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: space-between;
  padding: 12px 12px 11px;
  transition: transform 0.12s ease-out;
  transform-style: preserve-3d;
  overflow: hidden;
}

.tilt-card.boss {
  background: linear-gradient(165deg, #fff6e6 0%, #f2c9a0 60%, #d48c62 100%);
  border-color: #7c1f14;
}

.tilt-card.enraged {
  background: linear-gradient(165deg, #ffe2c8 0%, #f0885a 58%, #a6281c 100%);
  box-shadow: 0 0 22px rgba(255, 68, 34, 0.55), 0 12px 24px rgba(42, 20, 6, 0.4);
}

.tilt-sheen {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: radial-gradient(
    circle at var(--sheen-x, 50%) var(--sheen-y, 35%),
    rgba(255, 255, 255, 0.52) 0%,
    rgba(255, 255, 255, 0) 58%
  );
}

.tilt-ribbon {
  position: relative;
  z-index: 1;
  background: #4a2c17;
  color: #ffe891;
  font-size: 0.67rem;
  font-weight: 800;
  letter-spacing: 0.05em;
  padding: 2px 10px;
  border-radius: 999px;
}

.tilt-sprite {
  position: relative;
  z-index: 2;
  width: 158px;
  height: 158px;
  object-fit: contain;
  filter: drop-shadow(0 8px 10px rgba(42, 20, 6, 0.36));
  transform: translateZ(24px);
}

.tilt-footer {
  position: relative;
  z-index: 2;
  text-align: center;
  background: rgba(255, 251, 240, 0.88);
  border: 1.6px solid rgba(69, 42, 22, 0.32);
  border-radius: 10px;
  padding: 4px 10px;
  width: 100%;
}

.tilt-footer strong {
  display: block;
  font-size: 0.94rem;
  color: var(--ink);
}

.tilt-footer small {
  display: block;
  font-size: 0.72rem;
  color: var(--ink-soft);
}

.variant-row {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 5px;
}

.var-chip {
  border: 1.8px solid var(--ink);
  border-radius: 999px;
  padding: 3px 9px;
  font-size: 0.72rem;
  font-weight: 800;
  background: #f8ecd2;
  color: var(--ink);
  cursor: pointer;
}

.var-chip.active {
  background: #f7c948;
  box-shadow: 0 2px 0 var(--ink);
}

.tilt-hint {
  font-size: 0.68rem;
  color: var(--ink-soft);
}

.detail-info {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.blurb {
  margin: 0;
  font-size: 0.85rem;
  line-height: 1.38;
  color: var(--ink);
  font-weight: 600;
}

.stat-pills {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.info-box {
  background: #fffaf0;
  border: 1.8px solid rgba(74, 44, 23, 0.36);
  border-radius: 11px;
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.info-box.coop {
  background: #ebf7df;
  border-color: #558c34;
}

.info-box.alt-wpn {
  background: #fff3cc;
  border-color: #c98718;
}

.info-box.boss-box {
  background: #ffe6dc;
  border-color: #b83224;
}

.info-box strong {
  font-size: 0.82rem;
  color: var(--ink);
}

.info-box small {
  font-size: 0.76rem;
  color: var(--ink-soft);
  line-height: 1.32;
}

.grid-pane {
  overflow-y: auto;
  flex: 1;
  min-height: 0;
  padding-right: 4px;
}

.sub-sec-head {
  margin: 0 0 8px;
  font-size: 0.96rem;
  color: var(--ink);
}

.catalog-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
  gap: 9px;
}

.catalog-card {
  padding: 11px 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.cat-top {
  display: flex;
  align-items: center;
  gap: 9px;
}

.cat-spr {
  width: 38px;
  height: 38px;
  object-fit: contain;
}

.cat-top strong {
  display: block;
  font-size: 0.88rem;
  color: var(--ink);
}

.cat-top small {
  display: block;
  font-size: 0.72rem;
  color: var(--ink-soft);
}

.cat-stats {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  font-size: 0.7rem;
  font-weight: 800;
}

.cat-stats span {
  background: #f5e5c1;
  border: 1px solid rgba(74, 44, 23, 0.32);
  border-radius: 6px;
  padding: 1px 6px;
}

.cat-desc {
  margin: 0;
  font-size: 0.75rem;
  line-height: 1.32;
  color: var(--ink-soft);
}

@media (max-width: 780px) {
  .almanac-split,
  .entry-detail {
    grid-template-columns: 1fr;
  }

  .entry-rail {
    flex-direction: row;
    overflow-x: auto;
    overflow-y: hidden;
  }

  .entry-btn {
    flex: 0 0 auto;
  }
}
.record-grid {
  margin: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 8px;
}

.record-card {
  padding: 9px 12px;
  color: var(--ink);
}

.record-card dt {
  font-size: 0.78rem;
  color: var(--ink-soft);
}

.record-card dd {
  margin: 2px 0 0;
  font-family: 'Fredoka', sans-serif;
  font-weight: 700;
}

.ach-locked {
  opacity: 0.62;
}

.ach-state {
  color: var(--ink-soft);
}

.run-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.run-row {
  display: flex;
  align-items: baseline;
  gap: 10px;
  padding: 8px 12px;
  color: var(--ink);
}

.run-row strong {
  font-family: 'Fredoka', sans-serif;
  min-width: 3.6em;
  font-variant-numeric: tabular-nums;
}

.run-row span {
  flex: 1;
  min-width: 0;
}

.run-row small {
  color: var(--ink-soft);
}
.almanac-filter-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 2px 0 4px;
}
.alm-filter-pill {
  padding: 4px 10px;
  border-radius: 999px;
  border: 1.5px solid #9d794c;
  background: #fbf3df;
  color: #523519;
  font-size: 0.74rem;
  font-weight: 800;
  cursor: pointer;
  transition: transform 0.1s ease, background 0.12s ease;
}
.alm-filter-pill:hover {
  transform: translateY(-1px);
  background: #fff8e8;
}
.alm-filter-pill.active {
  background: linear-gradient(180deg, #ffe791, #f0b635);
  border-color: #7d4706;
  color: #3e2000;
  box-shadow: 0 2px 0 #7d4706;
}
.eb-lock {
  font-size: 0.72rem;
  margin-left: 3px;
  opacity: 0.8;
}
.alm-unlock-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 6px;
}
.alm-status {
  font-size: 0.74rem;
  font-weight: 800;
}
.alm-status.starter {
  background: #fff2be;
  border-color: #b57d14;
  color: #5b3800;
}
.alm-status.owned {
  background: #dff6d4;
  border-color: #3f842c;
  color: #1f4f15;
}
.alm-status.locked {
  background: #f5e6cf;
  border-color: #9e7346;
  color: #5f3a18;
}
.alm-hero-quote {
  margin: 0;
  padding: 6px 10px;
  border-radius: 10px;
  border-left: 4px solid #c98718;
  background: #fff7e0;
  font-size: 0.78rem;
  font-style: italic;
  font-weight: 700;
  color: #633d12;
}
.alm-dual-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}
.alm-wpn-card.primary {
  background: #f4faff;
  border-color: #3a75a8;
}
.alm-wpn-card.secondary {
  background: #fff7ea;
  border-color: #c26a23;
}
.alm-wpn-head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.alm-wpn-art {
  width: 44px;
  height: 44px;
  object-fit: contain;
  flex-shrink: 0;
  filter: drop-shadow(0 3px 4px rgba(42, 20, 6, 0.25));
}
.alm-slot-tag {
  display: inline-block;
  font-size: 0.61rem;
  font-weight: 900;
  padding: 1px 6px;
  border-radius: 999px;
  margin-bottom: 2px;
}
.alm-slot-tag.ranged {
  background: #d7ecff;
  color: #164b78;
}
.alm-slot-tag.gimmick {
  background: #ffe0bd;
  color: #7d3607;
}
.lore-weather-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(205px, 1fr));
  gap: 8px;
}
.lore-weather-card {
  padding: 10px 11px;
  border-left: 5px solid var(--w-accent, #5ea342);
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.lw-rule {
  font-size: 0.72rem;
  font-weight: 800;
  color: #3b5e1d;
}
.lore-faction-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 8px;
}
.lore-faction-card {
  padding: 10px 12px;
  border-top: 4px solid var(--fac-accent, #4d9638);
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.lf-motto {
  font-size: 0.73rem;
  font-weight: 700;
  color: #73441b;
}
.lore-chron-head {
  margin: 14px 0 8px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
}
.lore-entry-card.locked {
  opacity: 0.68;
  background: #f0e4cc;
}
.le-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 0.68rem;
  font-weight: 800;
  color: #7a5832;
}
.le-tip {
  font-size: 0.71rem;
  font-weight: 800;
  color: #295a19;
  background: #eaf7df;
  border: 1px dashed #60993e;
  border-radius: 7px;
  padding: 4px 7px;
}
@media (max-width: 640px) {
  .alm-dual-grid {
    grid-template-columns: 1fr;
  }
}
</style>
