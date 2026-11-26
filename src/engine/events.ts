import { ALL_GRAFT_IDS, GRAFT_REGISTRY } from '../data/grafts';
import { ITEM_REGISTRY } from '../data/items';
import { PRODUCE_BLUEPRINTS, RECRUITABLE_BLUEPRINT_IDS } from '../data/produce';
import { ALL_RELIC_IDS, RELIC_REGISTRY } from '../data/relics';
import { battleRng } from './difficulty';
import { applyGraftToHero, claimRecruitReward } from './run';
import type { Rng } from './mapgen';
import type { RunState } from './types';

/**
 * "?" event nodes: a short garden vignette with 2–3 choices. Effects are plain data so
 * events stay easy to write, test and balance. Event state lives on the run so a saved
 * run resumes on the same event.
 */

export type EventEffect =
  | { kind: 'seeds'; amount: number }
  | { kind: 'heal'; amount: number }
  | { kind: 'damage'; amount: number }
  | { kind: 'maxHp'; amount: number }
  | { kind: 'item'; itemId: string; count: number }
  | { kind: 'relic' }
  | { kind: 'graft' }
  | { kind: 'recruit' }
  | { kind: 'freeBagged' }
  | { kind: 'gamble'; chance: number; win: EventEffect[]; lose: EventEffect[] };

export interface EventChoice {
  label: string;
  hint: string;
  effects: EventEffect[];
  /** Why the choice is greyed out, or null when it can be picked. */
  blockedReason?: (run: RunState) => string | null;
}

export interface GardenEvent {
  id: string;
  title: string;
  sprite: string;
  text: string;
  choices: EventChoice[];
}

export interface PendingEvent {
  eventId: string;
  /** Filled in once a choice was made: what happened, one line per effect. */
  outcome: string[] | null;
  choiceIndex: number | null;
}

const needSeeds = (n: number) => (run: RunState) =>
  run.seeds >= n ? null : `Needs ${n} Seeds`;
const needItem = (itemId: string) => (run: RunState) =>
  (run.items[itemId] ?? 0) > 0 ? null : `Needs a ${ITEM_REGISTRY[itemId]?.name ?? itemId}`;

export const GARDEN_EVENTS: GardenEvent[] = [
  {
    id: 'rain_barrel',
    title: 'The Overflowing Rain Barrel',
    sprite: '/sprites/sprinkler.png',
    text: 'Last night’s storm filled an old rain barrel to the brim. The water is cool, clear and smells faintly of mint.',
    choices: [
      { label: 'Drink deep', hint: 'Squad heals 6 HP', effects: [{ kind: 'heal', amount: 6 }] },
      {
        label: 'Fill the watering cans',
        hint: '+2 Watering Cans',
        effects: [{ kind: 'item', itemId: 'watering_can', count: 2 }],
      },
    ],
  },
  {
    id: 'compost_heap',
    title: 'A Steaming Compost Heap',
    sprite: '/sprites/haystack.png',
    text: 'Something glints deep inside a warm, rich compost heap. Digging that far down will get messy.',
    choices: [
      { label: 'Roll around in it', hint: 'Squad heals 4 HP', effects: [{ kind: 'heal', amount: 4 }] },
      {
        label: 'Dig for the glint',
        hint: '60%: a Soil Relic · 40%: the squad takes 3 damage',
        effects: [{ kind: 'gamble', chance: 0.6, win: [{ kind: 'relic' }], lose: [{ kind: 'damage', amount: 3 }] }],
      },
    ],
  },
  {
    id: 'seed_packet',
    title: 'An Unlabelled Seed Packet',
    sprite: '/sprites/carrot.png',
    text: 'A crumpled seed packet lies in the furrow. No label, just a doodle of something with far too many leaves.',
    choices: [
      {
        label: 'Plant it on a hero',
        hint: '65%: a random hero gains a Graft · 35%: it wilts (lose 4 Seeds)',
        effects: [{ kind: 'gamble', chance: 0.65, win: [{ kind: 'graft' }], lose: [{ kind: 'seeds', amount: -4 }] }],
      },
      { label: 'Sell it at the market', hint: '+10 Seeds', effects: [{ kind: 'seeds', amount: 10 }] },
    ],
  },
  {
    id: 'scarecrow_hat',
    title: 'A Scarecrow’s Lost Hat',
    sprite: '/sprites/scarecrow.png',
    text: 'A battered straw hat is caught on a fence post. The crows nearby eye it greedily.',
    choices: [
      { label: 'Wear it with pride', hint: 'Every hero gains +2 Max HP', effects: [{ kind: 'maxHp', amount: 2 }] },
      {
        label: 'Trade it to the crows',
        hint: '+1 Fertilizer Bomb, +6 Seeds',
        effects: [
          { kind: 'item', itemId: 'fertilizer_bomb', count: 1 },
          { kind: 'seeds', amount: 6 },
        ],
      },
    ],
  },
  {
    id: 'bee_swarm',
    title: 'A Grumpy Bee Swarm',
    sprite: '/sprites/beehive.png',
    text: 'A swarm of bees blocks the trail, buzzing angrily around a toppled hive.',
    choices: [
      {
        label: 'Offer them honey',
        hint: 'Spend 1 Honey Pot: gain a Soil Relic',
        blockedReason: needItem('honey_pot'),
        effects: [{ kind: 'item', itemId: 'honey_pot', count: -1 }, { kind: 'relic' }],
      },
      { label: 'Dash through', hint: 'The squad takes 2 damage', effects: [{ kind: 'damage', amount: 2 }] },
    ],
  },
  {
    id: 'tool_shed',
    title: 'An Unlocked Tool Shed',
    sprite: '/sprites/crate.png',
    text: 'The farmhands left their shed unlocked. You can hear snoring from the hammock inside.',
    choices: [
      {
        label: 'Sneak in',
        hint: '70%: a Soil Relic · 30%: caught! The squad takes 4 damage',
        effects: [{ kind: 'gamble', chance: 0.7, win: [{ kind: 'relic' }], lose: [{ kind: 'damage', amount: 4 }] }],
      },
      {
        label: 'Grab what’s by the door',
        hint: '+1 Fertilizer Bomb',
        effects: [{ kind: 'item', itemId: 'fertilizer_bomb', count: 1 }],
      },
      { label: 'Leave quietly', hint: 'Nothing happens', effects: [] },
    ],
  },
  {
    id: 'shell_game',
    title: 'The Walnut Shell Game',
    sprite: '/sprites/goat.png',
    text: 'A goat with a suspicious grin shuffles three walnut shells. "Find the pea, double your seeds!"',
    choices: [
      {
        label: 'Bet 10 Seeds',
        hint: '50%: win 25 Seeds · 50%: lose the bet',
        blockedReason: needSeeds(10),
        effects: [
          { kind: 'seeds', amount: -10 },
          { kind: 'gamble', chance: 0.5, win: [{ kind: 'seeds', amount: 25 }], lose: [] },
        ],
      },
      { label: 'Walk away', hint: 'Nothing happens', effects: [] },
    ],
  },
  {
    id: 'lost_sprout',
    title: 'A Lost Sprout',
    sprite: '/sprites/lettuce.png',
    text: 'A little sprout is hiding under a cabbage leaf, too scared to go home alone.',
    choices: [
      {
        label: 'Invite it to the revolt',
        hint: 'Recruit a random new hero',
        blockedReason: (run) =>
          RECRUITABLE_BLUEPRINT_IDS.some((id) => !run.roster.some((h) => h.blueprintId === id))
            ? null
            : 'Your roster is full of every hero',
        effects: [{ kind: 'recruit' }],
      },
      { label: 'Walk it home', hint: '+8 Seeds as thanks', effects: [{ kind: 'seeds', amount: 8 }] },
    ],
  },
  {
    id: 'smuggler',
    title: 'The Barnyard Smuggler',
    sprite: '/sprites/rooster.png',
    text: 'A rooster in a trench coat whispers that he can sneak a bagged friend out of the farmhouse. For a price.',
    choices: [
      {
        label: 'Pay 12 Seeds',
        hint: 'Free one bagged hero at 70% HP',
        blockedReason: (run) =>
          !run.roster.some((h) => h.harvested) ? 'Nobody is bagged' : needSeeds(12)(run),
        effects: [{ kind: 'seeds', amount: -12 }, { kind: 'freeBagged' }],
      },
      {
        label: 'Buy his snacks instead',
        hint: 'Spend 5 Seeds: squad heals 5 HP',
        blockedReason: needSeeds(5),
        effects: [{ kind: 'seeds', amount: -5 }, { kind: 'heal', amount: 5 }],
      },
      { label: 'Decline', hint: 'Nothing happens', effects: [] },
    ],
  },
];

export const EVENT_REGISTRY: Record<string, GardenEvent> = Object.fromEntries(
  GARDEN_EVENTS.map((e) => [e.id, e])
);

/** Pick an event for a node, avoiding ones already seen this run when possible. */
export function pickEventForNode(run: RunState, nodeId: string): GardenEvent {
  const rng = battleRng(run.seed, `event:${nodeId}`);
  const seen = new Set(run.seenEventIds ?? []);
  const fresh = GARDEN_EVENTS.filter((e) => !seen.has(e.id));
  const pool = fresh.length > 0 ? fresh : GARDEN_EVENTS;
  return pool[Math.floor(rng() * pool.length)];
}

function livingHeroes(run: RunState) {
  return run.roster.filter((h) => !h.harvested);
}

function pickFrom<T>(rng: Rng, items: readonly T[]): T | undefined {
  return items.length > 0 ? items[Math.floor(rng() * items.length)] : undefined;
}

/** Apply effects, returning a human-readable line for each thing that happened. */
export function applyEventEffects(run: RunState, effects: EventEffect[], rng: Rng): string[] {
  const log: string[] = [];
  for (const effect of effects) {
    switch (effect.kind) {
      case 'seeds': {
        const delta = Math.max(-run.seeds, effect.amount);
        run.seeds += delta;
        if (delta !== 0) log.push(`${delta > 0 ? '+' : ''}${delta} Seeds`);
        break;
      }
      case 'heal':
        for (const h of livingHeroes(run)) h.hp = Math.min(h.maxHp, h.hp + effect.amount);
        log.push(`Squad healed ${effect.amount} HP`);
        break;
      case 'damage':
        // Events sting, but never bag a hero on their own.
        for (const h of livingHeroes(run)) h.hp = Math.max(1, h.hp - effect.amount);
        log.push(`Squad took ${effect.amount} damage`);
        break;
      case 'maxHp':
        for (const h of livingHeroes(run)) {
          h.maxHp += effect.amount;
          h.hp += effect.amount;
        }
        log.push(`Every hero gained +${effect.amount} Max HP`);
        break;
      case 'item': {
        const have = run.items[effect.itemId] ?? 0;
        run.items[effect.itemId] = Math.max(0, have + effect.count);
        const name = ITEM_REGISTRY[effect.itemId]?.name ?? effect.itemId;
        log.push(`${effect.count > 0 ? '+' : ''}${effect.count} ${name}`);
        break;
      }
      case 'relic': {
        const relicId = pickFrom(rng, ALL_RELIC_IDS.filter((id) => !run.relicIds.includes(id)));
        if (relicId) {
          run.relicIds.push(relicId);
          log.push(`Found ${RELIC_REGISTRY[relicId]?.icon ?? ''} ${RELIC_REGISTRY[relicId]?.name ?? relicId}`.trim());
        } else {
          run.seeds += 15;
          log.push('You already own every relic: +15 Seeds instead');
        }
        break;
      }
      case 'graft': {
        const candidates = livingHeroes(run).flatMap((h) =>
          ALL_GRAFT_IDS.filter((g) => !h.graftIds.includes(g) && h.graftIds.length < 2).map((g) => ({ h, g }))
        );
        const pick = pickFrom(rng, candidates);
        if (pick) {
          // Reuse the reward path so tier promotions apply exactly as usual.
          const hadPending = run.pendingReward;
          run.pendingReward = null;
          applyGraftToHero(run, pick.h.uid, pick.g);
          run.pendingReward = hadPending;
          log.push(`${pick.h.name} grew ${GRAFT_REGISTRY[pick.g]?.badgeIcon ?? ''} ${GRAFT_REGISTRY[pick.g]?.name ?? pick.g}`.trim());
        } else {
          run.seeds += 10;
          log.push('Nobody has room for a Graft: +10 Seeds instead');
        }
        break;
      }
      case 'recruit': {
        const bp = pickFrom(
          rng,
          RECRUITABLE_BLUEPRINT_IDS.filter((id) => !run.roster.some((h) => h.blueprintId === id))
        );
        if (bp) {
          claimRecruitReward(run, bp, run.recruitBonusHp ?? 0);
          log.push(`${PRODUCE_BLUEPRINTS[bp]?.name ?? bp} joined the revolt`);
        }
        break;
      }
      case 'freeBagged': {
        const hero = run.roster.find((h) => h.harvested);
        if (hero) {
          hero.harvested = false;
          hero.hp = Math.max(4, Math.round(hero.maxHp * 0.7));
          if (run.activeSquadUids.length < 4) run.activeSquadUids.push(hero.uid);
          log.push(`${hero.name} is free!`);
        }
        break;
      }
      case 'gamble': {
        const won = rng() < effect.chance;
        log.push(won ? 'Luck is on your side!' : 'No luck this time…');
        log.push(...applyEventEffects(run, won ? effect.win : effect.lose, rng));
        break;
      }
    }
  }
  return log;
}

/** Enter a "?" node: choose its event and park the run on the event screen. */
export function openEventNode(run: RunState, nodeId: string): GardenEvent | null {
  const node = run.nodes.find((n) => n.id === nodeId);
  if (!node || node.type !== 'event') return null;
  const event = pickEventForNode(run, nodeId);
  run.currentNodeId = nodeId;
  run.pendingEvent = { eventId: event.id, outcome: null, choiceIndex: null };
  run.seenEventIds = [...(run.seenEventIds ?? []), event.id];
  node.completed = true;
  if (!run.completedNodeIds.includes(nodeId)) run.completedNodeIds.push(nodeId);
  run.status = 'event';
  return event;
}

export function resolveEventChoice(run: RunState, choiceIndex: number): string[] | null {
  const pending = run.pendingEvent;
  if (!pending || pending.outcome) return null;
  const event = EVENT_REGISTRY[pending.eventId];
  const choice = event?.choices[choiceIndex];
  if (!choice || choice.blockedReason?.(run)) return null;
  const rng = battleRng(run.seed, `event-roll:${run.currentNodeId ?? ''}:${choiceIndex}`);
  const outcome = applyEventEffects(run, choice.effects, rng);
  pending.choiceIndex = choiceIndex;
  pending.outcome = outcome.length > 0 ? outcome : ['You move on.'];
  return pending.outcome;
}

export function leaveEvent(run: RunState): void {
  run.pendingEvent = null;
  run.status = 'map';
}
