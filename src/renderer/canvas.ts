import { ITEM_REGISTRY } from '../data/items';
import { getAbilityTargetTiles, getItemTargetTiles } from '../engine/battle';
import {
  forecastAttack,
  getAllEnemiesThreatZone,
  getAttackableTiles,
  getEnemyThreatZone,
  getWeaponRangeTiles,
  unitHasMeaningfulAction,
} from '../engine/combat';
import {
  chebyshev,
  getAdjacentCoverBadges,
  manhattan,
  posKey,
  samePos,
  tileAt,
  unitAt,
  type AdjacentCoverBadge,
} from '../engine/grid';
import {
  computeDashOptions,
  computeMovableTiles,
  computeTeamJumpOptions,
  type ReachableNode,
} from '../engine/pathfinding';
import type {
  BattleEvent,
  BattleState,
  BattleUnit,
  CombatForecast,
  DashOption,
  GridPos,
  JumpOption,
} from '../engine/types';
import {
  computeIsoMetrics,
  getTileDiamond,
  gridToScreen,
  screenToGrid,
  type BoardViewMode,
  type CameraTransform,
  type IsoMetrics,
} from './iso';
import { ParticleSystem, roundRect } from './particles';
import { sfx } from './sfx';
import {
  drawCoverObject,
  drawPaperShieldBadge,
  drawUnitStandee,
  preloadPaperCraftSprites,
} from './sprites';

export type InteractionMode = 'move' | 'attack' | 'ability' | 'item';

export interface RendererViewState {
  battle: BattleState;
  selectedUnitId: string | null;
  inspectedEnemyId: string | null;
  showAllDangerZone?: boolean;
  previewOverwatch?: boolean;
  mode: InteractionMode;
  selectedItemId: string | null;
  hoveredTile: GridPos | null;
  previewTile: GridPos | null;
  viewMode: BoardViewMode;
}

interface TapRipple {
  x: number;
  y: number;
  elapsed: number;
  duration: number;
}

interface UnitAnimOverride {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  elapsed: number;
  duration: number;
  arcHeight: number;
}

interface ProjectileAnim {
  from: GridPos;
  to: GridPos;
  elapsed: number;
  duration: number;
  color: string;
  lobbed: boolean;
  arc: string;
  attackerKind: string;
}

interface PhaseBanner {
  text: string;
  tone: 'player' | 'enemy' | 'victory' | 'defeat';
  elapsed: number;
  duration: number;
}

interface TacticalCache {
  key: string;
  selectedUnit: BattleUnit | undefined;
  inspectedEnemy: BattleUnit | undefined;
  movableMap: Map<string, ReachableNode>;
  movableKeys: Set<string>;
  jumpMap: Map<string, JumpOption>;
  jumpKeys: Set<string>;
  dashList: DashOption[];
  dashEnemyIds: Set<string>;
  attackTiles: GridPos[];
  attackKeySet: Set<string>;
  isProjectingFromMove: boolean;
  weaponRangeKeys: Set<string>;
  enemyThreat: { moveKeys: Set<string>; attackKeys: Set<string> } | null;
  abilityTiles: GridPos[];
  abilityKeySet: Set<string>;
  abilityZoneKeys: Set<string>;
  itemTiles: GridPos[];
  itemKeySet: Set<string>;
  aoePreviewKeys: Set<string>;
  doneUnitIds: Set<string>;
  focusForecast: CombatForecast | null;
  focusCoverBadges: AdjacentCoverBadge[] | null;
}

const INK = '#452a16';
const MIN_ZOOM = 0.78;
const MAX_ZOOM = 2.25;
const MOUSE_DRAG_THRESHOLD_PX = 8;
const TOUCH_DRAG_THRESHOLD_PX = 18;

const STANDEE_HIT_HEIGHTS: Record<string, number> = {
  potato: 68,
  pea: 76,
  lemon: 64,
  chili: 66,
  carrot: 76,
  blackberry: 68,
  corn: 76,
  lettuce: 68,
  cow: 74,
  pig: 70,
  rooster: 80,
  sheep: 76,
  goat: 80,
  digger: 94,
  digger_heavy: 88,
  trimmer: 98,
  sprayer: 88,
  mower: 72,
  scarecrow: 118,
  harvester: 122,
  tractor: 102,
};

// Shared neighbor offsets matching edge i -> (i+1)%4 of getTileDiamond() in BOTH topdown & iso!
const EDGE_NEIGHBORS: ReadonlyArray<readonly [number, number]> = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];

export class PaperCraftRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private getState: () => RendererViewState | null;
  private onHoverChange: (pos: GridPos | null) => void;
  private onTileTap: (pos: GridPos, pointerType: string) => void;
  private onOffBoardTap?: () => void;
  private onZoomChange?: (zoomPercent: number) => void;

  private rafId = 0;
  private lastTime = 0;
  private elapsedTotal = 0;
  private metrics: IsoMetrics | null = null;
  private resizeObserver: ResizeObserver;
  private cssW = 280;
  private cssH = 220;
  private dpr = 1;

  // Multi-touch Pan & Pinch-Zoom Camera State
  private camera: CameraTransform = { panX: 0, panY: 0, zoom: 1 };
  private targetCamera: CameraTransform = { panX: 0, panY: 0, zoom: 1 };
  private lastReportedZoom = 100;
  private activePointers = new Map<number, { x: number; y: number; type: string }>();
  private downPoint: { x: number; y: number } | null = null;
  private isDragging = false;
  private didPinch = false;
  private lastPinchDist = 0;
  private lastPinchMid: { x: number; y: number } | null = null;
  private initializedMobileZoom = false;

  private particles = new ParticleSystem();
  private unitAnims = new Map<string, UnitAnimOverride>();
  private hitFlashes = new Map<string, number>();
  private unitSquashes = new Map<string, number>();
  private projectiles: ProjectileAnim[] = [];
  private tapRipples: TapRipple[] = [];
  private banner: PhaseBanner | null = null;
  private shakeTimer = 0;
  private shakeMagnitude = 0;

  private woodBgCanvas: HTMLCanvasElement | null = null;
  private woodBgW = 0;
  private woodBgH = 0;
  private woodDeskImg: HTMLImageElement | null = null;
  // The static wood desk is shown as the canvas element's CSS background instead of being
  // redrawn every frame. A full-screen drawImage at Retina resolution was the single most
  // expensive thing in the frame (it roughly halved the frame rate on 2x displays).
  private appliedBackdrop: HTMLCanvasElement | null = null;
  private pendingBackdrop: HTMLCanvasElement | null = null;
  private backdropUrl: string | null = null;
  private wcBoardPattern: CanvasPattern | null = null;
  private paperPattern: CanvasPattern | null = null;
  private dangerHatchPattern: CanvasPattern | null = null;

  // Static corrugated cardboard board cache (rebuilt only on zoom/resize/viewMode/cover-change; pan is free!)
  private boardBgCanvas: HTMLCanvasElement | null = null;
  private boardBgKey = '';
  private boardBgOffsetX = 0;
  private boardBgOffsetY = 0;
  private boardBgW = 0;
  private boardBgH = 0;
  private boardSunbeamTiles: GridPos[] = [];
  private tacticalCache: TacticalCache | null = null;

  constructor(
    canvas: HTMLCanvasElement,
    getState: () => RendererViewState | null,
    onHoverChange: (pos: GridPos | null) => void,
    onTileTap: (pos: GridPos, pointerType: string) => void,
    onOffBoardTap?: () => void,
    onZoomChange?: (zoomPercent: number) => void
  ) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D Canvas context unavailable');
    this.ctx = ctx;
    this.getState = getState;
    this.onHoverChange = onHoverChange;
    this.onTileTap = onTileTap;
    this.onOffBoardTap = onOffBoardTap;
    this.onZoomChange = onZoomChange;

    preloadPaperCraftSprites();
    this.buildPaperGrainPattern();
    this.buildDangerHatchPattern();
    this.preloadWatercolorUiTextures();

    this.handlePointerDown = this.handlePointerDown.bind(this);
    this.handlePointerMove = this.handlePointerMove.bind(this);
    this.handlePointerUp = this.handlePointerUp.bind(this);
    this.handlePointerCancel = this.handlePointerCancel.bind(this);
    this.handlePointerLeave = this.handlePointerLeave.bind(this);
    this.handleWheel = this.handleWheel.bind(this);
    this.handleGesture = this.handleGesture.bind(this);
    this.handleWindowBlur = this.handleWindowBlur.bind(this);
    this.handleVisibilityChange = this.handleVisibilityChange.bind(this);
    this.loop = this.loop.bind(this);

    canvas.addEventListener('pointerdown', this.handlePointerDown);
    canvas.addEventListener('pointermove', this.handlePointerMove);
    canvas.addEventListener('pointerup', this.handlePointerUp);
    canvas.addEventListener('pointercancel', this.handlePointerCancel);
    canvas.addEventListener('pointerleave', this.handlePointerLeave);
    canvas.addEventListener('wheel', this.handleWheel, { passive: false });
    canvas.addEventListener('gesturestart', this.handleGesture, { passive: false });
    canvas.addEventListener('gesturechange', this.handleGesture, { passive: false });
    window.addEventListener('blur', this.handleWindowBlur);
    document.addEventListener('visibilitychange', this.handleVisibilityChange);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    this.resize();

    this.lastTime = performance.now();
    this.rafId = requestAnimationFrame(this.loop);
  }

  public destroy(): void {
    cancelAnimationFrame(this.rafId);
    this.clearCssBackdrop();
    this.resizeObserver.disconnect();
    this.canvas.removeEventListener('pointerdown', this.handlePointerDown);
    this.canvas.removeEventListener('pointermove', this.handlePointerMove);
    this.canvas.removeEventListener('pointerup', this.handlePointerUp);
    this.canvas.removeEventListener('pointercancel', this.handlePointerCancel);
    this.canvas.removeEventListener('pointerleave', this.handlePointerLeave);
    this.canvas.removeEventListener('wheel', this.handleWheel);
    this.canvas.removeEventListener('gesturestart', this.handleGesture);
    this.canvas.removeEventListener('gesturechange', this.handleGesture);
    window.removeEventListener('blur', this.handleWindowBlur);
    document.removeEventListener('visibilitychange', this.handleVisibilityChange);
  }

  public cancelActiveAnims(): void {
    this.unitAnims.clear();
    this.projectiles = [];
  }

  private handleVisibilityChange(): void {
    if (typeof document !== 'undefined' && document.hidden) {
      this.handleWindowBlur();
    }
  }

  private buildDangerHatchPattern(): void {
    const c = document.createElement('canvas');
    c.width = 16;
    c.height = 16;
    const g = c.getContext('2d')!;
    g.strokeStyle = 'rgba(182, 26, 20, 0.52)';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(-4, 16);
    g.lineTo(16, -4);
    g.moveTo(4, 20);
    g.lineTo(20, 4);
    g.stroke();
    g.strokeStyle = 'rgba(255, 248, 232, 0.34)';
    g.lineWidth = 1.2;
    g.beginPath();
    g.moveTo(-2, 16);
    g.lineTo(16, -2);
    g.moveTo(6, 20);
    g.lineTo(20, 6);
    g.stroke();
    this.dangerHatchPattern = this.ctx.createPattern(c, 'repeat');
  }

  private handleWindowBlur(): void {
    this.activePointers.clear();
    this.downPoint = null;
    this.isDragging = false;
    this.didPinch = false;
    this.lastPinchDist = 0;
    this.lastPinchMid = null;
    this.onHoverChange(null);
  }

  private reportZoom(): void {
    const pct = Math.round(this.targetCamera.zoom * 100);
    if (pct !== this.lastReportedZoom) {
      this.lastReportedZoom = pct;
      this.onZoomChange?.(pct);
    }
  }

  public resetCamera(viewMode?: BoardViewMode): void {
    const rect = this.canvas.getBoundingClientRect();
    const activeView = viewMode ?? this.getState()?.viewMode ?? 'topdown';
    // Vertical topdown fits portrait screens cleanly at 1.0x; iso gets a subtle boost on narrow phones
    const defaultZoom = rect.width < 768 && activeView === 'iso' ? 1.15 : 1;
    this.targetCamera = { panX: 0, panY: 0, zoom: defaultZoom };
    this.reportZoom();
  }

  public adjustZoom(delta: number, immediate = false): void {
    const next = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, this.targetCamera.zoom + delta));
    this.targetCamera.zoom = next;
    if (immediate) {
      this.camera.zoom = next;
    }
    this.clampCamera(this.targetCamera);
    if (immediate) {
      this.camera.panX = this.targetCamera.panX;
      this.camera.panY = this.targetCamera.panY;
    }
    this.reportZoom();
  }

  public focusOnGrid(pos: GridPos): void {
    const vs = this.getState();
    if (!vs) return;
    const rect = this.canvas.getBoundingClientRect();
    // Only auto-pan when zoomed in past 1.12x so standard fit-to-screen vertical views stay rock-steady
    if (this.targetCamera.zoom <= 1.12) return;

    const unpanned = computeIsoMetrics(
      rect.width,
      rect.height,
      vs.battle.width,
      vs.battle.height,
      {
        panX: 0,
        panY: 0,
        zoom: this.targetCamera.zoom,
      },
      vs.viewMode
    );
    const pt = gridToScreen(pos.x, pos.y, unpanned);
    const desiredX = rect.width * 0.5 - pt.x;
    const desiredY = rect.height * 0.45 - pt.y;
    this.targetCamera.panX = desiredX;
    this.targetCamera.panY = desiredY;
    this.clampCamera(this.targetCamera);
  }

  private clampCamera(cam: CameraTransform): void {
    const w = this.cssW > 0 ? this.cssW : this.canvas.getBoundingClientRect().width;
    const h = this.cssH > 0 ? this.cssH : this.canvas.getBoundingClientRect().height;
    const maxPanX = Math.max(100, w * 0.46 * cam.zoom);
    const maxPanY = Math.max(100, h * 0.44 * cam.zoom);
    cam.panX = Math.max(-maxPanX, Math.min(maxPanX, cam.panX));
    cam.panY = Math.max(-maxPanY, Math.min(maxPanY, cam.panY));
  }

  private buildPaperGrainPattern(): void {
    const c = document.createElement('canvas');
    c.width = 96;
    c.height = 96;
    const g = c.getContext('2d');
    if (!g) return;
    const img = g.createImageData(96, 96);
    for (let i = 0; i < img.data.length; i += 4) {
      const n = (Math.random() - 0.5) * 44;
      const v = n > 0 ? 255 : 42;
      img.data[i] = v;
      img.data[i + 1] = v;
      img.data[i + 2] = v;
      img.data[i + 3] = Math.abs(n) * 0.5;
    }
    g.putImageData(img, 0, 0);
    this.paperPattern = this.ctx.createPattern(c, 'repeat');
  }

  private preloadWatercolorUiTextures(): void {
    if (typeof Image === 'undefined') return;
    const desk = new Image();
    desk.src = '/ui/wood-desk.jpg';
    desk.onload = () => {
      this.woodDeskImg = desk;
      this.woodBgCanvas = null; // Rebuild cached backdrop with painted watercolor desk!
    };

    const bloom = new Image();
    bloom.src = '/ui/wc-bloom.png';
    bloom.onload = () => {
      this.wcBoardPattern = this.ctx.createPattern(bloom, 'repeat');
      this.boardBgKey = ''; // Rebuild cached board with watercolor bloom!
    };
  }

  private ensureWoodBackdrop(w: number, h: number): HTMLCanvasElement {
    if (this.woodBgCanvas && this.woodBgW === w && this.woodBgH === h) {
      return this.woodBgCanvas;
    }
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.floor(w));
    c.height = Math.max(1, Math.floor(h));
    const g = c.getContext('2d')!;

    if (this.woodDeskImg && this.woodDeskImg.complete && this.woodDeskImg.naturalWidth > 0) {
      // Draw hand-painted watercolor honey-oak tabletop with cover-fit scaling
      const iw = this.woodDeskImg.naturalWidth;
      const ih = this.woodDeskImg.naturalHeight;
      const scale = Math.max(w / iw, h / ih);
      const dw = iw * scale;
      const dh = ih * scale;
      g.drawImage(this.woodDeskImg, (w - dw) / 2, (h - dh) / 2, dw, dh);
    } else {
      const baseGrad = g.createRadialGradient(
        w * 0.5,
        h * 0.44,
        Math.min(w, h) * 0.08,
        w * 0.5,
        h * 0.48,
        Math.max(w, h) * 0.78
      );
      baseGrad.addColorStop(0, '#d8a66e');
      baseGrad.addColorStop(0.46, '#b9804a');
      baseGrad.addColorStop(0.8, '#895529');
      baseGrad.addColorStop(1, '#543014');
      g.fillStyle = baseGrad;
      g.fillRect(0, 0, w, h);

      g.save();
      for (let y = 0; y < h; y += 22) {
        const shade = Math.sin(y * 0.05) * 0.5 + 0.5;
        g.strokeStyle =
          shade > 0.5 ? 'rgba(255, 224, 178, 0.08)' : 'rgba(68, 34, 11, 0.09)';
        g.lineWidth = 6 + (y % 9);
        g.beginPath();
        g.moveTo(-20, y);
        g.bezierCurveTo(
          w * 0.33,
          y + Math.sin(y * 0.08) * 10,
          w * 0.66,
          y - Math.cos(y * 0.07) * 10,
          w + 20,
          y + 3
        );
        g.stroke();
      }
      g.restore();
    }

    const vig = g.createRadialGradient(
      w * 0.5,
      h * 0.46,
      Math.min(w, h) * 0.28,
      w * 0.5,
      h * 0.5,
      Math.max(w, h) * 0.78
    );
    vig.addColorStop(0, 'rgba(255, 246, 224, 0.06)');
    vig.addColorStop(1, 'rgba(38, 18, 5, 0.36)');
    g.fillStyle = vig;
    g.fillRect(0, 0, w, h);

    this.woodBgCanvas = c;
    this.woodBgW = w;
    this.woodBgH = h;
    return c;
  }

  private applyCssBackdrop(wood: HTMLCanvasElement): void {
    if (this.pendingBackdrop === wood || typeof wood.toBlob !== 'function') return;
    this.pendingBackdrop = wood;
    wood.toBlob((blob) => {
      if (this.pendingBackdrop !== wood) return;
      this.pendingBackdrop = null;
      // A newer backdrop (resize / texture load) replaced this one while encoding.
      if (!blob || this.woodBgCanvas !== wood) return;
      const url = URL.createObjectURL(blob);
      const style = this.canvas.style;
      style.backgroundImage = `url("${url}")`;
      style.backgroundSize = '100% 100%';
      style.backgroundRepeat = 'no-repeat';
      if (this.backdropUrl) URL.revokeObjectURL(this.backdropUrl);
      this.backdropUrl = url;
      // Only switch to clearRect once the image is decoded, so there is never a blank frame.
      const img = new Image();
      img.src = url;
      const done = () => {
        if (this.backdropUrl === url) this.appliedBackdrop = wood;
      };
      img.decode().then(done, done);
    });
  }

  private clearCssBackdrop(): void {
    this.pendingBackdrop = null;
    this.appliedBackdrop = null;
    this.canvas.style.backgroundImage = '';
    if (this.backdropUrl) {
      URL.revokeObjectURL(this.backdropUrl);
      this.backdropUrl = null;
    }
  }

  private resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(280, Math.floor(rect.width));
    const h = Math.max(220, Math.floor(rect.height));
    this.cssW = w;
    this.cssH = h;
    this.dpr = dpr;

    if (!this.initializedMobileZoom && w > 0) {
      this.initializedMobileZoom = true;
      const activeView = this.getState()?.viewMode ?? 'topdown';
      if (w < 768 && activeView === 'iso') {
        this.camera.zoom = 1.15;
        this.targetCamera.zoom = 1.15;
      }
      this.reportZoom();
    }

    const pxW = Math.floor(w * dpr);
    const pxH = Math.floor(h * dpr);
    if (this.canvas.width !== pxW || this.canvas.height !== pxH) {
      this.canvas.width = pxW;
      this.canvas.height = pxH;
      this.boardBgKey = '';
    }
  }

  private getCanvasLocalPoint(e: PointerEvent | WheelEvent): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  /**
   * Smart 2.5D hit-tester: checks front-to-back die-cut unit standees & tall rescue cages
   * BEFORE falling back to flat floor tiles, so tapping a farmer's head or torso on mobile
   * always selects that unit accurately instead of the grass tile behind them!
   */
  private pickGridPos(sx: number, sy: number, vs: RendererViewState): GridPos | null {
    const m = this.metrics;
    if (!m) return null;
    const { battle } = vs;

    const floorPos = screenToGrid(sx, sy, m, battle.width, battle.height);
    if (floorPos && unitAt(battle, floorPos)) {
      return floorPos;
    }

    const sprScale = m.viewMode === 'topdown' ? m.scale * 0.85 : m.scale;
    const aliveSorted = battle.units
      .filter((u) => u.alive)
      .sort((a, b) => {
        const da = m.viewMode === 'topdown' ? a.pos.y : a.pos.x + a.pos.y;
        const db = m.viewMode === 'topdown' ? b.pos.y : b.pos.x + b.pos.y;
        return db - da; // Front-most standee wins first!
      });

    for (const u of aliveSorted) {
      const pt = gridToScreen(u.pos.x, u.pos.y, m);
      const footY = pt.y + (m.viewMode === 'topdown' ? m.tileH * 0.2 : 0);
      const h = (STANDEE_HIT_HEIGHTS[u.visualKind] ?? 72) * sprScale * 0.88;
      const halfW = (u.isBoss ? 24 : u.isAnimal ? 22 : 18) * sprScale;
      if (sx >= pt.x - halfW && sx <= pt.x + halfW && sy >= footY - h && sy <= footY + 6 * sprScale) {
        return { ...u.pos };
      }
    }

    // Check tall Rescue Cage standee banner too
    for (let y = battle.height - 1; y >= 0; y--) {
      for (let x = battle.width - 1; x >= 0; x--) {
        const cov = battle.tiles[y][x].cover;
        if (!cov?.isObjectiveCage) continue;
        const pt = gridToScreen(x, y, m);
        const footY = pt.y + (m.viewMode === 'topdown' ? m.tileH * 0.1 : 0);
        const halfW = m.tileW * 0.44;
        if (sx >= pt.x - halfW && sx <= pt.x + halfW && sy >= footY - 64 * sprScale && sy <= footY + 8 * sprScale) {
          return { x, y };
        }
      }
    }

    return floorPos;
  }

  private handlePointerDown(e: PointerEvent): void {
    // Ignore secondary/right-click (and macOS two-finger tap / Ctrl-click) so context menus never leave stuck pointers!
    if (e.pointerType === 'mouse' && (e.button !== 0 || e.ctrlKey)) {
      return;
    }

    const pt = this.getCanvasLocalPoint(e);
    this.activePointers.set(e.pointerId, { x: pt.x, y: pt.y, type: e.pointerType });
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      // ignore if capture not supported
    }

    if (this.activePointers.size === 1) {
      this.downPoint = { x: pt.x, y: pt.y };
      this.isDragging = false;
      this.didPinch = false;
    } else if (this.activePointers.size === 2) {
      this.didPinch = true;
      this.isDragging = true;
      const pts = Array.from(this.activePointers.values());
      this.lastPinchDist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
      this.lastPinchMid = {
        x: (pts[0].x + pts[1].x) / 2,
        y: (pts[0].y + pts[1].y) / 2,
      };
    }
  }

  private handlePointerMove(e: PointerEvent): void {
    // Auto-heal any stuck mouse pointer if button was released outside canvas/during macOS gestures
    if (e.pointerType === 'mouse' && (e.buttons & 1) === 0 && this.activePointers.has(e.pointerId)) {
      this.activePointers.delete(e.pointerId);
      if (this.activePointers.size === 0) {
        this.downPoint = null;
        this.isDragging = false;
        this.didPinch = false;
      }
    }

    const pt = this.getCanvasLocalPoint(e);
    const prev = this.activePointers.get(e.pointerId);

    if (prev) {
      const dx = pt.x - prev.x;
      const dy = pt.y - prev.y;
      prev.x = pt.x;
      prev.y = pt.y;

      if (this.activePointers.size === 2) {
        const pts = Array.from(this.activePointers.values());
        const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
        const mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };

        if (this.lastPinchDist > 10 && this.lastPinchMid) {
          const zoomRatio = dist / this.lastPinchDist;
          const nextZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, this.targetCamera.zoom * zoomRatio));
          this.targetCamera.zoom = nextZoom;
          this.camera.zoom = nextZoom;

          this.targetCamera.panX += mid.x - this.lastPinchMid.x;
          this.targetCamera.panY += mid.y - this.lastPinchMid.y;
          this.clampCamera(this.targetCamera);
          this.camera.panX = this.targetCamera.panX;
          this.camera.panY = this.targetCamera.panY;
          this.reportZoom();
        }
        this.lastPinchDist = dist;
        this.lastPinchMid = mid;
        return;
      }

      if (this.activePointers.size === 1 && this.downPoint && !this.didPinch) {
        const moved = Math.hypot(pt.x - this.downPoint.x, pt.y - this.downPoint.y);
        const dragThreshold =
          e.pointerType === 'mouse' ? MOUSE_DRAG_THRESHOLD_PX : TOUCH_DRAG_THRESHOLD_PX;
        if (moved > dragThreshold) {
          this.isDragging = true;
        }
        if (this.isDragging) {
          this.targetCamera.panX += dx;
          this.targetCamera.panY += dy;
          this.clampCamera(this.targetCamera);
          this.camera.panX = this.targetCamera.panX;
          this.camera.panY = this.targetCamera.panY;
          return;
        }
      }
    }

    if (e.pointerType === 'mouse' && this.activePointers.size === 0) {
      const vs = this.getState();
      if (!vs || !this.metrics) return;
      const gridPos = this.pickGridPos(pt.x, pt.y, vs);
      this.onHoverChange(gridPos);
    }
  }

  private handlePointerUp(e: PointerEvent): void {
    const hadPointer = this.activePointers.delete(e.pointerId);
    try {
      if (this.canvas.hasPointerCapture?.(e.pointerId)) {
        this.canvas.releasePointerCapture(e.pointerId);
      }
    } catch {
      // ignore if capture not supported
    }
    if (!hadPointer) return;

    const pt = this.getCanvasLocalPoint(e);
    const wasDragging = this.isDragging || this.didPinch;

    if (this.activePointers.size === 0) {
      this.downPoint = null;
      this.isDragging = false;
      this.lastPinchDist = 0;
      this.lastPinchMid = null;
      const hadPinch = this.didPinch;
      this.didPinch = false;

      if (!wasDragging && !hadPinch) {
        const vs = this.getState();
        if (!vs || !this.metrics) return;
        const gridPos = this.pickGridPos(pt.x, pt.y, vs);
        this.tapRipples.push({ x: pt.x, y: pt.y, elapsed: 0, duration: 0.28 });
        if (gridPos) {
          this.onTileTap(gridPos, e.pointerType);
        } else {
          // Clicking/tapping outside the board cleanly deselects & dismisses active focus!
          this.onOffBoardTap?.();
        }
      }
    }
  }

  private handlePointerCancel(e: PointerEvent): void {
    this.activePointers.delete(e.pointerId);
    try {
      if (this.canvas.hasPointerCapture?.(e.pointerId)) {
        this.canvas.releasePointerCapture(e.pointerId);
      }
    } catch {
      // ignore if capture not supported
    }
    if (this.activePointers.size === 0) {
      this.downPoint = null;
      this.isDragging = false;
      this.didPinch = false;
      this.lastPinchDist = 0;
      this.lastPinchMid = null;
    } else if (this.activePointers.size === 1) {
      const remaining = Array.from(this.activePointers.values())[0];
      this.downPoint = { x: remaining.x, y: remaining.y };
      this.didPinch = false;
      this.isDragging = false;
      this.lastPinchDist = 0;
      this.lastPinchMid = null;
    }
  }

  private handlePointerLeave(e: PointerEvent): void {
    if (e.pointerType === 'mouse') {
      this.onHoverChange(null);
    }
  }

  private handleGesture(e: Event): void {
    // Prevent Safari on macOS from hijacking trackpad pinch-to-zoom on the page viewport
    e.preventDefault();
  }

  private handleWheel(e: WheelEvent): void {
    e.preventDefault();
    if (e.deltaX === 0 && e.deltaY === 0) return;

    const unitScale = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
    const dx = e.deltaX * unitScale;
    const dy = e.deltaY * unitScale;

    // macOS trackpad pinch-to-zoom sends wheel events with ctrlKey=true
    if (e.ctrlKey) {
      const zoomDelta = Math.max(-0.18, Math.min(0.18, -dy * 0.01));
      this.adjustZoom(zoomDelta, true);
      return;
    }

    // Discrete mouse wheel (line mode or vertical-only notched ticks)
    const isDiscreteMouseWheel =
      e.deltaMode !== 0 || (dx === 0 && Math.abs(dy) >= 40 && Number.isInteger(dy));
    if (isDiscreteMouseWheel) {
      const zoomDelta = Math.max(-0.14, Math.min(0.14, -dy * 0.0014));
      this.adjustZoom(zoomDelta);
      return;
    }

    // Smooth macOS trackpad two-finger scroll: pan the tabletop smoothly (use trackpad pinch to zoom)
    this.targetCamera.panX -= dx;
    this.targetCamera.panY -= dy;
    this.clampCamera(this.targetCamera);
    this.camera.panX = this.targetCamera.panX;
    this.camera.panY = this.targetCamera.panY;
  }

  public consumeEvents(events: BattleEvent[]): void {
    if (!this.metrics || events.length === 0) return;
    const m = this.metrics;

    for (const ev of events) {
      switch (ev.type) {
        case 'move': {
          if (ev.path.length >= 2) {
            const first = ev.path[0];
            const last = ev.path[ev.path.length - 1];
            this.unitAnims.set(ev.unitId, {
              fromX: first.x,
              fromY: first.y,
              toX: last.x,
              toY: last.y,
              elapsed: 0,
              duration: 0.24,
              arcHeight: 16,
            });
            this.focusOnGrid(last);
            sfx.step();
          }
          break;
        }

        case 'dash': {
          this.unitAnims.set(ev.unitId, {
            fromX: ev.from.x,
            fromY: ev.from.y,
            toX: ev.to.x,
            toY: ev.to.y,
            elapsed: 0,
            duration: 0.22,
            arcHeight: 10,
          });
          this.hitFlashes.set(ev.targetId, 1);
          this.unitSquashes.set(ev.targetId, 1);
          this.triggerShake(4.5, 0.16);
          this.focusOnGrid(ev.targetPos);
          const pt = gridToScreen(ev.targetPos.x, ev.targetPos.y, m);
          this.particles.spawnBurst(pt.x, pt.y - 24 * m.scale, ['#ff7b29', '#ffd166', '#fbf3df'], 15, 'rect');
          this.particles.spawnPopup(
            pt.x,
            pt.y - 54 * m.scale,
            `DASH! -${ev.damage}`,
            '#9c2c0e',
            '#ffe5b4',
            1.1
          );
          sfx.dash();
          break;
        }

        case 'jump': {
          this.unitAnims.set(ev.unitId, {
            fromX: ev.from.x,
            fromY: ev.from.y,
            toX: ev.to.x,
            toY: ev.to.y,
            elapsed: 0,
            duration: 0.44,
            arcHeight: 82,
          });
          this.unitSquashes.set(ev.unitId, 1);
          this.focusOnGrid(ev.to);
          const allyPt = gridToScreen(ev.allyPos.x, ev.allyPos.y, m);
          const destPt = gridToScreen(ev.to.x, ev.to.y, m);
          this.particles.spawnBurst(allyPt.x, allyPt.y - 18 * m.scale, ['#f6d55c', '#fbf3df'], 12, 'circle');
          this.particles.spawnPopup(allyPt.x, allyPt.y - 58 * m.scale, 'TEAM JUMP!', '#6b4700', '#fff4b8', 1.08);
          if (ev.coopBoost) {
            this.particles.spawnBurst(destPt.x, destPt.y - 24 * m.scale, ['#fce078', '#ff9234', '#fbf3df'], 14, 'circle');
            this.particles.spawnPopup(destPt.x, destPt.y - 72 * m.scale, ev.coopBoost, '#8a3c00', '#ffe994', 1.12);
          }
          sfx.jump();
          break;
        }

        case 'knockback': {
          if (!ev.bumped) {
            this.unitAnims.set(ev.unitId, {
              fromX: ev.from.x,
              fromY: ev.from.y,
              toX: ev.to.x,
              toY: ev.to.y,
              elapsed: 0,
              duration: 0.2,
              arcHeight: 14,
            });
            this.unitSquashes.set(ev.unitId, 0.9);
            const pt = gridToScreen(ev.to.x, ev.to.y, m);
            this.particles.spawnBurst(pt.x, pt.y - 14 * m.scale, ['#fbf3df', '#d9c095'], 9, 'circle');
          } else {
            this.hitFlashes.set(ev.unitId, 1);
            this.unitSquashes.set(ev.unitId, 1);
            if (ev.bumpedUnitId) {
              this.hitFlashes.set(ev.bumpedUnitId, 1);
              this.unitSquashes.set(ev.bumpedUnitId, 1);
            }
            this.triggerShake(6.5, 0.22);
            const pt = gridToScreen(ev.to.x, ev.to.y, m);
            this.particles.spawnBurst(pt.x, pt.y - 24 * m.scale, ['#ff9f43', '#e53e30', '#fbf3df'], 18, 'rect');
            this.particles.spawnPopup(
              pt.x,
              pt.y - 78 * m.scale,
              `BUMP! -${ev.bumpDamage ?? 2}`,
              '#8a1c0b',
              '#ffe09e',
              1.15
            );
            sfx.coverBreak();
          }
          break;
        }

        case 'hazard': {
          const pt = gridToScreen(ev.pos.x, ev.pos.y, m);
          this.triggerShake(8, 0.26);
          if (ev.kind === 'beehive') {
            this.particles.spawnBurst(pt.x, pt.y - 24 * m.scale, ['#f6c945', '#452a16', '#fff2a6', '#e67e22'], 30, 'circle');
            this.particles.spawnPopup(pt.x, pt.y - 68 * m.scale, 'BEEHIVE BOOM! -3', '#7a3500', '#ffe985', 1.2);
            sfx.coverBreak();
          } else {
            this.particles.spawnBurst(pt.x, pt.y - 24 * m.scale, ['#5bc0eb', '#b8ebff', '#fbf3df'], 28, 'circle');
            this.particles.spawnPopup(pt.x, pt.y - 68 * m.scale, 'SPRINKLER BLAST!', '#0d4a6b', '#d9f6ff', 1.16);
            sfx.dash();
          }
          break;
        }

        case 'attack': {
          const lobbed = ev.arc === 'lobbed';
          this.projectiles.push({
            from: ev.from,
            to: ev.to,
            elapsed: 0,
            duration: lobbed ? 0.34 : ev.arc === 'melee' ? 0.16 : 0.22,
            color: lobbed ? '#f5d742' : ev.arc === 'melee' ? '#e59f47' : '#80d85a',
            lobbed,
            arc: ev.arc,
            attackerKind: ev.attackerKind,
          });
          this.focusOnGrid(ev.to);
          if (lobbed) sfx.lob();
          else sfx.shoot();

          const pt = gridToScreen(ev.to.x, ev.to.y, m);
          if (!ev.hit) {
            this.particles.spawnBurst(pt.x, pt.y - 18 * m.scale, ['#c89457', '#e6c28b'], 11, 'rect');
            this.particles.spawnPopup(pt.x, pt.y - 52 * m.scale, 'COVER BLOCK!', '#5d4037', '#f5e8d0');
            sfx.miss();
          } else {
            if (ev.targetId) {
              this.hitFlashes.set(ev.targetId, 1);
              this.unitSquashes.set(ev.targetId, 1);
            }
            const strong = ev.matchup === 'advantage';
            this.triggerShake(strong ? 6 : 3.2, strong ? 0.2 : 0.12);
            this.particles.spawnBurst(
              pt.x,
              pt.y - 26 * m.scale,
              strong ? ['#f6d55c', '#e53e30', '#fbf3df'] : ['#e53e30', '#fbf3df'],
              strong ? 18 : 12,
              'rect'
            );
            const label = strong
              ? `▲ STRONG! -${ev.damage}`
              : ev.matchup === 'disadvantage'
                ? `▼ WEAK -${ev.damage}`
                : `-${ev.damage}`;
            this.particles.spawnPopup(
              pt.x,
              pt.y - 56 * m.scale,
              label,
              strong ? '#8a1c0b' : '#4a2c17',
              strong ? '#ffe082' : '#fbf3df',
              strong ? 1.15 : 1
            );
            if (ev.status) {
              const statusLabels: Record<string, { text: string; fg: string; bg: string }> = {
                burn: { text: 'BURN!', fg: '#9c2c0e', bg: '#ffe0b2' },
                rooted: { text: 'ROOTED!', fg: '#1b5e20', bg: '#dcf5cc' },
                acid: { text: 'ACID +2!', fg: '#5a5000', bg: '#f4f7b2' },
                feared: { text: 'FEARED!', fg: '#5e1d7a', bg: '#f0d9ff' },
                shield: { text: 'SHIELD!', fg: '#124a78', bg: '#d4ecff' },
                boosted: { text: 'BOOST!', fg: '#7a4a00', bg: '#fff0b3' },
              };
              const stInfo = statusLabels[ev.status];
              if (stInfo) {
                this.particles.spawnPopup(pt.x, pt.y - 80 * m.scale, stInfo.text, stInfo.fg, stInfo.bg, 0.92);
              }
            }
            sfx.hit(strong);
          }
          break;
        }

        case 'ability':
        case 'item': {
          const pt = gridToScreen(ev.to.x, ev.to.y, m);
          const name = ev.type === 'ability' ? ev.abilityName : ev.itemName;
          const isHeal = Boolean(ev.heal && !ev.damage);
          this.particles.spawnBurst(
            pt.x,
            pt.y - 26 * m.scale,
            isHeal ? ['#66bb6a', '#b9f6ca', '#fbf3df'] : ['#ab47bc', '#ffd54f', '#fbf3df'],
            15,
            'circle'
          );
          const detail = isHeal
            ? `${name} +${ev.heal} HP`
            : ev.damage
              ? `${name} -${ev.damage}`
              : `${name}!`;
          this.particles.spawnPopup(
            pt.x,
            pt.y - 58 * m.scale,
            detail,
            isHeal ? '#1b5e20' : '#4a148c',
            isHeal ? '#dff7df' : '#f3e5f5',
            1.05
          );
          if (ev.status) {
            const stTag = ev.status.toUpperCase() + '!';
            this.particles.spawnPopup(pt.x, pt.y - 82 * m.scale, stTag, '#4a2c17', '#fff4cc', 0.9);
          }
          if (isHeal) sfx.heal();
          else sfx.hit(false);
          break;
        }

        case 'cover_break': {
          const pt = gridToScreen(ev.pos.x, ev.pos.y, m);
          const colors =
            ev.kind === 'haystack'
              ? ['#e7bd4c', '#f5de8a', '#b88625']
              : ['#c98d4b', '#96612c', '#e6c28b'];
          this.particles.spawnBurst(pt.x, pt.y - 18 * m.scale, colors, 24, 'rect');
          this.particles.spawnPopup(
            pt.x,
            pt.y - 46 * m.scale,
            ev.splashDamage ? `SMASH! +${ev.splashDamage} AoE` : 'CRUNCH!',
            '#6d3b12',
            '#fde9c9'
          );
          sfx.coverBreak();
          break;
        }

        case 'rescue': {
          const pt = gridToScreen(ev.pos.x, ev.pos.y, m);
          this.particles.spawnBurst(pt.x, pt.y - 26 * m.scale, ['#f6d55c', '#58b947', '#45b6db', '#fbf3df'], 28, 'rect');
          this.particles.spawnPopup(pt.x, pt.y - 62 * m.scale, `FREED ${ev.unitName}!`, '#1b5e20', '#fff7cc', 1.2);
          sfx.rescue();
          break;
        }

        case 'status_tick': {
          const pt = gridToScreen(ev.pos.x, ev.pos.y, m);
          this.hitFlashes.set(ev.unitId, 0.8);
          const tickPrefix =
            ev.status === 'burn'
              ? 'BURN'
              : ev.status === 'rooted'
                ? 'THORNS'
                : ev.status === 'acid'
                  ? 'PIERCE'
                  : 'SPLASH';
          this.particles.spawnBurst(pt.x, pt.y - 22 * m.scale, ['#ff7043', '#ffd54f', '#fbf3df'], 8, 'rect');
          this.particles.spawnPopup(
            pt.x,
            pt.y - 48 * m.scale,
            `${tickPrefix} -${ev.damage}`,
            '#9c1c12',
            '#ffe2d6'
          );
          break;
        }

        case 'heal': {
          const pt = gridToScreen(ev.pos.x, ev.pos.y, m);
          this.particles.spawnBurst(pt.x, pt.y - 24 * m.scale, ['#66bb6a', '#c8e6c9'], 10, 'circle');
          this.particles.spawnPopup(pt.x, pt.y - 52 * m.scale, `+${ev.amount} ${ev.source}`, '#1b5e20', '#e3f9e5');
          sfx.heal();
          break;
        }

        case 'unit_ko': {
          const pt = gridToScreen(ev.pos.x, ev.pos.y, m);
          this.particles.spawnBurst(pt.x, pt.y - 22 * m.scale, ['#fbf3df', '#d9483b', '#f6d55c'], 18, 'rect');
          this.particles.spawnPopup(
            pt.x,
            pt.y - 60 * m.scale,
            ev.team === 'player' ? 'HARVESTED!' : 'ROUTED!',
            '#7a1b12',
            '#ffdfd9',
            1.15
          );
          break;
        }

        case 'banner': {
          this.banner = {
            text: ev.text,
            tone: ev.tone,
            elapsed: 0,
            duration: ev.tone === 'victory' || ev.tone === 'defeat' ? 2.6 : 1.35,
          };
          if (ev.tone === 'victory') sfx.victory();
          if (ev.tone === 'defeat') sfx.defeat();
          break;
        }
      }
    }
  }

  private loop(now: number): void {
    const dt = Math.max(0, Math.min(0.05, (now - this.lastTime) / 1000));
    this.lastTime = now;

    // Skip CPU/GPU work when the browser tab is hidden
    if (typeof document !== 'undefined' && document.hidden) {
      this.rafId = requestAnimationFrame(this.loop);
      return;
    }

    this.elapsedTotal += dt;
    this.updateAnims(dt);
    this.render();
    this.rafId = requestAnimationFrame(this.loop);
  }

  private updateAnims(dt: number): void {
    const ease = Math.min(1, dt * 11);
    const dPanX = this.targetCamera.panX - this.camera.panX;
    const dPanY = this.targetCamera.panY - this.camera.panY;
    const dZoom = this.targetCamera.zoom - this.camera.zoom;

    this.camera.panX = Math.abs(dPanX) < 0.05 ? this.targetCamera.panX : this.camera.panX + dPanX * ease;
    this.camera.panY = Math.abs(dPanY) < 0.05 ? this.targetCamera.panY : this.camera.panY + dPanY * ease;
    this.camera.zoom = Math.abs(dZoom) < 0.0005 ? this.targetCamera.zoom : this.camera.zoom + dZoom * ease;

    this.particles.update(dt);

    for (const [id, anim] of this.unitAnims.entries()) {
      anim.elapsed += dt;
      if (anim.elapsed >= anim.duration) {
        this.unitAnims.delete(id);
      }
    }

    for (const [id, flash] of this.hitFlashes.entries()) {
      const next = flash - dt * 4.2;
      if (next <= 0) this.hitFlashes.delete(id);
      else this.hitFlashes.set(id, next);
    }

    for (const [id, sq] of this.unitSquashes.entries()) {
      const next = sq - dt * 3.8;
      if (next <= 0) this.unitSquashes.delete(id);
      else this.unitSquashes.set(id, next);
    }

    if (this.shakeTimer > 0) {
      this.shakeTimer = Math.max(0, this.shakeTimer - dt);
    }

    for (const proj of this.projectiles) {
      proj.elapsed += dt;
    }
    this.projectiles = this.projectiles.filter((p) => p.elapsed < p.duration);

    for (const r of this.tapRipples) {
      r.elapsed += dt;
    }
    this.tapRipples = this.tapRipples.filter((r) => r.elapsed < r.duration);

    if (this.banner) {
      this.banner.elapsed += dt;
      if (this.banner.elapsed >= this.banner.duration) {
        this.banner = null;
      }
    }
  }

  private triggerShake(magnitude: number, duration: number): void {
    this.shakeMagnitude = Math.max(this.shakeMagnitude, magnitude);
    this.shakeTimer = Math.max(this.shakeTimer, duration);
  }

  private buildTacticalKey(vs: RendererViewState, focusTile: GridPos | null): string {
    const { battle } = vs;
    const parts: string[] = [
      battle.mapName,
      String(battle.turn),
      battle.phase,
      battle.status,
      String(battle.width),
      String(battle.height),
      battle.relicIds.join(','),
      vs.selectedUnitId ?? '',
      vs.inspectedEnemyId ?? '',
      vs.showAllDangerZone ? '1' : '0',
      vs.mode,
      vs.selectedItemId ?? '',
      focusTile ? `${focusTile.x},${focusTile.y}` : '',
    ];

    for (const k in battle.items) {
      parts.push(`${k}=${battle.items[k]}`);
    }

    for (let i = 0; i < battle.units.length; i++) {
      const u = battle.units[i];
      const a = u.actions;
      const st = u.statuses.length > 0 ? u.statuses.map((s) => `${s.kind}${s.turns}`).join('.') : '';
      parts.push(
        `${u.id}:${u.alive ? 1 : 0}:${u.pos.x},${u.pos.y}:${u.hp}:${a.hasMoved ? 1 : 0}${a.hasDashed ? 1 : 0}${a.hasJumped ? 1 : 0}${a.hasAttacked ? 1 : 0}${a.hasUsedSkill ? 1 : 0}:${u.abilityCooldown}:${u.tempAttackBonus}:${st}:${u.graftIds.length}`
      );
    }

    for (let y = 0; y < battle.height; y++) {
      const row = battle.tiles[y];
      for (let x = 0; x < battle.width; x++) {
        const cov = row[x].cover;
        if (cov) {
          parts.push(`c${x},${y}:${cov.kind}:${cov.hp}`);
        }
      }
    }

    return parts.join('|');
  }

  private getTacticalCache(vs: RendererViewState, focusTile: GridPos | null, fKey: string | null): TacticalCache {
    const key = this.buildTacticalKey(vs, focusTile);
    if (this.tacticalCache && this.tacticalCache.key === key) {
      return this.tacticalCache;
    }

    const { battle, selectedUnitId, inspectedEnemyId, showAllDangerZone, mode, selectedItemId } = vs;

    const selectedUnit = selectedUnitId
      ? battle.units.find((u) => u.id === selectedUnitId && u.alive)
      : undefined;
    const inspectedEnemy = inspectedEnemyId
      ? battle.units.find((u) => u.id === inspectedEnemyId && u.alive && u.team === 'enemy')
      : undefined;

    const movableMap =
      selectedUnit && battle.phase === 'player' && mode === 'move'
        ? computeMovableTiles(battle, selectedUnit)
        : new Map<string, ReachableNode>();
    const movableKeys = new Set<string>(movableMap.keys());

    const jumpMap =
      selectedUnit && battle.phase === 'player' && mode === 'move'
        ? computeTeamJumpOptions(battle, selectedUnit)
        : new Map<string, JumpOption>();
    const jumpKeys = new Set<string>(jumpMap.keys());

    const dashList =
      selectedUnit && battle.phase === 'player' && mode === 'move'
        ? computeDashOptions(battle, selectedUnit)
        : [];
    const dashEnemyIds = new Set(dashList.map((d) => d.enemyId));

    const attackTiles =
      selectedUnit &&
      battle.phase === 'player' &&
      !selectedUnit.actions.hasAttacked &&
      (mode === 'attack' || mode === 'move')
        ? getAttackableTiles(battle, selectedUnit)
        : [];
    const attackKeySet = new Set(attackTiles.map(posKey));

    // Simultaneous subtle weapon range area (projects cleanly from previewed Move/Jump tile!)
    const isProjectingFromMove = Boolean(
      selectedUnit &&
        mode === 'move' &&
        focusTile &&
        fKey &&
        (movableKeys.has(fKey) || jumpKeys.has(fKey))
    );
    const weaponOrigin = isProjectingFromMove && focusTile ? focusTile : selectedUnit?.pos;
    const weaponRangeKeys =
      selectedUnit &&
      weaponOrigin &&
      battle.phase === 'player' &&
      !selectedUnit.actions.hasAttacked &&
      (mode === 'move' || mode === 'attack')
        ? new Set(getWeaponRangeTiles(battle, selectedUnit, weaponOrigin).map(posKey))
        : new Set<string>();

    // Enemy Threat Zone (Single inspected enemy OR Global All-Enemies Danger Toggle!)
    const enemyThreat = inspectedEnemy
      ? getEnemyThreatZone(battle, inspectedEnemy)
      : showAllDangerZone
        ? getAllEnemiesThreatZone(battle)
        : null;

    // Ability target tiles & full reach/aura area
    const abilityTiles =
      selectedUnit && battle.phase === 'player' && mode === 'ability'
        ? getAbilityTargetTiles(battle, selectedUnit)
        : [];
    const abilityKeySet = new Set(abilityTiles.map(posKey));
    const abilityZoneKeys = new Set<string>();
    if (selectedUnit && battle.phase === 'player' && mode === 'ability' && selectedUnit.ability) {
      const ab = selectedUnit.ability;
      if (ab.targetType === 'self' || ab.targetType === 'aoe_self') {
        const radius = ab.targetType === 'aoe_self' ? (ab.aoeRadius ?? 2) : 0;
        for (let y = 0; y < battle.height; y++) {
          for (let x = 0; x < battle.width; x++) {
            if (manhattan(selectedUnit.pos, { x, y }) <= radius) {
              abilityZoneKeys.add(posKey({ x, y }));
            }
          }
        }
      } else {
        for (let y = 0; y < battle.height; y++) {
          for (let x = 0; x < battle.width; x++) {
            if (manhattan(selectedUnit.pos, { x, y }) <= ab.range) {
              abilityZoneKeys.add(posKey({ x, y }));
            }
          }
        }
      }
    }

    const itemTiles =
      selectedUnit && battle.phase === 'player' && mode === 'item' && selectedItemId
        ? getItemTargetTiles(battle, selectedUnit, selectedItemId)
        : [];
    const itemKeySet = new Set(itemTiles.map(posKey));

    const aoePreviewKeys = new Set<string>();
    if (focusTile && fKey && selectedUnit && battle.phase === 'player') {
      let radius = 0;
      if (
        (mode === 'attack' || mode === 'move') &&
        attackKeySet.has(fKey) &&
        selectedUnit.weapon.aoeRadius
      ) {
        radius = selectedUnit.weapon.aoeRadius;
      } else if (
        mode === 'ability' &&
        abilityKeySet.has(fKey) &&
        selectedUnit.ability?.aoeRadius &&
        selectedUnit.ability.targetType !== 'aoe_self'
      ) {
        radius = selectedUnit.ability.aoeRadius;
      } else if (
        mode === 'item' &&
        selectedItemId &&
        itemKeySet.has(fKey) &&
        ITEM_REGISTRY[selectedItemId]?.aoeRadius
      ) {
        radius = ITEM_REGISTRY[selectedItemId].aoeRadius;
      }
      if (radius > 0) {
        for (let y = focusTile.y - radius; y <= focusTile.y + radius; y++) {
          for (let x = focusTile.x - radius; x <= focusTile.x + radius; x++) {
            if (
              x >= 0 &&
              y >= 0 &&
              x < battle.width &&
              y < battle.height &&
              chebyshev(focusTile, { x, y }) <= radius
            ) {
              aoePreviewKeys.add(posKey({ x, y }));
            }
          }
        }
      }
    }

    const doneUnitIds = new Set<string>();
    if (battle.phase === 'player') {
      for (const u of battle.units) {
        if (u.alive && u.team === 'player' && !unitHasMeaningfulAction(battle, u)) {
          doneUnitIds.add(u.id);
        }
      }
    }

    let focusForecast: CombatForecast | null = null;
    let focusCoverBadges: AdjacentCoverBadge[] | null = null;
    if (selectedUnit && battle.phase === 'player' && focusTile && fKey) {
      if (mode === 'move' && (jumpMap.has(fKey) || movableMap.has(fKey))) {
        focusCoverBadges = getAdjacentCoverBadges(battle, focusTile, 'player');
      } else if ((mode === 'attack' || mode === 'move') && attackKeySet.has(fKey)) {
        const focusedUnit = unitAt(battle, focusTile);
        const canDirectlyAttackFocus = Boolean(
          (focusedUnit && focusedUnit.team === 'enemy') ||
            mode === 'attack' ||
            tileAt(battle, focusTile)?.cover?.destructible
        );
        if (canDirectlyAttackFocus) {
          focusForecast = forecastAttack(battle, selectedUnit, focusTile);
        }
      }
    }

    const cache: TacticalCache = {
      key,
      selectedUnit,
      inspectedEnemy,
      movableMap,
      movableKeys,
      jumpMap,
      jumpKeys,
      dashList,
      dashEnemyIds,
      attackTiles,
      attackKeySet,
      isProjectingFromMove,
      weaponRangeKeys,
      enemyThreat,
      abilityTiles,
      abilityKeySet,
      abilityZoneKeys,
      itemTiles,
      itemKeySet,
      aoePreviewKeys,
      doneUnitIds,
      focusForecast,
      focusCoverBadges,
    };
    this.tacticalCache = cache;
    return cache;
  }

  private ensureBoardCache(
    battle: BattleState,
    w: number,
    h: number,
    dpr: number,
    viewMode: BoardViewMode
  ): HTMLCanvasElement {
    let coverMask = '';
    for (let y = 0; y < battle.height; y++) {
      const row = battle.tiles[y];
      for (let x = 0; x < battle.width; x++) {
        if (row[x].cover) coverMask += `${x},${y};`;
      }
    }

    const key = `${w}x${h}@${dpr}|${battle.mapName}|${battle.theme}|${battle.width}x${battle.height}|${viewMode}|${this.camera.zoom.toFixed(4)}|${this.wcBoardPattern ? 1 : 0}|${coverMask}`;
    if (this.boardBgCanvas && this.boardBgKey === key) {
      return this.boardBgCanvas;
    }

    const baseM = computeIsoMetrics(
      w,
      h,
      battle.width,
      battle.height,
      { panX: 0, panY: 0, zoom: this.camera.zoom },
      viewMode
    );

    const p0 = getTileDiamond(0, 0, baseM)[0];
    const p1 = getTileDiamond(battle.width - 1, 0, baseM)[1];
    const p2 = getTileDiamond(battle.width - 1, battle.height - 1, baseM)[2];
    const p3 = getTileDiamond(0, battle.height - 1, baseM)[3];

    const minX = Math.min(p0.x, p1.x, p2.x, p3.x);
    const maxX = Math.max(p0.x, p1.x, p2.x, p3.x);
    const minY = Math.min(p0.y, p1.y, p2.y, p3.y);
    const maxY = Math.max(p0.y, p1.y, p2.y, p3.y);

    const padX = Math.ceil(36 * baseM.scale);
    const padTop = Math.ceil(24 * baseM.scale);
    const padBot = Math.ceil(baseM.boardDepth + 46 * baseM.scale);

    const offsetX = Math.floor(minX - padX);
    const offsetY = Math.floor(minY - padTop);
    const bw = Math.max(1, Math.ceil(maxX + padX) - offsetX);
    const bh = Math.max(1, Math.ceil(maxY + padBot) - offsetY);

    // Stay safely within Safari / WebKit max GPU texture dimensions (4096px)
    const maxDim = 4096;
    const boardDpr = Math.min(dpr, maxDim / Math.max(bw, bh));
    const pxW = Math.max(1, Math.ceil(bw * boardDpr));
    const pxH = Math.max(1, Math.ceil(bh * boardDpr));

    if (!this.boardBgCanvas) {
      this.boardBgCanvas = document.createElement('canvas');
    }
    const c = this.boardBgCanvas;
    if (c.width !== pxW || c.height !== pxH) {
      c.width = pxW;
      c.height = pxH;
    }

    const g = c.getContext('2d')!;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, pxW, pxH);
    g.setTransform(boardDpr, 0, 0, boardDpr, -offsetX * boardDpr, -offsetY * boardDpr);

    // 2. Layered soft tabletop board shadow
    this.drawSoftBoardShadow(g, battle.width, battle.height, baseM);

    // 3. Corrugated Cardboard Tiles (collect animated sunbeam tiles for lightweight per-frame shimmer)
    const sunbeams: GridPos[] = [];
    for (let y = 0; y < battle.height; y++) {
      for (let x = 0; x < battle.width; x++) {
        const tile = battle.tiles[y][x];
        if (tile.terrain === 'sunbeam') sunbeams.push({ x, y });
        this.drawPaperCraftTile(g, battle, tile, baseM);
      }
    }

    // 4. Matte paper grain across board top surface + subtle outer die-cut cardstock frame
    this.applyBoardPaperTexture(g, battle.width, battle.height, baseM);
    this.drawBoardCardstockRim(g, battle.width, battle.height, baseM);

    this.boardSunbeamTiles = sunbeams;
    this.boardBgOffsetX = offsetX;
    this.boardBgOffsetY = offsetY;
    this.boardBgW = pxW / boardDpr;
    this.boardBgH = pxH / boardDpr;
    this.boardBgKey = key;
    return c;
  }

  private drawSunbeamOverlays(ctx: CanvasRenderingContext2D, m: IsoMetrics): void {
    if (this.boardSunbeamTiles.length === 0) return;
    const s = m.scale;
    ctx.save();
    ctx.font = `700 ${Math.round(9 * s)}px "Fredoka", sans-serif`;
    ctx.textAlign = 'center';
    for (const pos of this.boardSunbeamTiles) {
      const c = gridToScreen(pos.x, pos.y, m);
      const shimmer = 0.22 + Math.sin(this.elapsedTotal * 3.2 + pos.x) * 0.08;
      ctx.fillStyle = `rgba(255, 253, 214, ${shimmer})`;
      ctx.beginPath();
      ctx.ellipse(c.x, c.y, 16 * s, 9 * s, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#754600';
      ctx.fillText('☀ +2 ATK', c.x, c.y + 4 * s);
    }
    ctx.restore();
  }

  private render(): void {
    const liveDpr = Math.min(window.devicePixelRatio || 1, 2);
    if (liveDpr !== this.dpr) {
      this.resize();
    }

    const ctx = this.ctx;
    const dpr = this.dpr;
    const w = this.canvas.width / dpr;
    const h = this.canvas.height / dpr;

    ctx.save();
    ctx.scale(dpr, dpr);

    const wood = this.ensureWoodBackdrop(w, h);
    if (this.appliedBackdrop === wood) {
      ctx.clearRect(0, 0, w, h);
    } else {
      // Until the CSS background for this size is ready, paint the desk directly (old behaviour).
      ctx.drawImage(wood, 0, 0, w, h);
      this.applyCssBackdrop(wood);
    }

    if (this.shakeTimer > 0) {
      const decay = Math.min(1, this.shakeTimer / 0.22);
      const sx = (Math.random() - 0.5) * 2 * this.shakeMagnitude * decay;
      const sy = (Math.random() - 0.5) * 2 * this.shakeMagnitude * decay;
      ctx.translate(sx, sy);
    } else {
      this.shakeMagnitude = 0;
    }

    const vs = this.getState();
    if (!vs) {
      ctx.restore();
      return;
    }

    const {
      battle,
      selectedUnitId,
      inspectedEnemyId,
      mode,
      hoveredTile,
      previewTile,
      viewMode,
    } = vs;
    const focusTile = previewTile ?? hoveredTile;
    const fKey = focusTile ? posKey(focusTile) : null;
    const m = computeIsoMetrics(w, h, battle.width, battle.height, this.camera, viewMode);
    this.metrics = m;

    const tc = this.getTacticalCache(vs, focusTile, fKey);
    const {
      selectedUnit,
      inspectedEnemy,
      movableMap,
      movableKeys,
      jumpMap,
      jumpKeys,
      dashList,
      dashEnemyIds,
      attackTiles,
      attackKeySet,
      isProjectingFromMove,
      weaponRangeKeys,
      enemyThreat,
      abilityTiles,
      abilityKeySet,
      abilityZoneKeys,
      itemKeySet,
      aoePreviewKeys,
      doneUnitIds,
      focusForecast,
      focusCoverBadges,
    } = tc;

    // 2–4. Cached Soft Board Shadow + Corrugated Cardboard Tiles + Paper Texture + Cardstock Rim
    const boardCanvas = this.ensureBoardCache(battle, w, h, dpr, viewMode);
    ctx.drawImage(
      boardCanvas,
      this.boardBgOffsetX + this.camera.panX,
      this.boardBgOffsetY + this.camera.panY,
      this.boardBgW,
      this.boardBgH
    );
    this.drawSunbeamOverlays(ctx, m);

    // 5. Clean Unified Tactical Range Areas (subtle washes + crisp outer contours — ZERO messy internal lines!)
    // 5A. Enemy Threat Zone (high-contrast diagonal warning hatch + cream-backed dashed rim for colorblind clarity!)
    if (enemyThreat) {
      this.drawUnifiedZone(ctx, enemyThreat.attackKeys, battle, m, {
        fill: 'rgba(196, 36, 30, 0.16)',
        pattern: this.dangerHatchPattern,
        patternAlpha: 0.48,
        outerBackingColor: 'rgba(255, 248, 232, 0.78)',
        borderColor: 'rgba(176, 26, 20, 0.94)',
        borderWidth: 2.5 * m.scale,
        dash: [7 * m.scale, 4 * m.scale],
      });
      if (enemyThreat.moveKeys.size > 0) {
        this.drawUnifiedZone(ctx, enemyThreat.moveKeys, battle, m, {
          fill: 'rgba(244, 158, 42, 0.16)',
          outerBackingColor: 'rgba(255, 248, 224, 0.55)',
          borderColor: 'rgba(196, 102, 14, 0.82)',
          borderWidth: 1.8 * m.scale,
        });
      }
    }

    // 5B. Crisp Attack Area (unified wash + cream-backed crimson perimeter so it stays legible over grass!)
    if (weaponRangeKeys.size > 0 && !inspectedEnemy) {
      const explicitAim = mode === 'attack';
      this.drawUnifiedZone(ctx, weaponRangeKeys, battle, m, {
        fill: explicitAim
          ? 'rgba(206, 44, 36, 0.22)'
          : isProjectingFromMove
            ? 'rgba(208, 54, 42, 0.16)'
            : 'rgba(204, 48, 38, 0.12)',
        outerBackingColor: explicitAim
          ? 'rgba(255, 248, 232, 0.82)'
          : 'rgba(255, 248, 232, 0.58)',
        borderColor: explicitAim
          ? 'rgba(184, 30, 22, 0.94)'
          : isProjectingFromMove
            ? 'rgba(192, 42, 32, 0.82)'
            : 'rgba(186, 40, 30, 0.68)',
        borderWidth: (explicitAim ? 2.6 : 2.0) * m.scale,
      });
    }

    // 5C. Ally Move Area (clean sky-blue wash + outer perimeter)
    if (movableKeys.size > 0) {
      this.drawUnifiedZone(ctx, movableKeys, battle, m, {
        fill: 'rgba(92, 192, 226, 0.32)',
        outerBackingColor: 'rgba(42, 114, 146, 0.35)',
        borderColor: 'rgba(238, 251, 255, 0.92)',
        borderWidth: 2.1 * m.scale,
      });
    }

    // 5D. Ally Team-Jump Area (clean warm honey-gold wash + dashed perimeter)
    if (jumpKeys.size > 0) {
      this.drawUnifiedZone(ctx, jumpKeys, battle, m, {
        fill: 'rgba(246, 204, 68, 0.34)',
        outerBackingColor: 'rgba(148, 96, 12, 0.32)',
        borderColor: 'rgba(255, 246, 200, 0.92)',
        borderWidth: 2.1 * m.scale,
        dash: [6 * m.scale, 4 * m.scale],
      });
    }

    // 5E. Ability Area (plum reach / self-aura with dotted perimeter so it stays distinct from Move!)
    if (abilityZoneKeys.size > 0) {
      const isSelfAura =
        selectedUnit?.ability?.targetType === 'self' ||
        selectedUnit?.ability?.targetType === 'aoe_self';
      this.drawUnifiedZone(ctx, abilityZoneKeys, battle, m, {
        fill: isSelfAura ? 'rgba(148, 78, 214, 0.28)' : 'rgba(148, 78, 214, 0.17)',
        outerBackingColor: 'rgba(252, 244, 255, 0.78)',
        borderColor: 'rgba(114, 46, 178, 0.94)',
        borderWidth: 2.5 * m.scale,
        dash: [2.8 * m.scale, 4.5 * m.scale],
      });
    }

    // 5F. Item Area (high-contrast cream-teal wash + dash-dot perimeter so it pops cleanly over green grass!)
    if (itemKeySet.size > 0) {
      this.drawUnifiedZone(ctx, itemKeySet, battle, m, {
        fill: 'rgba(34, 178, 168, 0.28)',
        outerBackingColor: 'rgba(245, 255, 252, 0.82)',
        borderColor: 'rgba(18, 118, 114, 0.94)',
        borderWidth: 2.5 * m.scale,
        dash: [8 * m.scale, 4 * m.scale, 2 * m.scale, 4 * m.scale],
      });
    }

    // 5G. AoE Splash Preview Area
    if (aoePreviewKeys.size > 0) {
      this.drawUnifiedZone(ctx, aoePreviewKeys, battle, m, {
        fill: 'rgba(248, 134, 42, 0.32)',
        borderColor: '#fff2cc',
        borderWidth: 2.3 * m.scale,
      });
    }

    // 5H. Individual Tile Accents ONLY for: Active Hero Pedestal, Valid Actionable Targets, & Current Focus Tile
    if (selectedUnit && battle.phase === 'player') {
      this.drawLuminousTilePad(
        ctx,
        selectedUnit.pos.x,
        selectedUnit.pos.y,
        m,
        'rgba(255, 236, 138, 0.36)',
        '#fffbe0',
        true
      );
    }

    // Highlight actual valid attack targets (enemies or destructible cover) cleanly inside the red zone
    if (selectedUnit && battle.phase === 'player' && (mode === 'attack' || mode === 'move')) {
      for (const pos of attackTiles) {
        const u = unitAt(battle, pos);
        const cov = tileAt(battle, pos)?.cover;
        const isActionableEntity = Boolean((u && u.team === 'enemy') || cov?.destructible);
        if (!isActionableEntity) continue;
        const isLocked = Boolean(previewTile && samePos(previewTile, pos));
        this.drawLuminousTilePad(
          ctx,
          pos.x,
          pos.y,
          m,
          isLocked ? 'rgba(232, 68, 52, 0.44)' : 'rgba(228, 72, 54, 0.26)',
          isLocked ? '#fff4be' : 'rgba(255, 224, 214, 0.92)',
          isLocked
        );
      }
    }

    // Highlight clickable Ability targets (for enemy / ally targeted skills)
    if (
      mode === 'ability' &&
      selectedUnit?.ability &&
      selectedUnit.ability.targetType !== 'self' &&
      selectedUnit.ability.targetType !== 'aoe_self'
    ) {
      for (const pos of abilityTiles) {
        const isUnitTarget =
          selectedUnit.ability.targetType === 'enemy' || selectedUnit.ability.targetType === 'ally';
        if (!isUnitTarget) continue;
        const isLocked = Boolean(previewTile && samePos(previewTile, pos));
        this.drawLuminousTilePad(
          ctx,
          pos.x,
          pos.y,
          m,
          isLocked ? 'rgba(164, 96, 232, 0.52)' : 'rgba(164, 96, 232, 0.32)',
          '#f6e8ff',
          isLocked
        );
      }
    }

    // Single crisp cursor highlight on the hovered or previewed tile
    if (focusTile && fKey) {
      const isLocked = Boolean(previewTile && samePos(previewTile, focusTile));
      const fill = movableKeys.has(fKey)
        ? isLocked
          ? 'rgba(84, 198, 232, 0.52)'
          : 'rgba(180, 236, 255, 0.28)'
        : jumpKeys.has(fKey)
          ? isLocked
            ? 'rgba(248, 210, 66, 0.56)'
            : 'rgba(255, 236, 152, 0.34)'
          : isLocked
            ? 'rgba(255, 248, 214, 0.34)'
            : 'rgba(255, 250, 228, 0.18)';
      this.drawLuminousTilePad(
        ctx,
        focusTile.x,
        focusTile.y,
        m,
        fill,
        isLocked ? '#fff6b0' : 'rgba(255, 250, 234, 0.85)',
        isLocked
      );
    }

    // 6. Depth-sorted Illustrated Cover Props & Die-Cut Unit Standees
    interface Renderable {
      depth: number;
      draw: () => void;
    }
    const itemsToDraw: Renderable[] = [];

    for (let y = 0; y < battle.height; y++) {
      for (let x = 0; x < battle.width; x++) {
        const tile = battle.tiles[y][x];
        if (!tile.cover) continue;
        const cover = tile.cover;
        const center = gridToScreen(x, y, m);
        const targetable =
          (mode === 'attack' || Boolean(cover.isObjectiveCage)) &&
          attackKeySet.has(posKey({ x, y }));
        const sprScale = m.viewMode === 'topdown' ? m.scale * 0.84 : m.scale;
        itemsToDraw.push({
          depth: m.viewMode === 'topdown' ? y + 0.08 : x + y + 0.08,
          draw: () => {
            drawCoverObject(
              ctx,
              cover,
              center.x,
              center.y + (m.viewMode === 'topdown' ? m.tileH * 0.1 : 0),
              m.viewMode === 'topdown' ? m.tileW * 0.92 : m.tileW,
              m.viewMode === 'topdown' ? m.tileH * 0.56 : m.tileH,
              sprScale,
              this.elapsedTotal,
              targetable
            );
            const badgeOffX = cover.level === 'full' ? 21 * sprScale : 20 * sprScale;
            const badgeOffY = cover.level === 'full' ? -44 * sprScale : -8 * sprScale;
            drawPaperShieldBadge(
              ctx,
              center.x + badgeOffX,
              center.y + badgeOffY,
              cover.level,
              sprScale * 0.86
            );
          },
        });
      }
    }

    for (const unit of battle.units) {
      if (!unit.alive) continue;
      const anim = this.unitAnims.get(unit.id);
      let drawGx = unit.pos.x;
      let drawGy = unit.pos.y;
      let jumpHeight = 0;

      if (anim) {
        const t = Math.min(1, anim.elapsed / anim.duration);
        const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
        drawGx = anim.fromX + (anim.toX - anim.fromX) * eased;
        drawGy = anim.fromY + (anim.toY - anim.fromY) * eased;
        jumpHeight = Math.sin(t * Math.PI) * anim.arcHeight;
      }

      const pt = gridToScreen(drawGx, drawGy, m);
      const isSelected = unit.id === selectedUnitId;
      const isInspectedEnemy = unit.id === inspectedEnemyId;
      const isDone = doneUnitIds.has(unit.id);
      const isDashTarget = dashEnemyIds.has(unit.id);
      const uKey = posKey(unit.pos);
      const isAttackTarget =
        unit.team === 'enemy' &&
        (attackKeySet.has(uKey) || (isProjectingFromMove && weaponRangeKeys.has(uKey)));
      const flash = this.hitFlashes.get(unit.id) ?? 0;
      const squash = this.unitSquashes.get(unit.id) ?? 0;
      const sprScale = m.viewMode === 'topdown' ? m.scale * 0.85 : m.scale;

      itemsToDraw.push({
        depth: m.viewMode === 'topdown' ? drawGy + 0.25 : drawGx + drawGy + 0.25,
        draw: () => {
          drawUnitStandee(
            ctx,
            unit,
            pt.x,
            pt.y + (m.viewMode === 'topdown' ? m.tileH * 0.2 : 0),
            sprScale,
            this.elapsedTotal,
            {
              isSelected,
              isInspectedEnemy,
              isDone,
              isDashTarget,
              isAttackTarget,
              hitFlash: flash,
              jumpHeight,
              squash,
            }
          );
        },
      });
    }

    itemsToDraw.sort((a, b) => a.depth - b.depth);
    for (const item of itemsToDraw) {
      item.draw();
    }

    // 7. Live Tactical Previews (driven by BOTH desktop hover AND mobile Tap-1 Preview)
    if (selectedUnit && battle.phase === 'player' && focusTile && fKey) {
      const focusedUnit = unitAt(battle, focusTile);
      const canDirectlyAttackFocus =
        (mode === 'attack' || mode === 'move') &&
        attackKeySet.has(fKey) &&
        Boolean(
          (focusedUnit && focusedUnit.team === 'enemy') ||
            mode === 'attack' ||
            tileAt(battle, focusTile)?.cover?.destructible
        );

      if (mode === 'move' && jumpMap.has(fKey)) {
        const jumpOpt = jumpMap.get(fKey)!;
        this.drawPaperRibbonArch(ctx, selectedUnit.pos, jumpOpt.allyPos, m, '#9cd9ec', 24 * m.scale, false);
        this.drawPaperRibbonArch(ctx, jumpOpt.allyPos, jumpOpt.dest, m, '#f4d365', 100 * m.scale, true);
        this.drawHoveredCoverPreviews(ctx, battle, focusTile, m, focusCoverBadges);
      } else if (mode === 'move' && movableMap.has(fKey)) {
        const moveNode = movableMap.get(fKey)!;
        this.drawMovePath(ctx, moveNode.path, m);
        this.drawHoveredCoverPreviews(ctx, battle, focusTile, m, focusCoverBadges);
      } else if (mode === 'ability' && abilityKeySet.has(fKey) && !samePos(selectedUnit.pos, focusTile)) {
        this.drawPaperRibbonArch(ctx, selectedUnit.pos, focusTile, m, '#b77af2', 54 * m.scale, true);
      } else if (mode === 'item' && itemKeySet.has(fKey) && !samePos(selectedUnit.pos, focusTile)) {
        this.drawPaperRibbonArch(ctx, selectedUnit.pos, focusTile, m, '#67c76b', 68 * m.scale, true);
      } else {
        const dashOpt =
          mode === 'move' && focusedUnit && dashEnemyIds.has(focusedUnit.id)
            ? dashList.find((d) => d.enemyId === focusedUnit.id)
            : undefined;

        if (dashOpt) {
          this.drawPaperRibbonArch(ctx, selectedUnit.pos, dashOpt.enemyPos, m, '#ff8c38', 36 * m.scale, true);
        }

        if (canDirectlyAttackFocus) {
          const fc = focusForecast ?? forecastAttack(battle, selectedUnit, focusTile);
          const isLob = selectedUnit.weapon.arc === 'lobbed';
          this.drawPaperRibbonArch(
            ctx,
            selectedUnit.pos,
            focusTile,
            m,
            fc.canAttack ? (isLob ? '#f4d365' : '#ef5b48') : '#9aa0a6',
            isLob ? 96 * m.scale : dashOpt ? 60 * m.scale : 22 * m.scale,
            true
          );

          if (fc.coverPos && fc.coverLevel !== 'none') {
            const covPt = gridToScreen(fc.coverPos.x, fc.coverPos.y, m);
            drawPaperShieldBadge(ctx, covPt.x, covPt.y - 42 * m.scale, fc.coverLevel, m.scale * 1.2, true);
          }

          // Directional Knockback preview arrow + BUMP +2 warning!
          if (fc.knockbackDir && fc.canAttack) {
            const pushedTo = {
              x: focusTile.x + fc.knockbackDir.x,
              y: focusTile.y + fc.knockbackDir.y,
            };
            this.drawKnockbackArrow(ctx, focusTile, pushedTo, m, Boolean(fc.knockbackWillBump));
          }

          const tPt = gridToScreen(focusTile.x, focusTile.y, m);
          const matchGlyph =
            fc.matchup === 'advantage' ? ' ▲' : fc.matchup === 'disadvantage' ? ' ▼' : '';
          const bumpTag = fc.knockbackWillBump ? ' +2 BUMP!' : fc.knockbackDir ? ' ⇄' : '';
          const pillText =
            dashOpt && fc.canAttack
              ? `DASH -${dashOpt.damage} | ${fc.hitChance}%${matchGlyph} (-${fc.finalDamage}${bumpTag})`
              : !fc.canAttack
                ? dashOpt
                  ? `DASH -${dashOpt.damage} | BLOCKED`
                  : '0% BLOCKED'
                : fc.targetUnitId
                  ? `${fc.hitChance}%${matchGlyph} · -${fc.finalDamage} HP${bumpTag}`
                  : tileAt(battle, focusTile)?.cover
                    ? `SMASH -${fc.coverDamage}`
                    : `SPLASH -${fc.finalDamage}`;
          this.drawFloatingHintPill(
            ctx,
            tPt.x,
            Math.max(72, tPt.y - 86 * m.scale),
            pillText,
            fc.canAttack || dashOpt ? '#fff8e1' : '#e8e0d5',
            fc.canAttack || dashOpt ? '#8f1d14' : '#5f5349'
          );
        } else if (dashOpt && focusedUnit) {
          const pt = gridToScreen(focusedUnit.pos.x, focusedUnit.pos.y, m);
          this.drawFloatingHintPill(
            ctx,
            pt.x,
            Math.max(72, pt.y - 86 * m.scale),
            `DASH -${dashOpt.damage}`,
            '#fff3d6',
            '#b8320e'
          );
        }
      }
    }

    // 8. Illustrated Die-Cut Paper-Craft Projectiles
    for (const proj of this.projectiles) {
      this.drawIllustratedProjectile(ctx, proj, m);
    }

    // 9. Particles, Tap Ripples & Popups
    this.particles.render(ctx);

    for (const rip of this.tapRipples) {
      const t = Math.min(1, rip.elapsed / rip.duration);
      const radius = 8 + t * 24;
      const alpha = (1 - t) * 0.85;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = INK;
      ctx.lineWidth = 4 * (1 - t * 0.4);
      ctx.beginPath();
      ctx.arc(rip.x, rip.y, radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = '#fff6c4';
      ctx.lineWidth = 2.2 * (1 - t * 0.4);
      ctx.stroke();
      ctx.restore();
    }

    // 10. Phase Banner
    if (this.banner) {
      this.drawPhaseBanner(ctx, w, this.banner);
    }

    ctx.restore();
  }

  /**
   * Renders a set of tiles as ONE unified translucent watercolor area with ONLY its outer perimeter
   * traced — eliminating noisy interior dashed boxes or tile-by-tile overlapping lines!
   */
  private drawUnifiedZone(
    ctx: CanvasRenderingContext2D,
    keys: Set<string>,
    battle: BattleState,
    m: IsoMetrics,
    opts: {
      fill: string;
      pattern?: CanvasPattern | null;
      patternAlpha?: number;
      borderColor?: string;
      borderWidth?: number;
      outerBackingColor?: string;
      dash?: number[];
    }
  ): void {
    if (keys.size === 0) return;

    const coords: Array<{ x: number; y: number }> = [];
    for (let y = 0; y < battle.height; y++) {
      for (let x = 0; x < battle.width; x++) {
        if (keys.has(posKey({ x, y }))) {
          coords.push({ x, y });
        }
      }
    }
    if (coords.length === 0) return;

    ctx.save();

    // Pass 1: Single combined interior fill (smooth even translucent area, zero seam darkening!)
    ctx.beginPath();
    for (const { x, y } of coords) {
      const pts = getTileDiamond(x, y, m);
      ctx.moveTo(pts[0].x, pts[0].y);
      ctx.lineTo(pts[1].x, pts[1].y);
      ctx.lineTo(pts[2].x, pts[2].y);
      ctx.lineTo(pts[3].x, pts[3].y);
      ctx.closePath();
    }
    ctx.fillStyle = opts.fill;
    ctx.fill();

    if (opts.pattern) {
      ctx.save();
      ctx.globalAlpha = opts.patternAlpha ?? 0.45;
      ctx.fillStyle = opts.pattern;
      ctx.fill();
      ctx.restore();
    }

    // Pass 2: Outer perimeter edges ONLY
    if (opts.borderColor) {
      ctx.beginPath();
      for (const { x, y } of coords) {
        const pts = getTileDiamond(x, y, m);
        for (let i = 0; i < 4; i++) {
          const [dx, dy] = EDGE_NEIGHBORS[i];
          if (!keys.has(posKey({ x: x + dx, y: y + dy }))) {
            const pA = pts[i];
            const pB = pts[(i + 1) % 4];
            ctx.moveTo(pA.x, pA.y);
            ctx.lineTo(pB.x, pB.y);
          }
        }
      }
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      const bw = opts.borderWidth ?? 2 * m.scale;

      if (opts.outerBackingColor) {
        ctx.strokeStyle = opts.outerBackingColor;
        ctx.lineWidth = bw + 2.2 * m.scale;
        ctx.setLineDash([]);
        ctx.stroke();
      }

      ctx.strokeStyle = opts.borderColor;
      ctx.lineWidth = bw;
      if (opts.dash) ctx.setLineDash(opts.dash);
      ctx.stroke();
    }

    ctx.restore();
  }

  private drawSoftBoardShadow(
    ctx: CanvasRenderingContext2D,
    gridW: number,
    gridH: number,
    m: IsoMetrics
  ): void {
    const p0 = getTileDiamond(0, 0, m)[0];
    const p1 = getTileDiamond(gridW - 1, 0, m)[1];
    const p2 = getTileDiamond(gridW - 1, gridH - 1, m)[2];
    const p3 = getTileDiamond(0, gridH - 1, m)[3];

    const layers = [
      { pad: 20 * m.scale, oy: m.boardDepth + 18 * m.scale, alpha: 0.1 },
      { pad: 10 * m.scale, oy: m.boardDepth + 13 * m.scale, alpha: 0.15 },
      { pad: 3 * m.scale, oy: m.boardDepth + 8 * m.scale, alpha: 0.24 },
    ];
    for (const l of layers) {
      ctx.fillStyle = `rgba(34, 15, 3, ${l.alpha})`;
      if (m.viewMode === 'topdown') {
        roundRect(
          ctx,
          p0.x - l.pad * 0.65,
          p0.y + l.oy * 0.35 - l.pad * 0.3,
          p1.x - p0.x + l.pad * 1.3,
          p2.y - p0.y + l.oy * 0.65 + l.pad * 0.65,
          10 * m.scale
        );
        ctx.fill();
      } else {
        ctx.beginPath();
        ctx.moveTo(p0.x, p0.y + l.oy - l.pad * 0.45);
        ctx.lineTo(p1.x + l.pad, p1.y + l.oy);
        ctx.lineTo(p2.x, p2.y + l.oy + l.pad * 0.65);
        ctx.lineTo(p3.x - l.pad, p3.y + l.oy);
        ctx.closePath();
        ctx.fill();
      }
    }
  }

  private drawBoardCardstockRim(
    ctx: CanvasRenderingContext2D,
    gridW: number,
    gridH: number,
    m: IsoMetrics
  ): void {
    const p0 = getTileDiamond(0, 0, m)[0];
    const p1 = getTileDiamond(gridW - 1, 0, m)[1];
    const p2 = getTileDiamond(gridW - 1, gridH - 1, m)[2];
    const p3 = getTileDiamond(0, gridH - 1, m)[3];

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(p0.x, p0.y);
    ctx.lineTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.lineTo(p3.x, p3.y);
    ctx.closePath();
    ctx.strokeStyle = 'rgba(252, 245, 228, 0.55)';
    ctx.lineWidth = 3.2 * m.scale;
    ctx.stroke();
    ctx.strokeStyle = INK;
    ctx.lineWidth = 1.6 * m.scale;
    ctx.stroke();
    ctx.restore();
  }

  private drawPaperCraftTile(
    ctx: CanvasRenderingContext2D,
    battle: BattleState,
    tile: BattleState['tiles'][number][number],
    m: IsoMetrics
  ): void {
    const pts = getTileDiamond(tile.x, tile.y, m);
    const checker = (tile.x + tile.y) % 2 === 0;
    const gridW = battle.width;
    const gridH = battle.height;

    const isGreenhouse = battle.theme === 'greenhouse';
    const isAutumn = battle.theme === 'autumn';
    let fill = isAutumn
      ? checker
        ? '#c4a046'
        : '#b9943d'
      : isGreenhouse
        ? checker
          ? '#7eb353'
          : '#73a849'
        : checker
          ? '#8fb649'
          : '#85ac41';
    let topEdgeCol = isAutumn ? '#94702a' : isGreenhouse ? '#5c8c38' : '#6f9333';
    if (tile.terrain === 'soil') {
      fill = checker ? '#bf7d46' : '#b5743f';
      topEdgeCol = '#8a552a';
    } else if (tile.terrain === 'mud') {
      fill = checker ? '#75563e' : '#6a4d37';
      topEdgeCol = '#4c3625';
    } else if (tile.terrain === 'compost') {
      fill = checker ? '#674b31' : '#5c422a';
      topEdgeCol = '#432f1e';
    } else if (tile.terrain === 'gate') {
      fill = checker ? '#f3cb5b' : '#e6b640';
      topEdgeCol = '#b58420';
    } else if (tile.terrain === 'barn_floor') {
      fill = isGreenhouse
        ? checker
          ? '#cf8d5d'
          : '#c38151'
        : checker
          ? '#bc8753'
          : '#b27d4a';
      topEdgeCol = isGreenhouse ? '#9c5b31' : '#83562d';
    } else if (tile.terrain === 'sunbeam') {
      fill = checker ? '#f7dc6f' : '#f2cf57';
      topEdgeCol = '#c4961a';
    } else if (tile.terrain === 'water') {
      fill = checker ? '#2d95bd' : '#2587ad';
      topEdgeCol = '#195f7c';
    } else if (tile.terrain === 'bridge') {
      fill = checker ? '#c68a4d' : '#b87d43';
      topEdgeCol = '#75441c';
    } else if (tile.terrain === 'lava') {
      fill = checker ? '#df4b18' : '#c93a10';
      topEdgeCol = '#7c1a08';
    } else if (tile.terrain === 'ramp') {
      fill = checker ? '#cb9b5c' : '#be8d4f';
      topEdgeCol = '#7d5224';
    } else if (tile.terrain === 'burrow') {
      fill = checker ? '#8a623c' : '#7f5834';
      topEdgeCol = '#2a8f85';
    }

    const d = m.boardDepth;
    if (tile.y === gridH - 1) {
      this.drawCorrugatedFace(ctx, pts[3], pts[2], d, topEdgeCol, '#9e6d3d', '#6b4422', m.scale);
    }
    if (m.viewMode === 'iso' && tile.x === gridW - 1) {
      this.drawCorrugatedFace(ctx, pts[1], pts[2], d, topEdgeCol, '#7c522a', '#4d2e14', m.scale);
    }

    const grad = ctx.createLinearGradient(pts[0].x, pts[0].y, pts[2].x, pts[2].y);
    grad.addColorStop(0, fill);
    grad.addColorStop(1, this.darkenHex(fill, 0.06));

    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    ctx.lineTo(pts[1].x, pts[1].y);
    ctx.lineTo(pts[2].x, pts[2].y);
    ctx.lineTo(pts[3].x, pts[3].y);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = 'rgba(66, 40, 18, 0.28)';
    ctx.lineWidth = 1.1;
    ctx.stroke();

    ctx.strokeStyle = 'rgba(255, 250, 224, 0.22)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pts[3].x + 2, pts[3].y);
    ctx.lineTo(pts[0].x, pts[0].y + 1.5);
    ctx.lineTo(pts[1].x - 2, pts[1].y);
    ctx.stroke();

    const c = gridToScreen(tile.x, tile.y, m);
    const s = m.scale;

    if (tile.terrain === 'grass' && !tile.cover) {
      const seed = (tile.x * 19 + tile.y * 31) % 7;
      if (seed < 3) {
        ctx.strokeStyle = battle.theme === 'autumn' ? '#8a5f1c' : '#5c7e29';
        ctx.lineWidth = 1.2 * s;
        ctx.lineCap = 'round';
        const ox = (seed - 1) * 9 * s;
        const oy = (seed === 1 ? -4 : 3) * s;
        ctx.beginPath();
        ctx.moveTo(c.x + ox - 3 * s, c.y + oy + 2 * s);
        ctx.lineTo(c.x + ox - 5 * s, c.y + oy - 3 * s);
        ctx.moveTo(c.x + ox, c.y + oy + 2 * s);
        ctx.lineTo(c.x + ox + 1 * s, c.y + oy - 4 * s);
        ctx.moveTo(c.x + ox + 3 * s, c.y + oy + 2 * s);
        ctx.lineTo(c.x + ox + 5 * s, c.y + oy - 2 * s);
        ctx.stroke();
      }
      if (battle.theme === 'autumn' && seed >= 4) {
        // A fallen paper leaf or two on dry autumn grass.
        ctx.fillStyle = seed === 4 ? '#c4532a' : seed === 5 ? '#d9822b' : '#9e3a22';
        ctx.beginPath();
        ctx.ellipse(c.x + (seed - 5) * 8 * s, c.y + (seed % 2 ? 2 : -3) * s, 3.4 * s, 1.7 * s, seed * 0.7, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (tile.terrain === 'soil' && !tile.cover) {
      ctx.fillStyle = 'rgba(84, 48, 22, 0.3)';
      ctx.beginPath();
      ctx.ellipse(c.x - 8 * s, c.y + 1 * s, 2.2 * s, 1.3 * s, 0, 0, Math.PI * 2);
      ctx.ellipse(c.x + 10 * s, c.y - 2 * s, 1.8 * s, 1.1 * s, 0, 0, Math.PI * 2);
      ctx.fill();
    } else if (tile.terrain === 'mud') {
      ctx.fillStyle = 'rgba(164, 128, 98, 0.35)';
      ctx.beginPath();
      ctx.ellipse(c.x, c.y, 14 * s, 6.5 * s, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255, 240, 220, 0.25)';
      ctx.lineWidth = 1.2 * s;
      ctx.beginPath();
      ctx.arc(c.x - 3 * s, c.y - 1 * s, 5 * s, Math.PI * 1.1, Math.PI * 1.7);
      ctx.stroke();
    } else if (tile.terrain === 'compost') {
      ctx.fillStyle = '#8be05a';
      ctx.beginPath();
      ctx.arc(c.x - 8 * s, c.y - 1 * s, 2.6 * s, 0, Math.PI * 2);
      ctx.arc(c.x + 7 * s, c.y + 2 * s, 2.2 * s, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#e4ffc2';
      ctx.font = `700 ${Math.round(9.5 * s)}px "Fredoka", sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText('+2 HP', c.x, c.y + 4 * s);
    } else if (tile.terrain === 'gate') {
      ctx.fillStyle = INK;
      ctx.font = `700 ${Math.round(10 * s)}px "Fredoka", sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText('▲ EXIT', c.x, c.y + 4 * s);
    } else if (tile.terrain === 'barn_floor') {
      ctx.strokeStyle = 'rgba(69, 40, 16, 0.25)';
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.moveTo((pts[0].x + pts[3].x) / 2, (pts[0].y + pts[3].y) / 2);
      ctx.lineTo((pts[1].x + pts[2].x) / 2, (pts[1].y + pts[2].y) / 2);
      ctx.stroke();
    }
  }

  private drawKnockbackArrow(
    ctx: CanvasRenderingContext2D,
    from: GridPos,
    to: GridPos,
    m: IsoMetrics,
    willBump: boolean
  ): void {
    const a = gridToScreen(from.x, from.y, m);
    const b = gridToScreen(to.x, to.y, m);
    const angle = Math.atan2(b.y - a.y, b.x - a.x);
    const midX = a.x + (b.x - a.x) * 0.72;
    const midY = a.y + (b.y - a.y) * 0.72;
    const s = m.scale;

    ctx.save();
    ctx.strokeStyle = INK;
    ctx.lineWidth = 6.5 * s;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(midX, midY);
    ctx.stroke();

    ctx.strokeStyle = willBump ? '#ff7b29' : '#fff4b8';
    ctx.lineWidth = 3.6 * s;
    ctx.stroke();

    ctx.translate(midX, midY);
    ctx.rotate(angle);
    ctx.fillStyle = willBump ? '#ff7b29' : '#fff4b8';
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2 * s;
    ctx.beginPath();
    ctx.moveTo(8 * s, 0);
    ctx.lineTo(-5 * s, -6.5 * s);
    ctx.lineTo(-5 * s, 6.5 * s);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  private drawIllustratedProjectile(
    ctx: CanvasRenderingContext2D,
    proj: ProjectileAnim,
    m: IsoMetrics
  ): void {
    const t = Math.min(1, proj.elapsed / proj.duration);
    const a = gridToScreen(proj.from.x, proj.from.y, m);
    const b = gridToScreen(proj.to.x, proj.to.y, m);
    const px = a.x + (b.x - a.x) * t;
    const arcLift = Math.sin(t * Math.PI) * (proj.lobbed ? 96 : 16) * m.scale;
    const py = a.y - 30 * m.scale + (b.y - a.y) * t - arcLift;
    const angle = Math.atan2(b.y - a.y, b.x - a.x);
    const s = m.scale;

    ctx.save();
    ctx.translate(px, py);

    // Subtle paper-craft speed trail
    if (proj.arc !== 'melee') {
      ctx.save();
      ctx.rotate(angle);
      ctx.strokeStyle = 'rgba(255, 250, 232, 0.72)';
      ctx.lineWidth = 3 * s;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(-18 * s, 0);
      ctx.lineTo(-6 * s, 0);
      ctx.stroke();
      ctx.restore();
    }

    if (proj.arc === 'melee') {
      // Crisp hand-inked melee impact crescent slash
      ctx.rotate(angle);
      ctx.strokeStyle = '#fbf3df';
      ctx.lineWidth = 7 * s;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(0, 0, 15 * s, -0.95, 0.95);
      ctx.stroke();
      ctx.strokeStyle = '#ff9838';
      ctx.lineWidth = 4 * s;
      ctx.stroke();
      ctx.strokeStyle = INK;
      ctx.lineWidth = 1.6 * s;
      ctx.stroke();
    } else if (proj.attackerKind === 'lemon') {
      // Spinning sliced golden citrus wheel!
      ctx.rotate(t * Math.PI * 5);
      ctx.fillStyle = '#fbf3df';
      ctx.strokeStyle = INK;
      ctx.lineWidth = 2.2 * s;
      ctx.beginPath();
      ctx.arc(0, 0, 11.5 * s, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#f6d544';
      ctx.beginPath();
      ctx.arc(0, 0, 8.8 * s, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#fff9d6';
      ctx.lineWidth = 1.4 * s;
      for (let i = 0; i < 6; i++) {
        const ang = (i * Math.PI) / 3;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(Math.cos(ang) * 8 * s, Math.sin(ang) * 8 * s);
        ctx.stroke();
      }
    } else if (proj.attackerKind === 'corn') {
      // Fluffy golden popped popcorn kernel cloud!
      ctx.rotate(t * Math.PI * 4);
      ctx.fillStyle = '#fff4bf';
      ctx.strokeStyle = INK;
      ctx.lineWidth = 2 * s;
      const puffs = [
        [0, -4],
        [4.5, 1.5],
        [-4.5, 1.5],
        [0, 4],
      ];
      ctx.beginPath();
      for (const [ox, oy] of puffs) {
        ctx.moveTo(ox * s + 5.5 * s, oy * s);
        ctx.arc(ox * s, oy * s, 5.5 * s, 0, Math.PI * 2);
      }
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#f0ba30';
      ctx.beginPath();
      ctx.arc(0, 0, 3.2 * s, 0, Math.PI * 2);
      ctx.fill();
    } else if (proj.attackerKind === 'carrot' || proj.attackerKind === 'rooster') {
      // Pointed root lance or crimson feather dart aligned to flight angle
      ctx.rotate(angle);
      const isCarrot = proj.attackerKind === 'carrot';
      ctx.fillStyle = isCarrot ? '#f28729' : '#fff6e4';
      ctx.strokeStyle = INK;
      ctx.lineWidth = 2 * s;
      ctx.beginPath();
      ctx.moveTo(12 * s, 0);
      ctx.lineTo(-9 * s, -5.2 * s);
      ctx.lineTo(-6 * s, 0);
      ctx.lineTo(-9 * s, 5.2 * s);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = isCarrot ? '#58a83b' : '#d64535';
      ctx.beginPath();
      ctx.arc(-7 * s, 0, 3.2 * s, 0, Math.PI * 2);
      ctx.fill();
    } else if (proj.attackerKind === 'scarecrow') {
      // Flapping silhouette paper crow!
      const wing = Math.sin(t * Math.PI * 6) * 7 * s;
      ctx.fillStyle = '#332419';
      ctx.strokeStyle = '#fbf3df';
      ctx.lineWidth = 1.8 * s;
      ctx.beginPath();
      ctx.moveTo(0, 2 * s);
      ctx.quadraticCurveTo(-8 * s, -7 * s + wing, -14 * s, wing);
      ctx.quadraticCurveTo(-5 * s, 4 * s, 0, 5 * s);
      ctx.quadraticCurveTo(5 * s, 4 * s, 14 * s, wing);
      ctx.quadraticCurveTo(8 * s, -7 * s + wing, 0, 2 * s);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    } else if (proj.attackerKind === 'lettuce') {
      // Spinning crisp ruffled lettuce leaf disc!
      ctx.rotate(t * Math.PI * 5.5);
      ctx.fillStyle = '#fbf3df';
      ctx.strokeStyle = INK;
      ctx.lineWidth = 2 * s;
      ctx.beginPath();
      ctx.ellipse(0, 0, 11.5 * s, 7.5 * s, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#7acc47';
      ctx.beginPath();
      ctx.ellipse(0, 0, 9.2 * s, 5.5 * s, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#d9f7b5';
      ctx.lineWidth = 1.5 * s;
      ctx.beginPath();
      ctx.moveTo(-7.5 * s, 0);
      ctx.lineTo(7.5 * s, 0);
      ctx.moveTo(-2 * s, 0);
      ctx.lineTo(2 * s, -3.5 * s);
      ctx.moveTo(-2 * s, 0);
      ctx.lineTo(2 * s, 3.5 * s);
      ctx.stroke();
    } else if (proj.attackerKind === 'chili') {
      // Sizzling pepper ember fireball
      ctx.fillStyle = '#ff6b35';
      ctx.strokeStyle = INK;
      ctx.lineWidth = 2 * s;
      ctx.beginPath();
      ctx.arc(0, 0, 8 * s, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#ffe066';
      ctx.beginPath();
      ctx.arc(0, 0, 4 * s, 0, Math.PI * 2);
      ctx.fill();
    } else {
      // Die-cut glossy pea / berry / mist orb with paper cream rim
      const r = (proj.lobbed ? 9 : 6.8) * s;
      ctx.fillStyle = '#fbf3df';
      ctx.strokeStyle = INK;
      ctx.lineWidth = 2.2 * s;
      ctx.beginPath();
      ctx.arc(0, 0, r + 1.8 * s, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle =
        proj.attackerKind === 'blackberry'
          ? '#6b3fa0'
          : proj.attackerKind === 'sprayer'
            ? '#9ec940'
            : proj.color;
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.88, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
      ctx.beginPath();
      ctx.arc(-r * 0.28, -r * 0.28, r * 0.25, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }

  private drawCorrugatedFace(
    ctx: CanvasRenderingContext2D,
    p1: { x: number; y: number },
    p2: { x: number; y: number },
    depth: number,
    topTrim: string,
    kraftLight: string,
    kraftDark: string,
    scale: number
  ): void {
    ctx.fillStyle = kraftLight;
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.lineTo(p2.x, p2.y + depth);
    ctx.lineTo(p1.x, p1.y + depth);
    ctx.closePath();
    ctx.fill();

    const lip = Math.max(2.5, depth * 0.14);
    ctx.fillStyle = topTrim;
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.lineTo(p2.x, p2.y + lip);
    ctx.lineTo(p1.x, p1.y + lip);
    ctx.closePath();
    ctx.fill();

    const bands = [
      { y0: depth * 0.24, h: depth * 0.24 },
      { y0: depth * 0.62, h: depth * 0.24 },
    ];
    for (const band of bands) {
      ctx.fillStyle = kraftDark;
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y + band.y0);
      ctx.lineTo(p2.x, p2.y + band.y0);
      ctx.lineTo(p2.x, p2.y + band.y0 + band.h);
      ctx.lineTo(p1.x, p1.y + band.y0 + band.h);
      ctx.closePath();
      ctx.fill();

      const steps = 6;
      ctx.fillStyle = 'rgba(32, 16, 6, 0.55)';
      for (let i = 0; i < steps; i++) {
        const t = (i + 0.5) / steps;
        const fx = p1.x + (p2.x - p1.x) * t;
        const fy = p1.y + (p2.y - p1.y) * t + band.y0 + band.h * 0.5;
        ctx.beginPath();
        ctx.ellipse(fx, fy, 1.8 * scale, band.h * 0.34, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    ctx.strokeStyle = INK;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.lineTo(p2.x, p2.y + depth);
    ctx.lineTo(p1.x, p1.y + depth);
    ctx.closePath();
    ctx.stroke();
  }

  private applyBoardPaperTexture(
    ctx: CanvasRenderingContext2D,
    gridW: number,
    gridH: number,
    m: IsoMetrics
  ): void {
    if (!this.paperPattern) return;
    const p0 = getTileDiamond(0, 0, m)[0];
    const p1 = getTileDiamond(gridW - 1, 0, m)[1];
    const p2 = getTileDiamond(gridW - 1, gridH - 1, m)[2];
    const p3 = getTileDiamond(0, gridH - 1, m)[3];

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(p0.x, p0.y);
    ctx.lineTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.lineTo(p3.x, p3.y);
    ctx.closePath();
    ctx.clip();
    const minX = Math.min(p0.x, p3.x);
    const maxX = Math.max(p1.x, p2.x);
    const minY = Math.min(p0.y, p1.y);
    const maxY = Math.max(p2.y, p3.y);
    if (this.wcBoardPattern) {
      ctx.globalAlpha = 0.22;
      ctx.fillStyle = this.wcBoardPattern;
      ctx.fillRect(minX - 10, minY - 10, maxX - minX + 20, maxY - minY + 20);
    }
    ctx.globalAlpha = 0.2;
    ctx.fillStyle = this.paperPattern;
    ctx.fillRect(minX - 10, minY - 10, maxX - minX + 20, maxY - minY + 20);
    ctx.restore();
  }

  private drawLuminousTilePad(
    ctx: CanvasRenderingContext2D,
    gx: number,
    gy: number,
    m: IsoMetrics,
    fill: string,
    rimColor: string,
    focused: boolean,
    dashed = false
  ): void {
    const pts = getTileDiamond(gx, gy, m);
    const cx = (pts[0].x + pts[2].x) / 2;
    const cy = (pts[0].y + pts[2].y) / 2;
    const inset = focused ? 0.9 : 0.82;
    const ip = pts.map((p) => ({
      x: cx + (p.x - cx) * inset,
      y: cy + (p.y - cy) * inset,
    }));

    ctx.save();
    ctx.beginPath();
    const corner = 0.18;
    for (let i = 0; i < 4; i++) {
      const prev = ip[(i + 3) % 4];
      const curr = ip[i];
      const next = ip[(i + 1) % 4];
      const sx = curr.x + (prev.x - curr.x) * corner;
      const sy = curr.y + (prev.y - curr.y) * corner;
      const ex = curr.x + (next.x - curr.x) * corner;
      const ey = curr.y + (next.y - curr.y) * corner;
      if (i === 0) ctx.moveTo(sx, sy);
      else ctx.lineTo(sx, sy);
      ctx.quadraticCurveTo(curr.x, curr.y, ex, ey);
    }
    ctx.closePath();

    ctx.fillStyle = fill;
    ctx.fill();

    ctx.strokeStyle = rimColor;
    ctx.lineWidth = (focused ? 2.8 : 2) * m.scale;
    if (dashed) ctx.setLineDash([6 * m.scale, 4 * m.scale]);
    ctx.stroke();
    ctx.restore();
  }

  private drawMovePath(ctx: CanvasRenderingContext2D, path: GridPos[], m: IsoMetrics): void {
    if (path.length < 2) return;
    ctx.save();
    ctx.strokeStyle = '#fff9d6';
    ctx.lineWidth = 4 * m.scale;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.setLineDash([7 * m.scale, 6 * m.scale]);
    ctx.beginPath();
    path.forEach((p, i) => {
      const pt = gridToScreen(p.x, p.y, m);
      if (i === 0) ctx.moveTo(pt.x, pt.y);
      else ctx.lineTo(pt.x, pt.y);
    });
    ctx.stroke();
    ctx.restore();
  }

  private drawPaperRibbonArch(
    ctx: CanvasRenderingContext2D,
    from: GridPos,
    to: GridPos,
    m: IsoMetrics,
    ribbonColor: string,
    height: number,
    thickRibbon: boolean
  ): void {
    const a = gridToScreen(from.x, from.y, m);
    const b = gridToScreen(to.x, to.y, m);
    const midX = (a.x + b.x) / 2;
    const midY = (a.y + b.y) / 2 - height;

    ctx.save();
    ctx.lineCap = 'round';

    if (thickRibbon) {
      ctx.strokeStyle = 'rgba(42, 22, 8, 0.22)';
      ctx.lineWidth = 6.5 * m.scale;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y + 2);
      ctx.lineTo(b.x, b.y + 2);
      ctx.stroke();
    }

    ctx.strokeStyle = INK;
    ctx.lineWidth = (thickRibbon ? 10.5 : 6) * m.scale;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y - 6 * m.scale);
    ctx.quadraticCurveTo(midX, midY, b.x, b.y - 4 * m.scale);
    ctx.stroke();

    ctx.strokeStyle = ribbonColor;
    ctx.lineWidth = (thickRibbon ? 7.4 : 4) * m.scale;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y - 6 * m.scale);
    ctx.quadraticCurveTo(midX, midY, b.x, b.y - 4 * m.scale);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(79, 47, 23, 0.72)';
    ctx.lineWidth = (thickRibbon ? 2 : 1.5) * m.scale;
    ctx.setLineDash([7 * m.scale, 6 * m.scale]);
    ctx.lineDashOffset = -this.elapsedTotal * 28;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y - 6 * m.scale);
    ctx.quadraticCurveTo(midX, midY, b.x, b.y - 4 * m.scale);
    ctx.stroke();

    ctx.restore();
  }

  private drawHoveredCoverPreviews(
    ctx: CanvasRenderingContext2D,
    battle: BattleState,
    pos: GridPos,
    m: IsoMetrics,
    cachedBadges?: AdjacentCoverBadge[] | null
  ): void {
    const badges = cachedBadges ?? getAdjacentCoverBadges(battle, pos, 'player');
    const center = gridToScreen(pos.x, pos.y, m);
    for (const b of badges) {
      const covCenter = gridToScreen(b.coverPos.x, b.coverPos.y, m);
      const midX = (center.x + covCenter.x) / 2;
      const midY = (center.y + covCenter.y) / 2 - 14 * m.scale;
      drawPaperShieldBadge(ctx, midX, midY, b.level, m.scale * 1.12, true);
    }
  }

  private drawFloatingHintPill(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    text: string,
    bg: string,
    fg: string
  ): void {
    ctx.save();
    ctx.font = '700 12px "Fredoka", "Trebuchet MS", sans-serif';
    const w = ctx.measureText(text).width + 18;
    const h = 24;
    // Soft lift shadow + matte cream die-cut cardstock rim matching unit standees
    ctx.fillStyle = 'rgba(45, 24, 9, 0.26)';
    roundRect(ctx, x - w / 2 - 2, y - h / 2 + 2.5, w + 4, h + 4, 10);
    ctx.fill();
    ctx.fillStyle = '#f8f1dc';
    roundRect(ctx, x - w / 2 - 3, y - h / 2 - 3, w + 6, h + 6, 10);
    ctx.fill();
    ctx.fillStyle = bg;
    ctx.strokeStyle = INK;
    ctx.lineWidth = 1.8;
    roundRect(ctx, x - w / 2, y - h / 2, w, h, 7.5);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = fg;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x, y + 1);
    ctx.restore();
  }

  private drawPhaseBanner(ctx: CanvasRenderingContext2D, w: number, banner: PhaseBanner): void {
    const t = banner.elapsed / banner.duration;
    const alpha = t < 0.15 ? t / 0.15 : t > 0.8 ? (1 - t) / 0.2 : 1;
    const bg =
      banner.tone === 'player'
        ? '#f7edd5'
        : banner.tone === 'enemy'
          ? '#c9503d'
          : banner.tone === 'victory'
            ? '#f0cb66'
            : '#b8493b';
    const fg =
      banner.tone === 'enemy' || banner.tone === 'defeat' ? '#fcf6e6' : '#432713';
    const stitchCol =
      banner.tone === 'enemy' || banner.tone === 'defeat'
        ? 'rgba(255, 246, 224, 0.5)'
        : 'rgba(92, 56, 26, 0.3)';

    const compact = w < 640;
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
    ctx.font = `700 ${compact ? 16 : 20}px "Fredoka", "Trebuchet MS", sans-serif`;
    const tw = Math.min(w - 34, Math.max(compact ? 195 : 240, ctx.measureText(banner.text).width + 40));
    const th = compact ? 36 : 44;
    const x = w / 2 - tw / 2;
    const y = compact ? 54 : 68;

    // Soft tabletop drop shadow
    ctx.fillStyle = 'rgba(42, 20, 6, 0.28)';
    roundRect(ctx, x - 3, y + 4, tw + 6, th + 6, 15);
    ctx.fill();

    // Matte cream die-cut cardstock cutout silhouette (matching logo.png!)
    ctx.fillStyle = '#f8f1dc';
    roundRect(ctx, x - 4, y - 4, tw + 8, th + 8, 15);
    ctx.fill();

    ctx.fillStyle = bg;
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2.3;
    roundRect(ctx, x, y, tw, th, 11);
    ctx.fill();
    if (this.wcBoardPattern && banner.tone !== 'player') {
      ctx.save();
      roundRect(ctx, x, y, tw, th, 11);
      ctx.clip();
      ctx.globalAlpha = Math.max(0, Math.min(1, alpha)) * 0.22;
      ctx.fillStyle = this.wcBoardPattern;
      ctx.fillRect(x, y, tw, th);
      ctx.restore();
    }
    ctx.stroke();

    // Subtle paper running stitch inside banner (echoing REVOLT! ribbon!)
    ctx.strokeStyle = stitchCol;
    ctx.lineWidth = 1.3;
    ctx.setLineDash([5, 4]);
    roundRect(ctx, x + 4.5, y + 4.5, tw - 9, th - 9, 8);
    ctx.stroke();

    ctx.fillStyle = fg;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(banner.text, w / 2, y + th / 2 + 1);
    ctx.restore();
  }

  private darkenHex(hex: string, amount: number): string {
    const num = parseInt(hex.slice(1), 16);
    const r = Math.max(0, Math.round(((num >> 16) & 255) * (1 - amount)));
    const g = Math.max(0, Math.round(((num >> 8) & 255) * (1 - amount)));
    const b = Math.max(0, Math.round((num & 255) * (1 - amount)));
    return `rgb(${r}, ${g}, ${b})`;
  }
}

export function getUnitHoverTooltipInfo(
  battle: BattleState,
  pos: GridPos
): { unit?: BattleUnit; cover?: BattleState['tiles'][number][number]['cover'] } {
  const unit = unitAt(battle, pos);
  const tile = tileAt(battle, pos);
  return { unit, cover: tile?.cover ?? null };
}
