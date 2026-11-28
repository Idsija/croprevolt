import * as THREE from 'three';
import type { BoardTheme, TerrainType } from '../engine/types';
import { createEquippedWeaponRig, type EquippedWeaponPropRig } from './weaponProps';

export const UNIT_WORLD_HEIGHTS: Record<string, number> = {
  potato: 1.05,
  pea: 1.15,
  lemon: 0.98,
  chili: 1.02,
  carrot: 1.16,
  blackberry: 1.04,
  corn: 1.18,
  lettuce: 1.04,
  strawberry: 1.04,
  mushroom: 1.06,
  pumpkin: 1.16,
  blueberry: 1.0,
  cow: 1.14,
  pig: 1.04,
  rooster: 1.22,
  sheep: 1.14,
  goat: 1.2,
  duck: 1.12,
  owl: 1.12,
  seed_cart: 0.98,
  digger: 1.4,
  digger_heavy: 1.34,
  trimmer: 1.44,
  sprayer: 1.34,
  mower: 1.08,
  beekeeper: 1.42,
  barrow: 1.08,
  pitchfork: 1.48,
  blower: 1.24,
  sapper: 1.14,
  kettlebot: 1.52,
  snowplow: 1.24,
  frostblower: 1.28,
  scarecrow: 1.78,
  harvester: 1.84,
  tractor: 1.56,
  frostboss: 1.88,
};

export const SPRITE_DEFAULT_FACING: Record<string, 'left' | 'right'> = {
  potato: 'right',
  pea: 'right',
  lemon: 'right',
  chili: 'right',
  carrot: 'right',
  blackberry: 'right',
  corn: 'right',
  lettuce: 'right',
  strawberry: 'right',
  mushroom: 'right',
  pumpkin: 'right',
  blueberry: 'right',
  cow: 'right',
  pig: 'right',
  rooster: 'right',
  sheep: 'right',
  goat: 'right',
  duck: 'right',
  owl: 'right',
  seed_cart: 'right',
  digger: 'left',
  digger_heavy: 'left',
  trimmer: 'left',
  sprayer: 'left',
  mower: 'left',
  beekeeper: 'left',
  barrow: 'left',
  pitchfork: 'left',
  blower: 'left',
  sapper: 'left',
  kettlebot: 'left',
  snowplow: 'left',
  frostblower: 'left',
  scarecrow: 'left',
  harvester: 'left',
  tractor: 'left',
  frostboss: 'left',
};

export type SpriteVariantKind = 'base' | 'cover' | 'action' | 'hit' | 'lowhp' | 'enraged';

/**
 * Explicit registry of ALL handcrafted matte clay/wood pose & enraged variant PNGs in /sprites/.
 * Prevents any 404 requests for units that use procedural 3D paper-craft hit/cover/lowhp overlays.
 */
export const AVAILABLE_VARIANT_SPRITES = new Set<string>([
  'cow_action',
  'cow_cover',
  'pea_action',
  'pea_cover',
  'lemon_action',
  'lemon_cover',
  'rooster_action',
  'rooster_cover',
  'scarecrow_enraged',
  'tractor_enraged',
  'harvester_enraged',
  'frostboss_enraged',
]);

export function hasVariantSprite(
  visualKind: string,
  variant: Exclude<SpriteVariantKind, 'base'>
): boolean {
  return AVAILABLE_VARIANT_SPRITES.has(`${visualKind}_${variant}`);
}

export function resolveVariantSpriteKey(
  visualKind: string,
  variant: SpriteVariantKind
): string {
  if (variant !== 'base') {
    const candidate = `${visualKind}_${variant}`;
    if (AVAILABLE_VARIANT_SPRITES.has(candidate)) {
      return candidate;
    }
  }
  return visualKind;
}


function makeCanvas(w: number, h: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  return { canvas, ctx };
}

function finalizeTexture(
  canvas: HTMLCanvasElement,
  opts: { repeat?: [number, number]; srgb?: boolean; anisotropy?: number } = {}
): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  if (opts.srgb !== false) {
    tex.colorSpace = THREE.SRGBColorSpace;
  }
  if (opts.repeat) {
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(opts.repeat[0], opts.repeat[1]);
  } else {
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
  }
  tex.anisotropy = opts.anisotropy ?? 4;
  tex.needsUpdate = true;
  return tex;
}

/** Deterministic PRNG for organic watercolor speckles */
function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function paintPaperGrain(ctx: CanvasRenderingContext2D, w: number, h: number, seed: number, alpha = 0.08): void {
  const rng = mulberry(seed);
  // Subtle watercolor clouds
  for (let i = 0; i < 18; i++) {
    const cx = rng() * w;
    const cy = rng() * h;
    const r = (0.14 + rng() * 0.28) * Math.min(w, h);
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    const bright = rng() > 0.45;
    g.addColorStop(0, bright ? `rgba(255, 250, 232, ${alpha * 1.15})` : `rgba(68, 38, 14, ${alpha})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
  }
  // Fine paper fibers
  ctx.lineWidth = 1;
  for (let i = 0; i < 70; i++) {
    const x = rng() * w;
    const y = rng() * h;
    const len = 3 + rng() * 7;
    const ang = rng() * Math.PI * 2;
    ctx.strokeStyle = rng() > 0.5 ? `rgba(255,252,240,${alpha * 0.9})` : `rgba(74,44,23,${alpha * 0.7})`;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len);
    ctx.stroke();
  }
}

export type TreeFoliageVariant =
  | 'spring_green'
  | 'spring_blossom'
  | 'summer_citrus'
  | 'autumn_crimson'
  | 'autumn_gold'
  | 'winter_pine';

export class CraftTextureLibrary {
  private disposed = false;
  private textures: THREE.Texture[] = [];
  private spriteTextures = new Map<string, THREE.Texture>();
  private spriteBackTextures = new Map<string, THREE.Texture>();
  private spriteAspects = new Map<string, number>();
  private spriteListeners = new Map<string, Array<(aspect: number) => void>>();
  private terrainTextures = new Map<string, THREE.Texture>();
  private foliageTextures = new Map<string, THREE.Texture>();
  private hillTextures = new Map<string, THREE.Texture>();
  private cliffTextures = new Map<string, THREE.Texture>();
  private loader = new THREE.TextureLoader();

  public readonly paperBump: THREE.Texture;
  public readonly corrugatedMap: THREE.Texture;
  public readonly corrugatedBump: THREE.Texture;
  public readonly crateMap: THREE.Texture;
  public readonly crateDamagedMap: THREE.Texture;
  public readonly cageFrontMap: THREE.Texture;
  public readonly cageSideMap: THREE.Texture;
  public readonly haystackMap: THREE.Texture;
  public readonly stoneMap: THREE.Texture;
  public readonly beehiveMap: THREE.Texture;
  public readonly woodDeskMap: THREE.Texture;
  public readonly shieldHalfMap: THREE.Texture;
  public readonly shieldFullMap: THREE.Texture;
  public readonly cliffSideMap: THREE.Texture;
  public readonly treeBarkMap: THREE.Texture;
  public readonly barnWallMap: THREE.Texture;
  public readonly barnRoofMap: THREE.Texture;
  public readonly fenceWoodMap: THREE.Texture;
  public readonly cloudMap: THREE.Texture;
  public readonly pumpkinSkinMap: THREE.Texture;
  public readonly mushroomCapMap: THREE.Texture;
  public readonly woodTokenMap: THREE.Texture;

  constructor() {
    this.paperBump = this.track(this.buildPaperBump());
    const corr = this.buildCorrugatedPair();
    this.corrugatedMap = this.track(corr.map);
    this.corrugatedBump = this.track(corr.bump);
    this.crateMap = this.track(this.buildCrateTexture(false));
    this.crateDamagedMap = this.track(this.buildCrateTexture(true));
    this.cageFrontMap = this.track(this.buildCageTexture(true));
    this.cageSideMap = this.track(this.buildCageTexture(false));
    this.haystackMap = this.track(this.buildHaystackTexture());
    this.stoneMap = this.track(this.buildStoneTexture());
    this.beehiveMap = this.track(this.buildBeehiveTexture());
    this.shieldHalfMap = this.track(this.buildShieldBadgeTexture('half'));
    this.shieldFullMap = this.track(this.buildShieldBadgeTexture('full'));
    this.cliffSideMap = this.getCliffSideTexture('spring');
    this.treeBarkMap = this.track(this.buildTreeBarkTexture());
    this.barnWallMap = this.track(this.buildBarnWallTexture());
    this.barnRoofMap = this.track(this.buildBarnRoofTexture());
    this.fenceWoodMap = this.track(this.buildFenceWoodTexture());
    this.cloudMap = this.track(this.buildCloudTexture());
    this.pumpkinSkinMap = this.track(this.buildPumpkinSkinTexture());
    this.mushroomCapMap = this.track(this.buildMushroomCapTexture());
    this.woodTokenMap = this.track(this.buildWoodTokenTexture());

    this.woodDeskMap = this.track(
      this.loader.load('/ui/wood-desk.jpg', (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.RepeatWrapping;
        tex.repeat.set(3, 3);
        tex.anisotropy = 4;
      })
    );
    this.woodDeskMap.colorSpace = THREE.SRGBColorSpace;
    this.woodDeskMap.wrapS = THREE.RepeatWrapping;
    this.woodDeskMap.wrapT = THREE.RepeatWrapping;
    this.woodDeskMap.repeat.set(3, 3);
  }

  private track<T extends THREE.Texture>(tex: T): T {
    this.textures.push(tex);
    return tex;
  }

  public getSpriteTexturePair(
    visualKind: string,
    onAspectReady?: (aspect: number) => void
  ): { front: THREE.Texture; back: THREE.Texture; aspect: number } {
    let front = this.spriteTextures.get(visualKind);
    let back = this.spriteBackTextures.get(visualKind);

    if (!front || !back) {
      if (visualKind === 'seed_cart') {
        const pair = this.buildSeedCartSpritePair();
        front = this.track(pair.front);
        back = this.track(pair.back);
        this.spriteTextures.set(visualKind, front);
        this.spriteBackTextures.set(visualKind, back);
        this.spriteAspects.set(visualKind, 1.18);
        onAspectReady?.(1.18);
        return { front, back, aspect: 1.18 };
      }

      front = this.loader.load(`/sprites/${visualKind}.png`, (tex) => {
        if (this.disposed) return;
        const img = tex.image as HTMLImageElement | undefined;
        if (img && img.naturalWidth > 0 && img.naturalHeight > 0) {
          const aspect = img.naturalWidth / img.naturalHeight;
          this.spriteAspects.set(visualKind, aspect);
          const cbs = this.spriteListeners.get(visualKind);
          if (cbs) {
            for (const cb of cbs) cb(aspect);
            this.spriteListeners.delete(visualKind);
          }
        }
      });
      front.colorSpace = THREE.SRGBColorSpace;
      front.anisotropy = 4;
      front.minFilter = THREE.LinearMipmapLinearFilter;
      front.magFilter = THREE.LinearFilter;

      back = this.loader.load(`/sprites/${visualKind}.png`);
      back.colorSpace = THREE.SRGBColorSpace;
      back.wrapS = THREE.RepeatWrapping;
      back.repeat.set(-1, 1);
      back.offset.set(1, 0);
      back.anisotropy = 4;

      this.spriteTextures.set(visualKind, this.track(front));
      this.spriteBackTextures.set(visualKind, this.track(back));
    }

    const existingAspect = this.spriteAspects.get(visualKind);
    if (existingAspect !== undefined) {
      onAspectReady?.(existingAspect);
    } else if (onAspectReady) {
      const list = this.spriteListeners.get(visualKind) ?? [];
      list.push(onAspectReady);
      this.spriteListeners.set(visualKind, list);
    }

    return { front, back, aspect: existingAspect ?? 0.92 };
  }

  private buildSeedCartSpritePair(): { front: THREE.CanvasTexture; back: THREE.CanvasTexture } {
    const w = 320;
    const h = 272;
    const { canvas, ctx } = makeCanvas(w, h);
    ctx.clearRect(0, 0, w, h);

    // Glowing heirloom golden seed mound peeking out the corrugated wagon bed
    const glow = ctx.createRadialGradient(160, 108, 12, 160, 108, 92);
    glow.addColorStop(0, '#fff7b0');
    glow.addColorStop(0.55, '#f2c144');
    glow.addColorStop(1, '#c98824');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.ellipse(160, 114, 86, 54, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(110, 68, 22, 0.45)';
    ctx.lineWidth = 3;
    ctx.stroke();

    // Cut-felt sprouting leaf emblem at top of pile
    ctx.fillStyle = '#6eb854';
    ctx.beginPath();
    ctx.ellipse(142, 62, 22, 11, -0.5, 0, Math.PI * 2);
    ctx.ellipse(178, 62, 22, 11, 0.5, 0, Math.PI * 2);
    ctx.fill();

    // Fluted corrugated-cardboard wagon body
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(52, 116, 216, 78, 12);
    ctx.fillStyle = '#cfa06b';
    ctx.fill();
    ctx.clip();
    for (let x = 52; x < 268; x += 12) {
      ctx.fillStyle = 'rgba(255, 242, 214, 0.24)';
      ctx.fillRect(x, 116, 5, 78);
      ctx.fillStyle = 'rgba(72, 42, 16, 0.20)';
      ctx.fillRect(x + 6, 116, 4, 78);
    }
    ctx.restore();
    ctx.strokeStyle = 'rgba(78, 48, 22, 0.52)';
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    ctx.roundRect(52, 116, 216, 78, 12);
    ctx.stroke();

    // Folded gold cardstock trim rail + kraft uprights
    ctx.fillStyle = '#ecc054';
    ctx.fillRect(54, 118, 212, 14);
    ctx.fillStyle = '#b98650';
    ctx.fillRect(110, 118, 10, 74);
    ctx.fillRect(202, 118, 10, 74);

    // Twin turned-birch & coral toy wheels with brass brads
    for (const wx of [100, 220]) {
      ctx.fillStyle = '#cf5640';
      ctx.beginPath();
      ctx.arc(wx, 206, 36, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(84, 34, 22, 0.55)';
      ctx.lineWidth = 3.5;
      ctx.stroke();

      ctx.fillStyle = '#f2dfc0';
      ctx.beginPath();
      ctx.arc(wx, 206, 22, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#dfb244';
      ctx.beginPath();
      ctx.arc(wx, 206, 10, 0, Math.PI * 2);
      ctx.fill();
    }

    const front = finalizeTexture(canvas);
    const back = finalizeTexture(canvas);
    back.wrapS = THREE.RepeatWrapping;
    back.repeat.set(-1, 1);
    back.offset.set(1, 0);
    return { front, back };
  }

  public getTerrainTexture(theme: BoardTheme, terrain: TerrainType, checker: boolean): THREE.Texture {
    const key = `${theme}:${terrain}:${checker ? 'a' : 'b'}`;
    const cached = this.terrainTextures.get(key);
    if (cached) return cached;

    const tex = this.track(this.buildTerrainTileTexture(theme, terrain, checker));
    this.terrainTextures.set(key, tex);
    return tex;
  }

  public getTreeFoliageTexture(variant: TreeFoliageVariant): THREE.Texture {
    const cached = this.foliageTextures.get(variant);
    if (cached) return cached;
    const tex = this.track(this.buildTreeFoliageTexture(variant));
    this.foliageTextures.set(variant, tex);
    return tex;
  }

  public getHillBackdropTexture(theme: BoardTheme, layerIdx: number): THREE.Texture {
    const key = `${theme}:${layerIdx}`;
    const cached = this.hillTextures.get(key);
    if (cached) return cached;
    const tex = this.track(this.buildHillBackdropTexture(theme, layerIdx));
    this.hillTextures.set(key, tex);
    return tex;
  }

  public getCliffSideTexture(theme: BoardTheme): THREE.Texture {
    const cached = this.cliffTextures.get(theme);
    if (cached) return cached;
    const tex = this.track(this.buildCliffSideTexture(theme));
    this.cliffTextures.set(theme, tex);
    return tex;
  }

  private buildPaperBump(): THREE.CanvasTexture {
    const { canvas, ctx } = makeCanvas(256, 256);
    ctx.fillStyle = '#808080';
    ctx.fillRect(0, 0, 256, 256);
    const rng = mulberry(1337);
    for (let i = 0; i < 2400; i++) {
      const x = rng() * 256;
      const y = rng() * 256;
      const v = Math.floor(110 + rng() * 36);
      ctx.fillStyle = `rgb(${v},${v},${v})`;
      ctx.fillRect(x, y, 2 + rng() * 3, 1 + rng() * 2);
    }
    return finalizeTexture(canvas, { repeat: [2, 2], srgb: false });
  }

  private buildCorrugatedPair(): { map: THREE.CanvasTexture; bump: THREE.CanvasTexture } {
    const w = 256;
    const h = 128;
    const diff = makeCanvas(w, h);
    const bump = makeCanvas(w, h);

    // Warm sunlit multi-ply kraft corrugated cardboard (2 stacked plies with recessed flute waves!)
    diff.ctx.fillStyle = '#d7b07e';
    diff.ctx.fillRect(0, 0, w, h);
    bump.ctx.fillStyle = '#929292';
    bump.ctx.fillRect(0, 0, w, h);

    const bands: Array<[number, number]> = [
      [14, 56],
      [72, 114],
    ];
    const flutes = 18;
    const step = w / flutes;
    for (const [y0, y1] of bands) {
      const bh = y1 - y0;
      for (let i = 0; i < flutes; i++) {
        const x = i * step;
        const g = diff.ctx.createLinearGradient(x, 0, x + step, 0);
        g.addColorStop(0, '#5a3a1e');
        g.addColorStop(0.26, '#bd905d');
        g.addColorStop(0.54, '#ddb888');
        g.addColorStop(0.84, '#6e4724');
        g.addColorStop(1, '#5a3a1e');
        diff.ctx.fillStyle = g;
        diff.ctx.fillRect(x, y0, step + 0.5, bh);

        const bg = bump.ctx.createLinearGradient(x, 0, x + step, 0);
        bg.addColorStop(0, '#222222');
        bg.addColorStop(0.5, '#f0f0f0');
        bg.addColorStop(1, '#222222');
        bump.ctx.fillStyle = bg;
        bump.ctx.fillRect(x, y0, step + 0.5, bh);
      }
    }

    // Crisp kraft liner plies (top, center divider, bottom)
    diff.ctx.fillStyle = '#deb98a';
    diff.ctx.fillRect(0, 0, w, 13);
    diff.ctx.fillStyle = '#d2a876';
    diff.ctx.fillRect(0, 57, w, 14);
    diff.ctx.fillStyle = '#c29460';
    diff.ctx.fillRect(0, 115, w, 13);

    diff.ctx.fillStyle = 'rgba(78, 48, 22, 0.55)';
    diff.ctx.fillRect(0, 13, w, 2);
    diff.ctx.fillRect(0, 56, w, 2);
    diff.ctx.fillRect(0, 71, w, 2);
    diff.ctx.fillRect(0, 114, w, 2);

    paintPaperGrain(diff.ctx, w, h, 4242, 0.055);

    return {
      map: finalizeTexture(diff.canvas, { repeat: [4, 1] }),
      bump: finalizeTexture(bump.canvas, { repeat: [4, 1], srgb: false }),
    };
  }

  private buildTerrainTileTexture(
    theme: BoardTheme,
    terrain: TerrainType,
    checker: boolean
  ): THREE.CanvasTexture {
    const s = 256;
    const { canvas, ctx } = makeCanvas(s, s);
    const isAutumn = theme === 'autumn';
    const isGreenhouse = theme === 'greenhouse';
    const isWinter = theme === 'winter';

    // Crisp mid-century color-blocked matte construction paper squares (harmonizing with approved 1+4 mockups!)
    let base = isWinter
      ? checker
        ? '#edf4f8'
        : '#dfe9f1'
      : isAutumn
        ? checker
          ? '#dfb254'
          : '#d2a146'
        : isGreenhouse
          ? checker
            ? '#94c082'
            : '#86b475'
          : checker
            ? '#91b67f'
            : '#7ea873';

    if (terrain === 'soil') {
      base = isWinter
        ? checker
          ? '#a3978c'
          : '#95897e'
        : isAutumn
          ? checker
            ? '#cc7848'
            : '#be6c3e'
          : checker
            ? '#d9ba62'
            : '#ccac54';
    } else if (terrain === 'mud') base = checker ? '#8a684d' : '#7d5d43';
    else if (terrain === 'compost') base = checker ? '#6f553c' : '#634a33';
    else if (terrain === 'gate') base = checker ? '#f2cf68' : '#e4be52';
    else if (terrain === 'barn_floor') {
      base = isWinter
        ? checker
          ? '#c7b9ac'
          : '#b9aba0'
        : isGreenhouse
          ? checker
            ? '#d9a476'
            : '#cd9668'
          : isAutumn
            ? checker
              ? '#c97e52'
              : '#bc7146'
            : checker
              ? '#cfa472'
              : '#c39765';
    } else if (terrain === 'sunbeam') {
      base = checker ? '#f6e28b' : '#ebd473';
    } else if (terrain === 'water') {
      base = isWinter ? (checker ? '#5297b2' : '#488ca6') : checker ? '#4dbcc3' : '#42afb7';
    } else if (terrain === 'ice') {
      base = checker ? '#b8e8f8' : '#a3ddf2';
    } else if (terrain === 'bridge') {
      base = checker ? '#cf9f68' : '#c3925c';
    } else if (terrain === 'lava') {
      base = checker ? '#d64c24' : '#c23f1b';
    } else if (terrain === 'ramp') {
      base = checker ? '#cfa26b' : '#c1945d';
    } else if (terrain === 'burrow') {
      base = checker ? '#9c7852' : '#8e6b47';
    }

    ctx.fillStyle = base;
    ctx.fillRect(0, 0, s, s);

    const seed =
      theme.charCodeAt(0) * 101 + terrain.charCodeAt(0) * 37 + (checker ? 11 : 23);
    paintPaperGrain(ctx, s, s, seed, terrain === 'grass' ? 0.045 : 0.075);

    const rng = mulberry(seed + 99);

    if (terrain === 'grass') {
      // Subtle matte cardstock tonal breath + minimal clean mid-century paper motif
      const g = ctx.createLinearGradient(0, 0, s, s);
      g.addColorStop(0, 'rgba(255, 253, 244, 0.08)');
      g.addColorStop(1, 'rgba(42, 32, 16, 0.06)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, s, s);

      if (isAutumn && checker) {
        // Tiny scissor-cut paper autumn leaf resting flat on cardstock
        const lx = 70 + rng() * 116;
        const ly = 70 + rng() * 116;
        ctx.save();
        ctx.translate(lx, ly);
        ctx.rotate(rng() * Math.PI);
        ctx.fillStyle = 'rgba(196, 86, 48, 0.34)';
        ctx.beginPath();
        ctx.moveTo(-10, 0);
        ctx.quadraticCurveTo(0, -7, 10, 0);
        ctx.quadraticCurveTo(0, 7, -10, 0);
        ctx.fill();
        ctx.restore();
      } else if (isWinter && checker) {
        const sx = 72 + rng() * 112;
        const sy = 72 + rng() * 112;
        ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
        ctx.beginPath();
        ctx.moveTo(sx, sy - 7);
        ctx.lineTo(sx + 2.5, sy);
        ctx.lineTo(sx, sy + 7);
        ctx.lineTo(sx - 2.5, sy);
        ctx.closePath();
        ctx.fill();
      }
    } else if (terrain === 'soil') {
      // Clean parallel pressed-paper garden furrow bands (zero muddy noise!)
      for (let y = 26; y < s; y += 44) {
        ctx.fillStyle = 'rgba(84, 52, 22, 0.14)';
        ctx.beginPath();
        ctx.roundRect(18, y, s - 36, 12, 6);
        ctx.fill();
        ctx.fillStyle = 'rgba(255, 246, 224, 0.16)';
        ctx.beginPath();
        ctx.roundRect(20, y + 12, s - 40, 5, 2.5);
        ctx.fill();
      }
    } else if (terrain === 'mud') {
      const g = ctx.createRadialGradient(s * 0.5, s * 0.5, 16, s * 0.5, s * 0.5, s * 0.44);
      g.addColorStop(0, 'rgba(54, 34, 20, 0.58)');
      g.addColorStop(0.75, 'rgba(88, 60, 38, 0.30)');
      g.addColorStop(1, 'rgba(88, 60, 38, 0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(s * 0.5, s * 0.52, s * 0.40, s * 0.34, 0.12, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255, 248, 232, 0.36)';
      ctx.lineWidth = 4;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(s * 0.44, s * 0.46, 36, Math.PI * 1.12, Math.PI * 1.68);
      ctx.stroke();
    } else if (terrain === 'compost') {
      for (let i = 0; i < 18; i++) {
        ctx.fillStyle = i % 3 === 0 ? 'rgba(146, 202, 102, 0.48)' : 'rgba(42, 24, 12, 0.32)';
        ctx.beginPath();
        ctx.arc(26 + rng() * 204, 26 + rng() * 204, 3.5 + rng() * 4.5, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = '#93cf6e';
      ctx.beginPath();
      ctx.ellipse(s * 0.43, s * 0.46, 18, 9, -0.45, 0, Math.PI * 2);
      ctx.ellipse(s * 0.57, s * 0.46, 18, 9, 0.45, 0, Math.PI * 2);
      ctx.fill();
    } else if (terrain === 'barn_floor') {
      if (isGreenhouse) {
        const cell = 64;
        for (let gy = 0; gy < 4; gy++) {
          for (let gx = 0; gx < 4; gx++) {
            ctx.fillStyle = (gx + gy) % 2 === 0 ? 'rgba(255,244,224,0.14)' : 'rgba(92,50,24,0.08)';
            ctx.fillRect(gx * cell + 3, gy * cell + 3, cell - 6, cell - 6);
          }
        }
        ctx.strokeStyle = 'rgba(94, 58, 30, 0.22)';
        ctx.lineWidth = 2.4;
        for (let i = 0; i <= s; i += cell) {
          ctx.beginPath();
          ctx.moveTo(0, i);
          ctx.lineTo(s, i);
          ctx.moveTo(i, 0);
          ctx.lineTo(i, s);
          ctx.stroke();
        }
      } else {
        for (let y = 0; y < s; y += 64) {
          ctx.fillStyle = (y / 64) % 2 === 0 ? 'rgba(255,246,224,0.12)' : 'rgba(78,44,18,0.06)';
          ctx.fillRect(0, y, s, 64);
          ctx.strokeStyle = 'rgba(84, 52, 24, 0.24)';
          ctx.lineWidth = 2.4;
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(s, y);
          ctx.stroke();
        }
      }
    } else if (terrain === 'gate') {
      ctx.strokeStyle = 'rgba(138, 86, 22, 0.46)';
      ctx.lineWidth = 10;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(s * 0.28, s * 0.62);
      ctx.lineTo(s * 0.5, s * 0.34);
      ctx.lineTo(s * 0.72, s * 0.62);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255, 252, 236, 0.9)';
      ctx.lineWidth = 5;
      ctx.stroke();
    } else if (terrain === 'sunbeam') {
      const g = ctx.createRadialGradient(s / 2, s / 2, 12, s / 2, s / 2, s * 0.46);
      g.addColorStop(0, 'rgba(255, 254, 228, 0.85)');
      g.addColorStop(0.7, 'rgba(248, 214, 96, 0.24)');
      g.addColorStop(1, 'rgba(248, 214, 96, 0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, s, s);
    } else if (terrain === 'water') {
      // Glossy turquoise/teal cut-paper river with crisp white folded paper wave strips!
      const g = ctx.createLinearGradient(0, 0, s, s);
      g.addColorStop(0, 'rgba(182, 244, 246, 0.36)');
      g.addColorStop(0.55, 'rgba(66, 186, 194, 0.08)');
      g.addColorStop(1, 'rgba(32, 118, 134, 0.28)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, s, s);

      ctx.strokeStyle = 'rgba(244, 254, 255, 0.68)';
      ctx.lineWidth = 3.5;
      ctx.lineCap = 'round';
      for (let row = 0; row < 4; row++) {
        const wy = 40 + row * 56;
        ctx.beginPath();
        ctx.moveTo(22, wy);
        ctx.quadraticCurveTo(s * 0.32, wy - 10, s * 0.52, wy);
        ctx.quadraticCurveTo(s * 0.72, wy + 10, s - 22, wy - 3);
        ctx.stroke();
      }
    } else if (terrain === 'bridge') {
      // Authentic fluted corrugated-cardboard bridge ribs + clean kraft edge rails!
      const fluteStep = 16;
      for (let y = 0; y < s; y += fluteStep) {
        const fg = ctx.createLinearGradient(0, y, 0, y + fluteStep);
        fg.addColorStop(0, '#a67442');
        fg.addColorStop(0.35, '#dfba88');
        fg.addColorStop(0.7, '#c7955c');
        fg.addColorStop(1, '#8c5d30');
        ctx.fillStyle = fg;
        ctx.fillRect(14, y, s - 28, fluteStep);
      }
      // Folded corrugated side lip edges
      ctx.fillStyle = '#b9864f';
      ctx.fillRect(0, 0, 14, s);
      ctx.fillRect(s - 14, 0, 14, s);
      ctx.fillStyle = 'rgba(72, 42, 18, 0.32)';
      ctx.fillRect(14, 0, 2.5, s);
      ctx.fillRect(s - 16.5, 0, 2.5, s);
    } else if (terrain === 'lava') {
      const lg = ctx.createRadialGradient(s * 0.5, s * 0.5, 10, s * 0.5, s * 0.5, s * 0.55);
      lg.addColorStop(0, '#ffe052');
      lg.addColorStop(0.45, '#ff6d1f');
      lg.addColorStop(1, '#8a1e0c');
      ctx.fillStyle = lg;
      ctx.fillRect(0, 0, s, s);
      ctx.fillStyle = 'rgba(54, 24, 14, 0.72)';
      for (let i = 0; i < 6; i++) {
        ctx.beginPath();
        ctx.ellipse(
          34 + rng() * 188,
          34 + rng() * 188,
          18 + rng() * 24,
          12 + rng() * 16,
          rng() * Math.PI,
          0,
          Math.PI * 2
        );
        ctx.fill();
      }
    } else if (terrain === 'ramp') {
      // Ribbed corrugated-cardboard ramp treads with crisp cream chevron!
      for (let i = 0; i < 8; i++) {
        const py = i * (s / 8);
        ctx.fillStyle = i % 2 === 0 ? '#dab582' : '#c69862';
        ctx.fillRect(8, py + 1, s - 16, s / 8 - 2);
        ctx.fillStyle = 'rgba(76, 46, 20, 0.22)';
        ctx.fillRect(8, py + s / 8 - 3, s - 16, 3);
      }
      ctx.strokeStyle = 'rgba(255, 250, 234, 0.78)';
      ctx.lineWidth = 7;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(s * 0.32, s * 0.62);
      ctx.lineTo(s * 0.5, s * 0.38);
      ctx.lineTo(s * 0.68, s * 0.62);
      ctx.stroke();
    } else if (terrain === 'burrow') {
      const g = ctx.createRadialGradient(s * 0.5, s * 0.5, 16, s * 0.5, s * 0.5, s * 0.46);
      g.addColorStop(0, '#22140a');
      g.addColorStop(0.55, '#462c18');
      g.addColorStop(0.75, '#ad7b4a');
      g.addColorStop(1, 'rgba(138, 98, 60, 0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(s * 0.5, s * 0.5, s * 0.46, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(56, 228, 212, 0.88)';
      ctx.lineWidth = 7;
      ctx.setLineDash([18, 10]);
      ctx.beginPath();
      ctx.arc(s * 0.5, s * 0.5, s * 0.34, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    } else if (terrain === 'bounce_pad') {
      const mg = ctx.createRadialGradient(s * 0.5, s * 0.5, 16, s * 0.5, s * 0.5, s * 0.48);
      mg.addColorStop(0, '#ff688c');
      mg.addColorStop(0.55, '#d63358');
      mg.addColorStop(0.75, '#77b044');
      mg.addColorStop(1, 'rgba(119, 176, 68, 0)');
      ctx.fillStyle = mg;
      ctx.beginPath();
      ctx.arc(s * 0.5, s * 0.5, s * 0.46, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255, 240, 178, 0.92)';
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.arc(s * 0.5, s * 0.5, s * 0.35, 0, Math.PI * 2);
      ctx.stroke();
    } else if (terrain === 'ice') {
      const ig = ctx.createLinearGradient(0, 0, s, s);
      ig.addColorStop(0, 'rgba(240, 252, 255, 0.72)');
      ig.addColorStop(0.5, 'rgba(165, 225, 248, 0.24)');
      ig.addColorStop(1, 'rgba(84, 168, 212, 0.32)');
      ctx.fillStyle = ig;
      ctx.fillRect(0, 0, s, s);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.42)';
      ctx.beginPath();
      ctx.moveTo(22, 0);
      ctx.lineTo(74, 0);
      ctx.lineTo(0, 74);
      ctx.lineTo(0, 22);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(148, 0);
      ctx.lineTo(188, 0);
      ctx.lineTo(0, 188);
      ctx.lineTo(0, 148);
      ctx.closePath();
      ctx.fill();
    }

    // Crisp subtle mitered cardstock tile edge (NO heavy brown ink cartoon borders!)
    ctx.strokeStyle =
      terrain === 'lava'
        ? 'rgba(255, 198, 92, 0.45)'
        : terrain === 'water' || terrain === 'ice'
          ? 'rgba(224, 252, 255, 0.45)'
          : 'rgba(66, 48, 28, 0.14)';
    ctx.lineWidth = 3;
    ctx.strokeRect(1.5, 1.5, s - 3, s - 3);
    ctx.strokeStyle =
      terrain === 'water' || terrain === 'ice'
        ? 'rgba(242, 254, 255, 0.45)'
        : 'rgba(255, 252, 240, 0.26)';
    ctx.lineWidth = 2;
    ctx.strokeRect(5, 5, s - 10, s - 10);

    return finalizeTexture(canvas);
  }

  private buildCliffSideTexture(theme: BoardTheme = 'spring'): THREE.CanvasTexture {
    const w = 256;
    const h = 256;
    const { canvas, ctx } = makeCanvas(w, h);
    const isAutumn = theme === 'autumn';
    const isGreenhouse = theme === 'greenhouse';
    const isWinter = theme === 'winter';

    // Authentic 3-ply stacked fluted corrugated-cardboard elevation risers (matching our 1+4 dioramas!)
    ctx.fillStyle = isWinter ? '#cbbba4' : '#d2a876';
    ctx.fillRect(0, 0, w, h);

    // 3 stacked corrugated cardboard strata layers
    const layerBounds: Array<[number, number]> = [
      [34, 96],
      [110, 172],
      [186, 244],
    ];
    const flutes = 16;
    const step = w / flutes;
    for (let li = 0; li < layerBounds.length; li++) {
      const [y0, y1] = layerBounds[li];
      const bh = y1 - y0;
      const darkShift = li * 10;
      for (let i = 0; i < flutes; i++) {
        const x = i * step;
        const g = ctx.createLinearGradient(x, 0, x + step, 0);
        g.addColorStop(0, `rgb(${Math.max(48, 92 - darkShift)}, ${Math.max(30, 58 - darkShift)}, ${Math.max(16, 30 - darkShift)})`);
        g.addColorStop(0.28, `rgb(${194 - darkShift}, ${152 - darkShift}, ${102 - darkShift})`);
        g.addColorStop(0.56, `rgb(${222 - darkShift}, ${184 - darkShift}, ${134 - darkShift})`);
        g.addColorStop(0.84, `rgb(${Math.max(54, 108 - darkShift)}, ${Math.max(36, 70 - darkShift)}, ${Math.max(20, 36 - darkShift)})`);
        g.addColorStop(1, `rgb(${Math.max(48, 92 - darkShift)}, ${Math.max(30, 58 - darkShift)}, ${Math.max(16, 30 - darkShift)})`);
        ctx.fillStyle = g;
        ctx.fillRect(x, y0, step + 0.5, bh);
      }

      // Warm kraft liner strip separating corrugated tiers
      ctx.fillStyle = li === 0 ? '#dfc092' : li === 1 ? '#d2ad7b' : '#c49b68';
      ctx.fillRect(0, y1, w, 14);
      ctx.fillStyle = 'rgba(66, 38, 16, 0.42)';
      ctx.fillRect(0, y0 - 2, w, 2.5);
      ctx.fillRect(0, y1, w, 2.5);
    }

    // Crisp flat-cut matte construction-paper top cap lip matching the season cardstock!
    const capColor = isWinter ? '#edf4f8' : isAutumn ? '#d9aa4e' : isGreenhouse ? '#8dba7b' : '#8cb37a';
    ctx.fillStyle = capColor;
    ctx.fillRect(0, 0, w, 24);
    ctx.fillStyle = '#e5c699';
    ctx.fillRect(0, 24, w, 10);
    ctx.fillStyle = 'rgba(62, 38, 18, 0.28)';
    ctx.fillRect(0, 23, w, 2.5);

    paintPaperGrain(ctx, w, h, 8821, 0.06);
    return finalizeTexture(canvas);
  }

  private buildCrateTexture(damaged: boolean): THREE.CanvasTexture {
    const s = 256;
    const { canvas, ctx } = makeCanvas(s, s);
    // Genuine miniature fluted corrugated-cardboard tactical cover crate!
    ctx.fillStyle = '#c89b66';
    ctx.fillRect(0, 0, s, s);

    // Recessed vertical corrugated kraft flutes inside the crate panel
    const flutes = 14;
    const step = (s - 52) / flutes;
    for (let i = 0; i < flutes; i++) {
      const x = 26 + i * step;
      const g = ctx.createLinearGradient(x, 0, x + step, 0);
      g.addColorStop(0, '#784e28');
      g.addColorStop(0.32, '#c89a64');
      g.addColorStop(0.6, '#dec090');
      g.addColorStop(0.88, '#875a30');
      g.addColorStop(1, '#784e28');
      ctx.fillStyle = g;
      ctx.fillRect(x, 26, step + 0.5, s - 52);
    }

    // Subtle inset panel drop shadow
    ctx.strokeStyle = 'rgba(54, 30, 12, 0.36)';
    ctx.lineWidth = 6;
    ctx.strokeRect(28, 28, s - 56, s - 56);

    // Mitered thick kraft cardstock outer frame strips
    const frame = 28;
    ctx.fillStyle = '#dcba8a';
    ctx.fillRect(0, 0, s, frame);
    ctx.fillRect(0, s - frame, s, frame);
    ctx.fillRect(0, 0, frame, s);
    ctx.fillRect(s - frame, 0, frame, s);

    // Diagonal corrugated reinforcement strap
    ctx.save();
    ctx.shadowColor = 'rgba(44, 24, 10, 0.28)';
    ctx.shadowBlur = 4;
    ctx.shadowOffsetY = 3;
    ctx.strokeStyle = '#d4af7c';
    ctx.lineWidth = 22;
    ctx.beginPath();
    ctx.moveTo(26, s - 26);
    ctx.lineTo(s - 26, 26);
    ctx.stroke();
    ctx.restore();
    ctx.strokeStyle = 'rgba(72, 44, 18, 0.36)';
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.moveTo(30, s - 41);
    ctx.lineTo(s - 41, 30);
    ctx.moveTo(41, s - 30);
    ctx.lineTo(s - 30, 41);
    ctx.stroke();

    paintPaperGrain(ctx, s, s, damaged ? 999 : 501, 0.07);

    // Clean cut-cardboard edges & tiny metallic brass corner brads
    ctx.strokeStyle = 'rgba(72, 44, 20, 0.42)';
    ctx.lineWidth = 4;
    ctx.strokeRect(2, 2, s - 4, s - 4);
    ctx.lineWidth = 2.5;
    ctx.strokeRect(frame, frame, s - frame * 2, s - frame * 2);

    for (const [nx, ny] of [
      [14, 14],
      [s - 14, 14],
      [14, s - 14],
      [s - 14, s - 14],
    ]) {
      const bg = ctx.createRadialGradient(nx - 2, ny - 2, 1, nx, ny, 5.5);
      bg.addColorStop(0, '#fff0b8');
      bg.addColorStop(0.6, '#cfa03c');
      bg.addColorStop(1, '#7c5416');
      ctx.fillStyle = bg;
      ctx.beginPath();
      ctx.arc(nx, ny, 5.5, 0, Math.PI * 2);
      ctx.fill();
    }

    if (damaged) {
      // Torn kraft cardboard creases & exposed dark flute rip!
      ctx.strokeStyle = '#4e2c14';
      ctx.lineWidth = 6;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(56, 44);
      ctx.lineTo(106, 110);
      ctx.lineTo(84, 158);
      ctx.lineTo(146, 210);
      ctx.moveTo(106, 110);
      ctx.lineTo(188, 92);
      ctx.stroke();
    }

    return finalizeTexture(canvas);
  }

  private buildCageTexture(withEyes: boolean): THREE.CanvasTexture {
    const s = 256;
    const { canvas, ctx } = makeCanvas(s, s);
    // Dark interior burlap shadow
    ctx.fillStyle = '#3e2615';
    ctx.fillRect(0, 0, s, s);

    // Woven burlap sack bulge inside
    ctx.fillStyle = '#c9a36b';
    ctx.fillRect(26, 26, s - 52, s - 52);
    ctx.strokeStyle = 'rgba(92, 58, 26, 0.35)';
    ctx.lineWidth = 3;
    for (let i = 34; i < s - 30; i += 14) {
      ctx.beginPath();
      ctx.moveTo(i, 26);
      ctx.lineTo(i, s - 26);
      ctx.moveTo(26, i);
      ctx.lineTo(s - 26, i);
      ctx.stroke();
    }

    // Dark peeking slit + cute cartoon eyes!
    if (withEyes) {
      ctx.fillStyle = '#251409';
      ctx.fillRect(26, 62, s - 52, 66);
      // Left eye
      ctx.fillStyle = '#fff9eb';
      ctx.beginPath();
      ctx.ellipse(98, 96, 18, 22, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#3a2010';
      ctx.lineWidth = 4;
      ctx.stroke();
      ctx.fillStyle = '#2d160a';
      ctx.beginPath();
      ctx.arc(103, 98, 8.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(106, 94, 3, 0, Math.PI * 2);
      ctx.fill();

      // Right eye
      ctx.fillStyle = '#fff9eb';
      ctx.beginPath();
      ctx.ellipse(158, 96, 18, 22, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#3a2010';
      ctx.lineWidth = 4;
      ctx.stroke();
      ctx.fillStyle = '#2d160a';
      ctx.beginPath();
      ctx.arc(163, 98, 8.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(166, 94, 3, 0, Math.PI * 2);
      ctx.fill();
    }

    // Wooden cage slats across front
    ctx.fillStyle = '#a46936';
    for (const y of [0, 128, 178, s - 30]) {
      ctx.fillRect(0, y, s, y === 0 || y === s - 30 ? 30 : 28);
      ctx.strokeStyle = '#422411';
      ctx.lineWidth = 4;
      ctx.strokeRect(2, y + 2, s - 4, (y === 0 || y === s - 30 ? 30 : 28) - 4);
    }
    // Side vertical posts
    ctx.fillStyle = '#b4763f';
    ctx.fillRect(0, 0, 28, s);
    ctx.fillRect(s - 28, 0, 28, s);
    ctx.strokeStyle = '#422411';
    ctx.lineWidth = 6;
    ctx.strokeRect(3, 3, s - 6, s - 6);
    ctx.lineWidth = 4;
    ctx.strokeRect(28, 0, s - 56, s);

    paintPaperGrain(ctx, s, s, 777, 0.08);
    return finalizeTexture(canvas);
  }

  private buildHaystackTexture(): THREE.CanvasTexture {
    const s = 256;
    const { canvas, ctx } = makeCanvas(s, s);
    const grad = ctx.createLinearGradient(0, 0, 0, s);
    grad.addColorStop(0, '#fae078');
    grad.addColorStop(0.55, '#e6b843');
    grad.addColorStop(1, '#c48a24');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, s, s);

    const rng = mulberry(3141);
    ctx.lineCap = 'round';
    for (let i = 0; i < 280; i++) {
      const x = rng() * s;
      const y = rng() * s;
      const len = 14 + rng() * 28;
      const tilt = (rng() - 0.5) * 0.65;
      ctx.strokeStyle =
        i % 4 === 0 ? '#6e3f10' : i % 4 === 1 ? '#fff4b8' : i % 4 === 2 ? '#c4871e' : '#e6a82e';
      ctx.lineWidth = i % 4 === 0 ? 2.8 : 3.6;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.sin(tilt) * len, y + Math.cos(tilt) * len);
      ctx.stroke();
    }

    // Braided rustic twine binding band cinched across the bundle!
    for (const ty of [78, 178]) {
      ctx.fillStyle = '#8f5524';
      ctx.fillRect(0, ty, s, 14);
      ctx.strokeStyle = '#42220d';
      ctx.lineWidth = 3.5;
      ctx.beginPath();
      ctx.moveTo(0, ty);
      ctx.lineTo(s, ty);
      ctx.moveTo(0, ty + 14);
      ctx.lineTo(s, ty + 14);
      ctx.stroke();
      ctx.strokeStyle = '#c48646';
      ctx.lineWidth = 2.5;
      for (let x = 0; x < s; x += 16) {
        ctx.beginPath();
        ctx.moveTo(x, ty + 12);
        ctx.lineTo(x + 12, ty + 2);
        ctx.stroke();
      }
    }

    paintPaperGrain(ctx, s, s, 3142, 0.08);
    return finalizeTexture(canvas, { repeat: [2, 1] });
  }

  private buildStoneTexture(): THREE.CanvasTexture {
    const s = 256;
    const { canvas, ctx } = makeCanvas(s, s);
    // Warm sunlit granite cartoon watercolor stone base
    const grad = ctx.createLinearGradient(0, 0, s, s);
    grad.addColorStop(0, '#c4c8be');
    grad.addColorStop(0.55, '#9ea59d');
    grad.addColorStop(1, '#757e7a');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, s, s);

    const rng = mulberry(8821);
    // Painted watercolor rock facets (warm highlights & cool slate shadows)
    for (let i = 0; i < 28; i++) {
      const cx = rng() * s;
      const cy = rng() * s;
      const r = 18 + rng() * 34;
      ctx.fillStyle =
        i % 3 === 0
          ? 'rgba(246, 244, 232, 0.30)'
          : i % 3 === 1
            ? 'rgba(62, 74, 76, 0.24)'
            : 'rgba(130, 140, 126, 0.25)';
      ctx.beginPath();
      const sides = 5 + (i % 3);
      for (let k = 0; k < sides; k++) {
        const a = (k / sides) * Math.PI * 2 + rng() * 0.4;
        const rad = r * (0.7 + rng() * 0.4);
        const px = cx + Math.cos(a) * rad;
        const py = cy + Math.sin(a) * rad;
        if (k === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
    }

    // Velvety storybook-watercolor sage moss patches clinging to the boulder
    for (let i = 0; i < 6; i++) {
      const mx = 26 + rng() * 204;
      const my = 20 + rng() * 150;
      const mr = 14 + rng() * 18;
      ctx.fillStyle = i % 2 === 0 ? '#78a850' : '#608f42';
      ctx.strokeStyle = 'rgba(62, 88, 38, 0.65)';
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.arc(mx, my, mr, 0, Math.PI * 2);
      ctx.arc(mx + mr * 0.65, my + 4, mr * 0.72, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    // Delicate hand-inked storybook boulder fracture lines & mineral speckles
    ctx.strokeStyle = 'rgba(64, 50, 38, 0.46)';
    ctx.lineWidth = 2.6;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (let i = 0; i < 6; i++) {
      let cx = 24 + rng() * 200;
      let cy = 24 + rng() * 200;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      for (let seg = 0; seg < 3; seg++) {
        cx += (rng() - 0.5) * 48;
        cy += 12 + rng() * 26;
        ctx.lineTo(cx, cy);
      }
      ctx.stroke();
    }
    for (let i = 0; i < 40; i++) {
      ctx.fillStyle = i % 2 === 0 ? 'rgba(52, 46, 40, 0.30)' : 'rgba(252, 248, 236, 0.40)';
      ctx.beginPath();
      ctx.arc(rng() * s, rng() * s, 2 + rng() * 2.5, 0, Math.PI * 2);
      ctx.fill();
    }

    paintPaperGrain(ctx, s, s, 8822, 0.11);
    return finalizeTexture(canvas);
  }

  private buildBeehiveTexture(): THREE.CanvasTexture {
    const s = 256;
    const { canvas, ctx } = makeCanvas(s, s);
    ctx.fillStyle = '#efc050';
    ctx.fillRect(0, 0, s, s);
    for (let y = 0; y < s; y += 36) {
      const g = ctx.createLinearGradient(0, y, 0, y + 36);
      g.addColorStop(0, '#ffe385');
      g.addColorStop(0.55, '#e8ad32');
      g.addColorStop(1, '#9c6014');
      ctx.fillStyle = g;
      ctx.fillRect(0, y, s, 36);
      ctx.fillStyle = '#4a2a14';
      ctx.fillRect(0, y + 32.5, s, 4);
    }
    // Glistening golden honey drips trickling down coils!
    ctx.fillStyle = '#f5a81c';
    ctx.strokeStyle = '#5c330c';
    ctx.lineWidth = 2.5;
    for (const [dx, dh] of [
      [54, 48],
      [142, 62],
      [212, 38],
    ]) {
      ctx.beginPath();
      ctx.moveTo(dx - 8, 70);
      ctx.lineTo(dx - 6, 70 + dh);
      ctx.arc(dx, 70 + dh, 6, Math.PI, 0, true);
      ctx.lineTo(dx + 8, 70);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
    paintPaperGrain(ctx, s, s, 6060, 0.07);
    return finalizeTexture(canvas, { repeat: [2, 1] });
  }

  private buildTreeBarkTexture(): THREE.CanvasTexture {
    const s = 256;
    const { canvas, ctx } = makeCanvas(s, s);
    // Pale lathe-turned Scandinavian birch wooden dowel trunk (matching our 1+4 cardboard mockups!)
    const grad = ctx.createLinearGradient(0, 0, s, 0);
    grad.addColorStop(0, '#c69e6d');
    grad.addColorStop(0.38, '#e3c393');
    grad.addColorStop(0.7, '#d4af7d');
    grad.addColorStop(1, '#b98f5e');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, s, s);

    ctx.lineCap = 'round';
    for (let x = 14; x < s; x += 28) {
      ctx.strokeStyle = 'rgba(130, 88, 48, 0.22)';
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.bezierCurveTo(x + 5, s * 0.35, x - 5, s * 0.68, x + 2, s);
      ctx.stroke();
    }
    paintPaperGrain(ctx, s, s, 4513, 0.05);
    return finalizeTexture(canvas, { repeat: [2, 1] });
  }

  private buildTreeFoliageTexture(variant: TreeFoliageVariant): THREE.CanvasTexture {
    const s = 256;
    const { canvas, ctx } = makeCanvas(s, s);
    const palettes: Record<
      TreeFoliageVariant,
      { bg: string; dark: string; mid: string; light: string; accent: string; accent2: string }
    > = {
      spring_green: {
        bg: '#55966a',
        dark: '#3b7352',
        mid: '#5da06d',
        light: '#8bc07d',
        accent: '#e0664e',
        accent2: '#f5dc84',
      },
      spring_blossom: {
        bg: '#ebafc0',
        dark: '#cf8ba0',
        mid: '#f2c0ce',
        light: '#fce1e8',
        accent: '#fff9fb',
        accent2: '#f5dc8c',
      },
      summer_citrus: {
        bg: '#5aa068',
        dark: '#3f7c4f',
        mid: '#6eb473',
        light: '#9acc82',
        accent: '#ea9942',
        accent2: '#f7df7c',
      },
      autumn_crimson: {
        bg: '#c85a3a',
        dark: '#9c3e26',
        mid: '#d66d42',
        light: '#e89658',
        accent: '#f0c458',
        accent2: '#e67848',
      },
      autumn_gold: {
        bg: '#dfa844',
        dark: '#bc852c',
        mid: '#eab954',
        light: '#f7d87c',
        accent: '#cf5638',
        accent2: '#fbf0c4',
      },
      winter_pine: {
        bg: '#588882',
        dark: '#3f6865',
        mid: '#6c9c94',
        light: '#eef6fa',
        accent: '#ffffff',
        accent2: '#d65242',
      },
    };
    const p = palettes[variant];
    const grad = ctx.createLinearGradient(0, 0, 0, s);
    grad.addColorStop(0, p.light);
    grad.addColorStop(0.55, p.mid);
    grad.addColorStop(1, p.dark);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, s, s);

    // Crisp mid-century cut-paper chevron / scalloped foliage pleats (NO dark cartoon ink!)
    for (let row = 0; row < 5; row++) {
      const y = row * 52 + 12;
      ctx.fillStyle = row % 2 === 0 ? 'rgba(255, 252, 240, 0.11)' : 'rgba(34, 24, 14, 0.08)';
      ctx.beginPath();
      ctx.moveTo(0, y);
      for (let x = 0; x <= s; x += 32) {
        ctx.lineTo(x + 16, y + 18);
        ctx.lineTo(x + 32, y);
      }
      ctx.lineTo(s, y + 32);
      ctx.lineTo(0, y + 32);
      ctx.closePath();
      ctx.fill();
    }

    const rng = mulberry(variant.charCodeAt(7) * 317 + 41);
    for (let i = 0; i < 8; i++) {
      const ax = 24 + rng() * 208;
      const ay = 24 + rng() * 208;
      ctx.fillStyle = i % 2 === 0 ? p.accent : p.accent2;
      ctx.beginPath();
      ctx.arc(ax, ay, 6.2, 0, Math.PI * 2);
      ctx.fill();
    }

    paintPaperGrain(ctx, s, s, 9123, 0.065);
    return finalizeTexture(canvas, { repeat: [2, 1] });
  }

  private buildHillBackdropTexture(theme: BoardTheme, layerIdx: number): THREE.CanvasTexture {
    const s = 256;
    const { canvas, ctx } = makeCanvas(s, s);
    const isAutumn = theme === 'autumn';
    const isGreenhouse = theme === 'greenhouse';
    const isWinter = theme === 'winter';

    // Crisp flat-faceted mid-century cut-paper horizon hill cardstock colors
    const topCol = isWinter
      ? ['#eef6fa', '#d8eaf4', '#bed8e8'][layerIdx % 3]
      : isAutumn
        ? ['#e6ba5e', '#d6894a', '#be6a44'][layerIdx % 3]
        : isGreenhouse
          ? ['#98c688', '#7cb274', '#639b66'][layerIdx % 3]
          : ['#9fc48a', '#7eb07c', '#639b74'][layerIdx % 3];
    const botCol = isWinter
      ? ['#bcd5e6', '#9abbd1', '#7ea4be'][layerIdx % 3]
      : isAutumn
        ? ['#cc9542', '#b86834', '#984d30'][layerIdx % 3]
        : isGreenhouse
          ? ['#76a868', '#5e9158', '#4d7c4e'][layerIdx % 3]
          : ['#7ea96a', '#639464', '#4d7f5c'][layerIdx % 3];

    const grad = ctx.createLinearGradient(0, 0, 0, s);
    grad.addColorStop(0, topCol);
    grad.addColorStop(1, botCol);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, s, s);

    // Subtle matte construction-paper contour bands
    ctx.fillStyle = isWinter ? 'rgba(255, 255, 255, 0.22)' : 'rgba(255, 252, 234, 0.12)';
    for (let i = 0; i < 3; i++) {
      const y = 44 + i * 68;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.quadraticCurveTo(s * 0.5, y - 20, s, y + 6);
      ctx.lineTo(s, y + 24);
      ctx.quadraticCurveTo(s * 0.5, y - 2, 0, y + 18);
      ctx.closePath();
      ctx.fill();
    }

    paintPaperGrain(ctx, s, s, 3030 + layerIdx, 0.065);
    return finalizeTexture(canvas, { repeat: [1, 1] });
  }

  private buildBarnWallTexture(): THREE.CanvasTexture {
    const s = 256;
    const { canvas, ctx } = makeCanvas(s, s);
    // Folded fluted corrugated coral-red cardboard barn walls (matching our approved Spring & Autumn mockups!)
    ctx.fillStyle = '#cf5a44';
    ctx.fillRect(0, 0, s, s);

    const flutes = 16;
    const step = s / flutes;
    for (let i = 0; i < flutes; i++) {
      const x = i * step;
      const g = ctx.createLinearGradient(x, 0, x + step, 0);
      g.addColorStop(0, '#963828');
      g.addColorStop(0.32, '#d8644c');
      g.addColorStop(0.58, '#e67d62');
      g.addColorStop(0.88, '#a84230');
      g.addColorStop(1, '#963828');
      ctx.fillStyle = g;
      ctx.fillRect(x, 0, step + 0.5, s);
    }

    // Warm folded kraft paper corner trim
    ctx.fillStyle = '#e8cda2';
    ctx.fillRect(0, 0, 12, s);
    ctx.fillRect(s - 12, 0, 12, s);
    ctx.fillRect(0, 0, s, 10);

    paintPaperGrain(ctx, s, s, 5511, 0.06);
    return finalizeTexture(canvas);
  }

  private buildBarnRoofTexture(): THREE.CanvasTexture {
    const s = 256;
    const { canvas, ctx } = makeCanvas(s, s);
    // Warm sunlit corrugated kraft / ochre folded paper roof (like our Spring/Autumn mockups!)
    ctx.fillStyle = '#d49a4c';
    ctx.fillRect(0, 0, s, s);

    const flutes = 14;
    const step = s / flutes;
    for (let i = 0; i < flutes; i++) {
      const x = i * step;
      const g = ctx.createLinearGradient(x, 0, x + step, 0);
      g.addColorStop(0, '#a36e2c');
      g.addColorStop(0.36, '#dca554');
      g.addColorStop(0.65, '#ebc074');
      g.addColorStop(1, '#a36e2c');
      ctx.fillStyle = g;
      ctx.fillRect(x, 0, step + 0.5, s);
    }

    paintPaperGrain(ctx, s, s, 5512, 0.06);
    return finalizeTexture(canvas, { repeat: [2, 2] });
  }

  private buildFenceWoodTexture(): THREE.CanvasTexture {
    const s = 128;
    const { canvas, ctx } = makeCanvas(s, s);
    ctx.fillStyle = '#e8cfa6';
    ctx.fillRect(0, 0, s, s);
    ctx.strokeStyle = 'rgba(138, 98, 56, 0.22)';
    ctx.lineWidth = 2;
    for (let x = 14; x < s; x += 22) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.bezierCurveTo(x + 3, s * 0.4, x - 3, s * 0.7, x, s);
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(104, 70, 38, 0.28)';
    ctx.lineWidth = 3;
    ctx.strokeRect(1.5, 1.5, s - 3, s - 3);
    paintPaperGrain(ctx, s, s, 5513, 0.055);
    return finalizeTexture(canvas);
  }

  private buildCloudTexture(): THREE.CanvasTexture {
    const s = 128;
    const { canvas, ctx } = makeCanvas(s, s);
    const grad = ctx.createLinearGradient(0, 0, 0, s);
    grad.addColorStop(0, '#fffef9');
    grad.addColorStop(0.72, '#faf5e8');
    grad.addColorStop(1, '#ede6d4');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, s, s);
    paintPaperGrain(ctx, s, s, 5514, 0.055);
    return finalizeTexture(canvas);
  }

  private buildPumpkinSkinTexture(): THREE.CanvasTexture {
    const s = 256;
    const { canvas, ctx } = makeCanvas(s, s);
    const grad = ctx.createLinearGradient(0, 0, 0, s);
    grad.addColorStop(0, '#ff9c33');
    grad.addColorStop(0.55, '#eb6f14');
    grad.addColorStop(1, '#b5450b');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, s, s);

    // Bold storybook vertical pumpkin ribs + sunlit highlight bands
    for (let x = 0; x < s; x += 32) {
      const rg = ctx.createLinearGradient(x, 0, x + 32, 0);
      rg.addColorStop(0, 'rgba(92, 32, 6, 0.45)');
      rg.addColorStop(0.3, 'rgba(255, 210, 120, 0.28)');
      rg.addColorStop(0.75, 'rgba(235, 110, 20, 0.05)');
      rg.addColorStop(1, 'rgba(92, 32, 6, 0.45)');
      ctx.fillStyle = rg;
      ctx.fillRect(x, 0, 32, s);

      ctx.strokeStyle = '#5e2408';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, s);
      ctx.stroke();
    }
    paintPaperGrain(ctx, s, s, 5515, 0.07);
    return finalizeTexture(canvas, { repeat: [2, 1] });
  }

  private buildMushroomCapTexture(): THREE.CanvasTexture {
    const s = 256;
    const { canvas, ctx } = makeCanvas(s, s);
    const grad = ctx.createRadialGradient(s * 0.5, s * 0.25, 16, s * 0.5, s * 0.5, s * 0.65);
    grad.addColorStop(0, '#ff596c');
    grad.addColorStop(0.65, '#db2a42');
    grad.addColorStop(1, '#99182c');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, s, s);

    // Crisp chocolate-inked cream toadstool spots!
    const spots: Array<[number, number, number]> = [
      [42, 64, 24],
      [126, 48, 28],
      [210, 74, 22],
      [78, 148, 26],
      [174, 142, 24],
      [34, 204, 18],
      [130, 212, 20],
      [224, 202, 18],
    ];
    for (const [sx, sy, sr] of spots) {
      ctx.fillStyle = '#fff8e2';
      ctx.strokeStyle = '#5c1820';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(sx, sy, sr, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    paintPaperGrain(ctx, s, s, 5516, 0.07);
    return finalizeTexture(canvas);
  }

  private buildWoodTokenTexture(): THREE.CanvasTexture {
    const s = 256;
    const { canvas, ctx } = makeCanvas(s, s);
    ctx.fillStyle = '#f5ead0';
    ctx.fillRect(0, 0, s, s);
    // Warm concentric lathe-turned wood rings + soft grain lines
    const cx = s / 2;
    const cy = s / 2;
    ctx.strokeStyle = 'rgba(130, 86, 42, 0.18)';
    ctx.lineWidth = 3;
    for (let r = 18; r < s * 0.62; r += 18) {
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(110, 68, 28, 0.12)';
    ctx.lineWidth = 2;
    for (let y = 12; y < s; y += 20) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.bezierCurveTo(s * 0.35, y - 6, s * 0.65, y + 6, s, y);
      ctx.stroke();
    }
    paintPaperGrain(ctx, s, s, 5517, 0.08);
    return finalizeTexture(canvas);
  }

  private buildShieldBadgeTexture(level: 'half' | 'full'): THREE.CanvasTexture {
    const s = 160;
    const { canvas, ctx } = makeCanvas(s, s);
    ctx.clearRect(0, 0, s, s);

    const drawShieldPath = (pad: number) => {
      const cx = s / 2;
      const top = 16 + pad;
      const bot = s - 16 - pad;
      const w = s / 2 - 22 - pad;
      ctx.beginPath();
      ctx.moveTo(cx, top);
      ctx.lineTo(cx + w, top + 18);
      ctx.quadraticCurveTo(cx + w, s * 0.64, cx, bot);
      ctx.quadraticCurveTo(cx - w, s * 0.64, cx - w, top + 18);
      ctx.closePath();
    };

    // Cream Paper Mario cutout border
    drawShieldPath(-8);
    ctx.fillStyle = '#fbf3df';
    ctx.fill();
    ctx.lineWidth = 6;
    ctx.strokeStyle = '#4a2c17';
    ctx.stroke();

    // Inner shield fill
    ctx.save();
    drawShieldPath(4);
    ctx.clip();

    if (level === 'full') {
      const g = ctx.createLinearGradient(0, 18, 0, s - 18);
      g.addColorStop(0, '#3ca0e8');
      g.addColorStop(1, '#1c69b5');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, s, s);
    } else {
      ctx.fillStyle = '#f6ebd2';
      ctx.fillRect(0, 0, s, s);
      const g = ctx.createLinearGradient(0, 18, 0, s - 18);
      g.addColorStop(0, '#f3b732');
      g.addColorStop(1, '#d8861c');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, s / 2, s);
    }
    ctx.restore();

    // Inner crisp outline
    drawShieldPath(4);
    ctx.lineWidth = 5;
    ctx.strokeStyle = '#4a2c17';
    ctx.stroke();

    // Bold percentage text
    ctx.font = '800 32px Fredoka, Nunito, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 6;
    ctx.strokeStyle = '#3a2010';
    const label = level === 'full' ? '100%' : '50%';
    ctx.strokeText(label, s / 2, s * 0.52);
    ctx.fillStyle = '#fffdf5';
    ctx.fillText(label, s / 2, s * 0.52);

    return finalizeTexture(canvas);
  }

  public dispose(): void {
    this.disposed = true;
    for (const tex of this.textures) {
      tex.dispose();
    }
    this.textures = [];
    this.spriteTextures.clear();
    this.spriteBackTextures.clear();
    this.terrainTextures.clear();
    this.foliageTextures.clear();
    this.hillTextures.clear();
    this.cliffTextures.clear();
  }
}

export interface StandeeStatusOverlay {
  burn: THREE.Group;
  rooted: THREE.Group;
  acid: THREE.Group;
  feared: THREE.Group;
  shield: THREE.Group;
  boosted: THREE.Group;
  overwatch: THREE.Group;
  frost: THREE.Group;
  lowHp: THREE.Group;
  bandAid: THREE.Group;
  enragedAura: THREE.Group;
}

export interface PaperStandeeRig {
  root: THREE.Group;
  flipGroup: THREE.Group;
  tiltGroup: THREE.Group;
  frontMat: THREE.MeshStandardMaterial;
  backMat: THREE.MeshStandardMaterial;
  coreMat: THREE.MeshStandardMaterial;
  ringMesh: THREE.Mesh;
  ringMat: THREE.MeshBasicMaterial;
  baseMat: THREE.MeshStandardMaterial;
  promoTrimMesh: THREE.Mesh;
  promoTrimMat: THREE.MeshStandardMaterial;
  statusOverlay: StandeeStatusOverlay;
  equippedWeapon?: EquippedWeaponPropRig;
  height: number;
  currentSpriteKey: string;
  setSpriteKey: (spriteKey: string) => void;
  currentFlipYaw: number;
  targetFlipYaw: number;
  dispose: () => void;
}

/**
 * Builds a genuine Paper Mario 3D thick cardstock standee:
 * - Front watercolor sprite plane + 3 inner kraft-cardstock thickness slices + mirrored back plane
 * - Visually equipped 3D Paper Mario die-cut weapon prop mounted right onto player heroes!
 * - Dynamic variant sprite swapper (_hit / _lowhp / _enraged) with zero texture leaks
 * - Universal 3D paper-craft status effect overlays (Burn, Rooted, Acid, Feared, Shield, Boosted, Overwatch, Frost, Low-HP, Boss Phase 2 Aura)
 * - Slotted wooden/cardboard pedestal base with Promotion Tier trim (Ripe Bronze / Heirloom Gold) & animated selection ring
 */
export function createPaperStandeeRig(
  visualKind: string,
  team: 'player' | 'enemy',
  isBoss: boolean,
  textures: CraftTextureLibrary
): PaperStandeeRig {
  const root = new THREE.Group();
  const flipGroup = new THREE.Group();
  const tiltGroup = new THREE.Group();
  root.add(tiltGroup);
  tiltGroup.add(flipGroup);

  const height = UNIT_WORLD_HEIGHTS[visualKind] ?? 1.12;
  const { front, back, aspect } = textures.getSpriteTexturePair(visualKind);

  // Thin team-color painted collar rim underneath the natural pale birch coin!
  const baseRadius = isBoss ? 0.56 : 0.41;
  const baseHeight = 0.09;
  const baseGeo = new THREE.CylinderGeometry(baseRadius * 1.0, baseRadius * 1.04, 0.036, 28);
  const baseColor = isBoss ? '#e5ae32' : team === 'player' ? '#58ad58' : '#d65240';
  const baseMat = new THREE.MeshStandardMaterial({
    map: textures.woodTokenMap,
    color: new THREE.Color(baseColor),
    roughness: 0.74,
    metalness: 0.04,
  });
  const baseMesh = new THREE.Mesh(baseGeo, baseMat);
  baseMesh.position.y = 0.018;
  baseMesh.castShadow = true;
  baseMesh.receiveShadow = true;
  root.add(baseMesh);

  // Natural pale Scandinavian lathe-turned birch wood coin base (matching our 1+5 clay figurines!)
  const innerDiscGeo = new THREE.CylinderGeometry(baseRadius * 0.94, baseRadius * 0.97, 0.062, 28);
  const innerDiscMat = new THREE.MeshStandardMaterial({
    map: textures.woodTokenMap,
    color: '#f5e4c6',
    roughness: 0.76,
    metalness: 0.02,
    bumpMap: textures.paperBump,
    bumpScale: 0.008,
  });
  const innerDisc = new THREE.Mesh(innerDiscGeo, innerDiscMat);
  innerDisc.position.y = 0.062;
  innerDisc.castShadow = true;
  innerDisc.receiveShadow = true;
  root.add(innerDisc);

  // Promotion Tier Pedestal Collar Ring (hidden for seedling; Bronze for ripe; shimmering Gold for heirloom!)
  const promoTrimGeo = new THREE.TorusGeometry(baseRadius * 0.97, 0.028, 8, 28);
  promoTrimGeo.rotateX(Math.PI / 2);
  const promoTrimMat = new THREE.MeshStandardMaterial({
    color: '#e5b242',
    emissive: '#8f5d00',
    emissiveIntensity: 0.2,
    roughness: 0.35,
    metalness: 0.62,
  });
  const promoTrimMesh = new THREE.Mesh(promoTrimGeo, promoTrimMat);
  promoTrimMesh.position.y = baseHeight * 0.56;
  promoTrimMesh.visible = false;
  root.add(promoTrimMesh);

  // Glowing tactical selection / dash / attack floor ring around base
  const ringGeo = new THREE.RingGeometry(baseRadius * 1.08, baseRadius * 1.3, 32);
  ringGeo.rotateX(-Math.PI / 2);
  const ringMat = new THREE.MeshBasicMaterial({
    color: '#ffe066',
    transparent: true,
    opacity: 0,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const ringMesh = new THREE.Mesh(ringGeo, ringMat);
  ringMesh.position.y = 0.022;
  root.add(ringMesh);

  // Sculpted Matte Clay & Wood Toy Figurine Card-Stack (with soft matte finish & subtle warm edge core)
  const planeGeo = new THREE.PlaneGeometry(1, 1);

  const frontMat = new THREE.MeshStandardMaterial({
    map: front,
    alphaTest: 0.42,
    roughness: 0.72,
    metalness: 0.02,
    side: THREE.FrontSide,
    bumpMap: textures.paperBump,
    bumpScale: 0.004,
  });

  const backMat = new THREE.MeshStandardMaterial({
    map: back,
    color: new THREE.Color('#fffcf5'),
    alphaTest: 0.42,
    roughness: 0.74,
    metalness: 0.02,
    side: THREE.FrontSide,
    bumpMap: textures.paperBump,
    bumpScale: 0.004,
  });

  const coreMat = new THREE.MeshStandardMaterial({
    map: front,
    color: new THREE.Color('#dfd0bc'),
    emissive: new THREE.Color('#3a2c1e'),
    emissiveIntensity: 0.1,
    alphaTest: 0.42,
    roughness: 0.9,
    side: THREE.DoubleSide,
  });

  const depthMat = new THREE.MeshDepthMaterial({
    depthPacking: THREE.RGBADepthPacking,
    map: front,
    alphaTest: 0.42,
    side: THREE.DoubleSide,
  });

  const cardStack = new THREE.Group();
  cardStack.position.y = baseHeight + height * 0.485;

  const frontMesh = new THREE.Mesh(planeGeo, frontMat);
  frontMesh.position.z = 0.02;
  frontMesh.castShadow = true;
  frontMesh.receiveShadow = true;
  frontMesh.customDepthMaterial = depthMat;
  cardStack.add(frontMesh);

  // Inner subtle sculpted silhouette thickness slices for tactile camera orbit & paper-flip depth
  for (const zOff of [0.01, 0, -0.01]) {
    const slice = new THREE.Mesh(planeGeo, coreMat);
    slice.position.z = zOff;
    cardStack.add(slice);
  }

  const backMesh = new THREE.Mesh(planeGeo, backMat);
  backMesh.position.z = -0.02;
  backMesh.rotation.y = Math.PI;
  backMesh.castShadow = false;
  backMesh.receiveShadow = true;
  cardStack.add(backMesh);

  const applyAspect = (asp: number) => {
    const clamped = Math.max(0.55, Math.min(1.5, asp));
    cardStack.scale.set(height * clamped, height, 1);
  };
  applyAspect(aspect);
  textures.getSpriteTexturePair(visualKind, applyAspect);

  flipGroup.add(cardStack);

  // Visually Equipped 3D Papercraft & Corrugated-Cardboard Weapon Prop mounted beside every playable hero!
  let equippedWeapon: EquippedWeaponPropRig | undefined;
  if (team === 'player' && visualKind !== 'seed_cart') {
    equippedWeapon = createEquippedWeaponRig('blaster', 1);
    equippedWeapon.root.position.set(baseRadius * 0.96, baseHeight + height * 0.44, 0.085);
    flipGroup.add(equippedWeapon.root);
  }

  // ===== Universal 3D Paper-Craft Status & State Overlays =====
  const statusRoot = new THREE.Group();
  tiltGroup.add(statusRoot);
  const ownedGeos: THREE.BufferGeometry[] = [];
  const ownedMats: THREE.Material[] = [];
  const trackGeo = <T extends THREE.BufferGeometry>(g: T): T => {
    ownedGeos.push(g);
    return g;
  };
  const trackMat = <T extends THREE.Material>(m: T): T => {
    ownedMats.push(m);
    return m;
  };

  // 1. BURN: 3 flickering cut-paper orange/gold flame cones around feet
  const burn = new THREE.Group();
  burn.visible = false;
  const flameOuterMat = trackMat(
    new THREE.MeshBasicMaterial({ color: '#ff5d1a', side: THREE.DoubleSide })
  );
  const flameInnerMat = trackMat(
    new THREE.MeshBasicMaterial({ color: '#ffe14d', side: THREE.DoubleSide })
  );
  const flameGeo = trackGeo(new THREE.ConeGeometry(0.11, 0.34, 4));
  const flameInnerGeo = trackGeo(new THREE.ConeGeometry(0.06, 0.21, 4));
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.4;
    const fg = new THREE.Group();
    fg.position.set(Math.cos(a) * (baseRadius * 0.82), baseHeight + 0.16, Math.sin(a) * (baseRadius * 0.55) + 0.08);
    const outer = new THREE.Mesh(flameGeo, flameOuterMat);
    const inner = new THREE.Mesh(flameInnerGeo, flameInnerMat);
    inner.position.set(0, -0.04, 0.03);
    fg.add(outer, inner);
    burn.add(fg);
  }
  statusRoot.add(burn);

  // 2. ROOTED: Coiled dark-green cardstock vines + tiny leaves hugging ankles
  const rooted = new THREE.Group();
  rooted.visible = false;
  const vineMat = trackMat(new THREE.MeshStandardMaterial({ color: '#397d28', roughness: 0.85 }));
  const vineLeafMat = trackMat(
    new THREE.MeshStandardMaterial({ color: '#78cf48', roughness: 0.8, side: THREE.DoubleSide })
  );
  const vineRingGeo = trackGeo(new THREE.TorusGeometry(baseRadius * 0.92, 0.04, 6, 18));
  const leafGeo = trackGeo(new THREE.CircleGeometry(0.075, 5));
  for (let i = 0; i < 2; i++) {
    const coil = new THREE.Mesh(vineRingGeo, vineMat);
    coil.rotation.x = Math.PI / 2 + (i === 0 ? 0.18 : -0.16);
    coil.position.y = baseHeight + 0.14 + i * 0.16;
    rooted.add(coil);
  }
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    const lf = new THREE.Mesh(leafGeo, vineLeafMat);
    lf.position.set(Math.cos(a) * (baseRadius * 0.96), baseHeight + 0.22 + (i % 2) * 0.12, Math.sin(a) * (baseRadius * 0.72) + 0.08);
    lf.rotation.set(0.3, a, 0.4);
    rooted.add(lf);
  }
  statusRoot.add(rooted);

  // 3. ACID: 3 rising neon-lime bubbles
  const acid = new THREE.Group();
  acid.visible = false;
  const acidMat = trackMat(
    new THREE.MeshBasicMaterial({ color: '#c4f224', transparent: true, opacity: 0.88 })
  );
  const bubbleGeo = trackGeo(new THREE.SphereGeometry(0.085, 8, 6));
  for (let i = 0; i < 3; i++) {
    const b = new THREE.Mesh(bubbleGeo, acidMat);
    b.position.set((i - 1) * 0.24, baseHeight + 0.35 + i * 0.18, 0.14);
    acid.add(b);
  }
  statusRoot.add(acid);

  // 4. FEARED: Floating purple-rimmed comic "!" exclamation badge
  const feared = new THREE.Group();
  feared.visible = false;
  const fearBgMat = trackMat(new THREE.MeshBasicMaterial({ color: '#9c4ed9' }));
  const fearInkMat = trackMat(new THREE.MeshBasicMaterial({ color: '#fff9e6' }));
  const fearBar = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.075, 0.24, 0.04)), fearInkMat);
  fearBar.position.set(0, height + 0.36, 0.06);
  const fearDot = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.075, 0.075, 0.04)), fearInkMat);
  fearDot.position.set(0, height + 0.18, 0.06);
  const fearBack = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.18, 0.18, 0.025, 12)), fearBgMat);
  fearBack.rotation.x = Math.PI / 2;
  fearBack.position.set(0, height + 0.28, 0.03);
  feared.add(fearBack, fearBar, fearDot);
  statusRoot.add(feared);

  // 5. SHIELD: Translucent sky-blue origami buckler floating beside unit
  const shield = new THREE.Group();
  shield.visible = false;
  const shieldMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: '#4fc3f7',
      emissive: '#1e88e5',
      emissiveIntensity: 0.35,
      transparent: true,
      opacity: 0.62,
      roughness: 0.25,
      side: THREE.DoubleSide,
    })
  );
  const shieldMesh = new THREE.Mesh(trackGeo(new THREE.OctahedronGeometry(0.24, 0)), shieldMat);
  shieldMesh.scale.set(0.9, 1.15, 0.38);
  shieldMesh.position.set(baseRadius * 0.92, baseHeight + height * 0.45, 0.24);
  shield.add(shieldMesh);
  statusRoot.add(shield);

  // 6. BOOSTED: Spinning 3-star golden Paper Mario crown above head
  const boosted = new THREE.Group();
  boosted.visible = false;
  boosted.position.y = baseHeight + height * 0.98;
  const starMat = trackMat(
    new THREE.MeshBasicMaterial({ color: '#ffd845' })
  );
  const starGeo = trackGeo(new THREE.OctahedronGeometry(0.085, 0));
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const st = new THREE.Mesh(starGeo, starMat);
    st.position.set(Math.cos(a) * 0.34, 0, Math.sin(a) * 0.22);
    boosted.add(st);
  }
  statusRoot.add(boosted);

  // 7. OVERWATCH: Crisp golden spinning reticle beside the standee!
  const overwatch = new THREE.Group();
  overwatch.visible = false;
  overwatch.position.set(-baseRadius * 0.95, baseHeight + height * 0.64, 0.22);
  const owMat = trackMat(new THREE.MeshBasicMaterial({ color: '#ffcb33', side: THREE.DoubleSide }));
  const owRing = new THREE.Mesh(trackGeo(new THREE.RingGeometry(0.14, 0.19, 18)), owMat);
  const owH = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.42, 0.035, 0.02)), owMat);
  const owV = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.035, 0.42, 0.02)), owMat);
  overwatch.add(owRing, owH, owV);
  statusRoot.add(overwatch);

  // 7B. FROST: Chilly translucent cyan crystalline icicle shards ringing feet!
  const frost = new THREE.Group();
  frost.visible = false;
  const frostMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: '#a3ebff',
      emissive: '#3fa9d9',
      emissiveIntensity: 0.42,
      transparent: true,
      opacity: 0.78,
      roughness: 0.18,
    })
  );
  const iceShardGeo = trackGeo(new THREE.ConeGeometry(0.085, 0.38, 5));
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.3;
    const shard = new THREE.Mesh(iceShardGeo, frostMat);
    shard.position.set(
      Math.cos(a) * (baseRadius * 0.88),
      baseHeight + 0.18,
      Math.sin(a) * (baseRadius * 0.62) + 0.08
    );
    shard.rotation.z = (i % 2 === 0 ? 1 : -1) * 0.22;
    frost.add(shard);
  }
  statusRoot.add(frost);

  // 8. LOW-HP: 2 animated comic cyan sweat droplets + toggleable 3D paper Band-Aid!
  const lowHp = new THREE.Group();
  lowHp.visible = false;
  const sweatMat = trackMat(new THREE.MeshBasicMaterial({ color: '#64d8ff' }));
  const sweatGeo = trackGeo(new THREE.ConeGeometry(0.048, 0.14, 6));
  for (let i = 0; i < 2; i++) {
    const drop = new THREE.Mesh(sweatGeo, sweatMat);
    drop.position.set(i === 0 ? baseRadius * 0.72 : -baseRadius * 0.68, baseHeight + height * 0.78 + i * 0.08, 0.14);
    drop.rotation.z = i === 0 ? -0.35 : 0.35;
    lowHp.add(drop);
  }
  const bandAid = new THREE.Group();
  bandAid.position.set(baseRadius * 0.36, baseHeight + height * 0.7, 0.08);
  bandAid.rotation.z = -0.35;
  const baMat = trackMat(new THREE.MeshBasicMaterial({ color: '#f3d0a0' }));
  const baPadMat = trackMat(new THREE.MeshBasicMaterial({ color: '#fff8ea' }));
  const baStrip1 = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.24, 0.08, 0.02)), baMat);
  const baStrip2 = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.08, 0.24, 0.02)), baMat);
  const baCenter = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.09, 0.09, 0.024)), baPadMat);
  bandAid.add(baStrip1, baStrip2, baCenter);
  lowHp.add(bandAid);
  statusRoot.add(lowHp);

  // 9. BOSS PHASE-2 ENRAGED AURA: Jagged crimson-gold flames pulsing around boss pedestal!
  const enragedAura = new THREE.Group();
  enragedAura.visible = false;
  const enrRingMat = trackMat(
    new THREE.MeshBasicMaterial({
      color: '#ff3b1f',
      transparent: true,
      opacity: 0.78,
      side: THREE.DoubleSide,
      depthWrite: false,
    })
  );
  const enrRing = new THREE.Mesh(
    trackGeo(new THREE.RingGeometry(baseRadius * 1.15, baseRadius * 1.52, 16)),
    enrRingMat
  );
  enrRing.rotation.x = -Math.PI / 2;
  enrRing.position.y = 0.04;
  enragedAura.add(enrRing);
  const enrSpikeMat = trackMat(new THREE.MeshBasicMaterial({ color: '#ff7024' }));
  const enrSpikeGeo = trackGeo(new THREE.ConeGeometry(0.09, 0.42, 4));
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const sp = new THREE.Mesh(enrSpikeGeo, enrSpikeMat);
    sp.position.set(Math.cos(a) * (baseRadius * 1.25), 0.24, Math.sin(a) * (baseRadius * 1.25));
    enragedAura.add(sp);
  }
  root.add(enragedAura);

  let currentSpriteKey = visualKind;
  const setSpriteKey = (spriteKey: string) => {
    if (spriteKey === currentSpriteKey) return;
    currentSpriteKey = spriteKey;
    const pair = textures.getSpriteTexturePair(spriteKey, applyAspect);
    frontMat.map = pair.front;
    backMat.map = pair.back;
    coreMat.map = pair.front;
    depthMat.map = pair.front;
    frontMat.needsUpdate = true;
    backMat.needsUpdate = true;
    coreMat.needsUpdate = true;
    depthMat.needsUpdate = true;
    applyAspect(pair.aspect);
  };

  const dispose = () => {
    equippedWeapon?.dispose();
    baseGeo.dispose();
    baseMat.dispose();
    promoTrimGeo.dispose();
    promoTrimMat.dispose();
    innerDiscGeo.dispose();
    innerDiscMat.dispose();
    ringGeo.dispose();
    ringMat.dispose();
    planeGeo.dispose();
    frontMat.dispose();
    backMat.dispose();
    coreMat.dispose();
    depthMat.dispose();
    for (const g of ownedGeos) g.dispose();
    for (const m of ownedMats) m.dispose();
  };

  return {
    root,
    flipGroup,
    tiltGroup,
    frontMat,
    backMat,
    coreMat,
    ringMesh,
    ringMat,
    baseMat,
    promoTrimMesh,
    promoTrimMat,
    statusOverlay: {
      burn,
      rooted,
      acid,
      feared,
      shield,
      boosted,
      overwatch,
      frost,
      lowHp,
      bandAid,
      enragedAura,
    },
    equippedWeapon,
    height,
    get currentSpriteKey() {
      return currentSpriteKey;
    },
    setSpriteKey,
    currentFlipYaw: 0,
    targetFlipYaw: 0,
    dispose,
  };
}

