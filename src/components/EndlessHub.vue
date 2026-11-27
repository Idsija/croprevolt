<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import {
  claimEndlessBonus,
  closeEndlessBonusRoom,
  enterEndlessOption,
  gameStore,
  returnToTitle,
  toggleGuidedHints,
} from '../stores/gameStore';
import { sfx } from '../renderer/sfx';
import CraftIcon from './CraftIcon.vue';
import HeroBuildModal from './HeroBuildModal.vue';

const run = computed(() => gameStore.run!);
const endless = computed(() => run.value.endless!);
const isBonusRoom = computed(() => run.value.status === 'bonus_room' && Boolean(endless.value?.activeBonus));
const activeBonus = computed(() => endless.value?.activeBonus ?? null);
const isBossFloor = computed(() => (endless.value?.floor ?? 1) % 4 === 0);

const buildModalOpen = ref(false);
const buildModalHeroUid = ref<string | null>(null);
const wheelSpinning = ref(false);
const wheelRotation = ref(0);

const activeSquad = computed(() =>
  run.value.activeSquadUids
    .map((uid) => run.value.roster.find((h) => h.uid === uid && !h.harvested))
    .filter((h): h is NonNullable<typeof h> => Boolean(h))
);

const totalSp = computed(() =>
  run.value.roster.reduce((sum, h) => sum + (h.harvested ? 0 : h.skillPoints), 0)
);

const activePicker = computed(() => {
  const players = run.value.coopPlayers;
  if (!players || players.length <= 1) return null;
  return players[(run.value.activeBoardPickerIdx ?? 0) % players.length] ?? players[0];
});

function ownerBadgeFor(heroUid: string) {
  const players = run.value.coopPlayers;
  if (!players || players.length <= 1) return null;
  const idx = run.value.heroOwnerByUid?.[heroUid] ?? 0;
  return players[idx] ?? players[0];
}

function openHeroBuild(uid?: string): void {
  buildModalHeroUid.value = uid ?? activeSquad.value[0]?.uid ?? null;
  buildModalOpen.value = true;
}

function triggerCarnivalSpin(): void {
  if (wheelSpinning.value || activeBonus.value?.claimed) return;
  wheelSpinning.value = true;
  wheelRotation.value += 1080 + Math.floor(Math.random() * 360);
  const tickDelays = [70, 150, 240, 350, 480, 630, 810];
  tickDelays.forEach((ms, idx) => {
    setTimeout(() => sfx.wheelTick(idx), ms);
  });
  setTimeout(() => {
    claimEndlessBonus('wheel');
    const prizeIdx = run.value.endless?.activeBonus?.wheelPrizeIdx;
    if (typeof prizeIdx === 'number') {
      // Align landing wedge cleanly under the top pointer
      const baseSpins = Math.ceil(wheelRotation.value / 360) * 360;
      wheelRotation.value = baseSpins + (360 - (prizeIdx * 90 + 45));
    }
    wheelSpinning.value = false;
  }, 940);
}

function onEndlessKeyDown(e: KeyboardEvent): void {
  if (buildModalOpen.value || wheelSpinning.value) return;
  const lower = e.key.toLowerCase();
  if (lower === 's') {
    openHeroBuild();
    return;
  }
  if (isBonusRoom.value && activeBonus.value) {
    if (activeBonus.value.claimed) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        closeEndlessBonusRoom();
      }
      return;
    }
    if (activeBonus.value.kind === 'carnival') {
      if (e.key === '1') triggerCarnivalSpin();
      else if (e.key === '2') claimEndlessBonus('recruit');
    } else if (activeBonus.value.kind === 'tinkerer') {
      if (e.key === '1') claimEndlessBonus('weapon');
      else if (e.key === '2') claimEndlessBonus('sp');
      else if (e.key === '3') claimEndlessBonus('satchel');
    } else {
      if (e.key === '1') claimEndlessBonus('soak');
      else if (e.key === '2') claimEndlessBonus('vigor');
      else if (e.key === '3') claimEndlessBonus('swift');
    }
    return;
  }
  if (e.key === '1' || e.key === '2') {
    const opt = endless.value.nextOptions[Number(e.key) - 1];
    if (opt) enterEndlessOption(opt.id);
  }
}

onMounted(() => window.addEventListener('keydown', onEndlessKeyDown));
onBeforeUnmount(() => window.removeEventListener('keydown', onEndlessKeyDown));
</script>

<template>
  <div class="endless-stage">
    <!-- Top Storybook Status Header -->
    <header class="endless-topbar">
      <div class="et-left">
        <button class="paper-btn icon-btn" title="Save & Title Menu" @click="returnToTitle">
          🏠
        </button>
        <div class="floor-crest" :class="{ boss: isBossFloor }">
          <span class="fc-kicker">♾️ ENDLESS HARVEST</span>
          <strong>
            Floor {{ endless.floor }}
            <span v-if="isBossFloor" class="boss-pip">👑 BOSS</span>
          </strong>
        </div>
        <span class="paper-pill best-pill">
          🏆 Best: Fl.{{ Math.max(gameStore.meta.bestEndlessFloor ?? 0, Math.max(0, endless.floor - 1)) }}
        </span>
      </div>

      <div class="et-right">
        <span
          v-if="activePicker"
          class="coop-turn-pill"
          :style="{ background: activePicker.color }"
        >
          {{ activePicker.badge }}'s Pick!
        </span>
        <span class="paper-pill seed-pill">
          <CraftIcon name="seed" :size="14" /> {{ run.seeds }}
        </span>
        <button class="paper-btn gold squad-btn" @click="openHeroBuild()">
          <span>🌳 Squad &amp; Trees</span>
          <span v-if="totalSp > 0" class="sp-dot">{{ totalSp }}</span>
        </button>
      </div>
    </header>

    <!-- Guided Playful Onboarding Tip (Toggleable!) -->
    <div v-if="gameStore.meta.guidedHintsEnabled ?? true" class="guide-banner">
      <span class="gb-icon">{{ isBonusRoom ? '🎉' : isBossFloor ? '👑' : '🧭' }}</span>
      <p>
        <template v-if="isBonusRoom">
          <strong>Bonus Room Pit-Stop!</strong> Claim one free reward below before diving into Floor {{ endless.floor }}'s battle.
        </template>
        <template v-else-if="isBossFloor">
          <strong>Boss Floor {{ endless.floor }}!</strong> Every 4th floor brings a Boss Showdown (and bonus Heirloom Seeds for unlocking new heroes!).
        </template>
        <template v-else>
          <strong>Pick your next stage door!</strong> Each floor rolls fresh grid dimensions, towering heights (up to 3 stories), Arena Modifiers &amp; Bonus Rooms in-between.
        </template>
      </p>
      <button class="gb-hide" title="Hide Guided Tips" @click="toggleGuidedHints">Hide Tips</button>
    </div>

    <!-- MAIN CONTENT: INTERACTIVE BONUS ROOM OR FLOOR FORK DOORS -->
    <main class="endless-main scroll-soft">
      <!-- A. Interactive Bonus Room View -->
      <section v-if="isBonusRoom && activeBonus" class="corrugated-slab bonus-stage pinned-card">
        <div class="washi-tape"></div>
        <div class="bonus-head">
          <span class="bonus-emoji">
            {{ activeBonus.kind === 'carnival' ? '🎪' : activeBonus.kind === 'tinkerer' ? '🛠️' : '💧' }}
          </span>
          <div>
            <h2>{{ activeBonus.title }}</h2>
            <p v-if="activeBonus.kind === 'carnival'">
              Step right up! Spin the Harvest Prize Wheel or recruit a fresh goofy ally into your Greenhouse!
            </p>
            <p v-else-if="activeBonus.kind === 'tinkerer'">
              Warm lanterns and rattling wrenches! Choose one free workshop upgrade before your next fight.
            </p>
            <p v-else>
              Steaming mineral springs in the clover hills! Rest up, rescue bagged friends, or soak for a permanent boost.
            </p>
          </div>
        </div>

        <!-- Result Stamp Banner once claimed -->
        <div v-if="activeBonus.claimed" class="bonus-result-box">
          <strong>{{ activeBonus.wheelResult }}</strong>
          <button class="paper-btn primary diecut continue-btn" @click="closeEndlessBonusRoom">
            Continue to Floor {{ endless.floor }} Battles →
          </button>
        </div>

        <!-- Carnival Barn Interactive Choices -->
        <div v-else-if="activeBonus.kind === 'carnival'" class="bonus-choices two-col">
          <button
            class="bonus-card carnival-wheel-card"
            :class="{ spinning: wheelSpinning }"
            @click="triggerCarnivalSpin"
          >
            <div class="carnival-spinner-wrap" aria-hidden="true">
              <span class="wheel-pointer">▼</span>
              <svg
                class="prize-wheel-svg"
                viewBox="0 0 100 100"
                :style="{ transform: `rotate(${wheelRotation}deg)` }"
              >
                <path d="M50,50 L50,4 A46,46 0 0,1 96,50 Z" fill="#f7c948" stroke="#4a2e14" stroke-width="2.5" />
                <path d="M50,50 L96,50 A46,46 0 0,1 50,96 Z" fill="#82c96e" stroke="#4a2e14" stroke-width="2.5" />
                <path d="M50,50 L50,96 A46,46 0 0,1 4,50 Z" fill="#6ab5e8" stroke="#4a2e14" stroke-width="2.5" />
                <path d="M50,50 L4,50 A46,46 0 0,1 50,4 Z" fill="#eb7363" stroke="#4a2e14" stroke-width="2.5" />
                <text x="69" y="34" font-size="14" text-anchor="middle">🌱</text>
                <text x="69" y="72" font-size="14" text-anchor="middle">✨</text>
                <text x="31" y="72" font-size="14" text-anchor="middle">🌳</text>
                <text x="31" y="34" font-size="14" text-anchor="middle">🍖</text>
                <circle cx="50" cy="50" r="10" fill="#fff6da" stroke="#4a2e14" stroke-width="2.5" />
              </svg>
            </div>
            <strong>Spin the Harvest Prize Wheel!</strong>
            <small>Win +22 Seeds, a Free Relic, +1 SP for ALL Heroes, or a Full Feast &amp; Bombs!</small>
            <span class="card-cta gold">
              {{ wheelSpinning ? 'Spinning...' : 'Spin Wheel!' }}
            </span>
          </button>

          <button class="bonus-card recruit-card" @click="claimEndlessBonus('recruit')">
            <div class="wheel-badge">🌱</div>
            <strong>Mystery Greenhouse Draft!</strong>
            <small>Recruit a new goofy hero right into your run AND permanently unlock them in your Greenhouse!</small>
            <span class="card-cta primary">Draft New Hero</span>
          </button>
        </div>

        <!-- Tinkerer's Shed Interactive Choices -->
        <div v-else-if="activeBonus.kind === 'tinkerer'" class="bonus-choices three-col">
          <button class="bonus-card" @click="claimEndlessBonus('weapon')">
            <div class="wheel-badge">⚔️</div>
            <strong>Forge Alt Weapon</strong>
            <small>Unlock a brand-new Armory weapon for your squad + 8 Run Seeds!</small>
            <span class="card-cta gold">Forge Weapon</span>
          </button>
          <button class="bonus-card" @click="claimEndlessBonus('sp')">
            <div class="wheel-badge">🌳</div>
            <strong>Skill Tree Workshop</strong>
            <small>Every living hero immediately gains +1 Skill Point to deepen their 3-branch tree!</small>
            <span class="card-cta primary">+1 SP to All</span>
          </button>
          <button class="bonus-card" @click="claimEndlessBonus('satchel')">
            <div class="wheel-badge">🎒</div>
            <strong>Tactical Satchel Crate</strong>
            <small>Pack +2 Fertilizer Bombs, +1 Honey Pot, and +1 Acorn Smoke Bomb!</small>
            <span class="card-cta sky">Stock Satchel</span>
          </button>
        </div>

        <!-- Hot Spring Meadow Interactive Choices -->
        <div v-else class="bonus-choices three-col">
          <button class="bonus-card" @click="claimEndlessBonus('soak')">
            <div class="wheel-badge">♨️</div>
            <strong>Full Healing Soak</strong>
            <small>Restore 100% HP to everyone AND revive all bagged/harvested heroes!</small>
            <span class="card-cta primary">Full Heal &amp; Revive</span>
          </button>
          <button class="bonus-card" @click="claimEndlessBonus('vigor')">
            <div class="wheel-badge">💪</div>
            <strong>Mineral Vigor Bath</strong>
            <small>Every living hero gains +2 Permanent Max HP and heals +4 HP right now!</small>
            <span class="card-cta gold">+2 Max HP All</span>
          </button>
          <button class="bonus-card" @click="claimEndlessBonus('swift')">
            <div class="wheel-badge">✨</div>
            <strong>Hot Spring Blessing</strong>
            <small>Begin the next floor Boosted (+2 ATK), Shielded, and +1 Move!</small>
            <span class="card-cta sky">Bless Next Fight</span>
          </button>
        </div>
      </section>

      <!-- B. Floor Door Fork View -->
      <section v-else class="doors-wrap">
        <div class="doors-heading">
          <h2>
            {{
              isBossFloor
                ? `👑 Floor ${endless.floor} Boss Gate`
                : `Choose Floor ${endless.floor}'s Path`
            }}
          </h2>
          <small>
            {{
              endless.floor % 4 === 0
                ? 'Topple the Boss to earn Heirloom Seeds & ascend deeper!'
                : `${4 - (endless.floor % 4)} floor${4 - (endless.floor % 4) === 1 ? '' : 's'} until next Boss Battle`
            }}
          </small>
        </div>

        <div class="doors-grid">
          <button
            v-for="opt in endless.nextOptions"
            :key="opt.id"
            class="door-card corrugated-slab"
            :class="[opt.kind, `theme-${opt.theme}`]"
            @click="enterEndlessOption(opt.id)"
          >
            <div class="door-ribbon">
              <span>
                {{
                  opt.kind === 'bonus'
                    ? '🎉 BONUS ROOM'
                    : opt.kind === 'boss'
                      ? '👑 BOSS SHOWDOWN'
                      : `🗺️ ${opt.theme.toUpperCase()} ARENA`
                }}
              </span>
              <span v-if="opt.gridSize" class="grid-chip">{{ opt.gridSize }} Grid</span>
            </div>

            <div class="door-icon-bubble">{{ opt.icon }}</div>

            <h3>{{ opt.title }}</h3>
            <p class="door-sub">{{ opt.subtitle }}</p>

            <div class="door-tags">
              <span v-if="opt.modifierLabel" class="d-tag">{{ opt.modifierLabel }}</span>
              <span v-if="opt.arenaModifierLabel" class="d-tag mod-tag">{{ opt.arenaModifierLabel }}</span>
              <span v-if="opt.seedBounty" class="d-tag seed-bounty-tag">🌱 ~{{ opt.seedBounty }} Seeds</span>
              <span v-if="opt.kind === 'boss'" class="d-tag boss-tag">Heirloom Seeds + Relic</span>
              <span v-else-if="opt.kind === 'bonus'" class="d-tag bonus-tag">No Combat · Free Reward</span>
            </div>

            <div v-if="opt.enemyPreviewKinds && opt.enemyPreviewKinds.length > 0" class="door-foe-preview">
              <small>Spotted:</small>
              <img
                v-for="ek in opt.enemyPreviewKinds"
                :key="ek"
                :src="`/sprites/${ek}.png`"
                :alt="ek"
                class="foe-mini"
              />
            </div>

            <span class="paper-btn diecut door-go" :class="opt.kind === 'boss' ? 'danger' : opt.kind === 'bonus' ? 'gold' : 'primary'">
              {{ opt.kind === 'bonus' ? 'Visit Bonus Room →' : opt.kind === 'boss' ? 'Challenge Boss →' : 'Deploy Squad →' }}
            </span>
          </button>
        </div>
      </section>
    </main>

    <!-- Bottom Active Squad Quick-Dock -->
    <footer class="squad-dock">
      <div class="sd-inner">
        <button
          v-for="hero in activeSquad"
          :key="hero.uid"
          class="sd-hero"
          @click="openHeroBuild(hero.uid)"
        >
          <span
            v-if="ownerBadgeFor(hero.uid)"
            class="sd-coop"
            :style="{ background: ownerBadgeFor(hero.uid)!.color }"
          >
            {{ ownerBadgeFor(hero.uid)!.badge }}
          </span>
          <img :src="`/sprites/${hero.species}.png`" :alt="hero.name" />
          <div class="sd-copy">
            <strong>{{ hero.name.split(' ')[0] }}</strong>
            <div class="sd-hp">
              <span class="sd-hp-fill" :style="{ width: `${Math.round((hero.hp / Math.max(1, hero.maxHp)) * 100)}%` }"></span>
            </div>
            <small>L{{ hero.level }} · {{ hero.hp }}/{{ hero.maxHp }}</small>
          </div>
          <span v-if="hero.skillPoints > 0" class="sd-sp">+{{ hero.skillPoints }}</span>
        </button>
      </div>
    </footer>

    <HeroBuildModal
      v-if="buildModalOpen"
      :initial-hero-uid="buildModalHeroUid"
      @close="buildModalOpen = false"
    />
  </div>
</template>

<style scoped>
.endless-stage {
  width: 100%;
  height: 100dvh;
  display: flex;
  flex-direction: column;
  background:
    radial-gradient(circle at 18% 12%, rgba(255, 226, 148, 0.25), transparent 45%),
    radial-gradient(circle at 82% 85%, rgba(124, 198, 92, 0.22), transparent 45%),
    linear-gradient(180deg, #57361c 0%, #3d220e 100%);
  padding: calc(10px + var(--safe-top)) calc(12px + var(--safe-right))
    calc(10px + var(--safe-bottom)) calc(12px + var(--safe-left));
  gap: 10px;
  overflow: hidden;
}

.endless-topbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.et-left,
.et-right {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.icon-btn {
  min-width: 40px;
  min-height: 40px;
  padding: 6px 10px;
  font-size: 1rem;
}

.floor-crest {
  background: linear-gradient(180deg, #fff6df 0%, #f1dfb5 100%);
  border: 2.2px solid var(--ink);
  border-radius: 12px;
  padding: 4px 12px;
  display: flex;
  flex-direction: column;
  line-height: 1.1;
  box-shadow: 0 3px 0 rgba(28, 12, 3, 0.45);
}

.floor-crest.boss {
  background: linear-gradient(180deg, #ffe2ad 0%, #f2a154 100%);
}

.fc-kicker {
  font-size: 0.6rem;
  font-weight: 900;
  letter-spacing: 0.06em;
  color: #7d4512;
}

.floor-crest strong {
  font-family: 'Fredoka', sans-serif;
  font-size: 1rem;
  color: var(--ink);
  display: flex;
  align-items: center;
  gap: 6px;
}

.boss-pip {
  background: #a82020;
  color: #fff8d6;
  font-size: 0.64rem;
  padding: 1px 6px;
  border-radius: 999px;
}

.best-pill {
  background: #fde89b;
  font-size: 0.78rem;
  padding: 5px 10px;
}

.seed-pill {
  background: #fff5d4;
  font-size: 0.82rem;
  padding: 5px 10px;
}

.coop-turn-pill {
  color: #fffdf5;
  border: 2px solid #fff8e2;
  border-radius: 999px;
  padding: 4px 11px;
  font-family: 'Fredoka', sans-serif;
  font-size: 0.78rem;
  font-weight: 800;
  box-shadow: 0 2px 0 rgba(0, 0, 0, 0.35);
}

.squad-btn {
  position: relative;
  min-height: 40px;
  padding: 6px 12px;
  font-size: 0.82rem;
}

.sp-dot {
  background: #d83b28;
  color: #fff;
  border: 1.5px solid #fff8e2;
  border-radius: 999px;
  font-size: 0.68rem;
  padding: 0 5px;
  margin-left: 4px;
}

.guide-banner {
  max-width: 880px;
  width: 100%;
  margin: 0 auto;
  background: rgba(255, 249, 232, 0.94);
  border: 2px solid var(--ink);
  border-radius: 12px;
  padding: 7px 11px;
  display: flex;
  align-items: center;
  gap: 9px;
  box-shadow: 0 3px 0 rgba(28, 12, 3, 0.32);
}

.gb-icon {
  font-size: 1.25rem;
  flex-shrink: 0;
}

.guide-banner p {
  margin: 0;
  flex: 1;
  font-size: 0.8rem;
  color: var(--ink);
  line-height: 1.28;
}

.gb-hide {
  border: 1.5px solid rgba(74, 44, 23, 0.4);
  background: #f2e4c2;
  color: var(--ink-soft);
  border-radius: 8px;
  padding: 4px 8px;
  font-size: 0.7rem;
  font-weight: 800;
  cursor: pointer;
  flex-shrink: 0;
}

.endless-main {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: safe center;
  padding: 4px 2px 8px;
}

.doors-wrap {
  width: min(880px, 100%);
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.doors-heading {
  text-align: center;
  color: #fff6df;
}

.doors-heading h2 {
  margin: 0;
  font-family: 'Fredoka', sans-serif;
  font-size: 1.4rem;
  text-shadow: 0 2px 0 #3a1d08;
}

.doors-heading small {
  color: #f3d9a4;
  font-size: 0.84rem;
  font-weight: 700;
}

.doors-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}

.door-card {
  padding: 16px 16px 15px;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 9px;
  cursor: pointer;
  transition: transform 0.14s ease, box-shadow 0.14s ease;
  background: linear-gradient(180deg, #fff9ea 0%, #f4e4c2 100%);
}

.door-card:hover {
  transform: translateY(-4px);
}

.door-card.boss {
  background: linear-gradient(180deg, #fff0cf 0%, #f5c998 100%);
  border-color: #8f1d14;
}

.door-card.bonus {
  background: linear-gradient(180deg, #fff8d6 0%, #f7e49e 100%);
  border-color: #a86b00;
}

.door-ribbon {
  width: 100%;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 6px;
  font-size: 0.68rem;
  font-weight: 900;
  letter-spacing: 0.04em;
  color: #7c4814;
}

.grid-chip {
  background: #4a2c17;
  color: #ffe899;
  border-radius: 999px;
  padding: 2px 8px;
  font-size: 0.66rem;
}

.door-icon-bubble {
  width: 64px;
  height: 64px;
  border-radius: 50%;
  border: 2.5px solid var(--ink);
  background: #fffdf5;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 2rem;
  box-shadow: 0 4px 0 rgba(74, 44, 23, 0.28);
}

.door-card h3 {
  margin: 0;
  font-family: 'Fredoka', sans-serif;
  font-size: 1.15rem;
  color: var(--ink);
}

.door-sub {
  margin: 0;
  font-size: 0.8rem;
  color: var(--ink-soft);
  line-height: 1.32;
}

.door-tags {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 6px;
}

.d-tag {
  background: rgba(255, 252, 240, 0.92);
  border: 1.5px solid rgba(74, 44, 23, 0.45);
  border-radius: 999px;
  padding: 2px 9px;
  font-size: 0.7rem;
  font-weight: 800;
  color: var(--ink);
}

.d-tag.boss-tag {
  background: #ffe0d6;
  border-color: #a62519;
  color: #7c180f;
}

.d-tag.bonus-tag {
  background: #e1f7d5;
  border-color: #367d22;
  color: #1f5412;
}

.door-go {
  margin-top: auto;
  width: 100%;
  min-height: 44px;
  font-size: 0.92rem;
}

/* Bonus Room Panel */
.bonus-stage {
  width: min(860px, 100%);
  padding: 20px 18px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.bonus-head {
  display: flex;
  align-items: center;
  gap: 12px;
}

.bonus-emoji {
  font-size: 2.6rem;
  line-height: 1;
}

.bonus-head h2 {
  margin: 0;
  font-family: 'Fredoka', sans-serif;
  font-size: 1.35rem;
  color: var(--ink);
}

.bonus-head p {
  margin: 2px 0 0;
  font-size: 0.84rem;
  color: var(--ink-soft);
}

.bonus-choices {
  display: grid;
  gap: 12px;
}

.bonus-choices.two-col {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.bonus-choices.three-col {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.bonus-card {
  border: 2.2px solid var(--ink);
  border-radius: 15px;
  background: linear-gradient(180deg, #fffdf4 0%, #f5e6c5 100%);
  padding: 14px 12px;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 7px;
  cursor: pointer;
  box-shadow: 0 4px 0 rgba(74, 44, 23, 0.35);
  transition: transform 0.14s ease;
}

.bonus-card:hover {
  transform: translateY(-3px);
  background: #fff8de;
}

.wheel-badge {
  font-size: 2.3rem;
  line-height: 1;
}

.wheel-badge.spin {
  animation: wheelSpin 0.55s cubic-bezier(0.2, 0.9, 0.3, 1);
}

@keyframes wheelSpin {
  0% { transform: rotate(0deg) scale(1); }
  50% { transform: rotate(380deg) scale(1.18); }
  100% { transform: rotate(720deg) scale(1); }
}

.bonus-card strong {
  font-family: 'Fredoka', sans-serif;
  font-size: 0.98rem;
  color: var(--ink);
}

.bonus-card small {
  font-size: 0.76rem;
  color: var(--ink-soft);
  line-height: 1.3;
  flex: 1;
}

.card-cta {
  width: 100%;
  border: 2px solid var(--ink);
  border-radius: 10px;
  padding: 7px 10px;
  font-family: 'Fredoka', sans-serif;
  font-size: 0.84rem;
  font-weight: 800;
}

.card-cta.primary {
  background: #67ba45;
  color: #fffef5;
}

.card-cta.gold {
  background: #f5c94c;
  color: #3f2204;
}

.card-cta.sky {
  background: #4ab2de;
  color: #fffef5;
}

.bonus-result-box {
  background: linear-gradient(180deg, #e7f9dc 0%, #cdeeb9 100%);
  border: 2.2px solid #2b6e24;
  border-radius: 14px;
  padding: 16px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  text-align: center;
}

.bonus-result-box strong {
  font-family: 'Fredoka', sans-serif;
  font-size: 1.08rem;
  color: #194d14;
}

.continue-btn {
  min-height: 46px;
  padding-inline: 22px;
}

/* Bottom Squad Dock */
.squad-dock {
  width: 100%;
  display: flex;
  justify-content: center;
}

.sd-inner {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  max-width: 100%;
  padding: 2px;
}

.sd-hero {
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;
  background: rgba(252, 243, 222, 0.96);
  border: 2px solid var(--ink);
  border-radius: 12px;
  padding: 5px 10px 5px 7px;
  cursor: pointer;
  flex-shrink: 0;
  min-width: 122px;
  box-shadow: 0 3px 0 rgba(28, 12, 3, 0.4);
}

.sd-hero img {
  width: 34px;
  height: 34px;
  object-fit: contain;
}

.sd-copy {
  display: flex;
  flex-direction: column;
  text-align: left;
  gap: 2px;
  flex: 1;
}

.sd-copy strong {
  font-family: 'Fredoka', sans-serif;
  font-size: 0.78rem;
  color: var(--ink);
  line-height: 1;
}

.sd-hp {
  width: 58px;
  height: 5px;
  background: #d8c6a2;
  border-radius: 999px;
  overflow: hidden;
  border: 1px solid var(--ink);
}

.sd-hp-fill {
  display: block;
  height: 100%;
  background: #5cb844;
}

.sd-copy small {
  font-size: 0.65rem;
  color: var(--ink-soft);
  font-weight: 700;
}

.sd-coop {
  position: absolute;
  top: -6px;
  left: -5px;
  color: #fffef5;
  border: 1.5px solid #fff8e2;
  border-radius: 6px;
  padding: 0 5px;
  font-size: 0.6rem;
  font-weight: 900;
}

.sd-sp {
  position: absolute;
  top: -6px;
  right: -5px;
  background: #e89b14;
  color: #fffef5;
  border: 1.5px solid var(--ink);
  border-radius: 999px;
  padding: 0 5px;
  font-size: 0.64rem;
  font-weight: 900;
}

@media (max-width: 720px) {
  .doors-grid,
  .bonus-choices.two-col,
  .bonus-choices.three-col {
    grid-template-columns: 1fr;
  }
  .door-card {
    padding: 13px 13px 12px;
  }
  .door-icon-bubble {
    width: 50px;
    height: 50px;
    font-size: 1.55rem;
  }
}

.carnival-spinner-wrap {
  position: relative;
  width: 82px;
  height: 82px;
  display: grid;
  place-items: center;
}
.wheel-pointer {
  position: absolute;
  top: -8px;
  left: 50%;
  transform: translateX(-50%);
  font-size: 0.9rem;
  color: #d93829;
  text-shadow: 0 1px 0 #fff7db;
  z-index: 2;
}
.prize-wheel-svg {
  width: 78px;
  height: 78px;
  transition: transform 0.92s cubic-bezier(0.16, 0.85, 0.25, 1);
  filter: drop-shadow(0 3px 4px rgba(58, 32, 12, 0.28));
}
.d-tag.mod-tag {
  background: #fff2c2;
  border-color: #b87e14;
  color: #5a3700;
}
.d-tag.seed-bounty-tag {
  background: #dff5cf;
  border-color: #4b8a32;
  color: #214e13;
}
.door-foe-preview {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: 12px;
  background: rgba(255, 250, 236, 0.82);
  border: 1.5px dashed #b79568;
}
.door-foe-preview small {
  font-size: 0.68rem;
  font-weight: 800;
  color: #6b4b2a;
}
.foe-mini {
  width: 30px;
  height: 30px;
  object-fit: contain;
  filter: drop-shadow(0 2px 2px rgba(42, 20, 6, 0.22));
}
</style>
