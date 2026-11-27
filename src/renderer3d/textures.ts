import * as THREE from 'three';
import type { BoardTheme, TerrainType } from '../engine/types';

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
  scarecrow: 1.78,
  harvester: 1.84,
  tractor: 1.56,
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
  pitchfork: 'right',
  blower: 'left',
  sapper: 'left',
  kettlebot: 'left',
  scarecrow: 'left',
  harvester: 'left',
  tractor: 'left',
};

export type SpriteVariantKind = 'base' | 'cover' | 'action' | 'hit' | 'lowhp' | 'enraged';

/**
 * Explicit registry of ALL 56 hand-crafted transparent pose & expression variant PNGs in /sprites/.
 * Prevents any 404 requests for units that rely on procedural 3D paper-craft pose overlays.
 */
export const AVAILABLE_VARIANT_SPRITES = new Set<string>([
  'cow_hit',
  'cow_lowhp',
  'cow_cover',
  'cow_action',
  'lettuce_hit',
  'lettuce_lowhp',
  'lettuce_cover',
  'lettuce_action',
  'pea_hit',
  'pea_lowhp',
  'pea_cover',
  'pea_action',
  'lemon_hit',
  'lemon_lowhp',
  'lemon_cover',
  'lemon_action',
  'potato_lowhp',
  'chili_lowhp',
  'carrot_lowhp',
  'corn_lowhp',
  'blackberry_lowhp',
  'strawberry_lowhp',
  'strawberry_cover',
  'strawberry_action',
  'mushroom_lowhp',
  'mushroom_cover',
  'mushroom_action',
  'pumpkin_lowhp',
  'pumpkin_cover',
  'pumpkin_action',
  'blueberry_lowhp',
  'blueberry_cover',
  'blueberry_action',
  'pig_lowhp',
  'rooster_lowhp',
  'sheep_lowhp',
  'goat_lowhp',
  'duck_lowhp',
  'duck_cover',
  'duck_action',
  'owl_lowhp',
  'owl_cover',
  'owl_action',
  'digger_hit',
  'trimmer_hit',
  'sprayer_hit',
  'mower_hit',
  'beekeeper_hit',
  'barrow_hit',
  'pitchfork_hit',
  'blower_hit',
  'sapper_hit',
  'kettlebot_hit',
  'scarecrow_enraged',
  'tractor_enraged',
  'harvester_enraged',
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
  | 'autumn_gold';

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

    // Cream Paper Mario cut-paper sticker backing silhouette
    ctx.fillStyle = '#fff8e6';
    ctx.beginPath();
    ctx.roundRect(24, 34, 272, 224, 42);
    ctx.fill();
    ctx.strokeStyle = '#5c3818';
    ctx.lineWidth = 5;
    ctx.stroke();

    // Glowing heirloom golden seed mound peeking out the wagon bed
    const glow = ctx.createRadialGradient(160, 108, 12, 160, 108, 92);
    glow.addColorStop(0, '#fff7b0');
    glow.addColorStop(0.55, '#f5c23b');
    glow.addColorStop(1, '#c97e18');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.ellipse(160, 114, 86, 54, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#6b3e12';
    ctx.lineWidth = 4;
    ctx.stroke();

    // Sprouting golden leaf emblem at top of pile
    ctx.fillStyle = '#7bd148';
    ctx.beginPath();
    ctx.ellipse(142, 62, 22, 11, -0.5, 0, Math.PI * 2);
    ctx.ellipse(178, 62, 22, 11, 0.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#2d5c1a';
    ctx.lineWidth = 3;
    ctx.stroke();

    // Sturdy painted wooden wagon body
    ctx.fillStyle = '#c47c38';
    ctx.beginPath();
    ctx.roundRect(52, 116, 216, 78, 12);
    ctx.fill();
    ctx.strokeStyle = '#4a2810';
    ctx.lineWidth = 5;
    ctx.stroke();

    // Horizontal planks & gold trim rail
    ctx.fillStyle = '#f5cb4c';
    ctx.fillRect(54, 118, 212, 14);
    ctx.strokeStyle = '#4a2810';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(54, 152);
    ctx.lineTo(266, 152);
    ctx.moveTo(114, 118);
    ctx.lineTo(114, 192);
    ctx.moveTo(206, 118);
    ctx.lineTo(206, 192);
    ctx.stroke();

    // Twin red-spoked storybook wagon wheels
    for (const wx of [100, 220]) {
      ctx.fillStyle = '#9c3624';
      ctx.beginPath();
      ctx.arc(wx, 206, 36, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#3b1e0c';
      ctx.lineWidth = 5;
      ctx.stroke();

      ctx.fillStyle = '#f2c144';
      ctx.beginPath();
      ctx.arc(wx, 206, 12, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
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

    // Top paper ply
    diff.ctx.fillStyle = '#cfa06b';
    diff.ctx.fillRect(0, 0, w, 16);
    // Bottom paper ply
    diff.ctx.fillStyle = '#b4814d';
    diff.ctx.fillRect(0, h - 18, w, 18);
    // Middle corrugated flute channel
    diff.ctx.fillStyle = '#8f5d30';
    diff.ctx.fillRect(0, 16, w, h - 34);

    bump.ctx.fillStyle = '#909090';
    bump.ctx.fillRect(0, 0, w, h);

    // Corrugated waves
    const flutes = 16;
    const step = w / flutes;
    for (let i = 0; i < flutes; i++) {
      const x = i * step;
      const g = diff.ctx.createLinearGradient(x, 0, x + step, 0);
      g.addColorStop(0, '#5a3618');
      g.addColorStop(0.28, '#ba8852');
      g.addColorStop(0.55, '#d4a672');
      g.addColorStop(0.82, '#69401f');
      g.addColorStop(1, '#5a3618');
      diff.ctx.fillStyle = g;
      diff.ctx.fillRect(x, 16, step + 0.5, h - 34);

      const bg = bump.ctx.createLinearGradient(x, 0, x + step, 0);
      bg.addColorStop(0, '#2a2a2a');
      bg.addColorStop(0.5, '#eaeaea');
      bg.addColorStop(1, '#2a2a2a');
      bump.ctx.fillStyle = bg;
      bump.ctx.fillRect(x, 16, step + 0.5, h - 34);
    }

    // Crisp ink ply dividers
    diff.ctx.fillStyle = '#4a2c17';
    diff.ctx.fillRect(0, 14, w, 3);
    diff.ctx.fillRect(0, h - 19, w, 3);

    paintPaperGrain(diff.ctx, w, h, 4242, 0.06);

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

    // Refined subtle storybook watercolor palette harmonizing with Ghibli-style seasonal boards
    let base = isAutumn
      ? checker
        ? '#cfad62'
        : '#c4a156'
      : isGreenhouse
        ? checker
          ? '#8eb868'
          : '#83ad5e'
        : checker
          ? '#9ec26a'
          : '#92b65f';

    if (terrain === 'soil') base = checker ? '#c48c58' : '#b8804d';
    else if (terrain === 'mud') base = checker ? '#75563f' : '#6b4d37';
    else if (terrain === 'compost') base = checker ? '#614831' : '#573f29';
    else if (terrain === 'gate') base = checker ? '#f0cf6c' : '#e3be54';
    else if (terrain === 'barn_floor') {
      base = isGreenhouse
        ? checker
          ? '#cfa074'
          : '#c49468'
        : checker
          ? '#c49866'
          : '#b88c5b';
    } else if (terrain === 'sunbeam') {
      base = checker ? '#f5e28c' : '#ebd473';
    } else if (terrain === 'water') {
      base = checker ? '#5caeb8' : '#51a2ad';
    } else if (terrain === 'bridge') {
      base = checker ? '#bf8d5a' : '#b2804e';
    } else if (terrain === 'lava') {
      base = checker ? '#c43e1c' : '#ae3315';
    } else if (terrain === 'ramp') {
      base = checker ? '#c29763' : '#b58a57';
    } else if (terrain === 'burrow') {
      base = checker ? '#8f6b47' : '#835f3d';
    }

    ctx.fillStyle = base;
    ctx.fillRect(0, 0, s, s);

    const seed =
      theme.charCodeAt(0) * 101 + terrain.charCodeAt(0) * 37 + (checker ? 11 : 23);
    paintPaperGrain(ctx, s, s, seed, terrain === 'grass' ? 0.055 : 0.11);

    const rng = mulberry(seed + 99);

    if (terrain === 'grass') {
      // Calm, low-contrast watercolor washes so characters and tactical highlights pop effortlessly
      for (let i = 0; i < 3; i++) {
        const px = 36 + rng() * (s - 72);
        const py = 36 + rng() * (s - 72);
        const pr = 56 + rng() * 54;
        const g = ctx.createRadialGradient(px, py, 4, px, py, pr);
        g.addColorStop(
          0,
          isAutumn
            ? i % 2 === 0
              ? 'rgba(244, 224, 168, 0.11)'
              : 'rgba(156, 102, 46, 0.06)'
            : i % 2 === 0
              ? 'rgba(228, 240, 180, 0.11)'
              : 'rgba(78, 114, 58, 0.06)'
        );
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(px, py, pr, 0, Math.PI * 2);
        ctx.fill();
      }

      // Whisper-soft grass wisps (subtle paper craft texture, zero busy clutter)
      ctx.lineCap = 'round';
      ctx.strokeStyle = isAutumn ? 'rgba(120, 82, 36, 0.2)' : 'rgba(66, 98, 46, 0.19)';
      ctx.lineWidth = 1.8;
      for (let i = 0; i < 3; i++) {
        const bx = 42 + rng() * (s - 84);
        const by = 42 + rng() * (s - 84);
        ctx.beginPath();
        ctx.moveTo(bx - 4, by + 4);
        ctx.quadraticCurveTo(bx - 6, by, bx - 7, by - 5);
        ctx.moveTo(bx + 1, by + 4);
        ctx.quadraticCurveTo(bx + 2, by - 1, bx + 3, by - 6);
        ctx.stroke();
      }

      // Quiet seasonal hint on alternate tiles only (no dark outlines or busy flower dots)
      if (isAutumn && checker) {
        const lx = 64 + rng() * 128;
        const ly = 64 + rng() * 128;
        ctx.save();
        ctx.translate(lx, ly);
        ctx.rotate(rng() * Math.PI);
        ctx.fillStyle = 'rgba(196, 102, 54, 0.26)';
        ctx.beginPath();
        ctx.ellipse(0, 0, 7, 3.2, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    } else if (terrain === 'soil') {
      // Soft tilled garden furrows with warm watercolor wash & pebbles
      for (let y = 24; y < s; y += 44) {
        ctx.fillStyle = 'rgba(78, 44, 18, 0.22)';
        ctx.beginPath();
        ctx.roundRect(14, y, s - 28, 13, 6);
        ctx.fill();
        ctx.fillStyle = 'rgba(250, 228, 194, 0.2)';
        ctx.beginPath();
        ctx.roundRect(16, y + 13, s - 32, 6, 3);
        ctx.fill();
      }
      for (let i = 0; i < 16; i++) {
        const px = 22 + rng() * 212;
        const py = 22 + rng() * 212;
        ctx.fillStyle = i % 4 === 0 ? '#dfd0b4' : 'rgba(78, 46, 22, 0.36)';
        ctx.beginPath();
        ctx.ellipse(px, py, 5.2, 3.2, rng(), 0, Math.PI * 2);
        ctx.fill();
      }
      if (checker) {
        ctx.strokeStyle = 'rgba(66, 102, 42, 0.72)';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(s * 0.72, s * 0.34);
        ctx.lineTo(s * 0.72, s * 0.26);
        ctx.stroke();
        ctx.fillStyle = '#99c96b';
        ctx.beginPath();
        ctx.ellipse(s * 0.68, s * 0.25, 7.5, 4.2, -0.5, 0, Math.PI * 2);
        ctx.ellipse(s * 0.76, s * 0.25, 7.5, 4.2, 0.5, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (terrain === 'mud') {
      // Glossy mud puddle rings + wet pebbles
      const g = ctx.createRadialGradient(s * 0.5, s * 0.5, 16, s * 0.5, s * 0.5, s * 0.45);
      g.addColorStop(0, 'rgba(54, 34, 20, 0.72)');
      g.addColorStop(0.75, 'rgba(88, 60, 38, 0.4)');
      g.addColorStop(1, 'rgba(88, 60, 38, 0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(s * 0.5, s * 0.52, s * 0.42, s * 0.35, 0.12, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = 'rgba(255, 246, 224, 0.42)';
      ctx.lineWidth = 4.5;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(s * 0.44, s * 0.46, 38, Math.PI * 1.12, Math.PI * 1.68);
      ctx.stroke();
      ctx.lineWidth = 2.8;
      ctx.beginPath();
      ctx.arc(s * 0.58, s * 0.58, 22, Math.PI * 0.1, Math.PI * 0.55);
      ctx.stroke();
    } else if (terrain === 'compost') {
      // Rich dark soil + soft painted healing sprout emblem
      for (let i = 0; i < 24; i++) {
        ctx.fillStyle = i % 3 === 0 ? 'rgba(146, 198, 96, 0.48)' : 'rgba(38, 22, 10, 0.42)';
        ctx.beginPath();
        ctx.arc(24 + rng() * 208, 24 + rng() * 208, 3 + rng() * 5, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.strokeStyle = '#3f6e28';
      ctx.lineWidth = 5.5;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(s / 2, s * 0.66);
      ctx.lineTo(s / 2, s * 0.44);
      ctx.stroke();
      ctx.fillStyle = '#97cf6e';
      ctx.strokeStyle = '#3f6e28';
      ctx.lineWidth = 2.8;
      ctx.beginPath();
      ctx.ellipse(s * 0.42, s * 0.44, 19, 9.5, -0.45, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(s * 0.58, s * 0.44, 19, 9.5, 0.45, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    } else if (terrain === 'barn_floor') {
      // Warm hand-inked greenhouse terracotta pavers OR golden barn planks with grain & knots
      if (isGreenhouse) {
        const cell = 64;
        for (let gy = 0; gy < 4; gy++) {
          for (let gx = 0; gx < 4; gx++) {
            ctx.fillStyle = (gx + gy) % 2 === 0 ? 'rgba(255,238,210,0.12)' : 'rgba(92,50,24,0.08)';
            ctx.fillRect(gx * cell + 3, gy * cell + 3, cell - 6, cell - 6);
          }
        }
        ctx.strokeStyle = 'rgba(78, 44, 22, 0.38)';
        ctx.lineWidth = 3.2;
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
          ctx.fillStyle = (y / 64) % 2 === 0 ? 'rgba(255,242,210,0.1)' : 'rgba(78,44,18,0.07)';
          ctx.fillRect(0, y, s, 64);
          ctx.strokeStyle = 'rgba(78, 44, 18, 0.15)';
          ctx.lineWidth = 2.2;
          ctx.beginPath();
          ctx.moveTo(0, y + 22);
          ctx.bezierCurveTo(s * 0.3, y + 14, s * 0.7, y + 32, s, y + 20);
          ctx.moveTo(0, y + 46);
          ctx.bezierCurveTo(s * 0.4, y + 52, s * 0.7, y + 38, s, y + 48);
          ctx.stroke();
          ctx.strokeStyle = 'rgba(70, 40, 18, 0.4)';
          ctx.lineWidth = 3.2;
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(s, y);
          ctx.stroke();
          ctx.fillStyle = '#4a2b14';
          ctx.beginPath();
          ctx.arc(22, y + 32, 3.8, 0, Math.PI * 2);
          ctx.arc(s - 22, y + 32, 3.8, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    } else if (terrain === 'gate') {
      // Golden victory chevron tile
      ctx.strokeStyle = 'rgba(128, 78, 18, 0.56)';
      ctx.lineWidth = 11;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(s * 0.28, s * 0.62);
      ctx.lineTo(s * 0.5, s * 0.34);
      ctx.lineTo(s * 0.72, s * 0.62);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255, 252, 232, 0.85)';
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(s * 0.28, s * 0.62);
      ctx.lineTo(s * 0.5, s * 0.34);
      ctx.lineTo(s * 0.72, s * 0.62);
      ctx.stroke();
    } else if (terrain === 'sunbeam') {
      const g = ctx.createRadialGradient(s / 2, s / 2, 12, s / 2, s / 2, s * 0.46);
      g.addColorStop(0, 'rgba(255, 254, 224, 0.85)');
      g.addColorStop(0.7, 'rgba(248, 214, 96, 0.26)');
      g.addColorStop(1, 'rgba(248, 214, 96, 0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, s, s);
    } else if (terrain === 'water') {
      // Tranquil muted cerulean-teal storybook watercolor brook matching the new seasonal boards!
      const g = ctx.createRadialGradient(s * 0.5, s * 0.5, 10, s * 0.5, s * 0.5, s * 0.68);
      g.addColorStop(0, 'rgba(162, 228, 232, 0.52)');
      g.addColorStop(0.65, 'rgba(82, 166, 178, 0.24)');
      g.addColorStop(1, 'rgba(42, 106, 124, 0.38)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, s, s);

      // Gentle delicate watercolor ripple ribbons & soft glints
      ctx.strokeStyle = 'rgba(242, 252, 252, 0.65)';
      ctx.lineWidth = 4;
      ctx.lineCap = 'round';
      for (let row = 0; row < 4; row++) {
        const wy = 40 + row * 56;
        ctx.beginPath();
        ctx.moveTo(22, wy);
        ctx.quadraticCurveTo(s * 0.32, wy - 12, s * 0.52, wy);
        ctx.quadraticCurveTo(s * 0.72, wy + 12, s - 22, wy - 4);
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(255, 255, 250, 0.72)';
      for (let i = 0; i < 3; i++) {
        const sx = 38 + rng() * 180;
        const sy = 38 + rng() * 180;
        ctx.beginPath();
        ctx.moveTo(sx, sy - 6);
        ctx.lineTo(sx + 3.2, sy);
        ctx.lineTo(sx, sy + 6);
        ctx.lineTo(sx - 3.2, sy);
        ctx.closePath();
        ctx.fill();
      }
    } else if (terrain === 'bridge') {
      // Weathered honey-oak cross-plank bridge decking with soft ink seams & iron rivets
      for (let i = 0; i < 5; i++) {
        const py = i * (s / 5);
        ctx.fillStyle = i % 2 === 0 ? '#cc9760' : '#bc8650';
        ctx.fillRect(6, py + 3, s - 12, s / 5 - 6);
        ctx.strokeStyle = 'rgba(92, 52, 22, 0.18)';
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        ctx.moveTo(16, py + s / 10);
        ctx.quadraticCurveTo(s * 0.5, py + s / 10 + (i % 2 === 0 ? 5 : -5), s - 16, py + s / 10);
        ctx.stroke();
        ctx.strokeStyle = '#523018';
        ctx.lineWidth = 3.5;
        ctx.strokeRect(6, py + 3, s - 12, s / 5 - 6);
        ctx.fillStyle = '#472914';
        ctx.beginPath();
        ctx.arc(24, py + s / 10, 4.5, 0, Math.PI * 2);
        ctx.arc(s - 24, py + s / 10, 4.5, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = '#87572c';
      ctx.fillRect(0, 0, 15, s);
      ctx.fillRect(s - 15, 0, 15, s);
      ctx.strokeStyle = '#4a2a14';
      ctx.lineWidth = 3;
      ctx.strokeRect(1.5, 1.5, 13, s - 3);
      ctx.strokeRect(s - 14.5, 1.5, 13, s - 3);
    } else if (terrain === 'lava') {
      // Glowing molten magma rivers threading through dark basalt crusts
      const lg = ctx.createRadialGradient(s * 0.5, s * 0.5, 10, s * 0.5, s * 0.5, s * 0.55);
      lg.addColorStop(0, '#ffe052');
      lg.addColorStop(0.45, '#ff6d1f');
      lg.addColorStop(1, '#7a1608');
      ctx.fillStyle = lg;
      ctx.fillRect(0, 0, s, s);

      // Floating dark volcanic crust islands
      ctx.fillStyle = 'rgba(46, 18, 12, 0.78)';
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
      // Hot yellow magma veins
      ctx.strokeStyle = 'rgba(255, 240, 140, 0.8)';
      ctx.lineWidth = 5;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(20, s * 0.25);
      ctx.quadraticCurveTo(s * 0.5, s * 0.45, s - 20, s * 0.3);
      ctx.moveTo(28, s * 0.75);
      ctx.quadraticCurveTo(s * 0.55, s * 0.6, s - 26, s * 0.78);
      ctx.stroke();
    } else if (terrain === 'ramp') {
      // Sloped timber step-boards with subtle climb treads
      for (let i = 0; i < 6; i++) {
        const py = i * (s / 6);
        ctx.fillStyle = i % 2 === 0 ? '#cfa062' : '#bf8e52';
        ctx.fillRect(10, py + 2, s - 20, s / 6 - 4);
        ctx.fillStyle = 'rgba(64, 34, 14, 0.35)';
        ctx.fillRect(10, py + s / 6 - 5, s - 20, 4);
      }
      // Subtle painted upward climb chevron so ramp direction reads clearly
      ctx.strokeStyle = 'rgba(255, 248, 224, 0.55)';
      ctx.lineWidth = 7;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(s * 0.32, s * 0.62);
      ctx.lineTo(s * 0.5, s * 0.38);
      ctx.lineTo(s * 0.68, s * 0.62);
      ctx.stroke();
    } else if (terrain === 'burrow') {
      // Cozy ringed gopher burrow dirt mound with deep dark tunnel & glowing teal warp ring!
      const g = ctx.createRadialGradient(s * 0.5, s * 0.5, 16, s * 0.5, s * 0.5, s * 0.46);
      g.addColorStop(0, '#1e1208');
      g.addColorStop(0.55, '#3b2412');
      g.addColorStop(0.75, '#a06e3f');
      g.addColorStop(1, 'rgba(138, 98, 60, 0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(s * 0.5, s * 0.5, s * 0.46, 0, Math.PI * 2);
      ctx.fill();

      // Painted glowing teal portal halo so warp pipe pairs stand out immediately!
      ctx.strokeStyle = 'rgba(56, 228, 212, 0.88)';
      ctx.lineWidth = 7;
      ctx.setLineDash([18, 10]);
      ctx.beginPath();
      ctx.arc(s * 0.5, s * 0.5, s * 0.34, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    } else if (terrain === 'bounce_pad') {
      // Storybook mossy meadow ring around a bouncy red-spotted launchpad mushroom!
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
    }

    // Crisp warm hand-inked paper tile bevel border
    ctx.strokeStyle = terrain === 'lava' ? 'rgba(255, 190, 80, 0.45)' : 'rgba(72, 42, 18, 0.34)';
    ctx.lineWidth = 6;
    ctx.strokeRect(3, 3, s - 6, s - 6);
    ctx.strokeStyle = terrain === 'water' ? 'rgba(220, 252, 255, 0.35)' : 'rgba(255, 250, 230, 0.34)';
    ctx.lineWidth = 3;
    ctx.strokeRect(8, 8, s - 16, s - 16);

    return finalizeTexture(canvas);
  }

  private buildCliffSideTexture(theme: BoardTheme = 'spring'): THREE.CanvasTexture {
    const w = 256;
    const h = 256;
    const { canvas, ctx } = makeCanvas(w, h);
    const isAutumn = theme === 'autumn';
    const isGreenhouse = theme === 'greenhouse';

    // Rich layered earth-and-stone Paper Mario terrace cliff face
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, isAutumn ? '#a86f38' : '#a87442');
    grad.addColorStop(0.5, '#8c5a30');
    grad.addColorStop(1, '#683f1d');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    // Warm hand-painted geological strata bands
    ctx.fillStyle = 'rgba(54, 28, 12, 0.22)';
    ctx.fillRect(0, 74, w, 16);
    ctx.fillRect(0, 152, w, 20);
    ctx.fillRect(0, 214, w, 14);

    // Chunky hand-inked embedded river boulders & cobblestones
    const rng = mulberry(isAutumn ? 7743 : isGreenhouse ? 7742 : 7741);
    for (let i = 0; i < 16; i++) {
      const rx = 20 + rng() * 216;
      const ry = 54 + rng() * 176;
      const rw = 14 + rng() * 16;
      const rh = 9 + rng() * 9;
      ctx.fillStyle = i % 3 === 0 ? '#c4b89c' : i % 3 === 1 ? '#998870' : '#7d5b3e';
      ctx.beginPath();
      ctx.ellipse(rx, ry, rw, rh, (rng() - 0.5) * 0.4, 0, Math.PI * 2);
      ctx.fill();
      // Top highlight crescent
      ctx.fillStyle = 'rgba(255, 248, 224, 0.28)';
      ctx.beginPath();
      ctx.ellipse(rx - rw * 0.16, ry - rh * 0.25, rw * 0.55, rh * 0.35, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(78, 48, 24, 0.72)';
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.ellipse(rx, ry, rw, rh, 0, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Dangling painted soil root tendrils tucked under the grassy overhang
    ctx.strokeStyle = 'rgba(94, 56, 26, 0.78)';
    ctx.lineWidth = 2.8;
    ctx.lineCap = 'round';
    for (let i = 0; i < 6; i++) {
      const rx = 22 + i * 42 + rng() * 10;
      ctx.beginPath();
      ctx.moveTo(rx, 32);
      ctx.quadraticCurveTo(rx + (i % 2 === 0 ? 8 : -8), 54, rx + (i % 2 === 0 ? -4 : 6), 72 + rng() * 22);
      ctx.stroke();
    }

    // Harmonized subtle storybook watercolor scalloped turf overhang lip along top edge
    const turfTop = isAutumn ? '#cfa85c' : isGreenhouse ? '#86b064' : '#96bc62';
    const turfBot = isAutumn ? '#ad823a' : isGreenhouse ? '#648f48' : '#729947';
    const turfGrad = ctx.createLinearGradient(0, 0, 0, 44);
    turfGrad.addColorStop(0, turfTop);
    turfGrad.addColorStop(1, turfBot);

    ctx.fillStyle = turfGrad;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(w, 0);
    ctx.lineTo(w, 26);
    for (let x = w; x > 0; x -= 32) {
      ctx.arc(x - 16, 26, 16, 0, Math.PI, false);
    }
    ctx.closePath();
    ctx.fill();

    // Delicate warm-sepia ink scalloped turf edge
    ctx.strokeStyle = 'rgba(72, 42, 20, 0.72)';
    ctx.lineWidth = 3.4;
    ctx.beginPath();
    for (let x = 0; x < w; x += 32) {
      ctx.arc(x + 16, 26, 16, 0, Math.PI, false);
    }
    ctx.stroke();

    paintPaperGrain(ctx, w, h, 8821, 0.09);
    ctx.strokeStyle = 'rgba(72, 42, 20, 0.36)';
    ctx.lineWidth = 5;
    ctx.strokeRect(3, 3, w - 6, h - 6);

    return finalizeTexture(canvas);
  }

  private buildCrateTexture(damaged: boolean): THREE.CanvasTexture {
    const s = 256;
    const { canvas, ctx } = makeCanvas(s, s);
    ctx.fillStyle = '#cf9149';
    ctx.fillRect(0, 0, s, s);

    // Horizontal inner slats with warm wood grain streaks
    for (let i = 0; i < 4; i++) {
      const y = 32 + i * 48;
      ctx.fillStyle = i % 2 === 0 ? '#dea258' : '#cc8d43';
      ctx.fillRect(28, y, s - 56, 46);
      ctx.strokeStyle = 'rgba(92, 50, 18, 0.16)';
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.moveTo(32, y + 18);
      ctx.bezierCurveTo(s * 0.35, y + 12, s * 0.65, y + 26, s - 32, y + 16);
      ctx.stroke();
      ctx.fillStyle = '#5d3416';
      ctx.fillRect(28, y + 44, s - 56, 3.5);
    }

    // Outer mitered wooden frame
    const frame = 30;
    ctx.fillStyle = '#e6ac5f';
    ctx.fillRect(0, 0, s, frame);
    ctx.fillRect(0, s - frame, s, frame);
    ctx.fillRect(0, 0, frame, s);
    ctx.fillRect(s - frame, 0, frame, s);

    // Diagonal brace
    ctx.save();
    ctx.strokeStyle = '#d9984c';
    ctx.lineWidth = 24;
    ctx.beginPath();
    ctx.moveTo(26, s - 26);
    ctx.lineTo(s - 26, 26);
    ctx.stroke();
    ctx.strokeStyle = '#4a2a14';
    ctx.lineWidth = 4.5;
    ctx.beginPath();
    ctx.moveTo(30, s - 42);
    ctx.lineTo(s - 42, 30);
    ctx.moveTo(42, s - 30);
    ctx.lineTo(s - 30, 42);
    ctx.stroke();
    ctx.restore();

    // Cute faded farm-crate leaf stencil stamp in center
    ctx.save();
    ctx.translate(s / 2, s / 2);
    ctx.fillStyle = 'rgba(94, 52, 20, 0.24)';
    ctx.beginPath();
    ctx.arc(0, 0, 26, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(122, 178, 64, 0.55)';
    ctx.beginPath();
    ctx.ellipse(-7, -2, 11, 6, -0.5, 0, Math.PI * 2);
    ctx.ellipse(7, -2, 11, 6, 0.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    paintPaperGrain(ctx, s, s, damaged ? 999 : 501, 0.09);

    // Inked frame borders & iron corner rivets
    ctx.strokeStyle = '#452611';
    ctx.lineWidth = 7.5;
    ctx.strokeRect(3.5, 3.5, s - 7, s - 7);
    ctx.lineWidth = 4;
    ctx.strokeRect(frame, frame, s - frame * 2, s - frame * 2);

    ctx.fillStyle = '#452611';
    for (const [nx, ny] of [
      [15, 15],
      [s - 15, 15],
      [15, s - 15],
      [s - 15, s - 15],
    ]) {
      ctx.beginPath();
      ctx.arc(nx, ny, 5, 0, Math.PI * 2);
      ctx.fill();
    }

    if (damaged) {
      // Hand-inked splinter cracks!
      ctx.strokeStyle = '#321708';
      ctx.lineWidth = 6.5;
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
    const grad = ctx.createLinearGradient(0, 0, s, 0);
    grad.addColorStop(0, '#784724');
    grad.addColorStop(0.45, '#965c32');
    grad.addColorStop(1, '#6e401f');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, s, s);

    // Chunky hand-inked vertical bark ridges
    const rng = mulberry(4512);
    ctx.lineCap = 'round';
    for (let x = 14; x < s; x += 26) {
      ctx.strokeStyle = 'rgba(72, 40, 20, 0.72)';
      ctx.lineWidth = 3.2;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.bezierCurveTo(x + 8, s * 0.35, x - 9, s * 0.68, x + 3, s);
      ctx.stroke();

      ctx.strokeStyle = 'rgba(232, 188, 136, 0.28)';
      ctx.lineWidth = 2.6;
      ctx.beginPath();
      ctx.moveTo(x + 6, 0);
      ctx.bezierCurveTo(x + 14, s * 0.35, x - 3, s * 0.68, x + 9, s);
      ctx.stroke();
    }

    // Storybook wood knot oval
    for (let i = 0; i < 3; i++) {
      const kx = 40 + rng() * 176;
      const ky = 40 + rng() * 176;
      ctx.fillStyle = '#5c341a';
      ctx.strokeStyle = 'rgba(60, 30, 14, 0.72)';
      ctx.lineWidth = 2.8;
      ctx.beginPath();
      ctx.ellipse(kx, ky, 14, 22, 0.08, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    paintPaperGrain(ctx, s, s, 4513, 0.09);
    return finalizeTexture(canvas, { repeat: [2, 1] });
  }

  private buildTreeFoliageTexture(variant: TreeFoliageVariant): THREE.CanvasTexture {
    const s = 256;
    const { canvas, ctx } = makeCanvas(s, s);
    const palettes: Record<
      TreeFoliageVariant,
      { bg: string; dark: string; mid: string; light: string; ink: string; accent: string; accent2: string }
    > = {
      spring_green: {
        bg: '#74a652',
        dark: '#56843d',
        mid: '#84b45c',
        light: '#aecf76',
        ink: 'rgba(58, 86, 36, 0.62)',
        accent: '#d65d54',
        accent2: '#f7ebb8',
      },
      spring_blossom: {
        bg: '#e6a8bc',
        dark: '#c98099',
        mid: '#efb9ca',
        light: '#fae0e8',
        ink: 'rgba(122, 62, 84, 0.56)',
        accent: '#fff9fb',
        accent2: '#f5dc8c',
      },
      summer_citrus: {
        bg: '#659c56',
        dark: '#4a7a42',
        mid: '#79b064',
        light: '#a2cc7c',
        ink: 'rgba(46, 80, 42, 0.62)',
        accent: '#e69b45',
        accent2: '#f5dc78',
      },
      autumn_crimson: {
        bg: '#c76042',
        dark: '#9c402c',
        mid: '#d6784e',
        light: '#e8a264',
        ink: 'rgba(98, 38, 22, 0.6)',
        accent: '#f0c462',
        accent2: '#e6845c',
      },
      autumn_gold: {
        bg: '#d99e44',
        dark: '#b0782c',
        mid: '#e6b458',
        light: '#f5d682',
        ink: 'rgba(104, 62, 22, 0.6)',
        accent: '#c7563a',
        accent2: '#f7ecc0',
      },
    };
    const p = palettes[variant];
    const grad = ctx.createLinearGradient(0, 0, 0, s);
    grad.addColorStop(0, p.light);
    grad.addColorStop(0.5, p.mid);
    grad.addColorStop(1, p.dark);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, s, s);

    const rng = mulberry(variant.charCodeAt(7) * 317 + 41);

    // Layered storybook watercolor leaf puffs with delicate sepia-tinted ink arcs
    for (let row = 0; row < 6; row++) {
      const y = row * 44 + 14;
      for (let col = -1; col < 7; col++) {
        const x = col * 42 + (row % 2 === 0 ? 0 : 21);
        const r = 24 + rng() * 6;
        ctx.fillStyle = row < 2 ? p.light : row < 4 ? p.mid : p.dark;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();

        // Soft sunlit watercolor wash dab on upper crown
        ctx.fillStyle = 'rgba(255, 250, 228, 0.14)';
        ctx.beginPath();
        ctx.arc(x - r * 0.2, y - r * 0.22, r * 0.52, 0, Math.PI * 2);
        ctx.fill();

        // Delicate storybook scallop ink arc
        ctx.strokeStyle = p.ink;
        ctx.lineWidth = 2.4;
        ctx.beginPath();
        ctx.arc(x, y, r, 0.18 * Math.PI, 0.82 * Math.PI);
        ctx.stroke();
      }
    }

    // Subtle seasonal storybook fruit / blossom / leaf accents
    for (let i = 0; i < 11; i++) {
      const ax = 20 + rng() * 216;
      const ay = 20 + rng() * 216;
      if (variant === 'spring_blossom') {
        ctx.fillStyle = p.accent;
        for (let k = 0; k < 5; k++) {
          const a = (k / 5) * Math.PI * 2;
          ctx.beginPath();
          ctx.arc(ax + Math.cos(a) * 5.5, ay + Math.sin(a) * 5.5, 4, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillStyle = p.accent2;
        ctx.beginPath();
        ctx.arc(ax, ay, 3.4, 0, Math.PI * 2);
        ctx.fill();
      } else {
        // Painted apples, oranges, or warm autumn berries/leaves
        ctx.fillStyle = i % 3 === 0 ? p.accent2 : p.accent;
        ctx.strokeStyle = p.ink;
        ctx.lineWidth = 1.9;
        ctx.beginPath();
        ctx.arc(ax, ay, 6.8, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = 'rgba(255,252,240,0.55)';
        ctx.beginPath();
        ctx.arc(ax - 2.1, ay - 2.1, 2, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    paintPaperGrain(ctx, s, s, 9123, 0.1);
    return finalizeTexture(canvas, { repeat: [2, 1] });
  }

  private buildHillBackdropTexture(theme: BoardTheme, layerIdx: number): THREE.CanvasTexture {
    const s = 256;
    const { canvas, ctx } = makeCanvas(s, s);
    const isAutumn = theme === 'autumn';
    const isGreenhouse = theme === 'greenhouse';

    const topCol = isAutumn
      ? ['#deb062', '#cf8948', '#b86842'][layerIdx % 3]
      : isGreenhouse
        ? ['#8db872', '#78a664', '#648f58'][layerIdx % 3]
        : ['#a8c978', '#8eb668', '#78a05c'][layerIdx % 3];
    const botCol = isAutumn
      ? ['#bc843c', '#a35d32', '#87462c'][layerIdx % 3]
      : isGreenhouse
        ? ['#659150', '#547c46', '#44683c'][layerIdx % 3]
        : ['#7ca454', '#678e48', '#567a3e'][layerIdx % 3];

    const grad = ctx.createLinearGradient(0, 0, 0, s);
    grad.addColorStop(0, topCol);
    grad.addColorStop(1, botCol);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, s, s);

    // Sweeping sunlit watercolor contour washes across the hillside
    ctx.fillStyle = 'rgba(255, 250, 214, 0.14)';
    for (let i = 0; i < 4; i++) {
      const y = 32 + i * 58;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.quadraticCurveTo(s * 0.5, y - 24, s, y + 6);
      ctx.lineTo(s, y + 26);
      ctx.quadraticCurveTo(s * 0.5, y - 4, 0, y + 20);
      ctx.closePath();
      ctx.fill();
    }

    const rng = mulberry(theme.charCodeAt(0) * 55 + layerIdx * 97);
    // Soft painted meadow wildflowers / autumn orchard specks
    for (let i = 0; i < 20; i++) {
      const fx = 16 + rng() * 224;
      const fy = 20 + rng() * 216;
      ctx.fillStyle = isAutumn
        ? i % 2 === 0
          ? 'rgba(245, 214, 128, 0.78)'
          : 'rgba(198, 92, 62, 0.72)'
        : isGreenhouse
          ? i % 2 === 0
            ? 'rgba(252, 244, 194, 0.75)'
            : 'rgba(202, 232, 168, 0.72)'
          : i % 3 === 0
            ? 'rgba(255, 252, 240, 0.78)'
            : i % 3 === 1
              ? 'rgba(245, 216, 132, 0.75)'
              : 'rgba(238, 186, 200, 0.75)';
      ctx.beginPath();
      ctx.arc(fx, fy, 3.6 + rng() * 2.2, 0, Math.PI * 2);
      ctx.fill();
    }

    paintPaperGrain(ctx, s, s, 3030 + layerIdx, 0.11);
    return finalizeTexture(canvas, { repeat: [1, 1] });
  }

  private buildBarnWallTexture(): THREE.CanvasTexture {
    const s = 256;
    const { canvas, ctx } = makeCanvas(s, s);
    ctx.fillStyle = '#cf4434';
    ctx.fillRect(0, 0, s, s);

    // Vertical storybook painted red barn planks with chocolate-ink seams
    for (let x = 0; x < s; x += 32) {
      ctx.fillStyle = (x / 32) % 2 === 0 ? '#d94b38' : '#c43d2d';
      ctx.fillRect(x, 0, 32, s);
      ctx.strokeStyle = 'rgba(255, 210, 180, 0.14)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(x + 6, 0);
      ctx.lineTo(x + 6, s);
      ctx.stroke();
      ctx.strokeStyle = '#521d15';
      ctx.lineWidth = 3.5;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, s);
      ctx.stroke();
    }

    // Cream corner trim border
    ctx.fillStyle = '#fff5dc';
    ctx.fillRect(0, 0, 14, s);
    ctx.fillRect(s - 14, 0, 14, s);
    ctx.fillRect(0, 0, s, 12);
    ctx.strokeStyle = '#472213';
    ctx.lineWidth = 4;
    ctx.strokeRect(2, 2, s - 4, s - 4);

    paintPaperGrain(ctx, s, s, 5511, 0.08);
    return finalizeTexture(canvas);
  }

  private buildBarnRoofTexture(): THREE.CanvasTexture {
    const s = 256;
    const { canvas, ctx } = makeCanvas(s, s);
    ctx.fillStyle = '#75462a';
    ctx.fillRect(0, 0, s, s);

    // Scalloped overlapping storybook cedar roof shingles!
    for (let row = 0; row < 8; row++) {
      const y = row * 32;
      for (let col = -1; col < 8; col++) {
        const x = col * 36 + (row % 2 === 0 ? 0 : 18);
        ctx.fillStyle = (row + col) % 2 === 0 ? '#8a5534' : '#734427';
        ctx.beginPath();
        ctx.roundRect(x, y, 36, 34, [0, 0, 14, 14]);
        ctx.fill();
        ctx.strokeStyle = '#3d2010';
        ctx.lineWidth = 3.5;
        ctx.stroke();
      }
    }
    paintPaperGrain(ctx, s, s, 5512, 0.08);
    return finalizeTexture(canvas, { repeat: [2, 2] });
  }

  private buildFenceWoodTexture(): THREE.CanvasTexture {
    const s = 128;
    const { canvas, ctx } = makeCanvas(s, s);
    ctx.fillStyle = '#f5ead2';
    ctx.fillRect(0, 0, s, s);
    ctx.strokeStyle = 'rgba(138, 102, 62, 0.24)';
    ctx.lineWidth = 2.5;
    for (let x = 14; x < s; x += 22) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.bezierCurveTo(x + 4, s * 0.4, x - 4, s * 0.7, x, s);
      ctx.stroke();
    }
    ctx.strokeStyle = '#5c3b1e';
    ctx.lineWidth = 5;
    ctx.strokeRect(2.5, 2.5, s - 5, s - 5);
    paintPaperGrain(ctx, s, s, 5513, 0.08);
    return finalizeTexture(canvas);
  }

  private buildCloudTexture(): THREE.CanvasTexture {
    const s = 128;
    const { canvas, ctx } = makeCanvas(s, s);
    const grad = ctx.createLinearGradient(0, 0, 0, s);
    grad.addColorStop(0, '#fffdf7');
    grad.addColorStop(0.68, '#f7f2e4');
    grad.addColorStop(1, '#cfe4f2');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, s, s);
    paintPaperGrain(ctx, s, s, 5514, 0.07);
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
 * - Dynamic variant sprite swapper (_hit / _lowhp / _enraged) with zero texture leaks
 * - Universal 3D paper-craft status effect overlays (Burn, Rooted, Acid, Feared, Shield, Boosted, Overwatch, Low-HP, Boss Phase 2 Aura)
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

  // Slotted wooden cardboard standee base disc with turned wood grain!
  const baseRadius = isBoss ? 0.54 : 0.4;
  const baseHeight = 0.085;
  const baseGeo = new THREE.CylinderGeometry(baseRadius * 0.94, baseRadius, baseHeight, 24);
  const baseColor = isBoss ? '#e0a22b' : team === 'player' ? '#6cb548' : '#d14f3f';
  const baseMat = new THREE.MeshStandardMaterial({
    map: textures.woodTokenMap,
    color: new THREE.Color(baseColor),
    roughness: 0.78,
    metalness: 0.04,
    bumpMap: textures.paperBump,
    bumpScale: 0.015,
  });
  const baseMesh = new THREE.Mesh(baseGeo, baseMat);
  baseMesh.position.y = baseHeight / 2;
  baseMesh.castShadow = true;
  baseMesh.receiveShadow = true;
  root.add(baseMesh);

  // Promotion Tier Pedestal Collar Ring (hidden for seedling; Bronze for ripe; shimmering Gold for heirloom!)
  const promoTrimGeo = new THREE.TorusGeometry(baseRadius * 0.97, 0.032, 8, 28);
  promoTrimGeo.rotateX(Math.PI / 2);
  const promoTrimMat = new THREE.MeshStandardMaterial({
    color: '#e5b242',
    emissive: '#8f5d00',
    emissiveIntensity: 0.2,
    roughness: 0.35,
    metalness: 0.62,
  });
  const promoTrimMesh = new THREE.Mesh(promoTrimGeo, promoTrimMat);
  promoTrimMesh.position.y = baseHeight * 0.72;
  promoTrimMesh.visible = false;
  root.add(promoTrimMesh);

  // Inner cream craft-wood disc top
  const innerDiscGeo = new THREE.CylinderGeometry(baseRadius * 0.8, baseRadius * 0.8, 0.018, 24);
  const innerDiscMat = new THREE.MeshStandardMaterial({
    map: textures.woodTokenMap,
    color: '#f2dfb8',
    roughness: 0.86,
  });
  const innerDisc = new THREE.Mesh(innerDiscGeo, innerDiscMat);
  innerDisc.position.y = baseHeight + 0.004;
  innerDisc.receiveShadow = true;
  root.add(innerDisc);

  // Wooden card slot groove across the disc
  const slotGeo = new THREE.BoxGeometry(baseRadius * 1.15, 0.025, 0.075);
  const slotMat = new THREE.MeshStandardMaterial({ color: '#5a361a', roughness: 0.95 });
  const slotMesh = new THREE.Mesh(slotGeo, slotMat);
  slotMesh.position.y = baseHeight + 0.01;
  flipGroup.add(slotMesh);

  // Glowing tactical selection / dash / attack floor ring around base
  const ringGeo = new THREE.RingGeometry(baseRadius * 1.06, baseRadius * 1.28, 32);
  ringGeo.rotateX(-Math.PI / 2);
  const ringMat = new THREE.MeshBasicMaterial({
    color: '#ffe066',
    transparent: true,
    opacity: 0,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const ringMesh = new THREE.Mesh(ringGeo, ringMat);
  ringMesh.position.y = 0.025;
  root.add(ringMesh);

  // Thick Paper Mario cutout stack!
  const planeGeo = new THREE.PlaneGeometry(1, 1);

  const frontMat = new THREE.MeshStandardMaterial({
    map: front,
    alphaTest: 0.42,
    roughness: 0.84,
    metalness: 0.02,
    side: THREE.FrontSide,
    bumpMap: textures.paperBump,
    bumpScale: 0.008,
  });

  const backMat = new THREE.MeshStandardMaterial({
    map: back,
    color: new THREE.Color('#fffaf0'),
    alphaTest: 0.42,
    roughness: 0.85,
    metalness: 0.02,
    side: THREE.FrontSide,
    bumpMap: textures.paperBump,
    bumpScale: 0.008,
  });

  const coreMat = new THREE.MeshStandardMaterial({
    map: front,
    color: new THREE.Color('#d8b482'),
    emissive: new THREE.Color('#3b2410'),
    emissiveIntensity: 0.14,
    alphaTest: 0.42,
    roughness: 0.95,
    side: THREE.DoubleSide,
  });

  const depthMat = new THREE.MeshDepthMaterial({
    depthPacking: THREE.RGBADepthPacking,
    map: front,
    alphaTest: 0.42,
    side: THREE.DoubleSide,
  });

  const cardStack = new THREE.Group();
  cardStack.position.y = baseHeight + height * 0.47;

  const frontMesh = new THREE.Mesh(planeGeo, frontMat);
  frontMesh.position.z = 0.022;
  frontMesh.castShadow = true;
  frontMesh.receiveShadow = true;
  frontMesh.customDepthMaterial = depthMat;
  cardStack.add(frontMesh);

  // 3 stacked inner cardboard slices for tangible edge thickness when orbiting or paper-flipping!
  for (const zOff of [0.011, 0, -0.011]) {
    const slice = new THREE.Mesh(planeGeo, coreMat);
    slice.position.z = zOff;
    cardStack.add(slice);
  }

  const backMesh = new THREE.Mesh(planeGeo, backMat);
  backMesh.position.z = -0.022;
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
    baseGeo.dispose();
    baseMat.dispose();
    promoTrimGeo.dispose();
    promoTrimMat.dispose();
    innerDiscGeo.dispose();
    innerDiscMat.dispose();
    slotGeo.dispose();
    slotMat.dispose();
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
      lowHp,
      bandAid,
      enragedAura,
    },
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

