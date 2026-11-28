import type { SeasonId, HeroSpecies } from '../engine/types';

export interface SeasonWeatherInfo {
  seasonId: SeasonId;
  name: string;
  icon: string;
  badgeColor: string;
  shortRule: string;
  detail: string;
}

export interface SeasonActIntro {
  seasonId: SeasonId;
  actNumber: number;
  chapterTitle: string;
  subtitle: string;
  storybookParagraph: string;
  bossName: string;
  bossQuote: string;
  weatherTip: string;
}

export interface LoreChronicleEntry {
  id: string;
  seasonId: SeasonId;
  order: number;
  title: string;
  region: string;
  icon: string;
  body: string;
  tacticalNote: string;
}

export interface FactionDossier {
  id: string;
  name: string;
  icon: string;
  accent: string;
  motto: string;
  summary: string;
}

export const SEASON_WEATHER_INFO: Record<SeasonId, SeasonWeatherInfo> = {
  spring: {
    seasonId: 'spring',
    name: 'Pollen Breeze',
    icon: '🌸',
    badgeColor: '#5ea342',
    shortRule: 'Compost +3 HP · Jump Momentum',
    detail: 'Warm spring updrafts supercharge Compost beds (+3 HP/turn instead of +2) and add extra spring to every Team-Jump!',
  },
  summer: {
    seasonId: 'summer',
    name: 'Sunlit Heatwave',
    icon: '☀️',
    badgeColor: '#d98a1c',
    shortRule: 'Sunbeams +3 ATK · Burn +1 DMG',
    detail: 'Blazing greenhouse glass turns every golden Sunbeam tile into a +3 ATK spotlight and makes Burn scorch foes for +1 extra damage!',
  },
  autumn: {
    seasonId: 'autumn',
    name: 'Harvest Gale',
    icon: '🍂',
    badgeColor: '#bf5424',
    shortRule: 'Push & Pull +1 Bump DMG',
    detail: 'Gusty orchard winds amplify every Shove, Vacuum Duster yank, and wall collision for +1 extra Bump damage!',
  },
  winter: {
    seasonId: 'winter',
    name: 'Deep Frost',
    icon: '❄️',
    badgeColor: '#3b82b8',
    shortRule: 'Ice Slides +1 · Frost -2 Move',
    detail: 'Glazed Ice sheets extend Knockbacks and Vacuum Pulls by +1 sliding tile, while Frost chills farm machines (-2 Move & +1 melee/gimmick DMG taken)!',
  },
};

export const SEASON_ACT_INTROS: Record<SeasonId, SeasonActIntro> = {
  spring: {
    seasonId: 'spring',
    actNumber: 1,
    chapterTitle: 'Chapter I · Sproutmeadow Awakening',
    subtitle: 'The Fence Is Broken. The Vegetables Have Weapons.',
    storybookParagraph:
      'For decades, Old Barnaby’s farmhands picked the patch without ever asking the turnips how they felt about soup. On the first warm morning of Spring, Stitch the spotted cow kicked open the tool-shed latch, Snap-Pea rigged a garden vacuum into a tactical Duster, and the Great Harvest Rebellion marched down Rose Garden Gate.',
    bossName: 'Captain Scarecrow',
    bossQuote: '“Get back in the wheelbarrow before I stuff ye in a burlap sack!”',
    weatherTip: 'Compost beds heal +3 HP/turn — bounce off allies to flank the haystacks!',
  },
  summer: {
    seasonId: 'summer',
    actNumber: 2,
    chapterTitle: 'Chapter II · The Sunlit Conservatory',
    subtitle: 'Brass Canals, Angry Bees & Baron Combine’s Glass Empire',
    storybookParagraph:
      'Word of the Sproutmeadow jailbreak drifted upriver to the Grand Conservatory—a gleaming glass fortress where Baron Combine hoards heirloom sunlight behind brick canals and humming beehives. Armed with dual-slot gimmicks and fresh Forge blueprints, the produce-and-barnyard brigade crosses the arched bridges into high summer.',
    bossName: 'Baron Combine',
    bossQuote: '“HRRRM-CHUGGA! Nobody leaves the glasshouse un-threshed!”',
    weatherTip: 'Stand in golden Sunbeams for +3 ATK and pop Beehives onto clustered machines!',
  },
  autumn: {
    seasonId: 'autumn',
    actNumber: 3,
    chapterTitle: 'Chapter III · The Cider Mill Tithe',
    subtitle: 'Rolling Pumpkins & Lord Bramblecoat’s Crimson Keep',
    storybookParagraph:
      'As the maple leaves blaze gold, the Farmers’ Guild rolls out their heavy cider presses and clockwork drill-tanks along Pumpkin Hollow. Every bridge across Mill Creek is booby-trapped, every orchard ridge bristling with scythe-bearing wardens—yet the autumn wind itself seems eager to shove farm contraptions straight into the brook.',
    bossName: 'Lord Bramblecoat',
    bossQuote: '“The autumn tithe is due, little sprouts—and my scythe collects in full!”',
    weatherTip: 'Every Knockback & Vacuum Pull deals +1 extra Bump DMG—aim for walls and creeks!',
  },
  winter: {
    seasonId: 'winter',
    actNumber: 4,
    chapterTitle: 'Chapter IV · Siege of the Frostbite Hearth',
    subtitle: 'Frozen Creeks, Steam Snowplows & The Final Greenhouse',
    storybookParagraph:
      'Deep winter blankets the valley, and the Farmers’ grand boiler-citadel—the Hearth Greenhouse—keeps every stolen Heirloom Seed locked behind ice-glazed moats and chugging iron snowplows. Led by the towering locomotive contraption Grand Marshal Frostplow, the winter garrison thinks frost will freeze the rebellion cold. They forgot how far a sliding snowplow skids on glare ice.',
    bossName: 'Grand Marshal Frostplow',
    bossQuote: '“CHOO-CHILL! All sprouts into the cold-cellar, on the double!”',
    weatherTip: 'Shove or Vacuum-Pull enemies across Ice tiles to slide them +1 extra tile into hazards!',
  },
};

export const WORLD_LORE_CHRONICLES: LoreChronicleEntry[] = [
  // SPRING (4)
  {
    id: 'lore_spring_1',
    seasonId: 'spring',
    order: 1,
    title: 'The Midnight Latch Decree',
    region: 'Rose Garden Gate',
    icon: '📜',
    body: 'Scratched into the underside of a watering trough in neat hoof-and-stem handwriting: “Article 1: No root, vine, fruit, or barnyard friend shall be turned into stew without written consent. Article 2: Whoever finds the farmer’s leaf-blower gets to keep it.”',
    tacticalNote: 'Tip: Swap between your Ranged Weapon and Secondary Melee/Gimmick freely with [W] before firing!',
  },
  {
    id: 'lore_spring_2',
    seasonId: 'spring',
    order: 2,
    title: 'Why the Barnyard Joined the Crops',
    region: 'Duck Pond Overlook',
    icon: '🐄',
    body: 'Stitch the cow, Cluck Norris, and Quackers never trusted the farmers’ sudden obsession with clockwork contraptions. The morning Rusty Mower chased Woolly Bulwark around the clover hill for a “free haircut,” the Barnyard Alliance signed the Sprout Pact before breakfast.',
    tacticalNote: 'Tip: Barnyard allies bring unique Co-Op passives—Stitch & Woolly provide living cover, Cluck launches jumps +2 tiles!',
  },
  {
    id: 'lore_spring_3',
    seasonId: 'spring',
    order: 3,
    title: 'Blueprints of the Dew Duster',
    region: 'Blossom Crest',
    icon: '🌪️',
    body: 'Crumpled parchment pinned to a wooden signpost shows Snap-Pea’s diagram for reversing a brass pollen-blower into a suction cannon. Marginalia reads: “Works great on crates! Accidentally sucked Barnaby’s spectacles right off his beak—add safety grate.”',
    tacticalNote: 'Tip: Vacuum Dusters & Grapple Whips yank hunkered enemies straight OUT of Full Cover so teammates can flank!',
  },
  {
    id: 'lore_spring_4',
    seasonId: 'spring',
    order: 4,
    title: 'Captain Scarecrow’s Straw Ledger',
    region: 'Red Storybook Barn',
    icon: '🎃',
    body: 'Captain Scarecrow wasn’t always grumpy—until a flock of unruly radishes stole his favorite brass pocketwatch. Now he commands the Spring Patch from atop the barn bales, furiously flinging straw at anything leafy that dares cross the north arch bridge.',
    tacticalNote: 'Tip: Step off red Boss Warning tiles before ending your turn—or shove minions right into the blast!',
  },

  // SUMMER (4)
  {
    id: 'lore_summer_1',
    seasonId: 'summer',
    order: 5,
    title: 'The Great Sunbeam Tariff',
    region: 'South Fountain Walk',
    icon: '☀️',
    body: 'An embossed Conservatory notice declares all midday sunshine the sole property of Baron Combine. Zestia the lemon painted a giant sour smiley face over the Baron’s seal and wrote beneath it: “Try taxing citrus, tin-can.”',
    tacticalNote: 'Tip: In Summer Heatwave, standing on a golden Sunbeam tile boosts attacks by +3 ATK!',
  },
  {
    id: 'lore_summer_2',
    seasonId: 'summer',
    order: 6,
    title: 'Apiary Safety Warning #42',
    region: 'Canal Terrace',
    icon: '🐝',
    body: 'Beekeeper Bert’s clipboard warns farmhands never to jostle the wooden apiary boxes near the brick bridges. Unfortunately for Bert, Corn-elius’ Popcorn Mortar and Strawbina’s Seed Scattergun were practically invented for jostling boxes.',
    tacticalNote: 'Tip: Shoot Beehives or Sprinklers to trigger 3×3 chain splashes that shred Shielded contraptions!',
  },
  {
    id: 'lore_summer_3',
    seasonId: 'summer',
    order: 7,
    title: 'Tinker Wagon Forge Notes',
    region: 'Rustic Market Awning',
    icon: '⚒️',
    body: 'An itinerant hedgehog-shaped weathervane (purely brass, zero animals harmed) marks the rebellion’s hidden Forge Wagon. By bolting copper barrels or ember-pepper canisters onto garden gear, any hero can evolve both weapons along Tactical or Elemental paths!',
    tacticalNote: 'Tip: Visit Weapon Forges or open Squad → Armory to upgrade Primary & Secondary weapons to Tier II & Tier III!',
  },
  {
    id: 'lore_summer_4',
    seasonId: 'summer',
    order: 8,
    title: 'Baron Combine’s Steam Manifesto',
    region: 'Grand Glasshouse Dome',
    icon: '🚜',
    body: 'Baron Combine was built in 1924 to harvest wheat politely, until someone accidentally filled his radiator with double-espresso cider. Ever since, he has roared through the Conservatory convinced every melon and cow is “overdue for baling.”',
    tacticalNote: 'Tip: Fruits deal +30% bonus damage to Blade enemies like Baron Combine!',
  },

  // AUTUMN (4)
  {
    id: 'lore_autumn_1',
    seasonId: 'autumn',
    order: 9,
    title: 'The Cider Mill Ballistics Manual',
    region: 'Cider Mill Footbridge',
    icon: '🍎',
    body: 'Patch the pumpkin knight discovered that prize-winning autumn gourds roll remarkably straight down cobblestone hills. Three test runs later, the Cider Mill’s wooden gate had been converted into decorative kindling.',
    tacticalNote: 'Tip: Shoot or Dash into Rolling Pumpkin Boulders to bowl straight through lines of farmhands!',
  },
  {
    id: 'lore_autumn_2',
    seasonId: 'autumn',
    order: 10,
    title: 'Gale-O-Matic Recall Notice',
    region: 'Barn Meadow Plaza',
    icon: '💨',
    body: 'Factory bulletin from Iron-Shed Workshops: “Model Gale-O-Matic exhibits excessive eyebrow scowling and tends to blow its own hat off during autumn gusts. Keep away from collapsible creek bridges.”',
    tacticalNote: 'Tip: Collapsible wooden bridges can be blasted out from under heavy enemies to dunk them straight into the creek!',
  },
  {
    id: 'lore_autumn_3',
    seasonId: 'autumn',
    order: 11,
    title: 'Secret of the Gopher Tunnels',
    region: 'Pumpkin Meadow Lane',
    icon: '🕳️',
    body: 'Long before the rebellion, friendly retired tunnel-builders (who left the valley for sunny beaches) left behind brass-rimmed Burrow Pipes linking opposite terraces. Stepping into one costs just 1 Move and pops you behind enemy snipers!',
    tacticalNote: 'Tip: Combine a Burrow Pipe warp with a Team-Jump and Secondary Hammer Cleave for huge Mario+Rabbids combos!',
  },
  {
    id: 'lore_autumn_4',
    seasonId: 'autumn',
    order: 12,
    title: 'Lord Bramblecoat’s Crimson Ledger',
    region: 'Harvest Barn Keep',
    icon: '🍁',
    body: 'Lord Bramblecoat prides himself on immaculate hedge trimming and dramatic cape flourishes. Rumor says his secret weakness is crisp autumn gusts—and a well-timed Boomerang curving straight past his haystack shield.',
    tacticalNote: 'Tip: Boomerang secondaries curve past Half Cover—pair them with High Ground cliffs for guaranteed crits!',
  },

  // WINTER (4)
  {
    id: 'lore_winter_1',
    seasonId: 'winter',
    order: 13,
    title: 'The Frozen Creek Accord',
    region: 'Frostbridge Crossing',
    icon: '❄️',
    body: 'When snow sealed the mountain pass, the Produce Guild worried winter would halt the march. Then Quackers slid a Chug-Plow 30 feet across glare ice with a single Pond Vacuum yank, and everyone cheered for ice hockey tactics.',
    tacticalNote: 'Tip: Knocking or Pulling a unit onto an Ice tile makes them slide +1 extra tile along the push/pull vector!',
  },
  {
    id: 'lore_winter_2',
    seasonId: 'winter',
    order: 14,
    title: 'Sleet-Cannon Ski Trials',
    region: 'Lantern Cottage Curve',
    icon: '⛷️',
    body: 'Iron-Shed engineers strapped cedar skis onto brass snow-blowers so they could patrol frozen terraces. The skis work splendidly—right up until a Hero Sight Overwatch shot knocks them sideways off a 2-story ridge.',
    tacticalNote: 'Tip: Frost status chills targets (-2 Move & +1 incoming melee/gimmick DMG)—watch out for Sleet-Cannons!',
  },
  {
    id: 'lore_winter_3',
    seasonId: 'winter',
    order: 15,
    title: 'Warmth of the Hearth Greenhouse',
    region: 'Pine Ridge Overlook',
    icon: '🏮',
    body: 'Inside the Hearth Greenhouse, centuries of Heirloom Seeds slumber in glass jars warmed by brass steam-pipes. Liberating the Hearth means spring will bloom brighter across all four valleys—and every crop stays free forever.',
    tacticalNote: 'Tip: Use Tier-4 Skill Tree Capstones and Tier-3 Forged Weapons to crack the Citadel’s armored guard!',
  },
  {
    id: 'lore_winter_4',
    seasonId: 'winter',
    order: 16,
    title: 'Grand Marshal Frostplow’s Boiler Log',
    region: 'Hearth Greenhouse Citadel',
    icon: '🚂',
    body: 'Entry #999: “Boiler pressure optimal. Icicle eyebrows waxed. Plaid smokestack cap tilted at commanding 15-degree angle. Surely no ragtag squad of cows, peas, and lemons can breach my heated glass citadel—wait, why is that duck holding a vacuum cleaner?”',
    tacticalNote: 'Tip: Grand Marshal Frostplow enters Boiling Phase 2 at 50% HP—use Acid, Burn & Ice slides to topple him!',
  },
];

export const FACTION_DOSSIERS: FactionDossier[] = [
  {
    id: 'produce_guild',
    name: 'The Produce Brigade',
    icon: '🥕',
    accent: '#4d9638',
    motto: '“Fresh-picked, battle-ready, never going in the soup!”',
    summary:
      'Scrappy roots, sharp-eyed vines, and zesty fruits who turned garden tools, bellows, and leaf-dusters into an improvised tactical arsenal.',
  },
  {
    id: 'barnyard_alliance',
    name: 'The Barnyard Alliance',
    icon: '🐄',
    accent: '#c9882b',
    motto: '“Hooves, feathers, and wool—standing shoulder-to-stem!”',
    summary:
      'Loyal cows, roosters, ducks, boars, sheep, goats, and bespectacled owls who act as living cover, aerial jump-pads, and fearless frontline chargers.',
  },
  {
    id: 'iron_shed',
    name: 'The Iron-Shed Contraptions & Farmhands',
    icon: '⚙️',
    accent: '#b84232',
    motto: '“Harvest schedule MUST be met! (More steam!)”',
    summary:
      'Grumpy farmhands and runaway mechanical contraptions—turbo wheelbarrows, cranky wind-turrets, drill-tanks, snowplows, and boss harvesters. Zero animals on their side, ever!',
  },
];

export const HERO_LORE_QUOTES: Partial<Record<HeroSpecies, string>> = {
  cow: '“Moo-ve aside! Nobody touches my pasture pals.”',
  pea: '“One pod on the cliff, one Duster on the flank—easy!”',
  lemon: '“Life gave the farmers lemons. Bad mistake.”',
  rooster: '“Step on my wingtips and soar, team!”',
  carrot: '“Straight through the crates, roots first!”',
  potato: '“Call me a couch potato one more time, pal.”',
  chili: '“Too hot to harvest! Catch my dust!”',
  blackberry: '“A little balm for friends, a lot of thorns for bullies.”',
  corn: '“Stay back—I’m about to pop off!”',
  lettuce: '“Crisp leaves, cool head, curving boomerangs.”',
  pig: '“Mud slows machines down. Mud speeds ME up!”',
  sheep: '“Huddle behind the wool—nothing gets through!”',
  goat: '“Nice stone wall. Looks tasty.”',
  strawberry: '“En garde, you rusty lawnmower!”',
  mushroom: '“Boing! Free sky-rides all day long!”',
  duck: '“Goggles down, Pond Vacuum spun up—quack!”',
  pumpkin: '“Patch Reporting! Ready to bowl!”',
  blueberry: '“Blink and you’ll miss the indigo flash.”',
  owl: '“Hoo-hoo… tactical elevation advantage confirmed.”',
};

export function getLoreForSeason(seasonId: SeasonId): LoreChronicleEntry[] {
  return WORLD_LORE_CHRONICLES.filter((l) => l.seasonId === seasonId);
}

export function getLoreById(id: string): LoreChronicleEntry | undefined {
  return WORLD_LORE_CHRONICLES.find((l) => l.id === id);
}
