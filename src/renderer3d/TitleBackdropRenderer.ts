import * as THREE from 'three';
import {
  CraftTextureLibrary,
  createPaperStandeeRig,
  type PaperStandeeRig,
} from './textures';

/**
 * Live Animated 3D Paper Mario Title Diorama!
 * Renders a gently orbiting miniature corrugated-cardboard garden island with
 * a raised cliff, timber ramp, bubbling creek + wooden bridge, barn, swaying trees,
 * floating clouds on craft wires, and Paper Mario standees facing off across the bridge.
 */
export class TitleBackdropRenderer {
  private canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private textures: CraftTextureLibrary;
  private root = new THREE.Group();

  private standees: Array<{ rig: PaperStandeeRig; phase: number; baseY: number }> = [];
  private trees: Array<{ obj: THREE.Object3D; phase: number }> = [];
  private clouds: Array<{ obj: THREE.Object3D; baseX: number; phase: number }> = [];
  private waterMeshes: Array<{ mesh: THREE.Mesh; baseY: number; phase: number }> = [];

  private rafId = 0;
  private lastTime = 0;
  private elapsed = 0;
  private resizeObserver: ResizeObserver;
  private destroyed = false;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
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
    this.scene.background = new THREE.Color('#704726');
    this.scene.fog = new THREE.FogExp2('#704726', 0.024);

    this.camera = new THREE.PerspectiveCamera(36, 16 / 9, 0.2, 90);
    this.textures = new CraftTextureLibrary();

    this.scene.add(this.root);
    this.setupLights();
    this.buildDiorama();
    this.resize();

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas.parentElement ?? canvas);

    this.lastTime = performance.now();
    this.rafId = requestAnimationFrame(this.loop);
  }

  private setupLights(): void {
    const hemi = new THREE.HemisphereLight(0xfff7e0, 0x8f6138, 1.0);
    this.scene.add(hemi);

    const sun = new THREE.DirectionalLight(0xfff0c8, 1.55);
    sun.position.set(8, 13, 9);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.near = 2;
    sun.shadow.camera.far = 36;
    const d = 10;
    sun.shadow.camera.left = -d;
    sun.shadow.camera.right = d;
    sun.shadow.camera.top = d;
    sun.shadow.camera.bottom = -d;
    sun.shadow.bias = -0.0006;
    this.scene.add(sun);

    const rim = new THREE.DirectionalLight(0xbfe2ff, 0.45);
    rim.position.set(-9, 6, -7);
    this.scene.add(rim);
  }

  private addInkEdges(mesh: THREE.Mesh, opacity = 0.55): void {
    const edges = new THREE.EdgesGeometry(mesh.geometry, 22);
    const lines = new THREE.LineSegments(
      edges,
      new THREE.LineBasicMaterial({ color: 0x3e2210, transparent: true, opacity })
    );
    mesh.add(lines);
  }

  private buildDiorama(): void {
    // 1. Oak tabletop surface
    const deskGeo = new THREE.PlaneGeometry(60, 60);
    deskGeo.rotateX(-Math.PI / 2);
    const desk = new THREE.Mesh(
      deskGeo,
      new THREE.MeshStandardMaterial({
        map: this.textures.woodDeskMap,
        color: '#c49664',
        roughness: 0.88,
      })
    );
    desk.position.y = -0.78;
    desk.receiveShadow = true;
    this.root.add(desk);

    // 2. Corrugated Cardboard Island Slab (9x6 miniature showcase stage)
    const corrMat = new THREE.MeshStandardMaterial({
      map: this.textures.corrugatedMap,
      bumpMap: this.textures.corrugatedBump,
      bumpScale: 0.06,
      roughness: 0.9,
    });
    const slabTop = new THREE.MeshStandardMaterial({
      color: '#7da840',
      roughness: 0.9,
      bumpMap: this.textures.paperBump,
      bumpScale: 0.02,
    });
    const slabBot = new THREE.MeshStandardMaterial({ color: '#6b4220', roughness: 0.95 });

    const slab = new THREE.Mesh(
      new THREE.BoxGeometry(11.6, 0.65, 7.6),
      [corrMat, corrMat, slabTop, slabBot, corrMat, corrMat]
    );
    slab.position.set(0, -0.45, 0);
    slab.castShadow = true;
    slab.receiveShadow = true;
    this.addInkEdges(slab, 0.55);
    this.root.add(slab);

    // 3. Textured Patch Grid Tiles (including a central bubbling creek + wooden bridge + raised hill!)
    const tileS = 1.18;
    const cliffMat = new THREE.MeshStandardMaterial({
      map: this.textures.cliffSideMap,
      bumpMap: this.textures.paperBump,
      bumpScale: 0.02,
      roughness: 0.9,
    });
    const sideMat = new THREE.MeshStandardMaterial({ color: '#8a5d34', roughness: 0.92 });

    for (let gy = -2; gy <= 2; gy++) {
      for (let gx = -4; gx <= 4; gx++) {
        const wx = gx * tileS;
        const wz = gy * tileS;
        const checker = (gx + gy) % 2 === 0;
        const isRiver = gx === 0;
        const isBridge = gx === 0 && gy === 0;
        const isHill = gx >= 2 && gy <= 0;

        if (isRiver && !isBridge) {
          const waterMat = new THREE.MeshStandardMaterial({
            map: this.textures.getTerrainTexture('spring', 'water', checker),
            roughness: 0.16,
            metalness: 0.14,
            transparent: true,
            opacity: 0.9,
          });
          const wGeo = new THREE.PlaneGeometry(tileS - 0.02, tileS - 0.02);
          wGeo.rotateX(-Math.PI / 2);
          const wMesh = new THREE.Mesh(wGeo, waterMat);
          wMesh.position.set(wx, -0.08, wz);
          wMesh.receiveShadow = true;
          this.root.add(wMesh);
          this.waterMeshes.push({ mesh: wMesh, baseY: -0.08, phase: gx + gy * 1.1 });
          continue;
        }

        if (isBridge) {
          // Water underneath
          const wGeo = new THREE.PlaneGeometry(tileS - 0.02, tileS - 0.02);
          wGeo.rotateX(-Math.PI / 2);
          const wMesh = new THREE.Mesh(
            wGeo,
            new THREE.MeshStandardMaterial({
              map: this.textures.getTerrainTexture('spring', 'water', true),
              roughness: 0.18,
              transparent: true,
              opacity: 0.88,
            })
          );
          wMesh.position.set(wx, -0.09, wz);
          this.root.add(wMesh);

          // Wooden bridge deck + side handrails
          const bGroup = new THREE.Group();
          bGroup.position.set(wx, 0.05, wz);
          bGroup.rotation.y = Math.PI / 2;
          const beamMat = new THREE.MeshStandardMaterial({ color: '#7a4822', roughness: 0.86 });
          const deck = new THREE.Mesh(
            new THREE.BoxGeometry(tileS * 0.92, 0.09, tileS * 1.06),
            [
              beamMat,
              beamMat,
              new THREE.MeshStandardMaterial({
                map: this.textures.getTerrainTexture('spring', 'bridge', true),
                roughness: 0.84,
              }),
              beamMat,
              beamMat,
              beamMat,
            ]
          );
          deck.castShadow = true;
          deck.receiveShadow = true;
          this.addInkEdges(deck, 0.6);
          bGroup.add(deck);
          for (const side of [-1, 1]) {
            const rail = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.055, tileS * 1.04), beamMat);
            rail.position.set(side * 0.48, 0.28, 0);
            bGroup.add(rail);
            for (const pz of [-0.44, 0.44]) {
              const post = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.34, 0.075), beamMat);
              post.position.set(side * 0.48, 0.15, pz);
              bGroup.add(post);
            }
          }
          this.root.add(bGroup);
          continue;
        }

        const terrain = gy === 0 && !isHill ? 'soil' : 'grass';
        const elev = isHill ? 0.52 : 0;
        const boxH = 0.14 + elev;
        const topMat = new THREE.MeshStandardMaterial({
          map: this.textures.getTerrainTexture('spring', terrain, checker),
          roughness: 0.88,
          bumpMap: this.textures.paperBump,
          bumpScale: 0.018,
        });
        const tile = new THREE.Mesh(
          new THREE.BoxGeometry(tileS - 0.025, boxH, tileS - 0.025),
          [isHill ? cliffMat : sideMat, isHill ? cliffMat : sideMat, topMat, sideMat, isHill ? cliffMat : sideMat, isHill ? cliffMat : sideMat]
        );
        tile.position.set(wx, elev - boxH / 2, wz);
        tile.receiveShadow = true;
        tile.castShadow = isHill;
        if (isHill) this.addInkEdges(tile, 0.48);
        this.root.add(tile);
      }
    }

    // 4. Tactile 3D Props (Crates, Haystack, Beehive, Red Mini-Barn!)
    const crateMat = new THREE.MeshStandardMaterial({ map: this.textures.crateMap, roughness: 0.85 });
    const crate1 = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.64, 0.78), crateMat);
    crate1.position.set(-1.18, 0.32, 1.18);
    crate1.castShadow = true;
    crate1.receiveShadow = true;
    this.addInkEdges(crate1);
    this.root.add(crate1);

    const hayMat = new THREE.MeshStandardMaterial({ map: this.textures.haystackMap, roughness: 0.92 });
    const hay = new THREE.Mesh(new THREE.BoxGeometry(0.95, 1.05, 0.95), hayMat);
    hay.position.set(1.18, 0.52, -1.18);
    hay.castShadow = true;
    hay.receiveShadow = true;
    this.addInkEdges(hay);
    this.root.add(hay);

    // Classic Red Paper Barn in the back-left corner
    const barn = new THREE.Group();
    barn.position.set(-4.6, -0.05, -3.7);
    barn.rotation.y = 0.25;
    const barnBody = new THREE.Mesh(
      new THREE.BoxGeometry(2.3, 1.65, 1.75),
      new THREE.MeshStandardMaterial({ color: '#c44536', roughness: 0.86 })
    );
    barnBody.position.y = 0.82;
    barnBody.castShadow = true;
    this.addInkEdges(barnBody);
    const roof = new THREE.Mesh(
      new THREE.ConeGeometry(1.72, 1.05, 4),
      new THREE.MeshStandardMaterial({ color: '#6b3e24', roughness: 0.9 })
    );
    roof.rotation.y = Math.PI / 4;
    roof.position.y = 2.15;
    roof.castShadow = true;
    this.addInkEdges(roof);
    barn.add(barnBody, roof);
    this.root.add(barn);

    // 5. Swaying Folded-Paper Trees around perimeter
    const treePositions = [
      [-5.6, -1.2, 1.1],
      [-5.1, 2.5, 0.9],
      [5.5, -2.1, 1.15],
      [5.6, 2.0, 0.95],
      [1.4, -3.9, 1.05],
    ];
    for (let i = 0; i < treePositions.length; i++) {
      const [tx, tz, sc] = treePositions[i];
      const tree = new THREE.Group();
      tree.position.set(tx, -0.1, tz);
      const trunk = new THREE.Mesh(
        new THREE.CylinderGeometry(0.11, 0.15, 0.95, 6),
        new THREE.MeshStandardMaterial({ color: '#7d4d27', roughness: 0.9 })
      );
      trunk.position.y = 0.45;
      trunk.castShadow = true;
      const foliage = new THREE.Mesh(
        new THREE.ConeGeometry(0.72, 1.55, 6),
        new THREE.MeshStandardMaterial({
          color: i % 2 === 0 ? '#5c9c38' : '#77b546',
          roughness: 0.86,
          flatShading: true,
        })
      );
      foliage.position.y = 1.45;
      foliage.castShadow = true;
      this.addInkEdges(foliage, 0.35);
      tree.add(trunk, foliage);
      tree.scale.setScalar(sc);
      this.root.add(tree);
      this.trees.push({ obj: tree, phase: i * 1.3 });
    }

    // 6. Floating Paper Clouds on thin craft wires
    const cloudMat = new THREE.MeshStandardMaterial({ color: '#fffbf0', roughness: 0.92 });
    const cloudConfigs = [
      [-3.8, 3.6, -4.6, 1.05],
      [2.6, 4.0, -5.0, 1.2],
      [0.1, 3.3, -4.4, 0.82],
    ];
    for (let i = 0; i < cloudConfigs.length; i++) {
      const [cx, cy, cz, sc] = cloudConfigs[i];
      const g = new THREE.Group();
      for (const [ox, oy, r] of [
        [0, 0.12, 0.48],
        [-0.4, 0, 0.35],
        [0.42, -0.02, 0.33],
      ]) {
        const disc = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.12, 12), cloudMat);
        disc.rotation.x = Math.PI / 2;
        disc.position.set(ox, oy, 0);
        g.add(disc);
      }
      g.position.set(cx, cy, cz);
      g.scale.setScalar(sc);
      this.root.add(g);
      this.clouds.push({ obj: g, baseX: cx, phase: i * 1.9 });
    }

    // 7. Hero & Farmer Paper Mario Cardstock Standees facing off across the wooden bridge!
    const roster: Array<{
      kind: string;
      team: 'player' | 'enemy';
      x: number;
      y: number;
      z: number;
      boss?: boolean;
    }> = [
      { kind: 'cow', team: 'player', x: -1.2, y: 0, z: 0.0 },
      { kind: 'lettuce', team: 'player', x: -2.4, y: 0, z: 0.7 },
      { kind: 'pea', team: 'player', x: -2.5, y: 0, z: -1.1 },
      { kind: 'lemon', team: 'player', x: -3.5, y: 0, z: 0.1 },
      { kind: 'digger', team: 'enemy', x: 1.3, y: 0, z: 0.9 },
      { kind: 'trimmer', team: 'enemy', x: 2.35, y: 0.52, z: -0.05 },
      { kind: 'scarecrow', team: 'enemy', x: 3.55, y: 0.52, z: -1.1, boss: true },
    ];

    roster.forEach((item, idx) => {
      const rig = createPaperStandeeRig(item.kind, item.team, Boolean(item.boss), this.textures);
      rig.root.position.set(item.x, item.y, item.z);
      this.root.add(rig.root);
      this.standees.push({ rig, phase: idx * 0.95, baseY: item.y });
    });
  }

  private resize(): void {
    const parent = this.canvas.parentElement ?? this.canvas;
    const rect = parent.getBoundingClientRect();
    const w = Math.max(260, Math.floor(rect.width || window.innerWidth));
    const h = Math.max(200, Math.floor(rect.height || window.innerHeight));
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private loop = (now: number): void => {
    if (this.destroyed) return;
    this.rafId = requestAnimationFrame(this.loop);

    const dt = Math.min(0.05, Math.max(0.001, (now - this.lastTime) / 1000));
    this.lastTime = now;
    this.elapsed += dt;

    // Gentle scenic camera sway around the Paper Mario diorama!
    const yaw = Math.sin(this.elapsed * 0.22) * 0.34;
    const dist = this.camera.aspect < 0.85 ? 16.5 : 12.8;
    const camY = 6.2 + Math.sin(this.elapsed * 0.35) * 0.35;
    this.camera.position.set(Math.sin(yaw) * dist, camY, Math.cos(yaw) * dist);
    this.camera.lookAt(0, 0.45, -0.3);

    // Billboard standees to camera + joyful idle bounce!
    for (const s of this.standees) {
      s.rig.root.rotation.y = yaw;
      const bounce = Math.abs(Math.sin(this.elapsed * 2.8 + s.phase)) * 0.065;
      s.rig.tiltGroup.position.y = bounce;
      s.rig.tiltGroup.rotation.z = Math.sin(this.elapsed * 1.4 + s.phase) * 0.032;
    }

    for (const t of this.trees) {
      t.obj.rotation.z = Math.sin(this.elapsed * 1.5 + t.phase) * 0.035;
    }

    for (const c of this.clouds) {
      c.obj.position.x = c.baseX + Math.sin(this.elapsed * 0.35 + c.phase) * 0.6;
    }

    for (const w of this.waterMeshes) {
      w.mesh.position.y = w.baseY + Math.sin(this.elapsed * 2.4 + w.phase) * 0.015;
    }

    this.renderer.render(this.scene, this.camera);
  };

  public destroy(): void {
    this.destroyed = true;
    cancelAnimationFrame(this.rafId);
    this.resizeObserver.disconnect();
    for (const s of this.standees) s.rig.dispose();
    this.root.traverse((child) => {
      const m = child as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      if (m.material) {
        if (Array.isArray(m.material)) m.material.forEach((mat) => mat.dispose());
        else m.material.dispose();
      }
    });
    this.textures.dispose();
    this.renderer.dispose();
  }
}
