import type { GridPos } from '../engine/types';

export type BoardViewMode = 'iso' | 'topdown';

export interface CameraTransform {
  panX: number;
  panY: number;
  zoom: number;
}

export interface IsoMetrics {
  viewMode: BoardViewMode;
  tileW: number;
  tileH: number;
  boardDepth: number;
  originX: number;
  originY: number;
  scale: number;
  baseScale: number;
}

/**
 * Computes mobile-first, browser-responsive board projection metrics for:
 * - 'topdown': Vertical 2.5D Tabletop Diorama (default — fills portrait phones cleanly and scales smoothly to desktop)
 * - 'iso':     2.5D Isometric Diamond Diorama
 *
 * Automatically fits inside the exact safe playable band between the slim top bar and compact bottom deck!
 */
export function computeIsoMetrics(
  canvasW: number,
  canvasH: number,
  gridW: number,
  gridH: number,
  camera: CameraTransform = { panX: 0, panY: 0, zoom: 1 },
  viewMode: BoardViewMode = 'topdown'
): IsoMetrics {
  const isCompact = canvasW < 768;
  const isVeryNarrow = canvasW < 420;

  // Dynamic safe margins matching the ultra-slim top bar and compact single-focus bottom dock
  const padLeft = isVeryNarrow ? 8 : isCompact ? 12 : 44;
  const padRight = isVeryNarrow ? 8 : isCompact ? 12 : 44;
  const padTop = isCompact ? 58 : 66;
  const padBottom = isCompact ? 162 : 150;

  const availW = Math.max(220, canvasW - padLeft - padRight);
  const availH = Math.max(220, canvasH - padTop - padBottom);
  const safeCenterX = padLeft + availW / 2;
  const safeCenterY = padTop + availH / 2;

  if (viewMode === 'topdown') {
    // Slightly foreshortened vertical tabletop tiles so upright paper standees feel 2.5D without crowding!
    const baseTileW = 76;
    const baseTileH = 68;
    const headRoom = 44; // Space above row 0 for tall farmer/boss standees + HP bars
    const footDepth = 22; // Space below bottom row for corrugated cardboard slab edge

    const baseScale = Math.min(
      availW / (gridW * baseTileW),
      availH / (gridH * baseTileH + headRoom + footDepth),
      1.45
    );
    const scale = baseScale * camera.zoom;
    const tileW = baseTileW * scale;
    const tileH = baseTileH * scale;
    const boardDepth = Math.max(10, 20 * scale);

    const boardPixelW = gridW * tileW;
    const boardPixelH = gridH * tileH;
    // Slight downward shift inside the safe band to give standee heads at row 0 breathing room
    const headBias = (headRoom - footDepth) * 0.35 * scale;
    const originX = safeCenterX - boardPixelW / 2 + camera.panX;
    const originY = safeCenterY - boardPixelH / 2 + headBias + camera.panY;

    return { viewMode, tileW, tileH, boardDepth, originX, originY, scale, baseScale };
  }

  // 2.5D Isometric Diamond Mode (tuned for vertical maps too)
  const baseTileW = 88;
  const baseTileH = 52;

  const isoSpanW = (gridW + gridH) * (baseTileW / 2);
  const isoSpanH = (gridW + gridH) * (baseTileH / 2);

  const baseScale = Math.min(availW / isoSpanW, availH / (isoSpanH + 86), 1.38);
  const scale = baseScale * camera.zoom;
  const tileW = baseTileW * scale;
  const tileH = baseTileH * scale;
  const boardDepth = Math.max(10, 26 * scale);

  const minIsoX = -gridH * (tileW / 2);
  const maxIsoX = gridW * (tileW / 2);
  const boardPixelW = maxIsoX - minIsoX;
  const boardPixelH = (gridW + gridH) * (tileH / 2);

  const originX = safeCenterX - boardPixelW / 2 - minIsoX + camera.panX;
  const originY = safeCenterY - boardPixelH / 2 + 12 * scale + camera.panY;

  return { viewMode, tileW, tileH, boardDepth, originX, originY, scale, baseScale };
}

export function gridToScreen(gx: number, gy: number, m: IsoMetrics): { x: number; y: number } {
  if (m.viewMode === 'topdown') {
    return {
      x: m.originX + (gx + 0.5) * m.tileW,
      y: m.originY + (gy + 0.5) * m.tileH,
    };
  }
  const x = m.originX + (gx - gy) * (m.tileW / 2);
  const y = m.originY + (gx + gy) * (m.tileH / 2) + m.tileH / 2;
  return { x, y };
}

export function screenToGrid(
  sx: number,
  sy: number,
  m: IsoMetrics,
  gridW: number,
  gridH: number
): GridPos | null {
  if (m.viewMode === 'topdown') {
    const gx = Math.floor((sx - m.originX) / m.tileW);
    const gy = Math.floor((sy - m.originY) / m.tileH);
    if (gx < 0 || gy < 0 || gx >= gridW || gy >= gridH) return null;
    return { x: gx, y: gy };
  }

  const relX = sx - m.originX;
  const relY = sy - m.originY;
  const halfW = m.tileW / 2;
  const halfH = m.tileH / 2;

  const gx = Math.floor((relX / halfW + relY / halfH) / 2);
  const gy = Math.floor((relY / halfH - relX / halfW) / 2);

  if (gx < 0 || gy < 0 || gx >= gridW || gy >= gridH) return null;
  return { x: gx, y: gy };
}

/**
 * Returns the 4 clockwise tile polygon corners:
 * - Iso:     [top, right, bottom, left]
 * - TopDown: [topLeft, topRight, bottomRight, bottomLeft]
 *
 * In BOTH modes, edge i -> (i+1)%4 faces neighbor:
 * - 0: (gx, gy - 1)
 * - 1: (gx + 1, gy)
 * - 2: (gx, gy + 1)
 * - 3: (gx - 1, gy)
 */
export function getTileDiamond(gx: number, gy: number, m: IsoMetrics): Array<{ x: number; y: number }> {
  if (m.viewMode === 'topdown') {
    const x0 = m.originX + gx * m.tileW;
    const y0 = m.originY + gy * m.tileH;
    return [
      { x: x0, y: y0 },
      { x: x0 + m.tileW, y: y0 },
      { x: x0 + m.tileW, y: y0 + m.tileH },
      { x: x0, y: y0 + m.tileH },
    ];
  }
  const topX = m.originX + (gx - gy) * (m.tileW / 2);
  const topY = m.originY + (gx + gy) * (m.tileH / 2);
  return [
    { x: topX, y: topY },
    { x: topX + m.tileW / 2, y: topY + m.tileH / 2 },
    { x: topX, y: topY + m.tileH },
    { x: topX - m.tileW / 2, y: topY + m.tileH / 2 },
  ];
}
