import * as THREE from 'three';
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
import { chebyshev, manhattan, posKey, samePos, tileAt, unitAt } from '../engine/grid';
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
import { roundRect } from '../renderer/particles';
import { sfx } from '../renderer/sfx';
import { TacticalCameraController } from './cameraController';
import { getTerrainSurfaceY, PaperDioramaWorld } from './diorama';
import { TacticalOverlaySystem3D } from './tacticalOverlays';
import {
  CraftTextureLibrary,
  createPaperStandeeRig,
  SPRITE_DEFAULT_FACING,
  type PaperStandeeRig,
} from './textures';
import {
  gridToWorld3D,
  TILE_SIZE_3D,
  type BattleRendererHandle,
  type BattleRendererHooks,
  type CameraMode3D,
  type PhaseBannerOverlay,
  type RendererViewState,
  type ScreenAnchor,
} from './types';

interface PathMoveAnim {
  kind: 'path' | 'dash' | 'jump' | 'knockback';
  points: THREE.Vector3[];
  elapsed: number;
  duration: number;
  arcHeight: number;
  spinFull?: boolean;
  leanAngle?: number;
}

interface UnitVisualEntry {
  id: string;
  visualKind: string;
  team: 'player' | 'enemy';
  isBoss: boolean;
  rig: PaperStandeeRig;
  hitCylinder: THREE.Mesh;
  hitFlash: number;
  squash: number;
  anim: PathMoveAnim | null;
  koTimer: number; // > 0 means playing Paper Mario KO flutter tumble!
  koOrigin?: THREE.Vector3;
}

interface Projectile3D {
  mesh: THREE.Group;
  from: THREE.Vector3;
  to: THREE.Vector3;
  elapsed: number;
  duration: number;
  arcHeight: number;
  spinSpeed: number;
}

interface Particle3D {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  rotVel: THREE.Vector3;
  elapsed: number;
  life: number;
  gravity: number;
  floorY: number;
}

interface WorldPopup3D {
  worldPos: THREE.Vector3;
  text: string;
  fg: string;
  bg: string;
  scale: number;
  elapsed: number;
  duration: number;
}

interface ActiveBanner {
  text: string;
  tone: 'player' | 'enemy' | 'victory' | 'defeat';
  startMs: number;
  durationMs: number;
}

interface CachedTactics {
  key: string;
  selectedUnit: BattleUnit | undefined;
  inspectedEnemy: BattleUnit | undefined;
  movableMap: Map<string, ReachableNode>;
  jumpMap: Map<string, JumpOption>;
  dashList: DashOption[];
  dashEnemyIds: Set<string>;
  attackKeySet: Set<string>;
  weaponRangeKeys: Set<string>;
  isProjectingFromMove: boolean;
  abilityKeySet: Set<string>;
  itemKeySet: Set<string>;
  aoePreviewKeys: Set<string>;
  enemyThreat: { moveKeys: Set<string>; attackKeys: Set<string> } | null;
  focusForecast: CombatForecast | null;
  doneUnitIds: Set<string>;
}

const MOUSE_DRAG_THRESHOLD = 7;
const TOUCH_DRAG_THRESHOLD = 16;

const STATUS_BADGE_STYLE: Record<string, { label: string; bg: string; fg: string }> = {
  burn: { label: 'B', bg: '#e55330', fg: '#fff5e6' },
  rooted: { label: 'R', bg: '#468a32', fg: '#eefbe8' },
  acid: { label: 'A', bg: '#b8b01a', fg: '#2b2600' },
  feared: { label: '!', bg: '#8a46b0', fg: '#faf0ff' },
  shield: { label: 'S', bg: '#3282c8', fg: '#ebf6ff' },
  boosted: { label: '+', bg: '#e39a1c', fg: '#331d00' },
};

export class PaperDioramaRenderer implements BattleRendererHandle {
  private canvas: HTMLCanvasElement;
  private overlayCanvas: HTMLCanvasElement | null;
  private overlayCtx: CanvasRenderingContext2D | null;
  private hooks: BattleRendererHooks;

  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private cameraCtrl: TacticalCameraController;
  private textures: CraftTextureLibrary;
  private world: PaperDioramaWorld;
  private overlays: TacticalOverlaySystem3D;

  private unitGroup = new THREE.Group();
  private fxGroup = new THREE.Group();
  private unitMap = new Map<string, UnitVisualEntry>();
  private unitPickMeshes: THREE.Mesh[] = [];

  private projectiles: Projectile3D[] = [];
  private particles: Particle3D[] = [];
  private popups: WorldPopup3D[] = [];
  private banner: ActiveBanner | null = null;
  private lastBannerEmit: PhaseBannerOverlay | null = null;

  private raycaster = new THREE.Raycaster();
  private pointerNdc = new THREE.Vector2();
  private tmpVec3 = new THREE.Vector3();

  private cssW = 800;
  private cssH = 600;
  private dpr = 1;
  private rafId = 0;
  private lastTime = 0;
  private elapsedTotal = 0;
  private resizeObserver: ResizeObserver;
  private lastBoardDims = '';
  private tacticalCache: CachedTactics | null = null;
  private lastFocusAnchorKey = '';

  // Pointer & Multi-Touch Camera Interaction State
  private activePointers = new Map<number, { x: number; y: number; button: number; type: string }>();
  private downPoint: { x: number; y: number; button: number; altKey: boolean } | null = null;
  private dragMode: 'none' | 'pan' | 'orbit' = 'none';
  private didPinch = false;
  private lastPinchDist = 0;
  private lastPinchMid: { x: number; y: number } | null = null;

  // Shared particle geometries
  private confettiGeo = new THREE.BoxGeometry(0.11, 0.02, 0.11);
  private plankGeo = new THREE.BoxGeometry(0.28, 0.055, 0.09);
  private dropletGeo = new THREE.SphereGeometry(0.065, 6, 6);

  constructor(
    canvas: HTMLCanvasElement,
    overlayCanvas: HTMLCanvasElement | null,
    hooks: BattleRendererHooks
  ) {
    this.canvas = canvas;
    this.overlayCanvas = overlayCanvas;
    this.overlayCtx = overlayCanvas ? overlayCanvas.getContext('2d') : null;
    this.hooks = hooks;

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    });
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#6b4222');
    this.scene.fog = new THREE.FogExp2('#6b4222', 0.02);

    this.cameraCtrl = new TacticalCameraController(
      1.6,
      (mode) => this.hooks.onCameraModeChange?.(mode),
      (pct) => this.hooks.onZoomChange?.(pct)
    );

    this.textures = new CraftTextureLibrary();
    this.world = new PaperDioramaWorld(this.textures);
    this.overlays = new TacticalOverlaySystem3D(this.textures);

    this.scene.add(this.world.root);
    this.scene.add(this.overlays.root);
    this.scene.add(this.unitGroup);
    this.scene.add(this.fxGroup);

    this.setupLights();
    this.resize();

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.canvas.parentElement ?? this.canvas);

    this.bindEvents();
    this.lastTime = performance.now();
    this.rafId = requestAnimationFrame(this.loop);
  }

  private setupLights(): void {
    // Cozy warm diorama sky + oak desk bounce
    const hemi = new THREE.HemisphereLight(0xfff7e2, 0x8f6239, 0.96);
    this.scene.add(hemi);

    // Golden afternoon sun casting Paper Mario standee & 3D crate shadows!
    const sun = new THREE.DirectionalLight(0xfff1cf, 1.55);
    sun.position.set(8.5, 15.5, 9.5);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near = 2;
    sun.shadow.camera.far = 42;
    const d = 12;
    sun.shadow.camera.left = -d;
    sun.shadow.camera.right = d;
    sun.shadow.camera.top = d;
    sun.shadow.camera.bottom = -d;
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.025;
    this.scene.add(sun);

    // Cool sky rim light so thick cardboard edges & crates separate crisply
    const rim = new THREE.DirectionalLight(0xc8e4ff, 0.42);
    rim.position.set(-9, 7, -8);
    this.scene.add(rim);
  }

  private resize(): void {
    const parent = this.canvas.parentElement ?? this.canvas;
    const rect = parent.getBoundingClientRect();
    this.cssW = Math.max(260, Math.floor(rect.width || window.innerWidth));
    this.cssH = Math.max(200, Math.floor(rect.height || window.innerHeight));
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);

    this.renderer.setPixelRatio(this.dpr);
    this.renderer.setSize(this.cssW, this.cssH, false);

    if (this.overlayCanvas) {
      this.overlayCanvas.width = Math.floor(this.cssW * this.dpr);
      this.overlayCanvas.height = Math.floor(this.cssH * this.dpr);
      this.overlayCanvas.style.width = `${this.cssW}px`;
      this.overlayCanvas.style.height = `${this.cssH}px`;
    }

    this.cameraCtrl.resize(this.cssW, this.cssH);
  }

  private bindEvents(): void {
    this.canvas.addEventListener('pointerdown', this.onPointerDown);
    this.canvas.addEventListener('pointermove', this.onPointerMove);
    this.canvas.addEventListener('pointerup', this.onPointerUp);
    this.canvas.addEventListener('pointercancel', this.onPointerUp);
    this.canvas.addEventListener('pointerleave', this.onPointerLeave);
    this.canvas.addEventListener('wheel', this.onWheel, { passive: false });
    this.canvas.addEventListener('contextmenu', this.onContextMenu);
  }

  private onContextMenu = (e: MouseEvent): void => {
    e.preventDefault();
  };

  private getCanvasLocal(clientX: number, clientY: number): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
  }

  private pickGridTile(clientX: number, clientY: number): GridPos | null {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    this.pointerNdc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.pointerNdc.y = -((clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.pointerNdc, this.cameraCtrl.camera);

    // Priority 1: 3D Unit standees (so clicking a hero/farmer's tall head always hits their tile!)
    const unitHits = this.raycaster.intersectObjects(this.unitPickMeshes, false);
    if (unitHits.length > 0) {
      const gp = unitHits[0].object.userData.gridPos as GridPos | undefined;
      if (gp) return { x: gp.x, y: gp.y };
    }

    // Priority 2: 3D Cover props (tall haystacks, crates, cages, beehives)
    const coverHits = this.raycaster.intersectObjects(this.world.coverPickMeshes, false);
    if (coverHits.length > 0) {
      const gp = coverHits[0].object.userData.gridPos as GridPos | undefined;
      if (gp) return { x: gp.x, y: gp.y };
    }

    // Priority 3: 3D Terrain tiles
    const tileHits = this.raycaster.intersectObjects(this.world.tilePickMeshes, false);
    if (tileHits.length > 0) {
      const gp = tileHits[0].object.userData.gridPos as GridPos | undefined;
      if (gp) return { x: gp.x, y: gp.y };
    }

    return null;
  }

  private onPointerDown = (e: PointerEvent): void => {
    const pt = this.getCanvasLocal(e.clientX, e.clientY);
    this.activePointers.set(e.pointerId, { x: pt.x, y: pt.y, button: e.button, type: e.pointerType });
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      // ignore
    }

    if (this.activePointers.size === 1) {
      this.downPoint = { x: pt.x, y: pt.y, button: e.button, altKey: e.altKey };
      this.dragMode = 'none';
      this.didPinch = false;
    } else if (this.activePointers.size === 2) {
      const [a, b] = Array.from(this.activePointers.values());
      this.lastPinchDist = Math.hypot(b.x - a.x, b.y - a.y);
      this.lastPinchMid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      this.didPinch = true;
      this.dragMode = 'pan';
    }
  };

  private onPointerMove = (e: PointerEvent): void => {
    const pt = this.getCanvasLocal(e.clientX, e.clientY);
    const prev = this.activePointers.get(e.pointerId);

    if (prev) {
      const dx = pt.x - prev.x;
      const dy = pt.y - prev.y;
      prev.x = pt.x;
      prev.y = pt.y;

      if (this.activePointers.size === 2) {
        const [a, b] = Array.from(this.activePointers.values());
        const dist = Math.hypot(b.x - a.x, b.y - a.y);
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        if (this.lastPinchDist > 8) {
          const zoomDelta = (dist - this.lastPinchDist) * 0.004;
          this.cameraCtrl.adjustZoom(zoomDelta);
        }
        if (this.lastPinchMid) {
          this.cameraCtrl.panByScreenDelta(mid.x - this.lastPinchMid.x, mid.y - this.lastPinchMid.y);
        }
        this.lastPinchDist = dist;
        this.lastPinchMid = mid;
        this.didPinch = true;
        return;
      }

      if (this.downPoint) {
        const totalMove = Math.hypot(pt.x - this.downPoint.x, pt.y - this.downPoint.y);
        const threshold = e.pointerType === 'mouse' ? MOUSE_DRAG_THRESHOLD : TOUCH_DRAG_THRESHOLD;
        if (this.dragMode === 'none' && totalMove >= threshold) {
          // Right-click drag or Alt+Left drag orbits 3D camera; Middle or Left drag pans
          if (this.downPoint.button === 2 || this.downPoint.altKey) {
            this.dragMode = 'orbit';
          } else {
            this.dragMode = 'pan';
          }
        }
        if (this.dragMode === 'orbit') {
          this.cameraCtrl.rotateBy(-dx * 0.0075, dy * 0.0055);
          return;
        }
        if (this.dragMode === 'pan') {
          this.cameraCtrl.panByScreenDelta(dx, dy);
          return;
        }
      }
      return;
    }

    // Hover picking on desktop mouse
    if (e.pointerType === 'mouse') {
      const tile = this.pickGridTile(e.clientX, e.clientY);
      this.hooks.onHoverChange(tile);
      this.canvas.style.cursor = tile ? 'pointer' : 'grab';
    }
  };

  private onPointerUp = (e: PointerEvent): void => {
    const wasTracked = this.activePointers.has(e.pointerId);
    this.activePointers.delete(e.pointerId);
    try {
      if (this.canvas.hasPointerCapture(e.pointerId)) {
        this.canvas.releasePointerCapture(e.pointerId);
      }
    } catch {
      // ignore
    }

    if (!wasTracked) return;

    const wasClick =
      this.dragMode === 'none' &&
      !this.didPinch &&
      this.downPoint !== null &&
      (this.downPoint.button === 0 || e.pointerType !== 'mouse');

    if (this.activePointers.size === 0) {
      this.downPoint = null;
      this.dragMode = 'none';
      this.lastPinchMid = null;
      this.lastPinchDist = 0;
    }

    if (wasClick) {
      const tile = this.pickGridTile(e.clientX, e.clientY);
      if (tile) {
        this.hooks.onTileTap(tile, e.pointerType);
      } else {
        this.hooks.onOffBoardTap?.();
      }
    }
  };

  private onPointerLeave = (): void => {
    if (this.activePointers.size === 0) {
      this.hooks.onHoverChange(null);
    }
  };

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const delta = -Math.sign(e.deltaY) * 0.12;
    this.cameraCtrl.adjustZoom(delta);
  };

  // ===== Public BattleRendererHandle API =====

  public resetCamera(): void {
    this.cameraCtrl.reset();
  }

  public adjustZoom(delta: number): void {
    this.cameraCtrl.adjustZoom(delta);
  }

  public rotateCamera(deltaRadians: number): void {
    this.cameraCtrl.snapRotate(deltaRadians);
  }

  public toggleTacticam(): CameraMode3D {
    return this.cameraCtrl.toggleTacticam();
  }

  public setCameraMode(mode: CameraMode3D): void {
    this.cameraCtrl.setMode(mode);
  }

  public getCameraMode(): CameraMode3D {
    return this.cameraCtrl.getMode();
  }

  public focusOnGrid(pos: GridPos): void {
    const state = this.hooks.getState();
    if (!state) return;
    const b = state.battle;
    const wp = gridToWorld3D(pos.x, pos.y, b.width, b.height, 0.25);
    this.cameraCtrl.focusWorldPos(new THREE.Vector3(wp.x, wp.y, wp.z), true);
  }

  public cancelActiveAnims(): void {
    for (const entry of this.unitMap.values()) {
      entry.anim = null;
      entry.hitFlash = 0;
      entry.squash = 0;
    }
    this.clearProjectiles();
  }

  private worldPointForTile(battle: BattleState, pos: GridPos, yLift = 0): THREE.Vector3 {
    const t = tileAt(battle, pos);
    const wp = gridToWorld3D(
      pos.x,
      pos.y,
      battle.width,
      battle.height,
      (t ? getTerrainSurfaceY(t.terrain) : 0) + yLift
    );
    return new THREE.Vector3(wp.x, wp.y, wp.z);
  }

  public consumeEvents(events: BattleEvent[]): void {
    const view = this.hooks.getState();
    if (!view || events.length === 0) return;
    const b = view.battle;

    for (const ev of events) {
      switch (ev.type) {
        case 'move': {
          if (ev.path.length >= 2) {
            const entry = this.unitMap.get(ev.unitId);
            const pts = ev.path.map((p) => this.worldPointForTile(b, p, 0));
            if (entry) {
              entry.anim = {
                kind: 'path',
                points: pts,
                elapsed: 0,
                duration: Math.min(0.55, 0.14 * (pts.length - 1) + 0.08),
                arcHeight: 0.34,
                leanAngle: 0.14,
              };
            }
            const last = ev.path[ev.path.length - 1];
            this.focusOnGrid(last);
            this.spawnBurst(pts[0].clone().add(new THREE.Vector3(0, 0.1, 0)), ['#efe3c6', '#c49d68'], 6, 'confetti');
            sfx.step();
          }
          break;
        }

        case 'dash': {
          const entry = this.unitMap.get(ev.unitId);
          const pFrom = this.worldPointForTile(b, ev.from, 0);
          const pTarget = this.worldPointForTile(b, ev.targetPos, 0);
          const pTo = this.worldPointForTile(b, ev.to, 0);
          if (entry) {
            entry.anim = {
              kind: 'dash',
              points: [pFrom, pTarget.clone().lerp(pTo, 0.35), pTo],
              elapsed: 0,
              duration: 0.28,
              arcHeight: 0.24,
              leanAngle: 0.34,
            };
          }
          const targetEntry = this.unitMap.get(ev.targetId);
          if (targetEntry) {
            targetEntry.hitFlash = 1;
            targetEntry.squash = 1;
          }
          this.cameraCtrl.triggerShake(0.22, 0.18);
          this.focusOnGrid(ev.targetPos);
          this.spawnBurst(pTarget.clone().add(new THREE.Vector3(0, 0.65, 0)), ['#ff7b29', '#ffd166', '#fbf3df'], 16, 'confetti');
          this.spawnPopup(pTarget.clone().add(new THREE.Vector3(0, 1.35, 0)), `DASH! -${ev.damage}`, '#9c2c0e', '#ffe5b4', 1.12);
          sfx.dash();
          break;
        }

        case 'jump': {
          const entry = this.unitMap.get(ev.unitId);
          const pFrom = this.worldPointForTile(b, ev.from, 0);
          const pAlly = this.worldPointForTile(b, ev.allyPos, 0);
          const pTo = this.worldPointForTile(b, ev.to, 0);
          if (entry) {
            entry.anim = {
              kind: 'jump',
              points: [pFrom, pAlly, pTo],
              elapsed: 0,
              duration: 0.52,
              arcHeight: 1.85,
              spinFull: true,
            };
            entry.squash = 0.9;
          }
          // Squash springboard ally!
          const allyUnit = unitAt(b, ev.allyPos);
          if (allyUnit) {
            const allyEntry = this.unitMap.get(allyUnit.id);
            if (allyEntry) allyEntry.squash = 1;
          }
          this.focusOnGrid(ev.to);
          this.spawnBurst(pAlly.clone().add(new THREE.Vector3(0, 0.5, 0)), ['#f6d55c', '#fff4b8', '#fbf3df'], 14, 'confetti');
          this.spawnPopup(pAlly.clone().add(new THREE.Vector3(0, 1.4, 0)), 'TEAM JUMP!', '#6b4700', '#fff4b8', 1.1);
          if (ev.coopBoost) {
            this.spawnBurst(pTo.clone().add(new THREE.Vector3(0, 0.55, 0)), ['#fce078', '#ff9234', '#fbf3df'], 16, 'confetti');
            this.spawnPopup(pTo.clone().add(new THREE.Vector3(0, 1.65, 0)), ev.coopBoost, '#8a3c00', '#ffe994', 1.14);
          }
          sfx.jump();
          break;
        }

        case 'knockback': {
          const entry = this.unitMap.get(ev.unitId);
          const pFrom = this.worldPointForTile(b, ev.from, 0);
          const pTo = this.worldPointForTile(b, ev.to, 0);
          if (!ev.bumped) {
            if (entry) {
              entry.anim = {
                kind: 'knockback',
                points: [pFrom, pTo],
                elapsed: 0,
                duration: 0.24,
                arcHeight: 0.3,
                leanAngle: -0.28,
              };
              entry.squash = 0.85;
            }
            this.spawnBurst(pTo.clone().add(new THREE.Vector3(0, 0.2, 0)), ['#fbf3df', '#d9c095'], 10, 'confetti');
          } else {
            if (entry) {
              entry.hitFlash = 1;
              entry.squash = 1;
            }
            if (ev.bumpedUnitId) {
              const other = this.unitMap.get(ev.bumpedUnitId);
              if (other) {
                other.hitFlash = 1;
                other.squash = 1;
              }
            }
            this.cameraCtrl.triggerShake(0.32, 0.24);
            this.spawnBurst(pTo.clone().add(new THREE.Vector3(0, 0.65, 0)), ['#ff9f43', '#e53e30', '#fbf3df'], 20, 'plank');
            this.spawnPopup(pTo.clone().add(new THREE.Vector3(0, 1.65, 0)), `BUMP! -${ev.bumpDamage ?? 2}`, '#8a1c0b', '#ffe09e', 1.18);
            sfx.coverBreak();
          }
          break;
        }

        case 'hazard': {
          const p = this.worldPointForTile(b, ev.pos, 0.55);
          this.cameraCtrl.triggerShake(0.38, 0.28);
          if (ev.kind === 'beehive') {
            this.spawnBurst(p, ['#f6c945', '#2b1b0e', '#fff2a6', '#e67e22'], 30, 'confetti');
            this.spawnPopup(p.clone().add(new THREE.Vector3(0, 0.9, 0)), 'BEEHIVE BOOM! -3', '#7a3500', '#ffe985', 1.22);
            sfx.coverBreak();
          } else {
            this.spawnBurst(p, ['#5bc0eb', '#b8ebff', '#fbf3df'], 28, 'droplet');
            this.spawnPopup(p.clone().add(new THREE.Vector3(0, 0.9, 0)), 'SPRINKLER BLAST!', '#0d4a6b', '#d9f6ff', 1.18);
            sfx.dash();
          }
          break;
        }

        case 'attack': {
          const pFrom = this.worldPointForTile(b, ev.from, 0.72);
          const pTo = this.worldPointForTile(b, ev.to, 0.55);
          const lobbed = ev.arc === 'lobbed';
          this.spawnProjectile3D(pFrom, pTo, ev.arc, ev.attackerKind);
          this.focusOnGrid(ev.to);
          if (lobbed) sfx.lob();
          else sfx.shoot();

          if (!ev.hit) {
            this.spawnBurst(pTo, ['#c89457', '#e6c28b'], 12, 'plank');
            this.spawnPopup(pTo.clone().add(new THREE.Vector3(0, 0.9, 0)), 'COVER BLOCK!', '#5d4037', '#f5e8d0', 1.02);
            sfx.miss();
          } else {
            if (ev.targetId) {
              const te = this.unitMap.get(ev.targetId);
              if (te) {
                te.hitFlash = 1;
                te.squash = 1;
              }
            }
            const strong = ev.matchup === 'advantage';
            this.cameraCtrl.triggerShake(strong ? 0.3 : 0.16, strong ? 0.22 : 0.14);
            this.spawnBurst(
              pTo,
              strong ? ['#f6d55c', '#e53e30', '#fbf3df'] : ['#e53e30', '#fbf3df'],
              strong ? 20 : 12,
              'confetti'
            );
            const label = strong
              ? `▲ STRONG! -${ev.damage}`
              : ev.matchup === 'disadvantage'
                ? `▼ WEAK -${ev.damage}`
                : `-${ev.damage}`;
            this.spawnPopup(
              pTo.clone().add(new THREE.Vector3(0, 0.95, 0)),
              label,
              strong ? '#8a1c0b' : '#4a2c17',
              strong ? '#ffe082' : '#fbf3df',
              strong ? 1.18 : 1.04
            );
            if (ev.status) {
              this.spawnPopup(
                pTo.clone().add(new THREE.Vector3(0, 1.42, 0)),
                `${ev.status.toUpperCase()}!`,
                '#4a2c17',
                '#fff0b8',
                0.94
              );
            }
            sfx.hit(strong);
          }
          break;
        }

        case 'ability':
        case 'item': {
          const pTo = this.worldPointForTile(b, ev.to, 0.6);
          const name = ev.type === 'ability' ? ev.abilityName : ev.itemName;
          const isHeal = Boolean(ev.heal && !ev.damage);
          this.spawnBurst(
            pTo,
            isHeal ? ['#66bb6a', '#b9f6ca', '#fbf3df'] : ['#ab47bc', '#ffd54f', '#fbf3df'],
            18,
            'confetti'
          );
          const detail = isHeal
            ? `${name} +${ev.heal} HP`
            : ev.damage
              ? `${name} -${ev.damage}`
              : `${name}!`;
          this.spawnPopup(
            pTo.clone().add(new THREE.Vector3(0, 0.95, 0)),
            detail,
            isHeal ? '#1b5e20' : '#4a148c',
            isHeal ? '#dff7df' : '#f3e5f5',
            1.08
          );
          if (isHeal) sfx.heal();
          else sfx.hit(false);
          break;
        }

        case 'cover_break': {
          const p = this.worldPointForTile(b, ev.pos, 0.48);
          const cols =
            ev.kind === 'haystack'
              ? ['#e7bd4c', '#f5de8a', '#b88625']
              : ['#c98d4b', '#96612c', '#e6c28b'];
          this.spawnBurst(p, cols, 22, 'plank');
          this.spawnPopup(
            p.clone().add(new THREE.Vector3(0, 0.8, 0)),
            ev.splashDamage ? `SMASH! +${ev.splashDamage} AoE` : 'CRUNCH!',
            '#6d3b12',
            '#fde9c9',
            1.05
          );
          sfx.coverBreak();
          break;
        }

        case 'rescue': {
          const p = this.worldPointForTile(b, ev.pos, 0.65);
          this.spawnBurst(p, ['#f6d55c', '#58b947', '#45b6db', '#fbf3df'], 28, 'confetti');
          this.spawnPopup(p.clone().add(new THREE.Vector3(0, 1.0, 0)), `FREED ${ev.unitName}!`, '#1b5e20', '#fff7cc', 1.22);
          sfx.rescue();
          break;
        }

        case 'status_tick': {
          const p = this.worldPointForTile(b, ev.pos, 0.65);
          const entry = this.unitMap.get(ev.unitId);
          if (entry) entry.hitFlash = 0.85;
          const prefix =
            ev.status === 'burn'
              ? 'BURN'
              : ev.status === 'rooted'
                ? 'THORNS'
                : ev.status === 'acid'
                  ? 'PIERCE'
                  : 'SPLASH';
          this.spawnBurst(p, ['#ff7043', '#ffd54f', '#fbf3df'], 10, 'confetti');
          this.spawnPopup(p.clone().add(new THREE.Vector3(0, 0.85, 0)), `${prefix} -${ev.damage}`, '#9c1c12', '#ffe2d6', 1.0);
          break;
        }

        case 'heal': {
          const p = this.worldPointForTile(b, ev.pos, 0.6);
          this.spawnBurst(p, ['#66bb6a', '#c8e6c9', '#fbf3df'], 12, 'confetti');
          this.spawnPopup(p.clone().add(new THREE.Vector3(0, 0.9, 0)), `+${ev.amount} ${ev.source}`, '#1b5e20', '#e3f9e5', 1.04);
          sfx.heal();
          break;
        }

        case 'unit_ko': {
          const p = this.worldPointForTile(b, ev.pos, 0.6);
          const entry = this.unitMap.get(ev.unitId);
          if (entry && entry.koTimer <= 0) {
            entry.koTimer = 0.56;
            entry.koOrigin = entry.rig.root.position.clone();
          }
          this.spawnBurst(p, ['#fbf3df', '#d9483b', '#f6d55c'], 22, 'confetti');
          this.spawnPopup(
            p.clone().add(new THREE.Vector3(0, 1.15, 0)),
            ev.team === 'player' ? 'HARVESTED!' : 'ROUTED!',
            '#7a1b12',
            '#ffdfd9',
            1.16
          );
          break;
        }

        case 'banner': {
          this.banner = {
            text: ev.text,
            tone: ev.tone,
            startMs: performance.now(),
            durationMs: ev.tone === 'victory' || ev.tone === 'defeat' ? 2400 : 1100,
          };
          if (ev.tone === 'victory') sfx.victory();
          if (ev.tone === 'defeat') sfx.defeat();
          break;
        }
      }
    }
  }

  private spawnProjectile3D(from: THREE.Vector3, to: THREE.Vector3, arc: string, attackerKind: string): void {
    const group = new THREE.Group();
    const colorMap: Record<string, number> = {
      pea: 0x7be054,
      lemon: 0xf7db48,
      corn: 0xffe47a,
      chili: 0xf24d33,
      carrot: 0xf58a2c,
      lettuce: 0x8be05c,
      blackberry: 0x7b47b8,
      sprayer: 0x99cc44,
      scarecrow: 0x3a2e28,
    };
    const col = colorMap[attackerKind] ?? (arc === 'lobbed' ? 0xf5d742 : 0x8be05c);
    const mat = new THREE.MeshStandardMaterial({
      color: col,
      emissive: col,
      emissiveIntensity: 0.25,
      roughness: 0.55,
    });

    let core: THREE.Mesh;
    if (attackerKind === 'lettuce') {
      core = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.04, 10), mat);
    } else if (attackerKind === 'carrot') {
      core = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.42, 7), mat);
      core.rotation.x = Math.PI / 2;
    } else {
      core = new THREE.Mesh(new THREE.SphereGeometry(arc === 'lobbed' ? 0.17 : 0.12, 10, 8), mat);
    }
    core.castShadow = true;
    group.add(core);

    // Paper Mario cream halo ring
    const halo = new THREE.Mesh(
      new THREE.RingGeometry(0.15, 0.22, 14),
      new THREE.MeshBasicMaterial({ color: 0xfff8dc, side: THREE.DoubleSide, transparent: true, opacity: 0.7 })
    );
    group.add(halo);

    group.position.copy(from);
    this.fxGroup.add(group);

    this.projectiles.push({
      mesh: group,
      from: from.clone(),
      to: to.clone(),
      elapsed: 0,
      duration: arc === 'lobbed' ? 0.36 : arc === 'melee' ? 0.16 : 0.22,
      arcHeight: arc === 'lobbed' ? 2.1 : 0.24,
      spinSpeed: attackerKind === 'lettuce' ? 18 : 9,
    });
  }

  private spawnBurst(
    origin: THREE.Vector3,
    colors: string[],
    count: number,
    style: 'confetti' | 'plank' | 'droplet'
  ): void {
    const geo =
      style === 'plank' ? this.plankGeo : style === 'droplet' ? this.dropletGeo : this.confettiGeo;

    for (let i = 0; i < count; i++) {
      const col = colors[i % colors.length];
      const mat = new THREE.MeshStandardMaterial({
        color: new THREE.Color(col),
        roughness: style === 'droplet' ? 0.25 : 0.85,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.copy(origin);
      mesh.castShadow = true;

      const angle = Math.random() * Math.PI * 2;
      const speed = (style === 'droplet' ? 2.4 : 1.5) + Math.random() * 2.6;
      const vy = (style === 'plank' ? 3.2 : 2.6) + Math.random() * 2.4;

      this.fxGroup.add(mesh);
      this.particles.push({
        mesh,
        vel: new THREE.Vector3(Math.cos(angle) * speed, vy, Math.sin(angle) * speed),
        rotVel: new THREE.Vector3(
          (Math.random() - 0.5) * 14,
          (Math.random() - 0.5) * 14,
          (Math.random() - 0.5) * 14
        ),
        elapsed: 0,
        life: 0.52 + Math.random() * 0.42,
        gravity: style === 'confetti' ? 7.8 : 11.5,
        floorY: 0.04,
      });
    }
  }

  private spawnPopup(
    worldPos: THREE.Vector3,
    text: string,
    fg: string,
    bg: string,
    scale = 1
  ): void {
    this.popups.push({
      worldPos: worldPos.clone(),
      text,
      fg,
      bg,
      scale,
      elapsed: 0,
      duration: 1.05,
    });
  }

  private clearProjectiles(): void {
    for (const p of this.projectiles) {
      this.fxGroup.remove(p.mesh);
      p.mesh.traverse((child) => {
        const m = child as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
        if (m.material) {
          if (Array.isArray(m.material)) m.material.forEach((mat) => mat.dispose());
          else m.material.dispose();
        }
      });
    }
    this.projectiles = [];
  }

  private computeTacticalCache(view: RendererViewState): CachedTactics {
    const b = view.battle;
    const focusTile = view.previewTile ?? view.hoveredTile;
    const selectedUnit = view.selectedUnitId
      ? b.units.find((u) => u.id === view.selectedUnitId && u.alive)
      : undefined;
    const inspectedEnemy = view.inspectedEnemyId
      ? b.units.find((u) => u.id === view.inspectedEnemyId && u.alive && u.team === 'enemy')
      : undefined;

    const unitSig = b.units
      .map(
        (u) =>
          `${u.id}:${u.pos.x},${u.pos.y}:${u.hp}:${u.alive ? 1 : 0}:${u.actions.hasMoved ? 1 : 0}${u.actions.hasDashed ? 1 : 0}${u.actions.hasAttacked ? 1 : 0}${u.actions.hasUsedSkill ? 1 : 0}:${u.abilityCooldown}:${u.statuses.map((s) => s.kind[0]).join('')}`
      )
      .join(';');

    const key = [
      b.mapId,
      b.turn,
      b.phase,
      b.status,
      view.selectedUnitId ?? '-',
      view.inspectedEnemyId ?? '-',
      view.showAllDangerZone ? 1 : 0,
      view.mode,
      view.selectedItemId ?? '-',
      focusTile ? `${focusTile.x},${focusTile.y}` : '-',
      unitSig,
    ].join('|');

    if (this.tacticalCache && this.tacticalCache.key === key) {
      return this.tacticalCache;
    }

    const movableMap =
      b.phase === 'player' && selectedUnit && view.mode === 'move'
        ? computeMovableTiles(b, selectedUnit)
        : new Map<string, ReachableNode>();

    const jumpMap =
      b.phase === 'player' && selectedUnit && view.mode === 'move'
        ? computeTeamJumpOptions(b, selectedUnit)
        : new Map<string, JumpOption>();

    const dashList =
      b.phase === 'player' && selectedUnit && view.mode === 'move'
        ? computeDashOptions(b, selectedUnit)
        : [];
    const dashEnemyIds = new Set(dashList.map((d) => d.enemyId));

    const attackTiles =
      b.phase === 'player' && selectedUnit && (view.mode === 'attack' || view.mode === 'move')
        ? getAttackableTiles(b, selectedUnit)
        : [];
    const attackKeySet = new Set(attackTiles.map(posKey));

    // Projected weapon range when hovering a Move/Jump destination tile!
    let isProjectingFromMove = false;
    let weaponRangeOrigin: GridPos | null = null;
    if (b.phase === 'player' && selectedUnit && !selectedUnit.actions.hasAttacked) {
      if (
        view.mode === 'move' &&
        focusTile &&
        (movableMap.has(posKey(focusTile)) || jumpMap.has(posKey(focusTile)))
      ) {
        isProjectingFromMove = true;
        weaponRangeOrigin = focusTile;
      } else if (view.mode === 'attack') {
        weaponRangeOrigin = selectedUnit.pos;
      }
    }
    const weaponRangeKeys = new Set<string>();
    if (selectedUnit && weaponRangeOrigin) {
      for (const p of getWeaponRangeTiles(b, selectedUnit, weaponRangeOrigin)) {
        weaponRangeKeys.add(posKey(p));
      }
    }

    const abilityTiles =
      b.phase === 'player' && selectedUnit && view.mode === 'ability'
        ? getAbilityTargetTiles(b, selectedUnit)
        : [];
    const abilityKeySet = new Set(abilityTiles.map(posKey));

    const itemTiles =
      b.phase === 'player' && selectedUnit && view.mode === 'item' && view.selectedItemId
        ? getItemTargetTiles(b, selectedUnit, view.selectedItemId)
        : [];
    const itemKeySet = new Set(itemTiles.map(posKey));

    const enemyThreat = view.showAllDangerZone
      ? getAllEnemiesThreatZone(b)
      : inspectedEnemy
        ? getEnemyThreatZone(b, inspectedEnemy)
        : null;

    // Focus combat forecast (shared identically with Mario + Rabbids floating pill!)
    let focusForecast: CombatForecast | null = null;
    if (
      b.phase === 'player' &&
      selectedUnit &&
      !selectedUnit.actions.hasAttacked &&
      focusTile &&
      (view.mode === 'attack' || view.mode === 'move')
    ) {
      const fu = unitAt(b, focusTile);
      const fcTile = tileAt(b, focusTile);
      const isEnemy = Boolean(fu && fu.team === 'enemy');
      const isCover = Boolean(fcTile?.cover?.destructible);
      if (isEnemy || isCover || (view.mode === 'attack' && selectedUnit.weapon.arc === 'lobbed')) {
        const fc = forecastAttack(b, selectedUnit, focusTile);
        if (fc.canAttack || !fc.reason?.startsWith('Out of range')) {
          focusForecast = fc;
        }
      }
    }

    // AoE 3x3 preview tiles
    const aoePreviewKeys = new Set<string>();
    if (b.phase === 'player' && selectedUnit && focusTile) {
      let radius = 0;
      if (
        (view.mode === 'attack' || view.mode === 'move') &&
        focusForecast?.canAttack &&
        selectedUnit.weapon.aoeRadius
      ) {
        radius = selectedUnit.weapon.aoeRadius;
      } else if (view.mode === 'ability' && abilityKeySet.has(posKey(focusTile))) {
        radius = selectedUnit.ability?.aoeRadius ?? 0;
      } else if (
        view.mode === 'item' &&
        view.selectedItemId &&
        itemKeySet.has(posKey(focusTile))
      ) {
        radius = ITEM_REGISTRY[view.selectedItemId]?.aoeRadius ?? 0;
      }

      if (radius > 0) {
        for (let y = 0; y < b.height; y++) {
          for (let x = 0; x < b.width; x++) {
            const p = { x, y };
            const inArea =
              view.mode === 'ability' && selectedUnit.ability?.targetType === 'aoe_self'
                ? manhattan(focusTile, p) <= radius
                : chebyshev(focusTile, p) <= radius;
            if (inArea) aoePreviewKeys.add(posKey(p));
          }
        }
      }
    }

    const doneUnitIds = new Set<string>();
    for (const u of b.units) {
      if (u.team === 'player' && u.alive && !unitHasMeaningfulAction(b, u)) {
        doneUnitIds.add(u.id);
      }
    }

    this.tacticalCache = {
      key,
      selectedUnit,
      inspectedEnemy,
      movableMap,
      jumpMap,
      dashList,
      dashEnemyIds,
      attackKeySet,
      weaponRangeKeys,
      isProjectingFromMove,
      abilityKeySet,
      itemKeySet,
      aoePreviewKeys,
      enemyThreat,
      focusForecast,
      doneUnitIds,
    };
    return this.tacticalCache;
  }

  private syncUnits(view: RendererViewState, tac: CachedTactics, dt: number): void {
    const b = view.battle;
    const aliveIds = new Set<string>();
    const camYaw = this.cameraCtrl.getCurrentYaw();

    for (const u of b.units) {
      if (!u.alive) continue;
      aliveIds.add(u.id);

      let entry = this.unitMap.get(u.id);
      if (!entry || entry.visualKind !== u.visualKind) {
        if (entry) this.disposeUnitEntry(entry);
        const rig = createPaperStandeeRig(u.visualKind, u.team, Boolean(u.isBoss), this.textures);
        const hitGeo = new THREE.CylinderGeometry(
          u.isBoss ? 0.56 : 0.44,
          u.isBoss ? 0.56 : 0.44,
          rig.height + 0.15,
          10
        );
        const hitMat = new THREE.MeshBasicMaterial({ visible: false });
        const hitCylinder = new THREE.Mesh(hitGeo, hitMat);
        hitCylinder.position.y = (rig.height + 0.15) / 2;
        hitCylinder.userData.gridPos = { x: u.pos.x, y: u.pos.y };
        rig.root.add(hitCylinder);

        const wp = this.worldPointForTile(b, u.pos, 0);
        rig.root.position.copy(wp);

        entry = {
          id: u.id,
          visualKind: u.visualKind,
          team: u.team,
          isBoss: Boolean(u.isBoss),
          rig,
          hitCylinder,
          hitFlash: 0,
          squash: 0,
          anim: null,
          koTimer: 0,
        };
        this.unitMap.set(u.id, entry);
        this.unitGroup.add(rig.root);
      }

      entry.hitCylinder.userData.gridPos = { x: u.pos.x, y: u.pos.y };

      // Position & Paper Mario Animations
      const restingPos = this.worldPointForTile(b, u.pos, 0);
      let hopY = 0;
      let tiltZ = 0;
      let extraSpinY = 0;

      if (entry.anim) {
        const anim = entry.anim;
        anim.elapsed += dt;
        const t = Math.min(1, anim.elapsed / Math.max(0.01, anim.duration));

        if (anim.kind === 'jump' && anim.points.length >= 3) {
          // 2-phase Team-Jump: quick hop onto ally (0..0.32), soaring spin vault to dest (0.32..1)!
          if (t < 0.32) {
            const p = t / 0.32;
            entry.rig.root.position.lerpVectors(anim.points[0], anim.points[1], p);
            hopY = Math.sin(p * Math.PI) * 0.48;
          } else {
            const p = (t - 0.32) / 0.68;
            entry.rig.root.position.lerpVectors(anim.points[1], anim.points[2], p);
            hopY = Math.sin(p * Math.PI) * anim.arcHeight;
            extraSpinY = p * Math.PI * 2;
          }
        } else if (anim.points.length >= 2) {
          const segCount = anim.points.length - 1;
          const scaled = t * segCount;
          const segIdx = Math.min(segCount - 1, Math.floor(scaled));
          const segT = scaled - segIdx;
          entry.rig.root.position.lerpVectors(anim.points[segIdx], anim.points[segIdx + 1], segT);
          hopY = Math.sin(segT * Math.PI) * anim.arcHeight;
          tiltZ = Math.sin(segT * Math.PI) * (anim.leanAngle ?? 0.14);
        }

        if (t >= 1) {
          entry.anim = null;
          entry.squash = Math.max(entry.squash, 0.55);
        }
      } else {
        entry.rig.root.position.lerp(restingPos, 1 - Math.exp(-dt * 18));
      }

      // Gentle Paper Mario idle breathe + selected bounce + Tacticam vertical legibility tilt
      const isSelected = u.id === view.selectedUnitId;
      const isInspected = u.id === view.inspectedEnemyId;
      const isDashTarget = tac.dashEnemyIds.has(u.id);
      const isDone = tac.doneUnitIds.has(u.id);
      const idlePhase = this.elapsedTotal * (isSelected ? 4.4 : 2.6) + u.pos.x * 0.9 + u.pos.y * 1.3;
      const idleBounce = entry.anim ? 0 : Math.abs(Math.sin(idlePhase)) * (isSelected ? 0.085 : 0.025);
      const camPitch = this.cameraCtrl.getCurrentPitch();
      const tacticamTiltX = -Math.max(0, (camPitch - 0.72) * 0.52);

      entry.rig.tiltGroup.position.y = hopY + idleBounce;
      entry.rig.tiltGroup.rotation.x = THREE.MathUtils.lerp(
        entry.rig.tiltGroup.rotation.x,
        tacticamTiltX,
        1 - Math.exp(-dt * 12)
      );
      entry.rig.tiltGroup.rotation.z =
        tiltZ + (entry.anim ? 0 : Math.sin(idlePhase * 0.5) * (isSelected ? 0.045 : 0.018));

      // Squash & stretch decay
      if (entry.squash > 0) {
        entry.squash = Math.max(0, entry.squash - dt * 4.5);
      }
      const sq = Math.sin(entry.squash * Math.PI) * 0.22;
      entry.rig.tiltGroup.scale.set(1 + sq * 0.75, 1 - sq, 1 + sq * 0.4);

      // Camera-aligned billboard + Paper Mario 180° flip turn when changing facing!
      entry.rig.root.rotation.y = camYaw;
      const defaultFacing = SPRITE_DEFAULT_FACING[u.visualKind] ?? 'right';
      const shouldFlip = u.facing !== defaultFacing;
      entry.rig.targetFlipYaw = shouldFlip ? Math.PI : 0;
      entry.rig.currentFlipYaw = THREE.MathUtils.lerp(
        entry.rig.currentFlipYaw,
        entry.rig.targetFlipYaw,
        1 - Math.exp(-dt * 14)
      );
      entry.rig.flipGroup.rotation.y = entry.rig.currentFlipYaw + extraSpinY;

      // Hit-flash white glow & done-unit subtle warm desaturation (applied to both front & flipped back!)
      if (entry.hitFlash > 0) {
        entry.hitFlash = Math.max(0, entry.hitFlash - dt * 4.2);
      }
      if (entry.hitFlash > 0.02) {
        entry.rig.frontMat.emissive.setRGB(entry.hitFlash, entry.hitFlash * 0.92, entry.hitFlash * 0.85);
        entry.rig.frontMat.emissiveIntensity = entry.hitFlash * 1.1;
        entry.rig.backMat.emissive.copy(entry.rig.frontMat.emissive);
        entry.rig.backMat.emissiveIntensity = entry.rig.frontMat.emissiveIntensity;
      } else if (isSelected) {
        entry.rig.frontMat.emissive.set('#ffe499');
        entry.rig.frontMat.emissiveIntensity = 0.08 + Math.sin(this.elapsedTotal * 5) * 0.04;
        entry.rig.backMat.emissive.copy(entry.rig.frontMat.emissive);
        entry.rig.backMat.emissiveIntensity = entry.rig.frontMat.emissiveIntensity;
      } else {
        entry.rig.frontMat.emissive.set('#000000');
        entry.rig.frontMat.emissiveIntensity = 0;
        entry.rig.backMat.emissive.set('#000000');
        entry.rig.backMat.emissiveIntensity = 0;
      }

      const tintHex = isDone ? '#b5a892' : '#ffffff';
      entry.rig.frontMat.color.set(tintHex);
      entry.rig.backMat.color.set(isDone ? '#b5a892' : '#fffaf0');

      // Pedestal glowing ring state
      if (isSelected) {
        entry.rig.ringMat.color.set('#ffe052');
        entry.rig.ringMat.opacity = 0.78 + Math.sin(this.elapsedTotal * 6) * 0.16;
        const rs = 1 + Math.sin(this.elapsedTotal * 5) * 0.05;
        entry.rig.ringMesh.scale.set(rs, rs, 1);
      } else if (isDashTarget) {
        entry.rig.ringMat.color.set('#ff7b24');
        entry.rig.ringMat.opacity = 0.75 + Math.sin(this.elapsedTotal * 8) * 0.2;
      } else if (isInspected) {
        entry.rig.ringMat.color.set('#ef4437');
        entry.rig.ringMat.opacity = 0.82;
      } else {
        entry.rig.ringMat.opacity = 0;
      }
    }

    // Handle KO'd units (Paper Mario flat-spin flutter out, then remove cleanly)
    for (const [id, entry] of Array.from(this.unitMap.entries())) {
      if (aliveIds.has(id)) continue;
      if (entry.koTimer > 0) {
        entry.koTimer -= dt;
        const p = 1 - Math.max(0, entry.koTimer) / 0.56;
        entry.rig.tiltGroup.position.y = Math.sin(p * Math.PI) * 1.1;
        entry.rig.tiltGroup.rotation.x = p * Math.PI * 1.6;
        entry.rig.flipGroup.rotation.y += dt * 16;
        const sc = Math.max(0.05, 1 - p * 0.85);
        entry.rig.root.scale.setScalar(sc);
      } else {
        this.disposeUnitEntry(entry);
        this.unitMap.delete(id);
      }
    }

    // Rebuild unit pick list
    this.unitPickMeshes.length = 0;
    for (const entry of this.unitMap.values()) {
      if (aliveIds.has(entry.id)) {
        this.unitPickMeshes.push(entry.hitCylinder);
      }
    }
  }

  private disposeUnitEntry(entry: UnitVisualEntry): void {
    this.unitGroup.remove(entry.rig.root);
    entry.hitCylinder.geometry.dispose();
    (entry.hitCylinder.material as THREE.Material).dispose();
    entry.rig.dispose();
  }

  private updateEffects(dt: number): void {
    // 3D Projectiles
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.elapsed += dt;
      const t = Math.min(1, p.elapsed / p.duration);
      p.mesh.position.lerpVectors(p.from, p.to, t);
      p.mesh.position.y += Math.sin(t * Math.PI) * p.arcHeight;
      p.mesh.rotation.y += dt * p.spinSpeed;
      p.mesh.rotation.x += dt * p.spinSpeed * 0.6;
      if (t >= 1) {
        this.fxGroup.remove(p.mesh);
        p.mesh.traverse((child) => {
          const m = child as THREE.Mesh;
          if (m.geometry) m.geometry.dispose();
          if (m.material) {
            if (Array.isArray(m.material)) m.material.forEach((mat) => mat.dispose());
            else m.material.dispose();
          }
        });
        this.projectiles.splice(i, 1);
      }
    }

    // 3D Physics Particles (confetti, wood planks, hay straw, water droplets)
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const pt = this.particles[i];
      pt.elapsed += dt;
      pt.vel.y -= pt.gravity * dt;
      pt.mesh.position.addScaledVector(pt.vel, dt);
      if (pt.mesh.position.y < pt.floorY) {
        pt.mesh.position.y = pt.floorY;
        pt.vel.y = Math.abs(pt.vel.y) * 0.36;
        pt.vel.x *= 0.68;
        pt.vel.z *= 0.68;
      }
      pt.mesh.rotation.x += pt.rotVel.x * dt;
      pt.mesh.rotation.y += pt.rotVel.y * dt;
      pt.mesh.rotation.z += pt.rotVel.z * dt;

      const rem = 1 - pt.elapsed / pt.life;
      if (rem <= 0) {
        this.fxGroup.remove(pt.mesh);
        (pt.mesh.material as THREE.Material).dispose();
        this.particles.splice(i, 1);
      } else if (rem < 0.3) {
        pt.mesh.scale.setScalar(rem / 0.3);
      }
    }

    // World Popups
    for (let i = this.popups.length - 1; i >= 0; i--) {
      const pop = this.popups[i];
      pop.elapsed += dt;
      pop.worldPos.y += dt * 0.72;
      if (pop.elapsed >= pop.duration) {
        this.popups.splice(i, 1);
      }
    }

    // Phase Banner (real wall-clock timer so it never lingers on slow frames!)
    if (this.banner) {
      const elapsedMs = performance.now() - this.banner.startMs;
      if (elapsedMs >= this.banner.durationMs) {
        this.banner = null;
        if (this.lastBannerEmit !== null) {
          this.lastBannerEmit = null;
          this.hooks.onBannerChange?.(null);
        }
      } else {
        const payload: PhaseBannerOverlay = {
          text: this.banner.text,
          tone: this.banner.tone,
          progress: elapsedMs / this.banner.durationMs,
        };
        this.lastBannerEmit = payload;
        this.hooks.onBannerChange?.(payload);
      }
    }
  }

  private updateAimCamAndFocusAnchor(view: RendererViewState, tac: CachedTactics): void {
    const b = view.battle;
    const focusTile = view.previewTile ?? view.hoveredTile;
    const hero = tac.selectedUnit;

    // 1. Mario + Rabbids Over-the-Shoulder Aim Cam
    const wantsAimCam =
      b.phase === 'player' &&
      b.status === 'ongoing' &&
      Boolean(hero) &&
      (view.mode === 'attack' ||
        (view.mode === 'move' &&
          Boolean(view.previewTile) &&
          Boolean(tac.focusForecast?.canAttack)));

    if (wantsAimCam && hero) {
      let aimTile: GridPos | null = null;
      if (focusTile && tac.focusForecast) {
        aimTile = focusTile;
      } else if (view.mode === 'attack') {
        // Pick nearest shootable enemy so pressing Attack immediately frames a dramatic Aim Cam!
        let bestDist = Infinity;
        for (const u of b.units) {
          if (!u.alive || u.team !== 'enemy') continue;
          const d = manhattan(hero.pos, u.pos);
          if (d < bestDist && tac.attackKeySet.has(posKey(u.pos))) {
            bestDist = d;
            aimTile = u.pos;
          }
        }
      }
      if (aimTile && !samePos(aimTile, hero.pos)) {
        this.cameraCtrl.setAimFocus(
          this.worldPointForTile(b, hero.pos, 0.7),
          this.worldPointForTile(b, aimTile, 0.6)
        );
      } else {
        this.cameraCtrl.setAimFocus(null, null);
      }
    } else {
      this.cameraCtrl.setAimFocus(null, null);
    }

    // 2. Project 3D anchor for the floating Mario + Rabbids Target Forecast Pill!
    if (focusTile && (tac.focusForecast || (view.mode === 'move' && tac.dashList.some((d) => samePos(d.enemyPos, focusTile))))) {
      const targetUnit = unitAt(b, focusTile);
      const cover = this.world.getCoverVisual(focusTile);
      const entry = targetUnit ? this.unitMap.get(targetUnit.id) : undefined;
      const worldPt = entry
        ? entry.rig.root.position.clone().add(new THREE.Vector3(0, entry.rig.height + 0.55, 0))
        : this.worldPointForTile(b, focusTile, (cover?.height ?? 0.8) + 0.5);

      const projected = this.projectToScreen(worldPt);
      const anchorKey = `${Math.round(projected.x)},${Math.round(projected.y)},${projected.visible ? 1 : 0}`;
      if (anchorKey !== this.lastFocusAnchorKey) {
        this.lastFocusAnchorKey = anchorKey;
        this.hooks.onFocusAnchorChange?.(projected);
      }
    } else if (this.lastFocusAnchorKey !== 'none') {
      this.lastFocusAnchorKey = 'none';
      this.hooks.onFocusAnchorChange?.(null);
    }
  }

  private projectToScreen(worldPt: THREE.Vector3): ScreenAnchor {
    this.tmpVec3.copy(worldPt).project(this.cameraCtrl.camera);
    const visible = this.tmpVec3.z >= -1 && this.tmpVec3.z <= 1;
    return {
      x: (this.tmpVec3.x * 0.5 + 0.5) * this.cssW,
      y: (-this.tmpVec3.y * 0.5 + 0.5) * this.cssH,
      visible,
    };
  }

  private drawOverlay2D(view: RendererViewState, tac: CachedTactics): void {
    const ctx = this.overlayCtx;
    if (!ctx) return;

    ctx.save();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.cssW, this.cssH);

    const b = view.battle;

    // 1. Floating World-Space HP Bars & Status Pips above every living 3D standee
    for (const u of b.units) {
      if (!u.alive) continue;
      const entry = this.unitMap.get(u.id);
      if (!entry) continue;

      const headWorld = entry.rig.root.position
        .clone()
        .add(new THREE.Vector3(0, entry.rig.height + 0.28 + entry.rig.tiltGroup.position.y, 0));
      const sc = this.projectToScreen(headWorld);
      if (!sc.visible || sc.x < -60 || sc.x > this.cssW + 60 || sc.y < -40 || sc.y > this.cssH + 40) {
        continue;
      }

      const isSelected = u.id === view.selectedUnitId;
      const isBoss = Boolean(u.isBoss);
      const barW = isBoss ? 68 : isSelected ? 52 : 44;
      const barH = isBoss ? 9 : 7;
      const bx = sc.x - barW / 2;
      const by = sc.y;

      // Cream Paper Mario HP pill backing
      ctx.fillStyle = 'rgba(251, 243, 223, 0.94)';
      roundRect(ctx, bx - 3, by - 3, barW + 6, barH + 6, 5);
      ctx.fill();
      ctx.strokeStyle = isSelected ? '#e09a12' : '#452a16';
      ctx.lineWidth = isSelected ? 2.2 : 1.5;
      ctx.stroke();

      // Track
      ctx.fillStyle = '#d4c09b';
      roundRect(ctx, bx, by, barW, barH, 3);
      ctx.fill();

      // Health fill
      const ratio = Math.max(0, Math.min(1, u.hp / Math.max(1, u.maxHp)));
      ctx.fillStyle =
        u.team === 'player'
          ? ratio > 0.5
            ? '#5cb844'
            : ratio > 0.25
              ? '#edb328'
              : '#df4a3a'
          : isBoss
            ? '#d94c26'
            : '#d9483b';
      if (ratio > 0) {
        roundRect(ctx, bx, by, Math.max(4, barW * ratio), barH, 3);
        ctx.fill();
      }

      // Boss / Veteran Tag
      if (isBoss || u.isVeteran) {
        ctx.font = '800 10px Fredoka, Nunito, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillStyle = isBoss ? '#ffd84d' : '#ff9b70';
        ctx.strokeStyle = '#3b2110';
        ctx.lineWidth = 3;
        const badge = isBoss ? `★ ${u.name}` : '★ VET';
        ctx.strokeText(badge, sc.x, by - 5);
        ctx.fillText(badge, sc.x, by - 5);
      }

      // Compact HP numeric tag on right side when damaged or selected
      if (isSelected || isBoss || u.hp < u.maxHp) {
        ctx.font = '800 10px Nunito, sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.strokeStyle = '#3b2110';
        ctx.lineWidth = 3;
        ctx.strokeText(`${u.hp}`, bx + barW + 6, by + barH / 2);
        ctx.fillStyle = '#fffdf5';
        ctx.fillText(`${u.hp}`, bx + barW + 6, by + barH / 2);
      }

      // Status Chips above HP bar
      if (u.statuses.length > 0) {
        const chipW = 15;
        const gap = 3;
        const totalW = u.statuses.length * chipW + (u.statuses.length - 1) * gap;
        let cx = sc.x - totalW / 2;
        const cy = by - (isBoss || u.isVeteran ? 28 : 16);
        for (const st of u.statuses) {
          const style = STATUS_BADGE_STYLE[st.kind] ?? { label: '?', bg: '#666', fg: '#fff' };
          ctx.fillStyle = style.bg;
          roundRect(ctx, cx, cy, chipW, 13, 4);
          ctx.fill();
          ctx.strokeStyle = '#3b2110';
          ctx.lineWidth = 1.2;
          ctx.stroke();
          ctx.fillStyle = style.fg;
          ctx.font = '800 9px Nunito, sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(style.label, cx + chipW / 2, cy + 6.8);
          cx += chipW + gap;
        }
      }

      // Dashable lightning indicator above enemy
      if (tac.dashEnemyIds.has(u.id)) {
        ctx.font = '800 10px Fredoka, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.strokeStyle = '#4a1d06';
        ctx.lineWidth = 3;
        const dy = by - (u.statuses.length > 0 ? 22 : 7);
        ctx.strokeText('⚡ DASH', sc.x, dy);
        ctx.fillStyle = '#ffb53d';
        ctx.fillText('⚡ DASH', sc.x, dy);
      }
    }

    // 2. Objective Cage / Damaged Cover Mini-HP Tags
    for (const cv of this.world.getAllCoverVisuals()) {
      const tile = tileAt(b, cv.pos);
      if (!tile?.cover) continue;
      const showTag =
        cv.isObjectiveCage ||
        (tile.cover.destructible && tile.cover.hp < tile.cover.maxHp);
      if (!showTag) continue;

      const wp = cv.group.position.clone().add(new THREE.Vector3(0, cv.height + 0.25, 0));
      const sc = this.projectToScreen(wp);
      if (!sc.visible) continue;

      const label = cv.isObjectiveCage
        ? `RESCUE ${tile.cover.hp}/${tile.cover.maxHp}`
        : `${tile.cover.hp}/${tile.cover.maxHp}`;
      ctx.font = '800 10px Fredoka, Nunito, sans-serif';
      const tw = ctx.measureText(label).width + 12;
      ctx.fillStyle = cv.isObjectiveCage ? '#ffe985' : 'rgba(251, 243, 223, 0.92)';
      roundRect(ctx, sc.x - tw / 2, sc.y - 10, tw, 17, 6);
      ctx.fill();
      ctx.strokeStyle = '#452a16';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.fillStyle = cv.isObjectiveCage ? '#7a3500' : '#4a2c17';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, sc.x, sc.y - 1);
    }

    // 3. Bouncy Paper Mario Comic Damage / Event Popups!
    for (const pop of this.popups) {
      const sc = this.projectToScreen(pop.worldPos);
      if (!sc.visible) continue;
      const t = pop.elapsed / pop.duration;
      const alpha = t < 0.72 ? 1 : Math.max(0, 1 - (t - 0.72) / 0.28);
      const popIn = t < 0.14 ? 0.65 + (t / 0.14) * 0.45 : 1;
      const fontSize = Math.round(14 * pop.scale * popIn);

      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.font = `800 ${fontSize}px Fredoka, Nunito, sans-serif`;
      const tw = ctx.measureText(pop.text).width + 18;
      const th = fontSize + 10;

      // Slight comic slant
      ctx.translate(sc.x, sc.y);
      ctx.rotate(-0.04);

      ctx.fillStyle = pop.bg;
      roundRect(ctx, -tw / 2, -th / 2, tw, th, 8);
      ctx.fill();
      ctx.strokeStyle = '#452a16';
      ctx.lineWidth = 2.2;
      ctx.stroke();

      ctx.fillStyle = pop.fg;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(pop.text, 0, 1);
      ctx.restore();
    }

    ctx.restore();
  }

  private loop = (now: number): void => {
    this.rafId = requestAnimationFrame(this.loop);
    const dt = Math.min(0.05, Math.max(0.001, (now - this.lastTime) / 1000));
    this.lastTime = now;
    this.elapsedTotal += dt;

    const view = this.hooks.getState();
    if (!view) return;
    const b = view.battle;

    // Sync board dimensions to camera framing whenever map changes
    const dimSig = `${b.width}x${b.height}:${b.theme ?? 'spring'}`;
    if (dimSig !== this.lastBoardDims) {
      this.lastBoardDims = dimSig;
      this.cameraCtrl.setBoardBounds(
        b.width * TILE_SIZE_3D,
        b.height * TILE_SIZE_3D,
        this.cssW / Math.max(1, this.cssH)
      );
      // Warm theme-tuned ambient background
      const bgHex =
        b.theme === 'greenhouse' ? '#4d6654' : b.theme === 'autumn' ? '#6e3f21' : '#664022';
      this.scene.background = new THREE.Color(bgHex);
      (this.scene.fog as THREE.FogExp2).color.set(bgHex);
    }

    this.world.syncBattle(b);
    this.world.update(this.elapsedTotal, dt);

    const tac = this.computeTacticalCache(view);
    const focusTile = view.previewTile ?? view.hoveredTile;

    this.overlays.sync({
      battle: b,
      selectedUnit: tac.selectedUnit,
      inspectedEnemy: tac.inspectedEnemy,
      mode: view.mode,
      focusTile,
      movableMap: tac.movableMap,
      jumpMap: tac.jumpMap,
      dashList: tac.dashList,
      attackKeySet: tac.attackKeySet,
      weaponRangeKeys: tac.weaponRangeKeys,
      isProjectingFromMove: tac.isProjectingFromMove,
      abilityKeySet: tac.abilityKeySet,
      itemKeySet: tac.itemKeySet,
      aoePreviewKeys: tac.aoePreviewKeys,
      enemyThreat: tac.enemyThreat,
      focusForecast: tac.focusForecast,
    });

    this.updateAimCamAndFocusAnchor(view, tac);
    this.cameraCtrl.update(dt);
    this.overlays.update(this.elapsedTotal, this.cameraCtrl.camera.position);
    this.syncUnits(view, tac, dt);
    this.updateEffects(dt);

    this.renderer.render(this.scene, this.cameraCtrl.camera);
    this.drawOverlay2D(view, tac);
  };

  public destroy(): void {
    cancelAnimationFrame(this.rafId);
    this.resizeObserver.disconnect();
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.canvas.removeEventListener('pointermove', this.onPointerMove);
    this.canvas.removeEventListener('pointerup', this.onPointerUp);
    this.canvas.removeEventListener('pointercancel', this.onPointerUp);
    this.canvas.removeEventListener('pointerleave', this.onPointerLeave);
    this.canvas.removeEventListener('wheel', this.onWheel);
    this.canvas.removeEventListener('contextmenu', this.onContextMenu);

    for (const entry of this.unitMap.values()) {
      this.disposeUnitEntry(entry);
    }
    this.unitMap.clear();
    this.clearProjectiles();
    for (const pt of this.particles) {
      this.fxGroup.remove(pt.mesh);
      (pt.mesh.material as THREE.Material).dispose();
    }
    this.particles = [];
    this.confettiGeo.dispose();
    this.plankGeo.dispose();
    this.dropletGeo.dispose();

    this.overlays.dispose();
    this.world.dispose();
    this.textures.dispose();
    this.renderer.dispose();
  }
}
