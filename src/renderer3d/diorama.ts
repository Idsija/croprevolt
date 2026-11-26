import * as THREE from 'three';
import type { BattleState, BoardTheme, CoverKind, CoverObject, GridPos, TerrainType } from '../engine/types';
import { posKey } from '../engine/grid';
import type { CraftTextureLibrary } from './textures';
import { gridToWorld3D, TILE_SIZE_3D } from './types';

export interface CoverPropVisual {
  key: string;
  pos: GridPos;
  kind: Exclude<CoverKind, 'none'>;
  group: THREE.Group;
  hp: number;
  maxHp: number;
  height: number;
  isObjectiveCage: boolean;
  /** Animated child parts (orbiting bees, spinning sprinkler arm, cage wiggle) */
  bees?: THREE.Group;
  spinner?: THREE.Object3D;
  crateMesh?: THREE.Mesh;
  dispose: () => void;
}

export interface AnimatedDioramaPart {
  update: (time: number, dt: number) => void;
}

export const ELEVATION_STEP_3D = 0.52;

const TERRAIN_Y_OFFSET: Record<TerrainType, number> = {
  grass: 0,
  soil: -0.016,
  mud: -0.045,
  compost: 0.032,
  barn_floor: 0.016,
  gate: 0.022,
  sunbeam: 0.01,
  water: -0.105,
  bridge: 0.055,
  lava: -0.095,
  ramp: 0.22,
};

export function getTerrainSurfaceY(terrain: TerrainType): number {
  return TERRAIN_Y_OFFSET[terrain] ?? 0;
}

export function getTileSurfaceY(tile: { terrain: TerrainType; elevation?: number }): number {
  return (tile.elevation ?? 0) * ELEVATION_STEP_3D + getTerrainSurfaceY(tile.terrain);
}

function addInkEdges(mesh: THREE.Mesh, color = 0x452a16, opacity = 0.65, thresholdAngle = 22): THREE.LineSegments {
  const edges = new THREE.EdgesGeometry(mesh.geometry, thresholdAngle);
  const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity });
  const lines = new THREE.LineSegments(edges, mat);
  mesh.add(lines);
  return lines;
}

function disposeObjectTree(obj: THREE.Object3D): void {
  obj.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    if (mesh.material) {
      if (Array.isArray(mesh.material)) {
        mesh.material.forEach((m) => m.dispose());
      } else {
        mesh.material.dispose();
      }
    }
  });
}

export class PaperDioramaWorld {
  public readonly root = new THREE.Group();
  public readonly tilePickMeshes: THREE.Mesh[] = [];
  public readonly coverPickMeshes: THREE.Mesh[] = [];

  private boardGroup = new THREE.Group();
  private coverGroup = new THREE.Group();
  private sceneryGroup = new THREE.Group();
  private coverMap = new Map<string, CoverPropVisual>();
  private animatedParts: AnimatedDioramaPart[] = [];
  private textures: CraftTextureLibrary;

  private builtBoardSignature = '';

  constructor(textures: CraftTextureLibrary) {
    this.textures = textures;
    this.root.add(this.boardGroup);
    this.root.add(this.sceneryGroup);
    this.root.add(this.coverGroup);
    this.buildDeskSurface();
  }

  private buildDeskSurface(): void {
    const deskGeo = new THREE.PlaneGeometry(84, 84);
    deskGeo.rotateX(-Math.PI / 2);
    const deskMat = new THREE.MeshStandardMaterial({
      map: this.textures.woodDeskMap,
      color: new THREE.Color('#c89c6d'),
      roughness: 0.88,
      metalness: 0.04,
    });
    const desk = new THREE.Mesh(deskGeo, deskMat);
    desk.position.y = -0.78;
    desk.receiveShadow = true;
    desk.name = 'wood_desk';
    this.root.add(desk);
  }

  public syncBattle(battle: BattleState): void {
    const theme: BoardTheme = battle.theme ?? 'spring';
    const terrainSig = battle.tiles
      .map((row) => row.map((t) => `${t.terrain[0]}${t.elevation ?? 0}`).join(''))
      .join('/');
    const sig = `${battle.mapId}|${theme}|${battle.width}x${battle.height}|${terrainSig}`;

    if (sig !== this.builtBoardSignature) {
      this.rebuildBoardAndScenery(battle, theme);
      this.builtBoardSignature = sig;
    }

    this.syncCovers(battle);
  }

  private rebuildBoardAndScenery(battle: BattleState, theme: BoardTheme): void {
    this.clearGroup(this.boardGroup);
    this.clearGroup(this.sceneryGroup);
    this.tilePickMeshes.length = 0;
    this.animatedParts.length = 0;

    const boardW = battle.width * TILE_SIZE_3D;
    const boardH = battle.height * TILE_SIZE_3D;
    const pad = 0.66;
    const slabH = 0.62;

    // 1. Thick Corrugated Cardboard Diorama Slab (sits cleanly beneath deepest water/lava channels!)
    const sideCorrMat = new THREE.MeshStandardMaterial({
      map: this.textures.corrugatedMap,
      bumpMap: this.textures.corrugatedBump,
      bumpScale: 0.06,
      roughness: 0.9,
      metalness: 0.02,
    });
    const topMatColor =
      theme === 'autumn' ? '#ad8838' : theme === 'greenhouse' ? '#6b9d44' : '#7ea53e';
    const topSlabMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(topMatColor),
      roughness: 0.92,
      bumpMap: this.textures.paperBump,
      bumpScale: 0.02,
    });
    const bottomSlabMat = new THREE.MeshStandardMaterial({
      color: '#6b4220',
      roughness: 0.96,
    });

    const slabGeo = new THREE.BoxGeometry(boardW + pad, slabH, boardH + pad);
    const slab = new THREE.Mesh(slabGeo, [
      sideCorrMat,
      sideCorrMat,
      topSlabMat,
      bottomSlabMat,
      sideCorrMat,
      sideCorrMat,
    ]);
    slab.position.set(0, -slabH / 2 - 0.16, 0);
    slab.castShadow = true;
    slab.receiveShadow = true;
    addInkEdges(slab, 0x452a16, 0.55);
    this.boardGroup.add(slab);

    // Cream cardstock border lip framing the playable grid cleanly beneath recessed water/lava
    const lipGeo = new THREE.BoxGeometry(boardW + 0.18, 0.04, boardH + 0.18);
    const lipMat = new THREE.MeshStandardMaterial({
      color: '#efe2c2',
      roughness: 0.88,
      bumpMap: this.textures.paperBump,
      bumpScale: 0.01,
    });
    const lip = new THREE.Mesh(lipGeo, lipMat);
    lip.position.set(0, -0.155, 0);
    lip.receiveShadow = true;
    addInkEdges(lip, 0x5c391e, 0.45);
    this.boardGroup.add(lip);

    // 2. Individual 3D Terrain Tiles with Full Multi-Elevation Terraces, Ramps, Water, Bridges & Lava!
    const tileFootprint = TILE_SIZE_3D - 0.022;
    const baseTileH = 0.14;
    const sideTileMat = new THREE.MeshStandardMaterial({
      color: '#8f6237',
      roughness: 0.92,
    });
    const cliffSideMat = new THREE.MeshStandardMaterial({
      map: this.textures.cliffSideMap,
      bumpMap: this.textures.paperBump,
      bumpScale: 0.025,
      roughness: 0.9,
    });

    const waterSurfaces: Array<{ mesh: THREE.Mesh; baseY: number; phase: number }> = [];
    const lavaMats: Array<{ mat: THREE.MeshStandardMaterial; phase: number }> = [];

    for (let y = 0; y < battle.height; y++) {
      for (let x = 0; x < battle.width; x++) {
        const tile = battle.tiles[y][x];
        const elev = tile.elevation ?? 0;
        const checker = (x + y) % 2 === 0;
        const wp = gridToWorld3D(x, y, battle.width, battle.height, 0);
        const surfaceY = getTileSurfaceY(tile);

        if (tile.terrain === 'ramp') {
          this.buildRampTile(battle, x, y, elev, wp, checker, theme, cliffSideMat);
          continue;
        }

        if (tile.terrain === 'water') {
          this.buildWaterTile(x, y, elev, wp, surfaceY, checker, theme, waterSurfaces);
          continue;
        }

        if (tile.terrain === 'lava') {
          this.buildLavaTile(x, y, elev, wp, surfaceY, checker, theme, lavaMats);
          continue;
        }

        if (tile.terrain === 'bridge') {
          this.buildBridgeTile(battle, x, y, elev, wp, surfaceY, checker, theme, waterSurfaces, lavaMats);
          continue;
        }

        // Standard or Elevated Terraced Block (grass, soil, mud, compost, barn_floor, gate, sunbeam)
        const tex = this.textures.getTerrainTexture(theme, tile.terrain, checker);
        const topMat = new THREE.MeshStandardMaterial({
          map: tex,
          roughness: tile.terrain === 'mud' ? 0.34 : 0.88,
          metalness: tile.terrain === 'mud' ? 0.08 : 0.02,
          bumpMap: this.textures.paperBump,
          bumpScale: tile.terrain === 'mud' ? 0.005 : 0.018,
        });

        const bottomY = -0.14;
        const boxH = Math.max(baseTileH, surfaceY - bottomY);
        const geo = new THREE.BoxGeometry(tileFootprint, boxH, tileFootprint);
        const wallMat = elev > 0 ? cliffSideMat : sideTileMat;

        const mesh = new THREE.Mesh(geo, [
          wallMat,
          wallMat,
          topMat,
          sideTileMat,
          wallMat,
          wallMat,
        ]);
        mesh.position.set(wp.x, surfaceY - boxH / 2, wp.z);
        mesh.receiveShadow = true;
        mesh.castShadow = elev > 0;
        mesh.userData.gridPos = { x, y };
        if (elev > 0) {
          addInkEdges(mesh, 0x3e220f, 0.52);
        }
        this.boardGroup.add(mesh);
        this.tilePickMeshes.push(mesh);

        // Decorative micro 3D paper tufts on empty grass/compost/sunbeam tiles
        if (tile.terrain === 'compost') {
          this.addCompostSprout(wp.x, surfaceY, wp.z, x * 7 + y * 13);
        } else if (tile.terrain === 'sunbeam') {
          this.addSunbeamShaft(wp.x, surfaceY, wp.z);
        } else if (tile.terrain === 'grass' && (x * 13 + y * 29) % 5 === 0) {
          this.addTinyGrassTuft(wp.x, surfaceY, wp.z, theme, x * 17 + y * 31);
        }
      }
    }

    if (waterSurfaces.length > 0 || lavaMats.length > 0) {
      this.animatedParts.push({
        update: (time) => {
          for (const w of waterSurfaces) {
            w.mesh.position.y = w.baseY + Math.sin(time * 2.4 + w.phase) * 0.014;
          }
          for (const l of lavaMats) {
            l.mat.emissiveIntensity = 0.72 + Math.sin(time * 3.1 + l.phase) * 0.28;
          }
        },
      });
    }

    // 3. Garden Gate Archway for Reach-Gate Maps
    if (battle.gateTiles.length > 0) {
      this.buildGateArchway(battle);
    }

    // 4. Multi-Plane Paper Mario Diorama Scenery (Fences, Layered Hills, Trees, Barn/Greenhouse, Clouds!)
    this.buildPerimeterFences(boardW, boardH, theme);
    this.buildStageBackdrop(boardW, boardH, theme);
  }

  private buildRampTile(
    battle: BattleState,
    x: number,
    y: number,
    elev: number,
    wp: { x: number; y: number; z: number },
    checker: boolean,
    theme: BoardTheme,
    cliffSideMat: THREE.MeshStandardMaterial
  ): void {
    const s = TILE_SIZE_3D - 0.022;
    const lowY = elev * ELEVATION_STEP_3D;
    const rise = ELEVATION_STEP_3D;
    const baseBottom = -0.14;

    // Determine which cardinal direction climbs uphill (+1 elevation neighbor)
    const dirs = [
      { dx: 0, dy: -1, rotY: 0 }, // Climbs North (-Z)
      { dx: 1, dy: 0, rotY: -Math.PI / 2 }, // Climbs East (+X)
      { dx: 0, dy: 1, rotY: Math.PI }, // Climbs South (+Z)
      { dx: -1, dy: 0, rotY: Math.PI / 2 }, // Climbs West (-X)
    ];
    let rotY = 0;
    for (const d of dirs) {
      const nx = x + d.dx;
      const ny = y + d.dy;
      if (nx >= 0 && ny >= 0 && nx < battle.width && ny < battle.height) {
        if ((battle.tiles[ny][nx].elevation ?? 0) > elev) {
          rotY = d.rotY;
          break;
        }
      }
    }

    const rampGroup = new THREE.Group();
    rampGroup.position.set(wp.x, 0, wp.z);
    rampGroup.rotation.y = rotY;

    // Solid base pedestal beneath ramp (from -0.14 up to lowY)
    const baseH = Math.max(0.12, lowY - baseBottom);
    const baseMesh = new THREE.Mesh(
      new THREE.BoxGeometry(s, baseH, s),
      cliffSideMat
    );
    baseMesh.position.y = lowY - baseH / 2;
    baseMesh.receiveShadow = true;
    baseMesh.castShadow = true;
    baseMesh.userData.gridPos = { x, y };
    rampGroup.add(baseMesh);

    // 3D Extruded Sloped Wedge (low at +Z, high at -Z in local space!)
    const shape = new THREE.Shape();
    shape.moveTo(-s / 2, 0);
    shape.lineTo(s / 2, 0);
    shape.lineTo(s / 2, rise);
    shape.closePath();

    const wedgeGeo = new THREE.ExtrudeGeometry(shape, { depth: s, bevelEnabled: false });
    // Center along X (extrude axis) and map shape's +X (high end) to local -Z (North)
    wedgeGeo.translate(0, 0, -s / 2);
    wedgeGeo.rotateY(Math.PI / 2);

    const wedgeMesh = new THREE.Mesh(wedgeGeo, cliffSideMat);
    wedgeMesh.position.y = lowY;
    wedgeMesh.castShadow = true;
    wedgeMesh.receiveShadow = true;
    wedgeMesh.userData.gridPos = { x, y };
    addInkEdges(wedgeMesh, 0x3e220f, 0.55);
    rampGroup.add(wedgeMesh);

    // Sloped timber tread top plate textured with upward-chevron ramp planks!
    const slopeLen = Math.hypot(s, rise);
    const slopeAngle = Math.atan2(rise, s);
    const topGeo = new THREE.PlaneGeometry(s * 0.96, slopeLen);
    topGeo.rotateX(-Math.PI / 2 + slopeAngle);
    const rampTex = this.textures.getTerrainTexture(theme, 'ramp', checker);
    const topMat = new THREE.MeshStandardMaterial({
      map: rampTex,
      roughness: 0.85,
      bumpMap: this.textures.paperBump,
      bumpScale: 0.018,
    });
    const slopePlate = new THREE.Mesh(topGeo, topMat);
    slopePlate.position.set(0, lowY + rise * 0.5 + 0.01, 0);
    slopePlate.receiveShadow = true;
    slopePlate.userData.gridPos = { x, y };
    rampGroup.add(slopePlate);

    this.boardGroup.add(rampGroup);
    this.tilePickMeshes.push(wedgeMesh, slopePlate);
  }

  private buildWaterTile(
    x: number,
    y: number,
    elev: number,
    wp: { x: number; y: number; z: number },
    surfaceY: number,
    checker: boolean,
    theme: BoardTheme,
    waterSurfaces: Array<{ mesh: THREE.Mesh; baseY: number; phase: number }>
  ): void {
    const s = TILE_SIZE_3D - 0.015;
    // Deep recessed aqua riverbed
    const bedMat = new THREE.MeshStandardMaterial({
      color: '#195c78',
      roughness: 0.9,
    });
    const bed = new THREE.Mesh(new THREE.BoxGeometry(s, 0.06, s), bedMat);
    bed.position.set(wp.x, surfaceY - 0.05, wp.z);
    bed.receiveShadow = true;
    bed.userData.gridPos = { x, y };
    this.boardGroup.add(bed);
    this.tilePickMeshes.push(bed);

    // Shimmering animated Paper Mario water sheet
    const waterTex = this.textures.getTerrainTexture(theme, 'water', checker);
    const waterMat = new THREE.MeshStandardMaterial({
      map: waterTex,
      roughness: 0.16,
      metalness: 0.14,
      transparent: true,
      opacity: 0.88,
    });
    const surfGeo = new THREE.PlaneGeometry(s, s);
    surfGeo.rotateX(-Math.PI / 2);
    const surf = new THREE.Mesh(surfGeo, waterMat);
    surf.position.set(wp.x, surfaceY + 0.01, wp.z);
    surf.receiveShadow = true;
    surf.userData.gridPos = { x, y };
    this.boardGroup.add(surf);
    waterSurfaces.push({ mesh: surf, baseY: surfaceY + 0.01, phase: x * 0.8 + y * 1.1 });

    // Cute floating paper lily pad on select water tiles!
    if ((x * 5 + y * 11) % 3 === 0 && elev === 0) {
      const pad = new THREE.Group();
      const padMat = new THREE.MeshStandardMaterial({ color: '#58a842', roughness: 0.8 });
      const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.025, 10, 1, false, 0.35, Math.PI * 1.85), padMat);
      pad.add(disc);
      if ((x + y) % 2 === 0) {
        const flower = new THREE.Mesh(
          new THREE.ConeGeometry(0.08, 0.09, 6),
          new THREE.MeshStandardMaterial({ color: '#ffb3c6', roughness: 0.7 })
        );
        flower.position.set(0.03, 0.05, 0);
        flower.rotation.x = Math.PI;
        pad.add(flower);
      }
      pad.position.set(wp.x + ((x % 2) * 0.2 - 0.1), surfaceY + 0.025, wp.z + ((y % 2) * 0.18 - 0.09));
      pad.rotation.y = (x + y) * 1.1;
      this.sceneryGroup.add(pad);
    }
  }

  private buildLavaTile(
    x: number,
    y: number,
    _elev: number,
    wp: { x: number; y: number; z: number },
    surfaceY: number,
    checker: boolean,
    theme: BoardTheme,
    lavaMats: Array<{ mat: THREE.MeshStandardMaterial; phase: number }>
  ): void {
    const s = TILE_SIZE_3D - 0.015;
    const lavaTex = this.textures.getTerrainTexture(theme, 'lava', checker);
    const lavaMat = new THREE.MeshStandardMaterial({
      map: lavaTex,
      emissive: new THREE.Color('#ff4a08'),
      emissiveIntensity: 0.85,
      roughness: 0.42,
    });
    const block = new THREE.Mesh(new THREE.BoxGeometry(s, 0.08, s), lavaMat);
    block.position.set(wp.x, surfaceY - 0.04, wp.z);
    block.userData.gridPos = { x, y };
    this.boardGroup.add(block);
    this.tilePickMeshes.push(block);
    lavaMats.push({ mat: lavaMat, phase: x * 1.3 + y * 0.9 });

    // Glowing floating lava ember motes!
    const emberGroup = new THREE.Group();
    emberGroup.position.set(wp.x, surfaceY + 0.08, wp.z);
    const emberGeo = new THREE.OctahedronGeometry(0.045, 0);
    const emberMat = new THREE.MeshBasicMaterial({ color: '#ffdf6b' });
    const motes: Array<{ mesh: THREE.Mesh; phase: number; ox: number; oz: number }> = [];
    for (let i = 0; i < 3; i++) {
      const m = new THREE.Mesh(emberGeo, emberMat);
      emberGroup.add(m);
      motes.push({
        mesh: m,
        phase: i * 2.1 + x * 0.7 + y,
        ox: (i - 1) * 0.24,
        oz: ((i % 2) - 0.5) * 0.28,
      });
    }
    this.sceneryGroup.add(emberGroup);
    this.animatedParts.push({
      update: (time) => {
        for (const e of motes) {
          const cyc = (time * 0.7 + e.phase) % 1.4;
          e.mesh.position.set(
            e.ox + Math.sin(time * 2.5 + e.phase) * 0.09,
            cyc * 0.65,
            e.oz + Math.cos(time * 2.2 + e.phase) * 0.09
          );
          e.mesh.scale.setScalar(Math.max(0.1, 1 - cyc / 1.4));
        }
      },
    });
  }

  private buildBridgeTile(
    battle: BattleState,
    x: number,
    y: number,
    elev: number,
    wp: { x: number; y: number; z: number },
    surfaceY: number,
    checker: boolean,
    theme: BoardTheme,
    waterSurfaces: Array<{ mesh: THREE.Mesh; baseY: number; phase: number }>,
    lavaMats: Array<{ mat: THREE.MeshStandardMaterial; phase: number }>
  ): void {
    // 1. Check adjacent tiles so we place matching water OR lava underneath AND orient handrails properly!
    const leftT = x > 0 ? battle.tiles[y][x - 1].terrain : null;
    const rightT = x + 1 < battle.width ? battle.tiles[y][x + 1].terrain : null;
    const upT = y > 0 ? battle.tiles[y - 1][x].terrain : null;
    const downT = y + 1 < battle.height ? battle.tiles[y + 1][x].terrain : null;

    const overLava = leftT === 'lava' || rightT === 'lava' || upT === 'lava' || downT === 'lava';
    const riverRunsHoriz =
      leftT === 'water' || rightT === 'water' || leftT === 'lava' || rightT === 'lava';

    // Liquid basin directly beneath the suspended wooden bridge!
    const liquidY = elev * ELEVATION_STEP_3D + (overLava ? -0.095 : -0.105);
    if (overLava) {
      this.buildLavaTile(x, y, elev, wp, liquidY, checker, theme, lavaMats);
    } else {
      this.buildWaterTile(x, y, elev, wp, liquidY, checker, theme, waterSurfaces);
    }

    // 2. Suspended 3D Wooden Plank Deck + Corner Railings!
    const bridgeGroup = new THREE.Group();
    bridgeGroup.position.set(wp.x, surfaceY, wp.z);
    if (!riverRunsHoriz) {
      bridgeGroup.rotation.y = Math.PI / 2;
    }

    const deckW = TILE_SIZE_3D - 0.02;
    const deckH = 0.09;
    const bridgeTex = this.textures.getTerrainTexture(theme, 'bridge', checker);
    const deckTopMat = new THREE.MeshStandardMaterial({
      map: bridgeTex,
      roughness: 0.84,
      bumpMap: this.textures.paperBump,
      bumpScale: 0.02,
    });
    const beamMat = new THREE.MeshStandardMaterial({
      color: overLava ? '#5c4b42' : '#7b4922',
      roughness: 0.88,
    });

    const deck = new THREE.Mesh(
      new THREE.BoxGeometry(deckW * 0.94, deckH, deckW),
      [beamMat, beamMat, deckTopMat, beamMat, beamMat, beamMat]
    );
    deck.position.y = -deckH / 2;
    deck.castShadow = true;
    deck.receiveShadow = true;
    deck.userData.gridPos = { x, y };
    addInkEdges(deck, 0x3a2010, 0.62);
    bridgeGroup.add(deck);

    // Side handrail posts + top rail bars along X = ±deckW*0.44 (never blocking N/S crossing!)
    const postGeo = new THREE.BoxGeometry(0.075, 0.34, 0.075);
    const railGeo = new THREE.BoxGeometry(0.055, 0.055, deckW);
    for (const side of [-1, 1]) {
      const rx = side * (deckW * 0.44);
      for (const pz of [-deckW * 0.38, deckW * 0.38]) {
        const post = new THREE.Mesh(postGeo, beamMat);
        post.position.set(rx, 0.14, pz);
        post.castShadow = true;
        addInkEdges(post, 0x3a2010, 0.5);
        bridgeGroup.add(post);
      }
      const topRail = new THREE.Mesh(railGeo, beamMat);
      topRail.position.set(rx, 0.27, 0);
      topRail.castShadow = true;
      bridgeGroup.add(topRail);
    }

    this.boardGroup.add(bridgeGroup);
    this.tilePickMeshes.push(deck);
  }

  private addCompostSprout(x: number, y: number, z: number, seed: number): void {
    const g = new THREE.Group();
    g.position.set(x + ((seed % 3) - 1) * 0.28, y, z + (((seed >> 2) % 3) - 1) * 0.26);
    const stemMat = new THREE.MeshStandardMaterial({ color: '#4d8a2d', roughness: 0.85 });
    const leafMat = new THREE.MeshStandardMaterial({ color: '#83cf52', roughness: 0.8, side: THREE.DoubleSide });
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.02, 0.14, 6), stemMat);
    stem.position.y = 0.07;
    g.add(stem);

    const leafGeo = new THREE.CircleGeometry(0.07, 6);
    leafGeo.scale(1.4, 0.7, 1);
    for (const dir of [-1, 1]) {
      const leaf = new THREE.Mesh(leafGeo, leafMat);
      leaf.position.set(dir * 0.06, 0.14, 0);
      leaf.rotation.set(-0.4, 0, dir * -0.45);
      g.add(leaf);
    }
    this.sceneryGroup.add(g);
  }

  private addTinyGrassTuft(x: number, y: number, z: number, theme: BoardTheme, seed: number): void {
    const ox = ((seed % 5) - 2) * 0.17;
    const oz = (((seed * 3) % 5) - 2) * 0.17;
    const color = theme === 'autumn' ? '#b8832c' : '#5f9430';
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.88, side: THREE.DoubleSide });
    const tuft = new THREE.Group();
    tuft.position.set(x + ox, y, z + oz);
    const bladeGeo = new THREE.ConeGeometry(0.024, 0.13, 3);
    for (let i = -1; i <= 1; i++) {
      const b = new THREE.Mesh(bladeGeo, mat);
      b.position.set(i * 0.032, 0.055, 0);
      b.rotation.z = -i * 0.28;
      tuft.add(b);
    }
    // Tiny spring wildflower dot
    if (theme === 'spring' && seed % 2 === 0) {
      const flw = new THREE.Mesh(
        new THREE.CylinderGeometry(0.038, 0.038, 0.012, 6),
        new THREE.MeshStandardMaterial({ color: seed % 4 === 0 ? '#fff6cc' : '#f7a6b9', roughness: 0.75 })
      );
      flw.position.set(0.05, 0.11, 0.02);
      flw.rotation.x = 0.35;
      tuft.add(flw);
    }
    this.sceneryGroup.add(tuft);
  }

  private addSunbeamShaft(x: number, y: number, z: number): void {
    const shaftGeo = new THREE.CylinderGeometry(0.32, 0.56, 3.6, 16, 1, true);
    const shaftMat = new THREE.MeshBasicMaterial({
      color: '#ffe985',
      transparent: true,
      opacity: 0.16,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const shaft = new THREE.Mesh(shaftGeo, shaftMat);
    shaft.position.set(x + 0.35, y + 1.75, z - 0.25);
    shaft.rotation.z = 0.2;
    shaft.rotation.x = 0.12;
    this.sceneryGroup.add(shaft);

    // Floating golden dust motes
    const motes = new THREE.Group();
    motes.position.set(x, y + 0.2, z);
    const moteGeo = new THREE.OctahedronGeometry(0.04, 0);
    const moteMat = new THREE.MeshBasicMaterial({ color: '#fff4a8', transparent: true, opacity: 0.85 });
    const moteMeshes: Array<{ mesh: THREE.Mesh; phase: number; r: number }> = [];
    for (let i = 0; i < 4; i++) {
      const m = new THREE.Mesh(moteGeo, moteMat);
      motes.add(m);
      moteMeshes.push({ mesh: m, phase: i * 1.57, r: 0.18 + (i % 2) * 0.14 });
    }
    this.sceneryGroup.add(motes);

    this.animatedParts.push({
      update: (time) => {
        shaftMat.opacity = 0.13 + Math.sin(time * 2.1 + x) * 0.04;
        for (const item of moteMeshes) {
          const t = (time * 0.55 + item.phase) % 2.4;
          item.mesh.position.set(
            Math.cos(time * 1.3 + item.phase) * item.r,
            t * 0.72,
            Math.sin(time * 1.1 + item.phase) * item.r
          );
          item.mesh.rotation.y = time * 2.4;
        }
      },
    });
  }

  private buildGateArchway(battle: BattleState): void {
    const xs = battle.gateTiles.map((g) => g.x);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const gy = battle.gateTiles[0].y;
    const pLeft = gridToWorld3D(minX, gy, battle.width, battle.height, 0);
    const pRight = gridToWorld3D(maxX, gy, battle.width, battle.height, 0);
    const cx = (pLeft.x + pRight.x) / 2;
    const span = Math.max(TILE_SIZE_3D, pRight.x - pLeft.x + TILE_SIZE_3D * 0.7);
    const zEdge = pLeft.z - TILE_SIZE_3D * 0.52;

    const arch = new THREE.Group();
    arch.position.set(cx, 0, zEdge);

    const postMat = new THREE.MeshStandardMaterial({ color: '#9c6230', roughness: 0.88 });
    const postGeo = new THREE.BoxGeometry(0.18, 1.55, 0.18);
    for (const side of [-1, 1]) {
      const post = new THREE.Mesh(postGeo, postMat);
      post.position.set(side * (span / 2), 0.77, 0);
      post.castShadow = true;
      addInkEdges(post);
      arch.add(post);
    }

    // Top crossbeam sign
    const beam = new THREE.Mesh(new THREE.BoxGeometry(span + 0.45, 0.22, 0.18), postMat);
    beam.position.set(0, 1.54, 0);
    beam.castShadow = true;
    addInkEdges(beam);
    arch.add(beam);

    // Colorful Paper Mario triangular pennant bunting!
    const flagsGroup = new THREE.Group();
    const flagColors = ['#e85845', '#f5cb47', '#67b848', '#4fa7cc'];
    const count = 7;
    const flagGeo = new THREE.ConeGeometry(0.13, 0.24, 3);
    flagGeo.rotateX(Math.PI);
    for (let i = 0; i < count; i++) {
      const t = (i + 0.5) / count - 0.5;
      const flag = new THREE.Mesh(
        flagGeo,
        new THREE.MeshStandardMaterial({ color: flagColors[i % flagColors.length], roughness: 0.8 })
      );
      flag.position.set(t * (span - 0.2), 1.32 - Math.cos(t * Math.PI) * 0.08, 0.06);
      flagsGroup.add(flag);
    }
    arch.add(flagsGroup);
    this.sceneryGroup.add(arch);

    this.animatedParts.push({
      update: (time) => {
        flagsGroup.children.forEach((child, idx) => {
          child.rotation.x = Math.sin(time * 3.2 + idx * 0.7) * 0.16;
        });
      },
    });
  }

  private buildPerimeterFences(boardW: number, boardH: number, theme: BoardTheme): void {
    const woodMat = new THREE.MeshStandardMaterial({
      color: theme === 'greenhouse' ? '#c8d6c4' : '#f2e4c7',
      roughness: 0.85,
      bumpMap: this.textures.paperBump,
      bumpScale: 0.015,
    });
    const railMat = new THREE.MeshStandardMaterial({
      color: theme === 'greenhouse' ? '#9cb398' : '#d8c096',
      roughness: 0.88,
    });

    const postGeo = new THREE.BoxGeometry(0.1, 0.46, 0.055);
    const picketCapGeo = new THREE.ConeGeometry(0.068, 0.1, 4);
    picketCapGeo.rotateY(Math.PI / 4);

    const buildFenceRun = (length: number, x: number, z: number, rotY: number) => {
      const g = new THREE.Group();
      g.position.set(x, 0, z);
      g.rotation.y = rotY;
      const rail1 = new THREE.Mesh(new THREE.BoxGeometry(length, 0.065, 0.045), railMat);
      rail1.position.set(0, 0.16, 0);
      const rail2 = new THREE.Mesh(new THREE.BoxGeometry(length, 0.065, 0.045), railMat);
      rail2.position.set(0, 0.34, 0);
      rail1.castShadow = true;
      rail2.castShadow = true;
      g.add(rail1, rail2);

      const posts = Math.max(3, Math.floor(length / 0.42));
      for (let i = 0; i <= posts; i++) {
        const px = -length / 2 + (i / posts) * length;
        const p = new THREE.Mesh(postGeo, woodMat);
        p.position.set(px, 0.23, 0.02);
        p.castShadow = true;
        const cap = new THREE.Mesh(picketCapGeo, woodMat);
        cap.position.set(px, 0.51, 0.02);
        g.add(p, cap);
      }
      this.sceneryGroup.add(g);
    };

    const halfW = boardW / 2 + 0.24;
    const halfH = boardH / 2 + 0.24;
    // Left and right miniature picket fences
    buildFenceRun(boardH + 0.1, -halfW, 0, Math.PI / 2);
    buildFenceRun(boardH + 0.1, halfW, 0, -Math.PI / 2);
    // North edge split fences (leaving center clear if gate exists)
    buildFenceRun(boardW * 0.3, -boardW * 0.35, -halfH, 0);
    buildFenceRun(boardW * 0.3, boardW * 0.35, -halfH, 0);
  }

  private buildStageBackdrop(boardW: number, boardH: number, theme: BoardTheme): void {
    const northZ = -boardH / 2 - 1.15;

    // Staggered Paper Mario Cardboard Hills behind the garden!
    const hillColors =
      theme === 'autumn'
        ? ['#d68e38', '#b85a2c', '#9c4324']
        : theme === 'greenhouse'
          ? ['#6fa652', '#528741', '#427038']
          : ['#85b84b', '#6ba03c', '#578734'];

    const hillSpecs = [
      { x: -boardW * 0.45, z: northZ - 1.1, r: 2.5, h: 1.5, col: hillColors[0] },
      { x: boardW * 0.38, z: northZ - 1.4, r: 2.8, h: 1.7, col: hillColors[1] },
      { x: 0.1, z: northZ - 2.3, r: 3.6, h: 2.2, col: hillColors[2] },
    ];

    for (const hs of hillSpecs) {
      const hillShape = new THREE.Shape();
      hillShape.absarc(0, 0, hs.r, 0, Math.PI, false);
      hillShape.lineTo(-hs.r, 0);
      const extrude = new THREE.ExtrudeGeometry(hillShape, {
        depth: 0.14,
        bevelEnabled: true,
        bevelThickness: 0.03,
        bevelSize: 0.03,
        bevelSegments: 2,
      });
      const hillMat = new THREE.MeshStandardMaterial({
        color: new THREE.Color(hs.col),
        roughness: 0.9,
        bumpMap: this.textures.paperBump,
        bumpScale: 0.02,
      });
      const hill = new THREE.Mesh(extrude, hillMat);
      hill.position.set(hs.x, -0.68, hs.z);
      hill.scale.set(1, hs.h / hs.r, 1);
      hill.castShadow = true;
      hill.receiveShadow = true;
      addInkEdges(hill, 0x3b2410, 0.42, 32);
      this.sceneryGroup.add(hill);
    }

    // Layered Folded-Paper Trees flanking the diorama for deep parallax!
    const treePositions = [
      { x: -boardW / 2 - 1.35, z: -boardH * 0.36, s: 1.08 },
      { x: boardW / 2 + 1.35, z: -boardH * 0.3, s: 0.98 },
      { x: -boardW / 2 - 1.5, z: boardH * 0.14, s: 0.88 },
      { x: boardW / 2 + 1.48, z: boardH * 0.22, s: 0.94 },
    ];
    for (let i = 0; i < treePositions.length; i++) {
      const tp = treePositions[i];
      this.addPaperTree(tp.x, -0.68, tp.z, tp.s, theme, i);
    }

    // Theme-specific Centerpiece Stage Prop behind row 0
    if (theme === 'greenhouse') {
      this.addGreenhouseArches(boardW, northZ + 0.55);
    } else if (theme === 'autumn') {
      this.addMiniatureBarn(boardW * 0.36, -0.68, northZ - 0.15, '#9f3b26');
      this.addMiniPumpkins(-boardW / 2 - 0.9, -0.68, -boardH * 0.08);
    } else {
      this.addMiniatureBarn(-boardW * 0.32, -0.68, northZ - 0.2, '#c84635');
    }

    // Floating Paper Mario Clouds mounted on thin brass wire rods!
    const cloudConfigs = [
      { x: -boardW * 0.32, y: 2.9, z: northZ - 1.9, s: 1.0 },
      { x: boardW * 0.36, y: 3.3, z: northZ - 2.3, s: 1.15 },
    ];
    for (let i = 0; i < cloudConfigs.length; i++) {
      const c = cloudConfigs[i];
      const cloud = this.createPaperCloud(c.s);
      cloud.position.set(c.x, c.y, c.z);
      this.sceneryGroup.add(cloud);

      // Thin craft wire stand down to the tabletop
      const wire = new THREE.Mesh(
        new THREE.CylinderGeometry(0.015, 0.015, c.y + 0.68, 6),
        new THREE.MeshStandardMaterial({ color: '#c4a158', metalness: 0.6, roughness: 0.4 })
      );
      wire.position.set(c.x, (c.y - 0.68) / 2, c.z - 0.04);
      this.sceneryGroup.add(wire);

      const baseY = c.y;
      this.animatedParts.push({
        update: (time) => {
          cloud.position.y = baseY + Math.sin(time * 1.1 + i * 2.2) * 0.1;
          cloud.rotation.z = Math.sin(time * 0.75 + i) * 0.04;
        },
      });
    }
  }

  private addPaperTree(x: number, y: number, z: number, scale: number, theme: BoardTheme, idx: number): void {
    const tree = new THREE.Group();
    tree.position.set(x, y, z);
    tree.scale.setScalar(scale);

    const trunkMat = new THREE.MeshStandardMaterial({ color: '#7a4b26', roughness: 0.9 });
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.16, 1.35, 8), trunkMat);
    trunk.position.y = 0.68;
    trunk.castShadow = true;
    addInkEdges(trunk, 0x3b2210, 0.5);
    tree.add(trunk);

    const palette =
      theme === 'autumn'
        ? ['#d95f2b', '#e8962e', '#b83c24']
        : theme === 'greenhouse'
          ? ['#4f9a49', '#6eb854', '#3f7f3c']
          : ['#5da13d', '#7cc24e', '#4c8832'];

    const tiers = [
      { y: 1.32, r: 0.76, h: 0.55 },
      { y: 1.78, r: 0.6, h: 0.5 },
      { y: 2.18, r: 0.4, h: 0.42 },
    ];
    tiers.forEach((tier, ti) => {
      const cone = new THREE.Mesh(
        new THREE.ConeGeometry(tier.r, tier.h, 7),
        new THREE.MeshStandardMaterial({
          color: new THREE.Color(palette[(ti + idx) % palette.length]),
          roughness: 0.88,
          bumpMap: this.textures.paperBump,
          bumpScale: 0.015,
        })
      );
      cone.position.y = tier.y;
      cone.rotation.y = ti * 0.5;
      cone.castShadow = true;
      cone.receiveShadow = true;
      addInkEdges(cone, 0x3a2410, 0.45);
      tree.add(cone);
    });

    this.sceneryGroup.add(tree);

    this.animatedParts.push({
      update: (time) => {
        tree.rotation.z = Math.sin(time * 1.2 + idx * 1.4) * 0.022;
      },
    });
  }

  private addMiniatureBarn(x: number, y: number, z: number, wallColor: string): void {
    const barn = new THREE.Group();
    barn.position.set(x, y, z);
    barn.rotation.y = 0.22;

    const wallMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(wallColor),
      roughness: 0.88,
      bumpMap: this.textures.paperBump,
      bumpScale: 0.015,
    });
    const trimMat = new THREE.MeshStandardMaterial({ color: '#fbf2dc', roughness: 0.85 });
    const roofMat = new THREE.MeshStandardMaterial({ color: '#61412b', roughness: 0.9 });

    const body = new THREE.Mesh(new THREE.BoxGeometry(1.7, 1.35, 1.25), wallMat);
    body.position.y = 0.675;
    body.castShadow = true;
    body.receiveShadow = true;
    addInkEdges(body);
    barn.add(body);

    // Pitched paper roof
    const roofGeo = new THREE.ConeGeometry(1.42, 0.85, 4);
    roofGeo.rotateY(Math.PI / 4);
    const roof = new THREE.Mesh(roofGeo, roofMat);
    roof.position.y = 1.72;
    roof.scale.set(1.08, 1, 0.82);
    roof.castShadow = true;
    addInkEdges(roof);
    barn.add(roof);

    // Barn X-doors
    const door = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.72, 0.06), trimMat);
    door.position.set(0, 0.36, 0.63);
    addInkEdges(door);
    barn.add(door);

    this.sceneryGroup.add(barn);
  }

  private addGreenhouseArches(boardW: number, zPos: number): void {
    const brassMat = new THREE.MeshStandardMaterial({ color: '#b59247', metalness: 0.35, roughness: 0.55 });
    const glassMat = new THREE.MeshStandardMaterial({
      color: '#d9f2e6',
      transparent: true,
      opacity: 0.24,
      roughness: 0.2,
      side: THREE.DoubleSide,
    });
    const archGroup = new THREE.Group();
    archGroup.position.set(0, -0.1, zPos);
    const radius = Math.min(4.2, boardW * 0.44);
    const ribGeo = new THREE.TorusGeometry(radius, 0.075, 8, 24, Math.PI);
    for (const dz of [0, -0.9]) {
      const rib = new THREE.Mesh(ribGeo, brassMat);
      rib.position.z = dz;
      rib.castShadow = true;
      archGroup.add(rib);
    }
    const pane = new THREE.Mesh(
      new THREE.CylinderGeometry(radius - 0.04, radius - 0.04, 0.9, 18, 1, true, 0, Math.PI),
      glassMat
    );
    pane.rotation.z = Math.PI / 2;
    pane.rotation.y = Math.PI / 2;
    pane.position.z = -0.45;
    archGroup.add(pane);
    this.sceneryGroup.add(archGroup);
  }

  private addMiniPumpkins(x: number, y: number, z: number): void {
    const mat = new THREE.MeshStandardMaterial({ color: '#e67824', roughness: 0.82 });
    const stemMat = new THREE.MeshStandardMaterial({ color: '#4d6e26', roughness: 0.9 });
    for (const [ox, oz, s] of [
      [0, 0, 0.34],
      [0.42, 0.32, 0.24],
    ]) {
      const p = new THREE.Group();
      p.position.set(x + ox, y + s * 0.72, z + oz);
      const body = new THREE.Mesh(new THREE.SphereGeometry(s, 10, 8), mat);
      body.scale.set(1.15, 0.78, 1.15);
      body.castShadow = true;
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.05, 0.16, 5), stemMat);
      stem.position.y = s * 0.82;
      p.add(body, stem);
      this.sceneryGroup.add(p);
    }
  }

  private createPaperCloud(scale: number): THREE.Group {
    const g = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({
      color: '#fffbf0',
      roughness: 0.92,
      bumpMap: this.textures.paperBump,
      bumpScale: 0.01,
    });
    const puffs = [
      { x: 0, y: 0.12, r: 0.48 },
      { x: -0.42, y: 0, r: 0.36 },
      { x: 0.44, y: -0.02, r: 0.34 },
    ];
    for (const pf of puffs) {
      const disc = new THREE.Mesh(new THREE.CylinderGeometry(pf.r, pf.r, 0.12, 14), mat);
      disc.rotation.x = Math.PI / 2;
      disc.position.set(pf.x, pf.y, 0);
      disc.castShadow = true;
      g.add(disc);
    }
    g.scale.setScalar(scale);
    return g;
  }

  private syncCovers(battle: BattleState): void {
    const activeKeys = new Set<string>();

    for (let y = 0; y < battle.height; y++) {
      for (let x = 0; x < battle.width; x++) {
        const tile = battle.tiles[y][x];
        if (!tile.cover) continue;
        const key = posKey({ x, y });
        activeKeys.add(key);

        const existing = this.coverMap.get(key);
        if (existing && existing.kind === tile.cover.kind) {
          // Update damaged crate visual if HP dropped
          if (existing.hp !== tile.cover.hp) {
            existing.hp = tile.cover.hp;
            if (existing.crateMesh && existing.hp < existing.maxHp) {
              const mat = existing.crateMesh.material as THREE.MeshStandardMaterial;
              mat.map = this.textures.crateDamagedMap;
              mat.needsUpdate = true;
            }
          }
          continue;
        }

        if (existing) {
          this.removeCoverVisual(key);
        }

        const wp = gridToWorld3D(x, y, battle.width, battle.height, getTileSurfaceY(tile));
        const visual = this.createCoverProp({ x, y }, tile.cover, wp);
        this.coverMap.set(key, visual);
        this.coverGroup.add(visual.group);
      }
    }

    for (const key of Array.from(this.coverMap.keys())) {
      if (!activeKeys.has(key)) {
        this.removeCoverVisual(key);
      }
    }

    // Rebuild cover pick meshes array
    this.coverPickMeshes.length = 0;
    for (const cv of this.coverMap.values()) {
      cv.group.traverse((child) => {
        if ((child as THREE.Mesh).isMesh && child.userData.gridPos) {
          this.coverPickMeshes.push(child as THREE.Mesh);
        }
      });
    }
  }

  private removeCoverVisual(key: string): void {
    const cv = this.coverMap.get(key);
    if (!cv) return;
    this.coverGroup.remove(cv.group);
    cv.dispose();
    this.coverMap.delete(key);
  }

  private createCoverProp(
    pos: GridPos,
    cover: CoverObject,
    worldPos: { x: number; y: number; z: number }
  ): CoverPropVisual {
    const group = new THREE.Group();
    group.position.set(worldPos.x, worldPos.y, worldPos.z);

    let height = cover.level === 'full' ? 1.2 : 0.68;
    let bees: THREE.Group | undefined;
    let spinner: THREE.Object3D | undefined;
    let crateMesh: THREE.Mesh | undefined;

    const markPickable = (mesh: THREE.Mesh) => {
      mesh.userData.gridPos = { x: pos.x, y: pos.y };
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    };

    if (cover.kind === 'crate') {
      height = 0.66;
      const mat = new THREE.MeshStandardMaterial({
        map: cover.hp < cover.maxHp ? this.textures.crateDamagedMap : this.textures.crateMap,
        roughness: 0.86,
        bumpMap: this.textures.paperBump,
        bumpScale: 0.018,
      });
      const box = new THREE.Mesh(new THREE.BoxGeometry(0.84, height, 0.84), mat);
      box.position.y = height / 2;
      markPickable(box);
      addInkEdges(box, 0x452a16, 0.72);
      crateMesh = box;
      group.add(box);
    } else if (cover.kind === 'cage') {
      height = 0.78;
      const sideMat = new THREE.MeshStandardMaterial({ map: this.textures.cageSideMap, roughness: 0.88 });
      const frontMat = new THREE.MeshStandardMaterial({ map: this.textures.cageFrontMap, roughness: 0.88 });
      const box = new THREE.Mesh(new THREE.BoxGeometry(0.88, height, 0.88), [
        sideMat,
        sideMat,
        sideMat,
        sideMat,
        frontMat,
        sideMat,
      ]);
      box.position.y = height / 2;
      markPickable(box);
      addInkEdges(box, 0x3b2110, 0.78);
      group.add(box);
    } else if (cover.kind === 'haystack') {
      // Tall Full Cover: unmistakably higher than crates so direct LoS reads instantly in 3D!
      height = 1.24;
      const hayMat = new THREE.MeshStandardMaterial({
        map: this.textures.haystackMap,
        roughness: 0.92,
        bumpMap: this.textures.paperBump,
        bumpScale: 0.03,
      });
      const tier1 = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.52, 0.48, 10), hayMat);
      tier1.position.y = 0.24;
      markPickable(tier1);
      addInkEdges(tier1, 0x6b4214, 0.45, 28);

      const tier2 = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.44, 0.44, 10), hayMat);
      tier2.position.y = 0.66;
      markPickable(tier2);

      const tier3 = new THREE.Mesh(new THREE.ConeGeometry(0.32, 0.42, 9), hayMat);
      tier3.position.y = 1.06;
      markPickable(tier3);

      group.add(tier1, tier2, tier3);
    } else if (cover.kind === 'stone') {
      // Tall Indestructible Full Cover boulder
      height = 1.18;
      const stoneMat = new THREE.MeshStandardMaterial({
        map: this.textures.stoneMap,
        roughness: 0.94,
        flatShading: true,
      });
      const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.56, 0), stoneMat);
      rock.scale.set(0.95, 1.14, 0.92);
      rock.position.y = 0.56;
      rock.rotation.set(0.25, (pos.x * 1.1 + pos.y * 0.7) % 3, 0.15);
      markPickable(rock);
      addInkEdges(rock, 0x3a3f3d, 0.6, 20);
      group.add(rock);

      // Paper-cutout moss cap
      const moss = new THREE.Mesh(
        new THREE.CylinderGeometry(0.28, 0.34, 0.08, 7),
        new THREE.MeshStandardMaterial({ color: '#6ca342', roughness: 0.9 })
      );
      moss.position.set(0.06, 1.12, 0.02);
      moss.rotation.z = -0.18;
      group.add(moss);
    } else if (cover.kind === 'beehive') {
      height = 0.88;
      // Tree stump
      const stump = new THREE.Mesh(
        new THREE.CylinderGeometry(0.34, 0.42, 0.26, 9),
        new THREE.MeshStandardMaterial({ color: '#8f5a30', roughness: 0.92 })
      );
      stump.position.y = 0.13;
      markPickable(stump);
      addInkEdges(stump, 0x452a16, 0.55);
      group.add(stump);

      // Woven golden skep hive
      const hiveMat = new THREE.MeshStandardMaterial({
        map: this.textures.beehiveMap,
        roughness: 0.86,
        bumpMap: this.textures.paperBump,
        bumpScale: 0.02,
      });
      const hive = new THREE.Mesh(new THREE.SphereGeometry(0.35, 12, 10), hiveMat);
      hive.scale.set(1, 1.15, 1);
      hive.position.y = 0.56;
      markPickable(hive);
      group.add(hive);

      // Dark hive hole
      const hole = new THREE.Mesh(
        new THREE.CircleGeometry(0.085, 12),
        new THREE.MeshBasicMaterial({ color: '#2b1608' })
      );
      hole.position.set(0, 0.5, 0.355);
      group.add(hole);

      // 3 Orbiting Paper Mario Bees!
      bees = new THREE.Group();
      bees.position.y = 0.72;
      const beeBodyMat = new THREE.MeshStandardMaterial({ color: '#f7ca36', roughness: 0.7 });
      const stripeMat = new THREE.MeshStandardMaterial({ color: '#2b1b0e', roughness: 0.8 });
      const wingMat = new THREE.MeshBasicMaterial({ color: '#fffdf5', transparent: true, opacity: 0.85, side: THREE.DoubleSide });
      for (let i = 0; i < 3; i++) {
        const bee = new THREE.Group();
        const angle = (i / 3) * Math.PI * 2;
        bee.position.set(Math.cos(angle) * 0.46, (i % 2) * 0.16, Math.sin(angle) * 0.46);
        const body = new THREE.Mesh(new THREE.SphereGeometry(0.065, 8, 6), beeBodyMat);
        body.scale.set(1.2, 0.85, 0.85);
        const stripe = new THREE.Mesh(new THREE.CylinderGeometry(0.056, 0.056, 0.03, 8), stripeMat);
        stripe.rotation.z = Math.PI / 2;
        const wingL = new THREE.Mesh(new THREE.CircleGeometry(0.055, 6), wingMat);
        wingL.position.set(0, 0.065, 0.03);
        wingL.rotation.x = 0.5;
        const wingR = new THREE.Mesh(new THREE.CircleGeometry(0.055, 6), wingMat);
        wingR.position.set(0, 0.065, -0.03);
        wingR.rotation.x = -0.5;
        bee.add(body, stripe, wingL, wingR);
        bees.add(bee);
      }
      group.add(bees);
    } else if (cover.kind === 'sprinkler') {
      height = 0.78;
      const base = new THREE.Mesh(
        new THREE.CylinderGeometry(0.24, 0.3, 0.36, 12),
        new THREE.MeshStandardMaterial({ color: '#6b9468', roughness: 0.75, metalness: 0.18 })
      );
      base.position.y = 0.18;
      markPickable(base);
      addInkEdges(base, 0x324730, 0.55);
      group.add(base);

      const brassMat = new THREE.MeshStandardMaterial({ color: '#d8ab4c', roughness: 0.42, metalness: 0.55 });
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.08, 0.32, 10), brassMat);
      stem.position.y = 0.48;
      markPickable(stem);
      group.add(stem);

      const armGroup = new THREE.Group();
      armGroup.position.y = 0.64;
      const crossbar = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.58, 8), brassMat);
      crossbar.rotation.z = Math.PI / 2;
      armGroup.add(crossbar);

      // Glistening water mist beads at nozzle tips
      const dropMat = new THREE.MeshBasicMaterial({ color: '#9ee8ff', transparent: true, opacity: 0.75 });
      for (const side of [-1, 1]) {
        const drop = new THREE.Mesh(new THREE.SphereGeometry(0.055, 6, 6), dropMat);
        drop.position.set(side * 0.35, 0.05, 0);
        armGroup.add(drop);
      }
      spinner = armGroup;
      group.add(armGroup);
    } else {
      // Thorns bramble half-cover
      height = 0.68;
      const vineMat = new THREE.MeshStandardMaterial({ color: '#3b6628', roughness: 0.9 });
      const spikeMat = new THREE.MeshStandardMaterial({ color: '#7a2c3b', roughness: 0.82 });
      const archGeo = new THREE.TorusGeometry(0.32, 0.075, 7, 12, Math.PI);
      for (let i = 0; i < 3; i++) {
        const arch = new THREE.Mesh(archGeo, vineMat);
        arch.position.set((i - 1) * 0.1, 0.05, (i % 2 === 0 ? -0.1 : 0.12));
        arch.rotation.y = i * 0.95;
        markPickable(arch);
        group.add(arch);
      }
      const thornGeo = new THREE.ConeGeometry(0.055, 0.2, 4);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const spike = new THREE.Mesh(thornGeo, spikeMat);
        spike.position.set(Math.cos(a) * 0.26, 0.34 + (i % 2) * 0.12, Math.sin(a) * 0.26);
        spike.rotation.set(Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5);
        group.add(spike);
      }
    }

    return {
      key: posKey(pos),
      pos,
      kind: cover.kind,
      group,
      hp: cover.hp,
      maxHp: cover.maxHp,
      height,
      isObjectiveCage: Boolean(cover.isObjectiveCage),
      bees,
      spinner,
      crateMesh,
      dispose: () => disposeObjectTree(group),
    };
  }

  public getCoverVisual(pos: GridPos): CoverPropVisual | undefined {
    return this.coverMap.get(posKey(pos));
  }

  public getAllCoverVisuals(): CoverPropVisual[] {
    return Array.from(this.coverMap.values());
  }

  public update(time: number, dt: number): void {
    for (const part of this.animatedParts) {
      part.update(time, dt);
    }
    for (const cv of this.coverMap.values()) {
      if (cv.bees) {
        cv.bees.rotation.y = time * 2.1;
        cv.bees.position.y = 0.72 + Math.sin(time * 4.5) * 0.05;
      }
      if (cv.spinner) {
        cv.spinner.rotation.y = time * 2.6;
      }
      if (cv.isObjectiveCage) {
        // Gentle anxious rescue wiggle!
        const pulse = Math.max(0, Math.sin(time * 3.1) - 0.55) * 2.2;
        cv.group.rotation.z = Math.sin(time * 18) * 0.045 * pulse;
      }
    }
  }

  private clearGroup(group: THREE.Group): void {
    while (group.children.length > 0) {
      const child = group.children[0];
      group.remove(child);
      disposeObjectTree(child);
    }
  }

  public dispose(): void {
    for (const key of Array.from(this.coverMap.keys())) {
      this.removeCoverVisual(key);
    }
    this.clearGroup(this.boardGroup);
    this.clearGroup(this.sceneryGroup);
    this.clearGroup(this.root);
    this.tilePickMeshes.length = 0;
    this.coverPickMeshes.length = 0;
  }
}
