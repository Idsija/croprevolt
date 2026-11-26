import * as THREE from 'three';
import type { AdjacentCoverBadge } from '../engine/grid';
import { getAdjacentCoverBadges, posKey, samePos, tileAt, unitAt } from '../engine/grid';
import type { ReachableNode } from '../engine/pathfinding';
import type {
  BattleState,
  BattleUnit,
  CombatForecast,
  DashOption,
  GridPos,
  JumpOption,
} from '../engine/types';
import { getTileSurfaceY } from './diorama';
import type { CraftTextureLibrary } from './textures';
import { gridToWorld3D, TILE_SIZE_3D } from './types';

export interface TacticalSnapshot3D {
  battle: BattleState;
  selectedUnit: BattleUnit | undefined;
  inspectedEnemy: BattleUnit | undefined;
  mode: 'move' | 'attack' | 'ability' | 'item';
  focusTile: GridPos | null;
  movableMap: Map<string, ReachableNode>;
  jumpMap: Map<string, JumpOption>;
  dashList: DashOption[];
  attackKeySet: Set<string>;
  weaponRangeKeys: Set<string>;
  isProjectingFromMove: boolean;
  abilityKeySet: Set<string>;
  itemKeySet: Set<string>;
  aoePreviewKeys: Set<string>;
  enemyThreat: { moveKeys: Set<string>; attackKeys: Set<string> } | null;
  focusForecast: CombatForecast | null;
}

function disposeGroupChildren(group: THREE.Group): void {
  while (group.children.length > 0) {
    const child = group.children[0];
    group.remove(child);
    child.traverse((obj) => {
      const m = obj as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      if (m.material) {
        if (Array.isArray(m.material)) m.material.forEach((mat) => mat.dispose());
        else m.material.dispose();
      }
    });
  }
}

export class TacticalOverlaySystem3D {
  public readonly root = new THREE.Group();

  private tileLayer = new THREE.Group();
  private ribbonLayer = new THREE.Group();
  private shieldLayer = new THREE.Group();
  private cursorGroup = new THREE.Group();

  private textures: CraftTextureLibrary;
  private lastSignature = '';
  private animatedRings: THREE.Object3D[] = [];
  private shieldSprites: THREE.Object3D[] = [];

  // Shared tile plate geometry
  private plateGeo = new THREE.PlaneGeometry(TILE_SIZE_3D * 0.88, TILE_SIZE_3D * 0.88);
  private frameGeo: THREE.BufferGeometry;

  constructor(textures: CraftTextureLibrary) {
    this.textures = textures;
    this.plateGeo.rotateX(-Math.PI / 2);

    // Crisp square border loop geometry
    const h = TILE_SIZE_3D * 0.445;
    const pts = [
      new THREE.Vector3(-h, 0, -h),
      new THREE.Vector3(h, 0, -h),
      new THREE.Vector3(h, 0, h),
      new THREE.Vector3(-h, 0, h),
      new THREE.Vector3(-h, 0, -h),
    ];
    this.frameGeo = new THREE.BufferGeometry().setFromPoints(pts);

    this.root.add(this.tileLayer);
    this.root.add(this.ribbonLayer);
    this.root.add(this.shieldLayer);
    this.root.add(this.cursorGroup);

    this.buildTileCursor();
  }

  private buildTileCursor(): void {
    // Crisp Mario + Rabbids glowing tile selector brackets
    const cornerLen = 0.24;
    const half = TILE_SIZE_3D * 0.47;
    const mat = new THREE.MeshBasicMaterial({
      color: '#fff8d6',
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
    });
    const thick = 0.055;
    const h = 0.035;

    const addBar = (w: number, d: number, x: number, z: number) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      m.position.set(x, 0.045, z);
      this.cursorGroup.add(m);
    };

    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        addBar(cornerLen, thick, sx * (half - cornerLen / 2), sz * half);
        addBar(thick, cornerLen, sx * half, sz * (half - cornerLen / 2));
      }
    }
    this.cursorGroup.visible = false;
  }

  public sync(snap: TacticalSnapshot3D): void {
    const b = snap.battle;
    const focusKey = snap.focusTile ? `${snap.focusTile.x},${snap.focusTile.y}` : '-';
    const threatSig = snap.enemyThreat
      ? `${snap.enemyThreat.moveKeys.size}:${snap.enemyThreat.attackKeys.size}`
      : '-';
    const sig = [
      b.mapId,
      b.turn,
      b.phase,
      snap.selectedUnit?.id ?? '-',
      snap.selectedUnit ? `${snap.selectedUnit.pos.x},${snap.selectedUnit.pos.y}` : '-',
      snap.selectedUnit
        ? `${snap.selectedUnit.actions.hasMoved ? 1 : 0}${snap.selectedUnit.actions.hasAttacked ? 1 : 0}${snap.selectedUnit.actions.hasDashed ? 1 : 0}${snap.selectedUnit.actions.hasUsedSkill ? 1 : 0}`
        : '-',
      snap.inspectedEnemy?.id ?? '-',
      snap.mode,
      focusKey,
      snap.movableMap.size,
      snap.jumpMap.size,
      snap.dashList.length,
      snap.attackKeySet.size,
      snap.weaponRangeKeys.size,
      snap.isProjectingFromMove ? 1 : 0,
      snap.abilityKeySet.size,
      snap.itemKeySet.size,
      snap.aoePreviewKeys.size,
      threatSig,
      snap.focusForecast ? `${snap.focusForecast.hitChance}:${snap.focusForecast.coverLevel}:${snap.focusForecast.canAttack ? 1 : 0}` : '-',
    ].join('|');

    // Always update cursor position quickly
    if (snap.focusTile && b.phase === 'player' && b.status === 'ongoing') {
      const t = tileAt(b, snap.focusTile);
      const wp = gridToWorld3D(
        snap.focusTile.x,
        snap.focusTile.y,
        b.width,
        b.height,
        t ? getTileSurfaceY(t) : 0
      );
      this.cursorGroup.position.set(wp.x, wp.y, wp.z);
      this.cursorGroup.visible = true;
    } else {
      this.cursorGroup.visible = false;
    }

    if (sig === this.lastSignature) return;
    this.lastSignature = sig;

    this.rebuildTiles(snap);
    this.rebuildRibbonsAndArcs(snap);
    this.rebuildCoverShields(snap);
  }

  private tilePosY(battle: BattleState, pos: GridPos, lift = 0.032): THREE.Vector3 {
    const t = tileAt(battle, pos);
    const wp = gridToWorld3D(pos.x, pos.y, battle.width, battle.height, (t ? getTileSurfaceY(t) : 0) + lift);
    return new THREE.Vector3(wp.x, wp.y, wp.z);
  }

  private addTilePlate(
    battle: BattleState,
    pos: GridPos,
    fillColor: number,
    fillOpacity: number,
    borderColor?: number,
    borderOpacity = 0.85,
    lift = 0.026
  ): void {
    const p = this.tilePosY(battle, pos, lift);
    const mat = new THREE.MeshBasicMaterial({
      color: fillColor,
      transparent: true,
      opacity: fillOpacity,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(this.plateGeo, mat);
    mesh.position.copy(p);
    this.tileLayer.add(mesh);

    if (borderColor !== undefined) {
      const lineMat = new THREE.LineBasicMaterial({
        color: borderColor,
        transparent: true,
        opacity: borderOpacity,
      });
      const frame = new THREE.Line(this.frameGeo, lineMat);
      frame.position.set(p.x, p.y + 0.005, p.z);
      this.tileLayer.add(frame);
    }
  }

  private rebuildTiles(snap: TacticalSnapshot3D): void {
    disposeGroupChildren(this.tileLayer);
    const b = snap.battle;
    if (b.status !== 'ongoing') return;

    // 1. Enemy Danger / Threat Zones
    if (snap.enemyThreat) {
      for (const key of snap.enemyThreat.attackKeys) {
        const [x, y] = key.split(',').map(Number);
        const isMove = snap.enemyThreat.moveKeys.has(key);
        this.addTilePlate(
          b,
          { x, y },
          isMove ? 0xe84333 : 0xd93526,
          isMove ? 0.34 : 0.24,
          0xff7a6e,
          isMove ? 0.8 : 0.55,
          0.022
        );
      }
    }

    if (b.phase !== 'player' || !snap.selectedUnit) return;

    // 2. Active Mode Tactical Tiles
    if (snap.mode === 'move') {
      // Blue movable tiles
      for (const node of snap.movableMap.values()) {
        const isFocused = Boolean(snap.focusTile && samePos(snap.focusTile, node.pos));
        this.addTilePlate(
          b,
          node.pos,
          0x27b0f5,
          isFocused ? 0.52 : 0.34,
          isFocused ? 0xc7f2ff : 0x7adeff,
          isFocused ? 1 : 0.82,
          0.026
        );
      }

      // Gold Team-Jump landing tiles
      for (const j of snap.jumpMap.values()) {
        const isFocused = Boolean(snap.focusTile && samePos(snap.focusTile, j.dest));
        this.addTilePlate(
          b,
          j.dest,
          0xf8c634,
          isFocused ? 0.54 : 0.38,
          isFocused ? 0xfff6bd : 0xffe478,
          0.95,
          0.03
        );
      }

      // Orange Dashable enemy highlights
      for (const d of snap.dashList) {
        this.addTilePlate(b, d.enemyPos, 0xff7b29, 0.42, 0xffd166, 0.95, 0.032);
      }

      // Subtle weapon reach outline when projecting from a hovered Move tile (or active attack targets)
      if (snap.isProjectingFromMove) {
        for (const key of snap.weaponRangeKeys) {
          const [x, y] = key.split(',').map(Number);
          const u = unitAt(b, { x, y });
          const isEnemy = Boolean(u && u.team === 'enemy');
          this.addTilePlate(
            b,
            { x, y },
            0xeb4b3b,
            isEnemy ? 0.34 : 0.07,
            0xff7c6e,
            isEnemy ? 0.9 : 0.25,
            0.029
          );
        }
      } else {
        // Highlight shootable enemies / destructible cover softly in unified move mode
        for (const key of snap.attackKeySet) {
          const [x, y] = key.split(',').map(Number);
          const u = unitAt(b, { x, y });
          if (u && u.team === 'enemy') {
            this.addTilePlate(b, { x, y }, 0xe84838, 0.26, 0xff8a7d, 0.78, 0.03);
          }
        }
      }
    } else if (snap.mode === 'attack') {
      // Weapon reach perimeter
      for (const key of snap.weaponRangeKeys) {
        const [x, y] = key.split(',').map(Number);
        const isTarget = snap.attackKeySet.has(key);
        this.addTilePlate(
          b,
          { x, y },
          0xe64536,
          isTarget ? 0.3 : 0.1,
          isTarget ? 0xff968a : 0xd65447,
          isTarget ? 0.82 : 0.28,
          0.026
        );
      }
    } else if (snap.mode === 'ability') {
      for (const key of snap.abilityKeySet) {
        const [x, y] = key.split(',').map(Number);
        const isFocused = Boolean(snap.focusTile && snap.focusTile.x === x && snap.focusTile.y === y);
        this.addTilePlate(
          b,
          { x, y },
          0x9f59d6,
          isFocused ? 0.48 : 0.28,
          0xe3b8ff,
          isFocused ? 0.98 : 0.72,
          0.028
        );
      }
    } else if (snap.mode === 'item') {
      for (const key of snap.itemKeySet) {
        const [x, y] = key.split(',').map(Number);
        const isFocused = Boolean(snap.focusTile && snap.focusTile.x === x && snap.focusTile.y === y);
        this.addTilePlate(
          b,
          { x, y },
          0x52bd5c,
          isFocused ? 0.48 : 0.28,
          0xbcf5bf,
          isFocused ? 0.98 : 0.72,
          0.028
        );
      }
    }

    // 3. AoE 3x3 Blast Preview Ring (Lobbed mortar, Acid Zest, Fertilizer Bomb, etc.)
    for (const key of snap.aoePreviewKeys) {
      const [x, y] = key.split(',').map(Number);
      this.addTilePlate(b, { x, y }, 0xffa726, 0.38, 0xfff0a6, 0.95, 0.036);
    }
  }

  private addTubeArc(
    points: THREE.Vector3[],
    radius: number,
    color: number,
    opacity = 0.92
  ): void {
    if (points.length < 2) return;
    const curve = new THREE.CatmullRomCurve3(points);
    const geo = new THREE.TubeGeometry(curve, Math.max(12, points.length * 8), radius, 8, false);
    const mat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity,
      depthWrite: false,
    });
    this.ribbonLayer.add(new THREE.Mesh(geo, mat));
  }

  private addParabolicArc(
    from: THREE.Vector3,
    to: THREE.Vector3,
    peakLift: number,
    color: number,
    radius = 0.055,
    beaded = false
  ): void {
    const mid = new THREE.Vector3().lerpVectors(from, to, 0.5);
    mid.y = Math.max(from.y, to.y) + peakLift;

    const curve = new THREE.QuadraticBezierCurve3(from, mid, to);
    if (beaded) {
      // Crisp glowing Mario + Rabbids beaded mortar arc!
      const count = 14;
      const beadGeo = new THREE.SphereGeometry(radius * 1.45, 8, 8);
      const beadMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95 });
      for (let i = 1; i < count; i++) {
        const pt = curve.getPoint(i / count);
        const m = new THREE.Mesh(beadGeo, beadMat);
        m.position.copy(pt);
        this.ribbonLayer.add(m);
      }
    } else {
      const geo = new THREE.TubeGeometry(curve, 24, radius, 8, false);
      const mat = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
      });
      this.ribbonLayer.add(new THREE.Mesh(geo, mat));
    }
  }

  private addGroundRing(pos: THREE.Vector3, innerR: number, outerR: number, color: number): void {
    const geo = new THREE.RingGeometry(innerR, outerR, 28);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.92,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const ring = new THREE.Mesh(geo, mat);
    ring.position.copy(pos);
    ring.position.y += 0.02;
    this.ribbonLayer.add(ring);
    this.animatedRings.push(ring);
  }

  private rebuildRibbonsAndArcs(snap: TacticalSnapshot3D): void {
    disposeGroupChildren(this.ribbonLayer);
    this.animatedRings = [];

    const b = snap.battle;
    const hero = snap.selectedUnit;
    const focus = snap.focusTile;
    if (!hero || !focus || b.phase !== 'player' || b.status !== 'ongoing') return;

    const focusKey = posKey(focus);

    // Case A: Hovering a Team-Jump destination -> Gold approach + soaring parabolic vault arc!
    if (snap.mode === 'move' && snap.jumpMap.has(focusKey)) {
      const jump = snap.jumpMap.get(focusKey)!;
      const startPt = this.tilePosY(b, hero.pos, 0.14);
      const allyPt = this.tilePosY(b, jump.allyPos, 0.65);
      const endPt = this.tilePosY(b, jump.dest, 0.12);

      // Approach line to ally
      const approachNode = snap.movableMap.get(posKey(jump.approachPos));
      if (approachNode && approachNode.path.length >= 2) {
        const pts = approachNode.path.map((p) => this.tilePosY(b, p, 0.12));
        this.addTubeArc(pts, 0.055, 0x50d0ff, 0.88);
      } else if (!samePos(hero.pos, jump.allyPos)) {
        this.addTubeArc([startPt, this.tilePosY(b, jump.allyPos, 0.14)], 0.055, 0x50d0ff, 0.85);
      }

      // Soaring golden Team-Jump vault arc over ally!
      this.addParabolicArc(allyPt, endPt, 1.55, 0xffd54f, 0.068, false);
      this.addGroundRing(this.tilePosY(b, jump.allyPos, 0.04), 0.38, 0.54, 0xffe066);
      this.addGroundRing(this.tilePosY(b, jump.dest, 0.04), 0.34, 0.52, 0xffca28);
      return;
    }

    // Case B: Hovering a Move tile -> Smooth glowing cyan Mario + Rabbids path ribbon!
    if (snap.mode === 'move' && snap.movableMap.has(focusKey)) {
      const node = snap.movableMap.get(focusKey)!;
      if (node.path.length >= 2) {
        const pts = node.path.map((p) => this.tilePosY(b, p, 0.12));
        this.addTubeArc(pts, 0.068, 0x45d3ff, 0.92);
        this.addGroundRing(this.tilePosY(b, focus, 0.04), 0.32, 0.48, 0x8ce8ff);
      }
      return;
    }

    // Case C: Hovering a Dash-able enemy in Move mode -> Orange lightning dash ribbon!
    const focusedUnit = unitAt(b, focus);
    const dashOpt =
      snap.mode === 'move' && focusedUnit && focusedUnit.team === 'enemy'
        ? snap.dashList.find((d) => d.enemyId === focusedUnit.id)
        : undefined;
    if (dashOpt) {
      const startPt = this.tilePosY(b, hero.pos, 0.2);
      const hitPt = this.tilePosY(b, dashOpt.enemyPos, 0.45);
      const stopPt = this.tilePosY(b, dashOpt.stopPos, 0.16);
      this.addTubeArc([startPt, hitPt, stopPt], 0.072, 0xff8524, 0.95);
      this.addGroundRing(this.tilePosY(b, dashOpt.enemyPos, 0.04), 0.42, 0.58, 0xff9f43);
      if (!samePos(dashOpt.stopPos, hero.pos)) {
        this.addGroundRing(this.tilePosY(b, dashOpt.stopPos, 0.04), 0.28, 0.42, 0x52d4ff);
      }
    }

    // Case D: Combat Forecast Sightline / Lobbed Mortar Arc + Knockback Arrow!
    if (snap.focusForecast && (snap.mode === 'attack' || snap.mode === 'move')) {
      const fc = snap.focusForecast;
      const fromPt = this.tilePosY(b, hero.pos, 0.68);
      const toPt = this.tilePosY(b, fc.targetPos, 0.56);

      if (hero.weapon.arc === 'lobbed') {
        this.addParabolicArc(fromPt, toPt, 2.05, fc.canAttack ? 0xffe066 : 0xe84133, 0.058, true);
      } else {
        const lineColor =
          fc.hitChance >= 100 ? 0x57e368 : fc.hitChance > 0 ? 0xf7be38 : 0xef4437;
        this.addParabolicArc(fromPt, toPt, 0.16, lineColor, 0.044, fc.hitChance < 100);
      }

      // Knockback direction preview arrow (color-coded for Lava, Water, Cliff Drop, or Bump!)
      if (fc.knockbackDir && fc.canAttack) {
        const startKb = this.tilePosY(b, fc.targetPos, 0.25);
        const dirVec = new THREE.Vector3(fc.knockbackDir.x, 0, fc.knockbackDir.y).normalize();
        const arrowLen = fc.knockbackWillBump ? 0.86 : 1.08;
        const arrowCol =
          fc.knockbackHazard === 'lava'
            ? 0xff521b
            : fc.knockbackHazard === 'water'
              ? 0x2ec4f1
              : fc.knockbackHazard === 'drop'
                ? 0xffa62b
                : fc.knockbackWillBump
                  ? 0xff4b3a
                  : 0xffd147;
        const arrow = new THREE.ArrowHelper(dirVec, startKb, arrowLen, arrowCol, 0.34, 0.26);
        this.ribbonLayer.add(arrow);
      }

      this.addGroundRing(
        this.tilePosY(b, fc.targetPos, 0.045),
        0.4,
        0.56,
        fc.hitChance >= 100 ? 0x62e871 : fc.hitChance > 0 ? 0xf7be38 : 0xe84133
      );
      return;
    }

    // Case E: Ability / Item parabolic cast arc
    if ((snap.mode === 'ability' && snap.abilityKeySet.has(focusKey)) || (snap.mode === 'item' && snap.itemKeySet.has(focusKey))) {
      const fromPt = this.tilePosY(b, hero.pos, 0.72);
      const toPt = this.tilePosY(b, focus, 0.38);
      const col = snap.mode === 'ability' ? 0xc880ff : 0x6ce376;
      if (!samePos(hero.pos, focus)) {
        this.addParabolicArc(fromPt, toPt, 1.45, col, 0.055, true);
      }
      this.addGroundRing(this.tilePosY(b, focus, 0.045), 0.38, 0.56, col);
    }
  }

  private rebuildCoverShields(snap: TacticalSnapshot3D): void {
    disposeGroupChildren(this.shieldLayer);
    this.shieldSprites = [];

    const b = snap.battle;
    const hero = snap.selectedUnit;
    if (!hero || b.phase !== 'player' || b.status !== 'ongoing') return;

    // Decide which tile to display Mario + Rabbids directional cover shields around:
    // - If hovering/previewing a valid Move or Team-Jump tile, show the cover shields you'll get THERE!
    // - Otherwise show the cover shields currently protecting the selected hero!
    let anchorTile: GridPos = hero.pos;
    if (
      snap.mode === 'move' &&
      snap.focusTile &&
      (snap.movableMap.has(posKey(snap.focusTile)) || snap.jumpMap.has(posKey(snap.focusTile)))
    ) {
      anchorTile = snap.focusTile;
    }

    const badges: AdjacentCoverBadge[] = getAdjacentCoverBadges(b, anchorTile, 'player');
    if (badges.length === 0) return;

    const anchorWorld = this.tilePosY(b, anchorTile, 0);
    const shieldGeo = new THREE.PlaneGeometry(0.52, 0.52);

    for (const badge of badges) {
      const dirX = badge.coverPos.x - anchorTile.x;
      const dirY = badge.coverPos.y - anchorTile.y;

      const tex = badge.level === 'full' ? this.textures.shieldFullMap : this.textures.shieldHalfMap;
      const mat = new THREE.MeshBasicMaterial({
        map: tex,
        transparent: true,
        alphaTest: 0.15,
        side: THREE.DoubleSide,
        depthWrite: false,
      });

      const shield = new THREE.Mesh(shieldGeo.clone(), mat);
      shield.renderOrder = 25;
      // Float clearly above the crate/haystack rim on the hero's side of the wall so it never clips!
      const baseHeight = badge.level === 'full' ? 1.18 : 0.84;
      shield.position.set(
        anchorWorld.x + dirX * (TILE_SIZE_3D * 0.36),
        anchorWorld.y + baseHeight,
        anchorWorld.z + dirY * (TILE_SIZE_3D * 0.36)
      );
      shield.userData.baseY = shield.position.y;
      this.shieldLayer.add(shield);
      this.shieldSprites.push(shield);
    }
  }

  public update(time: number, cameraPos: THREE.Vector3): void {
    // Gentle pulse on active tile cursor
    if (this.cursorGroup.visible) {
      const s = 1 + Math.sin(time * 6) * 0.035;
      this.cursorGroup.scale.set(s, 1, s);
    }

    // Spin/breathe ground rings
    for (const ring of this.animatedRings) {
      const s = 1 + Math.sin(time * 5.2) * 0.06;
      ring.scale.set(s, s, 1);
    }

    // Billboard 3D cover shield badges subtly toward the camera + float softly
    for (let i = 0; i < this.shieldSprites.length; i++) {
      const sh = this.shieldSprites[i];
      const baseY = (sh.userData.baseY as number) ?? 0.65;
      sh.position.y = baseY + Math.sin(time * 3.8 + i * 1.1) * 0.045;
      sh.lookAt(cameraPos.x, sh.position.y + 0.15, cameraPos.z);
    }
  }

  public dispose(): void {
    disposeGroupChildren(this.tileLayer);
    disposeGroupChildren(this.ribbonLayer);
    disposeGroupChildren(this.shieldLayer);
    disposeGroupChildren(this.cursorGroup);
    this.plateGeo.dispose();
    this.frameGeo.dispose();
  }
}
