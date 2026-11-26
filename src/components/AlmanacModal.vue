<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { ENEMY_BLUEPRINTS } from '../data/enemies';
import { GRAFT_REGISTRY } from '../data/grafts';
import { PRODUCE_BLUEPRINTS } from '../data/produce';
import { RELIC_REGISTRY } from '../data/relics';
import { getHeroSkillTree } from '../data/skills';
import { ALT_WEAPONS, getSpeciesWeapons } from '../data/weapons';
import { activeStreak, loadDailyState } from '../engine/daily';
import { ACHIEVEMENTS, loadHistory } from '../engine/history';
import { getFamilyLabel } from '../engine/hooks';
import { dailyKeyFor } from '../engine/score';
import { hasVariantSprite, resolveVariantSpriteKey, type SpriteVariantKind } from '../renderer3d/textures';
import CraftIcon from './CraftIcon.vue';

const emit = defineEmits<{
  close: [];
}>();

function onAlmanacKeyDown(e: KeyboardEvent): void {
  if (e.key === 'Escape') emit('close');
}

onMounted(() => window.addEventListener('keydown', onAlmanacKeyDown));
onBeforeUnmount(() => window.removeEventListener('keydown', onAlmanacKeyDown));

type AlmanacTab = 'heroes' | 'enemies' | 'weapons' | 'relics' | 'records';

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
  { label: 'Best score', value: fmt(history.stats.bestScore) },
  { label: 'Best daily score', value: fmt(history.stats.bestDailyScore) },
  { label: 'Highest Heat won', value: history.stats.highestHeatWon >= 0 ? `Heat ${history.stats.highestHeatWon}` : 'None yet' },
  { label: 'Fastest win', value: history.stats.fastestWinTurns > 0 ? `${history.stats.fastestWinTurns} battle turns` : 'None yet' },
  { label: 'Farmers routed', value: fmt(history.stats.enemiesDefeated) },
  { label: 'Daily streak', value: `${streakNow} now · best ${dailyStreak.best}` },
];

const activeTab = ref<AlmanacTab>('heroes');
const heroesList = Object.values(PRODUCE_BLUEPRINTS);
const enemiesList = Object.values(ENEMY_BLUEPRINTS);
const relicsList = Object.values(RELIC_REGISTRY);
const graftsList = Object.values(GRAFT_REGISTRY);

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
          <small>Inspect 3D-tiltable standee cards, live sprite expressions, Armory weapons &amp; relics</small>
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
      <div v-if="activeTab === 'heroes' || activeTab === 'enemies'" class="almanac-split">
        <aside class="entry-rail scroll-soft">
          <template v-if="activeTab === 'heroes'">
            <button
              v-for="h in heroesList"
              :key="h.id"
              class="entry-btn"
              :class="{ selected: selectedHero.id === h.id }"
              @click="selectHero(h.id)"
            >
              <img :src="`/sprites/${h.species}.png`" :alt="h.name" />
              <div class="eb-meta">
                <strong>{{ h.name }}</strong>
                <small>{{ h.title }}</small>
              </div>
            </button>
          </template>
          <template v-else>
            <button
              v-for="e in enemiesList"
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
            <div class="info-box">
              <strong>🎯 Base Weapon: {{ selectedHeroWeapons.base.name }}</strong>
              <small>
                {{ selectedHeroWeapons.base.damage }} DMG · Range {{ selectedHeroWeapons.base.minRange }}–{{ selectedHeroWeapons.base.maxRange }} ({{ selectedHeroWeapons.base.arc }}) — {{ selectedHeroWeapons.base.description }}
              </small>
            </div>
            <div class="info-box alt-wpn">
              <strong>⚔️ Armory Alt Weapon: {{ selectedHeroWeapons.alt.weapon.name }}</strong>
              <small>
                {{ selectedHeroWeapons.alt.weapon.damage }} DMG · Range {{ selectedHeroWeapons.alt.weapon.minRange }}–{{ selectedHeroWeapons.alt.weapon.maxRange }} ({{ selectedHeroWeapons.alt.weapon.arc }}) — {{ selectedHeroWeapons.alt.weapon.description }}
              </small>
            </div>
            <div class="info-box">
              <strong>✨ Signature Skill: {{ selectedHero.ability.name }} (CD {{ selectedHero.ability.cooldown }})</strong>
              <small>{{ selectedHero.ability.description }}</small>
            </div>
            <div class="info-box tree-box">
              <strong>🌿 Unique Skill Trees</strong>
              <small>
                <strong>{{ selectedHeroTree.pathA.icon }} {{ selectedHeroTree.pathA.name }}:</strong>
                {{ selectedHeroTree.pathA.tagline }}
              </small>
              <small>
                <strong>{{ selectedHeroTree.pathB.icon }} {{ selectedHeroTree.pathB.name }}:</strong>
                {{ selectedHeroTree.pathB.tagline }}
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
</style>
