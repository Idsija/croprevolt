import type {
  BattleState,
  BattleUnit,
  CoverKind,
  CoverLevel,
  CoverObject,
  GridPos,
  RosterHero,
  Team,
  TerrainType,
  Tile,
} from './types';

export function posKey(pos: GridPos): string {
  return `${pos.x},${pos.y}`;
}

export function samePos(a: GridPos, b: GridPos): boolean {
  return a.x === b.x && a.y === b.y;
}

export function manhattan(a: GridPos, b: GridPos): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

export function chebyshev(a: GridPos, b: GridPos): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

export function inBounds(state: Pick<BattleState, 'width' | 'height'>, pos: GridPos): boolean {
  return pos.x >= 0 && pos.y >= 0 && pos.x < state.width && pos.y < state.height;
}

export function tileAt(state: Pick<BattleState, 'width' | 'height' | 'tiles'>, pos: GridPos): Tile | null {
  if (!inBounds(state, pos)) return null;
  return state.tiles[pos.y][pos.x];
}

export function unitAt(state: Pick<BattleState, 'units'>, pos: GridPos): BattleUnit | undefined {
  return state.units.find((u) => u.alive && u.pos.x === pos.x && u.pos.y === pos.y);
}

export function getNeighbors(state: Pick<BattleState, 'width' | 'height'>, pos: GridPos): GridPos[] {
  const dirs: GridPos[] = [
    { x: 1, y: 0 },
    { x: -1, y: 0 },
    { x: 0, y: 1 },
    { x: 0, y: -1 },
  ];
  const out: GridPos[] = [];
  for (const d of dirs) {
    const next = { x: pos.x + d.x, y: pos.y + d.y };
    if (inBounds(state, next)) out.push(next);
  }
  return out;
}

export function getTerrainMoveCost(terrain: TerrainType): number {
  return terrain === 'mud' ? 2 : 1;
}

export function isHazardLiquid(terrain: TerrainType): boolean {
  return terrain === 'water' || terrain === 'lava';
}

export function canStepElevation(fromTile: Tile, toTile: Tile): boolean {
  return Math.abs((fromTile.elevation ?? 0) - (toTile.elevation ?? 0)) <= 1;
}

export function getStepMoveCost(fromTile: Tile, toTile: Tile, ignoresMud = false): number {
  const base = ignoresMud ? 1 : getTerrainMoveCost(toTile.terrain);
  const climbing = (toTile.elevation ?? 0) > (fromTile.elevation ?? 0);
  const onRamp = fromTile.terrain === 'ramp' || toTile.terrain === 'ramp';
  // Ramps make climbing smooth (cost 1); scrambling up a sheer +1 terrace costs +1 Move!
  return base + (climbing && !onRamp ? 1 : 0);
}

export function createCover(
  kind: Exclude<CoverKind, 'none'>,
  captiveUnitId?: string,
  captiveHero?: RosterHero
): CoverObject {
  switch (kind) {
    case 'crate':
      return { kind: 'crate', level: 'half', hp: 6, maxHp: 6, destructible: true };
    case 'haystack':
      return { kind: 'haystack', level: 'full', hp: 10, maxHp: 10, destructible: true };
    case 'stone':
      return { kind: 'stone', level: 'full', hp: 99, maxHp: 99, destructible: false };
    case 'thorns':
      return { kind: 'thorns', level: 'half', hp: 5, maxHp: 5, destructible: true };
    case 'beehive':
      return { kind: 'beehive', level: 'half', hp: 4, maxHp: 4, destructible: true };
    case 'sprinkler':
      return { kind: 'sprinkler', level: 'half', hp: 4, maxHp: 4, destructible: true };
    case 'cage':
      return {
        kind: 'cage',
        level: 'half',
        hp: 9,
        maxHp: 9,
        destructible: true,
        isObjectiveCage: true,
        captiveUnitId,
        captiveHero,
      };
  }
}

export function isTileWalkable(
  state: BattleState,
  pos: GridPos,
  movingTeam?: 'player' | 'enemy',
  asDestination = true
): boolean {
  const tile = tileAt(state, pos);
  if (!tile || tile.cover || isHazardLiquid(tile.terrain)) return false;
  const occupant = unitAt(state, pos);
  if (!occupant) return true;
  if (asDestination) return false;
  // Units can pass through allies during movement, but not through enemies
  return movingTeam !== undefined && occupant.team === movingTeam;
}

export interface CoverEvaluation {
  level: CoverLevel;
  coverPos?: GridPos;
}

/**
 * Mario + Rabbids discrete directional cover evaluation:
 * - Orthogonal adjacent melee (distance 1) bypasses cover (flanked).
 * - Otherwise, inspect the orthogonal neighbor tile(s) of the defender facing the attacker.
 * - Full cover (haystack/stone) = 0% direct hit; Half cover (crate/thorns OR adjacent Woolly Sheep mount!) = 50% hit; Open = 100% hit.
 */
export function evaluateCover(
  state: Pick<BattleState, 'width' | 'height' | 'tiles'> & Partial<Pick<BattleState, 'units'>>,
  attackerPos: GridPos,
  defenderPos: GridPos,
  defenderTeam?: Team
): CoverEvaluation {
  if (manhattan(attackerPos, defenderPos) <= 1) {
    return { level: 'none' };
  }

  const dx = attackerPos.x - defenderPos.x;
  const dy = attackerPos.y - defenderPos.y;

  const candidates: GridPos[] = [];
  if (dx !== 0) {
    candidates.push({ x: defenderPos.x + Math.sign(dx), y: defenderPos.y });
  }
  if (dy !== 0) {
    candidates.push({ x: defenderPos.x, y: defenderPos.y + Math.sign(dy) });
  }

  let best: CoverEvaluation = { level: 'none' };
  for (const cPos of candidates) {
    if (samePos(cPos, attackerPos)) continue;
    const t = tileAt(state, cPos);
    if (t?.cover) {
      if (t.cover.level === 'full') {
        return { level: 'full', coverPos: cPos };
      }
      if (t.cover.level === 'half' && best.level === 'none') {
        best = { level: 'half', coverPos: cPos };
      }
    }
    // Living Wool Cover: standing beside Woolly Bulwark provides Half Cover (50%)!
    if (best.level === 'none' && defenderTeam && state.units) {
      const ally = unitAt({ units: state.units }, cPos);
      if (ally && ally.team === defenderTeam && ally.livingHalfCover) {
        best = { level: 'half', coverPos: cPos };
      }
    }
  }
  return best;
}

export interface AdjacentCoverBadge {
  dir: 'n' | 's' | 'e' | 'w';
  coverPos: GridPos;
  level: Exclude<CoverLevel, 'none'>;
}

/**
 * Returns adjacent cover edges around a walkable tile (including Living Wool Bulwark!).
 */
export function getAdjacentCoverBadges(
  state: Pick<BattleState, 'width' | 'height' | 'tiles'> & Partial<Pick<BattleState, 'units'>>,
  pos: GridPos,
  movingTeam?: Team
): AdjacentCoverBadge[] {
  const checks: Array<{ dir: 'n' | 's' | 'e' | 'w'; p: GridPos }> = [
    { dir: 'n', p: { x: pos.x, y: pos.y - 1 } },
    { dir: 's', p: { x: pos.x, y: pos.y + 1 } },
    { dir: 'e', p: { x: pos.x + 1, y: pos.y } },
    { dir: 'w', p: { x: pos.x - 1, y: pos.y } },
  ];
  const badges: AdjacentCoverBadge[] = [];
  for (const c of checks) {
    const t = tileAt(state, c.p);
    if (t?.cover) {
      badges.push({ dir: c.dir, coverPos: c.p, level: t.cover.level });
    } else if (movingTeam && state.units) {
      const ally = unitAt({ units: state.units }, c.p);
      if (ally && ally.team === movingTeam && ally.livingHalfCover) {
        badges.push({ dir: c.dir, coverPos: c.p, level: 'half' });
      }
    }
  }
  return badges;
}
