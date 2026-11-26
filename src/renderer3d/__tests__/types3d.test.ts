import { describe, expect, it } from 'vitest';
import { getTerrainSurfaceY } from '../diorama';
import { gridToWorld3D, TILE_SIZE_3D, worldToGrid3D } from '../types';

describe('renderer3d coordinate & relief helpers', () => {
  it('round-trips every grid cell between grid and 3D world space', () => {
    for (const [w, h] of [
      [7, 9],
      [7, 10],
      [8, 8],
    ]) {
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const wp = gridToWorld3D(x, y, w, h, 0);
          const back = worldToGrid3D(wp.x, wp.z, w, h);
          expect(back).toEqual({ x, y });
        }
      }
      // Out-of-bounds picks return null
      expect(worldToGrid3D(w * TILE_SIZE_3D, 0, w, h)).toBeNull();
      expect(worldToGrid3D(0, -h * TILE_SIZE_3D, w, h)).toBeNull();
    }
  });

  it('gives tactile relief elevation differences across terrain types', () => {
    expect(getTerrainSurfaceY('mud')).toBeLessThan(getTerrainSurfaceY('grass'));
    expect(getTerrainSurfaceY('compost')).toBeGreaterThan(getTerrainSurfaceY('grass'));
    expect(getTerrainSurfaceY('gate')).toBeGreaterThan(getTerrainSurfaceY('grass'));
  });
});
