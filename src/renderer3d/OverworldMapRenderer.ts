import * as THREE from 'three';
import { compactMultiMaterialMesh } from './geometryUtils';
import { ACTS } from '../engine/mapgen';
import type { BoardTheme, NodeType, SeasonNode } from '../engine/types';
import { roundRect } from '../renderer/particles';
import {
  CraftTextureLibrary,
  createPaperStandeeRig,
  type PaperStandeeRig,
} from './textures';

export interface OverworldSnapshot {
  actIndex: number;
  theme: BoardTheme;
  nodes: SeasonNode[];
  completedIds: Set<string>;
  availableIds: Set<string>;
  /** Exact step-by-step node ID sequence from current position to hovered/selected reachable destination. */
  previewPathIds?: string[];
  currentNodeId: string | null;
  selectedNodeId: string | null;
  leadHeroKind: string;
  bossKind: string;
  boardTurn?: number;
  harvestBellLimit?: number;
}

export interface OverworldHooks {
  onHoverNode: (nodeId: string | null) => void;
  onSelectNode: (nodeId: string, alreadySelected: boolean) => void;
}

interface NodeVisual {
  node: SeasonNode;
  pos: THREE.Vector3;
  group: THREE.Group;
  ringMesh: THREE.Mesh;
  ringMat: THREE.MeshBasicMaterial;
  beaconMesh: THREE.Mesh;
  beaconMat: THREE.MeshBasicMaterial;
  hitMesh: THREE.Mesh;
  propSpin?: THREE.Object3D;
}

const BOARD_W = 16.4;
const BOARD_H = 9.15;
const BOARD_TOP_Y = 0.28;

const NODE_TYPE_STYLE: Record<
  NodeType,
  { hex: number; badge: string; icon: string; label: string }
> = {
  start: { hex: 0x5c8a47, badge: '#4f7c3c', icon: '⚑', label: 'Start' },
  skirmish: { hex: 0xd95638, badge: '#cf4c2e', icon: '⚔', label: 'Battle' },
  escape: { hex: 0x2f94ba, badge: '#2983a6', icon: '🏃', label: 'Convoy' },
  barn_rescue: { hex: 0xe08d22, badge: '#cc7b16', icon: '🔓', label: 'Rescue' },
  elite: { hex: 0x9e2234, badge: '#8f1b2c', icon: '💀', label: 'Elite' },
  shop: { hex: 0x3b9645, badge: '#31823b', icon: '🛒', label: 'Market' },
  shrine: { hex: 0x2ba8b8, badge: '#2091a0', icon: '💧', label: 'Shrine' },
  armory: { hex: 0xc97b1e, badge: '#b36814', icon: '⚒', label: 'Armory' },
  vault: { hex: 0xdba827, badge: '#c49116', icon: '⛺', label: 'Camp' },
  event: { hex: 0x874ab3, badge: '#783ca3', icon: '?', label: 'Clover' },
  boss: { hex: 0x7c1c28, badge: '#7c1c28', icon: '👑', label: 'Boss' },
};

function computeNodeWorldPos(node: SeasonNode): THREE.Vector3 {
  const bx = typeof node.boardX === 'number' ? node.boardX : 0.2 + (node.lane / 3) * 0.6;
  const by = typeof node.boardY === 'number' ? node.boardY : 0.85 - (node.stage / 7) * 0.7;
  const x = (bx - 0.5) * BOARD_W;
  const z = (by - 0.5) * BOARD_H;
  return new THREE.Vector3(x, BOARD_TOP_Y, z);
}

/**
 * 3D Folding Watercolor Tabletop Boardgame Overworld Renderer!
 * Renders each Season Act as a bespoke hand-painted watercolor game board resting on
 * a warm sunlit oak table, with wooden space medallions, dotted trail arcs, live
 * multi-step Travel Card hop previews, and a 3D leader standee pawn.
 */
export class OverworldMapRenderer {
  private canvas: HTMLCanvasElement;
  private overlayCanvas: HTMLCanvasElement | null;
  private overlayCtx: CanvasRenderingContext2D | null;
  private hooks: OverworldHooks;

  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private textures: CraftTextureLibrary;
  private boardTexLoader = new THREE.TextureLoader();
  private boardTextures = new Map<string, THREE.Texture>();

  private worldGroup = new THREE.Group();
  private trailGroup = new THREE.Group();
  private previewPathGroup = new THREE.Group();
  private nodeGroup = new THREE.Group();
  private standeeGroup = new THREE.Group();
  private weatherGroup = new THREE.Group();

  private nodeMap = new Map<string, NodeVisual>();
  private pickMeshes: THREE.Mesh[] = [];
  private leaderRig: PaperStandeeRig | null = null;
  private bossRig: PaperStandeeRig | null = null;
  private weatherMotes: Array<{
    mesh: THREE.Mesh;
    baseX: number;
    baseZ: number;
    speed: number;
    phase: number;
  }> = [];
  private animatedToys: Array<(elapsed: number) => void> = [];

  private snapshot: OverworldSnapshot | null = null;
  private builtSignature = '';
  private previewPathSig = '';
  private hoveredNodeId: string | null = null;

  // Smooth pan/zoom tabletop camera state
  private targetPos = new THREE.Vector3(0, 0.25, 0.55);
  private curTarget = new THREE.Vector3(0, 0.25, 0.55);
  private desiredDist = 15.8;
  private curDist = 15.8;
  private camYaw = 0;
  private camPitch = 0.86;

  private raycaster = new THREE.Raycaster();
  private pointerNdc = new THREE.Vector2();
  private tmpVec3 = new THREE.Vector3();

  private downPt: { x: number; y: number } | null = null;
  private lastDragPt: { x: number; y: number } | null = null;
  private isDragging = false;

  private cssW = 800;
  private cssH = 600;
  private dpr = 1;
  private rafId = 0;
  private lastTime = 0;
  private elapsed = 0;
  private resizeObserver: ResizeObserver;
  private destroyed = false;

  private leaderHopAnim: {
    curve: THREE.QuadraticBezierCurve3;
    startMs: number;
    durationMs: number;
    timer: ReturnType<typeof setTimeout>;
    resolve: () => void;
  } | null = null;

  constructor(
    canvas: HTMLCanvasElement,
    overlayCanvas: HTMLCanvasElement | null,
    hooks: OverworldHooks
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
    this.renderer.toneMappingExposure = 1.06;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#633e20');
    this.scene.fog = new THREE.FogExp2('#633e20', 0.011);

    this.camera = new THREE.PerspectiveCamera(35, 16 / 9, 0.2, 120);
    this.textures = new CraftTextureLibrary();

    this.scene.add(this.worldGroup);
    this.scene.add(this.trailGroup);
    this.scene.add(this.previewPathGroup);
    this.scene.add(this.nodeGroup);
    this.scene.add(this.standeeGroup);
    this.scene.add(this.weatherGroup);

    this.setupLights();
    this.resize();
    this.bindEvents();

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas.parentElement ?? canvas);

    this.lastTime = performance.now();
    this.rafId = requestAnimationFrame(this.loop);
  }

  private setupLights(): void {
    const hemi = new THREE.HemisphereLight(0xfffaf0, 0x8a5d36, 1.08);
    this.scene.add(hemi);

    const sun = new THREE.DirectionalLight(0xfff3d4, 1.38);
    sun.position.set(8, 20, 10);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near = 2;
    sun.shadow.camera.far = 60;
    const d = 14;
    sun.shadow.camera.left = -d;
    sun.shadow.camera.right = d;
    sun.shadow.camera.top = d;
    sun.shadow.camera.bottom = -d;
    sun.shadow.bias = -0.0004;
    this.scene.add(sun);

    const rim = new THREE.DirectionalLight(0xcbe6ff, 0.35);
    rim.position.set(-10, 10, -8);
    this.scene.add(rim);
  }

  private getBoardTexture(url: string): THREE.Texture {
    const cached = this.boardTextures.get(url);
    if (cached) return cached;
    const tex = this.boardTexLoader.load(url);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    tex.needsUpdate = true;
    this.boardTextures.set(url, tex);
    return tex;
  }

  private clearGroup(g: THREE.Group): void {
    while (g.children.length > 0) {
      const ch = g.children[0];
      g.remove(ch);
      ch.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
        if (m.material) {
          if (Array.isArray(m.material)) m.material.forEach((mm) => mm.dispose());
          else m.material.dispose();
        }
      });
    }
  }

  public sync(snap: OverworldSnapshot): void {
    this.snapshot = snap;
    const sig = [
      snap.actIndex,
      snap.theme,
      snap.nodes.map((n) => `${n.id}:${n.type}`).join(','),
      Array.from(snap.completedIds).sort().join(','),
      Array.from(snap.availableIds).sort().join(','),
      snap.currentNodeId ?? '-',
      snap.leadHeroKind,
      snap.bossKind,
    ].join('|');

    if (sig !== this.builtSignature) {
      const firstBuild = this.builtSignature === '';
      this.rebuildMap(snap);
      this.builtSignature = sig;
      if (firstBuild) {
        this.recenter(true);
      }
    }

    const pathSig = (snap.previewPathIds ?? []).join('>');
    if (pathSig !== this.previewPathSig) {
      this.previewPathSig = pathSig;
      this.rebuildPreviewPath(snap.previewPathIds ?? []);
    }
  }

  public focusNode(nodeId: string): void {
    const nv = this.nodeMap.get(nodeId);
    if (!nv) return;
    // Gently nudge camera toward the focused node while keeping the full watercolor board framed!
    this.targetPos.set(
      THREE.MathUtils.clamp(nv.pos.x * 0.32, -3.5, 3.5),
      BOARD_TOP_Y,
      THREE.MathUtils.clamp(nv.pos.z * 0.35 + 0.45, -2.0, 2.4)
    );
  }

  public recenter(instant = false): void {
    const aspect = this.cssW / Math.max(1, this.cssH);
    this.desiredDist = aspect < 1.15 ? 21.5 : aspect < 1.45 ? 17.6 : 15.6;
    this.targetPos.set(0, BOARD_TOP_Y, 0.55);
    if (instant) {
      this.curTarget.copy(this.targetPos);
      this.curDist = this.desiredDist;
    }
  }

  /**
   * Animated multi-space tabletop pawn hopping!
   * Walks the 3D leader standee space-by-space along every hop in `pathNodeIds`.
   */
  public async hopLeaderAlongPath(pathNodeIds: string[]): Promise<void> {
    if (this.destroyed || !this.leaderRig || pathNodeIds.length < 2) return;
    for (let i = 1; i < pathNodeIds.length; i++) {
      if (this.destroyed) return;
      await this.hopSingleStep(pathNodeIds[i], i === pathNodeIds.length - 1 ? 340 : 270);
    }
  }

  public hopLeaderToNode(nodeId: string): Promise<void> {
    return this.hopSingleStep(nodeId, 380);
  }

  private hopSingleStep(nodeId: string, durationMs: number): Promise<void> {
    const nv = this.nodeMap.get(nodeId);
    if (this.destroyed || !this.leaderRig || !nv) {
      return Promise.resolve();
    }
    if (this.leaderHopAnim) {
      clearTimeout(this.leaderHopAnim.timer);
      this.leaderHopAnim.resolve();
      this.leaderHopAnim = null;
    }

    const from = this.leaderRig.root.position.clone();
    const to = nv.pos.clone().add(new THREE.Vector3(-0.34, 0.04, 0.24));
    const mid = new THREE.Vector3().lerpVectors(from, to, 0.5);
    mid.y = Math.max(from.y, to.y) + 0.72;
    const curve = new THREE.QuadraticBezierCurve3(from, mid, to);
    this.focusNode(nodeId);

    return new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        if (this.leaderHopAnim) {
          clearTimeout(this.leaderHopAnim.timer);
          this.leaderHopAnim = null;
        }
        if (this.leaderRig) {
          this.leaderRig.root.position.copy(to);
          this.leaderRig.tiltGroup.rotation.z = 0;
        }
        resolve();
      };
      const timer = setTimeout(finish, durationMs + 140);
      this.leaderHopAnim = {
        curve,
        startMs: performance.now(),
        durationMs,
        timer,
        resolve: finish,
      };
    });
  }

  private rebuildMap(snap: OverworldSnapshot): void {
    this.clearGroup(this.worldGroup);
    this.clearGroup(this.trailGroup);
    this.clearGroup(this.previewPathGroup);
    this.clearGroup(this.nodeGroup);
    this.clearGroup(this.standeeGroup);
    this.clearGroup(this.weatherGroup);
    this.nodeMap.clear();
    this.pickMeshes = [];
    this.weatherMotes = [];
    this.animatedToys = [];
    this.leaderRig = null;
    this.bossRig = null;
    this.previewPathSig = '';

    // Seasonal tabletop ambiance
    const bgHex = snap.theme === 'autumn' ? '#4a2b1a' : snap.theme === 'greenhouse' ? '#5e4326' : '#664324';
    this.scene.background = new THREE.Color(bgHex);
    this.scene.fog = new THREE.FogExp2(bgHex, 0.011);

    // 1. Warm Sunlit Oak Tabletop
    const table = new THREE.Mesh(
      new THREE.PlaneGeometry(74, 62),
      new THREE.MeshStandardMaterial({
        map: this.textures.woodDeskMap,
        roughness: 0.78,
        metalness: 0.04,
      })
    );
    table.rotation.x = -Math.PI / 2;
    table.position.y = -0.02;
    table.receiveShadow = true;
    this.worldGroup.add(table);

    // Soft drop shadow skirt under the folding board
    const shadowSkirt = new THREE.Mesh(
      new THREE.PlaneGeometry(BOARD_W + 0.7, BOARD_H + 0.7),
      new THREE.MeshBasicMaterial({
        color: 0x1d0d04,
        transparent: true,
        opacity: 0.38,
        depthWrite: false,
      })
    );
    shadowSkirt.rotation.x = -Math.PI / 2;
    shadowSkirt.position.set(0.14, 0.005, 0.18);
    this.worldGroup.add(shadowSkirt);

    // 2. Chunky Folding Watercolor Tabletop Game Board!
    const actDef = ACTS[snap.actIndex] ?? ACTS[0];
    const boardArtTex = this.getBoardTexture(actDef.boardArt);
    const sideMat = new THREE.MeshStandardMaterial({
      map: this.textures.corrugatedMap,
      color: '#c9a67a',
      roughness: 0.9,
    });
    const topMat = new THREE.MeshStandardMaterial({
      map: boardArtTex,
      bumpMap: this.textures.paperBump,
      bumpScale: 0.009,
      roughness: 0.84,
      metalness: 0.01,
    });
    const bottomMat = new THREE.MeshStandardMaterial({ color: '#7a5230', roughness: 0.92 });

    const boardSlab = compactMultiMaterialMesh(new THREE.BoxGeometry(BOARD_W, BOARD_TOP_Y, BOARD_H), [
      sideMat,
      sideMat,
      topMat,
      bottomMat,
      sideMat,
      sideMat,
    ]);
    boardSlab.position.y = BOARD_TOP_Y / 2;
    boardSlab.castShadow = true;
    boardSlab.receiveShadow = true;
    this.worldGroup.add(boardSlab);

    // Subtle tabletop center fold seam (gives authentic folding-board tactility!)
    const foldSeam = new THREE.Mesh(
      new THREE.BoxGeometry(0.035, 0.008, BOARD_H - 0.14),
      new THREE.MeshBasicMaterial({ color: 0x5c3e24, transparent: true, opacity: 0.24 })
    );
    foldSeam.position.set(0, BOARD_TOP_Y + 0.005, 0);
    this.worldGroup.add(foldSeam);

    // Four shiny brass corner rivets on the folding game board
    const brassMat = new THREE.MeshStandardMaterial({
      color: '#dfb24a',
      metalness: 0.45,
      roughness: 0.32,
    });
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const rivet = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.16, 0.05, 14), brassMat);
        rivet.position.set(sx * (BOARD_W / 2 - 0.28), BOARD_TOP_Y + 0.025, sz * (BOARD_H / 2 - 0.28));
        rivet.castShadow = true;
        this.worldGroup.add(rivet);
      }
    }

    // Cozy tactile tabletop props resting on the oak desk outside the folding board!
    const diceMat = new THREE.MeshStandardMaterial({
      map: this.textures.woodTokenMap,
      color: '#fbf0d4',
      roughness: 0.65,
    });
    const pipMat = new THREE.MeshBasicMaterial({ color: '#452612' });
    const diceConfigs: Array<{ x: number; z: number; rotY: number; pips: Array<[number, number]> }> = [
      {
        x: -BOARD_W / 2 - 1.15,
        z: -BOARD_H * 0.24,
        rotY: 0.42,
        pips: [
          [-0.14, -0.14],
          [0.14, -0.14],
          [0, 0],
          [-0.14, 0.14],
          [0.14, 0.14],
        ],
      },
      {
        x: BOARD_W / 2 + 1.18,
        z: BOARD_H * 0.26,
        rotY: -0.58,
        pips: [
          [-0.14, -0.14],
          [0, 0],
          [0.14, 0.14],
        ],
      },
    ];
    for (const dc of diceConfigs) {
      const die = new THREE.Group();
      die.position.set(dc.x, 0.28, dc.z);
      die.rotation.y = dc.rotY;
      const cube = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.56, 0.56), diceMat);
      cube.castShadow = true;
      cube.receiveShadow = true;
      die.add(cube);
      for (const [px, pz] of dc.pips) {
        const pip = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.02, 10), pipMat);
        pip.position.set(px, 0.285, pz);
        die.add(pip);
      }
      this.worldGroup.add(die);
    }

    // Miniature potted tabletop mushroom & pebble accent resting beside the board!
    const deskMushroom = new THREE.Group();
    deskMushroom.position.set(BOARD_W / 2 + 1.25, 0, -BOARD_H * 0.34);
    const dmStem = new THREE.Mesh(
      new THREE.CylinderGeometry(0.14, 0.18, 0.36, 10),
      new THREE.MeshStandardMaterial({ map: this.textures.woodTokenMap, color: '#f8edd2', roughness: 0.85 })
    );
    dmStem.position.y = 0.18;
    dmStem.castShadow = true;
    const dmCap = new THREE.Mesh(
      new THREE.SphereGeometry(0.38, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.56),
      new THREE.MeshStandardMaterial({ map: this.textures.mushroomCapMap, roughness: 0.55 })
    );
    dmCap.position.y = 0.34;
    dmCap.scale.set(1, 0.65, 1);
    dmCap.castShadow = true;
    deskMushroom.add(dmStem, dmCap);
    this.worldGroup.add(deskMushroom);

    // 3. Compute positions & build painted wooden board space medallions!
    const posById = new Map<string, THREE.Vector3>();
    for (const n of snap.nodes) {
      posById.set(n.id, computeNodeWorldPos(n));
    }

    // Dotted boardgame tracks between connected spaces
    for (const n of snap.nodes) {
      const from = posById.get(n.id)!;
      const allOuts = [
        ...n.nextIds.map((id) => ({ id, shortcut: false })),
        ...(n.shortcutIds ?? []).map((id) => ({ id, shortcut: true })),
      ];
      for (const edge of allOuts) {
        const to = posById.get(edge.id);
        if (!to) continue;
        const isDone = snap.completedIds.has(n.id) && snap.completedIds.has(edge.id);
        const dotCount = Math.max(4, Math.floor(from.distanceTo(to) * 2.4));
        const dotColor = isDone ? 0x6ec94b : edge.shortcut ? 0xd99b2e : 0xfaf0d7;
        const dotGeo = new THREE.CylinderGeometry(
          edge.shortcut ? 0.055 : 0.068,
          edge.shortcut ? 0.062 : 0.075,
          0.018,
          10
        );
        const dotMat = new THREE.MeshBasicMaterial({
          color: dotColor,
          transparent: true,
          opacity: isDone ? 0.92 : 0.82,
        });
        for (let i = 1; i < dotCount; i++) {
          const t = i / dotCount;
          const p = new THREE.Vector3().lerpVectors(from, to, t);
          // Slight gentle organic meander so dots feel hand-drawn on the watercolor map
          const perpX = -(to.z - from.z);
          const perpZ = to.x - from.x;
          const len = Math.hypot(perpX, perpZ) || 1;
          const bend = Math.sin(t * Math.PI) * 0.08 * (edge.shortcut ? -1.4 : 1);
          const dot = new THREE.Mesh(dotGeo, dotMat);
          dot.position.set(p.x + (perpX / len) * bend, BOARD_TOP_Y + 0.012, p.z + (perpZ / len) * bend);
          this.trailGroup.add(dot);
        }
      }
    }

    // Build wooden board tokens for every space
    for (const n of snap.nodes) {
      const pos = posById.get(n.id)!;
      const style = NODE_TYPE_STYLE[n.type] ?? NODE_TYPE_STYLE.skirmish;
      const isDone = snap.completedIds.has(n.id);
      const isAvail = snap.availableIds.has(n.id);
      const isBoss = n.type === 'boss';
      const radius = isBoss ? 0.52 : n.type === 'start' ? 0.42 : 0.37;

      const group = new THREE.Group();
      group.position.copy(pos);

      // Thick painted turned-wood boardgame medallion base
      const disc = new THREE.Mesh(
        new THREE.CylinderGeometry(radius, radius + 0.05, 0.1, 24),
        new THREE.MeshStandardMaterial({
          map: this.textures.woodTokenMap,
          color: isDone && n.type !== 'start' ? 0x67b548 : isAvail ? style.hex : 0xede0c2,
          roughness: 0.62,
          bumpMap: this.textures.paperBump,
          bumpScale: 0.012,
        })
      );
      disc.position.y = 0.05;
      disc.castShadow = true;
      disc.receiveShadow = true;
      group.add(disc);

      // Crisp cream parchment & wood-ring inner cap
      const cap = new THREE.Mesh(
        new THREE.CylinderGeometry(radius * 0.78, radius * 0.8, 0.025, 22),
        new THREE.MeshStandardMaterial({
          map: this.textures.woodTokenMap,
          color: isDone && n.type !== 'start' ? 0xd9f5c6 : isAvail ? 0xfff8e4 : 0xf5ebd2,
          roughness: 0.78,
        })
      );
      cap.position.y = 0.105;
      group.add(cap);

      // Outer pulsing ring (bright gold/emerald when reachable with active Travel Card!)
      const ringGeo = new THREE.RingGeometry(radius + 0.08, radius + 0.22, 28);
      ringGeo.rotateX(-Math.PI / 2);
      const ringMat = new THREE.MeshBasicMaterial({
        color: isAvail ? 0xffe04a : 0x5c3818,
        transparent: true,
        opacity: isAvail ? 0.96 : 0.28,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      const ringMesh = new THREE.Mesh(ringGeo, ringMat);
      ringMesh.position.y = 0.02;
      group.add(ringMesh);

      // Floating tabletop gem beacon above reachable spaces
      const beaconMat = new THREE.MeshBasicMaterial({
        color: isBoss ? 0xff4b5c : 0xffdf4d,
        transparent: true,
        opacity: isAvail ? 0.94 : 0,
      });
      const beaconMesh = new THREE.Mesh(new THREE.OctahedronGeometry(0.15, 0), beaconMat);
      beaconMesh.position.y = isBoss ? 1.55 : 0.72;
      beaconMesh.visible = isAvail;
      group.add(beaconMesh);

      // Cute miniature brass star / landmark accent on special completed or landmark spaces
      let propSpin: THREE.Object3D | undefined;
      if (isDone && n.type !== 'start') {
        const star = new THREE.Mesh(
          new THREE.OctahedronGeometry(0.11, 0),
          new THREE.MeshStandardMaterial({ color: '#ffd24c', metalness: 0.35, roughness: 0.3 })
        );
        star.position.set(radius * 0.65, 0.24, -radius * 0.55);
        group.add(star);
        propSpin = star;
      } else if (n.type === 'shrine') {
        const drop = new THREE.Mesh(
          new THREE.SphereGeometry(0.1, 10, 8),
          new THREE.MeshStandardMaterial({ color: '#5ce8ff', emissive: '#1d7588', emissiveIntensity: 0.35, roughness: 0.2 })
        );
        drop.position.set(radius * 0.7, 0.24, -radius * 0.55);
        group.add(drop);
        propSpin = drop;
      }

      // Generous invisible click collider for crisp picking
      const hitMesh = new THREE.Mesh(
        new THREE.CylinderGeometry(radius + 0.32, radius + 0.32, 0.65, 14),
        new THREE.MeshBasicMaterial({ visible: false })
      );
      hitMesh.position.y = 0.3;
      hitMesh.userData.nodeId = n.id;
      group.add(hitMesh);
      this.pickMeshes.push(hitMesh);

      this.nodeGroup.add(group);
      this.nodeMap.set(n.id, {
        node: n,
        pos,
        group,
        ringMesh,
        ringMat,
        beaconMesh,
        beaconMat,
        hitMesh,
        propSpin,
      });
    }

    // 4. Active Squad Leader Pawn Standee + Act Boss Standee!
    const curPos =
      (snap.currentNodeId ? posById.get(snap.currentNodeId) : undefined) ??
      posById.get(snap.nodes.find((n) => n.type === 'start')?.id ?? '') ??
      new THREE.Vector3(0, BOARD_TOP_Y, 3);

    this.leaderRig = createPaperStandeeRig(snap.leadHeroKind, 'player', false, this.textures);
    this.leaderRig.root.scale.setScalar(0.92);
    this.leaderRig.root.position.copy(curPos).add(new THREE.Vector3(-0.34, 0.04, 0.24));
    this.standeeGroup.add(this.leaderRig.root);

    const bossNode = snap.nodes.find((n) => n.type === 'boss');
    if (bossNode) {
      const bPos = posById.get(bossNode.id)!;
      this.bossRig = createPaperStandeeRig(snap.bossKind, 'enemy', true, this.textures);
      this.bossRig.root.scale.setScalar(0.88);
      this.bossRig.root.position.copy(bPos).add(new THREE.Vector3(0.42, 0.04, -0.26));
      this.standeeGroup.add(this.bossRig.root);

      // Floating playful Golden Crown rotating above the Act Boss!
      const crownGroup = new THREE.Group();
      const crownMat = new THREE.MeshStandardMaterial({
        color: '#ffd84a',
        emissive: '#b56e00',
        emissiveIntensity: 0.32,
        metalness: 0.35,
        roughness: 0.28,
      });
      const crownBand = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.17, 0.14, 12), crownMat);
      crownGroup.add(crownBand);
      for (let k = 0; k < 4; k++) {
        const a = (k / 4) * Math.PI * 2;
        const tip = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.16, 4), crownMat);
        tip.position.set(Math.cos(a) * 0.15, 0.14, Math.sin(a) * 0.15);
        crownGroup.add(tip);
      }
      crownGroup.position.set(bPos.x + 0.42, BOARD_TOP_Y + 1.55, bPos.z - 0.26);
      this.worldGroup.add(crownGroup);
      this.animatedToys.push((t) => {
        crownGroup.rotation.y = t * 1.9;
        crownGroup.position.y = BOARD_TOP_Y + 1.52 + Math.sin(t * 3.8) * 0.09;
      });
    }

    // 4B. Playful Animated 3D Storybook Tabletop Toys on each Seasonal Board!
    this.buildPlayfulBoardToys(snap.theme);

    // 5. Gentle Drifting Seasonal Paper Motes above the watercolor game board!
    const moteColors =
      snap.theme === 'autumn'
        ? [0xd94826, 0xf29f24, 0xb82d1f]
        : snap.theme === 'greenhouse'
          ? [0xfff2a6, 0xffd75e, 0xd4ff9c]
          : [0xffb7cf, 0xfff8e2, 0xc7f29b];
    const moteGeo = new THREE.PlaneGeometry(0.14, 0.14);
    for (let i = 0; i < 24; i++) {
      const m = new THREE.Mesh(
        moteGeo,
        new THREE.MeshBasicMaterial({
          color: moteColors[i % moteColors.length],
          transparent: true,
          opacity: 0.72,
          side: THREE.DoubleSide,
          depthWrite: false,
        })
      );
      const bx = (Math.random() - 0.5) * BOARD_W * 1.05;
      const bz = (Math.random() - 0.5) * BOARD_H * 1.05;
      m.position.set(bx, BOARD_TOP_Y + 0.6 + Math.random() * 2.8, bz);
      this.weatherGroup.add(m);
      this.weatherMotes.push({
        mesh: m,
        baseX: bx,
        baseZ: bz,
        speed: 0.45 + Math.random() * 0.55,
        phase: Math.random() * Math.PI * 2,
      });
    }
  }

  private buildPlayfulBoardToys(theme: BoardTheme): void {
    const creamMat = new THREE.MeshStandardMaterial({
      map: this.textures.woodTokenMap,
      color: '#fbf0d4',
      roughness: 0.72,
    });
    const roofColor = theme === 'autumn' ? '#c94c24' : theme === 'greenhouse' ? '#2c8f78' : '#d64538';
    const roofMat = new THREE.MeshStandardMaterial({ color: roofColor, roughness: 0.65 });
    const woodMat = new THREE.MeshStandardMaterial({ color: '#7a4924', roughness: 0.85 });

    // 1. Spinning Storybook Cardboard Windmill perched on a scenic board bluff!
    const millCoords: Record<BoardTheme, [number, number]> = {
      spring: [-6.8, -3.15],
      greenhouse: [6.8, -3.2],
      autumn: [6.75, -3.05],
    };
    const [mx, mz] = millCoords[theme] ?? millCoords.spring;
    const windmill = new THREE.Group();
    windmill.position.set(mx, BOARD_TOP_Y, mz);
    windmill.rotation.y = mx < 0 ? 0.45 : -0.45;
    const tower = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.42, 1.05, 10), creamMat);
    tower.position.y = 0.525;
    tower.castShadow = true;
    const roof = new THREE.Mesh(new THREE.ConeGeometry(0.44, 0.48, 10), roofMat);
    roof.position.y = 1.24;
    roof.castShadow = true;
    windmill.add(tower, roof);

    const rotor = new THREE.Group();
    rotor.position.set(0, 0.92, 0.34);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.14, 10), woodMat);
    hub.rotation.x = Math.PI / 2;
    rotor.add(hub);
    const sailMat = new THREE.MeshStandardMaterial({
      color: '#fff6de',
      roughness: 0.65,
      side: THREE.DoubleSide,
    });
    for (let i = 0; i < 4; i++) {
      const arm = new THREE.Group();
      arm.rotation.z = (i * Math.PI) / 2;
      const spar = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.72, 0.04), woodMat);
      spar.position.y = 0.36;
      const sail = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.52, 0.02), sailMat);
      sail.position.set(0.11, 0.42, 0.01);
      arm.add(spar, sail);
      rotor.add(arm);
    }
    windmill.add(rotor);
    this.worldGroup.add(windmill);
    this.animatedToys.push((t) => {
      rotor.rotation.z = -t * 1.45;
    });

    // 2. Bobbing Origami Paper Sailboat / Pond Toy!
    const boatCoords: Record<BoardTheme, [number, number]> = {
      spring: [5.4, 3.1],
      greenhouse: [0.15, 1.45],
      autumn: [0.3, 1.15],
    };
    const [bx, bz] = boatCoords[theme] ?? boatCoords.spring;
    const boat = new THREE.Group();
    boat.position.set(bx, BOARD_TOP_Y + 0.04, bz);
    const hull = new THREE.Mesh(
      new THREE.CylinderGeometry(0.28, 0.16, 0.14, 6),
      new THREE.MeshStandardMaterial({ color: '#e85b3f', roughness: 0.65 })
    );
    hull.scale.set(1.35, 1, 0.72);
    hull.position.y = 0.07;
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.56, 8), woodMat);
    mast.position.y = 0.36;
    const canvasSail = new THREE.Mesh(
      new THREE.ConeGeometry(0.24, 0.42, 3),
      new THREE.MeshStandardMaterial({ color: '#fff9e6', roughness: 0.6 })
    );
    canvasSail.position.set(0.06, 0.4, 0);
    canvasSail.scale.set(0.28, 1, 1);
    boat.add(hull, mast, canvasSail);
    this.worldGroup.add(boat);
    this.animatedToys.push((t) => {
      boat.position.y = BOARD_TOP_Y + 0.05 + Math.sin(t * 2.8) * 0.035;
      boat.rotation.z = Math.sin(t * 2.2) * 0.12;
      boat.rotation.y = Math.sin(t * 0.9) * 0.25 + 0.3;
    });

    // 3. Festive Storybook Paper Bunting Banner strung across wooden stakes!
    const buntingCoords: Record<BoardTheme, [number, number]> = {
      spring: [-4.7, 3.4],
      greenhouse: [5.2, 3.3],
      autumn: [-3.4, 3.5],
    };
    const [fx, fz] = buntingCoords[theme] ?? buntingCoords.spring;
    const bunting = new THREE.Group();
    bunting.position.set(fx, BOARD_TOP_Y, fz);
    for (const side of [-0.72, 0.72]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.72, 8), woodMat);
      post.position.set(side, 0.36, 0);
      post.castShadow = true;
      bunting.add(post);
    }
    const flagColors = ['#e84a3c', '#f5c23b', '#3ca6db', '#57b848', '#eb6ca8'];
    const pennants: THREE.Mesh[] = [];
    for (let i = 0; i < 5; i++) {
      const frac = -0.52 + i * 0.26;
      const dip = Math.cos(frac * 2.4) * 0.08;
      const flag = new THREE.Mesh(
        new THREE.ConeGeometry(0.11, 0.22, 3),
        new THREE.MeshStandardMaterial({ color: flagColors[i % flagColors.length], roughness: 0.6 })
      );
      flag.rotation.z = Math.PI;
      flag.position.set(frac, 0.62 - dip, 0);
      bunting.add(flag);
      pennants.push(flag);
    }
    this.worldGroup.add(bunting);
    this.animatedToys.push((t) => {
      pennants.forEach((p, idx) => {
        p.rotation.x = Math.sin(t * 4.4 + idx * 0.9) * 0.24;
      });
    });

    // 4. Bouncy Spotted Toadstool Cluster along the board rim!
    const shroomPositions: Array<[number, number, number]> = [
      [-6.9, 1.5, 0.85],
      [-6.45, 1.85, 0.62],
      [6.85, 1.15, 0.78],
    ];
    for (let i = 0; i < shroomPositions.length; i++) {
      const [sx, sz, sc] = shroomPositions[i];
      const shroom = new THREE.Group();
      shroom.position.set(sx, BOARD_TOP_Y, sz);
      shroom.scale.setScalar(sc);
      const st = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.14, 0.26, 8), creamMat);
      st.position.y = 0.13;
      const cap = new THREE.Mesh(
        new THREE.SphereGeometry(0.28, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.56),
        new THREE.MeshStandardMaterial({ map: this.textures.mushroomCapMap, roughness: 0.52 })
      );
      cap.position.y = 0.24;
      cap.scale.set(1, 0.68, 1);
      shroom.add(st, cap);
      this.worldGroup.add(shroom);
      this.animatedToys.push((t) => {
        const bounce = 1 + Math.sin(t * 3.4 + i * 1.8) * 0.08;
        shroom.scale.set(sc * (2 - bounce), sc * bounce, sc * (2 - bounce));
      });
    }
  }

  private rebuildPreviewPath(pathIds: string[]): void {
    this.clearGroup(this.previewPathGroup);
    if (pathIds.length < 2) return;

    const mat = new THREE.MeshBasicMaterial({
      color: 0xffdf42,
      transparent: true,
      opacity: 0.96,
    });
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xffef99,
      transparent: true,
      opacity: 0.9,
      side: THREE.DoubleSide,
      depthWrite: false,
    });

    for (let i = 0; i < pathIds.length - 1; i++) {
      const a = this.nodeMap.get(pathIds[i])?.pos;
      const b = this.nodeMap.get(pathIds[i + 1])?.pos;
      if (!a || !b) continue;

      const mid = new THREE.Vector3().lerpVectors(a, b, 0.5);
      mid.y = BOARD_TOP_Y + 0.56;
      const curve = new THREE.QuadraticBezierCurve3(
        a.clone().add(new THREE.Vector3(0, 0.14, 0)),
        mid,
        b.clone().add(new THREE.Vector3(0, 0.14, 0))
      );
      const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 18, 0.062, 8, false), mat);
      this.previewPathGroup.add(tube);

      // Stepping stone halo on intermediate hops
      if (i > 0) {
        const rg = new THREE.RingGeometry(0.4, 0.52, 22);
        rg.rotateX(-Math.PI / 2);
        const rm = new THREE.Mesh(rg, ringMat);
        rm.position.set(a.x, BOARD_TOP_Y + 0.04, a.z);
        this.previewPathGroup.add(rm);
      }
    }
  }

  private pickNodeAt(clientX: number, clientY: number): string | null {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    this.pointerNdc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.pointerNdc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointerNdc, this.camera);
    const hits = this.raycaster.intersectObjects(this.pickMeshes, false);
    if (hits.length === 0) return null;
    return (hits[0].object.userData.nodeId as string | undefined) ?? null;
  }

  private onPointerDown = (e: PointerEvent): void => {
    this.downPt = { x: e.clientX, y: e.clientY };
    this.lastDragPt = { x: e.clientX, y: e.clientY };
    this.isDragging = false;
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (this.downPt && this.lastDragPt) {
      const dx = e.clientX - this.lastDragPt.x;
      const dy = e.clientY - this.lastDragPt.y;
      if (Math.hypot(e.clientX - this.downPt.x, e.clientY - this.downPt.y) > 8) {
        this.isDragging = true;
      }
      if (this.isDragging) {
        const panScale = this.curDist * 0.0014;
        this.targetPos.x = THREE.MathUtils.clamp(this.targetPos.x - dx * panScale, -5.2, 5.2);
        this.targetPos.z = THREE.MathUtils.clamp(this.targetPos.z - dy * panScale, -3.2, 3.6);
        this.lastDragPt = { x: e.clientX, y: e.clientY };
        return;
      }
    }
    if (e.target !== this.canvas) {
      if (this.hoveredNodeId !== null) {
        this.hoveredNodeId = null;
        this.hooks.onHoverNode(null);
      }
      return;
    }
    const hovered = this.pickNodeAt(e.clientX, e.clientY);
    if (hovered !== this.hoveredNodeId) {
      this.hoveredNodeId = hovered;
      this.canvas.style.cursor = hovered ? 'pointer' : 'grab';
      this.hooks.onHoverNode(hovered);
    }
  };

  private onPointerUp = (e: PointerEvent): void => {
    if (!this.downPt) return;
    const wasDrag = this.isDragging;
    this.downPt = null;
    this.lastDragPt = null;
    this.isDragging = false;
    if (wasDrag) return;
    const hitId = this.pickNodeAt(e.clientX, e.clientY);
    if (hitId) {
      const alreadySelected = this.snapshot?.selectedNodeId === hitId;
      this.hooks.onSelectNode(hitId, alreadySelected);
    }
  };

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    this.desiredDist = THREE.MathUtils.clamp(this.desiredDist + Math.sign(e.deltaY) * 1.15, 10.2, 23.5);
  };

  private bindEvents(): void {
    this.canvas.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
    this.canvas.addEventListener('wheel', this.onWheel, { passive: false });
  }

  private resize(): void {
    const parent = this.canvas.parentElement ?? this.canvas;
    const w = parent.clientWidth || window.innerWidth;
    const h = parent.clientHeight || window.innerHeight;
    this.cssW = Math.max(260, Math.floor(w));
    this.cssH = Math.max(200, Math.floor(h));
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);

    this.renderer.setPixelRatio(this.dpr);
    this.renderer.setSize(this.cssW, this.cssH, false);
    this.camera.aspect = this.cssW / this.cssH;
    this.camera.updateProjectionMatrix();

    if (this.overlayCanvas) {
      this.overlayCanvas.width = Math.floor(this.cssW * this.dpr);
      this.overlayCanvas.height = Math.floor(this.cssH * this.dpr);
    }
  }

  private drawOverlay(): void {
    const ctx = this.overlayCtx;
    const snap = this.snapshot;
    if (!ctx || !snap) return;

    ctx.save();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.cssW, this.cssH);

    const previewSet = new Set(snap.previewPathIds ?? []);

    for (const nv of this.nodeMap.values()) {
      this.tmpVec3.copy(nv.pos).add(new THREE.Vector3(0, 0.22, 0));
      this.tmpVec3.project(this.camera);
      if (this.tmpVec3.z < -1 || this.tmpVec3.z > 1) continue;

      const sx = (this.tmpVec3.x * 0.5 + 0.5) * this.cssW;
      const sy = (-this.tmpVec3.y * 0.5 + 0.5) * this.cssH;
      if (sx < -40 || sx > this.cssW + 40 || sy < -40 || sy > this.cssH + 40) continue;

      const style = NODE_TYPE_STYLE[nv.node.type] ?? NODE_TYPE_STYLE.skirmish;
      const isAvail = snap.availableIds.has(nv.node.id);
      const isDone = snap.completedIds.has(nv.node.id);
      const isSelected = snap.selectedNodeId === nv.node.id;
      const isHovered = this.hoveredNodeId === nv.node.id;
      const isInPreview = previewSet.has(nv.node.id);

      // Crisp miniature wooden medallion icon badge right on each board space!
      const r = nv.node.type === 'boss' ? 16 : isAvail || isSelected ? 14 : 11.5;
      ctx.save();
      ctx.beginPath();
      ctx.arc(sx, sy, r, 0, Math.PI * 2);
      ctx.fillStyle = isDone && nv.node.type !== 'start'
        ? '#4f9937'
        : isAvail
          ? style.badge
          : 'rgba(247, 236, 206, 0.92)';
      ctx.fill();
      ctx.lineWidth = isSelected || isHovered ? 3 : 2;
      ctx.strokeStyle = isSelected || isHovered || isInPreview ? '#ffe45e' : '#3e220f';
      ctx.stroke();

      ctx.font = `700 ${nv.node.type === 'boss' ? 13 : 11}px "Fredoka", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = isAvail || (isDone && nv.node.type !== 'start') ? '#fffdf5' : '#3e220f';
      ctx.fillText(isDone && nv.node.type !== 'start' ? '✓' : style.icon, sx, sy + 0.5);
      ctx.restore();

      // Clean floating region/type callout ONLY for hovered, selected, or Boss space so the watercolor painting breathes!
      if (isHovered || isSelected || (nv.node.type === 'boss' && isAvail)) {
        const tag = nv.node.region ? `${style.label} · ${nv.node.region}` : style.label;
        ctx.font = '800 11.5px "Nunito", sans-serif';
        const tw = ctx.measureText(tag).width + 16;
        const th = 22;
        const tx = Math.max(12, Math.min(this.cssW - tw - 12, sx - tw / 2));
        const ty = Math.max(66, sy - r - th - 6);

        ctx.save();
        roundRect(ctx, tx, ty, tw, th, 9);
        ctx.fillStyle = isAvail ? '#fff8df' : 'rgba(255, 249, 235, 0.94)';
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = isAvail ? '#c97b12' : '#4a2e16';
        ctx.stroke();
        ctx.fillStyle = '#3a200c';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(tag, tx + tw / 2, ty + th / 2 + 0.5);
        ctx.restore();
      }
    }

    ctx.restore();
  }

  private loop = (now: number): void => {
    if (this.destroyed) return;
    this.rafId = requestAnimationFrame(this.loop);

    const dt = Math.min(0.05, Math.max(0.001, (now - this.lastTime) / 1000));
    this.lastTime = now;
    this.elapsed += dt;

    // Smooth tabletop camera follow
    const damp = 1 - Math.exp(-7 * dt);
    this.curTarget.lerp(this.targetPos, damp);
    this.curDist += (this.desiredDist - this.curDist) * damp;

    const horiz = Math.cos(this.camPitch) * this.curDist;
    this.camera.position.set(
      this.curTarget.x + Math.sin(this.camYaw) * horiz,
      this.curTarget.y + Math.sin(this.camPitch) * this.curDist,
      this.curTarget.z + Math.cos(this.camYaw) * horiz
    );
    this.camera.lookAt(this.curTarget);

    // Animate board tokens & beacons
    const snap = this.snapshot;
    for (const nv of this.nodeMap.values()) {
      const isAvail = snap?.availableIds.has(nv.node.id) ?? false;
      const isSelected = snap?.selectedNodeId === nv.node.id;
      const isHovered = this.hoveredNodeId === nv.node.id;

      if (nv.beaconMesh.visible) {
        nv.beaconMesh.rotation.y = this.elapsed * 2.4;
        nv.beaconMesh.position.y =
          (nv.node.type === 'boss' ? 1.55 : 0.72) + Math.sin(this.elapsed * 4.2 + nv.pos.x) * 0.1;
      }
      if (isAvail) {
        const pulse = 1 + Math.sin(this.elapsed * 4.8 + nv.pos.x) * 0.09;
        nv.ringMesh.scale.setScalar(isSelected || isHovered ? 1.16 : pulse);
        nv.ringMat.color.setHex(isSelected || isHovered ? 0xfff078 : 0xffd040);
      }
      if (nv.propSpin) {
        nv.propSpin.rotation.y = this.elapsed * 1.8;
      }
    }

    // Animate Leader Pawn (multi-step hop OR cheerful idle bob!)
    if (this.leaderRig) {
      if (this.leaderHopAnim) {
        const t = Math.min(1, (now - this.leaderHopAnim.startMs) / this.leaderHopAnim.durationMs);
        const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
        this.leaderHopAnim.curve.getPoint(ease, this.leaderRig.root.position);
        this.leaderRig.tiltGroup.rotation.z = Math.sin(t * Math.PI) * 0.16;
        if (t >= 1) {
          this.leaderHopAnim.resolve();
        }
      } else {
        this.leaderRig.tiltGroup.position.y = Math.abs(Math.sin(this.elapsed * 3.8)) * 0.08;
        this.leaderRig.tiltGroup.rotation.z = Math.sin(this.elapsed * 1.9) * 0.04;
      }
    }

    if (this.bossRig) {
      this.bossRig.tiltGroup.position.y = Math.abs(Math.sin(this.elapsed * 2.6 + 1.2)) * 0.06;
    }

    for (const tickToy of this.animatedToys) {
      tickToy(this.elapsed);
    }

    // Drifting seasonal paper weather motes
    for (const m of this.weatherMotes) {
      m.mesh.position.y -= dt * m.speed * 0.45;
      m.mesh.position.x = m.baseX + Math.sin(this.elapsed * m.speed + m.phase) * 0.65;
      m.mesh.rotation.z = this.elapsed * 1.4 + m.phase;
      m.mesh.rotation.x = Math.sin(this.elapsed * 1.1 + m.phase) * 0.6;
      if (m.mesh.position.y < BOARD_TOP_Y + 0.15) {
        m.mesh.position.y = BOARD_TOP_Y + 3.2;
      }
    }

    this.renderer.render(this.scene, this.camera);
    this.drawOverlay();
  };

  public destroy(): void {
    this.destroyed = true;
    cancelAnimationFrame(this.rafId);
    if (this.leaderHopAnim) {
      clearTimeout(this.leaderHopAnim.timer);
      this.leaderHopAnim.resolve();
      this.leaderHopAnim = null;
    }
    this.resizeObserver.disconnect();
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
    this.canvas.removeEventListener('wheel', this.onWheel);
    for (const tex of this.boardTextures.values()) {
      tex.dispose();
    }
    this.boardTextures.clear();
    this.clearGroup(this.worldGroup);
    this.clearGroup(this.trailGroup);
    this.clearGroup(this.previewPathGroup);
    this.clearGroup(this.nodeGroup);
    this.clearGroup(this.standeeGroup);
    this.clearGroup(this.weatherGroup);
    this.textures.dispose();
    this.renderer.dispose();
  }
}
