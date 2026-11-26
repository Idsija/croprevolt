export type SkillBranch = 'mobility' | 'firepower' | 'survival';

export interface SkillPerkDef {
  id: string;
  name: string;
  branch: SkillBranch;
  tier: 1 | 2;
  cost: number;
  requires?: string;
  icon: string;
  shortDesc: string;
  description: string;
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

export const SKILL_BRANCH_META: Record<
  SkillBranch,
  { label: string; color: string; accent: string; tagline: string }
> = {
  mobility: {
    label: 'Mobility & Combo',
    color: '#2b8fb3',
    accent: '#d4f3ff',
    tagline: 'Multi-Dash chains, vault distance & Jump Stomps',
  },
  firepower: {
    label: 'Firepower & Watch',
    color: '#c44232',
    accent: '#ffe0da',
    tagline: 'Longer reach, Hero Sight Overwatch & Flank Crits',
  },
  survival: {
    label: 'Grit & Technique',
    color: '#538f34',
    accent: '#dff6d2',
    tagline: 'Tanky husks, rapid cooldowns & Squad Auras',
  },
};

export const SKILL_PERKS: Record<string, SkillPerkDef> = {
  // ===== Branch 1: Mobility & Combo =====
  swift_roots: {
    id: 'swift_roots',
    name: 'Swift Roots',
    branch: 'mobility',
    tier: 1,
    cost: 1,
    icon: '💨',
    shortDesc: '+1 Move & +1 Team-Jump',
    description: 'Gain +1 Move Range and +1 Team-Jump vault range to claim cliffs & flanks.',
  },
  double_dash: {
    id: 'double_dash',
    name: 'Multi-Dash',
    branch: 'mobility',
    tier: 1,
    cost: 1,
    icon: '⚡',
    shortDesc: 'Dash 2 foes/turn · +1 Dash DMG',
    description: 'Dash up to 2 different enemies in a single turn and deal +1 bonus Dash damage!',
  },
  stomp_landing: {
    id: 'stomp_landing',
    name: 'Jump Stomp',
    branch: 'mobility',
    tier: 2,
    cost: 2,
    requires: 'swift_roots',
    icon: '☄️',
    shortDesc: 'Team-Jump 2 AoE Stomp +2 ATK',
    description: 'Landing a Team-Jump deals 2 AoE Stomp damage to adjacent foes & grants +2 ATK this turn.',
  },

  // ===== Branch 2: Firepower & Overwatch =====
  eagle_eye: {
    id: 'eagle_eye',
    name: 'Eagle Sprout',
    branch: 'firepower',
    tier: 1,
    cost: 1,
    icon: '🎯',
    shortDesc: '+1 Weapon Range & +1 DMG',
    description: 'Extend weapon max range by +1 tile and permanently gain +1 Weapon Damage.',
  },
  hero_sight: {
    id: 'hero_sight',
    name: 'Hero Sight+',
    branch: 'firepower',
    tier: 1,
    cost: 1,
    icon: '👁️',
    shortDesc: '2× Overwatch shots · +2 Watch DMG',
    description: 'Hero Sight Overwatch fires up to 2 reaction shots per enemy turn with +2 bonus damage!',
  },
  cover_buster: {
    id: 'cover_buster',
    name: 'Flank Breaker',
    branch: 'firepower',
    tier: 2,
    cost: 2,
    requires: 'eagle_eye',
    icon: '💥',
    shortDesc: '+2 Flank Crit · +4 Cover DMG · Push',
    description: '+2 Critical damage vs. 100% open targets, +4 Cover DMG, and adds Knockback to attacks!',
  },

  // ===== Branch 3: Grit & Technique =====
  hardy_husk: {
    id: 'hardy_husk',
    name: 'Hardy Husk',
    branch: 'survival',
    tier: 1,
    cost: 1,
    icon: '🛡️',
    shortDesc: '+4 Max HP · Start Shielded',
    description: 'Permanently gain +4 Max HP and begin every battle braced with Shield (2 turns).',
  },
  quick_bloom: {
    id: 'quick_bloom',
    name: 'Quick Bloom',
    branch: 'survival',
    tier: 1,
    cost: 1,
    icon: '✨',
    shortDesc: '-1 Skill CD · +2 HP on Cast',
    description: 'Reduce Technique cooldown by 1 turn (min 1) and heal +2 HP whenever you cast it.',
  },
  vanguard_aura: {
    id: 'vanguard_aura',
    name: 'Squad Rally',
    branch: 'survival',
    tier: 2,
    cost: 2,
    requires: 'hardy_husk',
    icon: '🌟',
    shortDesc: 'Jump & adjacent allies get +2 ATK',
    description: 'Allies who Team-Jump off this hero — or start next to them — gain Boosted (+2 ATK)!',
  },
};

export const ALL_SKILL_PERK_IDS = Object.keys(SKILL_PERKS);

export function getPerksForBranch(branch: SkillBranch): SkillPerkDef[] {
  return Object.values(SKILL_PERKS).filter((p) => p.branch === branch);
}

export function canUnlockPerk(
  unlockedIds: string[],
  skillPoints: number,
  perkId: string
): boolean {
  const perk = SKILL_PERKS[perkId];
  if (!perk) return false;
  if (unlockedIds.includes(perkId)) return false;
  if (skillPoints < perk.cost) return false;
  if (perk.requires && !unlockedIds.includes(perk.requires)) return false;
  return true;
}
