export type Team = 'player' | 'enemy';

export type ProduceFamily = 'root' | 'vine' | 'fruit';
export type ToolFamily = 'digger' | 'blade' | 'sprayer';
export type UnitFamily = ProduceFamily | ToolFamily | 'neutral';

export type MatchupResult = 'advantage' | 'neutral' | 'disadvantage';

export type TerrainType =
  | 'grass'
  | 'soil'
  | 'mud'
  | 'compost'
  | 'gate'
  | 'barn_floor'
  | 'sunbeam'
  | 'water'
  | 'bridge'
  | 'lava'
  | 'ramp'
  | 'burrow'
  | 'bounce_pad';

export type CoverKind = 'none' | 'crate' | 'haystack' | 'stone' | 'thorns' | 'cage' | 'beehive' | 'sprinkler' | 'pumpkin';
export type CoverLevel = 'none' | 'half' | 'full';

export type WeaponArc = 'direct' | 'lobbed' | 'melee' | 'pierce';

export type StatusKind = 'burn' | 'rooted' | 'acid' | 'shield' | 'boosted' | 'feared' | 'overwatch';

export type PromotionTier = 'seedling' | 'ripe' | 'heirloom';

export type ObjectiveType = 'defeat_all' | 'reach_gate' | 'barn_rescue' | 'boss' | 'survive' | 'escort';

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
  /** Stepped diorama height: 0 = ground/river, 1 = raised terrace, 2 = high bluff. */
  elevation: number;
  cover: CoverObject | null;
  /** Collapsible wooden bridge durability (collapses into water/lava at 0 HP!). */
  bridgeHp?: number;
  bridgeMaxHp?: number;
  bridgeOver?: 'water' | 'lava';
}

export interface WeaponDef {
  id: string;
  name: string;
  arc: WeaponArc;
  minRange: number;
  maxRange: number;
  damage: number;
  coverDamage: number;
  knockback?: number;
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
  knockback?: number;
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
  | 'corn'
  | 'lettuce'
  | 'strawberry'
  | 'mushroom'
  | 'cow'
  | 'pig'
  | 'rooster'
  | 'sheep'
  | 'goat'
  | 'duck';

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
  dashKnockback?: number;
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
  archetype:
    | 'digger'
    | 'trimmer'
    | 'sprayer'
    | 'mower'
    | 'beekeeper'
    | 'hound'
    | 'pitchfork'
    | 'scarecrow'
    | 'tractor'
    | 'harvester';
  title: string;
  family: ToolFamily;
  isBoss?: boolean;
  startsShielded?: boolean;
  maxHp: number;
  moveRange: number;
  dashDamage: number;
  dashKnockback?: number;
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
  dashKnockback?: number;
  dashStatus?: StatusEffect;
  weapon: WeaponDef;
  equippedWeaponId?: string;
  ability: AbilityDef;
  graftIds: string[];
  level: number;
  xp: number;
  skillPoints: number;
  perkIds: string[];
  tier: PromotionTier;
  harvested: boolean; // Bagged by farmers until rescued at Barn Raid!
  color: string;
  accentColor: string;
}

export interface UnitActions {
  hasMoved: boolean;
  hasDashed: boolean;
  dashesUsed?: number;
  dashedEnemyIds?: string[];
  hasJumped: boolean;
  hasAttacked: boolean;
  hasUsedSkill: boolean;
  overwatchCharges?: number;
}

export type EnemyVisualKind = EnemyBlueprint['archetype'] | 'digger_heavy';

export interface BattleUnit {
  id: string;
  rosterUid?: string;
  blueprintId: string;
  team: Team;
  name: string;
  title: string;
  visualKind: ProduceBlueprint['species'] | EnemyVisualKind | 'seed_cart';
  family: UnitFamily;
  isBoss?: boolean;
  /** True for the autonomous Golden Seed Cart objective ally on Escort missions. */
  isEscortCart?: boolean;
  /** Elite-fight promotion: tougher, hits harder, starts shielded. */
  isVeteran?: boolean;
  pos: GridPos;
  facing: 'left' | 'right';
  hp: number;
  maxHp: number;
  moveRange: number;
  jumpRange: number;
  dashDamage: number;
  dashKnockback?: number;
  dashStatus?: StatusEffect;
  weapon: WeaponDef;
  ability?: AbilityDef;
  abilityCooldown: number;
  graftIds: string[];
  level?: number;
  perkIds?: string[];
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
  knockbackDir?: GridPos;
  knockbackWillBump?: boolean;
  knockbackHazard?: 'bump' | 'water' | 'lava' | 'drop';
  elevationDiff?: number;
  highGroundBonus?: number;
  isCriticalFlank?: boolean;
  /** Mario + Rabbids Partner Follow-Up Assist when an ally is adjacent to the enemy! */
  partnerAssistDamage?: number;
  partnerAssistUnitId?: string;
  partnerAssistUnitName?: string;
  /** True when aiming directly at a collapsible wooden bridge tile. */
  isBridgeTarget?: boolean;
  /** True when aiming directly at a Rolling Pumpkin Boulder. */
  isPumpkinTarget?: boolean;
  pumpkinRollDir?: GridPos;
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
  knockback?: number;
  appliesStatus?: StatusKind;
}

export type BattleEvent =
  | { type: 'move'; unitId: string; path: GridPos[] }
  | { type: 'dash'; unitId: string; targetId: string; from: GridPos; to: GridPos; targetPos: GridPos; damage: number; status?: StatusKind }
  | { type: 'jump'; unitId: string; allyPos: GridPos; from: GridPos; to: GridPos; coopBoost?: string }
  | { type: 'bounce_launch'; unitId: string; from: GridPos; to: GridPos }
  | { type: 'stomp'; unitId: string; pos: GridPos; damage: number; hitIds: string[] }
  | { type: 'overwatch_shot'; attackerId: string; attackerKind: string; targetId: string; from: GridPos; to: GridPos; damage: number }
  | { type: 'partner_assist'; allyId: string; allyKind: string; targetId: string; from: GridPos; to: GridPos; damage: number }
  | { type: 'knockback'; unitId: string; from: GridPos; to: GridPos; bumped: boolean; bumpDamage?: number; bumpedUnitId?: string }
  | { type: 'terrain_hazard'; kind: 'water' | 'lava' | 'drop'; unitId: string; pos: GridPos; damage: number }
  | { type: 'hazard'; kind: 'beehive' | 'sprinkler'; pos: GridPos; damage: number }
  | { type: 'pumpkin_roll'; from: GridPos; to: GridPos; path: GridPos[]; hitIds: string[]; damage: number }
  | { type: 'bridge_collapse'; pos: GridPos; liquid: 'water' | 'lava'; affectedUnitId?: string }
  | { type: 'reinforcement_spawn'; unitId: string; unitName: string; pos: GridPos }
  | { type: 'escort_move'; unitId: string; from: GridPos; to: GridPos }
  | { type: 'attack'; attackerId: string; attackerKind: string; from: GridPos; to: GridPos; arc: WeaponArc; hit: boolean; damage: number; targetId?: string; matchup: MatchupResult; coverHitPos?: GridPos; coverDestroyed?: boolean; status?: StatusKind }
  | { type: 'ability'; unitId: string; abilityName: string; from: GridPos; to: GridPos; affectedIds: string[]; heal?: number; damage?: number; status?: StatusKind; coverSpawned?: GridPos }
  | { type: 'item'; unitId: string; itemName: string; from: GridPos; to: GridPos; affectedIds: string[]; heal?: number; damage?: number; status?: StatusKind }
  | { type: 'status_tick'; unitId: string; pos: GridPos; status: StatusKind; damage: number }
  | { type: 'heal'; unitId: string; pos: GridPos; amount: number; source: string }
  | { type: 'cover_break'; pos: GridPos; kind: Exclude<CoverKind, 'none'>; splashDamage?: number }
  | { type: 'rescue'; pos: GridPos; unitName: string }
  | { type: 'burrow_warp'; unitId: string; from: GridPos; to: GridPos }
  | { type: 'boss_phase'; bossId: string; bossName: string; phase: 2; pos: GridPos }
  | { type: 'boss_telegraph_strike'; bossId: string; name: string; tiles: GridPos[]; hitIds: string[]; damage: number }
  | { type: 'unit_ko'; unitId: string; pos: GridPos; team: Team; unitName: string }
  | { type: 'banner'; text: string; tone: 'player' | 'enemy' | 'victory' | 'defeat' };

export interface BossTelegraph {
  bossId: string;
  name: string;
  tiles: GridPos[];
  damage: number;
  status?: StatusKind;
}

export type BoardTheme = 'spring' | 'greenhouse' | 'autumn';

export interface MapTemplate {
  id: string;
  name: string;
  subtitle: string;
  theme?: BoardTheme;
  objective: ObjectiveType;
  objectiveLabel: string;
  width: number;
  height: number;
  tiles: Array<{
    x: number;
    y: number;
    terrain?: TerrainType;
    elevation?: number;
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
  burrowPairs?: Array<[GridPos, GridPos]>;
  /** Number of turns to survive on 'survive' maps (default 4). */
  surviveTurns?: number;
  /** Starting tile for the Golden Seed Cart on 'escort' maps. */
  escortStartPos?: GridPos;
}

export type BattleStatus = 'ongoing' | 'victory' | 'defeat';

export interface BattleState {
  mapId: string;
  mapName: string;
  theme?: BoardTheme;
  objective: ObjectiveType;
  objectiveLabel: string;
  width: number;
  height: number;
  tiles: Tile[][];
  units: BattleUnit[];
  turn: number;
  phase: Team;
  status: BattleStatus;
  /** Pre-Battle Tactical Prep Phase: rearrange spawn positions & swap bench heroes before Turn 1 starts. */
  prepPhase?: boolean;
  playerSpawnPositions?: GridPos[];
  /** Number of turns to hold on 'survive' objective maps. */
  surviveTurns?: number;
  /** Harvest Heat ascension level (0-5) active in this battle. */
  harvestHeat?: number;
  relicIds: string[];
  items: Record<string, number>;
  gateTiles: GridPos[];
  burrowPairs?: Array<[GridPos, GridPos]>;
  bossPhase?: 1 | 2;
  bossTelegraphs?: BossTelegraph[];
  rescuedHeroUids: string[];
  rescuedNewBlueprintIds: string[];
  combatLog: string[];
  pendingEvents: BattleEvent[];
  undoSnapshot: string | null;
}

export type SeasonId = 'spring' | 'summer' | 'autumn';

export type NodeType =
  | 'start'
  | 'skirmish'
  | 'escape'
  | 'vault'
  | 'shop'
  | 'barn_rescue'
  | 'elite'
  | 'boss'
  | 'event'
  | 'shrine'
  | 'armory';

export interface SeasonNode {
  id: string;
  stage: number; // progression depth (0 = start, max = boss)
  lane: number; // column 0..MAX_LANES-1 (preserved for compact layout/fallback)
  /** Normalized 0..1 coordinates on the seasonal hand-painted watercolor boardgame map. */
  boardX?: number;
  boardY?: number;
  /** Optional scenic road/district tag shown on hover/stop card (e.g. 'Pumpkin Hollow'). */
  region?: string;
  type: NodeType;
  name: string;
  subtitle: string;
  mapId?: string;
  nextIds: string[];
  /** Optional scenic shortcut/cross-road connections for multi-step boardgame movement. */
  shortcutIds?: string[];
  completed: boolean;
}

export type TravelCardBonus = 'heal2' | 'seeds3' | 'boost' | 'flex';

export interface BoardTravelCard {
  id: string;
  name: string;
  steps: number; // 1, 2, or 3 spaces along the board paths
  /** If true, card can stop 1..steps spaces away (flexible shortcut stride). */
  flexible?: boolean;
  bonus: TravelCardBonus;
  icon: string;
  desc: string;
  tint: 'mint' | 'gold' | 'crimson' | 'plum';
}

export interface MarketOffer {
  id: string;
  kind: 'graft' | 'item' | 'heal' | 'rescue' | 'weapon';
  title: string;
  desc: string;
  icon: string;
  cost: number;
  graftId?: string;
  itemId?: string;
  weaponUnlockId?: string;
  purchased: boolean;
}

export interface HeroLevelUpSummary {
  heroUid: string;
  heroName: string;
  blueprintId: string;
  species?: HeroSpecies;
  oldLevel: number;
  newLevel: number;
  skillPointsGained: number;
  bonusHp: number;
  bonusAttack: number;
}

export interface RewardBundle {
  seedsEarned: number;
  xpEarned?: number;
  levelUps?: HeroLevelUpSummary[];
  graftChoices: string[];
  relicChoices: string[];
  recruitChoices: string[];
  weaponChoices?: string[];
  itemGrant?: { itemId: string; count: number };
  freeHealAmount?: number;
  marketOffers?: MarketOffer[];
  claimedGraft: boolean;
  claimedRelic: boolean;
  claimedRecruit: boolean;
  claimedWeapon?: boolean;
}

export interface RunState {
  id: string;
  seasonId?: SeasonId;
  seasonName: string;
  /** 0-based index into ACTS. Older saves lack it and are migrated on load. */
  act: number;
  /** Seed for the procedural map, so a run can be reproduced (e.g. a daily run). */
  seed: number;
  /** Harvest Heat Ascension Level (0-5). */
  harvestHeat?: number;
  /** 'daily' runs share one seed per UTC day and start from the standard loadout. */
  mode?: 'standard' | 'daily';
  /** UTC date (YYYY-MM-DD) of the daily run this is. */
  dailyKey?: string;
  /** Battle turns spent across all won and lost battles; feeds the score's speed bonus. */
  battleTurns?: number;
  /** Unlocked alternate weapon IDs swappable anytime in the Hero Build Armory. */
  unlockedWeaponIds?: string[];
  nodes: SeasonNode[];
  currentNodeId: string | null;
  completedNodeIds: string[];
  /** Boardgame Travel Hand (3 watercolor movement cards drawn per board turn). */
  travelHand?: BoardTravelCard[];
  /** Number of board turns taken in the current Act. */
  boardTurn?: number;
  /** Harvest Bell countdown limit before Farmers reinforce the Act Boss. */
  harvestBellLimit?: number;
  /** One-battle buff granted by a Travel Card or Watering Shrine (consumed on next battle start). */
  nextBattleBuff?: { boost?: boolean; shield?: boolean; moveBonus?: number } | null;
  /** Active Watering Shrine blessing picker when standing on a Shrine space. */
  pendingShrine?: { nodeId: string; claimed: boolean } | null;
  roster: RosterHero[];
  activeSquadUids: string[];
  relicIds: string[];
  items: Record<string, number>;
  seeds: number;
  battlesWon: number;
  enemiesDefeated: number;
  pendingReward: RewardBundle | null;
  status: 'map' | 'battle' | 'vault' | 'shop' | 'reward' | 'event' | 'shrine' | 'victory' | 'defeat';
  /** The "?" event currently open, if any. */
  pendingEvent?: { eventId: string; outcome: string[] | null; choiceIndex: number | null } | null;
  /** Events already met this run, so they don't repeat. */
  seenEventIds?: string[];
  /** Max-HP bonus new recruits get (Heirloom Soil unlock). */
  recruitBonusHp?: number;
}

export interface MetaProgress {
  heirloomSeeds: number;
  runsPlayed: number;
  runsWon: number;
  /** Highest Harvest Heat (0-5) unlocked by winning runs (0 = Heat 0..1 unlocked or 0..5). */
  maxHeatUnlocked?: number;
  selectedHeat?: number;
  unlocks: {
    extraItemSatchel: boolean; // +1 Fertilizer Bomb & +1 Watering Can at run start
    heirloomSoil: boolean; // All starter heroes begin with +2 Max HP
    starterRelic: boolean; // Start every run with Rich Loam relic
  };
}
