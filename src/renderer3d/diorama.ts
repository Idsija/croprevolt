import * as THREE from 'three';
import type { BattleState, BoardTheme, CoverKind, CoverObject, GridPos, TerrainType } from '../engine/types';
import { posKey } from '../engine/grid';
import type { CraftTextureLibrary } from './textures';
import { gridToWorld3D, TILE_SIZE_3D } from './types';
import { compactMultiMaterialMesh } from './geometryUtils';

export interface CoverPropVisual {
  key: string;
  pos: GridPos;
  kind: Exclude<CoverKind, 'none'>;
  group: THREE.Group;
  hp: number;
  maxHp: number;
  height: number;
  isObjectiveCage: boolean;
  isObjectiveCrate: boolean;
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
  burrow: 0.015,
  bounce_pad: 0.02,
  ice: -0.025,
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
  private popUpStartMs = 0;
  private readonly popUpDurationMs = 680;

  constructor(textures: CraftTextureLibrary) {
    this.textures = textures;
    this.root.add(this.boardGroup);
    this.root.add(this.sceneryGroup);
    this.root.add(this.coverGroup);
    this.buildDeskSurface();
  }

  /** Returns 0..1 progress of the Paper Mario pop-up storybook entrance unfold. */
  public getPopUpProgress(): number {
    if (this.popUpStartMs <= 0) return 1;
    return Math.min(1, Math.max(0, (performance.now() - this.popUpStartMs) / this.popUpDurationMs));
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
    this.popUpStartMs = performance.now();

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
      theme === 'winter'
        ? '#90b4cc'
        : theme === 'autumn'
          ? '#ad8838'
          : theme === 'greenhouse'
            ? '#6b9d44'
            : '#7ea53e';
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
    const slab = compactMultiMaterialMesh(slabGeo, [
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
      color: theme === 'winter' ? '#e8f3fa' : '#efe2c2',
      roughness: 0.88,
      bumpMap: this.textures.paperBump,
      bumpScale: 0.01,
    });
    const lip = new THREE.Mesh(lipGeo, lipMat);
    lip.position.set(0, -0.155, 0);
    lip.receiveShadow = true;
    addInkEdges(lip, 0x5c391e, 0.45);
    this.boardGroup.add(lip);

    // 2. Individual 3D Terrain Tiles with Full Multi-Elevation Terraces, Ramps, Water, Bridges, Lava, Ice & Burrows!
    const tileFootprint = TILE_SIZE_3D - 0.022;
    const baseTileH = 0.14;
    const sideTileMat = new THREE.MeshStandardMaterial({
      color: theme === 'winter' ? '#6a7f96' : '#8f6237',
      roughness: 0.92,
    });
    const cliffSideMat = new THREE.MeshStandardMaterial({
      map: this.textures.getCliffSideTexture(theme),
      bumpMap: this.textures.paperBump,
      bumpScale: 0.025,
      roughness: 0.9,
    });

    const waterSurfaces: Array<{ mesh: THREE.Mesh; baseY: number; phase: number }> = [];
    const lavaMats: Array<{ mat: THREE.MeshStandardMaterial; phase: number }> = [];
    const burrowRings: Array<{ ring: THREE.Mesh; phase: number }> = [];

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

        // Standard or Elevated Terraced Block (grass, soil, mud, compost, barn_floor, gate, sunbeam, burrow, ice)
        const tex = this.textures.getTerrainTexture(theme, tile.terrain, checker);
        const isIce = tile.terrain === 'ice';
        const topMat = new THREE.MeshStandardMaterial({
          map: tex,
          roughness: isIce ? 0.1 : tile.terrain === 'mud' ? 0.34 : 0.88,
          metalness: isIce ? 0.22 : tile.terrain === 'mud' ? 0.08 : 0.02,
          emissive: isIce ? new THREE.Color('#38a8db') : new THREE.Color('#000000'),
          emissiveIntensity: isIce ? 0.14 : 0,
          bumpMap: this.textures.paperBump,
          bumpScale: isIce ? 0.002 : tile.terrain === 'mud' ? 0.005 : 0.018,
        });

        const bottomY = -0.14;
        const boxH = Math.max(baseTileH, surfaceY - bottomY);
        const geo = new THREE.BoxGeometry(tileFootprint, boxH, tileFootprint);
        const wallMat = elev > 0 ? cliffSideMat : sideTileMat;

        const mesh = compactMultiMaterialMesh(geo, [
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
        } else if (isIce) {
          addInkEdges(mesh, 0x9cecff, 0.42);
        }
        this.boardGroup.add(mesh);
        this.tilePickMeshes.push(mesh);

        // Decorative micro 3D paper props on special terrain tiles
        if (tile.terrain === 'burrow') {
          this.addBurrowPipeProp(wp.x, surfaceY, wp.z, x * 11 + y * 7, burrowRings);
        } else if (tile.terrain === 'bounce_pad') {
          this.addBounceMushroomProp(wp.x, surfaceY, wp.z, x * 13 + y * 5);
        } else if (tile.terrain === 'compost') {
          this.addCompostSprout(wp.x, surfaceY, wp.z, x * 7 + y * 13);
        } else if (tile.terrain === 'sunbeam') {
          this.addSunbeamShaft(wp.x, surfaceY, wp.z);
        } else if (tile.terrain === 'grass' && (x * 13 + y * 29) % 3 === 0) {
          this.addTinyGrassTuft(wp.x, surfaceY, wp.z, theme, x * 17 + y * 31);
        }
      }
    }

    if (waterSurfaces.length > 0 || lavaMats.length > 0 || burrowRings.length > 0) {
      this.animatedParts.push({
        update: (time) => {
          for (const w of waterSurfaces) {
            w.mesh.position.y = w.baseY + Math.sin(time * 2.4 + w.phase) * 0.014;
          }
          for (const l of lavaMats) {
            l.mat.emissiveIntensity = 0.72 + Math.sin(time * 3.1 + l.phase) * 0.28;
          }
          for (const br of burrowRings) {
            br.ring.rotation.y = time * 1.4 + br.phase;
            const sc = 1 + Math.sin(time * 3.8 + br.phase) * 0.06;
            br.ring.scale.set(sc, 1, sc);
          }
        },
      });
    }

    // 3. Garden Gate Archway for Reach-Gate Maps
    if (battle.gateTiles.length > 0) {
      this.buildGateArchway(battle);
    }

    // 4. Multi-Plane Paper Mario Diorama Scenery + Act-Specific 3D Weather!
    this.buildPerimeterFences(boardW, boardH, theme);
    this.buildStageBackdrop(boardW, boardH, theme);
    this.buildActWeather(boardW, boardH, theme);
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
      map: this.textures.treeBarkMap,
      color: overLava ? '#6e5c52' : '#9c6230',
      roughness: 0.86,
    });

    const deck = compactMultiMaterialMesh(new THREE.BoxGeometry(deckW * 0.94, deckH, deckW), [
      beamMat,
      beamMat,
      deckTopMat,
      beamMat,
      beamMat,
      beamMat,
    ]);
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

  private addBurrowPipeProp(
    x: number,
    y: number,
    z: number,
    seed: number,
    burrowRings: Array<{ ring: THREE.Mesh; phase: number }>
  ): void {
    const g = new THREE.Group();
    g.position.set(x, y, z);

    // Sculpted earth mound lip around the tunnel mouth
    const moundMat = new THREE.MeshStandardMaterial({
      color: '#7f5530',
      roughness: 0.92,
      bumpMap: this.textures.paperBump,
      bumpScale: 0.02,
    });
    const mound = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.1, 7, 16), moundMat);
    mound.rotation.x = Math.PI / 2;
    mound.position.y = 0.05;
    mound.castShadow = true;
    mound.receiveShadow = true;
    g.add(mound);

    // Dark recessed tunnel mouth disc
    const hole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.36, 0.36, 0.04, 16),
      new THREE.MeshBasicMaterial({ color: '#1b1108' })
    );
    hole.position.y = 0.015;
    g.add(hole);

    // Glowing animated turquoise warp collar ring!
    const collarGeo = new THREE.RingGeometry(0.35, 0.44, 20);
    collarGeo.rotateX(-Math.PI / 2);
    const collarMat = new THREE.MeshBasicMaterial({
      color: '#3cf0de',
      transparent: true,
      opacity: 0.85,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const collar = new THREE.Mesh(collarGeo, collarMat);
    collar.position.y = 0.09;
    g.add(collar);
    burrowRings.push({ ring: collar, phase: seed * 0.4 });

    // Cute miniature wooden signpost at corner so warp pipe reads cleanly from far away
    const post = new THREE.Mesh(
      new THREE.BoxGeometry(0.06, 0.36, 0.06),
      new THREE.MeshStandardMaterial({ map: this.textures.treeBarkMap, color: '#9e6634', roughness: 0.88 })
    );
    post.position.set(0.42, 0.18, -0.38);
    post.castShadow = true;
    const sign = new THREE.Mesh(
      new THREE.BoxGeometry(0.24, 0.12, 0.04),
      new THREE.MeshStandardMaterial({ color: '#39d8c9', emissive: '#148f85', emissiveIntensity: 0.35, roughness: 0.65 })
    );
    sign.position.set(0.42, 0.32, -0.38);
    sign.rotation.y = 0.25;
    addInkEdges(sign, 0x263f3d, 0.7);
    g.add(post, sign);

    this.sceneryGroup.add(g);
  }

  private addBounceMushroomProp(x: number, y: number, z: number, seed: number): void {
    const g = new THREE.Group();
    g.position.set(x, y, z);

    // Cream mushroom stem with warm wood/paper texture
    const stem = new THREE.Mesh(
      new THREE.CylinderGeometry(0.18, 0.24, 0.24, 12),
      new THREE.MeshStandardMaterial({
        map: this.textures.woodTokenMap,
        color: '#fbf0d9',
        roughness: 0.85,
      })
    );
    stem.position.y = 0.12;
    stem.castShadow = true;
    g.add(stem);

    // Vibrant storybook polka-dot toadstool cap with painted texture + cream under-gills!
    const capGroup = new THREE.Group();
    capGroup.position.y = 0.24;
    const cap = new THREE.Mesh(
      new THREE.SphereGeometry(0.46, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.56),
      new THREE.MeshStandardMaterial({
        map: this.textures.mushroomCapMap,
        emissive: '#540c18',
        emissiveIntensity: 0.14,
        roughness: 0.52,
        bumpMap: this.textures.paperBump,
        bumpScale: 0.015,
      })
    );
    cap.scale.set(1.06, 0.6, 1.06);
    cap.castShadow = true;
    cap.receiveShadow = true;
    capGroup.add(cap);

    // Cream ruffled gills disc under cap rim
    const gills = new THREE.Mesh(
      new THREE.CylinderGeometry(0.44, 0.44, 0.03, 16),
      new THREE.MeshStandardMaterial({ color: '#f5e4c2', roughness: 0.9 })
    );
    gills.position.y = 0.02;
    capGroup.add(gills);

    g.add(capGroup);

    // Subtle shimmering magenta spring halo ring
    const ringGeo = new THREE.RingGeometry(0.42, 0.5, 22);
    ringGeo.rotateX(-Math.PI / 2);
    const ring = new THREE.Mesh(
      ringGeo,
      new THREE.MeshBasicMaterial({
        color: '#ff70b8',
        transparent: true,
        opacity: 0.72,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
    );
    ring.position.y = 0.03;
    g.add(ring);

    this.sceneryGroup.add(g);

    const phase = seed * 0.35;
    this.animatedParts.push({
      update: (time) => {
        const sq = Math.sin(time * 3.8 + phase) * 0.08;
        capGroup.scale.set(1 + sq * 0.6, 1 - sq, 1 + sq * 0.6);
        capGroup.position.y = 0.24 + Math.max(0, Math.sin(time * 3.8 + phase)) * 0.04;
        ring.rotation.y = time * 1.1 + phase;
      },
    });
  }

  private buildActWeather(boardW: number, boardH: number, theme: BoardTheme): void {
    const weatherGroup = new THREE.Group();
    const spanX = boardW + 3.2;
    const spanZ = boardH + 2.6;

    if (theme === 'spring') {
      // 14 Drifting cream dandelion puffs + 3 fluttering 2-wing pastel paper butterflies!
      const puffGeo = new THREE.OctahedronGeometry(0.06, 0);
      const puffMat = new THREE.MeshBasicMaterial({
        color: '#fffdf2',
        transparent: true,
        opacity: 0.82,
      });
      const puffs: Array<{ mesh: THREE.Mesh; bx: number; by: number; bz: number; speed: number; phase: number }> = [];
      for (let i = 0; i < 14; i++) {
        const m = new THREE.Mesh(puffGeo, puffMat);
        const bx = ((i * 37) % 100) / 100 * spanX - spanX / 2;
        const bz = ((i * 53) % 100) / 100 * spanZ - spanZ / 2;
        const by = 1.2 + (i % 5) * 0.55;
        m.position.set(bx, by, bz);
        weatherGroup.add(m);
        puffs.push({ mesh: m, bx, by, bz, speed: 0.35 + (i % 4) * 0.12, phase: i * 1.17 });
      }

      const bColors = ['#ffe066', '#ffa6c4', '#85e3ff'];
      const wingGeo = new THREE.CircleGeometry(0.11, 5);
      const butterflies: Array<{ group: THREE.Group; wingL: THREE.Mesh; wingR: THREE.Mesh; rx: number; rz: number; y: number; phase: number }> = [];
      for (let i = 0; i < 3; i++) {
        const bg = new THREE.Group();
        const wMat = new THREE.MeshBasicMaterial({ color: bColors[i], side: THREE.DoubleSide });
        const wingL = new THREE.Mesh(wingGeo, wMat);
        wingL.position.x = -0.07;
        const wingR = new THREE.Mesh(wingGeo, wMat);
        wingR.position.x = 0.07;
        bg.add(wingL, wingR);
        weatherGroup.add(bg);
        butterflies.push({
          group: bg,
          wingL,
          wingR,
          rx: 2.2 + i * 1.1,
          rz: 2.0 + i * 0.9,
          y: 1.65 + i * 0.45,
          phase: i * 2.1,
        });
      }

      this.sceneryGroup.add(weatherGroup);
      this.animatedParts.push({
        update: (time) => {
          for (const p of puffs) {
            const driftX = ((p.bx + time * p.speed + spanX / 2) % spanX) - spanX / 2;
            p.mesh.position.set(
              driftX,
              p.by + Math.sin(time * 1.4 + p.phase) * 0.28,
              p.bz + Math.cos(time * 0.9 + p.phase) * 0.35
            );
            p.mesh.rotation.y = time * 1.5 + p.phase;
          }
          for (const b of butterflies) {
            const ang = time * 0.55 + b.phase;
            const nx = Math.cos(ang) * b.rx;
            const nz = Math.sin(ang * 0.85) * b.rz;
            b.group.position.set(nx, b.y + Math.sin(time * 3.4 + b.phase) * 0.26, nz);
            b.group.rotation.y = -ang;
            const flap = Math.sin(time * 16 + b.phase) * 0.85;
            b.wingL.rotation.y = flap;
            b.wingR.rotation.y = -flap;
          }
        },
      });
    } else if (theme === 'greenhouse') {
      // Shimmering golden pollen + warm gentle greenhouse steam puffs!
      const pollenGeo = new THREE.OctahedronGeometry(0.05, 0);
      const pollenMat = new THREE.MeshBasicMaterial({ color: '#ffea80', transparent: true, opacity: 0.85 });
      const steamGeo = new THREE.SphereGeometry(0.18, 7, 6);
      const steamMat = new THREE.MeshBasicMaterial({ color: '#fff8e6', transparent: true, opacity: 0.16, depthWrite: false });
      const specks: Array<{ mesh: THREE.Mesh; bx: number; bz: number; phase: number }> = [];
      const steams: Array<{ mesh: THREE.Mesh; bx: number; bz: number; phase: number }> = [];

      for (let i = 0; i < 16; i++) {
        const m = new THREE.Mesh(pollenGeo, pollenMat);
        const bx = ((i * 41) % 100) / 100 * spanX - spanX / 2;
        const bz = ((i * 61) % 100) / 100 * spanZ - spanZ / 2;
        weatherGroup.add(m);
        specks.push({ mesh: m, bx, bz, phase: i * 0.95 });
      }
      for (let i = 0; i < 8; i++) {
        const s = new THREE.Mesh(steamGeo, steamMat);
        const bx = ((i * 29) % 100) / 100 * (boardW * 0.85) - boardW * 0.425;
        const bz = ((i * 47) % 100) / 100 * (boardH * 0.75) - boardH * 0.375;
        weatherGroup.add(s);
        steams.push({ mesh: s, bx, bz, phase: i * 1.4 });
      }
      this.sceneryGroup.add(weatherGroup);
      this.animatedParts.push({
        update: (time) => {
          for (const sp of specks) {
            const cyc = (time * 0.38 + sp.phase) % 2.6;
            sp.mesh.position.set(
              sp.bx + Math.sin(time * 1.3 + sp.phase) * 0.32,
              0.7 + cyc * 1.15,
              sp.bz + Math.cos(time * 1.1 + sp.phase) * 0.32
            );
            sp.mesh.rotation.y = time * 2.2;
          }
          for (const st of steams) {
            const cyc = (time * 0.32 + st.phase) % 2.4;
            st.mesh.position.set(
              st.bx + Math.sin(time * 0.9 + st.phase) * 0.25,
              0.35 + cyc * 1.25,
              st.bz
            );
            st.mesh.scale.setScalar(0.65 + cyc * 0.55);
          }
        },
      });
    } else if (theme === 'winter') {
      // WINTER: 30 gently tumbling translucent cut-paper snowflakes + warm drifting hearth embers!
      const flakeGeo = new THREE.OctahedronGeometry(0.068, 0);
      const flakeMat = new THREE.MeshBasicMaterial({
        color: '#f2fbff',
        transparent: true,
        opacity: 0.88,
      });
      const flakes: Array<{ mesh: THREE.Mesh; bx: number; bz: number; speed: number; phase: number }> = [];
      for (let i = 0; i < 30; i++) {
        const m = new THREE.Mesh(flakeGeo, flakeMat);
        const bx = ((i * 37) % 100) / 100 * spanX - spanX / 2;
        const bz = ((i * 53) % 100) / 100 * spanZ - spanZ / 2;
        weatherGroup.add(m);
        flakes.push({ mesh: m, bx, bz, speed: 0.42 + (i % 5) * 0.09, phase: i * 1.19 });
      }
      const emberGeo = new THREE.SphereGeometry(0.048, 6, 6);
      const embers: Array<{ mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; bx: number; by: number; bz: number; phase: number }> = [];
      for (let i = 0; i < 8; i++) {
        const em = new THREE.MeshBasicMaterial({ color: '#ffcf6b', transparent: true, opacity: 0.85 });
        const m = new THREE.Mesh(emberGeo, em);
        const bx = ((i * 47) % 100) / 100 * spanX - spanX / 2;
        const bz = ((i * 71) % 100) / 100 * spanZ - spanZ / 2;
        weatherGroup.add(m);
        embers.push({ mesh: m, mat: em, bx, by: 0.65 + (i % 3) * 0.4, bz, phase: i * 1.9 });
      }
      this.sceneryGroup.add(weatherGroup);
      this.animatedParts.push({
        update: (time) => {
          for (const fl of flakes) {
            const cyc = (time * fl.speed + fl.phase) % 4.0;
            const y = 4.6 - cyc * 1.12;
            fl.mesh.position.set(
              fl.bx + Math.sin(time * 1.3 + fl.phase) * 0.48,
              Math.max(0.05, y),
              fl.bz + Math.cos(time * 0.95 + fl.phase) * 0.34
            );
            fl.mesh.rotation.set(time * 1.6 + fl.phase, time * 1.2, fl.phase);
          }
          for (const em of embers) {
            em.mesh.position.set(
              em.bx + Math.sin(time * 1.0 + em.phase) * 0.38,
              em.by + Math.sin(time * 1.7 + em.phase) * 0.24,
              em.bz + Math.cos(time * 0.85 + em.phase) * 0.38
            );
            em.mat.opacity = 0.3 + (0.5 + 0.5 * Math.sin(time * 4.2 + em.phase)) * 0.65;
          }
        },
      });
    } else {
      // AUTUMN: Tumbling cut-paper crimson/amber maple leaves + warm glowing twilight fireflies!
      const leafGeo = new THREE.PlaneGeometry(0.18, 0.14);
      const leafCols = ['#d94726', '#eb8826', '#f2bd33', '#b83228'];
      const leaves: Array<{ mesh: THREE.Mesh; bx: number; bz: number; speed: number; phase: number }> = [];
      for (let i = 0; i < 18; i++) {
        const lm = new THREE.MeshBasicMaterial({
          color: leafCols[i % leafCols.length],
          side: THREE.DoubleSide,
        });
        const m = new THREE.Mesh(leafGeo, lm);
        const bx = ((i * 31) % 100) / 100 * spanX - spanX / 2;
        const bz = ((i * 59) % 100) / 100 * spanZ - spanZ / 2;
        weatherGroup.add(m);
        leaves.push({ mesh: m, bx, bz, speed: 0.48 + (i % 4) * 0.1, phase: i * 1.33 });
      }

      const fireflyGeo = new THREE.SphereGeometry(0.055, 6, 6);
      const fireflies: Array<{ mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; bx: number; by: number; bz: number; phase: number }> = [];
      for (let i = 0; i < 10; i++) {
        const fm = new THREE.MeshBasicMaterial({ color: '#ffea6b', transparent: true, opacity: 0.9 });
        const m = new THREE.Mesh(fireflyGeo, fm);
        const bx = ((i * 43) % 100) / 100 * spanX - spanX / 2;
        const bz = ((i * 67) % 100) / 100 * spanZ - spanZ / 2;
        const by = 0.8 + (i % 4) * 0.48;
        weatherGroup.add(m);
        fireflies.push({ mesh: m, mat: fm, bx, by, bz, phase: i * 1.7 });
      }

      this.sceneryGroup.add(weatherGroup);
      this.animatedParts.push({
        update: (time) => {
          for (const lf of leaves) {
            const cyc = (time * lf.speed + lf.phase) % 3.6;
            const y = 4.2 - cyc * 1.15;
            lf.mesh.position.set(
              lf.bx + Math.sin(time * 1.6 + lf.phase) * 0.55,
              Math.max(0.06, y),
              lf.bz + Math.cos(time * 1.2 + lf.phase) * 0.35
            );
            lf.mesh.rotation.set(time * 2.1 + lf.phase, time * 1.6, Math.sin(time * 2.8 + lf.phase) * 0.8);
          }
          for (const ff of fireflies) {
            ff.mesh.position.set(
              ff.bx + Math.sin(time * 1.1 + ff.phase) * 0.45,
              ff.by + Math.cos(time * 1.5 + ff.phase) * 0.28,
              ff.bz + Math.sin(time * 0.9 + ff.phase) * 0.4
            );
            ff.mat.opacity = 0.25 + (0.5 + 0.5 * Math.sin(time * 3.8 + ff.phase)) * 0.72;
          }
        },
      });
    }
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
    // Keep micro-props near tile corners so standees & tactical rings stay crystal clear
    const cornerX = (seed % 2 === 0 ? 1 : -1) * (0.31 + ((seed >> 2) % 3) * 0.05);
    const cornerZ = (((seed >> 1) % 2 === 0) ? 1 : -1) * (0.31 + ((seed >> 3) % 3) * 0.05);
    const color =
      theme === 'winter'
        ? '#588a7a'
        : theme === 'autumn'
          ? '#c98e2b'
          : theme === 'greenhouse'
            ? '#58a836'
            : '#58a62d';
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.85, side: THREE.DoubleSide });
    const tuft = new THREE.Group();
    tuft.position.set(x + cornerX, y, z + cornerZ);
    const bladeGeo = new THREE.ConeGeometry(0.028, 0.16, 4);
    for (let i = -1; i <= 1; i++) {
      const b = new THREE.Mesh(bladeGeo, mat);
      b.position.set(i * 0.036, 0.07, (i === 0 ? 0.02 : -0.015));
      b.rotation.z = -i * 0.3;
      tuft.add(b);
    }

    // Seasonal micro-detail: bright spring/greenhouse wildflower, mossy pebble, winter snow puff, or autumn leaf!
    if (theme === 'winter') {
      const snowPuff = new THREE.Mesh(
        new THREE.DodecahedronGeometry(0.06, 0),
        new THREE.MeshStandardMaterial({ color: '#f2f9ff', roughness: 0.72 })
      );
      snowPuff.scale.set(1.25, 0.55, 1.15);
      snowPuff.position.set(-0.04, 0.025, 0.03);
      tuft.add(snowPuff);
    } else if (seed % 5 === 0) {
      // Cute smooth miniature garden pebble beside grass blades
      const pebble = new THREE.Mesh(
        new THREE.DodecahedronGeometry(0.055, 0),
        new THREE.MeshStandardMaterial({ map: this.textures.stoneMap, roughness: 0.9, flatShading: true })
      );
      pebble.scale.set(1.2, 0.65, 1.0);
      pebble.position.set(-0.07, 0.028, 0.04);
      tuft.add(pebble);
    } else if (theme !== 'autumn' && seed % 2 === 0) {
      const flowerColors = theme === 'greenhouse' ? ['#fff6c4', '#ffd86b'] : ['#fffdf2', '#ffacc4', '#ffe169'];
      const flw = new THREE.Mesh(
        new THREE.CylinderGeometry(0.048, 0.048, 0.014, 7),
        new THREE.MeshStandardMaterial({ color: flowerColors[seed % flowerColors.length], roughness: 0.72 })
      );
      flw.position.set(0.055, 0.13, 0.02);
      flw.rotation.x = 0.35;
      const center = new THREE.Mesh(
        new THREE.SphereGeometry(0.018, 6, 5),
        new THREE.MeshBasicMaterial({ color: '#f5b82e' })
      );
      center.position.set(0.055, 0.142, 0.024);
      tuft.add(flw, center);
    } else if (theme === 'autumn' && seed % 2 === 0) {
      const leaf = new THREE.Mesh(
        new THREE.CircleGeometry(0.058, 5),
        new THREE.MeshStandardMaterial({
          color: seed % 4 === 0 ? '#d94826' : '#eb9226',
          roughness: 0.8,
          side: THREE.DoubleSide,
        })
      );
      leaf.rotation.x = -Math.PI / 2 + 0.12;
      leaf.position.set(0.06, 0.015, 0.04);
      tuft.add(leaf);
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

    const postMat = new THREE.MeshStandardMaterial({
      map: this.textures.treeBarkMap,
      color: '#b0713a',
      roughness: 0.86,
    });
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
      map: this.textures.fenceWoodMap,
      color:
        theme === 'winter'
          ? '#e8f4fa'
          : theme === 'greenhouse'
            ? '#d4e8cf'
            : theme === 'autumn'
              ? '#ebd2ab'
              : '#fff6e0',
      roughness: 0.84,
      bumpMap: this.textures.paperBump,
      bumpScale: 0.015,
    });
    const railMat = new THREE.MeshStandardMaterial({
      map: this.textures.fenceWoodMap,
      color: theme === 'winter' ? '#b8d1e0' : theme === 'greenhouse' ? '#aac7a4' : '#e0c496',
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

      // One instanced mesh for all pickets and one for all caps: two draw calls per fence
      // run instead of two per picket.
      const posts = Math.max(3, Math.floor(length / 0.42));
      const postMesh = new THREE.InstancedMesh(postGeo, woodMat, posts + 1);
      const capMesh = new THREE.InstancedMesh(picketCapGeo, woodMat, posts + 1);
      const m = new THREE.Matrix4();
      for (let i = 0; i <= posts; i++) {
        const px = -length / 2 + (i / posts) * length;
        postMesh.setMatrixAt(i, m.makeTranslation(px, 0.23, 0.02));
        capMesh.setMatrixAt(i, m.makeTranslation(px, 0.51, 0.02));
      }
      postMesh.castShadow = true;
      g.add(postMesh, capMesh);
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

    // Staggered Hand-Painted Watercolor Cardboard Hills behind the garden!
    const hillSpecs = [
      { x: -boardW * 0.45, z: northZ - 1.1, r: 2.5, h: 1.55 },
      { x: boardW * 0.38, z: northZ - 1.4, r: 2.8, h: 1.75 },
      { x: 0.1, z: northZ - 2.3, r: 3.7, h: 2.3 },
    ];

    hillSpecs.forEach((hs, idx) => {
      const hillShape = new THREE.Shape();
      hillShape.absarc(0, 0, hs.r, 0, Math.PI, false);
      hillShape.lineTo(-hs.r, 0);
      const extrude = new THREE.ExtrudeGeometry(hillShape, {
        depth: 0.16,
        bevelEnabled: true,
        bevelThickness: 0.035,
        bevelSize: 0.035,
        bevelSegments: 2,
      });
      // Normalize UVs across [0..1] so the painted hill meadow & wildflowers map cleanly!
      const posAttr = extrude.attributes.position;
      const uvAttr = extrude.attributes.uv;
      for (let i = 0; i < posAttr.count; i++) {
        const vx = posAttr.getX(i);
        const vy = posAttr.getY(i);
        uvAttr.setXY(i, (vx + hs.r) / (hs.r * 2), 1 - Math.max(0, Math.min(1, vy / hs.r)));
      }
      uvAttr.needsUpdate = true;

      const hillMat = new THREE.MeshStandardMaterial({
        map: this.textures.getHillBackdropTexture(theme, idx),
        roughness: 0.88,
        bumpMap: this.textures.paperBump,
        bumpScale: 0.02,
      });
      const hill = new THREE.Mesh(extrude, hillMat);
      hill.position.set(hs.x, -0.68, hs.z);
      hill.scale.set(1, hs.h / hs.r, 1);
      hill.castShadow = true;
      hill.receiveShadow = true;
      addInkEdges(hill, 0x3b2410, 0.5, 32);
      this.sceneryGroup.add(hill);
    });

    // Layered Cartoon-Watercolor Trees flanking the diorama (mixed cherry blossom / orchard / maple / winter pine crowns!)
    const treePositions = [
      { x: -boardW / 2 - 1.4, z: -boardH * 0.36, s: 1.12 },
      { x: boardW / 2 + 1.42, z: -boardH * 0.3, s: 1.04 },
      { x: -boardW / 2 - 1.52, z: boardH * 0.14, s: 0.94 },
      { x: boardW / 2 + 1.5, z: boardH * 0.22, s: 1.0 },
    ];
    for (let i = 0; i < treePositions.length; i++) {
      const tp = treePositions[i];
      this.addPaperTree(tp.x, -0.68, tp.z, tp.s, theme, i);
    }

    // Theme-specific Centerpiece Stage Prop behind row 0
    if (theme === 'greenhouse') {
      this.addGreenhouseArches(boardW, northZ + 0.55);
      this.addMiniPumpkins(-boardW / 2 - 0.95, -0.68, -boardH * 0.06);
    } else if (theme === 'autumn') {
      this.addMiniatureBarn(boardW * 0.36, -0.68, northZ - 0.15, true);
      this.addMiniPumpkins(-boardW / 2 - 0.95, -0.68, -boardH * 0.08);
    } else if (theme === 'winter') {
      this.addMiniatureBarn(-boardW * 0.32, -0.68, northZ - 0.2, false);
      // Warm glowing hearth lanterns perched on wooden posts flanking the winter snow-field!
      const postMat = new THREE.MeshStandardMaterial({ map: this.textures.treeBarkMap, color: '#6b4528', roughness: 0.9 });
      const glowMat = new THREE.MeshStandardMaterial({
        color: '#ffdf85',
        emissive: '#ff9624',
        emissiveIntensity: 1.1,
        roughness: 0.2,
      });
      const hearthLights: Array<{ light: THREE.PointLight; phase: number }> = [];
      for (const sx of [-1, 1]) {
        const lGroup = new THREE.Group();
        lGroup.position.set(sx * (boardW / 2 + 0.85), -0.68, -boardH * 0.12);
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.14, 1.85, 0.14), postMat);
        post.position.y = 0.92;
        post.castShadow = true;
        const arm = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.1, 0.1), postMat);
        arm.position.set(-sx * 0.18, 1.78, 0);
        const lantern = new THREE.Mesh(new THREE.OctahedronGeometry(0.22, 0), glowMat);
        lantern.position.set(-sx * 0.32, 1.52, 0);
        const hearthLight = new THREE.PointLight(0xffa438, 3.6, 8.8, 1.45);
        hearthLight.position.set(-sx * 0.32, 1.55, 0.12);
        lGroup.add(post, arm, lantern, hearthLight);
        hearthLights.push({ light: hearthLight, phase: sx > 0 ? 1.7 : 0.3 });
        this.sceneryGroup.add(lGroup);
      }
      this.animatedParts.push({
        update: (time) => {
          for (const hl of hearthLights) {
            hl.light.intensity =
              3.2 + Math.sin(time * 5.2 + hl.phase) * 0.42 + Math.sin(time * 11.7 + hl.phase) * 0.18;
          }
        },
      });
    } else {
      this.addMiniatureBarn(-boardW * 0.32, -0.68, northZ - 0.2, false);
    }

    // Cheerful Hanging Cut-Paper Sun / Winter Moon Medallion suspended on brass wire behind the hills!
    const sunGroup = new THREE.Group();
    const sunX = theme === 'autumn' ? -boardW * 0.38 : boardW * 0.42;
    const sunY = 3.55;
    const sunZ = northZ - 2.65;
    sunGroup.position.set(sunX, sunY, sunZ);
    const sunCoreMat = new THREE.MeshStandardMaterial({
      color: theme === 'winter' ? '#e8f6ff' : theme === 'autumn' ? '#ff9933' : '#ffe159',
      emissive: theme === 'winter' ? '#7abce8' : theme === 'autumn' ? '#b34b00' : '#d48d00',
      emissiveIntensity: 0.38,
      roughness: 0.5,
    });
    const sunDisc = new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.46, 0.1, 18), sunCoreMat);
    sunDisc.rotation.x = Math.PI / 2;
    addInkEdges(sunDisc, 0x6b3a10, 0.5);
    sunGroup.add(sunDisc);
    const rayGeo = new THREE.ConeGeometry(0.11, 0.28, 3);
    const rayMat = new THREE.MeshStandardMaterial({
      color: theme === 'winter' ? '#c2e8ff' : theme === 'autumn' ? '#ffba42' : '#fff08a',
      emissive: theme === 'winter' ? '#589ec9' : '#b36b00',
      emissiveIntensity: 0.25,
      roughness: 0.6,
    });
    for (let r = 0; r < 10; r++) {
      const a = (r / 10) * Math.PI * 2;
      const ray = new THREE.Mesh(rayGeo, rayMat);
      ray.position.set(Math.cos(a) * 0.62, Math.sin(a) * 0.62, 0);
      ray.rotation.z = a - Math.PI / 2;
      sunGroup.add(ray);
    }
    this.sceneryGroup.add(sunGroup);
    const sunWire = new THREE.Mesh(
      new THREE.CylinderGeometry(0.015, 0.015, sunY + 0.68, 6),
      new THREE.MeshStandardMaterial({ color: '#c4a158', metalness: 0.6, roughness: 0.4 })
    );
    sunWire.position.set(sunX, (sunY - 0.68) / 2, sunZ - 0.05);
    this.sceneryGroup.add(sunWire);
    this.animatedParts.push({
      update: (time) => {
        sunGroup.rotation.z = time * 0.22;
        sunGroup.position.y = sunY + Math.sin(time * 0.9) * 0.08;
      },
    });

    // Floating Watercolor Paper Mario Clouds mounted on thin brass wire rods!
    const cloudConfigs = [
      { x: -boardW * 0.28, y: 2.95, z: northZ - 1.9, s: 1.04 },
      { x: boardW * 0.16, y: 3.35, z: northZ - 2.35, s: 1.18 },
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

    // Grassy or snowy root mound anchoring the tree to the desk!
    const moundMat = new THREE.MeshStandardMaterial({
      color: theme === 'winter' ? '#e8f4fa' : theme === 'autumn' ? '#c99338' : '#76b53c',
      roughness: 0.9,
      bumpMap: this.textures.paperBump,
      bumpScale: 0.015,
    });
    const mound = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.56, 0.14, 10), moundMat);
    mound.position.y = 0.07;
    mound.receiveShadow = true;
    tree.add(mound);

    const trunkMat = new THREE.MeshStandardMaterial({
      map: this.textures.treeBarkMap,
      roughness: 0.9,
      bumpMap: this.textures.paperBump,
      bumpScale: 0.02,
    });
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.18, 1.35, 9), trunkMat);
    trunk.position.y = 0.72;
    trunk.castShadow = true;
    addInkEdges(trunk, 0x3b2210, 0.5);
    tree.add(trunk);

    const foliageVariant =
      theme === 'winter'
        ? 'winter_pine'
        : theme === 'autumn'
          ? idx % 2 === 0
            ? 'autumn_crimson'
            : 'autumn_gold'
          : theme === 'greenhouse'
            ? 'summer_citrus'
            : idx % 2 === 1
              ? 'spring_blossom'
              : 'spring_green';

    const foliageMat = new THREE.MeshStandardMaterial({
      map: this.textures.getTreeFoliageTexture(foliageVariant),
      roughness: 0.84,
      bumpMap: this.textures.paperBump,
      bumpScale: 0.018,
    });

    if (theme !== 'winter' && (idx % 2 === 1 || theme === 'autumn')) {
      // Plump cartoon storybook round-crown tree (cherry blossom / golden maple / citrus!)
      const crownSpecs: Array<[number, number, number, number]> = [
        [0, 1.65, 0, 0.66],
        [-0.42, 1.42, 0.16, 0.48],
        [0.44, 1.45, -0.1, 0.46],
        [0.04, 2.02, 0.06, 0.44],
      ];
      for (const [ox, oy, oz, r] of crownSpecs) {
        const puff = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 1), foliageMat);
        puff.position.set(ox, oy, oz);
        puff.rotation.set(ox, idx * 0.7, oz);
        puff.castShadow = true;
        puff.receiveShadow = true;
        tree.add(puff);
      }
    } else {
      // Layered scalloped orchard or winter frosted pine with textured painted foliage tiers!
      const tiers = [
        { y: 1.32, r: 0.82, h: 0.6 },
        { y: 1.8, r: 0.64, h: 0.54 },
        { y: 2.22, r: 0.43, h: 0.45 },
      ];
      tiers.forEach((tier, ti) => {
        const cone = new THREE.Mesh(new THREE.ConeGeometry(tier.r, tier.h, 9), foliageMat);
        cone.position.y = tier.y;
        cone.rotation.y = ti * 0.6;
        cone.castShadow = true;
        cone.receiveShadow = true;
        addInkEdges(cone, 0x3a2410, 0.35);
        tree.add(cone);
      });
    }

    this.sceneryGroup.add(tree);

    this.animatedParts.push({
      update: (time) => {
        tree.rotation.z = Math.sin(time * 1.2 + idx * 1.4) * 0.022;
      },
    });
  }

  private addMiniatureBarn(x: number, y: number, z: number, isAutumn = false): void {
    const barn = new THREE.Group();
    barn.position.set(x, y, z);
    barn.rotation.y = isAutumn ? -0.2 : 0.22;

    const wallMat = new THREE.MeshStandardMaterial({
      map: this.textures.barnWallMap,
      color: isAutumn ? '#d99888' : '#ffffff',
      roughness: 0.86,
      bumpMap: this.textures.paperBump,
      bumpScale: 0.018,
    });
    const trimMat = new THREE.MeshStandardMaterial({
      map: this.textures.fenceWoodMap,
      color: '#fff8e6',
      roughness: 0.84,
    });
    const roofMat = new THREE.MeshStandardMaterial({
      map: this.textures.barnRoofMap,
      roughness: 0.88,
      bumpMap: this.textures.paperBump,
      bumpScale: 0.02,
    });

    const body = new THREE.Mesh(new THREE.BoxGeometry(1.78, 1.4, 1.3), wallMat);
    body.position.y = 0.7;
    body.castShadow = true;
    body.receiveShadow = true;
    addInkEdges(body);
    barn.add(body);

    // Shingled pitched storybook roof
    const roofGeo = new THREE.ConeGeometry(1.48, 0.9, 4);
    roofGeo.rotateY(Math.PI / 4);
    const roof = new THREE.Mesh(roofGeo, roofMat);
    roof.position.y = 1.82;
    roof.scale.set(1.1, 1, 0.84);
    roof.castShadow = true;
    addInkEdges(roof);
    barn.add(roof);

    // Framed white barn X-doors + dark hayloft window with golden hay peeking out!
    const door = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.74, 0.07), trimMat);
    door.position.set(0, 0.37, 0.66);
    addInkEdges(door);
    barn.add(door);

    const loftFrame = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.32, 0.07), trimMat);
    loftFrame.position.set(0, 1.06, 0.66);
    const loftInner = new THREE.Mesh(
      new THREE.BoxGeometry(0.32, 0.22, 0.08),
      new THREE.MeshStandardMaterial({ color: '#3b2010', roughness: 0.9 })
    );
    loftInner.position.set(0, 1.06, 0.67);
    const hayPeek = new THREE.Mesh(
      new THREE.BoxGeometry(0.24, 0.1, 0.12),
      new THREE.MeshStandardMaterial({ map: this.textures.haystackMap, roughness: 0.9 })
    );
    hayPeek.position.set(0, 1.0, 0.69);
    barn.add(loftFrame, loftInner, hayPeek);

    // Cute Cylindrical Storybook Silo beside the Barn!
    const siloSide = isAutumn ? 1 : -1;
    const silo = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.38, 1.72, 14), wallMat);
    silo.position.set(siloSide * 1.16, 0.86, -0.14);
    silo.castShadow = true;
    silo.receiveShadow = true;
    const siloDome = new THREE.Mesh(
      new THREE.SphereGeometry(0.37, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.55),
      roofMat
    );
    siloDome.position.set(siloSide * 1.16, 1.72, -0.14);
    siloDome.castShadow = true;
    barn.add(silo, siloDome);

    // Gently spinning Wooden Farm Windmill Tower on the opposite side of the Barn!
    const millTower = new THREE.Mesh(
      new THREE.CylinderGeometry(0.18, 0.32, 1.65, 8),
      new THREE.MeshStandardMaterial({ map: this.textures.fenceWoodMap, color: '#e6c99c', roughness: 0.88 })
    );
    millTower.position.set(-siloSide * 1.24, 0.82, -0.18);
    millTower.castShadow = true;
    addInkEdges(millTower, 0x452a16, 0.45);
    barn.add(millTower);

    const blades = new THREE.Group();
    blades.position.set(-siloSide * 1.24, 1.56, 0.06);
    const bladeMat = new THREE.MeshStandardMaterial({
      map: this.textures.fenceWoodMap,
      color: '#fff8e2',
      roughness: 0.82,
    });
    for (let b = 0; b < 4; b++) {
      const sail = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.62, 0.03), bladeMat);
      const ang = (b / 4) * Math.PI * 2;
      sail.position.set(Math.cos(ang) * 0.34, Math.sin(ang) * 0.34, 0);
      sail.rotation.z = ang - Math.PI / 2;
      sail.castShadow = true;
      addInkEdges(sail, 0x452a16, 0.55);
      blades.add(sail);
    }
    const hub = new THREE.Mesh(
      new THREE.CylinderGeometry(0.08, 0.08, 0.08, 10),
      new THREE.MeshStandardMaterial({ color: '#c44536', roughness: 0.7 })
    );
    hub.rotation.x = Math.PI / 2;
    blades.add(hub);
    barn.add(blades);

    this.sceneryGroup.add(barn);
    this.animatedParts.push({
      update: (time) => {
        blades.rotation.z = -time * 0.85;
      },
    });
  }

  private addGreenhouseArches(boardW: number, zPos: number): void {
    const brassMat = new THREE.MeshStandardMaterial({ color: '#c7a048', metalness: 0.42, roughness: 0.45 });
    const glassMat = new THREE.MeshStandardMaterial({
      color: '#ccf7e6',
      transparent: true,
      opacity: 0.28,
      roughness: 0.16,
      side: THREE.DoubleSide,
    });
    const archGroup = new THREE.Group();
    archGroup.position.set(0, -0.1, zPos);
    const radius = Math.min(4.2, boardW * 0.44);
    const ribGeo = new THREE.TorusGeometry(radius, 0.08, 8, 24, Math.PI);
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
    const mat = new THREE.MeshStandardMaterial({
      map: this.textures.pumpkinSkinMap,
      roughness: 0.65,
      bumpMap: this.textures.paperBump,
      bumpScale: 0.015,
    });
    const stemMat = new THREE.MeshStandardMaterial({ color: '#4d7a26', roughness: 0.88 });
    for (const [ox, oz, s] of [
      [0, 0, 0.36],
      [0.44, 0.34, 0.26],
      [-0.3, 0.42, 0.22],
    ]) {
      const p = new THREE.Group();
      p.position.set(x + ox, y + s * 0.72, z + oz);
      const body = new THREE.Mesh(new THREE.SphereGeometry(s, 14, 10), mat);
      body.scale.set(1.16, 0.78, 1.16);
      body.castShadow = true;
      body.receiveShadow = true;
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.055, 0.18, 6), stemMat);
      stem.position.y = s * 0.82;
      stem.rotation.z = -0.2;
      p.add(body, stem);
      this.sceneryGroup.add(p);
    }
  }

  private createPaperCloud(scale: number): THREE.Group {
    const g = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({
      map: this.textures.cloudMap,
      roughness: 0.88,
      bumpMap: this.textures.paperBump,
      bumpScale: 0.01,
    });
    const rimMat = new THREE.MeshBasicMaterial({ color: '#5c422c' });
    const puffs = [
      { x: 0, y: 0.14, r: 0.5 },
      { x: -0.44, y: 0, r: 0.37 },
      { x: 0.45, y: -0.02, r: 0.35 },
    ];
    for (const pf of puffs) {
      const rim = new THREE.Mesh(new THREE.CylinderGeometry(pf.r + 0.035, pf.r + 0.035, 0.08, 16), rimMat);
      rim.rotation.x = Math.PI / 2;
      rim.position.set(pf.x, pf.y, -0.03);
      g.add(rim);

      const disc = new THREE.Mesh(new THREE.CylinderGeometry(pf.r, pf.r, 0.12, 16), mat);
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
      height = cover.isObjectiveCrate ? 0.78 : 0.66;
      const mat = new THREE.MeshStandardMaterial({
        map: cover.hp < cover.maxHp ? this.textures.crateDamagedMap : this.textures.crateMap,
        color: cover.isObjectiveCrate ? '#ffefc4' : '#ffffff',
        emissive: cover.isObjectiveCrate ? '#7a4300' : '#000000',
        emissiveIntensity: cover.isObjectiveCrate ? 0.16 : 0,
        roughness: 0.82,
        bumpMap: this.textures.paperBump,
        bumpScale: 0.018,
      });
      const box = new THREE.Mesh(new THREE.BoxGeometry(0.86, height, 0.86), mat);
      box.position.y = height / 2;
      markPickable(box);
      addInkEdges(box, cover.isObjectiveCrate ? 0x7c2d06 : 0x452a16, 0.78);
      crateMesh = box;
      group.add(box);

      if (cover.isObjectiveCrate) {
        // Festive crimson & gold farmer supply straps + spinning target diamond beacon!
        const strapMat = new THREE.MeshStandardMaterial({
          color: '#e0422f',
          roughness: 0.52,
          emissive: '#6e140a',
          emissiveIntensity: 0.22,
        });
        const strapX = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.14, 0.9), strapMat);
        strapX.position.y = height * 0.56;
        group.add(strapX);
        const beacon = new THREE.Mesh(
          new THREE.OctahedronGeometry(0.18, 0),
          new THREE.MeshStandardMaterial({
            color: '#ffe04a',
            emissive: '#c97b00',
            emissiveIntensity: 0.45,
            roughness: 0.25,
          })
        );
        beacon.position.y = height + 0.34;
        addInkEdges(beacon, 0x5c2e04, 0.7);
        group.add(beacon);
        spinner = beacon;
      }
    } else if (cover.kind === 'cage') {
      height = 0.78;
      const sideMat = new THREE.MeshStandardMaterial({ map: this.textures.cageSideMap, roughness: 0.88 });
      const frontMat = new THREE.MeshStandardMaterial({ map: this.textures.cageFrontMap, roughness: 0.88 });
      const box = compactMultiMaterialMesh(new THREE.BoxGeometry(0.88, height, 0.88), [
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
      // Tall Full Cover: golden straw tiers with braided twine belts & top straw crown!
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

      // 3D rustic twine rope belt cinched around the waist
      const rope = new THREE.Mesh(
        new THREE.TorusGeometry(0.43, 0.032, 6, 16),
        new THREE.MeshStandardMaterial({ color: '#7a451c', roughness: 0.95 })
      );
      rope.rotation.x = Math.PI / 2;
      rope.position.y = 0.46;

      group.add(tier1, tier2, tier3, rope);
    } else if (cover.kind === 'stone') {
      // Tall Indestructible Full Cover Sculpted Mossy Boulder Cairn!
      height = 1.18;
      const stoneMat = new THREE.MeshStandardMaterial({
        map: this.textures.stoneMap,
        roughness: 0.92,
        bumpMap: this.textures.paperBump,
        bumpScale: 0.025,
        flatShading: true,
      });
      const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.54, 0), stoneMat);
      rock.scale.set(0.96, 1.14, 0.92);
      rock.position.y = 0.56;
      rock.rotation.set(0.25, (pos.x * 1.1 + pos.y * 0.7) % 3, 0.15);
      markPickable(rock);
      addInkEdges(rock, 0x353b39, 0.62, 20);
      group.add(rock);

      // Nestled companion river cobblestone at base
      const sideRock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.26, 0), stoneMat);
      sideRock.scale.set(1.1, 0.78, 0.95);
      sideRock.position.set(-0.34, 0.2, 0.24);
      sideRock.rotation.set(0.3, pos.y * 0.9, -0.2);
      markPickable(sideRock);
      addInkEdges(sideRock, 0x353b39, 0.52, 22);
      group.add(sideRock);

      // Velvety multi-tuft emerald moss blanket perched on top
      const mossMat = new THREE.MeshStandardMaterial({
        color: '#6fb838',
        roughness: 0.88,
        bumpMap: this.textures.paperBump,
        bumpScale: 0.02,
      });
      const moss1 = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.34, 0.09, 8), mossMat);
      moss1.position.set(0.06, 1.1, 0.02);
      moss1.rotation.z = -0.18;
      const moss2 = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.22, 0.07, 7), mossMat);
      moss2.position.set(-0.2, 0.94, 0.2);
      moss2.rotation.set(0.3, 0, 0.25);
      group.add(moss1, moss2);

      // Cute tiny spotted toadstool sprouting beside the mossy boulder base!
      const miniStem = new THREE.Mesh(
        new THREE.CylinderGeometry(0.032, 0.042, 0.12, 6),
        new THREE.MeshStandardMaterial({ color: '#f7ebd2', roughness: 0.88 })
      );
      miniStem.position.set(0.36, 0.06, 0.28);
      const miniCap = new THREE.Mesh(
        new THREE.SphereGeometry(0.1, 10, 7, 0, Math.PI * 2, 0, Math.PI * 0.56),
        new THREE.MeshStandardMaterial({ map: this.textures.mushroomCapMap, roughness: 0.6 })
      );
      miniCap.position.set(0.36, 0.11, 0.28);
      miniCap.scale.set(1, 0.72, 1);
      group.add(miniStem, miniCap);
    } else if (cover.kind === 'beehive') {
      height = 0.88;
      // Bark-textured Tree Stump!
      const stump = new THREE.Mesh(
        new THREE.CylinderGeometry(0.34, 0.42, 0.26, 10),
        new THREE.MeshStandardMaterial({
          map: this.textures.treeBarkMap,
          roughness: 0.9,
          bumpMap: this.textures.paperBump,
          bumpScale: 0.02,
        })
      );
      stump.position.y = 0.13;
      markPickable(stump);
      addInkEdges(stump, 0x452a16, 0.55);
      group.add(stump);

      // Woven golden honey-dripping skep hive
      const hiveMat = new THREE.MeshStandardMaterial({
        map: this.textures.beehiveMap,
        roughness: 0.84,
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
    } else if (cover.kind === 'pumpkin') {
      // Giant Carved Storybook Rolling Pumpkin Boulder with painted ribbed skin & curly vine!
      height = 0.84;
      const orangeMat = new THREE.MeshStandardMaterial({
        map: this.textures.pumpkinSkinMap,
        roughness: 0.58,
        bumpMap: this.textures.paperBump,
        bumpScale: 0.02,
      });
      const ribMat = new THREE.MeshStandardMaterial({
        map: this.textures.pumpkinSkinMap,
        color: '#f2c8a2',
        roughness: 0.64,
      });
      // Ribbed pumpkin segments
      for (let i = 0; i < 6; i++) {
        const ang = (i / 6) * Math.PI * 2;
        const lobe = new THREE.Mesh(new THREE.SphereGeometry(0.32, 10, 8), i % 2 === 0 ? orangeMat : ribMat);
        lobe.scale.set(0.88, 0.94, 0.72);
        lobe.position.set(Math.cos(ang) * 0.14, 0.36, Math.sin(ang) * 0.14);
        lobe.rotation.y = -ang;
        markPickable(lobe);
        group.add(lobe);
      }
      // Curly green pumpkin stem & vine tendril on top
      const vineMat = new THREE.MeshStandardMaterial({ color: '#4c8a29', roughness: 0.82 });
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.09, 0.24, 7), vineMat);
      stem.position.set(0.02, 0.72, 0);
      stem.rotation.z = -0.22;
      markPickable(stem);
      const curl = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.025, 6, 12, Math.PI * 1.5), vineMat);
      curl.position.set(0.16, 0.68, 0.04);
      curl.rotation.x = Math.PI / 2.6;
      group.add(stem, curl);

      // Playful painted jack-o-lantern eyes on front so it reads instantly as a Rolling Pumpkin!
      const eyeMat = new THREE.MeshBasicMaterial({ color: '#ffe66d' });
      for (const sx of [-0.14, 0.14]) {
        const eye = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.1, 3), eyeMat);
        eye.position.set(sx, 0.42, 0.42);
        group.add(eye);
      }
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
      isObjectiveCrate: Boolean(cover.isObjectiveCrate),
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
    // Paper Mario Pop-Up Storybook Entrance Unfold (~680ms wall-clock, non-blocking)
    const t = this.getPopUpProgress();
    if (t < 1) {
      const ease = 1 - Math.pow(1 - t, 3);
      const spring = ease + Math.sin(t * Math.PI) * 0.08 * (1 - t);
      this.boardGroup.position.y = (1 - ease) * -0.28;
      this.sceneryGroup.scale.set(1, Math.max(0.06, spring), 1);
      this.coverGroup.scale.set(1, Math.max(0.06, spring), 1);
    } else if (this.boardGroup.position.y !== 0 || this.sceneryGroup.scale.y !== 1) {
      this.boardGroup.position.y = 0;
      this.sceneryGroup.scale.set(1, 1, 1);
      this.coverGroup.scale.set(1, 1, 1);
    }

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
        if (cv.isObjectiveCrate) {
          cv.spinner.position.y = cv.height + 0.34 + Math.sin(time * 4.2 + cv.pos.x) * 0.07;
        }
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
