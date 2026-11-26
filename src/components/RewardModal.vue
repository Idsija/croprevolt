<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { GRAFT_REGISTRY } from '../data/grafts';
import { ITEM_REGISTRY } from '../data/items';
import { PRODUCE_BLUEPRINTS } from '../data/produce';
import { RELIC_REGISTRY } from '../data/relics';
import { getFamilyLabel } from '../engine/hooks';
import { MAX_GRAFTS_PER_HERO } from '../engine/run';
import {
  closeRewardsToMap,
  gameStore,
  graftHero,
  pickRecruit,
  pickRelic,
} from '../stores/gameStore';
import CraftIcon from './CraftIcon.vue';

const run = computed(() => gameStore.run!);
const reward = computed(() => run.value.pendingReward!);
const selectedGraftId = ref<string | null>(null);
const targetHeroBoxRef = ref<HTMLElement | null>(null);
const confirmSkipUnclaimed = ref(false);

const healthyRoster = computed(() => run.value.roster.filter((h) => !h.harvested));

const unclaimedCount = computed(() => {
  let left = 0;
  if (reward.value.recruitChoices.length > 0 && !reward.value.claimedRecruit) left += 1;
  if (reward.value.graftChoices.length > 0 && !reward.value.claimedGraft) left += 1;
  if (reward.value.relicChoices.length > 0 && !reward.value.claimedRelic) left += 1;
  return left;
});

watch(selectedGraftId, async (val) => {
  confirmSkipUnclaimed.value = false;
  if (val) {
    await nextTick();
    targetHeroBoxRef.value?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
});

watch(unclaimedCount, () => {
  confirmSkipUnclaimed.value = false;
});

function chooseGraftTarget(heroUid: string): void {
  if (!selectedGraftId.value) return;
  const ok = graftHero(heroUid, selectedGraftId.value);
  if (ok) {
    selectedGraftId.value = null;
  }
}

function handleContinue(): void {
  if (unclaimedCount.value > 0 && !confirmSkipUnclaimed.value) {
    confirmSkipUnclaimed.value = true;
    return;
  }
  closeRewardsToMap();
}

function nextTierLabel(graftCount: number): string {
  if (graftCount === 0) return 'Promotes → RIPE (+2 HP, +1 ATK)';
  if (graftCount === 1) return 'Promotes → HEIRLOOM (+3 HP, +1 ATK, +1 Move)';
  return `Max ${MAX_GRAFTS_PER_HERO}/${MAX_GRAFTS_PER_HERO} Grafts (Heirloom)`;
}
</script>

<template>
  <div class="reward-page">
    <div class="corrugated-slab reward-shell pinned-card">
      <div class="washi-tape"></div>
      <span class="brass-pin tl"></span>
      <span class="brass-pin tr"></span>

      <!-- Fixed Top Header -->
      <header class="reward-head">
        <div>
          <h2>
            {{ run.status === 'vault' ? 'Seed Vault & Compost' : 'Harvest Spoils & Grafting' }}
          </h2>
          <div class="spoils-strip">
            <span class="paper-pill seed-pill">
              <CraftIcon name="seed" :size="14" /> +{{ reward.seedsEarned }} Seeds
            </span>
            <span v-if="reward.itemGrant" class="paper-pill">
              {{ ITEM_REGISTRY[reward.itemGrant.itemId]?.icon }}
              +1 {{ ITEM_REGISTRY[reward.itemGrant.itemId]?.name }}
            </span>
            <span v-if="reward.freeHealAmount" class="paper-pill heal-pill">
              <CraftIcon name="heart" :size="14" /> Squad +{{ reward.freeHealAmount }} HP
            </span>
          </div>
        </div>
      </header>

      <!-- Scrollable Seed Packet Body -->
      <div class="reward-body scroll-soft">
        <!-- 1. Recruit a Produce or Barnyard Ally -->
        <section v-if="reward.recruitChoices.length > 0 && !reward.claimedRecruit" class="reward-sec">
          <h3>Recruit a Produce or Barnyard Hero</h3>
          <div class="choice-grid">
            <div
              v-for="bpId in reward.recruitChoices"
              :key="bpId"
              class="seed-packet choice-card"
            >
              <div class="choice-top">
                <div class="recruit-id">
                  <img
                    class="recruit-thumb"
                    :src="`/sprites/${PRODUCE_BLUEPRINTS[bpId].species}.png`"
                    :alt="PRODUCE_BLUEPRINTS[bpId].name"
                  />
                  <div>
                    <strong>{{ PRODUCE_BLUEPRINTS[bpId].name }}</strong>
                    <small class="sub-role">
                      {{ PRODUCE_BLUEPRINTS[bpId].title }} · {{ getFamilyLabel(PRODUCE_BLUEPRINTS[bpId].family) }}
                    </small>
                  </div>
                </div>
                <span v-if="PRODUCE_BLUEPRINTS[bpId].isAnimal" class="paper-pill animal-pill">Barnyard</span>
              </div>
              <p>{{ PRODUCE_BLUEPRINTS[bpId].blurb }}</p>
              <small v-if="PRODUCE_BLUEPRINTS[bpId].coopPassive" class="coop-note">
                ★ {{ PRODUCE_BLUEPRINTS[bpId].coopPassive }}
              </small>
              <small class="stat-line">
                HP {{ PRODUCE_BLUEPRINTS[bpId].maxHp }} · Mv {{ PRODUCE_BLUEPRINTS[bpId].moveRange }} · Dash {{ PRODUCE_BLUEPRINTS[bpId].dashDamage }} · {{ PRODUCE_BLUEPRINTS[bpId].weapon.name }} ({{ PRODUCE_BLUEPRINTS[bpId].weapon.damage }} dmg, R{{ PRODUCE_BLUEPRINTS[bpId].weapon.minRange }}-{{ PRODUCE_BLUEPRINTS[bpId].weapon.maxRange }})
              </small>
              <small class="stat-line">
                <strong>{{ PRODUCE_BLUEPRINTS[bpId].ability.name }}:</strong> {{ PRODUCE_BLUEPRINTS[bpId].ability.description }}
              </small>
              <button class="paper-btn primary" @click="pickRecruit(bpId)">
                Recruit {{ PRODUCE_BLUEPRINTS[bpId].name }}
              </button>
            </div>
          </div>
        </section>
        <div v-else-if="reward.recruitChoices.length > 0" class="claimed-banner">
          <CraftIcon name="check" :size="16" /> New Revolt Hero joined your roster (swap on Squad tab)!
        </div>

        <!-- 2. Graft Sticker Draft -->
        <section v-if="reward.graftChoices.length > 0 && !reward.claimedGraft" class="reward-sec">
          <h3>
            {{ selectedGraftId ? 'Step 2: Tap a Hero to Attach Graft!' : 'Pick a Graft Mutation Sticker' }}
          </h3>
          <div class="choice-grid">
            <button
              v-for="gid in reward.graftChoices"
              :key="gid"
              class="seed-packet choice-card selectable"
              :class="{ picked: selectedGraftId === gid }"
              @click="selectedGraftId = gid"
            >
              <div class="choice-top">
                <strong>{{ GRAFT_REGISTRY[gid].badgeIcon }} {{ GRAFT_REGISTRY[gid].name }}</strong>
                <span v-if="selectedGraftId === gid" class="paper-pill picked-pill">Selected</span>
              </div>
              <p>{{ GRAFT_REGISTRY[gid].description }}</p>
            </button>
          </div>

          <div v-if="selectedGraftId" ref="targetHeroBoxRef" class="target-hero-box">
            <strong>Attach {{ GRAFT_REGISTRY[selectedGraftId].badgeIcon }} {{ GRAFT_REGISTRY[selectedGraftId].name }} to:</strong>
            <div class="hero-targets">
              <button
                v-for="h in healthyRoster"
                :key="h.uid"
                class="paper-btn gold hero-graft-btn"
                :disabled="h.graftIds.includes(selectedGraftId) || h.graftIds.length >= MAX_GRAFTS_PER_HERO"
                @click="chooseGraftTarget(h.uid)"
              >
                <img class="mini-spr" :src="`/sprites/${h.species}.png`" :alt="h.name" />
                <div class="hg-copy">
                  <span>
                    {{ h.name }}
                    <em class="squad-tag">{{ run.activeSquadUids.includes(h.uid) ? 'Active' : 'Bench' }}</em>
                  </span>
                  <small>
                    HP {{ h.hp }}/{{ h.maxHp }} · {{ h.weapon.damage }} ATK · {{ h.graftIds.length }}/{{ MAX_GRAFTS_PER_HERO }} Grafts
                    {{ h.graftIds.map((g) => GRAFT_REGISTRY[g]?.badgeIcon).join('') }}
                  </small>
                  <small>
                    {{
                      h.graftIds.includes(selectedGraftId)
                        ? 'Already attached'
                        : nextTierLabel(h.graftIds.length)
                    }}
                  </small>
                </div>
              </button>
            </div>
          </div>
        </section>
        <div v-else-if="reward.graftChoices.length > 0" class="claimed-banner">
          <CraftIcon name="check" :size="16" /> Graft sticker attached &amp; hero promoted!
        </div>

        <!-- 3. Soil Relic Draft -->
        <section v-if="reward.relicChoices.length > 0 && !reward.claimedRelic" class="reward-sec">
          <h3>Claim a Run-Wide Soil Relic</h3>
          <div class="choice-grid">
            <div
              v-for="rid in reward.relicChoices"
              :key="rid"
              class="seed-packet choice-card"
            >
              <div class="choice-top">
                <strong>{{ RELIC_REGISTRY[rid].icon }} {{ RELIC_REGISTRY[rid].name }}</strong>
              </div>
              <p>{{ RELIC_REGISTRY[rid].description }}</p>
              <button class="paper-btn gold" @click="pickRelic(rid)">
                Equip Relic
              </button>
            </div>
          </div>
        </section>
        <div v-else-if="reward.relicChoices.length > 0" class="claimed-banner">
          <CraftIcon name="check" :size="16" /> Soil Relic added to your garden!
        </div>
      </div>

      <!-- Sticky Thumb-Friendly Footer CTA -->
      <footer class="reward-foot">
        <button
          class="paper-btn diecut done-btn"
          :class="confirmSkipUnclaimed ? 'danger' : unclaimedCount > 0 ? 'gold' : 'primary'"
          @click="handleContinue"
        >
          <CraftIcon name="map" :size="18" />
          <span v-if="confirmSkipUnclaimed">
            Leave {{ unclaimedCount }} unclaimed reward{{ unclaimedCount > 1 ? 's' : '' }}? Tap again →
          </span>
          <span v-else-if="unclaimedCount > 0">
            Continue ({{ unclaimedCount }} reward{{ unclaimedCount > 1 ? 's' : '' }} left) →
          </span>
          <span v-else>Continue to Garden Trail →</span>
        </button>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.reward-page {
  width: 100%;
  height: 100dvh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: calc(12px + var(--safe-top)) calc(12px + var(--safe-right))
    calc(12px + var(--safe-bottom)) calc(12px + var(--safe-left));
}

.reward-shell {
  width: 100%;
  max-width: 880px;
  max-height: calc(100dvh - 34px - var(--safe-top) - var(--safe-bottom));
  display: flex;
  flex-direction: column;
  overflow: visible;
}

.reward-foot {
  border-radius: 0 0 10px 10px;
}

.reward-head {
  padding: 20px 20px 12px;
  border-bottom: 2px dashed rgba(69, 42, 22, 0.24);
  flex-shrink: 0;
}

.spoils-strip {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
}

.seed-pill { background: #fde89b; }
.heal-pill { background: #dcf5cc; }

.reward-body {
  flex: 1;
  min-height: 0;
  padding: 14px 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.reward-sec {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.choice-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
  gap: 11px;
}

.choice-card {
  text-align: left;
  padding: 17px 13px 13px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  color: var(--ink);
}

.choice-card.selectable {
  cursor: pointer;
}

.choice-card.picked {
  background:
    linear-gradient(180deg, rgba(255, 251, 228, 0.92) 0%, rgba(250, 226, 154, 0.94) 100%),
    var(--tex-paper) center / 300px 300px repeat;
  border-color: #964410;
  box-shadow: 0 0 0 2.5px rgba(246, 200, 68, 0.62), var(--shadow-cutout);
}

.picked-pill {
  background: #fde078;
  font-size: 0.7rem;
}

.choice-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 6px;
}

.recruit-id {
  display: flex;
  align-items: center;
  gap: 9px;
}

.recruit-thumb {
  width: 48px;
  height: 48px;
  object-fit: contain;
  filter: drop-shadow(0 2px 2px rgba(42, 20, 6, 0.26));
}

.animal-pill {
  background: #fde8b2;
  font-size: 0.7rem;
}

.coop-note {
  font-size: 0.76rem;
  font-weight: 800;
  color: #6b3c0b;
  background: #fff4d1;
  border: 1.5px solid rgba(69, 42, 22, 0.25);
  border-radius: 8px;
  padding: 4px 8px;
}

.sub-role {
  display: block;
  font-size: 0.74rem;
  color: var(--ink-soft);
}

.choice-card p {
  margin: 0;
  font-size: 0.83rem;
  color: var(--ink-soft);
  line-height: 1.35;
}

.stat-line {
  font-size: 0.74rem;
  color: var(--ink-soft);
}

.target-hero-box {
  background: #f5e6c3;
  border: 2.2px solid var(--ink);
  border-radius: 13px;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.hero-targets {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(195px, 1fr));
  gap: 8px;
}

.hero-graft-btn {
  justify-content: flex-start;
  text-align: left;
  padding: 8px 10px;
}

.mini-spr {
  width: 34px;
  height: 36px;
  object-fit: contain;
  flex-shrink: 0;
}

.hg-copy {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.hg-copy small {
  font-family: 'Nunito', sans-serif;
  font-size: 0.72rem;
  font-weight: 700;
}

.squad-tag {
  font-style: normal;
  font-size: 0.66rem;
  margin-left: 4px;
  padding: 1px 5px;
  border-radius: 5px;
  background: rgba(255, 252, 240, 0.78);
  border: 1px solid rgba(74, 44, 23, 0.35);
}

.claimed-banner {
  background: #dff3d3;
  border: 2px solid var(--leaf-dark);
  border-radius: 11px;
  padding: 9px 13px;
  font-family: 'Fredoka', sans-serif;
  color: #215218;
  display: flex;
  align-items: center;
  gap: 7px;
}

.reward-foot {
  padding: 12px 20px 14px;
  border-top: 2px dashed rgba(69, 42, 22, 0.24);
  background: rgba(251, 244, 225, 0.92);
  flex-shrink: 0;
}

.done-btn {
  width: 100%;
  min-height: 48px;
  font-size: 1.02rem;
}

@media (max-width: 600px) {
  .reward-head { padding: 18px 14px 10px; }
  .reward-body { padding: 12px 14px; }
  .reward-foot { padding: 10px 14px 12px; }
  .choice-grid { grid-template-columns: 1fr; }
}
</style>
