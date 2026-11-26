import { describe, expect, it } from 'vitest';
import {
  EVENT_REGISTRY,
  GARDEN_EVENTS,
  applyEventEffects,
  leaveEvent,
  openEventNode,
  resolveEventChoice,
} from '../events';
import { createRng, generateActNodes, actRng } from '../mapgen';
import { createNewRun, defaultMetaProgress } from '../run';
import type { RunState, SeasonNode } from '../types';

function runWithEventNode(seed = 3): { run: RunState; node: SeasonNode } {
  const run = createNewRun(defaultMetaProgress(), 'spring', seed);
  const node: SeasonNode = {
    id: 'evt_test',
    stage: 1,
    lane: 0,
    type: 'event',
    name: 'Test',
    subtitle: '',
    nextIds: [],
    completed: false,
  };
  run.nodes.push(node);
  return { run, node };
}

describe('garden events', () => {
  it('appear on generated maps but never on the first floor or right before the boss', () => {
    let total = 0;
    for (let seed = 1; seed <= 100; seed++) {
      const nodes = generateActNodes(0, actRng(seed, 0));
      const events = nodes.filter((n) => n.type === 'event');
      total += events.length;
      expect(events.every((n) => n.stage >= 1 && n.stage <= 5)).toBe(true);
    }
    expect(total).toBeGreaterThan(100); // more than one per act on average
  });

  it('opens an event, resolves a choice once, and returns to the map', () => {
    const { run, node } = runWithEventNode();
    const event = openEventNode(run, node.id)!;
    expect(run.status).toBe('event');
    expect(run.completedNodeIds).toContain(node.id);
    expect(run.seenEventIds).toContain(event.id);

    const idx = event.choices.findIndex((c) => !c.blockedReason?.(run));
    const outcome = resolveEventChoice(run, idx);
    expect(outcome?.length).toBeGreaterThan(0);
    expect(resolveEventChoice(run, idx)).toBeNull(); // can't pick twice
    leaveEvent(run);
    expect(run.status).toBe('map');
    expect(run.pendingEvent).toBeNull();
  });

  it('refuses blocked choices', () => {
    const { run, node } = runWithEventNode();
    openEventNode(run, node.id);
    run.pendingEvent = { eventId: 'shell_game', outcome: null, choiceIndex: null };
    run.seeds = 3;
    expect(resolveEventChoice(run, 0)).toBeNull();
    expect(run.seeds).toBe(3);
  });

  it('does not repeat an event until all have been seen', () => {
    const { run } = runWithEventNode();
    const seen = new Set<string>();
    for (let i = 0; i < GARDEN_EVENTS.length; i++) {
      const node: SeasonNode = { id: `e${i}`, stage: 1, lane: 0, type: 'event', name: '', subtitle: '', nextIds: [], completed: false };
      run.nodes.push(node);
      const ev = openEventNode(run, node.id)!;
      expect(seen.has(ev.id)).toBe(false);
      seen.add(ev.id);
      leaveEvent(run);
    }
    expect(seen.size).toBe(GARDEN_EVENTS.length);
  });

  it('every choice of every event applies cleanly and never bags a hero', () => {
    for (const event of GARDEN_EVENTS) {
      event.choices.forEach((choice, i) => {
        for (let seed = 1; seed <= 20; seed++) {
          const { run } = runWithEventNode(seed);
          run.seeds = 30;
          run.items.honey_pot = 1;
          run.roster[4].harvested = true;
          run.roster.forEach((h) => (h.hp = 2));
          if (choice.blockedReason?.(run)) continue;
          const log = applyEventEffects(run, choice.effects, createRng(seed * 31 + i));
          expect(Array.isArray(log)).toBe(true);
          expect(run.seeds).toBeGreaterThanOrEqual(0);
          for (const h of run.roster.filter((x) => !x.harvested)) {
            expect(h.hp).toBeGreaterThanOrEqual(1);
            expect(h.hp).toBeLessThanOrEqual(h.maxHp);
          }
          for (const count of Object.values(run.items)) expect(count).toBeGreaterThanOrEqual(0);
        }
      });
    }
    expect(Object.keys(EVENT_REGISTRY)).toHaveLength(GARDEN_EVENTS.length);
  });
});
