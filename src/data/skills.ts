import type { HeroSpecies, StatusKind } from '../engine/types';

export type SkillPathKey = 'pathA' | 'pathB';

export interface PerkEffects {
  /** Permanent base stat boosts applied on unlock (and reverted cleanly on respec!). */
  bonusHp?: number;
  bonusMove?: number;
  bonusJump?: number;
  bonusAttack?: number;
  bonusRange?: number;
  bonusDashDmg?: number;
  bonusCoverDmg?: number;

  /** Dynamic combat & tactical hooks evaluated live in hooks/combat/battle. */
  extraDashes?: number;
  extraKnockback?: number;
  bonusBumpDmg?: number;
  bonusOverwatchShots?: number;
  bonusOverwatchDmg?: number;
  overwatchRoots?: boolean;
  bonusFlankCrit?: number;
  ignoreHalfCoverOnFlank?: boolean;
  bonusHighGroundDmg?: number;
  bonusAssistDmg?: number;
  assistRange?: number; // default 1 (adjacent); 2 lets hero assist from 2 tiles away!
  oneShotCover?: boolean;
  coverBreakSplash?: number;
  jumpStompDmg?: number;
  jumpStompBoost?: boolean;
  allyJumpHeal?: number;
  allyJumpBoost?: boolean;
  livingFullCover?: boolean;
  startShieldTurns?: number;
  startBoostTurns?: number;
  thornsDmg?: number;
  skillCdDelta?: number;
  skillRadiusDelta?: number;
  skillHealDelta?: number;
  skillDmgDelta?: number;
  healOnSkillCast?: number;
  cleanseOnSkillCast?: boolean;
  skillGrantsFreeMove?: boolean;
  skillPushes?: boolean;
  dashStatus?: StatusKind;
  dashKnockback?: boolean;
  attackStatus?: StatusKind;
  rootedTargetBonus?: number;
  burnDetonateBonus?: number;
  acidExplosionOnKill?: boolean;
  killRefreshesDash?: boolean;
  killRefundsCd?: boolean;
}

export interface SkillPerkDef {
  id: string;
  species: HeroSpecies;
  path: SkillPathKey;
  tier: 1 | 2 | 3;
  cost: number;
  requires?: string;
  name: string;
  icon: string;
  shortDesc: string;
  description: string;
  effects: PerkEffects;
}

export interface SkillPathDef {
  key: SkillPathKey;
  name: string;
  icon: string;
  color: string;
  accent: string;
  tagline: string;
  perks: [SkillPerkDef, SkillPerkDef, SkillPerkDef];
}

export interface HeroSkillTreeDef {
  species: HeroSpecies;
  pathA: SkillPathDef;
  pathB: SkillPathDef;
}

export const MAX_HERO_LEVEL = 6;

/** XP thresholds required to advance from level N -> N+1. */
export const XP_TO_NEXT_LEVEL: Record<number, number> = {
  1: 50,
  2: 80,
  3: 115,
  4: 155,
  5: 200,
};

export function getXpToNextLevel(level: number): number {
  return XP_TO_NEXT_LEVEL[level] ?? 999;
}

function makePerk(
  species: HeroSpecies,
  path: SkillPathKey,
  tier: 1 | 2 | 3,
  id: string,
  name: string,
  icon: string,
  shortDesc: string,
  description: string,
  effects: PerkEffects,
  requires?: string
): SkillPerkDef {
  return {
    id,
    species,
    path,
    tier,
    cost: tier === 3 ? 2 : 1,
    requires,
    name,
    icon,
    shortDesc,
    description,
    effects,
  };
}

export const HERO_SKILL_TREES: Record<HeroSpecies, HeroSkillTreeDef> = {
  cow: {
    species: 'cow',
    pathA: {
      key: 'pathA',
      name: 'Pasture Fortress',
      icon: '🛡️',
      color: '#4f8c34',
      accent: '#def5cf',
      tagline: 'Living Full Cover bunker & cleansing squad guardian',
      perks: [
        makePerk(
          'cow', 'pathA', 1, 'cow_barricade', 'Living Barricade', '🧱',
          '+4 HP · Full Cover for Allies',
          'Gain +4 Max HP and start Shielded (2t). Adjacent allies receive Full Cover protection!',
          { bonusHp: 4, startShieldTurns: 2, livingFullCover: true }
        ),
        makePerk(
          'cow', 'pathA', 2, 'cow_bulwark', 'Springy Back', '🌿',
          'Ally Jumps Heal +3 & Boost',
          'Allies who Team-Jump off Stitch heal +3 HP and gain Boosted (+2 ATK) for 1 turn!',
          { allyJumpHeal: 3, allyJumpBoost: true, bonusJump: 1 },
          'cow_barricade'
        ),
        makePerk(
          'cow', 'pathA', 3, 'cow_citadel', 'Stampede Sanctuary', '👑',
          'Rally +1 Radius, Cleanse & Thorns',
          'Pasture Rally reaches +1 wider, heals +2 more, cleanses Burn/Acid, and Stitch reflects 2 Thorns DMG!',
          { skillRadiusDelta: 1, skillHealDelta: 2, cleanseOnSkillCast: true, thornsDmg: 2 },
          'cow_bulwark'
        ),
      ],
    },
    pathB: {
      key: 'pathB',
      name: 'Wrecking Bull',
      icon: '💥',
      color: '#c44b2b',
      accent: '#ffe0d4',
      tagline: 'Multi-gore knockback chains & bridge-shattering bumps',
      perks: [
        makePerk(
          'cow', 'pathB', 1, 'cow_double_gore', 'Double Gore', '⚡',
          'Dash 2 Foes · +1 Dash DMG',
          'Dash up to 2 different farmers per turn with +1 Dash damage and +1 Move!',
          { extraDashes: 1, bonusDashDmg: 1, bonusMove: 1 }
        ),
        makePerk(
          'cow', 'pathB', 2, 'cow_thunder', 'Rolling Thunder', '💢',
          '+2 Bump DMG · +1 Attack',
          'Slamming enemies into walls, crates, or allies deals +2 extra Bump damage, plus +1 Weapon DMG.',
          { bonusBumpDmg: 2, bonusAttack: 1 },
          'cow_double_gore'
        ),
        makePerk(
          'cow', 'pathB', 3, 'cow_wrecking_bell', 'Bell-Ringer Slam', '🔔',
          '1-Shot Cover · 3×3 Break Splash',
          'Attacks obliterate destructible cover/bridges in 1 hit and trigger a 2-DMG shockwave on break!',
          { oneShotCover: true, coverBreakSplash: 2, extraKnockback: 1 },
          'cow_thunder'
        ),
      ],
    },
  },

  lettuce: {
    species: 'lettuce',
    pathA: {
      key: 'pathA',
      name: 'Dew Dancer',
      icon: '💧',
      color: '#2c8fb5',
      accent: '#d6f4ff',
      tagline: 'Agile mobile healer who refreshes & sprints',
      perks: [
        makePerk(
          'lettuce', 'pathA', 1, 'let_morning_mist', 'Morning Mist', '💧',
          'Dewy Refresh +2 Heal · -1 CD',
          'Dewy Refresh heals +2 extra HP and recharges 1 turn faster.',
          { skillHealDelta: 2, skillCdDelta: -1, healOnSkillCast: 2 }
        ),
        makePerk(
          'lettuce', 'pathA', 2, 'let_leaf_vault', 'Leaf Springboard', '🍃',
          '+1 Move · +2 Jump · Ally Heal',
          'Gain +1 Move and +2 Team-Jump range; allies vaulting off Crisphead heal +2 HP & gain Boosted!',
          { bonusMove: 1, bonusJump: 2, allyJumpHeal: 2, allyJumpBoost: true },
          'let_morning_mist'
        ),
        makePerk(
          'lettuce', 'pathA', 3, 'let_salad_tornado', 'Salad Tornado', '🌪️',
          'Dewy Refresh Grants Free Move!',
          'Dewy Refresh covers +1 wider radius, cleanses debuffs, and immediately refreshes Crisphead’s Move!',
          { skillRadiusDelta: 1, cleanseOnSkillCast: true, skillGrantsFreeMove: true },
          'let_leaf_vault'
        ),
      ],
    },
    pathB: {
      key: 'pathB',
      name: 'Razor Flanker',
      icon: '⚔️',
      color: '#50942e',
      accent: '#e2f7d0',
      tagline: 'Long-range partner assists & kill-chained flanks',
      perks: [
        makePerk(
          'lettuce', 'pathB', 1, 'let_wind_slicer', 'Wind Slicer', '🎯',
          '+2 Flank Crit · +1 Range',
          'Gain +1 Weapon Range and deal +2 Critical damage when flanking exposed targets.',
          { bonusRange: 1, bonusFlankCrit: 2, ignoreHalfCoverOnFlank: true }
        ),
        makePerk(
          'lettuce', 'pathB', 2, 'let_ricochet', 'Ricochet Assist', '★',
          'Range-2 Partner Assist (+2 DMG)',
          'Crisphead triggers Partner Follow-Up Assists from up to 2 tiles away for +2 bonus damage!',
          { bonusAssistDmg: 1, assistRange: 2 },
          'let_wind_slicer'
        ),
        makePerk(
          'lettuce', 'pathB', 3, 'let_whirlwind', 'Whirlwind Finisher', '⚡',
          'Kills Refresh Dash · +1 ATK',
          'Gain +1 Weapon DMG, 2× Dashes/turn, and routing an enemy refreshes Crisphead’s Dash & Skill CD!',
          { bonusAttack: 1, extraDashes: 1, killRefreshesDash: true, killRefundsCd: true },
          'let_ricochet'
        ),
      ],
    },
  },

  pea: {
    species: 'pea',
    pathA: {
      key: 'pathA',
      name: 'Overwatch Sentinel',
      icon: '👁️',
      color: '#2c7e9e',
      accent: '#d5f1fc',
      tagline: 'High-ground sharpshooter who locks down enemy movement',
      perks: [
        makePerk(
          'pea', 'pathA', 1, 'pea_hawk_pod', 'Hawk Pod', '🦅',
          '+1 Range · +2 High Ground DMG',
          'Extend Weapon Range by +1 and deal +2 extra damage from elevated cliffs.',
          { bonusRange: 1, bonusHighGroundDmg: 2 }
        ),
        makePerk(
          'pea', 'pathA', 2, 'pea_double_watch', 'Double Hero Sight', '👁️',
          '2× Overwatch Shots · +2 Watch DMG',
          'Hero Sight Overwatch fires up to 2 reaction shots per enemy turn with +2 bonus damage!',
          { bonusOverwatchShots: 1, bonusOverwatchDmg: 2 },
          'pea_hawk_pod'
        ),
        makePerk(
          'pea', 'pathA', 3, 'pea_suppress', 'Pinning Volley', '⛓️',
          'Overwatch Roots Moving Foes!',
          'Hero Sight reaction shots apply Rooted (1t), halting charging farmers dead in their tracks, plus +1 ATK!',
          { overwatchRoots: true, bonusAttack: 1 },
          'pea_double_watch'
        ),
      ],
    },
    pathB: {
      key: 'pathB',
      name: 'Vine Trapper',
      icon: '🌿',
      color: '#3f8a36',
      accent: '#dbf5d4',
      tagline: 'Snare specialist executing Rooted targets',
      perks: [
        makePerk(
          'pea', 'pathB', 1, 'pea_briar_snare', 'Briar Snare', '🌱',
          'Vine Snare -1 CD · +2 Skill DMG',
          'Vine Snare recharges 1 turn faster and deals +2 bonus thorn damage.',
          { skillCdDelta: -1, skillDmgDelta: 2 }
        ),
        makePerk(
          'pea', 'pathB', 2, 'pea_stranglehold', 'Stranglehold', '🎯',
          '+3 DMG vs. Rooted Targets',
          'Deal +3 bonus weapon damage to any Rooted enemy and +2 Flank Crit vs. open foes.',
          { rootedTargetBonus: 3, bonusFlankCrit: 2 },
          'pea_briar_snare'
        ),
        makePerk(
          'pea', 'pathB', 3, 'pea_execution', 'Apex Pod Execution', '💥',
          'Kills Refund CD · +1 ATK & Range',
          'Gain +1 ATK & +1 Range; routing an enemy immediately resets Vine Snare cooldown & grants a free Dash!',
          { bonusAttack: 1, bonusRange: 1, killRefundsCd: true, killRefreshesDash: true },
          'pea_stranglehold'
        ),
      ],
    },
  },

  lemon: {
    species: 'lemon',
    pathA: {
      key: 'pathA',
      name: 'Acid Alchemist',
      icon: '🧪',
      color: '#a38c14',
      accent: '#fff5bf',
      tagline: 'Spreading corrosive zones & chain-reaction meltdowns',
      perks: [
        makePerk(
          'lemon', 'pathA', 1, 'lem_corrosive', 'Corrosive Pulp', '🍋',
          'Attacks Apply Acid · +1 Skill DMG',
          'Zestia’s weapon attacks corrode targets with Acid (2t) and Acid Zest deals +1 DMG.',
          { attackStatus: 'acid', skillDmgDelta: 1 }
        ),
        makePerk(
          'lemon', 'pathA', 2, 'lem_splash_zone', 'Splash Zone', '💦',
          'Acid Zest +1 Radius · -1 CD',
          'Expand Acid Zest into a massive splash (+1 radius) and reduce cooldown by 1 turn!',
          { skillRadiusDelta: 1, skillCdDelta: -1 },
          'lem_corrosive'
        ),
        makePerk(
          'lemon', 'pathA', 3, 'lem_meltdown', 'Citric Meltdown', '☢️',
          'Acid Kills Explode 3×3!',
          'Defeating an Acid-soaked enemy triggers a 3-DMG 3×3 corrosive splash that applies Acid to neighbors!',
          { acidExplosionOnKill: true, bonusAttack: 1 },
          'lem_splash_zone'
        ),
      ],
    },
    pathB: {
      key: 'pathB',
      name: 'Trick-Shot Bombardier',
      icon: '💣',
      color: '#cc681d',
      accent: '#ffe3c4',
      tagline: 'Cover-wrecking artillery & outward knockback blasts',
      perks: [
        makePerk(
          'lemon', 'pathB', 1, 'lem_bouncing', 'Bouncing Citrus', '🎯',
          '+1 Range · +4 Cover DMG',
          'Lob shells +1 tile farther and smash crates & wooden bridges with +4 bonus Cover damage.',
          { bonusRange: 1, bonusCoverDmg: 4 }
        ),
        makePerk(
          'lemon', 'pathB', 2, 'lem_squeeze', 'Squeeze Play', '⇄',
          'Acid Zest Pushes Foes Outward!',
          'Acid Zest knocks enemies 1 tile away from impact (into lava/water/cliffs!) and adds +2 High Ground DMG.',
          { skillPushes: true, bonusHighGroundDmg: 2 },
          'lem_bouncing'
        ),
        makePerk(
          'lemon', 'pathB', 3, 'lem_overload', 'Zest Overload', '✨',
          '1-Shot Cover · Kill Resets CD',
          'Attacks shatter obstacles in 1 hit (2-DMG splash) and scoring a KO refreshes Acid Zest!',
          { oneShotCover: true, coverBreakSplash: 2, killRefundsCd: true },
          'lem_squeeze'
        ),
      ],
    },
  },

  potato: {
    species: 'potato',
    pathA: {
      key: 'pathA',
      name: 'Tuber Juggernaut',
      icon: '🛡️',
      color: '#7a5429',
      accent: '#f5e2c6',
      tagline: 'Immovable thorny frontline bruiser',
      perks: [
        makePerk(
          'potato', 'pathA', 1, 'pot_thick_skin', 'Russet Armor', '🛡️',
          '+5 Max HP · Start Shielded',
          'Permanently gain +5 Max HP and begin every battle braced with Shield (2 turns).',
          { bonusHp: 5, startShieldTurns: 2 }
        ),
        makePerk(
          'potato', 'pathA', 2, 'pot_spud_thorns', 'Prickly Eyes', '🌵',
          'Reflect 2 Thorns · Root Down -1 CD',
          'Enemies attacking Spudnik take 2 Thorns recoil damage; Root Down recharges 1 turn faster.',
          { thornsDmg: 2, skillCdDelta: -1, skillHealDelta: 2 },
          'pot_thick_skin'
        ),
        makePerk(
          'potato', 'pathA', 3, 'pot_iron_root', 'Iron Taproot', '⛰️',
          '+4 HP · Ally Jump Boost · Assist +2',
          'Gain +4 Max HP, Boost allies who jump off Spudnik, and deal +2 Partner Follow-Up Assist damage!',
          { bonusHp: 4, allyJumpBoost: true, bonusAssistDmg: 1, cleanseOnSkillCast: true },
          'pot_spud_thorns'
        ),
      ],
    },
    pathB: {
      key: 'pathB',
      name: 'Demolition Spud',
      icon: '💥',
      color: '#b84228',
      accent: '#ffdcd4',
      tagline: 'Cover-shattering shockwaves & Jump Stomp slams',
      perks: [
        makePerk(
          'potato', 'pathB', 1, 'pot_heavy_mash', 'Heavy Masher', '🔨',
          '+1 ATK · +4 Cover DMG · +2 Bump',
          'Gain +1 Weapon DMG, +4 Cover DMG, and +2 extra Bump damage when slamming foes into obstacles!',
          { bonusAttack: 1, bonusCoverDmg: 4, bonusBumpDmg: 2 }
        ),
        makePerk(
          'potato', 'pathB', 2, 'pot_stomp', 'Tater Quake', '☄️',
          'Team-Jump 3 AoE Stomp + Boost',
          'Gain +1 Jump Range; landing a Team-Jump deals 3 AoE Stomp damage & grants Boosted (+2 ATK)!',
          { bonusJump: 1, jumpStompDmg: 3, jumpStompBoost: true },
          'pot_heavy_mash'
        ),
        makePerk(
          'potato', 'pathB', 3, 'pot_detonator', 'Spud Demolitionist', '💣',
          '1-Shot Cover · 3-DMG Break Splash',
          'Smash cover/bridges in 1 hit, triggering a 3-DMG 3×3 splinter blast & +1 extra Knockback!',
          { oneShotCover: true, coverBreakSplash: 3, extraKnockback: 1 },
          'pot_stomp'
        ),
      ],
    },
  },

  chili: {
    species: 'chili',
    pathA: {
      key: 'pathA',
      name: 'Inferno Dasher',
      icon: '🔥',
      color: '#d43c1c',
      accent: '#ffdad1',
      tagline: 'Lightning-fast multi-dash flame skirmisher',
      perks: [
        makePerk(
          'chili', 'pathA', 1, 'chi_hot_heels', 'Scorching Heels', '💨',
          '+1 Move · Dash 2 Foes/Turn',
          'Gain +1 Move Range and Dash up to 2 different enemies each turn, igniting both with Burn!',
          { bonusMove: 1, extraDashes: 1, bonusDashDmg: 1 }
        ),
        makePerk(
          'chili', 'pathA', 2, 'chi_fire_vault', 'Ember Leap', '☄️',
          '+1 Jump · 2 AoE Fire Stomp',
          'Vault +1 tile farther; landing a Team-Jump triggers a 2-DMG AoE stomp & Boosts Habanero!',
          { bonusJump: 1, jumpStompDmg: 2, jumpStompBoost: true },
          'chi_hot_heels'
        ),
        makePerk(
          'chili', 'pathA', 3, 'chi_wildfire', 'Wildfire Chain', '⚡',
          'Kills Reset Dash · +2 Dash DMG',
          'Gain +2 Dash DMG and +1 extra Dash; routing any enemy refreshes Habanero’s Dash immediately!',
          { bonusDashDmg: 2, extraDashes: 1, killRefreshesDash: true },
          'chi_fire_vault'
        ),
      ],
    },
    pathB: {
      key: 'pathB',
      name: 'Volcanic Arsonist',
      icon: '🌋',
      color: '#a82330',
      accent: '#ffd4da',
      tagline: 'Ignite & detonate Burning targets for massive bursts',
      perks: [
        makePerk(
          'chili', 'pathB', 1, 'chi_scoville', 'Ghost Pepper', '🌶️',
          'Attacks Apply Burn · +1 Range',
          'Weapon attacks ignite targets with Burn (2t) and reach +1 tile farther.',
          { attackStatus: 'burn', bonusRange: 1 }
        ),
        makePerk(
          'chili', 'pathB', 2, 'chi_flare', 'Combustion', '💥',
          '+3 Burst DMG vs. Burning Foes',
          'Shooting a Burning enemy detonates the flames for +3 bonus burst damage!',
          { burnDetonateBonus: 3, bonusFlankCrit: 1 },
          'chi_scoville'
        ),
        makePerk(
          'chili', 'pathB', 3, 'chi_supernova', 'Scoville Supernova', '☀️',
          'Start Boosted · +1 ATK · Kill CD Reset',
          'Begin every battle Boosted (+2 ATK), gain +1 permanent ATK, and kills reset Scoville Boost!',
          { startBoostTurns: 2, bonusAttack: 1, killRefundsCd: true, skillCdDelta: -1 },
          'chi_flare'
        ),
      ],
    },
  },

  carrot: {
    species: 'carrot',
    pathA: {
      key: 'pathA',
      name: 'Tunnel Skirmisher',
      icon: '🕳️',
      color: '#d96e1c',
      accent: '#ffe6cf',
      tagline: 'Burrow-warping flanker with rapid mobility',
      perks: [
        makePerk(
          'carrot', 'pathA', 1, 'car_swift_burrow', 'Nimble Taproot', '💨',
          '+1 Move · +1 Jump · -1 Skill CD',
          'Move +1 farther, Team-Jump +1 farther, and recharge Burrow Surge 1 turn faster.',
          { bonusMove: 1, bonusJump: 1, skillCdDelta: -1 }
        ),
        makePerk(
          'carrot', 'pathA', 2, 'car_ambush', 'Subterranean Ambush', '⚡',
          'Dash 2 Foes · Free Move on Skill',
          'Dash 2 foes per turn (+1 DMG) and casting Burrow Surge refreshes Carroteer’s Move!',
          { extraDashes: 1, bonusDashDmg: 1, skillGrantsFreeMove: true },
          'car_swift_burrow'
        ),
        makePerk(
          'carrot', 'pathA', 3, 'car_pop_up', 'Pop-Up Blitz', '☄️',
          'Jump Stomp 3 AoE · Kills Reset Dash',
          'Team-Jumps slam nearby enemies for 3 DMG + Boost, and kills refresh Dash!',
          { jumpStompDmg: 3, jumpStompBoost: true, killRefreshesDash: true },
          'car_ambush'
        ),
      ],
    },
    pathB: {
      key: 'pathB',
      name: 'Lancer Duelist',
      icon: '🗡️',
      color: '#b0481e',
      accent: '#ffdfd4',
      tagline: 'Armor-piercing flank crits & high-ground skewers',
      perks: [
        makePerk(
          'carrot', 'pathB', 1, 'car_honed_tip', 'Honed Point', '🎯',
          '+1 ATK · +2 Flank Crit',
          'Gain +1 Weapon DMG and deal +2 Critical damage against exposed targets.',
          { bonusAttack: 1, bonusFlankCrit: 2, ignoreHalfCoverOnFlank: true }
        ),
        makePerk(
          'carrot', 'pathB', 2, 'car_skewer_watch', 'Lancer Sight', '👁️',
          '2× Overwatch · +2 Watch DMG',
          'Hero Sight fires 2 piercing reaction shots per turn with +2 bonus damage!',
          { bonusOverwatchShots: 1, bonusOverwatchDmg: 2, bonusRange: 1 },
          'car_honed_tip'
        ),
        makePerk(
          'carrot', 'pathB', 3, 'car_impale', 'Royal Skewer', '👑',
          'Assist Range 2 (+2) · +2 High Ground',
          'Assist allies from up to 2 tiles away (+2 DMG), deal +2 High Ground DMG, and kills reset Skill CD!',
          { assistRange: 2, bonusAssistDmg: 1, bonusHighGroundDmg: 2, killRefundsCd: true },
          'car_skewer_watch'
        ),
      ],
    },
  },

  blackberry: {
    species: 'blackberry',
    pathA: {
      key: 'pathA',
      name: 'Hedge Apothecary',
      icon: '🍇',
      color: '#6b3b8c',
      accent: '#ebd9ff',
      tagline: 'High-output medic who cleanses & empowers allies',
      perks: [
        makePerk(
          'blackberry', 'pathA', 1, 'bla_sweet_balm', 'Rich Nectar', '✨',
          'Berry Balm +2 Heal · -1 CD',
          'Berry Balm heals +2 extra HP and recharges 1 turn faster.',
          { skillHealDelta: 2, skillCdDelta: -1, healOnSkillCast: 2 }
        ),
        makePerk(
          'blackberry', 'pathA', 2, 'bla_purify', 'Purifying Juice', '🌿',
          'Balm Cleanses · Ally Jump Heal +3',
          'Berry Balm cleanses Burn/Acid/Root/Fear, and allies jumping off Bramble heal +3 HP!',
          { cleanseOnSkillCast: true, allyJumpHeal: 3, bonusHp: 3 },
          'bla_sweet_balm'
        ),
        makePerk(
          'blackberry', 'pathA', 3, 'bla_sanctuary', 'Bramble Sanctuary', '🌟',
          'Balm +1 Radius & Free Move!',
          'Berry Balm reaches +1 wider, gives Boosted to jumping allies, and grants Bramble a free Move on cast!',
          { skillRadiusDelta: 1, allyJumpBoost: true, skillGrantsFreeMove: true },
          'bla_purify'
        ),
      ],
    },
    pathB: {
      key: 'pathB',
      name: 'Briar Warden',
      icon: '🌹',
      color: '#8f2957',
      accent: '#ffd6e8',
      tagline: 'Thorny overwatch controller who Roots & counter-strikes',
      perks: [
        makePerk(
          'blackberry', 'pathB', 1, 'bla_barbed', 'Barbed Sling', '🎯',
          '+1 Range · +2 DMG vs. Rooted',
          'Extend weapon range by +1 and deal +2 bonus damage against Rooted foes.',
          { bonusRange: 1, rootedTargetBonus: 2, bonusAssistDmg: 1 }
        ),
        makePerk(
          'blackberry', 'pathB', 2, 'bla_thorn_watch', 'Thorny Watch', '👁️',
          '2× Overwatch · Shots Root Foes!',
          'Hero Sight fires 2 thorny reaction shots that Root moving enemies in place!',
          { bonusOverwatchShots: 1, overwatchRoots: true },
          'bla_barbed'
        ),
        makePerk(
          'blackberry', 'pathB', 3, 'bla_briar_crown', 'Crown of Briars', '👑',
          '3 Thorns DMG · Attacks Apply Acid',
          'Reflect 3 Thorns damage to attackers, douse targets in Acid on hit, and gain +1 Weapon DMG!',
          { thornsDmg: 3, attackStatus: 'acid', bonusAttack: 1 },
          'bla_thorn_watch'
        ),
      ],
    },
  },

  corn: {
    species: 'corn',
    pathA: {
      key: 'pathA',
      name: 'Popcorn Barrage',
      icon: '🍿',
      color: '#c98e18',
      accent: '#fff0bf',
      tagline: 'Massive AoE bombardment & explosive cover clearing',
      perks: [
        makePerk(
          'corn', 'pathA', 1, 'cor_extra_butter', 'Jumbo Kernels', '💣',
          '+1 Range · +4 Cover DMG',
          'Lob popcorn +1 tile farther and blast crates/bridges with +4 Cover damage.',
          { bonusRange: 1, bonusCoverDmg: 4 }
        ),
        makePerk(
          'corn', 'pathA', 2, 'cor_chain_pop', 'Chain-Pop Blast', '🔥',
          'Kernel Burst +1 Radius & Burn',
          'Kernel Burst explodes +1 wider, deals +2 Skill DMG, and attacks apply Burn!',
          { skillRadiusDelta: 1, skillDmgDelta: 2, attackStatus: 'burn' },
          'cor_extra_butter'
        ),
        makePerk(
          'corn', 'pathA', 3, 'cor_kettle_boom', 'Kettle Corn Nova', '☄️',
          '+3 Burn Detonate · 1-Shot Cover',
          'Detonate Burning targets for +3 burst damage and shatter cover in 1 shot with 2-DMG splash!',
          { burnDetonateBonus: 3, oneShotCover: true, coverBreakSplash: 2 },
          'cor_chain_pop'
        ),
      ],
    },
    pathB: {
      key: 'pathB',
      name: 'Cob Commander',
      icon: '🌽',
      color: '#5b8a26',
      accent: '#e2f5c9',
      tagline: 'High-ground artillery spotter with rapid cooldowns',
      perks: [
        makePerk(
          'corn', 'pathB', 1, 'cor_stalk_view', 'Tall Stalk Perch', '▲',
          '+2 High Ground DMG · +1 Move',
          'Climb cliffs faster (+1 Move) and rain +2 bonus High Ground damage from ledges.',
          { bonusHighGroundDmg: 2, bonusMove: 1 }
        ),
        makePerk(
          'corn', 'pathB', 2, 'cor_quick_pop', 'Rapid Reload', '✨',
          'Kernel Burst -1 CD · Heal +2 on Cast',
          'Reduce Kernel Burst cooldown by 1 turn and heal +2 HP on cast; Kernel Burst pushes foes outward!',
          { skillCdDelta: -1, healOnSkillCast: 2, skillPushes: true },
          'cor_stalk_view'
        ),
        makePerk(
          'corn', 'pathB', 3, 'cor_golden_harvest', 'Golden Salvo', '★',
          'Range-2 Assist (+2) · Kill Resets CD',
          'Provide Range-2 Partner Assist (+2 DMG), +1 permanent ATK, and kills reset Kernel Burst!',
          { assistRange: 2, bonusAssistDmg: 1, bonusAttack: 1, killRefundsCd: true },
          'cor_quick_pop'
        ),
      ],
    },
  },

  pig: {
    species: 'pig',
    pathA: {
      key: 'pathA',
      name: 'Mud Trapper',
      icon: '🍄',
      color: '#8f5236',
      accent: '#f7dfd4',
      tagline: 'Rooting mud skirmisher & sturdy truffle forager',
      perks: [
        makePerk(
          'pig', 'pathA', 1, 'pig_forager', 'Prime Truffles', '🍄',
          '+4 HP · Truffle Dig -1 CD & +2 Heal',
          'Gain +4 Max HP; Truffle Dig heals +2 extra HP and recharges 1 turn faster.',
          { bonusHp: 4, skillCdDelta: -1, skillHealDelta: 2 }
        ),
        makePerk(
          'pig', 'pathA', 2, 'pig_mud_snare', 'Sticky Snout', '🌿',
          'Dash Applies Rooted · +2 vs Rooted',
          'Truffle Boar’s Dash tangles farmers with Rooted (1t), and attacks deal +2 DMG to Rooted foes!',
          { dashStatus: 'rooted', rootedTargetBonus: 2 },
          'pig_forager'
        ),
        makePerk(
          'pig', 'pathA', 3, 'pig_swine_feast', 'Barnyard Feast', '🌟',
          'Truffle Dig Cleanses + Free Move!',
          'Truffle Dig cleanses debuffs, reaches +1 wider, and grants Truffle Boar a free Move after digging!',
          { cleanseOnSkillCast: true, skillRadiusDelta: 1, skillGrantsFreeMove: true },
          'pig_mud_snare'
        ),
      ],
    },
    pathB: {
      key: 'pathB',
      name: 'Battering Boar',
      icon: '🐗',
      color: '#c44b3b',
      accent: '#ffdbd6',
      tagline: 'Unstoppable multi-dash bowling ball',
      perks: [
        makePerk(
          'pig', 'pathB', 1, 'pig_boar_rush', 'Twin Tusks', '⚡',
          'Dash 2 Foes · +2 Dash DMG',
          'Dash up to 2 different enemies in one turn with +2 bonus Dash damage!',
          { extraDashes: 1, bonusDashDmg: 2 }
        ),
        makePerk(
          'pig', 'pathB', 2, 'pig_pinball', 'Barnyard Pinball', '⇄',
          'Dash Knocks Back · +2 Bump DMG',
          'Dashes knock enemies back 1 tile and all Bump collisions deal +2 extra damage!',
          { dashKnockback: true, bonusBumpDmg: 2, bonusMove: 1 },
          'pig_boar_rush'
        ),
        makePerk(
          'pig', 'pathB', 3, 'pig_juggernaut', 'Unstoppable Boar', '💥',
          'Start Boosted · Kills Reset Dash',
          'Start every battle Boosted (+2 ATK/Dash), +1 ATK, and kills refresh Dash immediately!',
          { startBoostTurns: 2, bonusAttack: 1, killRefreshesDash: true, extraKnockback: 1 },
          'pig_pinball'
        ),
      ],
    },
  },

  rooster: {
    species: 'rooster',
    pathA: {
      key: 'pathA',
      name: 'Sky Launchpad',
      icon: '🪶',
      color: '#2c85b8',
      accent: '#d6f0ff',
      tagline: 'Aerial team-jump master & squad battle-cry buffer',
      perks: [
        makePerk(
          'rooster', 'pathA', 1, 'roo_updraft', 'Golden Updraft', '💨',
          '+1 Move · +2 Jump · Ally Boost',
          'Gain +1 Move & +2 Jump; allies who launch off Cluck Norris gain Boosted (+2 ATK) & +2 HP!',
          { bonusMove: 1, bonusJump: 2, allyJumpBoost: true, allyJumpHeal: 2 }
        ),
        makePerk(
          'rooster', 'pathA', 2, 'roo_dawn_chorus', 'Dawn Chorus', '🎺',
          'Dawn Crow +1 Radius · -1 CD',
          'Dawn Crow reaches +1 wider, recharges 1 turn faster, and heals Cluck +2 HP on cast.',
          { skillRadiusDelta: 1, skillCdDelta: -1, healOnSkillCast: 2 },
          'roo_updraft'
        ),
        makePerk(
          'rooster', 'pathA', 3, 'roo_sky_drop', 'Rooster Divebomb', '☄️',
          'Jump Stomp 3 AoE · Free Move on Crow',
          'Landing a Team-Jump deals 3 AoE Stomp DMG + Boost, and Dawn Crow grants a free Move!',
          { jumpStompDmg: 3, jumpStompBoost: true, skillGrantsFreeMove: true },
          'roo_dawn_chorus'
        ),
      ],
    },
    pathB: {
      key: 'pathB',
      name: 'Talon Striker',
      icon: '🎯',
      color: '#c44625',
      accent: '#ffded4',
      tagline: 'High-ground dart sharpshooter & Overwatch hawk',
      perks: [
        makePerk(
          'rooster', 'pathB', 1, 'roo_hawk_eye', 'Roost Sniper', '▲',
          '+1 Range · +2 High Ground DMG',
          'Feather Darts fly +1 tile farther and deal +2 extra damage from elevated perches.',
          { bonusRange: 1, bonusHighGroundDmg: 2 }
        ),
        makePerk(
          'rooster', 'pathB', 2, 'roo_talon_watch', 'Sky Watch', '👁️',
          '2× Overwatch · +2 Watch DMG',
          'Hero Sight Overwatch triggers twice per enemy turn with +2 bonus damage!',
          { bonusOverwatchShots: 1, bonusOverwatchDmg: 2, bonusFlankCrit: 2 },
          'roo_hawk_eye'
        ),
        makePerk(
          'rooster', 'pathB', 3, 'roo_flock_strike', 'Flock Leader', '★',
          'Range-2 Assist (+2) · +1 ATK',
          'Trigger Partner Assists from 2 tiles away (+2 DMG), gain +1 ATK, and kills refresh Dash!',
          { assistRange: 2, bonusAssistDmg: 1, bonusAttack: 1, killRefreshesDash: true },
          'roo_talon_watch'
        ),
      ],
    },
  },

  sheep: {
    species: 'sheep',
    pathA: {
      key: 'pathA',
      name: 'Fleece Citadel',
      icon: '☁️',
      color: '#4e855c',
      accent: '#daf5e0',
      tagline: 'Living Full-Cover wool bunker & AoE Shield guardian',
      perks: [
        makePerk(
          'sheep', 'pathA', 1, 'she_merino', 'Merino Fortress', '🛡️',
          '+5 HP · Full Cover for Allies',
          'Gain +5 Max HP, start Shielded (2t), and upgrade Woolly’s Living Cover to Full Cover!',
          { bonusHp: 5, startShieldTurns: 2, livingFullCover: true }
        ),
        makePerk(
          'sheep', 'pathA', 2, 'she_cozy_huddle', 'Cozy Huddle', '✨',
          'Fluffy Huddle +2 Heal · -1 CD',
          'Fluffy Huddle heals +2 more HP, cleanses debuffs, and recharges 1 turn faster.',
          { skillHealDelta: 2, cleanseOnSkillCast: true, skillCdDelta: -1 },
          'she_merino'
        ),
        makePerk(
          'sheep', 'pathA', 3, 'she_static_wool', 'Static Fleece', '⚡',
          '3 Thorns · Huddle +1 Radius',
          'Fluffy Huddle reaches +1 wider, jumping allies heal +3 HP, and attackers suffer 3 Thorns recoil!',
          { skillRadiusDelta: 1, allyJumpHeal: 3, thornsDmg: 3 },
          'she_cozy_huddle'
        ),
      ],
    },
    pathB: {
      key: 'pathB',
      name: 'Ramming Shepherd',
      icon: '🐏',
      color: '#a36b2c',
      accent: '#fae6c8',
      tagline: 'Bouncy headbutt pusher & wool-bale slammer',
      perks: [
        makePerk(
          'sheep', 'pathB', 1, 'she_headbutt', 'Woolly Charge', '⚡',
          '+1 Move · Dash 2 Foes + Push',
          'Gain +1 Move and Dash 2 enemies per turn, knocking each back 1 tile!',
          { bonusMove: 1, extraDashes: 1, dashKnockback: true }
        ),
        makePerk(
          'sheep', 'pathB', 2, 'she_bale_slam', 'Heavy Bale Slam', '💢',
          '+1 ATK · +2 Bump DMG · +4 Cover',
          'Gain +1 Weapon DMG, +4 Cover DMG, and +2 extra Bump damage on wall/ally collisions!',
          { bonusAttack: 1, bonusCoverDmg: 4, bonusBumpDmg: 2 },
          'she_headbutt'
        ),
        makePerk(
          'sheep', 'pathB', 3, 'she_flock_stomp', 'Woollen Avalanche', '☄️',
          'Jump Stomp 3 AoE · Huddle Pushes',
          'Team-Jumps deal 3 AoE Stomp DMG + Boost, and Fluffy Huddle knocks adjacent foes away!',
          { jumpStompDmg: 3, jumpStompBoost: true, skillPushes: true, extraKnockback: 1 },
          'she_bale_slam'
        ),
      ],
    },
  },

  goat: {
    species: 'goat',
    pathA: {
      key: 'pathA',
      name: 'Scrap Wrecker',
      icon: '🔧',
      color: '#9e6224',
      accent: '#fae2c3',
      tagline: 'Demolition expert turning cover into Acid shrapnel',
      perks: [
        makePerk(
          'goat', 'pathA', 1, 'goa_iron_jaw', 'Iron Jaw', '💥',
          '1-Shot Cover · 3-DMG Splinter Splash',
          'Obliterate crates & bridges in 1 hit, blasting nearby foes with 3 shrapnel DMG!',
          { oneShotCover: true, coverBreakSplash: 3, bonusCoverDmg: 4 }
        ),
        makePerk(
          'goat', 'pathA', 2, 'goa_acid_horns', 'Corrosive Horns', '🧪',
          'Attacks Apply Acid · +2 Bump DMG',
          'Crusher Horns coat targets in Acid (2t) and deal +2 extra Bump damage on knockback!',
          { attackStatus: 'acid', bonusBumpDmg: 2, extraKnockback: 1 },
          'goa_iron_jaw'
        ),
        makePerk(
          'goat', 'pathA', 3, 'goa_scrap_bomb', 'Scrapyard Meltdown', '☢️',
          'Acid Kills Explode 3×3 · +1 ATK',
          'Defeating an Acid-soaked enemy triggers a 3×3 corrosive explosion; permanently gain +1 ATK!',
          { acidExplosionOnKill: true, bonusAttack: 1 },
          'goa_acid_horns'
        ),
      ],
    },
    pathB: {
      key: 'pathB',
      name: 'Tin-Can Berserker',
      icon: '⚡',
      color: '#b8392a',
      accent: '#ffd8d4',
      tagline: 'Relentless self-healing multi-dash rampager',
      perks: [
        makePerk(
          'goat', 'pathB', 1, 'goa_double_ram', 'Ramming Speed', '⚡',
          'Dash 2 Foes · +1 Move & +1 Dash DMG',
          'Gain +1 Move and Dash 2 different farmers per turn (+1 Dash DMG, knocking back + Acid!).',
          { bonusMove: 1, extraDashes: 1, bonusDashDmg: 1 }
        ),
        makePerk(
          'goat', 'pathB', 2, 'goa_feast_can', 'Double Helping', '🥫',
          'Tin-Can Snack -1 CD & Free Move!',
          'Tin-Can Snack recharges every turn, heals +2 extra HP, and grants Billy a free Move!',
          { skillCdDelta: -1, skillHealDelta: 2, skillGrantsFreeMove: true },
          'goa_double_ram'
        ),
        makePerk(
          'goat', 'pathB', 3, 'goa_unleashed', 'Stubborn Rampage', '👑',
          'Kills Reset Dash & CD · Start Boosted',
          'Begin every battle Boosted (+2 ATK), gain +4 Max HP, and kills refresh Dash + Tin-Can Snack!',
          { startBoostTurns: 2, bonusHp: 4, killRefreshesDash: true, killRefundsCd: true },
          'goa_feast_can'
        ),
      ],
    },
  },

  strawberry: {
    species: 'strawberry',
    pathA: {
      key: 'pathA',
      name: 'Crimson Duelist',
      icon: '🗡️',
      color: '#c92a42',
      accent: '#ffd9df',
      tagline: 'Lightning multi-dash flanker who resets dashes on every KO',
      perks: [
        makePerk(
          'strawberry', 'pathA', 1, 'str_fencing_step', 'Fencing Step', '⚡',
          '+1 Move · Dash 2 Foes (+1 DMG)',
          'Gain +1 Move and Dash up to 2 different farmhands per turn with +1 Dash damage!',
          { bonusMove: 1, extraDashes: 1, bonusDashDmg: 1 }
        ),
        makePerk(
          'strawberry', 'pathA', 2, 'str_en_garde', 'En Garde Flank', '🎯',
          '+2 Flank Crit · Ignore ½ Cover',
          'Flanking shots deal +2 Critical damage and slice clean through enemy Half Cover!',
          { bonusFlankCrit: 2, ignoreHalfCoverOnFlank: true, bonusAttack: 1 },
          'str_fencing_step'
        ),
        makePerk(
          'strawberry', 'pathA', 3, 'str_berry_blitz', 'Swashbuckler Blitz', '👑',
          'Kills Reset Dash & CD · Start Boost',
          'Begin every battle Boosted (+2 ATK), and routing any enemy refreshes Dash & Sweet Riposte!',
          { startBoostTurns: 2, killRefreshesDash: true, killRefundsCd: true, bonusDashDmg: 1 },
          'str_en_garde'
        ),
      ],
    },
    pathB: {
      key: 'pathB',
      name: 'Sweet Riposte',
      icon: '🍓',
      color: '#3f8c35',
      accent: '#dcf5d8',
      tagline: 'Root-snare specialist & long-reach Partner Assist duelist',
      perks: [
        makePerk(
          'strawberry', 'pathB', 1, 'str_thorn_feint', 'Briar Pin', '🌿',
          'Sweet Riposte -1 CD · +2 DMG',
          'Sweet Riposte recharges every turn, deals +2 extra damage, and heals Strawbina +2 HP on cast!',
          { skillCdDelta: -1, skillDmgDelta: 2, healOnSkillCast: 2 }
        ),
        makePerk(
          'strawberry', 'pathB', 2, 'str_pinned_prey', 'Pinned Prey', '💥',
          '+3 DMG vs Rooted · Range-2 Assist',
          'Deal +3 bonus damage to Rooted foes and trigger Partner Assists from up to 2 tiles away!',
          { rootedTargetBonus: 3, assistRange: 2, bonusAssistDmg: 1 },
          'str_thorn_feint'
        ),
        makePerk(
          'strawberry', 'pathB', 3, 'str_grand_flourish', 'Grand Flourish', '✨',
          'Riposte Free Move · +1 Range & ATK',
          'Casting Sweet Riposte grants a free Move and cleanses debuffs; gain +1 Range and +1 Attack!',
          { skillGrantsFreeMove: true, cleanseOnSkillCast: true, bonusRange: 1, bonusAttack: 1 },
          'str_pinned_prey'
        ),
      ],
    },
  },

  mushroom: {
    species: 'mushroom',
    pathA: {
      key: 'pathA',
      name: 'Springboard Sage',
      icon: '🍄',
      color: '#c43b3b',
      accent: '#ffe0dc',
      tagline: 'Living jump-pad trampoline & airborne stomp trickster',
      perks: [
        makePerk(
          'mushroom', 'pathA', 1, 'mus_trampoline', 'Bouncy Canopy', '💨',
          '+2 Jump · Ally Jumps Heal +3 & Boost',
          'Gain +2 Jump range & +3 Max HP; allies Team-Jumping off Shroom heal +3 HP and gain Boosted!',
          { bonusJump: 2, bonusHp: 3, allyJumpHeal: 3, allyJumpBoost: true }
        ),
        makePerk(
          'mushroom', 'pathA', 2, 'mus_cap_stomp', 'Toadstool Stomp', '☄️',
          'Jump Stomp 3 AoE · Start Shielded',
          'Landing from a Team-Jump slams adjacent foes for 3 AoE DMG + Boost; start Shielded (2t)!',
          { jumpStompDmg: 3, jumpStompBoost: true, startShieldTurns: 2 },
          'mus_trampoline'
        ),
        makePerk(
          'mushroom', 'pathA', 3, 'mus_bouncy_fort', 'Mycelium Sanctuary', '🛡️',
          '+4 HP · 2 Thorns · Free Move',
          'Gain +4 Max HP, reflect 2 Thorns damage, and Springy Puff cleanses & grants Shroom a Free Move!',
          { bonusHp: 4, thornsDmg: 2, cleanseOnSkillCast: true, skillGrantsFreeMove: true },
          'mus_cap_stomp'
        ),
      ],
    },
    pathB: {
      key: 'pathB',
      name: 'Spore Alchemist',
      icon: '🧪',
      color: '#7c45a8',
      accent: '#eedcff',
      tagline: 'Corrosive spore clouds, knockback chains & chain explosions',
      perks: [
        makePerk(
          'mushroom', 'pathB', 1, 'mus_toxic_spores', 'Acidic Spores', '🧪',
          'Attacks Apply Acid · +1 Cover DMG',
          'Spore shots coat farmhands in Acid (+2 incoming DMG) and gain +1 Weapon Range!',
          { attackStatus: 'acid', bonusRange: 1, bonusCoverDmg: 2 }
        ),
        makePerk(
          'mushroom', 'pathB', 2, 'mus_mega_puff', 'Mega Puff Cloud', '💥',
          'Springy Puff +1 Radius · -1 CD · Push',
          'Springy Puff expands +1 wider, deals +2 extra damage, pushes foes away, and recharges faster!',
          { skillRadiusDelta: 1, skillDmgDelta: 2, skillCdDelta: -1, skillPushes: true },
          'mus_toxic_spores'
        ),
        makePerk(
          'mushroom', 'pathB', 3, 'mus_spore_bloom', 'Fungal Meltdown', '☢️',
          'Acid Kills Explode 3×3 · +1 ATK',
          'Defeating an Acid-soaked farmer erupts in a 3×3 corrosive spore burst; gain +1 Attack & +2 Bump DMG!',
          { acidExplosionOnKill: true, bonusAttack: 1, bonusBumpDmg: 2 },
          'mus_mega_puff'
        ),
      ],
    },
  },

  duck: {
    species: 'duck',
    pathA: {
      key: 'pathA',
      name: 'Pond Watchdog',
      icon: '👁️',
      color: '#257da3',
      accent: '#d4f2ff',
      tagline: 'High-ground Overwatch ace who pins approaching farmhands',
      perks: [
        makePerk(
          'duck', 'pathA', 1, 'duc_goggle_sight', 'Aviator Goggles', '▲',
          '+1 Range · +2 High Ground DMG',
          'Hose Blaster reaches +1 tile farther and deals +2 bonus damage from elevated terrain!',
          { bonusRange: 1, bonusHighGroundDmg: 2 }
        ),
        makePerk(
          'duck', 'pathA', 2, 'duc_double_watch', 'Duck Patrol Watch', '👁️',
          '2× Overwatch · Shots Root Foes',
          'Hero Sight Overwatch triggers twice per enemy turn with +2 DMG and Roots caught farmhands!',
          { bonusOverwatchShots: 1, bonusOverwatchDmg: 2, overwatchRoots: true },
          'duc_goggle_sight'
        ),
        makePerk(
          'duck', 'pathA', 3, 'duc_wingman_ace', 'Wingman Ace', '★',
          'Range-2 Assist (+2) · +2 Flank Crit',
          'Trigger Partner Assists from 2 tiles away (+2 DMG), +2 Flank Crit, and +1 Weapon Attack!',
          { assistRange: 2, bonusAssistDmg: 1, bonusFlankCrit: 2, bonusAttack: 1 },
          'duc_double_watch'
        ),
      ],
    },
    pathB: {
      key: 'pathB',
      name: 'Hydro Cannon',
      icon: '🌊',
      color: '#1e9c8c',
      accent: '#d4faf3',
      tagline: 'Extreme pressure knockback & creek-dunking demolition',
      perks: [
        makePerk(
          'duck', 'pathB', 1, 'duc_turbo_jet', 'High-Pressure Nozzle', '💨',
          '+1 Knockback · +2 Bump DMG',
          'Water blasts launch farmhands +1 tile farther and deal +2 extra Bump damage into hazards!',
          { extraKnockback: 1, bonusBumpDmg: 2, bonusCoverDmg: 3 }
        ),
        makePerk(
          'duck', 'pathB', 2, 'duc_tidal_dash', 'Belly-Slide Splash', '⚡',
          'Dash 2 Foes · Push + Acid · +1 Move',
          'Gain +1 Move and Dash 2 enemies per turn, knocking each back 1 tile and dousing them in Acid!',
          { bonusMove: 1, extraDashes: 1, dashKnockback: true, dashStatus: 'acid' },
          'duc_turbo_jet'
        ),
        makePerk(
          'duck', 'pathB', 3, 'duc_monsoon', 'Monsoon Barrage', '🌊',
          'Splashdown -1 CD · 1-Shot Cover',
          'Pond Splashdown recharges faster with +1 Radius & +2 DMG; attacks shatter cover in 1 blast!',
          { skillCdDelta: -1, skillRadiusDelta: 1, skillDmgDelta: 2, oneShotCover: true, coverBreakSplash: 2 },
          'duc_tidal_dash'
        ),
      ],
    },
  },

  pumpkin: {
    species: 'pumpkin',
    pathA: {
      key: 'pathA',
      name: 'Iron Rind',
      icon: '🛡️',
      color: '#b8601c',
      accent: '#ffe8d1',
      tagline: 'Immovable living fortress with thorns & automatic opening armor',
      perks: [
        makePerk(
          'pumpkin', 'pathA', 1, 'pmk_bucket_guard', 'Bucket Visor', '🪣',
          '+4 Max HP · Start Shielded (2t)',
          'Reinforced oak bucket armor adds +4 Max HP and opens every battle with Shield (-2 DMG)!',
          { bonusHp: 4, startShieldTurns: 2 }
        ),
        makePerk(
          'pumpkin', 'pathA', 2, 'pmk_briar_rind', 'Living Wall & Thorns', '🌵',
          'Living Full Cover · 3 Thorns DMG',
          'Upgrades Patch to Living Full Cover for allies and reflects 3 Thorns damage to close attackers!',
          { livingFullCover: true, thornsDmg: 3, bonusHp: 2 },
          'pmk_bucket_guard'
        ),
        makePerk(
          'pumpkin', 'pathA', 3, 'pmk_harvest_bastion', 'Harvest Bastion', '🏰',
          'Gourd Slam Heals +4 & Cleanses',
          'Gourd Slam heals Patch +4 HP, cleanses debuffs on allies, recharges 1 turn faster & expands +1!',
          { healOnSkillCast: 4, cleanseOnSkillCast: true, skillCdDelta: -1, skillRadiusDelta: 1 },
          'pmk_briar_rind'
        ),
      ],
    },
    pathB: {
      key: 'pathB',
      name: 'Cider Smasher',
      icon: '🔨',
      color: '#c94322',
      accent: '#ffe0d4',
      tagline: 'Earthshaking mallet knockbacks, cover explosions & burning slams',
      perks: [
        makePerk(
          'pumpkin', 'pathB', 1, 'pmk_oak_impact', 'Heavy Oak Head', '💥',
          '+1 Knockback · +2 Bump DMG',
          'Cider Mallet sends farmers flying +1 tile farther and deals +2 bonus Bump damage into walls!',
          { extraKnockback: 1, bonusBumpDmg: 2, bonusCoverDmg: 3 }
        ),
        makePerk(
          'pumpkin', 'pathB', 2, 'pmk_ember_slam', 'Jack-o-Ignition', '🔥',
          'Attacks Apply Burn · 1-Shot Cover',
          'Every mallet swing ignites foes with Burn and shatters crates in 1 hit (+2 splash damage)!',
          { attackStatus: 'burn', oneShotCover: true, coverBreakSplash: 2 },
          'pmk_oak_impact'
        ),
        makePerk(
          'pumpkin', 'pathB', 3, 'pmk_pumpkin_quake', 'Pumpkin Quake', '🎃',
          'Jump Stomp 4 DMG · +3 Burn Detonate',
          'Team-Jump landings quake adjacent foes for 4 DMG; hitting Burning foes detonates for +3 bonus DMG!',
          { jumpStompDmg: 4, jumpStompBoost: true, burnDetonateBonus: 3, bonusAttack: 1 },
          'pmk_ember_slam'
        ),
      ],
    },
  },

  blueberry: {
    species: 'blueberry',
    pathA: {
      key: 'pathA',
      name: 'Shadow Vine',
      icon: '🥷',
      color: '#3c5296',
      accent: '#dce6ff',
      tagline: 'Lightning-fast flanker who resets Dashes on KO and ignores Half Cover',
      perks: [
        makePerk(
          'blueberry', 'pathA', 1, 'blu_silent_step', 'Dewdrop Footwork', '💨',
          '+1 Move · +2 Flank Crit · Bypass Half Cover',
          'Gain +1 Move, +2 bonus Flank Crit damage, and dart straight past Half Cover on flanked angles!',
          { bonusMove: 1, bonusFlankCrit: 2, ignoreHalfCoverOnFlank: true }
        ),
        makePerk(
          'blueberry', 'pathA', 2, 'blu_phantom_dash', 'Shadow Chain-Dash', '⚡',
          '2× Dash (+2 DMG) · KO Refreshes Dash',
          'Dash 2 farmers per turn (+2 Dash DMG), and defeating any farmer immediately refreshes Dash!',
          { extraDashes: 1, bonusDashDmg: 2, killRefreshesDash: true },
          'blu_silent_step'
        ),
        makePerk(
          'blueberry', 'pathA', 3, 'blu_vanish_strike', 'Smoke Vanish', '🌙',
          'Skill Grants Free Move · KO Refunds CD',
          'Casting Indigo Smoke grants a free reposition move; scoring a KO refunds Skill cooldown + +1 ATK!',
          { skillGrantsFreeMove: true, killRefundsCd: true, bonusAttack: 1 },
          'blu_phantom_dash'
        ),
      ],
    },
    pathB: {
      key: 'pathB',
      name: 'Tart Alchemist',
      icon: '🧪',
      color: '#6e3fa3',
      accent: '#efe0ff',
      tagline: 'Acidic chain-reactions, wide smoke clouds & lethal follow-up darts',
      perks: [
        makePerk(
          'blueberry', 'pathB', 1, 'blu_concentrated_juice', 'Concentrated Juice', '🫐',
          '+1 Range · +2 Skill DMG · -1 CD',
          'Rose-Thorn Darts reach +1 tile farther; Indigo Smoke hits +2 harder and recharges 1 turn faster!',
          { bonusRange: 1, skillDmgDelta: 2, skillCdDelta: -1 }
        ),
        makePerk(
          'blueberry', 'pathB', 2, 'blu_berry_burst', 'Acidic Detonation', '☢️',
          'Acid Kills Explode 3×3 · +1 Smoke Radius',
          'Defeating an Acid-coated farmer erupts in a 3×3 berry burst; Indigo Smoke spreads +1 tile wider!',
          { acidExplosionOnKill: true, skillRadiusDelta: 1 },
          'blu_concentrated_juice'
        ),
        makePerk(
          'blueberry', 'pathB', 3, 'blu_kunai_crossfire', 'Kunai Crossfire', '★',
          '2× Overwatch · Range-2 Assist (+2)',
          'Fire 2 Overwatch ambush darts per enemy turn and trigger Range-2 Partner Assists (+2 DMG)!',
          { bonusOverwatchShots: 1, bonusOverwatchDmg: 1, assistRange: 2, bonusAssistDmg: 1 },
          'blu_berry_burst'
        ),
      ],
    },
  },

  owl: {
    species: 'owl',
    pathA: {
      key: 'pathA',
      name: 'Night Watch',
      icon: '🦉',
      color: '#7a522c',
      accent: '#f7ead6',
      tagline: 'Perched cliff-top sniper with rooting Overwatch & piercing precision',
      perks: [
        makePerk(
          'owl', 'pathA', 1, 'owl_brass_lens', 'Brass Spectacles', '▲',
          '+1 Range · +2 High Ground DMG',
          'Quill Longbow stretches +1 tile farther and deals +2 extra High Ground damage from elevated tiles!',
          { bonusRange: 1, bonusHighGroundDmg: 2 }
        ),
        makePerk(
          'owl', 'pathA', 2, 'owl_talon_watch', 'Owl Overwatch', '👁️',
          '2× Overwatch (+2 DMG) · Shots Root',
          'Hero Sight fires twice per enemy turn with +2 DMG and pins spotted farmhands with Rooted!',
          { bonusOverwatchShots: 1, bonusOverwatchDmg: 2, overwatchRoots: true },
          'owl_brass_lens'
        ),
        makePerk(
          'owl', 'pathA', 3, 'owl_keen_strike', 'Deadeye Swoop', '🎯',
          '+2 vs Rooted · +2 Flank · Ignore Half Cover',
          'Deal +2 bonus DMG to Rooted targets, +2 Flank Crit, +1 ATK, and bypass Half Cover on flanks!',
          { rootedTargetBonus: 2, bonusFlankCrit: 2, ignoreHalfCoverOnFlank: true, bonusAttack: 1 },
          'owl_talon_watch'
        ),
      ],
    },
    pathB: {
      key: 'pathB',
      name: 'Field Marshal',
      icon: '🪶',
      color: '#2e8a6b',
      accent: '#d8f7ec',
      tagline: 'Squad-wide healing rallies, long-range Assists & uplifting Team-Jumps',
      perks: [
        makePerk(
          'owl', 'pathB', 1, 'owl_feather_balm', 'Satchel Poultice', '💚',
          'Scout Rally +2 Heal & Cleanse · -1 CD',
          'Scout Rally heals +2 more HP, cleanses all debuffs from rallied allies, and recharges faster!',
          { skillHealDelta: 2, cleanseOnSkillCast: true, skillCdDelta: -1 }
        ),
        makePerk(
          'owl', 'pathB', 2, 'owl_updraft_wings', 'Updraft Wings', '🌬️',
          'Allies Jumping Off Owl Heal +4 & Boost',
          'Teammates Team-Jumping off Barnaby heal +4 HP, gain Boosted, and Barnaby gains +1 Move & +1 Jump!',
          { allyJumpHeal: 4, allyJumpBoost: true, bonusMove: 1, bonusJump: 1 },
          'owl_feather_balm'
        ),
        makePerk(
          'owl', 'pathB', 3, 'owl_grand_command', 'Grand Tactician', '⭐',
          'Range-2 Assist (+2) · Rally +1 Radius & Push',
          'Cover teammates with Range-2 Partner Assists (+2 DMG); Scout Rally expands +1 & pushes foes away!',
          { assistRange: 2, bonusAssistDmg: 1, skillRadiusDelta: 1, skillPushes: true, startBoostTurns: 2 },
          'owl_updraft_wings'
        ),
      ],
    },
  },
};

/** Flat registry of all 114 bespoke character perks by ID. */
export const SKILL_PERKS: Record<string, SkillPerkDef> = {};
for (const tree of Object.values(HERO_SKILL_TREES)) {
  for (const perk of [...tree.pathA.perks, ...tree.pathB.perks]) {
    SKILL_PERKS[perk.id] = perk;
  }
}

export const ALL_SKILL_PERK_IDS = Object.keys(SKILL_PERKS);

export function getHeroSkillTree(species: HeroSpecies): HeroSkillTreeDef {
  return HERO_SKILL_TREES[species] ?? HERO_SKILL_TREES.potato;
}

export function getHeroPerkDefs(species: HeroSpecies): SkillPerkDef[] {
  const tree = getHeroSkillTree(species);
  return [...tree.pathA.perks, ...tree.pathB.perks];
}

export function canUnlockPerk(
  unlockedPerkIds: string[],
  skillPoints: number,
  perkId: string,
  heroSpecies?: HeroSpecies
): boolean {
  const def = SKILL_PERKS[perkId];
  if (!def) return false;
  if (heroSpecies && def.species !== heroSpecies) return false;
  if (unlockedPerkIds.includes(perkId)) return false;
  if (skillPoints < def.cost) return false;
  if (def.requires && !unlockedPerkIds.includes(def.requires)) return false;
  return true;
}

/** Sum numeric/boolean perk effects cleanly for any unit or hero. */
export interface AggregatedPerkEffects {
  bonusHp: number;
  bonusMove: number;
  bonusJump: number;
  bonusAttack: number;
  bonusRange: number;
  bonusDashDmg: number;
  bonusCoverDmg: number;
  extraDashes: number;
  extraKnockback: number;
  bonusBumpDmg: number;
  bonusOverwatchShots: number;
  bonusOverwatchDmg: number;
  overwatchRoots: boolean;
  bonusFlankCrit: number;
  ignoreHalfCoverOnFlank: boolean;
  bonusHighGroundDmg: number;
  bonusAssistDmg: number;
  assistRange: number;
  oneShotCover: boolean;
  coverBreakSplash: number;
  jumpStompDmg: number;
  jumpStompBoost: boolean;
  allyJumpHeal: number;
  allyJumpBoost: boolean;
  livingFullCover: boolean;
  startShieldTurns: number;
  startBoostTurns: number;
  thornsDmg: number;
  skillCdDelta: number;
  skillRadiusDelta: number;
  skillHealDelta: number;
  skillDmgDelta: number;
  healOnSkillCast: number;
  cleanseOnSkillCast: boolean;
  skillGrantsFreeMove: boolean;
  skillPushes: boolean;
  dashStatus?: StatusKind;
  dashKnockback: boolean;
  attackStatus?: StatusKind;
  rootedTargetBonus: number;
  burnDetonateBonus: number;
  acidExplosionOnKill: boolean;
  killRefreshesDash: boolean;
  killRefundsCd: boolean;
}

export function aggregatePerkEffects(perkIds?: readonly string[]): AggregatedPerkEffects {
  const out: AggregatedPerkEffects = {
    bonusHp: 0,
    bonusMove: 0,
    bonusJump: 0,
    bonusAttack: 0,
    bonusRange: 0,
    bonusDashDmg: 0,
    bonusCoverDmg: 0,
    extraDashes: 0,
    extraKnockback: 0,
    bonusBumpDmg: 0,
    bonusOverwatchShots: 0,
    bonusOverwatchDmg: 0,
    overwatchRoots: false,
    bonusFlankCrit: 0,
    ignoreHalfCoverOnFlank: false,
    bonusHighGroundDmg: 0,
    bonusAssistDmg: 0,
    assistRange: 1,
    oneShotCover: false,
    coverBreakSplash: 0,
    jumpStompDmg: 0,
    jumpStompBoost: false,
    allyJumpHeal: 0,
    allyJumpBoost: false,
    livingFullCover: false,
    startShieldTurns: 0,
    startBoostTurns: 0,
    thornsDmg: 0,
    skillCdDelta: 0,
    skillRadiusDelta: 0,
    skillHealDelta: 0,
    skillDmgDelta: 0,
    healOnSkillCast: 0,
    cleanseOnSkillCast: false,
    skillGrantsFreeMove: false,
    skillPushes: false,
    dashKnockback: false,
    rootedTargetBonus: 0,
    burnDetonateBonus: 0,
    acidExplosionOnKill: false,
    killRefreshesDash: false,
    killRefundsCd: false,
  };

  if (!perkIds || perkIds.length === 0) return out;
  for (const id of perkIds) {
    const def = SKILL_PERKS[id];
    if (!def) continue;
    const e = def.effects;
    if (e.bonusHp) out.bonusHp += e.bonusHp;
    if (e.bonusMove) out.bonusMove += e.bonusMove;
    if (e.bonusJump) out.bonusJump += e.bonusJump;
    if (e.bonusAttack) out.bonusAttack += e.bonusAttack;
    if (e.bonusRange) out.bonusRange += e.bonusRange;
    if (e.bonusDashDmg) out.bonusDashDmg += e.bonusDashDmg;
    if (e.bonusCoverDmg) out.bonusCoverDmg += e.bonusCoverDmg;
    if (e.extraDashes) out.extraDashes += e.extraDashes;
    if (e.extraKnockback) out.extraKnockback += e.extraKnockback;
    if (e.bonusBumpDmg) out.bonusBumpDmg += e.bonusBumpDmg;
    if (e.bonusOverwatchShots) out.bonusOverwatchShots += e.bonusOverwatchShots;
    if (e.bonusOverwatchDmg) out.bonusOverwatchDmg += e.bonusOverwatchDmg;
    if (e.overwatchRoots) out.overwatchRoots = true;
    if (e.bonusFlankCrit) out.bonusFlankCrit += e.bonusFlankCrit;
    if (e.ignoreHalfCoverOnFlank) out.ignoreHalfCoverOnFlank = true;
    if (e.bonusHighGroundDmg) out.bonusHighGroundDmg += e.bonusHighGroundDmg;
    if (e.bonusAssistDmg) out.bonusAssistDmg += e.bonusAssistDmg;
    if (e.assistRange && e.assistRange > out.assistRange) out.assistRange = e.assistRange;
    if (e.oneShotCover) out.oneShotCover = true;
    if (e.coverBreakSplash) out.coverBreakSplash = Math.max(out.coverBreakSplash, e.coverBreakSplash);
    if (e.jumpStompDmg) out.jumpStompDmg = Math.max(out.jumpStompDmg, e.jumpStompDmg);
    if (e.jumpStompBoost) out.jumpStompBoost = true;
    if (e.allyJumpHeal) out.allyJumpHeal += e.allyJumpHeal;
    if (e.allyJumpBoost) out.allyJumpBoost = true;
    if (e.livingFullCover) out.livingFullCover = true;
    if (e.startShieldTurns) out.startShieldTurns = Math.max(out.startShieldTurns, e.startShieldTurns);
    if (e.startBoostTurns) out.startBoostTurns = Math.max(out.startBoostTurns, e.startBoostTurns);
    if (e.thornsDmg) out.thornsDmg += e.thornsDmg;
    if (e.skillCdDelta) out.skillCdDelta += e.skillCdDelta;
    if (e.skillRadiusDelta) out.skillRadiusDelta += e.skillRadiusDelta;
    if (e.skillHealDelta) out.skillHealDelta += e.skillHealDelta;
    if (e.skillDmgDelta) out.skillDmgDelta += e.skillDmgDelta;
    if (e.healOnSkillCast) out.healOnSkillCast += e.healOnSkillCast;
    if (e.cleanseOnSkillCast) out.cleanseOnSkillCast = true;
    if (e.skillGrantsFreeMove) out.skillGrantsFreeMove = true;
    if (e.skillPushes) out.skillPushes = true;
    if (e.dashStatus) out.dashStatus = e.dashStatus;
    if (e.dashKnockback) out.dashKnockback = true;
    if (e.attackStatus) out.attackStatus = e.attackStatus;
    if (e.rootedTargetBonus) out.rootedTargetBonus += e.rootedTargetBonus;
    if (e.burnDetonateBonus) out.burnDetonateBonus += e.burnDetonateBonus;
    if (e.acidExplosionOnKill) out.acidExplosionOnKill = true;
    if (e.killRefreshesDash) out.killRefreshesDash = true;
    if (e.killRefundsCd) out.killRefundsCd = true;
  }
  return out;
}
