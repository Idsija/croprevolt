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
import { chebyshev, getAdjacentCoverBadges, manhattan, posKey, samePos, tileAt, unitAt } from '../engine/grid';
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
import { getTileSurfaceY, PaperDioramaWorld } from './diorama';
import { TacticalOverlaySystem3D, type ProjectedSightlineTarget } from './tacticalOverlays';
import {
  CraftTextureLibrary,
  createPaperStandeeRig,
  hasVariantSprite,
  resolveVariantSpriteKey,
  SPRITE_DEFAULT_FACING,
  UNIT_WORLD_HEIGHTS,
  type PaperStandeeRig,
  type SpriteVariantKind,
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
  kind: 'path' | 'dash' | 'jump' | 'bounce' | 'knockback';
  points: THREE.Vector3[];
  elapsed: number;
  duration: number;
  arcHeight: number;
  spinFull?: boolean;
  leanAngle?: number;
}

type ActionPoseKind = 'none' | 'attack' | 'skill' | 'dash' | 'jump' | 'bounce';

interface UnitVisualEntry {
  id: string;
  visualKind: string;
  team: 'player' | 'enemy';
  isBoss: boolean;
  rig: PaperStandeeRig;
  hitCylinder: THREE.Mesh;
  hitFlash: number;
  hitPoseTimer: number;
  actionPoseTimer: number;
  actionPoseDuration: number;
  actionPoseKind: ActionPoseKind;
  coverBlend: number;
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
  projectedTargets: ProjectedSightlineTarget[];
  overwatchRangeKeys: Set<string>;
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
  overwatch: { label: 'W', bg: '#f2b824', fg: '#3b2100' },
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

  private hemiLight: THREE.HemisphereLight | null = null;
  private sunLight: THREE.DirectionalLight | null = null;
  private rimLight: THREE.DirectionalLight | null = null;

  private unitGroup = new THREE.Group();
  private fxGroup = new THREE.Group();
  private unitMap = new Map<string, UnitVisualEntry>();
  private unitPickMeshes: THREE.Mesh[] = [];

  // 3D Translucent Hover Ghost Standee (shows exactly where hero lands on hovered Move/Jump tile!)
  private ghostRoot = new THREE.Group();
  private ghostPlane: THREE.Mesh;
  private ghostMat: THREE.MeshBasicMaterial;
  private ghostRing: THREE.Mesh;
  private ghostRingMat: THREE.MeshBasicMaterial;
  private ghostSpriteKey = '';
  private ghostAspect = 1;

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
  private hitstopTimer = 0;
  private bossIntroMapKey = '';
  private bossIntroStartMs = 0;
  private bossIntroFocusPos: GridPos | null = null;
  private victoryConfettiAccum = 0;
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

    // Translucent 3D Hover Ghost Standee
    this.ghostMat = new THREE.MeshBasicMaterial({
      color: '#a8f2ff',
      transparent: true,
      opacity: 0.52,
      alphaTest: 0.12,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.ghostPlane = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.ghostMat);
    this.ghostPlane.renderOrder = 22;
    this.ghostRoot.add(this.ghostPlane);

    const gRingGeo = new THREE.RingGeometry(0.32, 0.48, 24);
    gRingGeo.rotateX(-Math.PI / 2);
    this.ghostRingMat = new THREE.MeshBasicMaterial({
      color: '#5ae6ff',
      transparent: true,
      opacity: 0.86,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.ghostRing = new THREE.Mesh(gRingGeo, this.ghostRingMat);
    this.ghostRing.position.y = 0.045;
    this.ghostRoot.add(this.ghostRing);
    this.ghostRoot.visible = false;

    this.scene.add(this.world.root);
    this.scene.add(this.overlays.root);
    this.scene.add(this.unitGroup);
    this.scene.add(this.ghostRoot);
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
    this.hemiLight = hemi;
    this.scene.add(hemi);

    // Golden afternoon sun casting Paper Mario standee & 3D crate shadows!
    const sun = new THREE.DirectionalLight(0xfff1cf, 1.55);
    sun.position.set(8.5, 15.5, 9.5);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near = 2;
    sun.shadow.camera.far = 52;
    const d = 16;
    sun.shadow.camera.left = -d;
    sun.shadow.camera.right = d;
    sun.shadow.camera.top = d;
    sun.shadow.camera.bottom = -d;
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.025;
    this.sunLight = sun;
    this.scene.add(sun);

    // Cool sky rim light so thick cardboard edges & crates separate crisply
    const rim = new THREE.DirectionalLight(0xc8e4ff, 0.42);
    rim.position.set(-9, 7, -8);
    this.rimLight = rim;
    this.scene.add(rim);
  }

  private resize(): void {
    const parent = this.canvas.parentElement ?? this.canvas;
    // Use clientWidth/clientHeight (untransformed CSS layout box) so CSS 3D transitions
    // like origami-flip never distort the WebGL/2D overlay alignment!
    const w = parent.clientWidth || window.innerWidth;
    const h = parent.clientHeight || window.innerHeight;
    this.cssW = Math.max(260, Math.floor(w));
    this.cssH = Math.max(200, Math.floor(h));
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);

    this.renderer.setPixelRatio(this.dpr);
    this.renderer.setSize(this.cssW, this.cssH, false);

    if (this.overlayCanvas) {
      this.overlayCanvas.width = Math.floor(this.cssW * this.dpr);
      this.overlayCanvas.height = Math.floor(this.cssH * this.dpr);
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

    const wasLeftClick =
      this.dragMode === 'none' &&
      !this.didPinch &&
      this.downPoint !== null &&
      (this.downPoint.button === 0 || e.pointerType !== 'mouse');

    const wasRightClick =
      this.dragMode === 'none' &&
      !this.didPinch &&
      this.downPoint !== null &&
      this.downPoint.button === 2 &&
      e.pointerType === 'mouse';

    if (this.activePointers.size === 0) {
      this.downPoint = null;
      this.dragMode = 'none';
      this.lastPinchMid = null;
      this.lastPinchDist = 0;
    }

    if (wasRightClick) {
      this.hooks.onRightClickCancel?.();
      return;
    }

    if (wasLeftClick) {
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

  public setHudInsets(topPx: number, bottomPx: number): void {
    this.cameraCtrl.setHudInsets(topPx, bottomPx);
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
      entry.hitPoseTimer = 0;
      entry.actionPoseTimer = 0;
      entry.actionPoseDuration = 0.5;
      entry.actionPoseKind = 'none';
      entry.squash = 0;
    }
    this.hitstopTimer = 0;
    this.clearProjectiles();
  }

  private triggerUnitHit(unitId: string, bigImpact = false): void {
    const entry = this.unitMap.get(unitId);
    if (entry) {
      entry.hitFlash = 1;
      entry.hitPoseTimer = 0.44;
      entry.squash = 1;
    }
    if (bigImpact) {
      this.hitstopTimer = Math.max(this.hitstopTimer, 0.075);
    }
  }

  private triggerUnitActionPose(unitId: string, kind: ActionPoseKind, duration = 0.54): void {
    const entry = this.unitMap.get(unitId);
    if (!entry) return;
    entry.actionPoseKind = kind;
    entry.actionPoseDuration = duration;
    entry.actionPoseTimer = duration;
    if (kind === 'attack' || kind === 'skill') {
      entry.squash = Math.max(entry.squash, 0.55);
    }
  }

  private worldPointForTile(battle: BattleState, pos: GridPos, yLift = 0): THREE.Vector3 {
    const t = tileAt(battle, pos);
    const wp = gridToWorld3D(
      pos.x,
      pos.y,
      battle.width,
      battle.height,
      (t ? getTileSurfaceY(t) : 0) + yLift
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

        case 'burrow_warp': {
          const pFrom = this.worldPointForTile(b, ev.from, 0.25);
          const pTo = this.worldPointForTile(b, ev.to, 0.25);
          this.spawnBurst(pFrom, ['#3cf0de', '#8a5d36', '#fbf3df'], 14, 'confetti');
          this.spawnBurst(pTo, ['#3cf0de', '#8a5d36', '#fbf3df'], 16, 'confetti');
          this.spawnPopup(pTo.clone().add(new THREE.Vector3(0, 1.25, 0)), 'BURROW WARP!', '#084a45', '#c8fff9', 1.12);
          sfx.jump();
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
            this.triggerUnitActionPose(ev.unitId, 'dash', 0.42);
          }
          this.triggerUnitHit(ev.targetId, false);
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
            this.triggerUnitActionPose(ev.unitId, 'jump', 0.58);
          }
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
              entry.hitPoseTimer = Math.max(entry.hitPoseTimer, 0.34);
            }
            this.spawnBurst(pTo.clone().add(new THREE.Vector3(0, 0.2, 0)), ['#fbf3df', '#d9c095'], 10, 'confetti');
          } else {
            this.triggerUnitHit(ev.unitId, true);
            if (ev.bumpedUnitId) {
              this.triggerUnitHit(ev.bumpedUnitId, true);
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
          this.hitstopTimer = Math.max(this.hitstopTimer, 0.065);
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
          this.triggerUnitActionPose(ev.attackerId, 'attack', 0.54);
          this.spawnProjectile3D(pFrom, pTo, ev.arc, ev.attackerKind);
          this.focusOnGrid(ev.to);
          if (lobbed) sfx.lob();
          else sfx.shoot();

          if (!ev.hit) {
            this.spawnBurst(pTo, ['#c89457', '#e6c28b'], 12, 'plank');
            this.spawnPopup(pTo.clone().add(new THREE.Vector3(0, 0.9, 0)), 'COVER BLOCK!', '#5d4037', '#f5e8d0', 1.02);
            sfx.miss();
          } else {
            const strong = ev.matchup === 'advantage';
            if (ev.targetId) {
              this.triggerUnitHit(ev.targetId, strong || ev.damage >= 5);
            }
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
          this.triggerUnitActionPose(ev.unitId, 'skill', 0.62);
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
          this.triggerUnitHit(ev.unitId, false);
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
          this.hitstopTimer = Math.max(this.hitstopTimer, 0.08);
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

        case 'overwatch_shot': {
          const pFrom = this.worldPointForTile(b, ev.from, 0.72);
          const pTo = this.worldPointForTile(b, ev.to, 0.56);
          this.triggerUnitActionPose(ev.attackerId, 'attack', 0.54);
          this.spawnProjectile3D(pFrom, pTo, 'direct', ev.attackerKind);
          this.triggerUnitHit(ev.targetId, true);
          this.cameraCtrl.triggerShake(0.24, 0.18);
          this.focusOnGrid(ev.to);
          this.spawnBurst(pTo, ['#ffe052', '#ffae2b', '#fff9d6'], 20, 'confetti');
          this.spawnPopup(
            pTo.clone().add(new THREE.Vector3(0, 1.05, 0)),
            `WATCH! -${ev.damage}`,
            '#5c3200',
            '#ffe880',
            1.18
          );
          sfx.shoot();
          sfx.hit(true);
          break;
        }

        case 'stomp': {
          const p = this.worldPointForTile(b, ev.pos, 0.35);
          this.cameraCtrl.triggerShake(0.26, 0.2);
          this.spawnBurst(p, ['#ffd54f', '#ff8524', '#fbf3df'], 22, 'confetti');
          if (ev.hitIds.length > 0) {
            for (const hid of ev.hitIds) {
              this.triggerUnitHit(hid, true);
            }
            this.spawnPopup(
              p.clone().add(new THREE.Vector3(0, 1.25, 0)),
              `JUMP STOMP! -${ev.damage}`,
              '#7a2800',
              '#ffe49e',
              1.18
            );
            sfx.hit(true);
          }
          break;
        }

        case 'terrain_hazard': {
          const p = this.worldPointForTile(b, ev.pos, 0.45);
          this.triggerUnitHit(ev.unitId, true);
          this.cameraCtrl.triggerShake(0.28, 0.22);
          if (ev.kind === 'lava') {
            this.spawnBurst(p, ['#ff521b', '#ffd54f', '#2b130c'], 26, 'confetti');
            this.spawnPopup(p.clone().add(new THREE.Vector3(0, 1.1, 0)), `LAVA! -${ev.damage}`, '#7a0d00', '#ffd099', 1.22);
            sfx.hit(true);
          } else if (ev.kind === 'water') {
            this.spawnBurst(p, ['#33b8e8', '#a8ebff', '#ffffff'], 26, 'droplet');
            this.spawnPopup(p.clone().add(new THREE.Vector3(0, 1.1, 0)), `SPLASH! -${ev.damage}`, '#0d4a6b', '#d9f6ff', 1.18);
            sfx.dash();
          } else {
            this.spawnBurst(p, ['#d4a46a', '#8c5a2b', '#fbf3df'], 16, 'plank');
            this.spawnPopup(p.clone().add(new THREE.Vector3(0, 1.1, 0)), `CLIFF DROP! -${ev.damage}`, '#6b2c0c', '#ffe2bd', 1.14);
            sfx.coverBreak();
          }
          break;
        }

        case 'boss_phase': {
          const p = this.worldPointForTile(b, ev.pos, 0.75);
          const be = this.unitMap.get(ev.bossId);
          if (be) {
            be.hitFlash = 1;
            be.squash = 1;
          }
          this.hitstopTimer = Math.max(this.hitstopTimer, 0.085);
          this.cameraCtrl.triggerShake(0.42, 0.34);
          this.focusOnGrid(ev.pos);
          this.spawnBurst(p, ['#ff3b1f', '#ffd54f', '#ff8524', '#fff5d6'], 36, 'confetti');
          this.spawnPopup(p.clone().add(new THREE.Vector3(0, 1.4, 0)), 'PHASE 2 ENRAGED!', '#6b0a00', '#ffcf80', 1.3);
          this.banner = {
            text: `PHASE 2: ${ev.bossName.toUpperCase()} ENRAGED!`,
            tone: 'enemy',
            startMs: performance.now(),
            durationMs: 1600,
          };
          sfx.coverBreak();
          break;
        }

        case 'boss_telegraph_strike': {
          this.cameraCtrl.triggerShake(0.4, 0.3);
          this.hitstopTimer = Math.max(this.hitstopTimer, 0.08);
          for (const tp of ev.tiles) {
            const pt = this.worldPointForTile(b, tp, 0.45);
            this.spawnBurst(pt, ['#ff3b1f', '#ff9924', '#ffe066', '#3d1c12'], 12, 'confetti');
          }
          for (const hid of ev.hitIds) {
            this.triggerUnitHit(hid, true);
          }
          if (ev.tiles.length > 0) {
            const mid = ev.tiles[Math.floor(ev.tiles.length / 2)];
            const pMid = this.worldPointForTile(b, mid, 1.25);
            this.focusOnGrid(mid);
            this.spawnPopup(
              pMid,
              ev.hitIds.length > 0 ? `${ev.name.toUpperCase()}! -${ev.damage}` : `${ev.name.toUpperCase()} DODGED!`,
              ev.hitIds.length > 0 ? '#7a0a00' : '#1b5e20',
              ev.hitIds.length > 0 ? '#ffd080' : '#dff7df',
              1.22
            );
          }
          sfx.hit(true);
          break;
        }

        case 'partner_assist': {
          const pFrom = this.worldPointForTile(b, ev.from, 0.68);
          const pTo = this.worldPointForTile(b, ev.to, 0.56);
          const allyEntry = this.unitMap.get(ev.allyId);
          if (allyEntry) {
            allyEntry.squash = 0.7;
            this.triggerUnitActionPose(ev.allyId, 'attack', 0.48);
          }
          this.spawnProjectile3D(pFrom, pTo, 'direct', ev.allyKind);
          this.triggerUnitHit(ev.targetId, false);
          this.spawnBurst(pTo, ['#ffe052', '#7be054', '#fff9d6'], 14, 'confetti');
          this.spawnPopup(
            pTo.clone().add(new THREE.Vector3(0.18, 1.28, 0)),
            `★ ASSIST +${ev.damage}`,
            '#5c3200',
            '#fff08c',
            1.14
          );
          sfx.hit(false);
          break;
        }

        case 'bounce_launch': {
          const pFrom = this.worldPointForTile(b, ev.from, 0.35);
          const pTo = this.worldPointForTile(b, ev.to, 0.35);
          const entry = this.unitMap.get(ev.unitId);
          if (entry) {
            entry.anim = {
              kind: 'bounce',
              points: [this.worldPointForTile(b, ev.from, 0), this.worldPointForTile(b, ev.to, 0)],
              elapsed: 0,
              duration: 0.46,
              arcHeight: 2.05,
              spinFull: true,
              leanAngle: 0.24,
            };
            this.triggerUnitActionPose(ev.unitId, 'bounce', 0.54);
          }
          this.spawnBurst(pFrom, ['#ff4fa3', '#ffe066', '#fff8e2'], 16, 'confetti');
          this.spawnPopup(pTo.clone().add(new THREE.Vector3(0, 1.0, 0)), 'BOING!', '#8c1448', '#ffd9ec', 1.15);
          sfx.jump();
          break;
        }

        case 'pumpkin_roll': {
          const pFrom = this.worldPointForTile(b, ev.from, 0.45);
          const pTo = this.worldPointForTile(b, ev.to, 0.45);
          this.spawnRollingPumpkin3D(pFrom, pTo, Math.max(0.32, (ev.path.length - 1) * 0.11));
          this.cameraCtrl.triggerShake(0.32, 0.24);
          this.hitstopTimer = Math.max(this.hitstopTimer, 0.06);
          for (const hid of ev.hitIds) {
            this.triggerUnitHit(hid, true);
          }
          this.spawnBurst(pTo, ['#f27f1b', '#ffba3b', '#4d8a2d', '#fbf3df'], 24, 'confetti');
          this.spawnPopup(
            pTo.clone().add(new THREE.Vector3(0, 1.1, 0)),
            ev.hitIds.length > 0 ? `PUMPKIN BOWL! -${ev.damage}` : 'ROLLING PUMPKIN!',
            '#6e2800',
            '#ffdd99',
            1.22
          );
          sfx.coverBreak();
          break;
        }

        case 'bridge_collapse': {
          const p = this.worldPointForTile(b, ev.pos, 0.35);
          this.cameraCtrl.triggerShake(0.34, 0.26);
          this.spawnBurst(p, ['#b5773c', '#824d23', '#e0b175'], 24, 'plank');
          this.spawnBurst(
            p,
            ev.liquid === 'lava' ? ['#ff521b', '#ffd54f', '#3b150c'] : ['#33b8e8', '#a8ebff', '#ffffff'],
            20,
            ev.liquid === 'lava' ? 'confetti' : 'droplet'
          );
          this.spawnPopup(
            p.clone().add(new THREE.Vector3(0, 1.05, 0)),
            'BRIDGE COLLAPSED!',
            '#5c2408',
            '#ffe0bd',
            1.2
          );
          sfx.coverBreak();
          break;
        }

        case 'reinforcement_spawn': {
          const p = this.worldPointForTile(b, ev.pos, 0.5);
          this.spawnBurst(p, ['#8a623c', '#3cf0de', '#f2d080'], 18, 'confetti');
          this.spawnPopup(
            p.clone().add(new THREE.Vector3(0, 1.05, 0)),
            `+ ${ev.unitName.toUpperCase()}!`,
            '#6e160d',
            '#ffe0d6',
            1.1
          );
          sfx.dash();
          break;
        }

        case 'escort_move': {
          const pFrom = this.worldPointForTile(b, ev.from, 0);
          const pTo = this.worldPointForTile(b, ev.to, 0);
          const entry = this.unitMap.get(ev.unitId);
          if (entry) {
            entry.anim = {
              kind: 'path',
              points: [pFrom, pTo],
              elapsed: 0,
              duration: 0.36,
              arcHeight: 0.14,
              leanAngle: 0.06,
            };
          }
          this.spawnBurst(pTo.clone().add(new THREE.Vector3(0, 0.4, 0)), ['#ffe066', '#fff9d6', '#7bd148'], 10, 'confetti');
          this.spawnPopup(pTo.clone().add(new THREE.Vector3(0, 1.05, 0)), 'CONVOY ROLLS ON!', '#634100', '#fff3b8', 1.06);
          sfx.step();
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

  private spawnRollingPumpkin3D(from: THREE.Vector3, to: THREE.Vector3, duration: number): void {
    const group = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.SphereGeometry(0.38, 12, 10),
      new THREE.MeshStandardMaterial({ color: '#ec781a', roughness: 0.65 })
    );
    body.scale.set(1.08, 0.88, 1.08);
    body.castShadow = true;
    const stem = new THREE.Mesh(
      new THREE.CylinderGeometry(0.05, 0.08, 0.18, 6),
      new THREE.MeshStandardMaterial({ color: '#477a28', roughness: 0.85 })
    );
    stem.position.y = 0.35;
    group.add(body, stem);
    group.position.copy(from);
    this.fxGroup.add(group);
    this.projectiles.push({
      mesh: group,
      from: from.clone(),
      to: to.clone(),
      elapsed: 0,
      duration,
      arcHeight: 0.12,
      spinSpeed: 22,
    });
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
      strawberry: 0xe63956,
      mushroom: 0xb968e6,
      duck: 0x3ec6e8,
      sprayer: 0x99cc44,
      beekeeper: 0xf5b324,
      barrow: 0xc97f3b,
      blower: 0xc98838,
      sapper: 0x8f6c47,
      pitchfork: 0xdba93b,
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
    } else if (attackerKind === 'carrot' || attackerKind === 'strawberry') {
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
      view.previewOverwatch ? 1 : 0,
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
      !b.prepPhase && b.phase === 'player' && selectedUnit && view.mode === 'move'
        ? computeDashOptions(b, selectedUnit)
        : [];
    const dashEnemyIds = new Set(dashList.map((d) => d.enemyId));

    const attackTiles =
      !b.prepPhase && b.phase === 'player' && selectedUnit && (view.mode === 'attack' || view.mode === 'move')
        ? getAttackableTiles(b, selectedUnit)
        : [];
    const attackKeySet = new Set(attackTiles.map(posKey));

    // Projected weapon range when hovering a Move/Jump destination tile!
    let isProjectingFromMove = false;
    let weaponRangeOrigin: GridPos | null = null;
    if (!b.prepPhase && b.phase === 'player' && selectedUnit && !selectedUnit.actions.hasAttacked) {
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
    const projectedTargets: ProjectedSightlineTarget[] = [];
    if (selectedUnit && weaponRangeOrigin) {
      for (const p of getWeaponRangeTiles(b, selectedUnit, weaponRangeOrigin)) {
        weaponRangeKeys.add(posKey(p));
      }
      if (isProjectingFromMove) {
        const ghostUnit: BattleUnit = { ...selectedUnit, pos: weaponRangeOrigin };
        for (const u of b.units) {
          if (!u.alive || u.team !== 'enemy') continue;
          if (!weaponRangeKeys.has(posKey(u.pos))) continue;
          const fc = forecastAttack(b, ghostUnit, u.pos);
          if (fc.canAttack && fc.hitChance > 0) {
            projectedTargets.push({
              pos: u.pos,
              hitChance: fc.hitChance,
              isLethal: fc.isLethal,
            });
          }
        }
      }
    }

    const overwatchRangeKeys = new Set<string>();
    if (
      b.phase === 'player' &&
      view.previewOverwatch &&
      selectedUnit &&
      !selectedUnit.actions.hasAttacked
    ) {
      for (const p of getWeaponRangeTiles(b, selectedUnit, selectedUnit.pos)) {
        overwatchRangeKeys.add(posKey(p));
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
      const isBridge = Boolean(!fu && fcTile?.terrain === 'bridge' && (fcTile.bridgeHp ?? 0) > 0);
      if (isEnemy || isCover || isBridge || (view.mode === 'attack' && selectedUnit.weapon.arc === 'lobbed')) {
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
      projectedTargets,
      overwatchRangeKeys,
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
    const popUp = this.world.getPopUpProgress();
    const popUpEase = 1 - Math.pow(1 - popUp, 3);

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
          hitPoseTimer: 0,
          actionPoseTimer: 0,
          actionPoseDuration: 0.5,
          actionPoseKind: 'none',
          coverBlend: 0,
          squash: 0,
          anim: null,
          koTimer: 0,
        };
        this.unitMap.set(u.id, entry);
        this.unitGroup.add(rig.root);
      }

      entry.hitCylinder.userData.gridPos = { x: u.pos.x, y: u.pos.y };

      // 1. Live Status, Cover & Expressive Battle Pose State Machine!
      if (entry.hitPoseTimer > 0) {
        entry.hitPoseTimer = Math.max(0, entry.hitPoseTimer - dt);
      }
      if (entry.actionPoseTimer > 0) {
        entry.actionPoseTimer = Math.max(0, entry.actionPoseTimer - dt);
        if (entry.actionPoseTimer <= 0) {
          entry.actionPoseKind = 'none';
        }
      }

      const hpRatio = u.hp / Math.max(1, u.maxHp);
      const isLowHp = hpRatio <= 0.35;
      const isBossEnraged = Boolean(u.isBoss && (b.bossPhase ?? 1) >= 2);
      const isSelected = u.id === view.selectedUnitId;
      const isAimingHero =
        isSelected &&
        (view.mode === 'attack' || view.mode === 'ability' || view.mode === 'item') &&
        b.phase === 'player';
      const isInspected = u.id === view.inspectedEnemyId;
      const isDashTarget = tac.dashEnemyIds.has(u.id);
      const isDone = tac.doneUnitIds.has(u.id);
      const isCelebrating = b.status === 'victory' && u.team === 'player';
      const isOverwatching = u.statuses.some((s) => s.kind === 'overwatch');
      const isAirborneAnim =
        entry.anim?.kind === 'jump' || entry.anim?.kind === 'bounce';
      const isDashingAnim = entry.anim?.kind === 'dash';

      // Check whether this unit is currently hunkered behind adjacent Half or Full cover!
      const coverBadges = !entry.anim && !u.isEscortCart
        ? getAdjacentCoverBadges(b, u.pos, u.team)
        : [];
      const hasFullCover = coverBadges.some((c) => c.level === 'full');
      const hasAnyCover = coverBadges.length > 0;
      const isTakingCover =
        hasAnyCover &&
        !entry.anim &&
        entry.hitPoseTimer <= 0 &&
        entry.actionPoseTimer <= 0 &&
        !isAimingHero &&
        !isOverwatching &&
        !isCelebrating &&
        !u.isBoss;

      entry.coverBlend = THREE.MathUtils.lerp(
        entry.coverBlend,
        isTakingCover ? 1 : 0,
        1 - Math.exp(-dt * 12)
      );

      let desiredVariant: SpriteVariantKind = 'base';
      if (entry.hitPoseTimer > 0) {
        desiredVariant = 'hit';
      } else if (isBossEnraged) {
        desiredVariant = 'enraged';
      } else if (
        entry.actionPoseTimer > 0 ||
        isAirborneAnim ||
        isDashingAnim ||
        isAimingHero ||
        isOverwatching ||
        isCelebrating
      ) {
        desiredVariant = hasVariantSprite(u.visualKind, 'action')
          ? 'action'
          : isLowHp && !isCelebrating
            ? 'lowhp'
            : 'base';
      } else if (isTakingCover) {
        desiredVariant = hasVariantSprite(u.visualKind, 'cover')
          ? 'cover'
          : isLowHp
            ? 'lowhp'
            : 'base';
      } else if (isLowHp && b.status !== 'victory') {
        desiredVariant = 'lowhp';
      }
      entry.rig.setSpriteKey(resolveVariantSpriteKey(u.visualKind, desiredVariant));

      // 2. Position & Paper Mario Movement / Jump / Bounce Animations
      const restingPos = this.worldPointForTile(b, u.pos, 0);
      let hopY = 0;
      let tiltZ = 0;
      let extraSpinY = 0;
      let airStretch = 0;
      let airPitchX = 0;

      if (entry.anim) {
        const anim = entry.anim;
        anim.elapsed += dt;
        const t = Math.min(1, anim.elapsed / Math.max(0.01, anim.duration));

        if (anim.kind === 'jump' && anim.points.length >= 3) {
          if (t < 0.32) {
            const p = t / 0.32;
            entry.rig.root.position.lerpVectors(anim.points[0], anim.points[1], p);
            hopY = Math.sin(p * Math.PI) * 0.48;
            airStretch = Math.sin(p * Math.PI) * 0.14;
          } else {
            const p = (t - 0.32) / 0.68;
            entry.rig.root.position.lerpVectors(anim.points[1], anim.points[2], p);
            hopY = Math.sin(p * Math.PI) * anim.arcHeight;
            extraSpinY = p * Math.PI * 2;
            airStretch = Math.sin(p * Math.PI) * 0.2;
            airPitchX = Math.sin(p * Math.PI) * 0.18;
          }
        } else if (anim.kind === 'bounce' && anim.points.length >= 2) {
          entry.rig.root.position.lerpVectors(anim.points[0], anim.points[1], t);
          hopY = Math.sin(t * Math.PI) * anim.arcHeight;
          extraSpinY = t * Math.PI * 2;
          airStretch = Math.sin(t * Math.PI) * 0.22;
          airPitchX = Math.sin(t * Math.PI) * 0.2;
        } else if (anim.points.length >= 2) {
          const segCount = anim.points.length - 1;
          const scaled = t * segCount;
          const segIdx = Math.min(segCount - 1, Math.floor(scaled));
          const segT = scaled - segIdx;
          entry.rig.root.position.lerpVectors(anim.points[segIdx], anim.points[segIdx + 1], segT);
          hopY = Math.sin(segT * Math.PI) * anim.arcHeight;
          tiltZ = Math.sin(segT * Math.PI) * (anim.leanAngle ?? 0.14);
          if (anim.kind === 'dash') {
            airPitchX = 0.22;
          }
        }

        if (t >= 1) {
          entry.anim = null;
          entry.squash = Math.max(entry.squash, isAirborneAnim ? 0.92 : 0.55);
        }
      } else {
        entry.rig.root.position.lerp(restingPos, 1 - Math.exp(-dt * 18));
      }

      // 3. Status Flags
      const hasBurn = u.statuses.some((s) => s.kind === 'burn');
      const hasRooted = u.statuses.some((s) => s.kind === 'rooted');
      const hasAcid = u.statuses.some((s) => s.kind === 'acid');
      const hasFeared = u.statuses.some((s) => s.kind === 'feared');
      const hasShield = u.statuses.some((s) => s.kind === 'shield');
      const hasBoosted = u.statuses.some((s) => s.kind === 'boosted');

      // 4. Expressive Battle Poses: Cover Crouch & Peek, Action Lunge, Skill Flourish, Overwatch Brace & Celebration!
      let actionHopY = 0;
      let actionLungeX = 0;
      let actionTiltZ = 0;
      let actionStretchY = 0;
      if (entry.actionPoseTimer > 0 && !entry.anim) {
        const p = 1 - entry.actionPoseTimer / Math.max(0.01, entry.actionPoseDuration);
        if (entry.actionPoseKind === 'attack') {
          // Crisp forward snap lunge then rebound!
          const lungeWave = Math.sin(p * Math.PI);
          actionLungeX = lungeWave * 0.22;
          actionHopY = lungeWave * 0.12;
          actionTiltZ = (u.facing === 'right' ? -1 : 1) * lungeWave * 0.16;
          actionStretchY = lungeWave * 0.08;
        } else if (entry.actionPoseKind === 'skill') {
          // Celebratory rising Paper Mario flourish hop + twirl!
          const flourish = Math.sin(p * Math.PI);
          actionHopY = flourish * 0.42;
          extraSpinY += p * Math.PI * 2;
          actionStretchY = flourish * 0.14;
        }
      }

      const breatheSpeed = isCelebrating ? 7.8 : isLowHp ? 6.2 : isSelected ? 4.4 : 2.6;
      const idlePhase = this.elapsedTotal * breatheSpeed + u.pos.x * 0.9 + u.pos.y * 1.3;
      const coverDampen = 1 - entry.coverBlend * 0.6;
      const idleBounce = entry.anim
        ? 0
        : isCelebrating
          ? Math.abs(Math.sin(idlePhase)) * 0.34
          : Math.abs(Math.sin(idlePhase)) *
            (isSelected ? 0.085 : isLowHp ? 0.04 : 0.025) *
            coverDampen;
      if (isCelebrating && !entry.anim) {
        extraSpinY += Math.sin(idlePhase * 0.5) * 0.55;
      }

      const camPitch = this.cameraCtrl.getCurrentPitch();
      const tacticamTiltX = -Math.max(0, (camPitch - 0.72) * 0.52);
      const popUpFoldX = popUp < 1 ? (1 - popUpEase) * (-Math.PI * 0.45) : 0;
      const aimLeanX = isAimingHero ? 0.14 : isOverwatching ? 0.1 : 0;
      const coverDuckX = entry.coverBlend * (hasFullCover ? 0.09 : 0.05);
      const lowHpDroopX = isLowHp && !isCelebrating && !entry.anim ? 0.08 + Math.sin(idlePhase) * 0.03 : 0;
      const hitRecoilX = entry.hitPoseTimer > 0 ? -Math.sin((entry.hitPoseTimer / 0.44) * Math.PI) * 0.28 : 0;

      const targetTiltX =
        tacticamTiltX + popUpFoldX + aimLeanX + coverDuckX + lowHpDroopX + hitRecoilX + airPitchX + actionLungeX;

      const coverPeekSwayZ =
        entry.coverBlend * Math.sin(this.elapsedTotal * 2.2 + u.pos.x * 1.7 + u.pos.y) * 0.055;
      const coverSettleY = -entry.coverBlend * (hasFullCover ? 0.045 : 0.028);

      entry.rig.tiltGroup.position.x = hasFeared
        ? Math.sin(this.elapsedTotal * 44 + u.pos.x) * 0.036
        : 0;
      entry.rig.tiltGroup.position.y = Math.max(-0.05, hopY + idleBounce + actionHopY + coverSettleY);
      entry.rig.tiltGroup.rotation.x = THREE.MathUtils.lerp(
        entry.rig.tiltGroup.rotation.x,
        targetTiltX,
        1 - Math.exp(-dt * 14)
      );
      entry.rig.tiltGroup.rotation.z =
        tiltZ +
        actionTiltZ +
        coverPeekSwayZ +
        (entry.anim
          ? 0
          : Math.sin(idlePhase * 0.5) *
            (isCelebrating ? 0.14 : isSelected ? 0.045 : isLowHp ? 0.04 : 0.018) *
            coverDampen) +
        (entry.hitPoseTimer > 0 ? Math.sin(entry.hitPoseTimer * 42) * 0.1 : 0);

      // Squash, Stretch, Cover Hunker & Paper-Accordion Hit Ripple
      if (entry.squash > 0) {
        entry.squash = Math.max(0, entry.squash - dt * 4.5);
      }
      const sq = Math.sin(entry.squash * Math.PI) * 0.22;
      const accordionX =
        entry.hitPoseTimer > 0
          ? Math.sin(entry.hitPoseTimer * 36) * 0.16 * (entry.hitPoseTimer / 0.44)
          : 0;
      const lowHpPantY = isLowHp && !entry.anim ? Math.sin(idlePhase) * 0.04 : 0;
      // Only squash vertically for units WITHOUT bespoke _cover PNGs (keep subtle 5% hunker on bespoke _cover art!)
      const hasCustomCoverArt = hasVariantSprite(u.visualKind, 'cover');
      const coverSquashY = entry.coverBlend * (hasCustomCoverArt ? 0.04 : hasFullCover ? 0.13 : 0.09);
      const coverSpreadX = entry.coverBlend * (hasCustomCoverArt ? 0.03 : hasFullCover ? 0.09 : 0.06);

      entry.rig.tiltGroup.scale.set(
        1 + sq * 0.75 + accordionX + coverSpreadX - airStretch * 0.55,
        Math.max(0.68, 1 - sq - lowHpPantY - coverSquashY + airStretch + actionStretchY),
        1 + sq * 0.4
      );

      // 5. Camera-Aligned Billboard + Paper Mario 180° Flip Turn
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

      // 6. Animate Universal 3D Paper-Craft Status & Low-HP Overlays!
      const ov = entry.rig.statusOverlay;
      ov.burn.visible = hasBurn;
      if (hasBurn) {
        ov.burn.children.forEach((flame, idx) => {
          const fl = 0.85 + Math.sin(this.elapsedTotal * 14 + idx * 2.1) * 0.32;
          flame.scale.set(0.95, fl, 0.95);
          flame.rotation.y = this.elapsedTotal * 3.5 + idx;
        });
      }

      ov.rooted.visible = hasRooted;
      if (hasRooted) {
        const pulse = 1 + Math.sin(this.elapsedTotal * 4.2) * 0.04;
        ov.rooted.scale.set(pulse, 1, pulse);
      }

      ov.acid.visible = hasAcid;
      if (hasAcid) {
        ov.acid.children.forEach((bub, idx) => {
          const cyc = (this.elapsedTotal * 1.15 + idx * 0.42) % 1.0;
          bub.position.y = 0.25 + cyc * (entry.rig.height * 0.8);
          bub.scale.setScalar(0.55 + Math.sin(cyc * Math.PI) * 0.65);
        });
      }

      ov.feared.visible = hasFeared;
      if (hasFeared) {
        ov.feared.position.y = Math.sin(this.elapsedTotal * 9) * 0.06;
      }

      ov.shield.visible = hasShield;
      if (hasShield) {
        ov.shield.rotation.y = Math.sin(this.elapsedTotal * 2.2) * 0.35;
        ov.shield.position.y = Math.sin(this.elapsedTotal * 3.6) * 0.05;
      }

      ov.boosted.visible = hasBoosted;
      if (hasBoosted) {
        ov.boosted.rotation.y = this.elapsedTotal * 2.8;
        ov.boosted.position.y = 0.085 + entry.rig.height * 0.98 + Math.sin(this.elapsedTotal * 5) * 0.04;
      }

      ov.overwatch.visible = isOverwatching;
      if (isOverwatching) {
        ov.overwatch.rotation.z = this.elapsedTotal * 2.4;
        const osc = 1 + Math.sin(this.elapsedTotal * 6.5) * 0.1;
        ov.overwatch.scale.setScalar(osc);
      }

      ov.lowHp.visible = isLowHp;
      if (isLowHp) {
        // Show 3D Band-Aid sticker on units without a custom hand-drawn _lowhp PNG, while keeping sweat drops on ALL!
        ov.bandAid.visible = !hasVariantSprite(u.visualKind, 'lowhp');
        for (let i = 0; i < 2; i++) {
          const drop = ov.lowHp.children[i];
          if (drop) {
            const cyc = (this.elapsedTotal * 2.1 + i * 0.5) % 1;
            drop.position.y = 0.085 + entry.rig.height * (0.86 - cyc * 0.22);
          }
        }
      }

      ov.enragedAura.visible = isBossEnraged;
      if (isBossEnraged) {
        ov.enragedAura.rotation.y = this.elapsedTotal * 2.2;
        const sc = 1 + Math.sin(this.elapsedTotal * 7.5) * 0.08;
        ov.enragedAura.scale.set(sc, 1 + Math.sin(this.elapsedTotal * 9) * 0.18, sc);
      }

      // 7. Promotion Tier Pedestal Collar Trim (Ripe Bronze / Heirloom Shimmering Gold!)
      if (u.tier === 'heirloom') {
        entry.rig.promoTrimMesh.visible = true;
        entry.rig.promoTrimMat.color.set('#ffcf3d');
        entry.rig.promoTrimMat.emissive.set('#b87600');
        entry.rig.promoTrimMat.emissiveIntensity = 0.28 + Math.sin(this.elapsedTotal * 4.5) * 0.12;
      } else if (u.tier === 'ripe') {
        entry.rig.promoTrimMesh.visible = true;
        entry.rig.promoTrimMat.color.set('#cd8142');
        entry.rig.promoTrimMat.emissive.set('#5c300c');
        entry.rig.promoTrimMat.emissiveIntensity = 0.16;
      } else {
        entry.rig.promoTrimMesh.visible = false;
      }

      // 8. Hit-Flash, Boss Enraged Glow, Selected Highlight & Done Desaturation
      if (entry.hitFlash > 0) {
        entry.hitFlash = Math.max(0, entry.hitFlash - dt * 4.2);
      }
      if (entry.hitFlash > 0.02) {
        entry.rig.frontMat.emissive.setRGB(entry.hitFlash, entry.hitFlash * 0.92, entry.hitFlash * 0.85);
        entry.rig.frontMat.emissiveIntensity = entry.hitFlash * 1.1;
        entry.rig.backMat.emissive.copy(entry.rig.frontMat.emissive);
        entry.rig.backMat.emissiveIntensity = entry.rig.frontMat.emissiveIntensity;
      } else if (isBossEnraged) {
        entry.rig.frontMat.emissive.set('#ff3b14');
        entry.rig.frontMat.emissiveIntensity = 0.14 + Math.sin(this.elapsedTotal * 6.5) * 0.08;
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

      // 9. Pedestal Glowing Ring State (including Local Co-Op Player Ownership Rings!)
      const coopOwner =
        u.team === 'player' && b.coopPlayers && b.coopPlayers.length > 1 && typeof u.ownerPlayerIdx === 'number'
          ? b.coopPlayers[u.ownerPlayerIdx]
          : undefined;
      if (isSelected) {
        entry.rig.ringMat.color.set(coopOwner ? coopOwner.color : '#ffe052');
        entry.rig.ringMat.opacity = 0.82 + Math.sin(this.elapsedTotal * 6) * 0.14;
        const rs = 1.03 + Math.sin(this.elapsedTotal * 5) * 0.05;
        entry.rig.ringMesh.scale.set(rs, 1, rs);
      } else if (isOverwatching) {
        entry.rig.ringMat.color.set('#ffb824');
        entry.rig.ringMat.opacity = 0.72 + Math.sin(this.elapsedTotal * 7.5) * 0.22;
        const rs = 1.06 + Math.sin(this.elapsedTotal * 6) * 0.08;
        entry.rig.ringMesh.scale.set(rs, 1, rs);
      } else if (isDashTarget) {
        entry.rig.ringMat.color.set('#ff7b24');
        entry.rig.ringMat.opacity = 0.75 + Math.sin(this.elapsedTotal * 8) * 0.2;
      } else if (isInspected) {
        entry.rig.ringMat.color.set('#ef4437');
        entry.rig.ringMat.opacity = 0.82;
      } else if (coopOwner) {
        const isCoopActive = b.activeCoopPlayerIdx === coopOwner.idx;
        entry.rig.ringMat.color.set(coopOwner.color);
        entry.rig.ringMat.opacity = isCoopActive ? 0.68 : 0.36;
        entry.rig.ringMesh.scale.setScalar(isCoopActive ? 1.02 : 0.96);
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

      // Local Co-Op P1-P4 color crest badge beside HP bar!
      if (
        u.team === 'player' &&
        !u.isEscortCart &&
        b.coopPlayers &&
        b.coopPlayers.length > 1 &&
        typeof u.ownerPlayerIdx === 'number'
      ) {
        const cp = b.coopPlayers[u.ownerPlayerIdx];
        if (cp) {
          const pw = 21;
          const ph = 14;
          const px = bx - pw - 6;
          const py = by + barH / 2 - ph / 2;
          ctx.fillStyle = cp.color;
          roundRect(ctx, px, py, pw, ph, 5);
          ctx.fill();
          ctx.strokeStyle = '#fff9e6';
          ctx.lineWidth = 1.6;
          ctx.stroke();
          ctx.fillStyle = '#fffdf5';
          ctx.font = '800 9px Fredoka, Nunito, sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(cp.badge, px + pw / 2, py + ph / 2 + 0.5);
        }
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

    // 2. Objective Cage / Objective Supply Crate / Damaged Cover Mini-HP Tags
    for (const cv of this.world.getAllCoverVisuals()) {
      const tile = tileAt(b, cv.pos);
      if (!tile?.cover) continue;
      const showTag =
        cv.isObjectiveCage ||
        cv.isObjectiveCrate ||
        (tile.cover.destructible && tile.cover.hp < tile.cover.maxHp);
      if (!showTag) continue;

      const wp = cv.group.position.clone().add(new THREE.Vector3(0, cv.height + (cv.isObjectiveCrate ? 0.56 : 0.25), 0));
      const sc = this.projectToScreen(wp);
      if (!sc.visible) continue;

      const label = cv.isObjectiveCage
        ? `RESCUE ${tile.cover.hp}/${tile.cover.maxHp}`
        : cv.isObjectiveCrate
          ? `SMASH ${tile.cover.hp}/${tile.cover.maxHp}`
          : `${tile.cover.hp}/${tile.cover.maxHp}`;
      ctx.font = '800 10px Fredoka, Nunito, sans-serif';
      const tw = ctx.measureText(label).width + 12;
      ctx.fillStyle = cv.isObjectiveCage
        ? '#ffe985'
        : cv.isObjectiveCrate
          ? '#ffd46b'
          : 'rgba(251, 243, 223, 0.92)';
      roundRect(ctx, sc.x - tw / 2, sc.y - 10, tw, 17, 6);
      ctx.fill();
      ctx.strokeStyle = cv.isObjectiveCrate ? '#9c2c12' : '#452a16';
      ctx.lineWidth = cv.isObjectiveCrate ? 2 : 1.5;
      ctx.stroke();
      ctx.fillStyle = cv.isObjectiveCage || cv.isObjectiveCrate ? '#7a2500' : '#4a2c17';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, sc.x, sc.y - 1);
    }

    // 3. Bouncy Paper Mario Comic Damage / Event Popups!
    // Popups never cover each other and never leave the screen: later ones stack upwards.
    const placed: { x: number; y: number; w: number; h: number }[] = [];
    const viewW = ctx.canvas.clientWidth || 9999;
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

      const px = Math.min(Math.max(sc.x, tw / 2 + 6), Math.max(tw / 2 + 6, viewW - tw / 2 - 6));
      let py = Math.max(sc.y, th / 2 + 6);
      for (let guard = 0; guard < 8; guard++) {
        const hit = placed.find((r) => Math.abs(r.x - px) < (r.w + tw) / 2 && Math.abs(r.y - py) < (r.h + th) / 2 + 2);
        if (!hit) break;
        py = hit.y - (hit.h + th) / 2 - 4;
      }
      placed.push({ x: px, y: py, w: tw, h: th });

      // Slight comic slant
      ctx.translate(px, py);
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
    const rawDt = Math.min(0.05, Math.max(0.001, (now - this.lastTime) / 1000));
    this.lastTime = now;

    // Tactile ~75ms Hitstop freeze-frame on dramatic crits, KOs & boss blasts
    let simDt = rawDt;
    if (this.hitstopTimer > 0) {
      this.hitstopTimer = Math.max(0, this.hitstopTimer - rawDt);
      simDt = rawDt * 0.08;
    }
    this.elapsedTotal += simDt;

    const view = this.hooks.getState();
    if (!view) return;
    const b = view.battle;

    // Sync board dimensions & Act-specific lighting mood whenever map changes
    const dimSig = `${b.width}x${b.height}:${b.theme ?? 'spring'}`;
    if (dimSig !== this.lastBoardDims) {
      this.lastBoardDims = dimSig;
      this.cameraCtrl.setBoardBounds(
        b.width * TILE_SIZE_3D,
        b.height * TILE_SIZE_3D,
        this.cssW / Math.max(1, this.cssH)
      );
      const bgHex =
        b.theme === 'greenhouse' ? '#496352' : b.theme === 'autumn' ? '#4d2b22' : '#664022';
      this.scene.background = new THREE.Color(bgHex);
      (this.scene.fog as THREE.FogExp2).color.set(bgHex);

      // Act-specific Paper Mario stage lighting!
      if (this.sunLight && this.hemiLight && this.rimLight) {
        if (b.theme === 'autumn') {
          this.sunLight.color.set('#ffbe78');
          this.sunLight.intensity = 1.48;
          this.hemiLight.color.set('#ffd6a6');
          this.hemiLight.groundColor.set('#4f3548');
          this.hemiLight.intensity = 0.88;
          this.rimLight.color.set('#a8b8ff');
          this.rimLight.intensity = 0.52;
        } else if (b.theme === 'greenhouse') {
          this.sunLight.color.set('#fff5d6');
          this.sunLight.intensity = 1.62;
          this.hemiLight.color.set('#f2ffec');
          this.hemiLight.groundColor.set('#756640');
          this.hemiLight.intensity = 1.0;
          this.rimLight.color.set('#d2f5e3');
          this.rimLight.intensity = 0.44;
        } else {
          this.sunLight.color.set('#fff1cf');
          this.sunLight.intensity = 1.55;
          this.hemiLight.color.set('#fff7e2');
          this.hemiLight.groundColor.set('#8f6239');
          this.hemiLight.intensity = 0.96;
          this.rimLight.color.set('#c8e4ff');
          this.rimLight.intensity = 0.42;
        }
      }
    }

    this.world.syncBattle(b);
    this.world.update(this.elapsedTotal, simDt);

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
      projectedTargets: tac.projectedTargets,
      previewOverwatch: Boolean(view.previewOverwatch),
      overwatchRangeKeys: tac.overwatchRangeKeys,
      abilityKeySet: tac.abilityKeySet,
      itemKeySet: tac.itemKeySet,
      aoePreviewKeys: tac.aoePreviewKeys,
      enemyThreat: tac.enemyThreat,
      focusForecast: tac.focusForecast,
    });

    this.updateAimCamAndFocusAnchor(view, tac);

    // 3D Boss Intro Camera Swoop (wall-clock 1.35s focus on Act Boss terrace on Turn 1 after Prep!)
    if (b.objective === 'boss' && !b.prepPhase && b.turn === 1 && b.status === 'ongoing') {
      const introKey = `${b.mapId}:${b.width}x${b.height}`;
      if (this.bossIntroMapKey !== introKey) {
        const boss = b.units.find((u) => u.isBoss && u.alive);
        if (boss) {
          this.bossIntroMapKey = introKey;
          this.bossIntroStartMs = performance.now();
          this.bossIntroFocusPos = { ...boss.pos };
          this.focusOnGrid(boss.pos);
          this.banner = {
            text: `${boss.name.toUpperCase()} · ${boss.title.toUpperCase()}`,
            tone: 'enemy',
            startMs: performance.now(),
            durationMs: 1350,
          };
        }
      } else if (this.bossIntroFocusPos && this.bossIntroStartMs > 0) {
        const elapsedMs = performance.now() - this.bossIntroStartMs;
        if (elapsedMs > 1350) {
          this.bossIntroFocusPos = null;
          this.bossIntroStartMs = 0;
          const firstHero = b.units.find((u) => u.team === 'player' && u.alive && !u.isEscortCart);
          if (firstHero) this.focusOnGrid(firstHero.pos);
        }
      }
    }

    // Raining 3D Rainbow Paper Confetti during Battle Victory!
    if (b.status === 'victory') {
      this.victoryConfettiAccum += rawDt;
      if (this.victoryConfettiAccum >= 0.16 && this.particles.length < 120) {
        this.victoryConfettiAccum = 0;
        const rx = (Math.random() - 0.5) * b.width * TILE_SIZE_3D * 0.88;
        const rz = (Math.random() - 0.5) * b.height * TILE_SIZE_3D * 0.88;
        this.spawnBurst(
          new THREE.Vector3(rx, 4.4, rz),
          ['#ffd54f', '#ff5c8a', '#52d4ff', '#7be054', '#ff9f43', '#fff8e2'],
          6,
          'confetti'
        );
      }
    } else {
      this.victoryConfettiAccum = 0;
    }

    this.cameraCtrl.update(rawDt);
    this.overlays.update(this.elapsedTotal, this.cameraCtrl.camera.position);
    this.syncUnits(view, tac, simDt);
    this.syncHoverGhost(view, tac);
    this.updateEffects(simDt);

    this.renderer.render(this.scene, this.cameraCtrl.camera);
    this.drawOverlay2D(view, tac);
  };

  private syncHoverGhost(view: RendererViewState, tac: CachedTactics): void {
    const b = view.battle;
    const hero = tac.selectedUnit;
    const focus = view.previewTile ?? view.hoveredTile;

    const showGhost =
      b.phase === 'player' &&
      b.status === 'ongoing' &&
      !b.prepPhase &&
      view.mode === 'move' &&
      Boolean(hero) &&
      Boolean(focus) &&
      !samePos(focus!, hero!.pos) &&
      (tac.movableMap.has(posKey(focus!)) || tac.jumpMap.has(posKey(focus!)));

    if (!showGhost || !hero || !focus) {
      this.ghostRoot.visible = false;
      return;
    }

    this.ghostRoot.visible = true;
    const isJump = tac.jumpMap.has(posKey(focus));
    const isBounce = tileAt(b, focus)?.terrain === 'bounce_pad';

    if (this.ghostSpriteKey !== hero.visualKind) {
      this.ghostSpriteKey = hero.visualKind;
      const pair = this.textures.getSpriteTexturePair(hero.visualKind, (aspect) => {
        this.ghostAspect = aspect;
      });
      this.ghostMat.map = pair.front;
      this.ghostMat.needsUpdate = true;
      this.ghostAspect = pair.aspect;
    }

    const h = UNIT_WORLD_HEIGHTS[hero.visualKind] ?? 1.1;
    const w = Math.max(0.55, h * this.ghostAspect);
    const bob = Math.sin(this.elapsedTotal * 5.2) * 0.055;
    const wp = this.worldPointForTile(b, focus, 0);

    this.ghostRoot.position.set(wp.x, wp.y, wp.z);
    this.ghostRoot.rotation.y = this.cameraCtrl.getCurrentYaw();

    const defaultFacing = SPRITE_DEFAULT_FACING[hero.visualKind] ?? 'right';
    const flipX = hero.facing !== defaultFacing ? -1 : 1;
    this.ghostPlane.scale.set(w * flipX, h, 1);
    this.ghostPlane.position.set(0, 0.08 + h * 0.5 + bob, 0);

    const tint = isJump ? '#ffe878' : isBounce ? '#ff85c8' : '#a8f2ff';
    this.ghostMat.color.set(tint);
    this.ghostMat.opacity = 0.48 + Math.sin(this.elapsedTotal * 5.2) * 0.08;
    this.ghostRingMat.color.set(isJump ? '#ffd54f' : isBounce ? '#ff4fa3' : '#4ee4ff');
    const ringSc = 1 + Math.sin(this.elapsedTotal * 5.2) * 0.07;
    this.ghostRing.scale.set(ringSc, 1, ringSc);
  }

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
    this.ghostPlane.geometry.dispose();
    this.ghostMat.dispose();
    this.ghostRing.geometry.dispose();
    this.ghostRingMat.dispose();
    this.confettiGeo.dispose();
    this.plankGeo.dispose();
    this.dropletGeo.dispose();

    this.overlays.dispose();
    this.world.dispose();
    this.textures.dispose();
    this.renderer.dispose();
  }
}
