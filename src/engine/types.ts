export type Team = 'player' | 'enemy';

export type ProduceFamily = 'root' | 'vine' | 'fruit';
export type ToolFamily = 'digger' | 'blade' | 'sprayer';
export type UnitFamily = ProduceFamily | ToolFamily | 'neutral';

export type MatchupResult = 'advantage' | 'neutral' | 'disadvantage';

export type TerrainType = 'grass' | 'soil' | 'mud' | 'compost' | 'gate' | 'barn_floor';

export type CoverKind = 'none' | 'crate' | 'haystack' | 'stone' | 'thorns' | 'cage';
export type CoverLevel = 'none' | 'half' | 'full';

export type WeaponArc = 'direct' | 'lobbed' | 'melee' | 'pierce';

export type StatusKind = 'burn' | 'rooted' | 'acid' | 'shield' | 'boosted' | 'feared';

export type PromotionTier = 'seedling' | 'ripe' | 'heirloom';

export type ObjectiveType = 'defeat_all' | 'reach_gate' | 'barn_rescue' | 'boss';

export type VisualStyleId = 'papercraft';

export interface GridPos {
  x: number;
  y: number;
}

export interface StatusEffect {
  kind: StatusKind;
  turns: number;
}

export interface CoverObject {
  kind: Exclude<CoverKind, 'none'>;
  level: Exclude<CoverLevel, 'none'>;
  hp: number;
  maxHp: number;
  destructible: boolean;
  isObjectiveCage?: boolean;
  captiveUnitId?: string;
  captiveHero?: RosterHero;
}

export interface Tile {
  x: number;
  y: number;
  terrain: TerrainType;
  cover: CoverObject | null;
}

export interface WeaponDef {
  id: string;
  name: string;
  arc: WeaponArc;
  minRange: number;
  maxRange: number;
  damage: number;
  coverDamage: number;
  aoeRadius?: number;
  appliesStatus?: StatusEffect;
  description: string;
}

export type AbilityTargetType = 'self' | 'ally' | 'enemy' | 'tile' | 'aoe_self';

export interface AbilityDef {
  id: string;
  name: string;
  cooldown: number;
  targetType: AbilityTargetType;
  range: number;
  aoeRadius?: number;
  damage?: number;
  heal?: number;
  appliesStatus?: StatusEffect;
  spawnsCover?: 'thorns';
  description: string;
}

export type HeroSpecies =
  | 'potato'
  | 'pea'
  | 'lemon'
  | 'chili'
  | 'carrot'
  | 'blackberry'
  | 'pig'
  | 'rooster'
  | 'sheep'
  | 'goat';

export interface ProduceBlueprint {
  id: string;
  name: string;
  species: HeroSpecies;
  title: string;
  family: ProduceFamily;
  isAnimal?: boolean;
  coopPassive?: string;
  ignoresMud?: boolean;
  livingHalfCover?: boolean;
  launchpadCoop?: boolean;
  maxHp: number;
  moveRange: number;
  jumpRange: number;
  dashDamage: number;
  dashStatus?: StatusEffect;
  weapon: WeaponDef;
  ability: AbilityDef;
  color: string;
  accentColor: string;
  blurb: string;
}

export interface EnemyBlueprint {
  id: string;
  name: string;
  archetype: 'digger' | 'trimmer' | 'sprayer' | 'mower' | 'scarecrow';
  title: string;
  family: ToolFamily;
  isBoss?: boolean;
  maxHp: number;
  moveRange: number;
  dashDamage: number;
  weapon: WeaponDef;
  ability?: AbilityDef;
  color: string;
  accentColor: string;
  blurb: string;
}

export type GraftEffectKind =
  | 'dash_burn'
  | 'thorn_recoil'
  | 'pumpkin_rind'
  | 'spring_sprout'
  | 'citrus_shred'
  | 'root_anchor'
  | 'sweet_nectar'
  | 'spicy_shot';

export interface GraftDef {
  id: string;
  name: string;
  effect: GraftEffectKind;
  badgeColor: string;
  badgeIcon: string;
  description: string;
  bonusMaxHp?: number;
  bonusAttack?: number;
  bonusDash?: number;
  bonusJump?: number;
  bonusMove?: number;
  bonusCoverDamage?: number;
}

export type RelicEffectKind =
  | 'rich_loam'
  | 'splintering_compost'
  | 'bouncy_mulch'
  | 'heirloom_fertilizer'
  | 'sharp_trowel'
  | 'lucky_clover';

export interface RelicDef {
  id: string;
  name: string;
  effect: RelicEffectKind;
  color: string;
  icon: string;
  description: string;
}

export interface ItemDef {
  id: string;
  name: string;
  targetType: 'ally' | 'tile';
  range: number;
  aoeRadius: number;
  heal?: number;
  damage?: number;
  coverDamage?: number;
  appliesStatus?: StatusEffect;
  color: string;
  icon: string;
  description: string;
}

export interface RosterHero {
  uid: string;
  blueprintId: string;
  name: string;
  species: HeroSpecies;
  title: string;
  family: ProduceFamily;
  isAnimal?: boolean;
  coopPassive?: string;
  ignoresMud?: boolean;
  livingHalfCover?: boolean;
  launchpadCoop?: boolean;
  hp: number;
  maxHp: number;
  moveRange: number;
  jumpRange: number;
  dashDamage: number;
  dashStatus?: StatusEffect;
  weapon: WeaponDef;
  ability: AbilityDef;
  graftIds: string[];
  tier: PromotionTier;
  harvested: boolean; // Bagged by farmers until rescued at Barn Raid!
  color: string;
  accentColor: string;
}

export interface UnitActions {
  hasMoved: boolean;
  hasDashed: boolean;
  hasJumped: boolean;
  hasAttacked: boolean;
  hasUsedSkill: boolean;
}

export type EnemyVisualKind = EnemyBlueprint['archetype'] | 'digger_heavy';

export interface BattleUnit {
  id: string;
  rosterUid?: string;
  blueprintId: string;
  team: Team;
  name: string;
  title: string;
  visualKind: ProduceBlueprint['species'] | EnemyVisualKind;
  family: UnitFamily;
  isBoss?: boolean;
  pos: GridPos;
  facing: 'left' | 'right';
  hp: number;
  maxHp: number;
  moveRange: number;
  jumpRange: number;
  dashDamage: number;
  dashStatus?: StatusEffect;
  weapon: WeaponDef;
  ability?: AbilityDef;
  abilityCooldown: number;
  graftIds: string[];
  isAnimal?: boolean;
  coopPassive?: string;
  ignoresMud?: boolean;
  livingHalfCover?: boolean;
  launchpadCoop?: boolean;
  tier: PromotionTier;
  statuses: StatusEffect[];
  actions: UnitActions;
  tempAttackBonus: number;
  alive: boolean;
  color: string;
  accentColor: string;
}

export interface CombatForecast {
  attackerId: string;
  targetUnitId?: string;
  targetPos: GridPos;
  hitChance: number; // 100, 50, or 0
  coverLevel: CoverLevel;
  coverPos?: GridPos;
  matchup: MatchupResult;
  baseDamage: number;
  finalDamage: number;
  coverDamage: number;
  isLethal: boolean;
  appliesStatus?: StatusKind;
  canAttack: boolean;
  reason?: string;
}

export interface JumpOption {
  dest: GridPos;
  allyId: string;
  allyPos: GridPos;
  approachPos: GridPos;
}

export interface DashOption {
  enemyId: string;
  enemyPos: GridPos;
  stopPos: GridPos;
  damage: number;
  appliesStatus?: StatusKind;
}

export type BattleEvent =
  | { type: 'move'; unitId: string; path: GridPos[] }
  | { type: 'dash'; unitId: string; targetId: string; from: GridPos; to: GridPos; targetPos: GridPos; damage: number; status?: StatusKind }
  | { type: 'jump'; unitId: string; allyPos: GridPos; from: GridPos; to: GridPos }
  | { type: 'attack'; attackerId: string; from: GridPos; to: GridPos; arc: WeaponArc; hit: boolean; damage: number; targetId?: string; matchup: MatchupResult; coverHitPos?: GridPos; coverDestroyed?: boolean; status?: StatusKind }
  | { type: 'ability'; unitId: string; abilityName: string; from: GridPos; to: GridPos; affectedIds: string[]; heal?: number; damage?: number; status?: StatusKind; coverSpawned?: GridPos }
  | { type: 'item'; unitId: string; itemName: string; from: GridPos; to: GridPos; affectedIds: string[]; heal?: number; damage?: number; status?: StatusKind }
  | { type: 'status_tick'; unitId: string; pos: GridPos; status: StatusKind; damage: number }
  | { type: 'heal'; unitId: string; pos: GridPos; amount: number; source: string }
  | { type: 'cover_break'; pos: GridPos; kind: Exclude<CoverKind, 'none'>; splashDamage?: number }
  | { type: 'rescue'; pos: GridPos; unitName: string }
  | { type: 'unit_ko'; unitId: string; pos: GridPos; team: Team; unitName: string }
  | { type: 'banner'; text: string; tone: 'player' | 'enemy' | 'victory' | 'defeat' };

export interface MapTemplate {
  id: string;
  name: string;
  subtitle: string;
  objective: ObjectiveType;
  objectiveLabel: string;
  width: number;
  height: number;
  tiles: Array<{
    x: number;
    y: number;
    terrain?: TerrainType;
    cover?: Exclude<CoverKind, 'none'>;
  }>;
  playerSpawns: GridPos[];
  enemySpawns: Array<{
    blueprintId: string;
    x: number;
    y: number;
  }>;
  gateTiles?: GridPos[];
  cagePos?: GridPos;
}

export type BattleStatus = 'ongoing' | 'victory' | 'defeat';

export interface BattleState {
  mapId: string;
  mapName: string;
  objective: ObjectiveType;
  objectiveLabel: string;
  width: number;
  height: number;
  tiles: Tile[][];
  units: BattleUnit[];
  turn: number;
  phase: Team;
  status: BattleStatus;
  relicIds: string[];
  items: Record<string, number>;
  gateTiles: GridPos[];
  rescuedHeroUids: string[];
  rescuedNewBlueprintIds: string[];
  combatLog: string[];
  pendingEvents: BattleEvent[];
  undoSnapshot: string | null;
}

export type NodeType = 'skirmish' | 'escape' | 'vault' | 'barn_rescue' | 'elite' | 'boss';

export interface SeasonNode {
  id: string;
  stage: number; // 0..3
  lane: number; // 0 = top/only, 1 = bottom
  type: NodeType;
  name: string;
  subtitle: string;
  mapId?: string;
  nextIds: string[];
  completed: boolean;
}

export interface RewardBundle {
  seedsEarned: number;
  graftChoices: string[];
  relicChoices: string[];
  recruitChoices: string[];
  itemGrant?: { itemId: string; count: number };
  freeHealAmount?: number;
  claimedGraft: boolean;
  claimedRelic: boolean;
  claimedRecruit: boolean;
}

export interface RunState {
  id: string;
  seasonName: string;
  nodes: SeasonNode[];
  currentNodeId: string | null;
  completedNodeIds: string[];
  roster: RosterHero[];
  activeSquadUids: string[];
  relicIds: string[];
  items: Record<string, number>;
  seeds: number;
  battlesWon: number;
  enemiesDefeated: number;
  pendingReward: RewardBundle | null;
  status: 'map' | 'battle' | 'vault' | 'reward' | 'victory' | 'defeat';
}

export interface MetaProgress {
  heirloomSeeds: number;
  runsPlayed: number;
  runsWon: number;
  unlocks: {
    extraItemSatchel: boolean; // +1 Fertilizer Bomb & +1 Watering Can at run start
    heirloomSoil: boolean; // All starter heroes begin with +2 Max HP
    starterRelic: boolean; // Start every run with Rich Loam relic
  };
}
