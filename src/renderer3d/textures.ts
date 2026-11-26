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
  cow: 1.14,
  pig: 1.04,
  rooster: 1.22,
  sheep: 1.14,
  goat: 1.2,
  digger: 1.4,
  digger_heavy: 1.34,
  trimmer: 1.44,
  sprayer: 1.34,
  mower: 1.08,
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
  cow: 'right',
  pig: 'right',
  rooster: 'right',
  sheep: 'right',
  goat: 'right',
  digger: 'left',
  digger_heavy: 'left',
  trimmer: 'left',
  sprayer: 'left',
  mower: 'left',
  scarecrow: 'left',
  harvester: 'left',
  tractor: 'left',
};

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

export class CraftTextureLibrary {
  private disposed = false;
  private textures: THREE.Texture[] = [];
  private spriteTextures = new Map<string, THREE.Texture>();
  private spriteBackTextures = new Map<string, THREE.Texture>();
  private spriteAspects = new Map<string, number>();
  private spriteListeners = new Map<string, Array<(aspect: number) => void>>();
  private terrainTextures = new Map<string, THREE.Texture>();
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
    this.cliffSideMap = this.track(this.buildCliffSideTexture());

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

  public getTerrainTexture(theme: BoardTheme, terrain: TerrainType, checker: boolean): THREE.Texture {
    const key = `${theme}:${terrain}:${checker ? 'a' : 'b'}`;
    const cached = this.terrainTextures.get(key);
    if (cached) return cached;

    const tex = this.track(this.buildTerrainTileTexture(theme, terrain, checker));
    this.terrainTextures.set(key, tex);
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

    let base = isAutumn
      ? checker
        ? '#c7a24a'
        : '#bc953f'
      : isGreenhouse
        ? checker
          ? '#82b858'
          : '#77ac4d'
        : checker
          ? '#93bc4d'
          : '#87b043';

    if (terrain === 'soil') base = checker ? '#c2814a' : '#b77640';
    else if (terrain === 'mud') base = checker ? '#6f5039' : '#654832';
    else if (terrain === 'compost') base = checker ? '#61462e' : '#583f28';
    else if (terrain === 'gate') base = checker ? '#f5cf5e' : '#e8bb42';
    else if (terrain === 'barn_floor') {
      base = isGreenhouse
        ? checker
          ? '#d29161'
          : '#c68555'
        : checker
          ? '#c08b57'
          : '#b5804d';
    } else if (terrain === 'sunbeam') {
      base = checker ? '#f6de72' : '#efcf58';
    } else if (terrain === 'water') {
      base = checker ? '#2d93b8' : '#2687ab';
    } else if (terrain === 'bridge') {
      base = checker ? '#b87d46' : '#ae743f';
    } else if (terrain === 'lava') {
      base = checker ? '#b83214' : '#a4280e';
    } else if (terrain === 'ramp') {
      base = checker ? '#bd8f56' : '#b2834b';
    }

    ctx.fillStyle = base;
    ctx.fillRect(0, 0, s, s);

    const seed =
      theme.charCodeAt(0) * 101 + terrain.charCodeAt(0) * 37 + (checker ? 11 : 23);
    paintPaperGrain(ctx, s, s, seed, 0.09);

    const rng = mulberry(seed + 99);

    if (terrain === 'grass') {
      // Hand-painted grass wisps & tiny daisies / autumn leaves
      ctx.strokeStyle = isAutumn ? 'rgba(128, 86, 22, 0.45)' : 'rgba(67, 107, 29, 0.42)';
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      for (let i = 0; i < 6; i++) {
        const bx = 34 + rng() * (s - 68);
        const by = 34 + rng() * (s - 68);
        ctx.beginPath();
        ctx.moveTo(bx - 5, by + 6);
        ctx.lineTo(bx - 9, by - 6);
        ctx.moveTo(bx, by + 6);
        ctx.lineTo(bx + 1, by - 9);
        ctx.moveTo(bx + 5, by + 6);
        ctx.lineTo(bx + 9, by - 5);
        ctx.stroke();
      }
      if (isAutumn) {
        for (let i = 0; i < 4; i++) {
          ctx.fillStyle = i % 2 === 0 ? '#c8542a' : '#df892e';
          ctx.beginPath();
          ctx.ellipse(36 + rng() * 184, 36 + rng() * 184, 9, 4.5, rng() * Math.PI, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    } else if (terrain === 'soil') {
      // Tilled garden furrows
      for (let y = 26; y < s; y += 44) {
        ctx.fillStyle = 'rgba(72, 38, 15, 0.22)';
        ctx.fillRect(14, y, s - 28, 12);
        ctx.fillStyle = 'rgba(255, 226, 184, 0.16)';
        ctx.fillRect(14, y + 12, s - 28, 5);
      }
      for (let i = 0; i < 16; i++) {
        ctx.fillStyle = 'rgba(74, 42, 18, 0.34)';
        ctx.beginPath();
        ctx.ellipse(24 + rng() * 208, 24 + rng() * 208, 5, 3, rng(), 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (terrain === 'mud') {
      // Glossy mud puddle rings
      const g = ctx.createRadialGradient(s * 0.5, s * 0.5, 16, s * 0.5, s * 0.5, s * 0.44);
      g.addColorStop(0, 'rgba(62, 41, 26, 0.65)');
      g.addColorStop(0.75, 'rgba(92, 65, 44, 0.35)');
      g.addColorStop(1, 'rgba(92, 65, 44, 0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(s * 0.5, s * 0.52, s * 0.41, s * 0.34, 0.12, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = 'rgba(255, 244, 224, 0.35)';
      ctx.lineWidth = 4;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(s * 0.44, s * 0.46, 36, Math.PI * 1.15, Math.PI * 1.65);
      ctx.stroke();
    } else if (terrain === 'compost') {
      // Rich dark soil + healing sprout emblems
      for (let i = 0; i < 24; i++) {
        ctx.fillStyle = i % 3 === 0 ? 'rgba(130, 198, 76, 0.5)' : 'rgba(38, 24, 12, 0.38)';
        ctx.beginPath();
        ctx.arc(24 + rng() * 208, 24 + rng() * 208, 3 + rng() * 5, 0, Math.PI * 2);
        ctx.fill();
      }
      // Little painted green sprout icon in center
      ctx.strokeStyle = '#6cc24a';
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(s / 2, s * 0.64);
      ctx.lineTo(s / 2, s * 0.44);
      ctx.stroke();
      ctx.fillStyle = '#89db5e';
      ctx.beginPath();
      ctx.ellipse(s * 0.43, s * 0.44, 18, 9, -0.45, 0, Math.PI * 2);
      ctx.ellipse(s * 0.57, s * 0.44, 18, 9, 0.45, 0, Math.PI * 2);
      ctx.fill();
    } else if (terrain === 'barn_floor') {
      // Wooden planks / greenhouse tiles
      ctx.strokeStyle = 'rgba(72, 40, 16, 0.38)';
      ctx.lineWidth = 3.5;
      for (let y = 0; y < s; y += 64) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(s, y);
        ctx.stroke();
      }
      if (isGreenhouse) {
        for (let x = 0; x < s; x += 64) {
          ctx.beginPath();
          ctx.moveTo(x, 0);
          ctx.lineTo(x, s);
          ctx.stroke();
        }
      } else {
        // Nail heads
        ctx.fillStyle = 'rgba(64, 38, 18, 0.48)';
        for (let y = 32; y < s; y += 64) {
          ctx.beginPath();
          ctx.arc(22, y, 4, 0, Math.PI * 2);
          ctx.arc(s - 22, y, 4, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    } else if (terrain === 'gate') {
      // Golden victory chevron tile
      ctx.strokeStyle = 'rgba(138, 86, 12, 0.55)';
      ctx.lineWidth = 10;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(s * 0.28, s * 0.62);
      ctx.lineTo(s * 0.5, s * 0.34);
      ctx.lineTo(s * 0.72, s * 0.62);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255, 252, 232, 0.72)';
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(s * 0.28, s * 0.62);
      ctx.lineTo(s * 0.5, s * 0.34);
      ctx.lineTo(s * 0.72, s * 0.62);
      ctx.stroke();
    } else if (terrain === 'sunbeam') {
      const g = ctx.createRadialGradient(s / 2, s / 2, 12, s / 2, s / 2, s * 0.46);
      g.addColorStop(0, 'rgba(255, 252, 210, 0.8)');
      g.addColorStop(0.7, 'rgba(252, 214, 72, 0.26)');
      g.addColorStop(1, 'rgba(252, 214, 72, 0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, s, s);
    } else if (terrain === 'water') {
      // Sparkling Paper Mario azure creek with painted ripples & foam crescents
      const g = ctx.createRadialGradient(s * 0.5, s * 0.5, 8, s * 0.5, s * 0.5, s * 0.65);
      g.addColorStop(0, 'rgba(92, 210, 238, 0.48)');
      g.addColorStop(1, 'rgba(16, 78, 114, 0.45)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, s, s);

      ctx.strokeStyle = 'rgba(224, 250, 255, 0.58)';
      ctx.lineWidth = 4.5;
      ctx.lineCap = 'round';
      for (let row = 0; row < 4; row++) {
        const wy = 42 + row * 56;
        ctx.beginPath();
        ctx.moveTo(22, wy);
        ctx.quadraticCurveTo(s * 0.32, wy - 14, s * 0.52, wy);
        ctx.quadraticCurveTo(s * 0.72, wy + 14, s - 22, wy - 4);
        ctx.stroke();
      }
    } else if (terrain === 'bridge') {
      // Sturdy cross-plank wooden bridge decking with dark ink seams & bolt heads
      for (let i = 0; i < 5; i++) {
        const py = i * (s / 5);
        ctx.fillStyle = i % 2 === 0 ? '#c98e52' : '#b77b40';
        ctx.fillRect(6, py + 3, s - 12, s / 5 - 6);
        ctx.strokeStyle = '#4a2a14';
        ctx.lineWidth = 4;
        ctx.strokeRect(6, py + 3, s - 12, s / 5 - 6);
        // Iron rivets
        ctx.fillStyle = '#3d2412';
        ctx.beginPath();
        ctx.arc(24, py + s / 10, 4.5, 0, Math.PI * 2);
        ctx.arc(s - 24, py + s / 10, 4.5, 0, Math.PI * 2);
        ctx.fill();
      }
      // Side stringer rails
      ctx.fillStyle = '#824d23';
      ctx.fillRect(0, 0, 14, s);
      ctx.fillRect(s - 14, 0, 14, s);
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

  private buildCliffSideTexture(): THREE.CanvasTexture {
    const w = 256;
    const h = 256;
    const { canvas, ctx } = makeCanvas(w, h);

    // Rich layered earth-and-stone Paper Mario terrace cliff face
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#9c6c3f');
    grad.addColorStop(0.45, '#865730');
    grad.addColorStop(1, '#684020');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    // Layered cardboard/strata bands
    ctx.fillStyle = 'rgba(54, 28, 12, 0.22)';
    ctx.fillRect(0, 68, w, 16);
    ctx.fillRect(0, 146, w, 20);
    ctx.fillRect(0, 212, w, 14);

    // Embedded cobblestones
    const rng = mulberry(7741);
    for (let i = 0; i < 14; i++) {
      ctx.fillStyle = i % 2 === 0 ? 'rgba(182, 152, 118, 0.42)' : 'rgba(92, 64, 42, 0.42)';
      ctx.beginPath();
      ctx.ellipse(24 + rng() * 208, 46 + rng() * 185, 14 + rng() * 14, 9 + rng() * 8, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(56, 32, 16, 0.38)';
      ctx.lineWidth = 2.5;
      ctx.stroke();
    }

    // Scalloped grassy turf overhang lip along top edge!
    ctx.fillStyle = '#6f9c37';
    ctx.fillRect(0, 0, w, 24);
    for (let x = 0; x < w; x += 32) {
      ctx.beginPath();
      ctx.arc(x + 16, 24, 16, 0, Math.PI);
      ctx.fill();
    }
    ctx.strokeStyle = '#3f2412';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(0, 26);
    ctx.lineTo(w, 26);
    ctx.stroke();

    paintPaperGrain(ctx, w, h, 8821, 0.08);
    ctx.strokeStyle = 'rgba(66, 36, 16, 0.45)';
    ctx.lineWidth = 6;
    ctx.strokeRect(3, 3, w - 6, h - 6);

    return finalizeTexture(canvas);
  }

  private buildCrateTexture(damaged: boolean): THREE.CanvasTexture {
    const s = 256;
    const { canvas, ctx } = makeCanvas(s, s);
    ctx.fillStyle = '#cf9149';
    ctx.fillRect(0, 0, s, s);

    // Horizontal inner slats
    for (let i = 0; i < 4; i++) {
      const y = 32 + i * 48;
      ctx.fillStyle = i % 2 === 0 ? '#d89b52' : '#c68740';
      ctx.fillRect(28, y, s - 56, 46);
      ctx.fillStyle = '#5d3416';
      ctx.fillRect(28, y + 44, s - 56, 3);
    }

    // Outer mitered wooden frame
    const frame = 30;
    ctx.fillStyle = '#e0a55a';
    ctx.fillRect(0, 0, s, frame);
    ctx.fillRect(0, s - frame, s, frame);
    ctx.fillRect(0, 0, frame, s);
    ctx.fillRect(s - frame, 0, frame, s);

    // Diagonal brace
    ctx.save();
    ctx.strokeStyle = '#d39348';
    ctx.lineWidth = 24;
    ctx.beginPath();
    ctx.moveTo(26, s - 26);
    ctx.lineTo(s - 26, 26);
    ctx.stroke();
    ctx.strokeStyle = '#4a2a14';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(30, s - 42);
    ctx.lineTo(s - 42, 30);
    ctx.moveTo(42, s - 30);
    ctx.lineTo(s - 30, 42);
    ctx.stroke();
    ctx.restore();

    paintPaperGrain(ctx, s, s, damaged ? 999 : 501, 0.1);

    // Inked frame borders & corner nails
    ctx.strokeStyle = '#4a2a14';
    ctx.lineWidth = 7;
    ctx.strokeRect(3.5, 3.5, s - 7, s - 7);
    ctx.lineWidth = 4;
    ctx.strokeRect(frame, frame, s - frame * 2, s - frame * 2);

    ctx.fillStyle = '#4a2a14';
    for (const [nx, ny] of [
      [15, 15],
      [s - 15, 15],
      [15, s - 15],
      [s - 15, s - 15],
    ]) {
      ctx.beginPath();
      ctx.arc(nx, ny, 4.5, 0, Math.PI * 2);
      ctx.fill();
    }

    if (damaged) {
      // Hand-inked splinter cracks!
      ctx.strokeStyle = '#361a0a';
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
    grad.addColorStop(0, '#f5d76e');
    grad.addColorStop(0.55, '#e2b243');
    grad.addColorStop(1, '#c48d2b');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, s, s);

    const rng = mulberry(3141);
    ctx.lineCap = 'round';
    for (let i = 0; i < 240; i++) {
      const x = rng() * s;
      const y = rng() * s;
      const len = 14 + rng() * 26;
      const tilt = (rng() - 0.5) * 0.6;
      ctx.strokeStyle =
        i % 3 === 0 ? '#7d4d16' : i % 3 === 1 ? '#fff0a8' : '#b77e20';
      ctx.lineWidth = i % 3 === 0 ? 2.6 : 3.2;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.sin(tilt) * len, y + Math.cos(tilt) * len);
      ctx.stroke();
    }
    paintPaperGrain(ctx, s, s, 3142, 0.08);
    return finalizeTexture(canvas, { repeat: [2, 1] });
  }

  private buildStoneTexture(): THREE.CanvasTexture {
    const s = 256;
    const { canvas, ctx } = makeCanvas(s, s);
    ctx.fillStyle = '#9aa19e';
    ctx.fillRect(0, 0, s, s);
    const rng = mulberry(8821);
    for (let i = 0; i < 60; i++) {
      const x = rng() * s;
      const y = rng() * s;
      const r = 8 + rng() * 28;
      ctx.fillStyle =
        i % 4 === 0
          ? 'rgba(104, 146, 68, 0.25)'
          : i % 2 === 0
            ? 'rgba(235, 240, 232, 0.2)'
            : 'rgba(60, 66, 64, 0.22)';
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    paintPaperGrain(ctx, s, s, 8822, 0.1);
    return finalizeTexture(canvas);
  }

  private buildBeehiveTexture(): THREE.CanvasTexture {
    const s = 256;
    const { canvas, ctx } = makeCanvas(s, s);
    ctx.fillStyle = '#efc050';
    ctx.fillRect(0, 0, s, s);
    for (let y = 0; y < s; y += 36) {
      const g = ctx.createLinearGradient(0, y, 0, y + 36);
      g.addColorStop(0, '#f9dc7a');
      g.addColorStop(0.55, '#e2a936');
      g.addColorStop(1, '#9c6318');
      ctx.fillStyle = g;
      ctx.fillRect(0, y, s, 36);
      ctx.fillStyle = '#4a2a14';
      ctx.fillRect(0, y + 33, s, 3.5);
    }
    paintPaperGrain(ctx, s, s, 6060, 0.07);
    return finalizeTexture(canvas, { repeat: [2, 1] });
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
  }
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
  height: number;
  currentFlipYaw: number;
  targetFlipYaw: number;
  dispose: () => void;
}

/**
 * Builds a genuine Paper Mario 3D thick cardstock standee:
 * - Front watercolor sprite plane + 3 inner kraft-cardstock thickness slices + mirrored back plane
 * - Exact silhouette cast shadows via customDepthMaterial (alphaTest)
 * - Slotted wooden/cardboard pedestal base with team-tinted rim & animated selection ring
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

  // Slotted wooden cardboard standee base disc
  const baseRadius = isBoss ? 0.54 : 0.4;
  const baseHeight = 0.085;
  const baseGeo = new THREE.CylinderGeometry(baseRadius * 0.94, baseRadius, baseHeight, 24);
  const baseColor = isBoss ? '#d99a26' : team === 'player' ? '#63a844' : '#c94c3d';
  const baseMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(baseColor),
    roughness: 0.82,
    metalness: 0.04,
    bumpMap: textures.paperBump,
    bumpScale: 0.015,
  });
  const baseMesh = new THREE.Mesh(baseGeo, baseMat);
  baseMesh.position.y = baseHeight / 2;
  baseMesh.castShadow = true;
  baseMesh.receiveShadow = true;
  root.add(baseMesh);

  // Inner cream craft-paper disc top
  const innerDiscGeo = new THREE.CylinderGeometry(baseRadius * 0.8, baseRadius * 0.8, 0.018, 24);
  const innerDiscMat = new THREE.MeshStandardMaterial({
    color: '#e8cfa6',
    roughness: 0.9,
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

  const dispose = () => {
    baseGeo.dispose();
    baseMat.dispose();
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
    height,
    currentFlipYaw: 0,
    targetFlipYaw: 0,
    dispose,
  };
}
