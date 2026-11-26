import * as THREE from 'three';
import type { AdjacentCoverBadge } from '../engine/grid';
import { getAdjacentCoverBadges, manhattan, posKey, samePos, tileAt, unitAt } from '../engine/grid';
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

export interface ProjectedSightlineTarget {
  pos: GridPos;
  hitChance: number;
  isLethal: boolean;
}

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
  projectedTargets?: ProjectedSightlineTarget[];
  previewOverwatch: boolean;
  overwatchRangeKeys: Set<string>;
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
  private telegraphBeacons: THREE.Object3D[] = [];
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
    const telSig = (b.bossTelegraphs ?? [])
      .map((t) => `${t.bossId}:${t.name}:${t.tiles.map(posKey).join(';')}`)
      .join(',');
    const sig = [
      b.mapId,
      b.turn,
      b.phase,
      b.prepPhase ? 'prep' : 'live',
      snap.selectedUnit?.id ?? '-',
      snap.selectedUnit ? `${snap.selectedUnit.pos.x},${snap.selectedUnit.pos.y}` : '-',
      snap.selectedUnit
        ? `${snap.selectedUnit.actions.hasMoved ? 1 : 0}:${snap.selectedUnit.actions.moveSpent ?? 0}:${snap.selectedUnit.actions.hasAttacked ? 1 : 0}${snap.selectedUnit.actions.hasDashed ? 1 : 0}${snap.selectedUnit.actions.hasUsedSkill ? 1 : 0}`
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
      (snap.projectedTargets ?? []).map((t) => `${t.pos.x},${t.pos.y}:${t.hitChance}`).join(','),
      snap.previewOverwatch ? 1 : 0,
      snap.overwatchRangeKeys.size,
      snap.abilityKeySet.size,
      snap.itemKeySet.size,
      snap.aoePreviewKeys.size,
      threatSig,
      telSig,
      snap.focusForecast
        ? `${snap.focusForecast.hitChance}:${snap.focusForecast.coverLevel}:${snap.focusForecast.canAttack ? 1 : 0}:${snap.focusForecast.isPumpkinTarget ? 1 : 0}:${snap.focusForecast.isBridgeTarget ? 1 : 0}`
        : '-',
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
    this.telegraphBeacons = [];
    const b = snap.battle;
    if (b.status !== 'ongoing') return;

    // Pre-Battle Tactical Prep Phase: glow all valid player spawn tiles emerald/gold!
    if (b.prepPhase) {
      for (const sp of b.playerSpawnPositions ?? []) {
        const isSelectedPos = Boolean(snap.selectedUnit && samePos(snap.selectedUnit.pos, sp));
        const isFocused = Boolean(snap.focusTile && samePos(snap.focusTile, sp));
        this.addTilePlate(
          b,
          sp,
          isSelectedPos ? 0xf8c634 : 0x3ec96b,
          isSelectedPos || isFocused ? 0.56 : 0.36,
          isSelectedPos ? 0xfff6bd : 0xc6ffcf,
          0.98,
          0.032
        );
      }
      return;
    }

    // 0. Boss Telegraphed Super-Attack Danger Zones! (Always visible so player can dodge!)
    if (b.bossTelegraphs && b.bossTelegraphs.length > 0) {
      const seenTel = new Set<string>();
      const stripeGeo = new THREE.PlaneGeometry(TILE_SIZE_3D * 0.92, 0.14);
      stripeGeo.rotateX(-Math.PI / 2);
      const beaconGeo = new THREE.OctahedronGeometry(0.16, 0);
      for (const tel of b.bossTelegraphs) {
        for (const tp of tel.tiles) {
          const k = posKey(tp);
          if (seenTel.has(k)) continue;
          seenTel.add(k);
          this.addTilePlate(b, tp, 0xe02222, 0.44, 0xffd166, 0.98, 0.035);
          const wp = this.tilePosY(b, tp, 0.042);

          // Crisp diagonal red-gold hazard X stripes
          for (const rot of [Math.PI / 4, -Math.PI / 4]) {
            const stripe = new THREE.Mesh(
              stripeGeo.clone(),
              new THREE.MeshBasicMaterial({
                color: 0xffc83b,
                transparent: true,
                opacity: 0.72,
                depthWrite: false,
              })
            );
            stripe.position.copy(wp);
            stripe.rotation.y = rot;
            this.tileLayer.add(stripe);
          }

          // Pulsing floating crimson warning beacon above the danger tile!
          const beacon = new THREE.Mesh(
            beaconGeo.clone(),
            new THREE.MeshBasicMaterial({
              color: 0xff3b24,
              transparent: true,
              opacity: 0.88,
            })
          );
          beacon.position.set(wp.x, wp.y + 0.56, wp.z);
          beacon.userData.baseY = wp.y + 0.56;
          this.tileLayer.add(beacon);
          this.telegraphBeacons.push(beacon);
        }
      }
      stripeGeo.dispose();
      beaconGeo.dispose();
    }

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

    // 1B. Hovering Watch -> Golden Hero Sight Overwatch Zone Preview!
    if (snap.previewOverwatch && snap.overwatchRangeKeys.size > 0) {
      for (const key of snap.overwatchRangeKeys) {
        const [x, y] = key.split(',').map(Number);
        this.addTilePlate(b, { x, y }, 0xf5be28, 0.36, 0xfff2a6, 0.96, 0.034);
      }
      return;
    }

    // 2. Active Mode Tactical Tiles
    if (snap.mode === 'move') {
      // Blue movable tiles (teal for Burrows, magenta-pink for Bouncy Mushrooms!)
      for (const node of snap.movableMap.values()) {
        const isFocused = Boolean(snap.focusTile && samePos(snap.focusTile, node.pos));
        const tile = tileAt(b, node.pos);
        const isBurrow = tile?.terrain === 'burrow';
        const isBounce = tile?.terrain === 'bounce_pad';
        this.addTilePlate(
          b,
          node.pos,
          isBounce ? 0xee4c88 : isBurrow ? 0x2de0cf : 0x27b0f5,
          isFocused ? 0.54 : isBounce || isBurrow ? 0.42 : 0.34,
          isFocused ? 0xc7f2ff : isBounce ? 0xffd1e6 : isBurrow ? 0xb5fff7 : 0x7adeff,
          isFocused ? 1 : 0.85,
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
          isTarget ? 0.5 : 0.24,
          isTarget ? 0xffffff : 0xff6a5c,
          isTarget ? 1 : 0.8,
          0.026
        );
      }
    } else if (snap.mode === 'ability') {
      // Skills that pick a unit only light up valid units, so also draw the skill's whole reach
      // faintly: the player can then see how far it goes even when nobody is in range yet.
      const ab = snap.selectedUnit?.ability;
      const picksUnit = ab?.targetType === 'enemy' || ab?.targetType === 'ally';
      if (ab && picksUnit && snap.selectedUnit) {
        const origin = snap.selectedUnit.pos;
        for (let y = 0; y < b.height; y++) {
          for (let x = 0; x < b.width; x++) {
            if (Math.abs(x - origin.x) + Math.abs(y - origin.y) > ab.range) continue;
            if (snap.abilityKeySet.has(`${x},${y}`)) continue;
            this.addTilePlate(b, { x, y }, 0xb14cff, 0.1, 0xd9a6ff, 0.3, 0.026);
          }
        }
      }
      for (const key of snap.abilityKeySet) {
        const [x, y] = key.split(',').map(Number);
        const isFocused = Boolean(snap.focusTile && snap.focusTile.x === x && snap.focusTile.y === y);
        this.addTilePlate(
          b,
          { x, y },
          0xb14cff,
          isFocused ? 0.62 : picksUnit ? 0.52 : 0.4,
          0xf0d4ff,
          isFocused ? 1 : 0.9,
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
          0xfff7d6,
          isFocused ? 0.7 : 0.48,
          0xffffff,
          isFocused ? 1 : 0.9,
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
      // Crisp glowing Mario + Rabbids beaded mortar / warp arc!
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

  private addProjectedSightlines(
    b: BattleState,
    originTile: GridPos,
    targets: ProjectedSightlineTarget[] | undefined
  ): void {
    if (!targets || targets.length === 0) return;
    const fromPt = this.tilePosY(b, originTile, 0.72);
    for (const target of targets) {
      const toPt = this.tilePosY(b, target.pos, 0.56);
      const col = target.isLethal
        ? 0xff4757
        : target.hitChance >= 100
          ? 0xff6b4a
          : 0xffb733;
      this.addParabolicArc(fromPt, toPt, 0.24, col, 0.032, true);
      this.addGroundRing(this.tilePosY(b, target.pos, 0.048), 0.42, 0.56, col);
    }
  }

  private rebuildRibbonsAndArcs(snap: TacticalSnapshot3D): void {
    disposeGroupChildren(this.ribbonLayer);
    this.animatedRings = [];

    const b = snap.battle;
    const hero = snap.selectedUnit;
    const focus = snap.focusTile;
    if (!hero || !focus || b.phase !== 'player' || b.status !== 'ongoing' || b.prepPhase) return;

    const focusKey = posKey(focus);

    // Case A: Hovering a Team-Jump destination -> Gold approach + soaring parabolic vault arc + projected sightlines!
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
      if (snap.isProjectingFromMove) {
        this.addProjectedSightlines(b, focus, snap.projectedTargets);
      }
      return;
    }

    // Case B: Hovering a Move tile -> Smooth glowing cyan ribbon + Burrow/Bounce arcs + projected sightlines!
    if (snap.mode === 'move' && snap.movableMap.has(focusKey)) {
      const node = snap.movableMap.get(focusKey)!;
      if (node.path.length >= 2) {
        let seg: THREE.Vector3[] = [this.tilePosY(b, node.path[0], 0.12)];
        let specialColor = 0x8ce8ff;
        for (let i = 1; i < node.path.length; i++) {
          const prev = node.path[i - 1];
          const curr = node.path[i];
          if (manhattan(prev, curr) > 1) {
            if (seg.length >= 2) this.addTubeArc(seg, 0.068, 0x45d3ff, 0.92);
            const fromW = this.tilePosY(b, prev, 0.16);
            const toW = this.tilePosY(b, curr, 0.14);
            const isBounce = tileAt(b, prev)?.terrain === 'bounce_pad';
            const arcCol = isBounce ? 0xff4fa3 : 0x3cf0de;
            this.addParabolicArc(fromW, toW, isBounce ? 1.85 : 1.35, arcCol, 0.066, !isBounce);
            this.addGroundRing(this.tilePosY(b, prev, 0.05), 0.36, 0.52, arcCol);
            this.addGroundRing(this.tilePosY(b, curr, 0.05), 0.36, 0.52, arcCol);
            specialColor = arcCol;
            seg = [this.tilePosY(b, curr, 0.12)];
          } else {
            seg.push(this.tilePosY(b, curr, 0.12));
          }
        }
        if (seg.length >= 2) {
          this.addTubeArc(seg, 0.068, 0x45d3ff, 0.92);
        }
        this.addGroundRing(this.tilePosY(b, focus, 0.04), 0.32, 0.48, specialColor);
      }
      if (snap.isProjectingFromMove) {
        this.addProjectedSightlines(b, focus, snap.projectedTargets);
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

    // Case D: Combat Forecast Sightline / Lobbed Mortar Arc + Knockback / Rolling Pumpkin Arrow!
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

      // Rolling Pumpkin bowling lane arrow preview!
      if (fc.isPumpkinTarget && fc.pumpkinRollDir && fc.canAttack) {
        const startRoll = this.tilePosY(b, fc.targetPos, 0.3);
        const dirVec = new THREE.Vector3(fc.pumpkinRollDir.x, 0, fc.pumpkinRollDir.y).normalize();
        const arrow = new THREE.ArrowHelper(dirVec, startRoll, 2.6, 0xff8819, 0.42, 0.34);
        this.ribbonLayer.add(arrow);
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
      ring.scale.set(s, 1, s);
    }

    // Pulse & spin Boss Telegraph crimson warning beacons!
    for (let i = 0; i < this.telegraphBeacons.length; i++) {
      const bc = this.telegraphBeacons[i];
      const baseY = (bc.userData.baseY as number) ?? 0.56;
      bc.position.y = baseY + Math.sin(time * 6.5 + i * 0.7) * 0.12;
      bc.rotation.y = time * 3.2;
      const sc = 1 + Math.sin(time * 7 + i) * 0.16;
      bc.scale.setScalar(sc);
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
