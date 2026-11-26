import type { BattleEvent, BattleState, GridPos } from '../engine/types';
import type { InteractionMode, RendererViewState } from '../renderer/canvas';
import type { BoardViewMode } from '../renderer/iso';

export type CameraMode3D = 'tactical' | 'tacticam' | 'aim';

export type RendererKind = '3d' | '2d';

export interface ScreenAnchor {
  x: number;
  y: number;
  visible: boolean;
}

export interface PhaseBannerOverlay {
  text: string;
  tone: 'player' | 'enemy' | 'victory' | 'defeat';
  progress: number; // 0..1
}

export interface BattleRendererHooks {
  getState: () => RendererViewState | null;
  onHoverChange: (pos: GridPos | null) => void;
  onTileTap: (pos: GridPos, pointerType: string) => void;
  onOffBoardTap?: () => void;
  onRightClickCancel?: () => void;
  onZoomChange?: (zoomPercent: number) => void;
  onCameraModeChange?: (mode: CameraMode3D) => void;
  onFocusAnchorChange?: (anchor: ScreenAnchor | null) => void;
  onBannerChange?: (banner: PhaseBannerOverlay | null) => void;
}

export interface BattleRendererHandle {
  consumeEvents(events: BattleEvent[]): void;
  focusOnGrid(pos: GridPos): void;
  cancelActiveAnims(): void;
  resetCamera(overrideMode?: BoardViewMode): void;
  adjustZoom(delta: number): void;
  rotateCamera?(deltaRadians: number): void;
  toggleTacticam?(): CameraMode3D;
  setCameraMode?(mode: CameraMode3D): void;
  getCameraMode?(): CameraMode3D;
  destroy(): void;
}

export interface TileWorldMetrics {
  tileSize: number;
  boardWidth: number;
  boardHeight: number;
  halfW: number;
  halfH: number;
}

export const TILE_SIZE_3D = 1.25;

export function gridToWorld3D(
  gx: number,
  gy: number,
  gridW: number,
  gridH: number,
  y = 0
): { x: number; y: number; z: number } {
  const halfW = ((gridW - 1) * TILE_SIZE_3D) / 2;
  const halfH = ((gridH - 1) * TILE_SIZE_3D) / 2;
  return {
    x: gx * TILE_SIZE_3D - halfW,
    y,
    z: gy * TILE_SIZE_3D - halfH,
  };
}

export function worldToGrid3D(
  wx: number,
  wz: number,
  gridW: number,
  gridH: number
): GridPos | null {
  const halfW = ((gridW - 1) * TILE_SIZE_3D) / 2;
  const halfH = ((gridH - 1) * TILE_SIZE_3D) / 2;
  const gx = Math.round((wx + halfW) / TILE_SIZE_3D);
  const gy = Math.round((wz + halfH) / TILE_SIZE_3D);
  if (gx < 0 || gy < 0 || gx >= gridW || gy >= gridH) return null;
  return { x: gx, y: gy };
}

export type { BattleEvent, BattleState, BoardViewMode, GridPos, InteractionMode, RendererViewState };
