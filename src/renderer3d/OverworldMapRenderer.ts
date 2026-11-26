import * as THREE from 'three';
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
  currentNodeId: string | null;
  selectedNodeId: string | null;
  leadHeroKind: string;
  bossKind: string;
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

const STAGE_Z_STEP = 2.65;
const LANE_X_STEP = 2.65;
const MAX_LANES = 4;

const NODE_TYPE_COLORS: Record<NodeType, { hex: number; badge: string; label: string }> = {
  skirmish: { hex: 0xd95638, badge: '#d95638', label: 'Battle' },
  escape: { hex: 0x3b9ec4, badge: '#3b9ec4', label: 'Breakout' },
  barn_rescue: { hex: 0xe69524, badge: '#d98416', label: 'Rescue' },
  elite: { hex: 0xa82738, badge: '#a82738', label: 'Elite' },
  shop: { hex: 0x459e4c, badge: '#3d8f44', label: 'Market' },
  vault: { hex: 0xdba827, badge: '#c49116', label: 'Vault' },
  event: { hex: 0x8e4cb8, badge: '#8542ad', label: 'Mystery' },
  boss: { hex: 0x7c1c28, badge: '#7c1c28', label: 'Boss' },
};

function stageElevation(stage: number): number {
  if (stage >= 7) return 1.65;
  if (stage >= 6) return 1.15;
  if (stage >= 4) return 0.76;
  if (stage >= 2) return 0.38;
  return 0;
}

function computeNodeWorldPos(node: SeasonNode, maxStage: number): THREE.Vector3 {
  const zCenter = (maxStage * STAGE_Z_STEP) / 2;
  const z = zCenter - node.stage * STAGE_Z_STEP;
  if (node.type === 'boss') {
    return new THREE.Vector3(0, stageElevation(node.stage), z);
  }
  const laneOffset = (node.lane - (MAX_LANES - 1) / 2) * LANE_X_STEP;
  // Subtle hand-drawn trail meander so lanes feel organic like Mario World!
  const jitterX = Math.sin(node.stage * 2.1 + node.lane * 1.7) * 0.34;
  const jitterZ = Math.cos(node.stage * 1.5 + node.lane * 2.3) * 0.2;
  return new THREE.Vector3(laneOffset + jitterX, stageElevation(node.stage), z + jitterZ);
}

/**
 * Full 3D Paper Mario Act Overworld Renderer!
 * Replaces the sprawling 2D SVG scroll wall with an interactive sculpted 3D diorama island.
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

  private worldGroup = new THREE.Group();
  private trailGroup = new THREE.Group();
  private nodeGroup = new THREE.Group();
  private standeeGroup = new THREE.Group();

  private nodeMap = new Map<string, NodeVisual>();
  private pickMeshes: THREE.Mesh[] = [];
  private leaderRig: PaperStandeeRig | null = null;
  private bossRig: PaperStandeeRig | null = null;
  private trees: Array<{ obj: THREE.Object3D; phase: number }> = [];
  private clouds: Array<{ obj: THREE.Object3D; baseX: number; phase: number }> = [];

  private snapshot: OverworldSnapshot | null = null;
  private builtSignature = '';
  private hoveredNodeId: string | null = null;

  // Smooth pan/zoom camera state
  private targetPos = new THREE.Vector3(0, 0.5, 4.5);
  private curTarget = new THREE.Vector3(0, 0.5, 4.5);
  private desiredDist = 14.5;
  private curDist = 14.5;
  private camYaw = -0.14;
  private camPitch = 0.72;
  private minZ = -10;
  private maxZ = 10;

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
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#6a4424');
    this.scene.fog = new THREE.FogExp2('#6a4424', 0.015);

    this.camera = new THREE.PerspectiveCamera(36, 16 / 9, 0.2, 120);
    this.textures = new CraftTextureLibrary();

    this.scene.add(this.worldGroup);
    this.scene.add(this.trailGroup);
    this.scene.add(this.nodeGroup);
    this.scene.add(this.standeeGroup);

    this.setupLights();
    this.resize();
    this.bindEvents();

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas.parentElement ?? canvas);

    this.lastTime = performance.now();
    this.rafId = requestAnimationFrame(this.loop);
  }

  private setupLights(): void {
    const hemi = new THREE.HemisphereLight(0xfff8e6, 0x8a5e36, 0.98);
    this.scene.add(hemi);

    const sun = new THREE.DirectionalLight(0xfff1cc, 1.5);
    sun.position.set(11, 18, 12);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near = 2;
    sun.shadow.camera.far = 64;
    const d = 18;
    sun.shadow.camera.left = -d;
    sun.shadow.camera.right = d;
    sun.shadow.camera.top = d;
    sun.shadow.camera.bottom = -d;
    sun.shadow.bias = -0.0005;
    this.scene.add(sun);

    const rim = new THREE.DirectionalLight(0xc2e2ff, 0.42);
    rim.position.set(-12, 9, -10);
    this.scene.add(rim);
  }

  private addInkEdges(mesh: THREE.Mesh, opacity = 0.5): void {
    const edges = new THREE.EdgesGeometry(mesh.geometry, 22);
    const lines = new THREE.LineSegments(
      edges,
      new THREE.LineBasicMaterial({ color: 0x3e220f, transparent: true, opacity })
    );
    mesh.add(lines);
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
      snap.nodes.map((n) => n.id).join(','),
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
      } else {
        this.recenter(false);
      }
    }
  }

  public focusNode(nodeId: string): void {
    const nv = this.nodeMap.get(nodeId);
    if (!nv) return;
    this.targetPos.set(
      THREE.MathUtils.clamp(nv.pos.x * 0.65, -4.5, 4.5),
      nv.pos.y + 0.35,
      THREE.MathUtils.clamp(nv.pos.z, this.minZ, this.maxZ)
    );
  }

  /**
   * Animates the Squad Leader Paper Mario standee hopping along the stepping-stone trail
   * to the target stop before entering battle/market/event!
   */
  public hopLeaderToNode(nodeId: string): Promise<void> {
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
    const to = nv.pos.clone().add(new THREE.Vector3(-0.32, 0.14, 0.28));
    const mid = new THREE.Vector3().lerpVectors(from, to, 0.5);
    mid.y = Math.max(from.y, to.y) + 0.35;
    const curve = new THREE.QuadraticBezierCurve3(from, mid, to);
    this.focusNode(nodeId);

    const durationMs = 460;
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
          this.leaderRig.flipGroup.rotation.y = 0;
        }
        resolve();
      };
      const timer = setTimeout(finish, durationMs + 60);
      this.leaderHopAnim = {
        curve,
        startMs: performance.now(),
        durationMs,
        timer,
        resolve: finish,
      };
    });
  }

  public recenter(instant = false): void {
    if (!this.snapshot) return;
    const focusIds = this.snapshot.selectedNodeId
      ? [this.snapshot.selectedNodeId]
      : Array.from(this.snapshot.availableIds);
    const pts: THREE.Vector3[] = [];
    for (const id of focusIds) {
      const nv = this.nodeMap.get(id);
      if (nv) pts.push(nv.pos);
    }
    if (pts.length === 0 && this.snapshot.currentNodeId) {
      const cur = this.nodeMap.get(this.snapshot.currentNodeId);
      if (cur) pts.push(cur.pos);
    }
    if (pts.length > 0) {
      const avg = new THREE.Vector3();
      for (const p of pts) avg.add(p);
      avg.divideScalar(pts.length);
      this.targetPos.set(
        THREE.MathUtils.clamp(avg.x * 0.5, -3.5, 3.5),
        avg.y + 0.3,
        THREE.MathUtils.clamp(avg.z - 0.8, this.minZ, this.maxZ)
      );
    } else {
      this.targetPos.set(0, 0.4, 5.5);
    }
    this.desiredDist = this.cssW < 680 ? 17.5 : 13.8;
    if (instant) {
      this.curTarget.copy(this.targetPos);
      this.curDist = this.desiredDist;
    }
  }

  private rebuildMap(snap: OverworldSnapshot): void {
    this.clearGroup(this.worldGroup);
    this.clearGroup(this.trailGroup);
    this.clearGroup(this.nodeGroup);
    if (this.leaderRig) {
      this.standeeGroup.remove(this.leaderRig.root);
      this.leaderRig.dispose();
      this.leaderRig = null;
    }
    if (this.bossRig) {
      this.standeeGroup.remove(this.bossRig.root);
      this.bossRig.dispose();
      this.bossRig = null;
    }
    this.nodeMap.clear();
    this.pickMeshes.length = 0;
    this.trees.length = 0;
    this.clouds.length = 0;

    const maxStage = Math.max(7, ...snap.nodes.map((n) => n.stage));
    const boardW = 13.2;
    const boardH = (maxStage + 1.5) * STAGE_Z_STEP;
    this.minZ = -boardH * 0.42;
    this.maxZ = boardH * 0.42;

    const theme = snap.theme;
    const isAutumn = theme === 'autumn';
    const isGreenhouse = theme === 'greenhouse';
    const bgHex = isAutumn ? '#5c3424' : isGreenhouse ? '#4a5a42' : '#6a4424';
    this.scene.background = new THREE.Color(bgHex);
    (this.scene.fog as THREE.FogExp2).color.set(bgHex);

    // 1. Oak tabletop & corrugated cardboard Act Island base
    const deskGeo = new THREE.PlaneGeometry(90, 90);
    deskGeo.rotateX(-Math.PI / 2);
    const desk = new THREE.Mesh(
      deskGeo,
      new THREE.MeshStandardMaterial({
        map: this.textures.woodDeskMap,
        color: '#c29464',
        roughness: 0.9,
      })
    );
    desk.position.y = -0.82;
    desk.receiveShadow = true;
    this.worldGroup.add(desk);

    const corrMat = new THREE.MeshStandardMaterial({
      map: this.textures.corrugatedMap,
      bumpMap: this.textures.corrugatedBump,
      bumpScale: 0.06,
      roughness: 0.9,
    });
    const grassColor = isAutumn ? '#c39744' : isGreenhouse ? '#78b050' : '#85b548';
    const topMat = new THREE.MeshStandardMaterial({
      color: grassColor,
      roughness: 0.9,
      bumpMap: this.textures.paperBump,
      bumpScale: 0.02,
    });
    const botMat = new THREE.MeshStandardMaterial({ color: '#6b4220', roughness: 0.95 });

    const baseSlab = new THREE.Mesh(
      new THREE.BoxGeometry(boardW, 0.72, boardH),
      [corrMat, corrMat, topMat, botMat, corrMat, corrMat]
    );
    baseSlab.position.set(0, -0.36, 0);
    baseSlab.castShadow = true;
    baseSlab.receiveShadow = true;
    this.addInkEdges(baseSlab, 0.55);
    this.worldGroup.add(baseSlab);

    // 2. Sculpted Multi-Elevation Cardboard Terraces rising up toward the Boss Peak!
    const cliffMat = new THREE.MeshStandardMaterial({
      map: this.textures.cliffSideMap,
      bumpMap: this.textures.paperBump,
      bumpScale: 0.02,
      roughness: 0.9,
    });
    const tiers: Array<{ y: number; zMin: number; zMax: number; w: number; col: string }> = [
      { y: 0.38, zMin: -boardH * 0.48, zMax: 3.6, w: boardW - 0.8, col: isAutumn ? '#b88635' : isGreenhouse ? '#6fa648' : '#7ba93f' },
      { y: 0.76, zMin: -boardH * 0.48, zMax: -1.7, w: boardW - 1.6, col: isAutumn ? '#aa772e' : isGreenhouse ? '#669b42' : '#719e38' },
      { y: 1.15, zMin: -boardH * 0.48, zMax: -6.8, w: boardW - 2.6, col: isAutumn ? '#9e6828' : isGreenhouse ? '#5d8f3c' : '#689333' },
      { y: 1.65, zMin: -boardH * 0.48, zMax: -9.3, w: 6.8, col: isAutumn ? '#8e4c24' : isGreenhouse ? '#c48354' : '#b27b44' },
    ];
    for (const tr of tiers) {
      const depth = Math.max(2, tr.zMax - tr.zMin);
      const cz = (tr.zMin + tr.zMax) / 2;
      const tierTop = new THREE.MeshStandardMaterial({
        color: tr.col,
        roughness: 0.88,
        bumpMap: this.textures.paperBump,
        bumpScale: 0.02,
      });
      const block = new THREE.Mesh(
        new THREE.BoxGeometry(tr.w, tr.y, depth),
        [cliffMat, cliffMat, tierTop, botMat, cliffMat, cliffMat]
      );
      block.position.set(0, tr.y / 2, cz);
      block.castShadow = true;
      block.receiveShadow = true;
      this.addInkEdges(block, 0.45);
      this.worldGroup.add(block);
    }

    // Decorative creek ribbon slicing through the valley floor
    const creekMat = new THREE.MeshStandardMaterial({
      map: this.textures.getTerrainTexture(theme, 'water', true),
      roughness: 0.18,
      metalness: 0.14,
      transparent: true,
      opacity: 0.88,
    });
    const creek = new THREE.Mesh(new THREE.BoxGeometry(boardW - 0.6, 0.04, 0.95), creekMat);
    creek.position.set(0, 0.02, 5.1);
    creek.receiveShadow = true;
    this.worldGroup.add(creek);

    // 3. Perimeter Folded-Paper Trees & Clouds
    for (let i = 0; i < 16; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const tz = -boardH * 0.44 + (i / 15) * (boardH * 0.86);
      const tx = side * (boardW * 0.5 - 0.65 - (i % 3) * 0.25);
      const elev = tz < -6.8 ? 1.15 : tz < -1.7 ? 0.76 : tz < 3.6 ? 0.38 : 0;
      const tree = new THREE.Group();
      tree.position.set(tx, elev, tz);
      const trunk = new THREE.Mesh(
        new THREE.CylinderGeometry(0.09, 0.13, 0.68, 6),
        new THREE.MeshStandardMaterial({ color: '#754622', roughness: 0.9 })
      );
      trunk.position.y = 0.34;
      trunk.castShadow = true;
      const folColor = isAutumn
        ? i % 3 === 0
          ? '#d65d28'
          : '#e59a2d'
        : isGreenhouse
          ? '#4f995c'
          : i % 2 === 0
            ? '#528f32'
            : '#6aa83f';
      const fol = new THREE.Mesh(
        new THREE.ConeGeometry(0.54, 1.25, 6),
        new THREE.MeshStandardMaterial({ color: folColor, roughness: 0.85, flatShading: true })
      );
      fol.position.y = 1.12;
      fol.castShadow = true;
      this.addInkEdges(fol, 0.32);
      tree.add(trunk, fol);
      tree.scale.setScalar(0.85 + (i % 3) * 0.14);
      this.worldGroup.add(tree);
      this.trees.push({ obj: tree, phase: i * 0.9 });
    }

    // Floating Paper Clouds along the northern horizon
    const cloudMat = new THREE.MeshStandardMaterial({ color: '#fffbf0', roughness: 0.92 });
    for (const [cx, cy, cz, sc] of [
      [-5.2, 4.4, -boardH * 0.52, 1.1],
      [4.8, 4.8, -boardH * 0.54, 1.25],
      [0.2, 5.2, -boardH * 0.58, 1.0],
    ]) {
      const g = new THREE.Group();
      for (const [ox, oy, r] of [
        [0, 0.12, 0.52],
        [-0.44, 0, 0.38],
        [0.44, -0.02, 0.36],
      ]) {
        const d = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.12, 12), cloudMat);
        d.rotation.x = Math.PI / 2;
        d.position.set(ox, oy, 0);
        g.add(d);
      }
      g.position.set(cx, cy, cz);
      g.scale.setScalar(sc);
      this.worldGroup.add(g);
      this.clouds.push({ obj: g, baseX: cx, phase: cx });
    }

    // 4. Compute 3D positions & build Node Pedestals
    const posLookup = new Map<string, THREE.Vector3>();
    for (const n of snap.nodes) {
      posLookup.set(n.id, computeNodeWorldPos(n, maxStage));
    }

    // 5. Winding 3D Stepping-Stone Trails connecting every node edge!
    for (const n of snap.nodes) {
      const from = posLookup.get(n.id)!;
      const fromDone = snap.completedIds.has(n.id);
      const isCurrent = snap.currentNodeId === n.id;

      for (const nextId of n.nextIds) {
        const to = posLookup.get(nextId);
        if (!to) continue;
        const toDone = snap.completedIds.has(nextId);
        const isActiveRoute =
          (isCurrent && snap.availableIds.has(nextId)) ||
          (snap.currentNodeId === null && snap.availableIds.has(n.id));

        const mid = new THREE.Vector3().lerpVectors(from, to, 0.5);
        mid.y = Math.max(from.y, to.y) + 0.08;
        const curve = new THREE.QuadraticBezierCurve3(
          new THREE.Vector3(from.x, from.y + 0.04, from.z),
          mid,
          new THREE.Vector3(to.x, to.y + 0.04, to.z)
        );

        const col =
          fromDone && toDone
            ? 0x5cb844
            : isActiveRoute
              ? 0xf7c948
              : 0xd9c298;
        const stoneMat = new THREE.MeshStandardMaterial({
          color: col,
          emissive: isActiveRoute ? 0xe0a214 : 0x000000,
          emissiveIntensity: isActiveRoute ? 0.25 : 0,
          roughness: 0.85,
        });

        const steps = 6;
        for (let s = 1; s < steps; s++) {
          const pt = curve.getPoint(s / steps);
          const stone = new THREE.Mesh(
            new THREE.CylinderGeometry(isActiveRoute ? 0.2 : 0.15, isActiveRoute ? 0.23 : 0.17, 0.08, 8),
            stoneMat
          );
          stone.position.copy(pt);
          stone.receiveShadow = true;
          stone.castShadow = true;
          this.trailGroup.add(stone);
        }
      }
    }

    // 6. Create 3D Miniature Pedestals for Every Stop
    for (const n of snap.nodes) {
      const pos = posLookup.get(n.id)!;
      const nv = this.createNodePedestal(n, pos, snap);
      this.nodeMap.set(n.id, nv);
      this.nodeGroup.add(nv.group);
      this.pickMeshes.push(nv.hitMesh);
    }

    // 7. Place Squad Leader Paper Standee at current stop (or southern trailhead!)
    const leaderRig = createPaperStandeeRig(snap.leadHeroKind, 'player', false, this.textures);
    if (snap.currentNodeId && posLookup.has(snap.currentNodeId)) {
      const cp = posLookup.get(snap.currentNodeId)!;
      leaderRig.root.position.set(cp.x - 0.55, cp.y + 0.14, cp.z + 0.32);
    } else {
      const startZ = (maxStage * STAGE_Z_STEP) / 2 + 1.45;
      leaderRig.root.position.set(0, 0.02, startZ);
    }
    leaderRig.root.scale.setScalar(0.95);
    this.standeeGroup.add(leaderRig.root);
    this.leaderRig = leaderRig;

    // 8. Place Act Boss Paper Standee atop the Northern Boss Citadel!
    const bossNode = snap.nodes.find((n) => n.type === 'boss');
    if (bossNode) {
      const bp = posLookup.get(bossNode.id)!;
      const bossRig = createPaperStandeeRig(snap.bossKind, 'enemy', true, this.textures);
      bossRig.root.position.set(bp.x, bp.y + 0.22, bp.z - 0.15);
      bossRig.root.scale.setScalar(1.05);
      this.standeeGroup.add(bossRig.root);
      this.bossRig = bossRig;
    }
  }

  private createNodePedestal(
    node: SeasonNode,
    pos: THREE.Vector3,
    snap: OverworldSnapshot
  ): NodeVisual {
    const group = new THREE.Group();
    group.position.copy(pos);

    const isDone = snap.completedIds.has(node.id);
    const isAvail = snap.availableIds.has(node.id);
    const isBoss = node.type === 'boss';
    const meta = NODE_TYPE_COLORS[node.type];
    const rad = isBoss ? 1.15 : 0.68;

    // Tactile Wooden / Stone Stop Disc Pedestal
    const discColor = isDone ? 0x5cb844 : isAvail ? meta.hex : 0x9b866d;
    const disc = new THREE.Mesh(
      new THREE.CylinderGeometry(rad, rad * 1.1, isBoss ? 0.24 : 0.16, 16),
      new THREE.MeshStandardMaterial({
        color: discColor,
        roughness: 0.78,
        bumpMap: this.textures.paperBump,
        bumpScale: 0.015,
      })
    );
    disc.position.y = isBoss ? 0.12 : 0.08;
    disc.castShadow = true;
    disc.receiveShadow = true;
    this.addInkEdges(disc, 0.55);
    group.add(disc);

    // Cream inner stamp ring
    const topCap = new THREE.Mesh(
      new THREE.CylinderGeometry(rad * 0.76, rad * 0.76, 0.03, 14),
      new THREE.MeshStandardMaterial({
        color: isDone ? '#dff5d8' : '#fbf3df',
        roughness: 0.85,
      })
    );
    topCap.position.y = isBoss ? 0.25 : 0.17;
    group.add(topCap);

    // Distinct 3D Miniature Prop per Node Type!
    let propSpin: THREE.Object3D | undefined;
    if (isDone) {
      // Completed Green Victory Flag!
      const pole = new THREE.Mesh(
        new THREE.CylinderGeometry(0.03, 0.03, 0.85, 6),
        new THREE.MeshStandardMaterial({ color: '#6b4220', roughness: 0.9 })
      );
      pole.position.y = 0.56;
      const pennant = new THREE.Mesh(
        new THREE.ConeGeometry(0.22, 0.44, 3),
        new THREE.MeshStandardMaterial({ color: '#58b842', roughness: 0.75 })
      );
      pennant.rotation.z = -Math.PI / 2;
      pennant.position.set(0.22, 0.84, 0);
      group.add(pole, pennant);
    } else if (node.type === 'skirmish') {
      const crate = new THREE.Mesh(
        new THREE.BoxGeometry(0.54, 0.46, 0.54),
        new THREE.MeshStandardMaterial({ map: this.textures.crateMap, roughness: 0.85 })
      );
      crate.position.y = 0.41;
      crate.rotation.y = 0.35;
      crate.castShadow = true;
      this.addInkEdges(crate);
      group.add(crate);
    } else if (node.type === 'elite') {
      const warCrate = new THREE.Mesh(
        new THREE.BoxGeometry(0.62, 0.58, 0.62),
        new THREE.MeshStandardMaterial({ color: '#b52e3a', roughness: 0.75 })
      );
      warCrate.position.y = 0.47;
      warCrate.rotation.y = Math.PI / 4;
      warCrate.castShadow = true;
      this.addInkEdges(warCrate);
      const star = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.22, 0),
        new THREE.MeshStandardMaterial({ color: '#ffd54f', emissive: '#e09a14', emissiveIntensity: 0.4 })
      );
      star.position.y = 1.02;
      group.add(warCrate, star);
      propSpin = star;
    } else if (node.type === 'barn_rescue') {
      const cage = new THREE.Mesh(
        new THREE.BoxGeometry(0.58, 0.54, 0.58),
        new THREE.MeshStandardMaterial({ map: this.textures.cageFrontMap, roughness: 0.88 })
      );
      cage.position.y = 0.45;
      cage.castShadow = true;
      this.addInkEdges(cage);
      group.add(cage);
    } else if (node.type === 'escape') {
      const postMat = new THREE.MeshStandardMaterial({ color: '#8f5829', roughness: 0.88 });
      for (const sx of [-0.36, 0.36]) {
        const p = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.72, 0.1), postMat);
        p.position.set(sx, 0.52, 0);
        p.castShadow = true;
        group.add(p);
      }
      const beam = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.14, 0.12), postMat);
      beam.position.set(0, 0.86, 0);
      this.addInkEdges(beam);
      group.add(beam);
    } else if (node.type === 'shop') {
      // Cute Striped Awning Compost Market Stall!
      const counter = new THREE.Mesh(
        new THREE.BoxGeometry(0.76, 0.34, 0.46),
        new THREE.MeshStandardMaterial({ color: '#b5773c', roughness: 0.88 })
      );
      counter.position.y = 0.34;
      const awning = new THREE.Mesh(
        new THREE.BoxGeometry(0.92, 0.12, 0.62),
        new THREE.MeshStandardMaterial({ color: '#d9483b', roughness: 0.78 })
      );
      awning.position.set(0, 0.84, 0);
      awning.rotation.x = 0.18;
      this.addInkEdges(awning);
      group.add(counter, awning);
    } else if (node.type === 'vault') {
      const chest = new THREE.Mesh(
        new THREE.BoxGeometry(0.64, 0.44, 0.48),
        new THREE.MeshStandardMaterial({ color: '#d9a126', roughness: 0.72, metalness: 0.15 })
      );
      chest.position.y = 0.4;
      chest.castShadow = true;
      this.addInkEdges(chest);
      group.add(chest);
    } else if (node.type === 'event') {
      const gem = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.32, 0),
        new THREE.MeshStandardMaterial({
          color: '#b56ce6',
          emissive: '#7c32b0',
          emissiveIntensity: 0.35,
          roughness: 0.45,
        })
      );
      gem.position.y = 0.74;
      gem.castShadow = true;
      group.add(gem);
      propSpin = gem;
    }

    // Glowing Selection / Reachable Ring
    const ringGeo = new THREE.RingGeometry(rad * 1.12, rad * 1.34, 28);
    ringGeo.rotateX(-Math.PI / 2);
    const ringMat = new THREE.MeshBasicMaterial({
      color: isAvail ? 0xffe052 : 0xffffff,
      transparent: true,
      opacity: isAvail ? 0.88 : 0,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const ringMesh = new THREE.Mesh(ringGeo, ringMat);
    ringMesh.position.y = 0.05;
    group.add(ringMesh);

    // Soft Vertical Golden Beacon for Reachable Stops!
    const beaconGeo = new THREE.CylinderGeometry(rad * 0.55, rad * 0.85, 2.2, 14, 1, true);
    const beaconMat = new THREE.MeshBasicMaterial({
      color: 0xffe678,
      transparent: true,
      opacity: isAvail ? 0.16 : 0,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const beaconMesh = new THREE.Mesh(beaconGeo, beaconMat);
    beaconMesh.position.y = 1.18;
    group.add(beaconMesh);

    // Invisible Generous Hit Cylinder for Easy Picking
    const hitMesh = new THREE.Mesh(
      new THREE.CylinderGeometry(rad * 1.28, rad * 1.28, 1.5, 10),
      new THREE.MeshBasicMaterial({ visible: false })
    );
    hitMesh.position.y = 0.75;
    hitMesh.userData.nodeId = node.id;
    group.add(hitMesh);

    return {
      node,
      pos,
      group,
      ringMesh,
      ringMat,
      beaconMesh,
      beaconMat,
      hitMesh,
      propSpin,
    };
  }

  private pickNode(clientX: number, clientY: number): string | null {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    this.pointerNdc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.pointerNdc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointerNdc, this.camera);
    const hits = this.raycaster.intersectObjects(this.pickMeshes, false);
    if (hits.length > 0) {
      return (hits[0].object.userData.nodeId as string) ?? null;
    }
    return null;
  }

  private bindEvents(): void {
    this.canvas.addEventListener('pointerdown', this.onPointerDown);
    this.canvas.addEventListener('pointermove', this.onPointerMove);
    this.canvas.addEventListener('pointerup', this.onPointerUp);
    this.canvas.addEventListener('pointercancel', this.onPointerUp);
    this.canvas.addEventListener('wheel', this.onWheel, { passive: false });
  }

  private onPointerDown = (e: PointerEvent): void => {
    this.downPt = { x: e.clientX, y: e.clientY };
    this.lastDragPt = { x: e.clientX, y: e.clientY };
    this.isDragging = false;
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      // ignore
    }
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (this.downPt && this.lastDragPt) {
      const total = Math.hypot(e.clientX - this.downPt.x, e.clientY - this.downPt.y);
      if (total > 8) this.isDragging = true;
      if (this.isDragging) {
        const dx = e.clientX - this.lastDragPt.x;
        const dy = e.clientY - this.lastDragPt.y;
        const scale = this.curDist * 0.0017;
        this.targetPos.x = THREE.MathUtils.clamp(this.targetPos.x - dx * scale, -6, 6);
        this.targetPos.z = THREE.MathUtils.clamp(this.targetPos.z - dy * scale * 1.25, this.minZ, this.maxZ);
        this.lastDragPt = { x: e.clientX, y: e.clientY };
        this.canvas.style.cursor = 'grabbing';
        return;
      }
    }
    if (e.pointerType === 'mouse') {
      const id = this.pickNode(e.clientX, e.clientY);
      if (id !== this.hoveredNodeId) {
        this.hoveredNodeId = id;
        this.hooks.onHoverNode(id);
      }
      this.canvas.style.cursor = id ? 'pointer' : 'grab';
    }
  };

  private onPointerUp = (e: PointerEvent): void => {
    try {
      if (this.canvas.hasPointerCapture(e.pointerId)) {
        this.canvas.releasePointerCapture(e.pointerId);
      }
    } catch {
      // ignore
    }
    const wasTap = this.downPt !== null && !this.isDragging;
    this.downPt = null;
    this.lastDragPt = null;
    this.isDragging = false;
    this.canvas.style.cursor = 'grab';

    if (wasTap) {
      const id = this.pickNode(e.clientX, e.clientY);
      if (id) {
        const alreadySelected = this.snapshot?.selectedNodeId === id;
        this.focusNode(id);
        this.hooks.onSelectNode(id, alreadySelected);
      }
    }
  };

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      this.desiredDist = THREE.MathUtils.clamp(this.desiredDist + e.deltaY * 0.015, 8.5, 24);
    } else {
      // Smoothly pan north/south along the trail with mouse wheel!
      this.targetPos.z = THREE.MathUtils.clamp(
        this.targetPos.z + e.deltaY * 0.012,
        this.minZ,
        this.maxZ
      );
    }
  };

  private resize(): void {
    const parent = this.canvas.parentElement ?? this.canvas;
    const rect = parent.getBoundingClientRect();
    this.cssW = Math.max(260, Math.floor(rect.width || window.innerWidth));
    this.cssH = Math.max(200, Math.floor(rect.height || window.innerHeight));
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);

    this.renderer.setPixelRatio(this.dpr);
    this.renderer.setSize(this.cssW, this.cssH, false);
    this.camera.aspect = this.cssW / this.cssH;
    this.camera.updateProjectionMatrix();

    if (this.overlayCanvas) {
      this.overlayCanvas.width = Math.floor(this.cssW * this.dpr);
      this.overlayCanvas.height = Math.floor(this.cssH * this.dpr);
      this.overlayCanvas.style.width = `${this.cssW}px`;
      this.overlayCanvas.style.height = `${this.cssH}px`;
    }
  }

  private drawOverlay2D(): void {
    const ctx = this.overlayCtx;
    const snap = this.snapshot;
    if (!ctx || !snap) return;

    ctx.save();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.cssW, this.cssH);

    // Draw clean floating Paper Mario stop pills ONLY on Reachable, Selected, Hovered, or Boss nodes!
    for (const nv of this.nodeMap.values()) {
      const isAvail = snap.availableIds.has(nv.node.id);
      const isSel = snap.selectedNodeId === nv.node.id;
      const isHover = this.hoveredNodeId === nv.node.id;
      const isBoss = nv.node.type === 'boss';
      if (!isAvail && !isSel && !isHover && !isBoss) continue;

      const worldTop = nv.pos.clone().add(new THREE.Vector3(0, isBoss ? 2.15 : 1.28, 0));
      this.tmpVec3.copy(worldTop).project(this.camera);
      if (this.tmpVec3.z < -1 || this.tmpVec3.z > 1) continue;

      const sx = (this.tmpVec3.x * 0.5 + 0.5) * this.cssW;
      const sy = (-this.tmpVec3.y * 0.5 + 0.5) * this.cssH;
      if (sx < -40 || sx > this.cssW + 40 || sy < 52 || sy > this.cssH - 96) continue;

      const meta = NODE_TYPE_COLORS[nv.node.type];
      const text = isSel || isHover || isBoss ? nv.node.name : meta.label.toUpperCase();
      ctx.font = `800 ${isSel || isBoss ? 12 : 10.5}px 'Fredoka', system-ui, sans-serif`;
      const tw = ctx.measureText(text).width;
      const pw = tw + 16;
      const ph = isSel || isBoss ? 24 : 20;
      const px = Math.max(8, Math.min(this.cssW - pw - 8, sx - pw / 2));
      const py = sy - ph / 2;

      ctx.fillStyle = isSel ? '#ffe26a' : isBoss ? '#7c1c28' : '#fbf3df';
      roundRect(ctx, px, py, pw, ph, 10);
      ctx.fill();
      ctx.strokeStyle = isSel ? '#3e220f' : meta.badge;
      ctx.lineWidth = isSel ? 2.5 : 1.8;
      ctx.stroke();

      ctx.fillStyle = isBoss && !isSel ? '#fff6e0' : '#3e220f';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, px + pw / 2, sy + 0.5);
    }

    ctx.restore();
  }

  private loop = (now: number): void => {
    if (this.destroyed) return;
    this.rafId = requestAnimationFrame(this.loop);

    const dt = Math.min(0.05, Math.max(0.001, (now - this.lastTime) / 1000));
    this.lastTime = now;
    this.elapsed += dt;

    // Smoothly glide camera to desired target & zoom
    const k = 1 - Math.exp(-dt * 8);
    this.curTarget.lerp(this.targetPos, k);
    this.curDist = THREE.MathUtils.lerp(this.curDist, this.desiredDist, k);

    const horiz = Math.cos(this.camPitch) * this.curDist;
    const camX = this.curTarget.x + Math.sin(this.camYaw) * horiz;
    const camY = this.curTarget.y + Math.sin(this.camPitch) * this.curDist;
    const camZ = this.curTarget.z + Math.cos(this.camYaw) * horiz;
    this.camera.position.set(camX, camY, camZ);
    this.camera.lookAt(this.curTarget);

    // Animate node rings, beacons & spinning props
    const snap = this.snapshot;
    for (const nv of this.nodeMap.values()) {
      const isSel = snap?.selectedNodeId === nv.node.id;
      const isAvail = snap?.availableIds.has(nv.node.id) ?? false;
      const isHover = this.hoveredNodeId === nv.node.id;

      if (isSel) {
        nv.ringMat.color.set('#ffe252');
        nv.ringMat.opacity = 0.95;
        const sc = 1.08 + Math.sin(this.elapsed * 6.5) * 0.08;
        nv.ringMesh.scale.set(sc, 1, sc);
      } else if (isAvail) {
        nv.ringMat.color.set(isHover ? '#ffffff' : '#ffcf48');
        nv.ringMat.opacity = 0.72 + Math.sin(this.elapsed * 5 + nv.pos.x) * 0.22;
        const sc = 1 + Math.sin(this.elapsed * 4.5 + nv.pos.z) * 0.06;
        nv.ringMesh.scale.set(sc, 1, sc);
      } else if (isHover) {
        nv.ringMat.color.set('#fff3cc');
        nv.ringMat.opacity = 0.65;
        nv.ringMesh.scale.set(1, 1, 1);
      } else {
        nv.ringMat.opacity = 0;
      }

      if (isAvail) {
        nv.beaconMat.opacity = (isSel ? 0.24 : 0.14) + Math.sin(this.elapsed * 3.5 + nv.pos.x) * 0.05;
      } else {
        nv.beaconMat.opacity = 0;
      }

      if (nv.propSpin) {
        nv.propSpin.rotation.y = this.elapsed * 1.8;
        nv.propSpin.position.y = (nv.node.type === 'elite' ? 1.02 : 0.76) + Math.sin(this.elapsed * 3.2) * 0.07;
      }
    }

    // Animate Squad Leader & Boss standees (including lively 3-hop stepping-stone travel!)
    if (this.leaderRig) {
      this.leaderRig.root.rotation.y = this.camYaw;
      if (this.leaderHopAnim) {
        const anim = this.leaderHopAnim;
        const t = Math.min(1, (performance.now() - anim.startMs) / anim.durationMs);
        const pt = anim.curve.getPoint(t);
        this.leaderRig.root.position.copy(pt);
        // 3 lively Paper Mario trail hops along the stones!
        const hopArc = Math.abs(Math.sin(t * Math.PI * 3)) * 0.56;
        this.leaderRig.tiltGroup.position.y = hopArc;
        this.leaderRig.tiltGroup.rotation.z = Math.sin(t * Math.PI * 6) * 0.16;
        this.leaderRig.flipGroup.rotation.y = Math.sin(t * Math.PI * 3) * 0.35;
        if (t >= 1) {
          anim.resolve();
        }
      } else {
        this.leaderRig.tiltGroup.position.y = Math.abs(Math.sin(this.elapsed * 4.2)) * 0.09;
        this.leaderRig.tiltGroup.rotation.z = Math.sin(this.elapsed * 2.1) * 0.04;
      }
    }
    if (this.bossRig) {
      this.bossRig.root.rotation.y = this.camYaw;
      this.bossRig.tiltGroup.position.y = Math.abs(Math.sin(this.elapsed * 2.4)) * 0.06;
      this.bossRig.tiltGroup.rotation.z = Math.sin(this.elapsed * 1.6) * 0.03;
    }
    for (const t of this.trees) {
      t.obj.rotation.z = Math.sin(this.elapsed * 1.4 + t.phase) * 0.03;
    }
    for (const c of this.clouds) {
      c.obj.position.x = c.baseX + Math.sin(this.elapsed * 0.3 + c.phase) * 0.55;
    }

    this.renderer.render(this.scene, this.camera);
    this.drawOverlay2D();
  };

  public destroy(): void {
    this.destroyed = true;
    if (this.leaderHopAnim) {
      this.leaderHopAnim.resolve();
      this.leaderHopAnim = null;
    }
    cancelAnimationFrame(this.rafId);
    this.resizeObserver.disconnect();
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.canvas.removeEventListener('pointermove', this.onPointerMove);
    this.canvas.removeEventListener('pointerup', this.onPointerUp);
    this.canvas.removeEventListener('pointercancel', this.onPointerUp);
    this.canvas.removeEventListener('wheel', this.onWheel);
    this.clearGroup(this.worldGroup);
    this.clearGroup(this.trailGroup);
    this.clearGroup(this.nodeGroup);
    this.leaderRig?.dispose();
    this.bossRig?.dispose();
    this.textures.dispose();
    this.renderer.dispose();
  }
}
