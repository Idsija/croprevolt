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
    this.renderer.toneMappingExposure = 1.03;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#8ac4c7');
    this.scene.fog = new THREE.FogExp2('#8ac4c7', 0.009);

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
    const hemi = new THREE.HemisphereLight(0xfafefe, 0xe0d0b8, 1.12);
    this.scene.add(hemi);

    const sun = new THREE.DirectionalLight(0xfff7e4, 1.56);
    sun.position.set(8, 14, 9);
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

    const rim = new THREE.DirectionalLight(0xd4f0ff, 0.45);
    rim.position.set(-9, 6, -7);
    this.scene.add(rim);
  }

  private addInkEdges(mesh: THREE.Mesh, opacity = 0.24): void {
    const edges = new THREE.EdgesGeometry(mesh.geometry, 24);
    const lines = new THREE.LineSegments(
      edges,
      new THREE.LineBasicMaterial({ color: 0x7a5735, transparent: true, opacity })
    );
    mesh.add(lines);
  }

  private buildDiorama(): void {
    // 1. Sunlit Pale Scandinavian Birch Craft Tabletop
    const deskGeo = new THREE.PlaneGeometry(60, 60);
    deskGeo.rotateX(-Math.PI / 2);
    const desk = new THREE.Mesh(
      deskGeo,
      new THREE.MeshStandardMaterial({
        map: this.textures.woodDeskMap,
        color: '#ffffff',
        roughness: 0.82,
      })
    );
    desk.position.y = -0.78;
    desk.receiveShadow = true;
    this.root.add(desk);

    // 2. Stacked Fluted Corrugated Cardboard Island Slab (9x6 showcase stage)
    const corrMat = new THREE.MeshStandardMaterial({
      map: this.textures.corrugatedMap,
      bumpMap: this.textures.corrugatedBump,
      bumpScale: 0.055,
      roughness: 0.88,
    });
    const slabTop = new THREE.MeshStandardMaterial({
      color: '#8bb37c',
      roughness: 0.9,
      bumpMap: this.textures.paperBump,
      bumpScale: 0.015,
    });
    const slabBot = new THREE.MeshStandardMaterial({ color: '#a3784a', roughness: 0.94 });

    const slab = new THREE.Mesh(
      new THREE.BoxGeometry(11.6, 0.65, 7.6),
      [corrMat, corrMat, slabTop, slabBot, corrMat, corrMat]
    );
    slab.position.set(0, -0.45, 0);
    slab.castShadow = true;
    slab.receiveShadow = true;
    this.addInkEdges(slab, 0.22);
    this.root.add(slab);

    // 3. Flat-Faceted Mid-Century Cardstock Grid Tiles (glossy turquoise creek + corrugated bridge + stacked corrugated cliff!)
    const tileS = 1.18;
    const cliffMat = new THREE.MeshStandardMaterial({
      map: this.textures.cliffSideMap,
      bumpMap: this.textures.corrugatedBump,
      bumpScale: 0.032,
      roughness: 0.88,
    });
    const sideMat = new THREE.MeshStandardMaterial({ color: '#c89f6d', roughness: 0.9 });

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
            roughness: 0.14,
            metalness: 0.1,
            transparent: true,
            opacity: 0.92,
          });
          const wGeo = new THREE.PlaneGeometry(tileS - 0.018, tileS - 0.018);
          wGeo.rotateX(-Math.PI / 2);
          const wMesh = new THREE.Mesh(wGeo, waterMat);
          wMesh.position.set(wx, -0.08, wz);
          wMesh.receiveShadow = true;
          this.root.add(wMesh);
          this.waterMeshes.push({ mesh: wMesh, baseY: -0.08, phase: gx + gy * 1.1 });
          continue;
        }

        if (isBridge) {
          const wGeo = new THREE.PlaneGeometry(tileS - 0.018, tileS - 0.018);
          wGeo.rotateX(-Math.PI / 2);
          const wMesh = new THREE.Mesh(
            wGeo,
            new THREE.MeshStandardMaterial({
              map: this.textures.getTerrainTexture('spring', 'water', true),
              roughness: 0.16,
              transparent: true,
              opacity: 0.9,
            })
          );
          wMesh.position.set(wx, -0.09, wz);
          this.root.add(wMesh);

          // Folded Fluted Corrugated-Cardboard Bridge Deck + Low Kraft Side Guard Lips!
          const bGroup = new THREE.Group();
          bGroup.position.set(wx, 0.055, wz);
          bGroup.rotation.y = Math.PI / 2;
          const kraftMat = new THREE.MeshStandardMaterial({
            map: this.textures.corrugatedMap,
            color: '#d8b482',
            roughness: 0.88,
          });
          const deck = new THREE.Mesh(
            new THREE.BoxGeometry(tileS * 0.92, 0.09, tileS * 1.08),
            [
              kraftMat,
              kraftMat,
              new THREE.MeshStandardMaterial({
                map: this.textures.getTerrainTexture('spring', 'bridge', true),
                roughness: 0.84,
              }),
              kraftMat,
              kraftMat,
              kraftMat,
            ]
          );
          deck.castShadow = true;
          deck.receiveShadow = true;
          this.addInkEdges(deck, 0.28);
          bGroup.add(deck);
          for (const side of [-1, 1]) {
            const wall = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.18, tileS * 1.06), kraftMat);
            wall.position.set(side * 0.49, 0.12, 0);
            wall.castShadow = true;
            bGroup.add(wall);
          }
          this.root.add(bGroup);
          continue;
        }

        const terrain = gy === 0 && !isHill ? 'soil' : 'grass';
        const elev = isHill ? 0.52 : 0;
        const boxH = 0.14 + elev;
        const topMat = new THREE.MeshStandardMaterial({
          map: this.textures.getTerrainTexture('spring', terrain, checker),
          roughness: 0.86,
          bumpMap: this.textures.paperBump,
          bumpScale: 0.014,
        });
        const tile = new THREE.Mesh(
          new THREE.BoxGeometry(tileS - 0.02, boxH, tileS - 0.02),
          [isHill ? cliffMat : sideMat, isHill ? cliffMat : sideMat, topMat, sideMat, isHill ? cliffMat : sideMat, isHill ? cliffMat : sideMat]
        );
        tile.position.set(wx, elev - boxH / 2, wz);
        tile.receiveShadow = true;
        tile.castShadow = isHill;
        if (isHill) this.addInkEdges(tile, 0.24);
        this.root.add(tile);
      }
    }

    // 4. Tactile Miniature Corrugated Cover Crate, Haystack, Boulder & Coral-Red Corrugated Barn!
    const crateMat = new THREE.MeshStandardMaterial({ map: this.textures.crateMap, roughness: 0.84 });
    const crate1 = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.64, 0.78), crateMat);
    crate1.position.set(-1.18, 0.32, 1.18);
    crate1.castShadow = true;
    crate1.receiveShadow = true;
    this.addInkEdges(crate1, 0.26);
    this.root.add(crate1);

    const hayMat = new THREE.MeshStandardMaterial({ map: this.textures.haystackMap, roughness: 0.9 });
    const hay = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.46, 0.94, 12), hayMat);
    hay.position.set(1.18, 0.47, -1.18);
    hay.castShadow = true;
    hay.receiveShadow = true;
    this.root.add(hay);

    // Origami Faceted Stone Cairn on the raised corrugated hill!
    const boulderGroup = new THREE.Group();
    boulderGroup.position.set(3.55, 0.52, 0.05);
    const stoneMat = new THREE.MeshStandardMaterial({
      map: this.textures.stoneMap,
      roughness: 0.9,
      flatShading: true,
    });
    const mainRock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.46, 0), stoneMat);
    mainRock.scale.set(1.05, 0.95, 0.92);
    mainRock.position.y = 0.38;
    mainRock.castShadow = true;
    mainRock.receiveShadow = true;
    const sideRock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.24, 0), stoneMat);
    sideRock.position.set(-0.34, 0.18, 0.22);
    sideRock.castShadow = true;
    const mossCap = new THREE.Mesh(
      new THREE.CylinderGeometry(0.24, 0.3, 0.08, 8),
      new THREE.MeshStandardMaterial({ color: '#5fa858', roughness: 0.88 })
    );
    mossCap.position.set(0.05, 0.78, 0.02);
    mossCap.rotation.z = -0.15;
    boulderGroup.add(mainRock, sideRock, mossCap);
    this.root.add(boulderGroup);

    // Folded Coral-Red Corrugated Cardboard Barn + Mustard Roof + Silo!
    const barn = new THREE.Group();
    barn.position.set(-4.6, -0.05, -3.7);
    barn.rotation.y = 0.25;
    const barnBody = new THREE.Mesh(
      new THREE.BoxGeometry(2.3, 1.65, 1.75),
      new THREE.MeshStandardMaterial({
        map: this.textures.barnWallMap,
        roughness: 0.85,
        bumpMap: this.textures.corrugatedBump,
        bumpScale: 0.025,
      })
    );
    barnBody.position.y = 0.82;
    barnBody.castShadow = true;
    barnBody.receiveShadow = true;
    this.addInkEdges(barnBody, 0.22);
    const roof = new THREE.Mesh(
      new THREE.ConeGeometry(1.78, 1.08, 4),
      new THREE.MeshStandardMaterial({
        map: this.textures.barnRoofMap,
        roughness: 0.88,
        bumpMap: this.textures.corrugatedBump,
        bumpScale: 0.025,
      })
    );
    roof.rotation.y = Math.PI / 4;
    roof.position.y = 2.16;
    roof.castShadow = true;
    this.addInkEdges(roof, 0.22);

    const door = new THREE.Mesh(
      new THREE.BoxGeometry(0.74, 0.82, 0.08),
      new THREE.MeshStandardMaterial({ map: this.textures.fenceWoodMap, color: '#fbf4e4', roughness: 0.84 })
    );
    door.position.set(0, 0.42, 0.88);
    const loft = new THREE.Mesh(
      new THREE.BoxGeometry(0.46, 0.36, 0.08),
      new THREE.MeshStandardMaterial({ color: '#382418', roughness: 0.9 })
    );
    loft.position.set(0, 1.24, 0.88);

    const silo = new THREE.Mesh(
      new THREE.CylinderGeometry(0.42, 0.44, 1.95, 16),
      new THREE.MeshStandardMaterial({ map: this.textures.barnWallMap, roughness: 0.86 })
    );
    silo.position.set(-1.38, 0.97, -0.15);
    silo.castShadow = true;
    const siloDome = new THREE.Mesh(
      new THREE.SphereGeometry(0.43, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.55),
      new THREE.MeshStandardMaterial({ map: this.textures.barnRoofMap, roughness: 0.84 })
    );
    siloDome.position.set(-1.38, 1.94, -0.15);
    siloDome.castShadow = true;
    barn.add(barnBody, roof, door, loft, silo, siloDome);
    this.root.add(barn);

    // 5. Swaying Mid-Century Scissor-Cut Paper Trees on Turned Birch Dowels!
    const treePositions = [
      [-5.6, -1.2, 1.12],
      [-5.1, 2.5, 0.94],
      [5.5, -2.1, 1.15],
      [5.6, 2.0, 0.98],
      [1.4, -3.9, 1.08],
    ];
    const barkMat = new THREE.MeshStandardMaterial({
      map: this.textures.treeBarkMap,
      roughness: 0.78,
    });
    const greenFoliageMat = new THREE.MeshStandardMaterial({
      map: this.textures.getTreeFoliageTexture('spring_green'),
      roughness: 0.86,
      bumpMap: this.textures.paperBump,
      bumpScale: 0.012,
    });
    const blossomFoliageMat = new THREE.MeshStandardMaterial({
      map: this.textures.getTreeFoliageTexture('spring_blossom'),
      roughness: 0.86,
      bumpMap: this.textures.paperBump,
      bumpScale: 0.012,
    });

    const leafShape = new THREE.Shape();
    leafShape.moveTo(-0.34, 0.05);
    leafShape.bezierCurveTo(-0.88, 0.12, -0.92, 0.72, -0.46, 0.94);
    leafShape.bezierCurveTo(-0.42, 1.38, 0.42, 1.38, 0.46, 0.94);
    leafShape.bezierCurveTo(0.92, 0.72, 0.88, 0.12, 0.34, 0.05);
    leafShape.quadraticCurveTo(0, -0.05, -0.34, 0.05);
    const bladeGeo = new THREE.ExtrudeGeometry(leafShape, { depth: 0.075, bevelEnabled: false });
    bladeGeo.translate(0, 0, -0.0375);
    const pAttr = bladeGeo.attributes.position;
    const uAttr = bladeGeo.attributes.uv;
    for (let k = 0; k < pAttr.count; k++) {
      uAttr.setXY(k, (pAttr.getX(k) + 0.95) / 1.9, 1 - Math.max(0, Math.min(1, pAttr.getY(k) / 1.4)));
    }
    uAttr.needsUpdate = true;

    for (let i = 0; i < treePositions.length; i++) {
      const [tx, tz, sc] = treePositions[i];
      const tree = new THREE.Group();
      tree.position.set(tx, -0.1, tz);
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.095, 0.125, 1.05, 12), barkMat);
      trunk.position.y = 0.52;
      trunk.castShadow = true;
      tree.add(trunk);

      const fMat = i % 2 === 1 ? blossomFoliageMat : greenFoliageMat;
      if (i % 2 === 1) {
        for (let f = 0; f < 3; f++) {
          const blade = new THREE.Mesh(bladeGeo, fMat);
          blade.position.y = 0.94;
          blade.rotation.y = (f * Math.PI) / 3 + i * 0.4;
          blade.castShadow = true;
          blade.receiveShadow = true;
          tree.add(blade);
        }
      } else {
        for (const [ty, tr, th] of [
          [1.22, 0.78, 0.62],
          [1.68, 0.62, 0.54],
          [2.08, 0.42, 0.46],
        ]) {
          const cone = new THREE.Mesh(new THREE.ConeGeometry(tr, th, 8), fMat);
          cone.position.y = ty;
          cone.castShadow = true;
          tree.add(cone);
        }
      }
      tree.scale.setScalar(sc);
      this.root.add(tree);
      this.trees.push({ obj: tree, phase: i * 1.3 });
    }

    // 6. Floating Scissor-Cut Cream Paper Clouds on thin craft wires
    const cloudMat = new THREE.MeshStandardMaterial({
      map: this.textures.cloudMap,
      roughness: 0.88,
      bumpMap: this.textures.paperBump,
      bumpScale: 0.008,
    });
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
        const disc = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.12, 16), cloudMat);
        disc.rotation.x = Math.PI / 2;
        disc.position.set(ox, oy, 0);
        g.add(disc);
      }
      g.position.set(cx, cy, cz);
      g.scale.setScalar(sc);
      this.root.add(g);
      this.clouds.push({ obj: g, baseX: cx, phase: i * 1.9 });
    }

    // 7. Sculpted Matte Clay Starter Heroes (with Papercraft Weapons!) facing off against Wood/Cardboard Foes!
    const roster: Array<{
      kind: string;
      team: 'player' | 'enemy';
      x: number;
      y: number;
      z: number;
      boss?: boolean;
      weapon?: 'blaster' | 'bow' | 'duster' | 'hammer' | 'sniper' | 'mortar';
    }> = [
      { kind: 'cow', team: 'player', x: -1.18, y: 0, z: 0.0, weapon: 'hammer' },
      { kind: 'pea', team: 'player', x: -2.36, y: 0, z: 0.92, weapon: 'bow' },
      { kind: 'lemon', team: 'player', x: -3.5, y: 0, z: -0.82, weapon: 'mortar' },
      { kind: 'rooster', team: 'player', x: -3.5, y: 0, z: 0.45, weapon: 'duster' },
      { kind: 'barrow', team: 'enemy', x: 2.36, y: 0.52, z: -0.02 },
      { kind: 'digger', team: 'enemy', x: 1.38, y: 0, z: 1.18 },
      { kind: 'scarecrow', team: 'enemy', x: 3.55, y: 0.52, z: -1.1, boss: true },
    ];

    roster.forEach((item, idx) => {
      const rig = createPaperStandeeRig(item.kind, item.team, Boolean(item.boss), this.textures);
      if (item.weapon && rig.equippedWeapon) {
        rig.equippedWeapon.setWeapon(item.weapon, 1, undefined, false);
      }
      rig.root.position.set(item.x, item.y, item.z);
      this.root.add(rig.root);
      this.standees.push({ rig, phase: idx * 0.95, baseY: item.y });
    });
  }

  private resize(): void {
    const parent = this.canvas.parentElement ?? this.canvas;
    const w = Math.max(260, Math.floor(parent.clientWidth || window.innerWidth));
    const h = Math.max(200, Math.floor(parent.clientHeight || window.innerHeight));
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
