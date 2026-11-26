<script setup lang="ts">
import { GRADE_LABELS } from '../engine/par';
import { computed, nextTick, ref, watch } from 'vue';
import { GRAFT_REGISTRY } from '../data/grafts';
import { ITEM_REGISTRY } from '../data/items';
import { PRODUCE_BLUEPRINTS } from '../data/produce';
import { RELIC_REGISTRY } from '../data/relics';
import { ALT_WEAPON_REGISTRY } from '../data/weapons';
import { getFamilyLabel } from '../engine/hooks';
import { MAX_GRAFTS_PER_HERO } from '../engine/run';
import {
  closeRewardsToMap,
  gameStore,
  graftHero,
  pickRecruit,
  pickRelic,
  pickWeaponReward,
  purchaseMarketOffer,
  rerollGrafts,
} from '../stores/gameStore';
import CraftIcon from './CraftIcon.vue';
import HeroBuildModal from './HeroBuildModal.vue';

const run = computed(() => gameStore.run!);
const reward = computed(() => run.value.pendingReward!);
const selectedGraftId = ref<string | null>(null);
const selectedMarketGraftOfferId = ref<string | null>(null);
const targetHeroBoxRef = ref<HTMLElement | null>(null);
const confirmSkipUnclaimed = ref(false);
const showBuildModal = ref(false);
const buildFocusHeroUid = ref<string | null>(null);

function openLevelUpBuilds(uid?: string): void {
  buildFocusHeroUid.value = uid ?? reward.value.levelUps?.[0]?.heroUid ?? null;
  showBuildModal.value = true;
}

const activeMarketGraftOffer = computed(() =>
  reward.value.marketOffers?.find(
    (o) => o.id === selectedMarketGraftOfferId.value && !o.purchased
  ) ?? null
);

function buyOffer(offerId: string, kind: string): void {
  if (kind === 'graft') {
    selectedMarketGraftOfferId.value =
      selectedMarketGraftOfferId.value === offerId ? null : offerId;
    return;
  }
  purchaseMarketOffer(offerId);
}

function buyMarketGraftForHero(heroUid: string): void {
  if (!selectedMarketGraftOfferId.value) return;
  const ok = purchaseMarketOffer(selectedMarketGraftOfferId.value, heroUid);
  if (ok) {
    selectedMarketGraftOfferId.value = null;
  }
}

const healthyRoster = computed(() => run.value.roster.filter((h) => !h.harvested));

const unclaimedCount = computed(() => {
  let left = 0;
  if (reward.value.recruitChoices.length > 0 && !reward.value.claimedRecruit) left += 1;
  if (reward.value.graftChoices.length > 0 && !reward.value.claimedGraft) left += 1;
  if (reward.value.relicChoices.length > 0 && !reward.value.claimedRelic) left += 1;
  if ((reward.value.weaponChoices?.length ?? 0) > 0 && !reward.value.claimedWeapon) left += 1;
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
            {{
              run.status === 'shop'
                ? "Farmer's Compost Market"
                : run.status === 'vault'
                  ? 'Seed Vault & Compost Market'
                  : 'Harvest Spoils & Level-Ups'
            }}
          </h2>
          <div class="spoils-strip">
            <span class="paper-pill seed-pill">
              <CraftIcon name="seed" :size="14" /> {{ run.seeds }} Run Seeds (+{{ reward.seedsEarned }})
            </span>
            <span
              v-if="reward.battleGrade && reward.battleGrade.grade !== 'cleared'"
              class="paper-pill grade-pill"
              :class="reward.battleGrade.grade"
              :title="`Won in ${reward.battleGrade.turns} turns (par ${reward.battleGrade.par})`"
            >
              {{ GRADE_LABELS[reward.battleGrade.grade] }} +{{ reward.battleGrade.bonusSeeds }}
            </span>
            <span v-if="reward.xpEarned" class="paper-pill xp-pill">
              ★ +{{ reward.xpEarned }} XP
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
        <!-- 0. Hero Level-Up Celebration Banner! -->
        <section v-if="reward.levelUps && reward.levelUps.length > 0" class="reward-sec levelup-sec">
          <div class="lu-head-row">
            <h3>🎉 Squad Level Up!</h3>
            <button class="paper-btn gold mini-sp-btn" @click="openLevelUpBuilds()">
              ★ Spend Skill Points →
            </button>
          </div>
          <div class="lu-grid">
            <button
              v-for="lu in reward.levelUps"
              :key="lu.heroUid"
              class="lu-card"
              @click="openLevelUpBuilds(lu.heroUid)"
            >
              <img
                class="lu-spr"
                :src="`/sprites/${lu.species ?? PRODUCE_BLUEPRINTS[lu.blueprintId]?.species ?? 'potato'}.png`"
                :alt="lu.heroName"
              />
              <div class="lu-copy">
                <strong>{{ lu.heroName }}</strong>
                <span class="lu-badge">Lv.{{ lu.oldLevel }} → Lv.{{ lu.newLevel }}</span>
                <small>
                  +{{ lu.bonusHp }} Max HP
                  <template v-if="lu.bonusAttack > 0"> · +{{ lu.bonusAttack }} ATK</template>
                  · +{{ lu.skillPointsGained }} SP
                </small>
              </div>
            </button>
          </div>
        </section>
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
          <button
            v-if="(run.perks?.graftRerollsLeft ?? 0) > 0"
            class="paper-btn sky reroll-btn"
            @click="selectedGraftId = null; rerollGrafts()"
          >
            Reroll stickers (once per run)
          </button>
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

        <!-- 3B. Armory Alternate Weapon Draft (Elites & Bosses!) -->
        <section
          v-if="(reward.weaponChoices?.length ?? 0) > 0 && !reward.claimedWeapon"
          class="reward-sec"
        >
          <h3>⚔️ Unlock an Armory Alternate Weapon</h3>
          <div class="choice-grid">
            <div
              v-for="wid in reward.weaponChoices"
              :key="wid"
              class="seed-packet choice-card"
            >
              <div class="choice-top">
                <div class="recruit-id">
                  <img
                    class="recruit-thumb"
                    :src="`/sprites/${ALT_WEAPON_REGISTRY[wid].species}.png`"
                    :alt="ALT_WEAPON_REGISTRY[wid].weapon.name"
                  />
                  <div>
                    <strong>{{ ALT_WEAPON_REGISTRY[wid].weapon.name }}</strong>
                    <small class="sub-role">
                      For {{ PRODUCE_BLUEPRINTS[ALT_WEAPON_REGISTRY[wid].species]?.name }} · {{ ALT_WEAPON_REGISTRY[wid].tagline }}
                    </small>
                  </div>
                </div>
              </div>
              <p>{{ ALT_WEAPON_REGISTRY[wid].weapon.description }}</p>
              <small class="stat-line">
                🎯 {{ ALT_WEAPON_REGISTRY[wid].weapon.damage }} DMG · R{{ ALT_WEAPON_REGISTRY[wid].weapon.minRange }}-{{ ALT_WEAPON_REGISTRY[wid].weapon.maxRange }} · {{ ALT_WEAPON_REGISTRY[wid].weapon.arc.toUpperCase() }}
              </small>
              <button class="paper-btn gold" @click="pickWeaponReward(wid)">
                Unlock for Armory
              </button>
            </div>
          </div>
        </section>
        <div v-else-if="(reward.weaponChoices?.length ?? 0) > 0" class="claimed-banner">
          <CraftIcon name="check" :size="16" /> Alternate Weapon unlocked — swap anytime in Squad Builds!
        </div>

        <!-- 4. Mid-Run Compost Market (Spend Run Seeds on Grafts, Items, Healing & Bailout!) -->
        <section v-if="reward.marketOffers && reward.marketOffers.length > 0" class="reward-sec">
          <h3>Compost Market — Spend Your Run Seeds ({{ run.seeds }} available)</h3>
          <div class="choice-grid">
            <div
              v-for="offer in reward.marketOffers"
              :key="offer.id"
              class="seed-packet choice-card"
              :class="{ picked: selectedMarketGraftOfferId === offer.id, sold: offer.purchased }"
            >
              <div class="choice-top">
                <strong>{{ offer.icon }} {{ offer.title }}</strong>
                <span class="paper-pill seed-pill">
                  <CraftIcon name="seed" :size="12" /> {{ offer.cost }}
                </span>
              </div>
              <p>{{ offer.desc }}</p>
              <button
                v-if="!offer.purchased"
                class="paper-btn gold"
                :disabled="run.seeds < offer.cost"
                @click="buyOffer(offer.id, offer.kind)"
              >
                {{
                  offer.kind === 'graft'
                    ? selectedMarketGraftOfferId === offer.id
                      ? 'Pick Hero Below ↓'
                      : `Buy Graft (${offer.cost})`
                    : `Buy (${offer.cost} Seeds)`
                }}
              </button>
              <span v-else class="claimed-mini">
                <CraftIcon name="check" :size="14" /> Purchased
              </span>
            </div>
          </div>

          <div v-if="activeMarketGraftOffer?.graftId" class="target-hero-box">
            <strong>
              Buy &amp; attach {{ activeMarketGraftOffer.icon }} {{ activeMarketGraftOffer.title }} ({{ activeMarketGraftOffer.cost }} Seeds) to:
            </strong>
            <div class="hero-targets">
              <button
                v-for="h in healthyRoster"
                :key="h.uid"
                class="paper-btn gold hero-graft-btn"
                :disabled="
                  h.graftIds.includes(activeMarketGraftOffer.graftId) ||
                  h.graftIds.length >= MAX_GRAFTS_PER_HERO
                "
                @click="buyMarketGraftForHero(h.uid)"
              >
                <img class="mini-spr" :src="`/sprites/${h.species}.png`" :alt="h.name" />
                <div class="hg-copy">
                  <span>{{ h.name }}</span>
                  <small>{{ nextTierLabel(h.graftIds.length) }}</small>
                </div>
              </button>
            </div>
          </div>
        </section>
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

    <HeroBuildModal
      v-if="showBuildModal"
      :initial-hero-uid="buildFocusHeroUid"
      @close="showBuildModal = false"
    />
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

.choice-card.sold {
  opacity: 0.65;
  background: #e9f2e1;
}

.claimed-mini {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-family: 'Fredoka', sans-serif;
  font-size: 0.82rem;
  color: #215218;
  font-weight: 700;
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

.xp-pill {
  background: #d8f1ff;
  color: #104e75;
  font-weight: 800;
}

.levelup-sec {
  background: linear-gradient(135deg, #fff6cf 0%, #ffe699 100%);
  border: 2px solid var(--ink);
  border-radius: 14px;
  padding: 10px 12px;
}

.lu-head-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 8px;
}

.lu-head-row h3 {
  margin: 0;
  color: #542d00;
}

.mini-sp-btn {
  padding: 6px 11px;
  font-size: 0.78rem;
}

.lu-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(195px, 1fr));
  gap: 8px;
}

.lu-card {
  display: flex;
  align-items: center;
  gap: 8px;
  background: #fffdf5;
  border: 2px solid var(--ink);
  border-radius: 11px;
  padding: 6px 9px;
  text-align: left;
  cursor: pointer;
}

.lu-card:hover {
  transform: translateY(-1px);
  background: #fff4d4;
}

.lu-spr {
  width: 36px;
  height: 36px;
  object-fit: contain;
}

.lu-copy {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.lu-copy strong {
  font-size: 0.84rem;
  color: var(--ink);
}

.lu-badge {
  font-size: 0.72rem;
  font-weight: 900;
  color: #9e4b00;
}

.lu-copy small {
  font-size: 0.7rem;
  color: var(--ink-soft);
}
.grade-pill.perfect {
  background: #f6d66b;
  color: #5a3d00;
  font-weight: 800;
}
.grade-pill.great {
  background: #cfe8b5;
  color: #2f4f1a;
  font-weight: 700;
}
.reroll-btn {
  align-self: center;
  margin: 0 auto 10px;
  display: block;
  min-height: 40px;
  padding-inline: 16px;
}
</style>
