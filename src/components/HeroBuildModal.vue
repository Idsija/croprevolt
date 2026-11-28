<script setup lang="ts">
import { bondStatuses } from '../engine/bonds';
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { GRAFT_REGISTRY } from '../data/grafts';
import { HERO_LORE_QUOTES } from '../data/lore';
import {
  canUnlockPerk,
  getHeroSkillTree,
  getXpToNextLevel,
  MAX_HERO_LEVEL,
  SKILL_PERKS,
  type SkillPathDef,
} from '../data/skills';
import {
  ALT_WEAPON_REGISTRY,
  buildScaledWeaponForHero,
  getDualWeaponKit,
  getSpeciesWeapons,
  getWeaponForgeOptions,
} from '../data/weapons';
import { getFamilyLabel } from '../engine/hooks';
import type { WeaponForgeBranch, WeaponSlot } from '../engine/types';
import { getWeaponCutoutDataUrl } from '../renderer3d/weaponProps';
import {
  equipWeapon,
  forgeWeapon,
  gameStore,
  reassignHeroOwner,
  respecPerks,
  setDefaultWeaponSlot,
  swapSquadMembers,
  toggleSquadMember,
  unlockPerk,
} from '../stores/gameStore';
import CraftIcon from './CraftIcon.vue';

const props = defineProps<{
  initialHeroUid?: string | null;
  initialTab?: 'trees' | 'armory' | 'squad';
  isForgeStop?: boolean;
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
const coopPlayers = computed(() =>
  run.value.coopPlayers && run.value.coopPlayers.length > 1 ? run.value.coopPlayers : null
);
const activeTab = ref<'trees' | 'armory' | 'squad'>(props.initialTab ?? 'trees');
const mobileBranchIdx = ref<number>(0);

const squadBonds = computed(() =>
  bondStatuses(run.value.roster.filter((h) => !h.harvested && run.value.activeSquadUids.includes(h.uid)))
);
const activeBondCount = computed(() => squadBonds.value.filter((b) => b.tier > 0).length);
const showBondsDrawer = ref(false);
const openBondId = ref<string | null>(null);
const openBond = computed(() => squadBonds.value.find((b) => b.def.id === openBondId.value) ?? null);

const selectedUid = ref<string>(
  props.initialHeroUid ??
    run.value.activeSquadUids[0] ??
    run.value.roster[0]?.uid ??
    ''
);

const swapPickerOpen = ref(false);
const swapNotice = ref<string | null>(null);
let swapNoticeTimer: ReturnType<typeof setTimeout> | null = null;

function showNotice(msg: string): void {
  swapNotice.value = msg;
  if (swapNoticeTimer) clearTimeout(swapNoticeTimer);
  swapNoticeTimer = setTimeout(() => {
    swapNotice.value = null;
  }, 2600);
}

watch(
  () => props.initialHeroUid,
  (uid) => {
    if (uid) selectedUid.value = uid;
  }
);

watch(
  () => props.initialTab,
  (tab) => {
    if (tab) activeTab.value = tab;
  }
);

watch(selectedUid, () => {
  swapPickerOpen.value = false;
  mobileBranchIdx.value = 0;
});

onBeforeUnmount(() => {
  if (swapNoticeTimer) clearTimeout(swapNoticeTimer);
});

const activeSquadHeroes = computed(() =>
  run.value.activeSquadUids
    .map((uid) => run.value.roster.find((h) => h.uid === uid && !h.harvested))
    .filter((h): h is NonNullable<typeof h> => Boolean(h))
);

const benchHeroes = computed(() =>
  run.value.roster.filter((h) => !h.harvested && !run.value.activeSquadUids.includes(h.uid))
);

const sortedRoster = computed(() => [
  ...activeSquadHeroes.value,
  ...benchHeroes.value,
  ...run.value.roster.filter((h) => h.harvested),
]);

const selectedHero = computed(
  () => run.value.roster.find((h) => h.uid === selectedUid.value) ?? run.value.roster[0] ?? null
);

const selectedHeroLoreQuote = computed(() =>
  selectedHero.value ? HERO_LORE_QUOTES[selectedHero.value.species] ?? '' : ''
);

const heroTree = computed(() =>
  selectedHero.value ? getHeroSkillTree(selectedHero.value.species) : null
);

const heroPaths = computed<SkillPathDef[]>(() =>
  heroTree.value ? [heroTree.value.pathA, heroTree.value.pathB, heroTree.value.pathC] : []
);

function ownerFor(heroUid: string) {
  if (!coopPlayers.value) return null;
  const idx = run.value.heroOwnerByUid?.[heroUid] ?? 0;
  return coopPlayers.value[idx] ?? coopPlayers.value[0];
}

const isSelectedActive = computed(() =>
  selectedHero.value ? run.value.activeSquadUids.includes(selectedHero.value.uid) : false
);

function performDirectSwap(activeUid: string, benchUid: string): void {
  const outHero = run.value.roster.find((h) => h.uid === activeUid);
  const inHero = run.value.roster.find((h) => h.uid === benchUid);
  if (!swapSquadMembers(activeUid, benchUid)) return;
  swapPickerOpen.value = false;
  selectedUid.value = benchUid;
  if (outHero && inHero) {
    showNotice(`Swapped ${outHero.name.split(' ')[0]} ⇄ ${inHero.name.split(' ')[0]}!`);
  }
}

const forgeDiscountMult = computed(() => (props.isForgeStop || run.value.status === 'forge' ? 0.7 : 1));
const forgeVouchers = computed(() => run.value.forgeVouchers ?? 0);

const selectedHeroArmory = computed(() => {
  const h = selectedHero.value;
  if (!h) return null;
  const pair = getSpeciesWeapons(h.species);
  const kit = getDualWeaponKit(h.species);
  const unlocked = new Set(run.value.unlockedWeaponIds ?? []);
  const altUnlocked = unlocked.has(pair.alt.weapon.id);
  const equippedId = h.equippedWeaponId ?? pair.base.id;
  const activeSlot: WeaponSlot = h.activeWeaponSlot ?? kit.defaultSlot ?? 'primary';

  const primaryBase =
    h.equippedWeaponId && ALT_WEAPON_REGISTRY[h.equippedWeaponId]
      ? ALT_WEAPON_REGISTRY[h.equippedWeaponId].weapon
      : kit.primary;

  const primaryWeapon = h.primaryWeapon ?? buildScaledWeaponForHero(h, primaryBase);
  const secondaryWeapon = h.secondaryWeapon ?? buildScaledWeaponForHero(h, kit.secondary);

  return {
    kit,
    activeSlot,
    primaryWeapon,
    secondaryWeapon,
    primaryCutout: getWeaponCutoutDataUrl(
      primaryWeapon.visualKind ?? 'blaster',
      primaryWeapon.forgeTier ?? 1,
      primaryWeapon.forgeBranch
    ),
    secondaryCutout: getWeaponCutoutDataUrl(
      secondaryWeapon.visualKind ?? 'hammer',
      secondaryWeapon.forgeTier ?? 1,
      secondaryWeapon.forgeBranch
    ),
    primaryForgeOpts: getWeaponForgeOptions(
      primaryBase,
      h.species,
      h.weaponForge?.primary,
      forgeDiscountMult.value
    ),
    secondaryForgeOpts: getWeaponForgeOptions(
      kit.secondary,
      h.species,
      h.weaponForge?.secondary,
      forgeDiscountMult.value
    ),
    base: buildScaledWeaponForHero(h, pair.base),
    alt: buildScaledWeaponForHero(h, pair.alt.weapon),
    altTagline: pair.alt.tagline,
    altUnlocked,
    equippedId,
  };
});

function handleEquipWeapon(weaponId: string): void {
  if (!selectedHero.value || selectedHero.value.harvested) return;
  if (equipWeapon(selectedHero.value.uid, weaponId)) {
    showNotice('Equipped Alternate Primary Weapon!');
  }
}

function handleSetDefaultSlot(slot: WeaponSlot): void {
  if (!selectedHero.value || selectedHero.value.harvested) return;
  if (setDefaultWeaponSlot(selectedHero.value.uid, slot)) {
    showNotice(
      slot === 'secondary'
        ? `${selectedHero.value.name.split(' ')[0]} will start battles holding their Secondary Gimmick!`
        : `${selectedHero.value.name.split(' ')[0]} will start battles holding their Ranged Primary!`
    );
  }
}

function handleForge(slot: WeaponSlot, branch: WeaponForgeBranch, cost: number): void {
  const h = selectedHero.value;
  if (!h || h.harvested) return;
  const usingVoucher = forgeVouchers.value > 0;
  if (!usingVoucher && run.value.seeds < cost) return;
  if (forgeWeapon(h.uid, slot, branch, usingVoucher)) {
    const label = branch === 'tactical' ? '⚙️ Tactical Forge' : '🔥 Elemental Forge';
    showNotice(`${label} complete on ${h.name.split(' ')[0]}'s ${slot === 'secondary' ? 'Secondary' : 'Primary'}!`);
  }
}

function tierStars(tier?: number): string {
  const t = tier ?? 1;
  return t >= 3 ? '★★★' : t === 2 ? '★★' : '★';
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

function jumpToNextSpHero(): void {
  const withSp = sortedRoster.value.filter((h) => !h.harvested && h.skillPoints > 0);
  if (withSp.length === 0) return;
  const curIdx = withSp.findIndex((h) => h.uid === selectedUid.value);
  const next = withSp[(curIdx + 1) % withSp.length];
  if (next) {
    selectedUid.value = next.uid;
    activeTab.value = 'trees';
  }
}

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
        <div class="build-head-copy">
          <h2>
            {{ isForgeStop ? '🔥 Tinker Weapon Forge & Squad' : 'Squad, 4-Tier Skill Trees & Forge' }}
          </h2>
          <small>
            On Field: {{ run.activeSquadUids.length }}/4 · 🌱 {{ run.seeds }} Seeds
            <template v-if="forgeVouchers > 0"> · 🎟️ {{ forgeVouchers }} Free Forge{{ forgeVouchers === 1 ? '' : 's' }}</template>
            <template v-if="forgeDiscountMult < 1"> · <strong class="forge-sale-txt">🔥 30% OFF!</strong></template>
            ·
            <button
              v-if="totalUnspentSp > 0"
              class="sp-jump-pill"
              title="Jump straight to the next hero with unspent Skill Points"
              @click="jumpToNextSpHero"
            >
              ★ {{ totalUnspentSp }} SP ready · Next →
            </button>
            <span v-else>Free respec anytime</span>
          </small>
        </div>
        <div class="build-head-right">
          <button
            class="bond-toggle-pill"
            :class="{ active: showBondsDrawer }"
            @click="showBondsDrawer = !showBondsDrawer"
          >
            <span>✨ {{ activeBondCount }} Bond{{ activeBondCount === 1 ? '' : 's' }}</span>
            <span>{{ showBondsDrawer ? '▴' : '▾' }}</span>
          </button>
          <button
            v-if="isForgeStop"
            class="paper-btn primary"
            @click="emit('close')"
          >
            Leave Forge →
          </button>
          <button v-else class="paper-btn icon-only" aria-label="Close" @click="emit('close')">
            <CraftIcon name="close" :size="17" />
          </button>
        </div>
      </header>

      <!-- Squad Bonds: always shown on desktop, neatly collapsible on phones -->
      <div class="bond-strip" :class="{ 'mobile-open': showBondsDrawer }">
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

      <div v-if="swapNotice" class="swap-toast" role="status">
        ✓ {{ swapNotice }}
      </div>

      <div class="build-body">
        <!-- Roster Strip: On Field heroes first, Bench clearly badged -->
        <aside class="roster-rail scroll-soft">
          <button
            v-for="hero in sortedRoster"
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
              <span
                v-if="ownerFor(hero.uid)"
                class="rb-coop"
                :style="{ background: ownerFor(hero.uid)!.color }"
              >
                {{ ownerFor(hero.uid)!.badge }}
              </span>
              <span class="rb-lvl">L{{ hero.level }}</span>
              <span v-if="!hero.harvested && hero.skillPoints > 0" class="rb-sp">
                +{{ hero.skillPoints }}
              </span>
            </div>
            <div class="rb-copy">
              <strong>{{ hero.name.split(' ')[0] }}</strong>
              <small v-if="hero.harvested" class="bag-txt">Bagged</small>
              <small v-else class="rb-role-row">
                <span class="roster-tag" :class="run.activeSquadUids.includes(hero.uid) ? 'on-field' : 'bench'">
                  {{ run.activeSquadUids.includes(hero.uid) ? 'FIELD' : 'BENCH' }}
                </span>
                <span>{{ hero.hp }}/{{ hero.maxHp }}</span>
              </small>
            </div>
          </button>
        </aside>

        <!-- Right Hero Build Sheet, 1-Tap Swap Picker, Dual-Weapon Forge & 4-Tier Skill Tree -->
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
                <small v-if="selectedHeroLoreQuote" class="hs-quote">{{ selectedHeroLoreQuote }}</small>

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
                ↺ Reset
              </button>
              <!-- 1-Tap Direct Swap when squad is full OR active hero wants to swap with bench! -->
              <button
                v-if="!selectedHero.harvested && !isSelectedActive && run.activeSquadUids.length >= 4"
                class="paper-btn gold squad-swap-btn"
                :class="{ active: swapPickerOpen }"
                @click="swapPickerOpen = !swapPickerOpen"
              >
                ⇄ {{ swapPickerOpen ? 'Cancel Swap' : 'Swap Into Squad' }}
              </button>
              <button
                v-else-if="!selectedHero.harvested && !isSelectedActive"
                class="paper-btn primary squad-swap-btn"
                @click="toggleSquadMember(selectedHero.uid)"
              >
                + Deploy to Field
              </button>
              <button
                v-else-if="!selectedHero.harvested && isSelectedActive && benchHeroes.length > 0"
                class="paper-btn gold squad-swap-btn"
                :class="{ active: swapPickerOpen }"
                @click="swapPickerOpen = !swapPickerOpen"
              >
                ⇄ {{ swapPickerOpen ? 'Cancel Swap' : 'Swap with Bench' }}
              </button>
              <button
                v-else-if="!selectedHero.harvested && isSelectedActive"
                class="paper-btn squad-swap-btn"
                :disabled="run.activeSquadUids.length <= 1"
                @click="toggleSquadMember(selectedHero.uid)"
              >
                Move to Bench
              </button>
            </div>

            <!-- Inline 1-Tap Swap Target Picker (Zero guesswork, works on 4/4 full squads!) -->
            <div v-if="swapPickerOpen && !selectedHero.harvested" class="inline-swap-picker">
              <div class="isp-head">
                <strong v-if="!isSelectedActive">
                  ⇄ Replace who on the field with {{ selectedHero.name.split(' ')[0] }}?
                </strong>
                <strong v-else>
                  ⇄ Bring who off the bench for {{ selectedHero.name.split(' ')[0] }}?
                </strong>
              </div>
              <div class="isp-grid">
                <button
                  v-for="cand in !isSelectedActive ? activeSquadHeroes : benchHeroes"
                  :key="cand.uid"
                  class="isp-card"
                  @click="
                    !isSelectedActive
                      ? performDirectSwap(cand.uid, selectedHero.uid)
                      : performDirectSwap(selectedHero.uid, cand.uid)
                  "
                >
                  <img :src="`/sprites/${cand.species}.png`" :alt="cand.name" />
                  <div class="isp-copy">
                    <strong>{{ cand.name.split(' ')[0] }}</strong>
                    <small>{{ getFamilyLabel(cand.family) }} · {{ cand.hp }}/{{ cand.maxHp }} HP</small>
                  </div>
                  <span class="isp-arrow">⇄</span>
                </button>
              </div>
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

          <!-- Playful Segmented Hub Tabs (Zero Wall-of-Text Scrolling!) -->
          <div class="hub-tabs" role="tablist">
            <button
              class="hub-tab"
              :class="{ active: activeTab === 'trees' }"
              role="tab"
              :aria-selected="activeTab === 'trees'"
              @click="activeTab = 'trees'"
            >
              <span>🌳 Skill Trees (4 Tiers)</span>
              <span v-if="selectedHero.skillPoints > 0" class="tab-badge">{{ selectedHero.skillPoints }} SP</span>
            </button>
            <button
              class="hub-tab"
              :class="{ active: activeTab === 'armory' }"
              role="tab"
              :aria-selected="activeTab === 'armory'"
              @click="activeTab = 'armory'"
            >
              <span>⚔️ Dual Weapons &amp; Forge</span>
              <span v-if="forgeVouchers > 0" class="tab-badge">🎟️{{ forgeVouchers }}</span>
            </button>
            <button
              class="hub-tab"
              :class="{ active: activeTab === 'squad' }"
              role="tab"
              :aria-selected="activeTab === 'squad'"
              @click="activeTab = 'squad'"
            >
              <span>{{ coopPlayers ? '🎮 Squad & Co-Op' : '👥 Squad Lineup' }}</span>
            </button>
          </div>

          <!-- TAB 1: Illustrated 3-Branch × 4-Tier Botanical Vine Skill Tree (12 Perks per Hero!) -->
          <template v-if="activeTab === 'trees'">
            <!-- Mobile Branch Pill Selector (crisp 1-branch view on phones, all 3 side-by-side on desktop!) -->
            <div class="mobile-branch-pills">
              <button
                v-for="(path, bIdx) in heroPaths"
                :key="path.key"
                class="mb-pill"
                :class="{ active: mobileBranchIdx === bIdx }"
                :style="{ '--path-col': path.color, '--path-bg': path.accent }"
                @click="mobileBranchIdx = bIdx"
              >
                <span>
                  {{ path.icon }}
                  {{
                    heroPaths.filter((p) => p.name.split(' ')[0] === path.name.split(' ')[0]).length > 1
                      ? path.name.split(' ').slice(-1)[0]
                      : path.name.split(' ')[0]
                  }}
                </span>
                <small>{{ unlockedCountInPath(path) }}/{{ path.perks.length }}</small>
              </button>
            </div>

            <div class="tree-paths-grid three-branch">
              <div
                v-for="(path, bIdx) in heroPaths"
                :key="path.key"
                class="path-panel"
                :class="{ 'mobile-hidden': mobileBranchIdx !== bIdx }"
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
                  <span class="pb-prog">{{ unlockedCountInPath(path) }}/{{ path.perks.length }}</span>
                </div>

                <div class="vine-tree">
                  <template v-for="(perk, idx) in path.perks" :key="perk.id">
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

                    <button
                      class="perk-node"
                      :class="[
                        perkState(perk.id),
                        { capstone: perk.tier === 4 },
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
                            <span v-if="perk.tier === 4" class="tier-tag cap">★ CAPSTONE</span>
                            <span v-else class="tier-tag">T{{ perk.tier }}</span>
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
                          Needs: {{ SKILL_PERKS[perk.requires]?.name }}
                        </small>
                      </div>
                    </button>
                  </template>
                </div>
              </div>
            </div>
          </template>

          <!-- TAB 2: Dual Weapons Loadout & Branching Weapon Forge (T1 -> Tactical II vs Elemental II -> Masterwork III) -->
          <div v-else-if="activeTab === 'armory'" class="armory-tab-wrap">
            <div v-if="selectedHeroArmory" class="dual-forge-banner">
              <div class="dfb-copy">
                <strong>⚒️ Dual-Weapon Kit &amp; Branching Forge</strong>
                <small>
                  Swap freely in battle with <kbd>W</kbd> or the Action Dock! Every weapon upgrades into ⚙️ Tactical or 🔥 Elemental Masterworks.
                </small>
              </div>
              <div class="dfb-wallet">
                <span class="paper-pill">🌱 {{ run.seeds }} Seeds</span>
                <span v-if="forgeVouchers > 0" class="paper-pill voucher-pill">🎟️ {{ forgeVouchers }} Free Forge</span>
                <span v-if="forgeDiscountMult < 1" class="paper-pill sale-pill">🔥 30% OFF</span>
              </div>
            </div>

            <!-- Dual Equipped Weapon Cutout Cards: Primary Ranged + Secondary Melee/Gimmick -->
            <div v-if="selectedHeroArmory" class="dual-weapon-grid">
              <!-- SLOT 1: PRIMARY RANGED -->
              <div
                class="dual-slot-card paper-card"
                :class="{ active: selectedHeroArmory.activeSlot === 'primary' }"
              >
                <div class="dsc-top">
                  <span class="dsc-slot-tag primary">🎯 PRIMARY RANGED</span>
                  <span class="dsc-tier-stars" :class="selectedHeroArmory.primaryWeapon.forgeBranch ?? 'stock'">
                    {{ tierStars(selectedHeroArmory.primaryWeapon.forgeTier) }}
                    <template v-if="selectedHeroArmory.primaryWeapon.forgeBranch">
                      {{ selectedHeroArmory.primaryWeapon.forgeBranch === 'tactical' ? 'TACTICAL' : 'ELEMENTAL' }}
                    </template>
                  </span>
                </div>

                <div class="dsc-hero-row">
                  <img
                    v-if="selectedHeroArmory.primaryCutout"
                    class="dsc-cutout"
                    :src="selectedHeroArmory.primaryCutout"
                    :alt="selectedHeroArmory.primaryWeapon.name"
                  />
                  <div class="dsc-info">
                    <strong>{{ selectedHeroArmory.primaryWeapon.name }}</strong>
                    <div class="dsc-chips">
                      <span>💥 {{ selectedHeroArmory.primaryWeapon.damage }} DMG</span>
                      <span>📏 R{{ selectedHeroArmory.primaryWeapon.minRange }}–{{ selectedHeroArmory.primaryWeapon.maxRange }}</span>
                      <span>{{ selectedHeroArmory.primaryWeapon.arc.toUpperCase() }}</span>
                      <span v-if="selectedHeroArmory.primaryWeapon.curvesCover" class="g-tag">↪ CURVES</span>
                      <span v-if="selectedHeroArmory.primaryWeapon.appliesStatus" class="g-tag elem">
                        +{{ selectedHeroArmory.primaryWeapon.appliesStatus.kind.toUpperCase() }}
                      </span>
                    </div>
                    <small>{{ selectedHeroArmory.primaryWeapon.description }}</small>
                  </div>
                </div>

                <button
                  class="paper-btn dsc-default-btn"
                  :class="{ primary: selectedHeroArmory.activeSlot === 'primary' }"
                  :disabled="selectedHero.harvested || selectedHeroArmory.activeSlot === 'primary'"
                  @click="handleSetDefaultSlot('primary')"
                >
                  {{ selectedHeroArmory.activeSlot === 'primary' ? '✓ Starts Battle Equipped' : 'Start Battle Holding This' }}
                </button>

                <!-- Branching Forge Upgrades for Primary -->
                <div v-if="selectedHeroArmory.primaryForgeOpts.length > 0" class="forge-options">
                  <button
                    v-for="opt in selectedHeroArmory.primaryForgeOpts"
                    :key="opt.branch"
                    class="forge-opt-btn"
                    :class="opt.branch"
                    :disabled="selectedHero.harvested || (forgeVouchers <= 0 && run.seeds < opt.cost)"
                    @click="handleForge('primary', opt.branch, opt.cost)"
                  >
                    <div class="fob-head">
                      <span>{{ opt.badge }} <strong>{{ opt.title }}</strong></span>
                      <span class="fob-cost" :class="{ free: forgeVouchers > 0 }">
                        {{ forgeVouchers > 0 ? '🎟️ FREE' : `🌱 ${opt.cost}` }}
                      </span>
                    </div>
                    <div class="fob-preview">
                      <span v-if="opt.previewWeapon.damage !== selectedHeroArmory.primaryWeapon.damage" class="fp-chip dmg">
                        💥 {{ selectedHeroArmory.primaryWeapon.damage }}→<strong>{{ opt.previewWeapon.damage }}</strong>
                      </span>
                      <span v-if="opt.previewWeapon.maxRange !== selectedHeroArmory.primaryWeapon.maxRange" class="fp-chip rng">
                        📏 R{{ selectedHeroArmory.primaryWeapon.maxRange }}→<strong>R{{ opt.previewWeapon.maxRange }}</strong>
                      </span>
                      <span v-if="opt.previewWeapon.curvesCover && !selectedHeroArmory.primaryWeapon.curvesCover" class="fp-chip">
                        ↪ CURVES
                      </span>
                      <span v-if="opt.previewWeapon.appliesStatus" class="fp-chip elem">
                        +{{ opt.previewWeapon.appliesStatus.kind.toUpperCase() }}
                      </span>
                    </div>
                    <small>{{ opt.summary }}</small>
                  </button>
                </div>
                <div v-else class="forge-maxed">★ MASTERWORK TIER III FORGED!</div>
              </div>

              <!-- SLOT 2: SECONDARY MELEE / GIMMICK (Luigi Vacuum Duster, Hammer, Boomerang, Whip, Bellows!) -->
              <div
                class="dual-slot-card paper-card secondary-card"
                :class="{ active: selectedHeroArmory.activeSlot === 'secondary' }"
              >
                <div class="dsc-top">
                  <span class="dsc-slot-tag secondary">🌀 {{ selectedHeroArmory.kit.secondaryRoleTag.toUpperCase() }}</span>
                  <span class="dsc-tier-stars" :class="selectedHeroArmory.secondaryWeapon.forgeBranch ?? 'stock'">
                    {{ tierStars(selectedHeroArmory.secondaryWeapon.forgeTier) }}
                    <template v-if="selectedHeroArmory.secondaryWeapon.forgeBranch">
                      {{ selectedHeroArmory.secondaryWeapon.forgeBranch === 'tactical' ? 'TACTICAL' : 'ELEMENTAL' }}
                    </template>
                  </span>
                </div>

                <div class="dsc-hero-row">
                  <img
                    v-if="selectedHeroArmory.secondaryCutout"
                    class="dsc-cutout"
                    :src="selectedHeroArmory.secondaryCutout"
                    :alt="selectedHeroArmory.secondaryWeapon.name"
                  />
                  <div class="dsc-info">
                    <strong>{{ selectedHeroArmory.secondaryWeapon.name }}</strong>
                    <div class="dsc-chips">
                      <span>💥 {{ selectedHeroArmory.secondaryWeapon.damage }} DMG</span>
                      <span>📏 R{{ selectedHeroArmory.secondaryWeapon.minRange }}–{{ selectedHeroArmory.secondaryWeapon.maxRange }}</span>
                      <span v-if="selectedHeroArmory.secondaryWeapon.pull" class="g-tag pull">
                        🌀 PULL {{ selectedHeroArmory.secondaryWeapon.pull }}
                      </span>
                      <span v-if="selectedHeroArmory.secondaryWeapon.cleave" class="g-tag cleave">
                        🔨 CLEAVE
                      </span>
                      <span v-if="selectedHeroArmory.secondaryWeapon.curvesCover" class="g-tag">
                        ↪ CURVES
                      </span>
                      <span v-if="selectedHeroArmory.secondaryWeapon.knockback" class="g-tag">
                        ⇄ PUSH {{ selectedHeroArmory.secondaryWeapon.knockback }}
                      </span>
                      <span v-if="selectedHeroArmory.secondaryWeapon.appliesStatus" class="g-tag elem">
                        +{{ selectedHeroArmory.secondaryWeapon.appliesStatus.kind.toUpperCase() }}
                      </span>
                    </div>
                    <small>{{ selectedHeroArmory.secondaryWeapon.description }}</small>
                  </div>
                </div>

                <button
                  class="paper-btn dsc-default-btn"
                  :class="{ primary: selectedHeroArmory.activeSlot === 'secondary' }"
                  :disabled="selectedHero.harvested || selectedHeroArmory.activeSlot === 'secondary'"
                  @click="handleSetDefaultSlot('secondary')"
                >
                  {{ selectedHeroArmory.activeSlot === 'secondary' ? '✓ Starts Battle Equipped' : 'Start Battle Holding This' }}
                </button>

                <!-- Branching Forge Upgrades for Secondary -->
                <div v-if="selectedHeroArmory.secondaryForgeOpts.length > 0" class="forge-options">
                  <button
                    v-for="opt in selectedHeroArmory.secondaryForgeOpts"
                    :key="opt.branch"
                    class="forge-opt-btn"
                    :class="opt.branch"
                    :disabled="selectedHero.harvested || (forgeVouchers <= 0 && run.seeds < opt.cost)"
                    @click="handleForge('secondary', opt.branch, opt.cost)"
                  >
                    <div class="fob-head">
                      <span>{{ opt.badge }} <strong>{{ opt.title }}</strong></span>
                      <span class="fob-cost" :class="{ free: forgeVouchers > 0 }">
                        {{ forgeVouchers > 0 ? '🎟️ FREE' : `🌱 ${opt.cost}` }}
                      </span>
                    </div>
                    <div class="fob-preview">
                      <span v-if="opt.previewWeapon.damage !== selectedHeroArmory.secondaryWeapon.damage" class="fp-chip dmg">
                        💥 {{ selectedHeroArmory.secondaryWeapon.damage }}→<strong>{{ opt.previewWeapon.damage }}</strong>
                      </span>
                      <span v-if="opt.previewWeapon.maxRange !== selectedHeroArmory.secondaryWeapon.maxRange" class="fp-chip rng">
                        📏 R{{ selectedHeroArmory.secondaryWeapon.maxRange }}→<strong>R{{ opt.previewWeapon.maxRange }}</strong>
                      </span>
                      <span v-if="(opt.previewWeapon.pull ?? 0) > (selectedHeroArmory.secondaryWeapon.pull ?? 0)" class="fp-chip">
                        🌀 PULL {{ opt.previewWeapon.pull }}
                      </span>
                      <span v-if="(opt.previewWeapon.knockback ?? 0) > (selectedHeroArmory.secondaryWeapon.knockback ?? 0)" class="fp-chip">
                        ⇄ PUSH {{ opt.previewWeapon.knockback }}
                      </span>
                      <span v-if="opt.previewWeapon.cleave && !selectedHeroArmory.secondaryWeapon.cleave" class="fp-chip">
                        🔨 CLEAVE
                      </span>
                      <span v-if="opt.previewWeapon.appliesStatus" class="fp-chip elem">
                        +{{ opt.previewWeapon.appliesStatus.kind.toUpperCase() }}
                      </span>
                    </div>
                    <small>{{ opt.summary }}</small>
                  </button>
                </div>
                <div v-else class="forge-maxed">★ MASTERWORK TIER III FORGED!</div>
              </div>
            </div>

            <!-- Optional Unlocked Alternate Primary Blueprint Swapper -->
            <div v-if="selectedHeroArmory" class="alt-armory-strip">
              <button
                class="weapon-opt compact"
                :class="{ equipped: selectedHeroArmory.equippedId === selectedHeroArmory.base.id }"
                :disabled="selectedHero.harvested"
                @click="handleEquipWeapon(selectedHeroArmory.base.id)"
              >
                <div class="wo-head">
                  <strong>🎯 Stock Primary: {{ selectedHeroArmory.base.name }}</strong>
                  <span class="wo-badge">{{ selectedHeroArmory.equippedId === selectedHeroArmory.base.id ? 'ACTIVE' : 'SWITCH' }}</span>
                </div>
              </button>
              <button
                class="weapon-opt alt compact"
                :class="{
                  equipped: selectedHeroArmory.equippedId === selectedHeroArmory.alt.id,
                  locked: !selectedHeroArmory.altUnlocked,
                }"
                :disabled="selectedHero.harvested || !selectedHeroArmory.altUnlocked"
                @click="handleEquipWeapon(selectedHeroArmory.alt.id)"
              >
                <div class="wo-head">
                  <strong>⚔️ Alt Primary: {{ selectedHeroArmory.alt.name }}</strong>
                  <span class="wo-badge">
                    {{
                      selectedHeroArmory.equippedId === selectedHeroArmory.alt.id
                        ? 'ACTIVE'
                        : selectedHeroArmory.altUnlocked
                          ? 'SWITCH'
                          : '🔒 ARMORY'
                    }}
                  </span>
                </div>
              </button>
            </div>

            <div class="skill-card-box paper-card">
              <div class="scb-head">
                <strong>✨ Signature Skill: {{ selectedHero.ability.name }}</strong>
                <span class="lvl-pill">CD {{ selectedHero.ability.cooldown }}t</span>
              </div>
              <p>{{ selectedHero.ability.description }}</p>
              <small v-if="selectedHero.coopPassive" class="coop-passive-note">
                🤝 Co-Op Passive: {{ selectedHero.coopPassive }}
              </small>
            </div>
          </div>

          <!-- TAB 3: Squad Lineup & Local Co-Op Player Ownership -->
          <div v-else class="squad-tab-wrap">
            <div v-if="coopPlayers" class="coop-assign-panel paper-card">
              <div class="cap-head">
                <strong>🎮 Couch Co-Op Hero Assignment</strong>
                <small>Tap P1–P{{ coopPlayers.length }} to assign who controls each active hero!</small>
              </div>
              <div class="cap-rows">
                <div v-for="hero in activeSquadHeroes" :key="hero.uid" class="cap-row">
                  <div class="cap-hero">
                    <img :src="`/sprites/${hero.species}.png`" :alt="hero.name" />
                    <strong>{{ hero.name }}</strong>
                  </div>
                  <div class="cap-btns">
                    <button
                      v-for="cp in coopPlayers"
                      :key="cp.idx"
                      class="cap-pill"
                      :class="{ active: ownerFor(hero.uid)?.idx === cp.idx }"
                      :style="ownerFor(hero.uid)?.idx === cp.idx ? { background: cp.color, color: '#fffdf5' } : {}"
                      @click="reassignHeroOwner(hero.uid, cp.idx)"
                    >
                      {{ cp.badge }}
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <div class="lineup-panel paper-card">
              <strong>🌾 Active Field Squad ({{ activeSquadHeroes.length }}/4)</strong>
              <div class="isp-grid">
                <div v-for="hero in activeSquadHeroes" :key="hero.uid" class="isp-card static-card">
                  <img :src="`/sprites/${hero.species}.png`" :alt="hero.name" />
                  <div class="isp-copy">
                    <strong>{{ hero.name.split(' ')[0] }}</strong>
                    <small>L{{ hero.level }} · {{ hero.hp }}/{{ hero.maxHp }} HP</small>
                  </div>
                  <span
                    v-if="ownerFor(hero.uid)"
                    class="owner-chip"
                    :style="{ background: ownerFor(hero.uid)!.color }"
                  >
                    {{ ownerFor(hero.uid)!.badge }}
                  </span>
                </div>
              </div>
              <small v-if="benchHeroes.length > 0" class="bench-hint">
                Select any Bench hero on the left and tap <strong>⇄ Swap Into Squad</strong> to bring them in!
              </small>
              <small v-else class="bench-hint">
                All recruited heroes are deployed! Unlock more allies in the Greenhouse, Vaults &amp; Carnival Barn.
              </small>
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
  width: min(1140px, 100%);
  max-height: min(92dvh, 780px);
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

.build-head-right {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.bond-toggle-pill {
  display: none;
  align-items: center;
  gap: 4px;
  padding: 5px 10px;
  border-radius: 999px;
  border: 2px solid var(--ink);
  background: linear-gradient(180deg, #ffe9a0 0%, #f5cb54 100%);
  color: #3e2600;
  font-family: 'Fredoka', sans-serif;
  font-size: 0.76rem;
  font-weight: 800;
  cursor: pointer;
  min-height: 36px;
}

.swap-toast {
  background: linear-gradient(180deg, #dff5d3 0%, #c6eba8 100%);
  border: 2px solid #2b6e24;
  color: #1c4d17;
  border-radius: 10px;
  padding: 6px 12px;
  font-family: 'Fredoka', sans-serif;
  font-size: 0.82rem;
  font-weight: 800;
  margin-bottom: 8px;
}

.rb-role-row {
  display: flex;
  align-items: center;
  gap: 4px;
}

.roster-tag {
  font-size: 0.6rem;
  font-weight: 900;
  padding: 1px 5px;
  border-radius: 999px;
  letter-spacing: 0.03em;
}

.roster-tag.on-field {
  background: #2f8a3c;
  color: #fffef4;
}

.roster-tag.bench {
  background: #e6d7b8;
  color: #5c4223;
  border: 1px solid #a88d65;
}

.inline-swap-picker {
  flex-basis: 100%;
  margin-top: 8px;
  padding: 10px;
  border-radius: 12px;
  border: 2px dashed #9e6b21;
  background: #fff7dd;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.isp-head strong {
  font-family: 'Fredoka', sans-serif;
  font-size: 0.82rem;
  color: #5c3605;
}

.isp-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 6px;
}

.isp-card {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 6px 8px;
  min-height: 46px;
  border-radius: 10px;
  border: 2px solid var(--ink);
  background: #fffdf5;
  box-shadow: 0 2px 0 rgba(74, 44, 23, 0.35);
  cursor: pointer;
  text-align: left;
  transition: transform 0.1s ease, background 0.1s ease;
}

.isp-card:hover {
  transform: translateY(-1px);
  background: #fff0b8;
}

.isp-card img {
  width: 30px;
  height: 30px;
  object-fit: contain;
  flex-shrink: 0;
}

.isp-copy {
  display: flex;
  flex-direction: column;
  min-width: 0;
  flex: 1;
}

.isp-copy strong {
  font-family: 'Fredoka', sans-serif;
  font-size: 0.78rem;
  color: var(--ink);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.isp-copy small {
  font-size: 0.66rem;
  color: var(--ink-soft);
}

.isp-arrow {
  font-size: 0.92rem;
  font-weight: 900;
  color: #9e6211;
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

.hub-tabs {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 6px;
}

.hub-tab {
  border: 2px solid var(--ink);
  border-radius: 11px;
  padding: 7px 8px;
  background: #f2e4c7;
  color: var(--ink-soft);
  font-family: 'Fredoka', sans-serif;
  font-size: 0.78rem;
  font-weight: 800;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  transition: transform 0.12s ease, background-color 0.12s ease;
}

.hub-tab.active {
  background: linear-gradient(180deg, #ffe788 0%, #f5c23b 100%);
  color: var(--ink);
  box-shadow: 0 3px 0 var(--ink);
}

.tab-badge {
  background: #d83b28;
  color: #fffef5;
  border-radius: 999px;
  padding: 1px 6px;
  font-size: 0.64rem;
}

.mobile-branch-pills {
  display: none;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 6px;
}

.mb-pill {
  border: 2px solid var(--ink);
  border-radius: 10px;
  background: #f5e8cc;
  padding: 5px 6px;
  font-family: 'Fredoka', sans-serif;
  font-size: 0.72rem;
  font-weight: 800;
  color: var(--ink);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 4px;
}

.mb-pill.active {
  background: var(--path-bg);
  border-color: var(--path-col);
  color: var(--path-col);
  box-shadow: 0 2px 0 var(--path-col);
}

.tree-paths-grid.three-branch {
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 9px;
}

.armory-tab-wrap,
.squad-tab-wrap {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.skill-card-box,
.coop-assign-panel,
.lineup-panel {
  padding: 11px 13px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.scb-head,
.cap-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
}

.skill-card-box p {
  margin: 0;
  font-size: 0.82rem;
  color: var(--ink-soft);
}

.coop-passive-note {
  color: #21662b;
  font-weight: 800;
  font-size: 0.76rem;
}

.cap-rows {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.cap-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  background: #fbf2de;
  border: 1.6px solid rgba(74, 44, 23, 0.35);
  border-radius: 10px;
  padding: 6px 9px;
}

.cap-hero {
  display: flex;
  align-items: center;
  gap: 8px;
}

.cap-hero img {
  width: 30px;
  height: 30px;
  object-fit: contain;
}

.cap-btns {
  display: flex;
  gap: 5px;
}

.cap-pill {
  border: 1.8px solid var(--ink);
  border-radius: 8px;
  background: #fffdf5;
  color: var(--ink);
  font-family: 'Fredoka', sans-serif;
  font-size: 0.74rem;
  font-weight: 900;
  padding: 4px 9px;
  cursor: pointer;
}

.owner-chip {
  color: #fffef5;
  border: 1.5px solid var(--ink);
  border-radius: 7px;
  padding: 1px 6px;
  font-size: 0.66rem;
  font-weight: 900;
}

.static-card {
  cursor: default;
}

.bench-hint {
  font-size: 0.76rem;
  color: var(--ink-soft);
}

@media (max-width: 960px) {
  .tree-paths-grid.three-branch {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 820px) {
  .build-sheet {
    padding: 12px 10px 10px;
  }

  .build-head h2 {
    font-size: 1.05rem;
  }

  .bond-toggle-pill {
    display: inline-flex;
  }

  .bond-strip {
    display: none;
  }

  .bond-strip.mobile-open {
    display: flex;
  }

  .build-body {
    grid-template-columns: 1fr;
    gap: 8px;
  }

  .roster-rail {
    flex-direction: row;
    overflow-x: auto;
    overflow-y: hidden;
    padding-bottom: 4px;
  }

  .roster-btn {
    flex: 0 0 auto;
    padding: 5px 8px;
  }

  .hero-summary {
    padding: 8px 10px;
    gap: 8px;
  }

  .hs-sprite {
    width: 44px;
    height: 44px;
  }

  .hs-actions {
    width: 100%;
    justify-content: space-between;
  }

  .squad-swap-btn {
    min-height: 40px;
  }

  .stat-ribbon {
    gap: 4px;
  }

  .stat-chip {
    font-size: 0.7rem;
    padding: 2px 7px;
  }

  .mobile-branch-pills {
    display: grid;
  }

  .path-panel.mobile-hidden {
    display: none;
  }

  .armory-bar,
  .tree-paths-grid,
  .tree-paths-grid.three-branch {
    grid-template-columns: 1fr;
  }

  .isp-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

.sp-jump-pill {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 2px 9px;
  border-radius: 999px;
  border: 1.5px solid #9d5c00;
  background: linear-gradient(180deg, #ffe98a, #f2b730);
  color: #4b2600;
  font-weight: 800;
  font-size: 0.74rem;
  cursor: pointer;
  transition: transform 0.12s ease;
}
.sp-jump-pill:hover {
  transform: translateY(-1px);
}
.rb-coop {
  position: absolute;
  top: -6px;
  left: -6px;
  padding: 0 5px;
  border-radius: 6px;
  font-size: 0.56rem;
  font-weight: 900;
  color: #fffdf7;
  border: 1.5px solid #fffdf5;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.25);
  line-height: 1.3;
}

.hs-quote {
  display: block;
  font-style: italic;
  color: #7d4e24;
  font-size: 0.72rem;
  margin-top: 2px;
}

.forge-sale-txt {
  color: #c93818;
}

.dual-forge-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
  padding: 9px 12px;
  border-radius: 12px;
  border: 2px solid var(--ink);
  background: linear-gradient(180deg, #fff9e3 0%, #f5dfb0 100%);
}

.dfb-copy {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.dfb-copy strong {
  font-size: 0.88rem;
  color: var(--ink);
}

.dfb-copy small {
  font-size: 0.74rem;
  color: var(--ink-soft);
}

.dfb-copy kbd {
  background: #4a2c17;
  color: #ffe891;
  border-radius: 4px;
  padding: 0 5px;
  font-size: 0.7rem;
  font-weight: 900;
}

.dfb-wallet {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.voucher-pill {
  background: linear-gradient(180deg, #e0f9ff, #9fe8ff);
  border-color: #166a8a;
  color: #093b4f;
}

.sale-pill {
  background: linear-gradient(180deg, #ffde96, #f59433);
  border-color: #822b08;
  color: #4f1400;
}

.dual-weapon-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.dual-slot-card {
  padding: 11px 12px;
  display: flex;
  flex-direction: column;
  gap: 9px;
  border: 2.4px solid var(--ink);
  background: linear-gradient(180deg, #fffdf5 0%, #f7ebd0 100%);
}

.dual-slot-card.secondary-card {
  background: linear-gradient(180deg, #f5fcff 0%, #e1f3fa 100%);
}

.dual-slot-card.active {
  border-color: #c97f0a;
  box-shadow: 0 4px 0 #8a5200, 0 0 12px rgba(255, 206, 74, 0.32);
}

.dsc-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}

.dsc-slot-tag {
  font-size: 0.67rem;
  font-weight: 900;
  padding: 2px 8px;
  border-radius: 999px;
  border: 1.6px solid var(--ink);
  letter-spacing: 0.03em;
}

.dsc-slot-tag.primary {
  background: #ffe89e;
  color: #5c3400;
}

.dsc-slot-tag.secondary {
  background: #9ceeff;
  color: #0b4863;
}

.dsc-tier-stars {
  font-size: 0.72rem;
  font-weight: 900;
  color: #8f5c10;
}

.dsc-tier-stars.tactical {
  color: #1b65a6;
}

.dsc-tier-stars.elemental {
  color: #c93d18;
}

.dsc-hero-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.dsc-cutout {
  width: 68px;
  height: 68px;
  object-fit: contain;
  flex: 0 0 auto;
  filter: drop-shadow(0 3px 4px rgba(45, 24, 8, 0.28));
}

.dsc-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.dsc-info strong {
  font-size: 0.94rem;
  color: var(--ink);
}

.dsc-info small {
  font-size: 0.72rem;
  color: var(--ink-soft);
  line-height: 1.25;
}

.dsc-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  font-size: 0.68rem;
  font-weight: 800;
}

.dsc-chips span {
  background: rgba(255, 252, 240, 0.9);
  border: 1.4px solid rgba(74, 44, 23, 0.4);
  border-radius: 6px;
  padding: 1px 5px;
}

.dsc-chips .g-tag {
  background: #eef8ff;
  border-color: #2c7aa8;
  color: #10496b;
}

.dsc-chips .g-tag.cleave {
  background: #fff1cc;
  border-color: #b8700b;
  color: #6b3800;
}

.dsc-chips .g-tag.elem {
  background: #ffe3d4;
  border-color: #c43f1c;
  color: #7d1b06;
}

.dsc-default-btn {
  padding: 6px 10px;
  font-size: 0.76rem;
  min-height: 36px;
}

.forge-options {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-top: 6px;
  border-top: 1.5px dashed rgba(74, 44, 23, 0.25);
}

.forge-opt-btn {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 10px;
  border-radius: 10px;
  border: 2px solid var(--ink);
  background: #fffdf5;
  text-align: left;
  cursor: pointer;
  transition: transform 0.12s ease, box-shadow 0.12s ease;
}

.forge-opt-btn.tactical {
  background: linear-gradient(180deg, #f2faff 0%, #d8efff 100%);
  border-color: #1e6296;
}

.forge-opt-btn.elemental {
  background: linear-gradient(180deg, #fff5eb 0%, #ffe0c4 100%);
  border-color: #b83d18;
}

.forge-opt-btn:hover:not(:disabled) {
  transform: translateY(-2px);
  box-shadow: 0 3px 0 rgba(59, 33, 16, 0.4);
}

.forge-opt-btn:disabled {
  opacity: 0.52;
  cursor: not-allowed;
}

.fob-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  font-size: 0.78rem;
  color: var(--ink);
}

.fob-cost {
  background: #4a2c17;
  color: #ffe891;
  font-size: 0.7rem;
  font-weight: 900;
  padding: 2px 7px;
  border-radius: 999px;
  white-space: nowrap;
}

.fob-cost.free {
  background: #1780a6;
  color: #fffdf5;
}

.fob-preview {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin: 2px 0;
}

.fp-chip {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  background: rgba(255, 253, 245, 0.92);
  border: 1.4px solid rgba(74, 44, 23, 0.4);
  border-radius: 6px;
  padding: 1px 6px;
  font-size: 0.68rem;
  font-weight: 800;
  color: var(--ink);
}

.fp-chip.dmg {
  background: #fff2cc;
  border-color: #b8700b;
  color: #5c3100;
}

.fp-chip.rng {
  background: #e6f6ff;
  border-color: #2472a6;
  color: #0e466b;
}

.fp-chip.elem {
  background: #ffe0d1;
  border-color: #bd3b1a;
  color: #781906;
}

.forge-opt-btn small {
  font-size: 0.7rem;
  color: var(--ink-soft);
}

.forge-maxed {
  text-align: center;
  font-size: 0.76rem;
  font-weight: 900;
  color: #8f5600;
  background: linear-gradient(180deg, #fff4bd, #f2c852);
  border: 1.8px solid #8f5600;
  border-radius: 8px;
  padding: 5px;
}

.alt-armory-strip {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.weapon-opt.compact {
  padding: 7px 10px;
}

@media (max-width: 820px) {
  .dual-weapon-grid,
  .alt-armory-strip {
    grid-template-columns: 1fr;
  }

  .dsc-cutout {
    width: 56px;
    height: 56px;
  }
}
</style>
