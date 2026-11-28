import * as THREE from 'three';
import type { WeaponForgeBranch, WeaponVisualKind } from '../engine/types';

/**
 * Modular Handcrafted Papercraft & Corrugated-Cardboard Weapon Creation System!
 *
 * Every weapon is assembled from layered scissor-cut construction paper, fluted
 * corrugated cardboard, brass split-pin paper brads, hemp twine wraps, origami
 * fold creases, and Tier II/III metallic craft-foil upgrades.
 *
 * Powers BOTH:
 * 1. The 3D visually equipped weapon prop mounted beside every clay/wood hero figurine
 *    in PaperDioramaRenderer (with live recoil, melee swing, vacuum spin & flip swap!).
 * 2. Matching UI weapon cutout icons (via cached data URLs) in the Battle Action Dock,
 *    Hero Armory, and Branching Weapon Forge!
 */

const weaponTexCache = new Map<string, { front: THREE.CanvasTexture; back: THREE.CanvasTexture }>();
const weaponDataUrlCache = new Map<string, string>();

function makeCacheKey(
  visualKind: WeaponVisualKind,
  forgeTier: number,
  forgeBranch?: WeaponForgeBranch
): string {
  return `${visualKind}|t${forgeTier}|${forgeBranch ?? 'stock'}`;
}

interface CraftPalette {
  metal: string;
  metalHi: string;
  metalEdge: string;
  foil: string;
  foilAccent: string;
  primary: string;
  primaryAlt: string;
  kraft: string;
  kraftDark: string;
  kraftHi: string;
  paperEdge: string;
}

function tierCraftPalette(forgeTier: number, forgeBranch?: WeaponForgeBranch): CraftPalette {
  if (forgeTier >= 3 && forgeBranch === 'elemental') {
    return {
      metal: '#e6842e',
      metalHi: '#ffd980',
      metalEdge: '#8a3c12',
      foil: '#ffe169',
      foilAccent: '#d93829',
      primary: '#cf4832',
      primaryAlt: '#e86f38',
      kraft: '#c8925a',
      kraftDark: '#8c5a2e',
      kraftHi: '#e2b580',
      paperEdge: '#fff6e2',
    };
  }
  if (forgeTier >= 3 && forgeBranch === 'tactical') {
    return {
      metal: '#e0b844',
      metalHi: '#fff0a8',
      metalEdge: '#7d5f18',
      foil: '#6ce8f0',
      foilAccent: '#2570a8',
      primary: '#35888e',
      primaryAlt: '#4da8a0',
      kraft: '#caa06e',
      kraftDark: '#8e653a',
      kraftHi: '#e5c294',
      paperEdge: '#f3fcff',
    };
  }
  if (forgeTier >= 2 && forgeBranch === 'elemental') {
    return {
      metal: '#d97a32',
      metalHi: '#ffcf70',
      metalEdge: '#7d3a14',
      foil: '#ffd257',
      foilAccent: '#c43e2b',
      primary: '#c95438',
      primaryAlt: '#de7844',
      kraft: '#c7955e',
      kraftDark: '#8e5e32',
      kraftHi: '#e0b786',
      paperEdge: '#fff7e6',
    };
  }
  if (forgeTier >= 2 && forgeBranch === 'tactical') {
    return {
      metal: '#d4ac44',
      metalHi: '#fbe69c',
      metalEdge: '#785a1c',
      foil: '#63d8e8',
      foilAccent: '#2d6fa3',
      primary: '#3e8e88',
      primaryAlt: '#56a69a',
      kraft: '#cbb082',
      kraftDark: '#906e44',
      kraftHi: '#e4cca2',
      paperEdge: '#f5fbff',
    };
  }
  return {
    metal: '#cfa24a',
    metalHi: '#f4dc90',
    metalEdge: '#7a5920',
    foil: '#f6d876',
    foilAccent: '#6b4d2b',
    primary: '#528e64',
    primaryAlt: '#6ea876',
    kraft: '#c99b66',
    kraftDark: '#916638',
    kraftHi: '#e0bc8d',
    paperEdge: '#fbf5e8',
  };
}

/** Deterministic PRNG for matte paper fiber grain */
function craftRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Paints a scissor-cut matte construction-paper shape with layered shadow & subtle edge highlight. */
function paintPaperLayer(
  ctx: CanvasRenderingContext2D,
  drawPath: () => void,
  fill: string,
  opts: {
    edge?: string;
    edgeW?: number;
    shadow?: boolean;
    speckleSeed?: number;
    highlight?: boolean;
  } = {}
): void {
  const { edge = 'rgba(62, 38, 20, 0.34)', edgeW = 2.4, shadow = true, speckleSeed = 11, highlight = true } = opts;

  // 1. Soft cut-paper drop shadow onto layer underneath
  if (shadow) {
    ctx.save();
    ctx.shadowColor = 'rgba(42, 24, 10, 0.28)';
    ctx.shadowBlur = 5;
    ctx.shadowOffsetX = 2;
    ctx.shadowOffsetY = 4;
    drawPath();
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.restore();
  }

  // 2. Matte cardstock fill + paper fiber speckles + gentle top bevel
  ctx.save();
  drawPath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.clip();

  if (highlight) {
    const grad = ctx.createLinearGradient(0, 40, 0, 220);
    grad.addColorStop(0, 'rgba(255, 252, 242, 0.20)');
    grad.addColorStop(0.45, 'rgba(255, 252, 242, 0.0)');
    grad.addColorStop(1, 'rgba(48, 26, 10, 0.14)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 256, 256);
  }

  const rng = craftRng(speckleSeed);
  for (let i = 0; i < 42; i++) {
    const x = rng() * 256;
    const y = rng() * 256;
    ctx.fillStyle = i % 2 === 0 ? 'rgba(255, 250, 236, 0.16)' : 'rgba(64, 38, 18, 0.10)';
    ctx.fillRect(x, y, 2 + rng() * 3, 1.5);
  }
  ctx.restore();

  // 3. Clean scissor-cut paper border seam (tone-on-tone, never heavy black ink)
  if (edgeW > 0) {
    ctx.save();
    drawPath();
    ctx.strokeStyle = edge;
    ctx.lineWidth = edgeW;
    ctx.stroke();
    ctx.restore();
  }
}

/** Paints a fluted corrugated-cardboard piece with authentic kraft ribs! */
function paintCorrugatedLayer(
  ctx: CanvasRenderingContext2D,
  drawPath: () => void,
  pal: CraftPalette,
  opts: {
    verticalFlutes?: boolean;
    tint?: string;
    fluteSpacing?: number;
    edgeW?: number;
  } = {}
): void {
  const { verticalFlutes = true, tint = pal.kraft, fluteSpacing = 8, edgeW = 2.4 } = opts;

  ctx.save();
  ctx.shadowColor = 'rgba(42, 24, 10, 0.30)';
  ctx.shadowBlur = 5;
  ctx.shadowOffsetX = 2;
  ctx.shadowOffsetY = 4;
  drawPath();
  ctx.fillStyle = tint;
  ctx.fill();
  ctx.restore();

  ctx.save();
  drawPath();
  ctx.fillStyle = tint;
  ctx.fill();
  ctx.clip();

  // Alternating light/dark corrugated cardboard ridges
  if (verticalFlutes) {
    for (let x = -128; x < 384; x += fluteSpacing) {
      ctx.fillStyle = 'rgba(255, 242, 214, 0.22)';
      ctx.fillRect(x, -128, fluteSpacing * 0.42, 512);
      ctx.fillStyle = 'rgba(66, 36, 14, 0.22)';
      ctx.fillRect(x + fluteSpacing * 0.48, -128, fluteSpacing * 0.38, 512);
    }
  } else {
    for (let y = -128; y < 384; y += fluteSpacing) {
      ctx.fillStyle = 'rgba(255, 242, 214, 0.22)';
      ctx.fillRect(-128, y, 512, fluteSpacing * 0.42);
      ctx.fillStyle = 'rgba(66, 36, 14, 0.22)';
      ctx.fillRect(-128, y + fluteSpacing * 0.48, 512, fluteSpacing * 0.38);
    }
  }

  // Subtle top-left paper catchlight
  const sheen = ctx.createLinearGradient(0, 30, 0, 220);
  sheen.addColorStop(0, 'rgba(255, 250, 232, 0.16)');
  sheen.addColorStop(1, 'rgba(54, 28, 10, 0.16)');
  ctx.fillStyle = sheen;
  ctx.fillRect(-128, -128, 512, 512);
  ctx.restore();

  ctx.save();
  drawPath();
  ctx.strokeStyle = 'rgba(72, 44, 20, 0.44)';
  ctx.lineWidth = edgeW;
  ctx.stroke();
  ctx.restore();
}

/** Paints a tiny brass split-pin paper fastener brad. */
function drawBrassBrad(ctx: CanvasRenderingContext2D, x: number, y: number, r = 5.5): void {
  ctx.save();
  ctx.shadowColor = 'rgba(40, 22, 8, 0.32)';
  ctx.shadowBlur = 2.5;
  ctx.shadowOffsetY = 1.5;
  const g = ctx.createRadialGradient(x - r * 0.32, y - r * 0.32, 1, x, y, r);
  g.addColorStop(0, '#fff3bf');
  g.addColorStop(0.55, '#d8a642');
  g.addColorStop(1, '#8c6018');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.strokeStyle = 'rgba(84, 52, 16, 0.55)';
  ctx.lineWidth = 1.3;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.moveTo(x - r * 0.52, y);
  ctx.lineTo(x + r * 0.52, y);
  ctx.stroke();
  ctx.restore();
}

/** Draws crisp origami fold-crease highlight + shadow line across a paper blade or wing. */
function drawFoldCrease(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number): void {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(255, 253, 244, 0.56)';
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();

  ctx.strokeStyle = 'rgba(54, 32, 14, 0.22)';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(x1 + 1.5, y1 + 1.5);
  ctx.lineTo(x2 + 1.5, y2 + 1.5);
  ctx.stroke();
  ctx.restore();
}

/** Draws wrapped rustic hemp twine binding bands on handles or craft joints. */
function drawTwineBands(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  count: number,
  spacing = 7
): void {
  ctx.save();
  ctx.lineCap = 'round';
  for (let i = 0; i < count; i++) {
    const yy = y + i * spacing;
    ctx.strokeStyle = '#6c4824';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(x, yy + 1);
    ctx.lineTo(x + w, yy - 1);
    ctx.stroke();

    ctx.strokeStyle = '#d8b786';
    ctx.lineWidth = 2.8;
    ctx.beginPath();
    ctx.moveTo(x, yy);
    ctx.lineTo(x + w, yy - 2);
    ctx.stroke();
  }
  ctx.restore();
}

function drawWeaponArt(
  ctx: CanvasRenderingContext2D,
  kind: WeaponVisualKind,
  forgeTier: number,
  forgeBranch?: WeaponForgeBranch
): void {
  const pal = tierCraftPalette(forgeTier, forgeBranch);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  switch (kind) {
    case 'duster': {
      // Luigi-style Papercraft & Corrugated Garden Vacuum Duster!
      // Rear wooden dowel grip + kraft carry handle
      paintPaperLayer(
        ctx,
        () => {
          ctx.beginPath();
          ctx.roundRect(46, 152, 26, 48, 8);
        },
        '#b07d4b',
        { speckleSeed: 101 }
      );
      drawTwineBands(ctx, 48, 166, 22, 3, 8);
      paintPaperLayer(
        ctx,
        () => {
          ctx.beginPath();
          ctx.roundRect(72, 66, 56, 20, 8);
        },
        pal.kraftDark,
        { speckleSeed: 102 }
      );

      // Fluted corrugated flared suction funnel nozzle!
      paintCorrugatedLayer(
        ctx,
        () => {
          ctx.beginPath();
          ctx.moveTo(146, 108);
          ctx.lineTo(222, 74);
          ctx.lineTo(232, 170);
          ctx.lineTo(146, 146);
          ctx.closePath();
        },
        pal,
        { verticalFlutes: false, tint: pal.metal, fluteSpacing: 9 }
      );
      // Folded turquoise/gold paper suction collar rim at nozzle mouth
      paintPaperLayer(
        ctx,
        () => {
          ctx.beginPath();
          ctx.ellipse(224, 122, 11, 46, -0.08, 0, Math.PI * 2);
        },
        '#2c575c',
        { edge: pal.foil, edgeW: 3.5, shadow: false, highlight: false }
      );
      ctx.strokeStyle = pal.foil;
      ctx.lineWidth = 3.2;
      ctx.beginPath();
      ctx.arc(222, 122, 22, -1.0, 1.0);
      ctx.stroke();

      // Main teal-paper & corrugated-kraft vacuum canister body
      paintPaperLayer(
        ctx,
        () => {
          ctx.beginPath();
          ctx.roundRect(42, 86, 112, 76, 20);
        },
        forgeBranch === 'elemental' && forgeTier >= 2 ? '#cc5438' : '#3d8f8c',
        { speckleSeed: 104 }
      );
      // Corrugated kraft belly bands + brass brads
      paintCorrugatedLayer(
        ctx,
        () => {
          ctx.beginPath();
          ctx.roundRect(62, 86, 16, 76, 4);
        },
        pal,
        { verticalFlutes: true, tint: pal.kraft, fluteSpacing: 6 }
      );
      paintCorrugatedLayer(
        ctx,
        () => {
          ctx.beginPath();
          ctx.roundRect(122, 86, 16, 76, 4);
        },
        pal,
        { verticalFlutes: true, tint: pal.kraft, fluteSpacing: 6 }
      );
      drawBrassBrad(ctx, 70, 98, 4.5);
      drawBrassBrad(ctx, 70, 150, 4.5);
      drawBrassBrad(ctx, 130, 98, 4.5);
      drawBrassBrad(ctx, 130, 150, 4.5);

      // Cut-paper pressure dial gauge with brass pin
      paintPaperLayer(
        ctx,
        () => {
          ctx.beginPath();
          ctx.arc(100, 124, 17, 0, Math.PI * 2);
        },
        '#fcf5e2',
        { edge: pal.metalEdge, edgeW: 3, speckleSeed: 105 }
      );
      ctx.strokeStyle = '#cf402e';
      ctx.lineWidth = 3.4;
      ctx.beginPath();
      ctx.moveTo(100, 124);
      ctx.lineTo(111, 113);
      ctx.stroke();
      drawBrassBrad(ctx, 100, 124, 3.8);
      break;
    }

    case 'hammer': {
      // Handcrafted Corrugated-Drum & Birch-Dowel Giant Mallet!
      ctx.save();
      ctx.translate(128, 132);
      ctx.rotate(-0.42);

      // Turned pale birch dowel handle + twine grip wrap
      paintPaperLayer(
        ctx,
        () => {
          ctx.beginPath();
          ctx.roundRect(-13, -12, 26, 118, 10);
        },
        '#d6ad78',
        { speckleSeed: 201 }
      );
      drawTwineBands(ctx, -12, 54, 24, 4, 8);

      // Oversized fluted corrugated-cardboard barrel head!
      paintCorrugatedLayer(
        ctx,
        () => {
          ctx.beginPath();
          ctx.roundRect(-64, -76, 128, 72, 18);
        },
        pal,
        {
          verticalFlutes: true,
          tint: forgeBranch === 'elemental' && forgeTier >= 2 ? '#c45434' : '#b8824e',
          fluteSpacing: 9,
        }
      );

      // Layered cardstock brass end-caps pinned with brads
      paintPaperLayer(
        ctx,
        () => {
          ctx.beginPath();
          ctx.roundRect(-68, -72, 20, 64, 7);
        },
        pal.metal,
        { speckleSeed: 202 }
      );
      paintPaperLayer(
        ctx,
        () => {
          ctx.beginPath();
          ctx.roundRect(48, -72, 20, 64, 7);
        },
        pal.metal,
        { speckleSeed: 203 }
      );
      drawBrassBrad(ctx, -58, -56, 4.2);
      drawBrassBrad(ctx, -58, -24, 4.2);
      drawBrassBrad(ctx, 58, -56, 4.2);
      drawBrassBrad(ctx, 58, -24, 4.2);

      // Layered cut-paper star emblem glued on front of mallet!
      paintPaperLayer(
        ctx,
        () => {
          ctx.beginPath();
          for (let i = 0; i < 10; i++) {
            const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
            const r = i % 2 === 0 ? 22 : 10;
            const px = Math.cos(a) * r;
            const py = -40 + Math.sin(a) * r;
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
          }
          ctx.closePath();
        },
        pal.foil,
        { edge: pal.metalEdge, edgeW: 2.4, speckleSeed: 204 }
      );
      drawBrassBrad(ctx, 0, -40, 4);
      ctx.restore();
      break;
    }

    case 'boomerang': {
      // Origami Layered Folded Leaf/Cardstock Boomerang!
      paintCorrugatedLayer(
        ctx,
        () => {
          ctx.beginPath();
          ctx.moveTo(52, 60);
          ctx.quadraticCurveTo(190, 50, 214, 192);
          ctx.quadraticCurveTo(186, 208, 168, 186);
          ctx.quadraticCurveTo(146, 108, 58, 106);
          ctx.quadraticCurveTo(36, 86, 52, 60);
          ctx.closePath();
        },
        pal,
        {
          verticalFlutes: false,
          tint: forgeBranch === 'elemental' && forgeTier >= 2 ? '#d46032' : '#589c52',
          fluteSpacing: 10,
        }
      );

      // Layered cream/gold folded paper stripe inlaid along spine
      paintPaperLayer(
        ctx,
        () => {
          ctx.beginPath();
          ctx.moveTo(74, 76);
          ctx.quadraticCurveTo(166, 76, 194, 168);
          ctx.lineTo(180, 174);
          ctx.quadraticCurveTo(154, 92, 72, 92);
          ctx.closePath();
        },
        pal.foil,
        { edge: pal.metalEdge, edgeW: 1.8, shadow: true, speckleSeed: 302 }
      );

      // Paper tip caps & brass pivot brads
      paintPaperLayer(
        ctx,
        () => {
          ctx.beginPath();
          ctx.arc(60, 84, 13, 0, Math.PI * 2);
        },
        pal.metal,
        { speckleSeed: 303 }
      );
      paintPaperLayer(
        ctx,
        () => {
          ctx.beginPath();
          ctx.arc(192, 178, 13, 0, Math.PI * 2);
        },
        pal.metal,
        { speckleSeed: 304 }
      );
      drawBrassBrad(ctx, 60, 84, 4.5);
      drawBrassBrad(ctx, 192, 178, 4.5);
      drawBrassBrad(ctx, 140, 100, 4.5);
      break;
    }

    case 'whip': {
      // Twine & Cut-Felt Briar Vine Grapple Hook!
      // Turned wood handle wrapped in hemp twine
      paintPaperLayer(
        ctx,
        () => {
          ctx.beginPath();
          ctx.roundRect(36, 148, 32, 64, 10);
        },
        '#b88450',
        { speckleSeed: 401 }
      );
      drawTwineBands(ctx, 38, 160, 28, 5, 8);

      // Layered coiled paper-cord vine rope
      ctx.save();
      ctx.shadowColor = 'rgba(42, 24, 10, 0.28)';
      ctx.shadowBlur = 4;
      ctx.shadowOffsetY = 3;
      ctx.strokeStyle = '#366630';
      ctx.lineWidth = 17;
      ctx.beginPath();
      ctx.moveTo(64, 156);
      ctx.bezierCurveTo(92, 62, 176, 188, 186, 94);
      ctx.stroke();
      ctx.restore();

      ctx.strokeStyle = forgeBranch === 'elemental' && forgeTier >= 2 ? '#b8426e' : '#64ad4e';
      ctx.lineWidth = 10;
      ctx.beginPath();
      ctx.moveTo(64, 156);
      ctx.bezierCurveTo(92, 62, 176, 188, 186, 94);
      ctx.stroke();

      // Tiny cut-felt leaves glued along the vine!
      for (const [lx, ly, rot] of [
        [98, 108, -0.6],
        [142, 134, 0.5],
      ]) {
        ctx.save();
        ctx.translate(lx, ly);
        ctx.rotate(rot);
        paintPaperLayer(
          ctx,
          () => {
            ctx.beginPath();
            ctx.ellipse(0, 0, 14, 7, 0, 0, Math.PI * 2);
          },
          '#7dc45e',
          { edgeW: 1.6, speckleSeed: 402 }
        );
        ctx.restore();
      }

      // Folded metallic-cardstock grapple claw hook at tip + brass brad
      paintPaperLayer(
        ctx,
        () => {
          ctx.beginPath();
          ctx.moveTo(182, 96);
          ctx.lineTo(206, 58);
          ctx.quadraticCurveTo(238, 62, 224, 100);
          ctx.lineTo(204, 88);
          ctx.lineTo(194, 110);
          ctx.closePath();
        },
        pal.metal,
        { speckleSeed: 403 }
      );
      drawFoldCrease(ctx, 190, 92, 212, 70);
      drawBrassBrad(ctx, 186, 95, 4.8);
      break;
    }

    case 'bellows': {
      // Accordion-Folded Red Paper & Corrugated Paddle Forge Bellows!
      // Tapered brass-paper nozzle
      paintPaperLayer(
        ctx,
        () => {
          ctx.beginPath();
          ctx.moveTo(152, 112);
          ctx.lineTo(230, 120);
          ctx.lineTo(230, 138);
          ctx.lineTo(152, 146);
          ctx.closePath();
        },
        pal.metal,
        { speckleSeed: 501 }
      );
      drawFoldCrease(ctx, 156, 129, 226, 129);

      // Cut-paper origami flame tongue peeking from nozzle!
      paintPaperLayer(
        ctx,
        () => {
          ctx.beginPath();
          ctx.moveTo(222, 116);
          ctx.quadraticCurveTo(248, 129, 222, 144);
          ctx.closePath();
        },
        '#ff7e2e',
        { edgeW: 1.6, shadow: false }
      );
      paintPaperLayer(
        ctx,
        () => {
          ctx.beginPath();
          ctx.moveTo(224, 122);
          ctx.quadraticCurveTo(239, 129, 224, 136);
          ctx.closePath();
        },
        '#ffe066',
        { edgeW: 0, shadow: false }
      );

      // Accordion-pleated crimson construction-paper pouch
      paintPaperLayer(
        ctx,
        () => {
          ctx.beginPath();
          ctx.moveTo(46, 80);
          ctx.lineTo(160, 108);
          ctx.lineTo(160, 150);
          ctx.lineTo(46, 178);
          ctx.closePath();
        },
        '#c94832',
        { speckleSeed: 502 }
      );
      // Accordion pleat crease lines!
      for (const py of [104, 122, 138, 154]) {
        drawFoldCrease(ctx, 50, py, 156, 129 + (py - 129) * 0.45);
      }

      // Top & bottom fluted corrugated cardboard paddles pinned with brass brads
      paintCorrugatedLayer(
        ctx,
        () => {
          ctx.beginPath();
          ctx.roundRect(38, 66, 124, 24, 8);
        },
        pal,
        { verticalFlutes: true, tint: pal.kraft, fluteSpacing: 8 }
      );
      paintCorrugatedLayer(
        ctx,
        () => {
          ctx.beginPath();
          ctx.roundRect(38, 168, 124, 24, 8);
        },
        pal,
        { verticalFlutes: true, tint: pal.kraft, fluteSpacing: 8 }
      );
      drawBrassBrad(ctx, 54, 78, 4.2);
      drawBrassBrad(ctx, 146, 78, 4.2);
      drawBrassBrad(ctx, 54, 180, 4.2);
      drawBrassBrad(ctx, 146, 180, 4.2);
      break;
    }

    case 'drone': {
      // Papercraft Pinwheel & Cardboard Clockwork Sentry Drone!
      // Wooden dowel axle + folded paper pinwheel propeller
      paintPaperLayer(
        ctx,
        () => {
          ctx.beginPath();
          ctx.roundRect(122, 68, 12, 26, 4);
        },
        '#b88754',
        { speckleSeed: 601 }
      );
      paintPaperLayer(
        ctx,
        () => {
          ctx.beginPath();
          ctx.roundRect(70, 56, 116, 18, 8);
        },
        pal.metal,
        { speckleSeed: 602 }
      );
      drawFoldCrease(ctx, 74, 65, 182, 65);
      drawBrassBrad(ctx, 128, 65, 4.5);

      // Layered corrugated-cardboard kettle-pod body
      paintCorrugatedLayer(
        ctx,
        () => {
          ctx.beginPath();
          ctx.arc(128, 136, 48, 0, Math.PI * 2);
        },
        pal,
        {
          verticalFlutes: false,
          tint: forgeBranch === 'elemental' && forgeTier >= 2 ? '#dc6c32' : '#dfa944',
          fluteSpacing: 9,
        }
      );

      // Cut-paper riveted faceplate visor + bright paper eyes!
      paintPaperLayer(
        ctx,
        () => {
          ctx.beginPath();
          ctx.roundRect(92, 114, 72, 32, 10);
        },
        '#3d2d24',
        { edge: pal.kraftHi, edgeW: 2.2, speckleSeed: 603 }
      );
      paintPaperLayer(
        ctx,
        () => {
          ctx.beginPath();
          ctx.arc(112, 130, 8.5, 0, Math.PI * 2);
        },
        pal.foil,
        { edgeW: 0, shadow: false }
      );
      paintPaperLayer(
        ctx,
        () => {
          ctx.beginPath();
          ctx.arc(144, 130, 8.5, 0, Math.PI * 2);
        },
        pal.foil,
        { edgeW: 0, shadow: false }
      );
      drawBrassBrad(ctx, 98, 120, 3.2);
      drawBrassBrad(ctx, 158, 120, 3.2);
      break;
    }

    case 'lance': {
      // Origami Creased Foil-Paper Rapier & Cut-Leaf Guard!
      ctx.save();
      ctx.translate(128, 128);
      ctx.rotate(-0.52);

      // Crisp folded silver/gold cardstock blade (two-tone origami facets!)
      paintPaperLayer(
        ctx,
        () => {
          ctx.beginPath();
          ctx.moveTo(-15, 20);
          ctx.lineTo(0, -108);
          ctx.lineTo(15, 20);
          ctx.closePath();
        },
        forgeBranch === 'elemental' && forgeTier >= 2 ? '#f5b854' : '#e6eff2',
        { edge: '#7a8a94', edgeW: 2, speckleSeed: 701 }
      );
      // Darker right fold facet for real 3D origami ridge
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(0, -108);
      ctx.lineTo(15, 20);
      ctx.lineTo(0, 20);
      ctx.closePath();
      ctx.fillStyle = 'rgba(72, 92, 106, 0.22)';
      ctx.fill();
      ctx.restore();
      drawFoldCrease(ctx, 0, -104, 0, 18);

      // Layered cut-felt & gold cardstock leaf basket guard
      paintPaperLayer(
        ctx,
        () => {
          ctx.beginPath();
          ctx.ellipse(0, 26, 38, 17, 0, 0, Math.PI * 2);
        },
        pal.metal,
        { speckleSeed: 702 }
      );
      paintPaperLayer(
        ctx,
        () => {
          ctx.beginPath();
          ctx.ellipse(-20, 22, 16, 8, -0.35, 0, Math.PI * 2);
          ctx.ellipse(20, 22, 16, 8, 0.35, 0, Math.PI * 2);
        },
        '#63a656',
        { edgeW: 1.8, speckleSeed: 703 }
      );

      // Wooden dowel hilt wrapped in twine + pommel brad
      paintPaperLayer(
        ctx,
        () => {
          ctx.beginPath();
          ctx.roundRect(-10, 38, 20, 48, 8);
        },
        '#a87444',
        { speckleSeed: 704 }
      );
      drawTwineBands(ctx, -9, 46, 18, 4, 8);
      drawBrassBrad(ctx, 0, 26, 5);
      drawBrassBrad(ctx, 0, 84, 5.5);
      ctx.restore();
      break;
    }

    case 'sniper': {
      // Rolled Corrugated-Cardboard & Brass Spyglass Pea-Pod Longrifle!
      // Corrugated stock
      paintCorrugatedLayer(
        ctx,
        () => {
          ctx.beginPath();
          ctx.roundRect(28, 120, 76, 36, 10);
        },
        pal,
        { verticalFlutes: true, tint: pal.kraft, fluteSpacing: 7 }
      );
      // Long rolled green-paper pea barrel
      paintPaperLayer(
        ctx,
        () => {
          ctx.beginPath();
          ctx.roundRect(88, 110, 138, 26, 9);
        },
        forgeBranch === 'elemental' && forgeTier >= 2 ? '#c95232' : '#589c54',
        { speckleSeed: 801 }
      );
      drawFoldCrease(ctx, 94, 118, 220, 118);
      // Twine barrel lashing
      drawTwineBands(ctx, 112, 112, 10, 3, 7);
      // Folded brass-paper flared muzzle cone
      paintPaperLayer(
        ctx,
        () => {
          ctx.beginPath();
          ctx.moveTo(212, 108);
          ctx.lineTo(236, 100);
          ctx.lineTo(236, 146);
          ctx.lineTo(212, 138);
          ctx.closePath();
        },
        pal.metal,
        { speckleSeed: 802 }
      );
      // Rolled paper spyglass scope on kraft risers
      paintPaperLayer(
        ctx,
        () => {
          ctx.beginPath();
          ctx.roundRect(104, 80, 72, 22, 8);
        },
        pal.metal,
        { speckleSeed: 803 }
      );
      paintPaperLayer(
        ctx,
        () => {
          ctx.beginPath();
          ctx.arc(170, 91, 8, 0, Math.PI * 2);
        },
        pal.foil,
        { edgeW: 2, shadow: false }
      );
      drawBrassBrad(ctx, 64, 138, 4.5);
      drawBrassBrad(ctx, 114, 123, 4);
      break;
    }

    case 'mortar': {
      // Corrugated-Cardboard Tube Garden Mortar + Wooden Toy Wheel!
      ctx.save();
      ctx.translate(128, 136);
      ctx.rotate(-0.46);

      // Glowing folded-paper ordnance shell peeking out the barrel mouth
      paintPaperLayer(
        ctx,
        () => {
          ctx.beginPath();
          ctx.arc(0, -82, 24, Math.PI, 0);
          ctx.closePath();
        },
        pal.foil,
        { edge: pal.metalEdge, edgeW: 2.2, speckleSeed: 901 }
      );

      // Chunky corrugated mortar tube
      paintCorrugatedLayer(
        ctx,
        () => {
          ctx.beginPath();
          ctx.roundRect(-36, -74, 72, 118, 16);
        },
        pal,
        {
          verticalFlutes: false,
          tint: forgeBranch === 'elemental' && forgeTier >= 2 ? '#b84c32' : '#677c8a',
          fluteSpacing: 9,
        }
      );

      // Brass paper mouth collar + center band
      paintPaperLayer(
        ctx,
        () => {
          ctx.beginPath();
          ctx.roundRect(-44, -80, 88, 22, 8);
        },
        pal.metal,
        { speckleSeed: 902 }
      );
      paintPaperLayer(
        ctx,
        () => {
          ctx.beginPath();
          ctx.roundRect(-38, -8, 76, 16, 5);
        },
        pal.kraft,
        { speckleSeed: 903 }
      );
      drawBrassBrad(ctx, -26, -69, 4);
      drawBrassBrad(ctx, 26, -69, 4);

      // Turned pale birch toy carriage wheel pinned with brass brad!
      paintPaperLayer(
        ctx,
        () => {
          ctx.beginPath();
          ctx.arc(-20, 42, 26, 0, Math.PI * 2);
        },
        '#c48f56',
        { edge: '#6d441e', edgeW: 3, speckleSeed: 904 }
      );
      paintPaperLayer(
        ctx,
        () => {
          ctx.beginPath();
          ctx.arc(-20, 42, 15, 0, Math.PI * 2);
        },
        '#e8cc9c',
        { edgeW: 1.5, shadow: false }
      );
      drawBrassBrad(ctx, -20, 42, 5.5);
      ctx.restore();
      break;
    }

    case 'scatter': {
      // Folded Corrugated Blunderbuss Seed Scattergun!
      paintCorrugatedLayer(
        ctx,
        () => {
          ctx.beginPath();
          ctx.roundRect(34, 128, 70, 38, 12);
        },
        pal,
        { verticalFlutes: true, tint: pal.kraft, fluteSpacing: 7 }
      );
      paintCorrugatedLayer(
        ctx,
        () => {
          ctx.beginPath();
          ctx.moveTo(90, 112);
          ctx.lineTo(222, 84);
          ctx.lineTo(224, 168);
          ctx.lineTo(90, 152);
          ctx.closePath();
        },
        pal,
        { verticalFlutes: false, tint: pal.metal, fluteSpacing: 9 }
      );
      // Coral red construction-paper barrel band + brass brads
      paintPaperLayer(
        ctx,
        () => {
          ctx.beginPath();
          ctx.roundRect(122, 104, 24, 52, 5);
        },
        '#cf4a38',
        { speckleSeed: 1002 }
      );
      drawBrassBrad(ctx, 134, 116, 4.2);
      drawBrassBrad(ctx, 134, 144, 4.2);
      drawBrassBrad(ctx, 64, 146, 4.5);
      break;
    }

    case 'bow': {
      // Snap-Pea's Iconic Folded Papercraft Longbow & Origami Feathered Arrow!
      // Curved folded-cardboard bow limbs
      ctx.save();
      ctx.shadowColor = 'rgba(42, 24, 10, 0.28)';
      ctx.shadowBlur = 5;
      ctx.shadowOffsetX = 2;
      ctx.shadowOffsetY = 4;
      ctx.strokeStyle = '#9c6c3b';
      ctx.lineWidth = 17;
      ctx.beginPath();
      ctx.arc(98, 128, 76, -1.24, 1.24);
      ctx.stroke();
      ctx.restore();

      ctx.strokeStyle = pal.kraftHi;
      ctx.lineWidth = 9;
      ctx.beginPath();
      ctx.arc(98, 128, 76, -1.22, 1.22);
      ctx.stroke();

      // Twine center grip & taut cream hemp bowstring
      drawTwineBands(ctx, 162, 114, 22, 4, 7);
      ctx.strokeStyle = '#f2e6cc';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(122, 56);
      ctx.lineTo(78, 128);
      ctx.lineTo(122, 200);
      ctx.stroke();

      // Wooden dowel arrow shaft
      ctx.strokeStyle = '#a87440';
      ctx.lineWidth = 7.5;
      ctx.beginPath();
      ctx.moveTo(74, 128);
      ctx.lineTo(208, 128);
      ctx.stroke();
      ctx.strokeStyle = '#e5c290';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(76, 126.5);
      ctx.lineTo(206, 126.5);
      ctx.stroke();

      // Scissor-cut felt/paper fletching feathers at tail!
      paintPaperLayer(
        ctx,
        () => {
          ctx.beginPath();
          ctx.moveTo(64, 128);
          ctx.lineTo(86, 110);
          ctx.lineTo(100, 112);
          ctx.lineTo(84, 128);
          ctx.lineTo(100, 144);
          ctx.lineTo(86, 146);
          ctx.closePath();
        },
        '#5ca854',
        { edgeW: 1.6, speckleSeed: 1101 }
      );

      // Origami folded-paper diamond arrowhead!
      paintPaperLayer(
        ctx,
        () => {
          ctx.beginPath();
          ctx.moveTo(200, 108);
          ctx.lineTo(236, 128);
          ctx.lineTo(200, 148);
          ctx.lineTo(208, 128);
          ctx.closePath();
        },
        pal.foil,
        { edge: pal.metalEdge, edgeW: 2.2, speckleSeed: 1102 }
      );
      drawFoldCrease(ctx, 206, 128, 234, 128);
      drawBrassBrad(ctx, 122, 56, 4);
      drawBrassBrad(ctx, 122, 200, 4);
      break;
    }

    case 'hose': {
      // Corrugated & Paper-Tube Pressurized Garden Hose Nozzle!
      ctx.save();
      ctx.shadowColor = 'rgba(40, 22, 8, 0.28)';
      ctx.shadowBlur = 4;
      ctx.shadowOffsetY = 3;
      ctx.strokeStyle = '#256c8a';
      ctx.lineWidth = 19;
      ctx.beginPath();
      ctx.moveTo(42, 186);
      ctx.quadraticCurveTo(54, 112, 116, 116);
      ctx.stroke();
      ctx.restore();
      ctx.strokeStyle = '#48a8c7';
      ctx.lineWidth = 11;
      ctx.beginPath();
      ctx.moveTo(42, 186);
      ctx.quadraticCurveTo(54, 112, 116, 116);
      ctx.stroke();

      // Corrugated brass spray housing
      paintCorrugatedLayer(
        ctx,
        () => {
          ctx.beginPath();
          ctx.roundRect(104, 94, 88, 44, 11);
        },
        pal,
        { verticalFlutes: true, tint: pal.metal, fluteSpacing: 8 }
      );
      // Glossy turquoise cut-paper jet tip!
      paintPaperLayer(
        ctx,
        () => {
          ctx.beginPath();
          ctx.moveTo(190, 100);
          ctx.lineTo(232, 88);
          ctx.lineTo(232, 144);
          ctx.lineTo(190, 132);
          ctx.closePath();
        },
        '#4ac4e0',
        { edge: '#1e6c80', edgeW: 2.2, speckleSeed: 1201 }
      );
      drawFoldCrease(ctx, 192, 116, 228, 116);
      drawBrassBrad(ctx, 120, 116, 4.5);
      drawBrassBrad(ctx, 174, 116, 4.5);
      break;
    }

    case 'slingshot': {
      // Turned-Wood & Felt-Band Garden Slingshot!
      ctx.save();
      ctx.shadowColor = 'rgba(42, 24, 10, 0.28)';
      ctx.shadowBlur = 5;
      ctx.shadowOffsetY = 4;
      ctx.strokeStyle = '#9e6a38';
      ctx.lineWidth = 22;
      ctx.beginPath();
      ctx.moveTo(128, 212);
      ctx.lineTo(128, 136);
      ctx.moveTo(128, 142);
      ctx.lineTo(76, 72);
      ctx.moveTo(128, 142);
      ctx.lineTo(180, 72);
      ctx.stroke();
      ctx.restore();

      ctx.strokeStyle = '#cfa06b';
      ctx.lineWidth = 12;
      ctx.beginPath();
      ctx.moveTo(128, 208);
      ctx.lineTo(128, 136);
      ctx.moveTo(128, 142);
      ctx.lineTo(78, 74);
      ctx.moveTo(128, 142);
      ctx.lineTo(178, 74);
      ctx.stroke();

      drawTwineBands(ctx, 117, 158, 22, 4, 8);

      // Coral-red felt elastic ribbon + folded paper seed ammo!
      ctx.strokeStyle = '#d95240';
      ctx.lineWidth = 7.5;
      ctx.beginPath();
      ctx.moveTo(78, 78);
      ctx.lineTo(128, 106);
      ctx.lineTo(178, 78);
      ctx.stroke();

      paintPaperLayer(
        ctx,
        () => {
          ctx.beginPath();
          ctx.arc(128, 106, 17, 0, Math.PI * 2);
        },
        pal.foil,
        { edge: pal.metalEdge, edgeW: 2.2, speckleSeed: 1301 }
      );
      drawBrassBrad(ctx, 78, 76, 4.2);
      drawBrassBrad(ctx, 178, 76, 4.2);
      break;
    }

    case 'blaster':
    default: {
      // Handcrafted Corrugated-Cardboard & Cut-Paper Seed Blaster!
      // Kraft handle grip
      paintPaperLayer(
        ctx,
        () => {
          ctx.beginPath();
          ctx.roundRect(42, 134, 44, 52, 10);
        },
        '#b07b48',
        { speckleSeed: 1401 }
      );
      drawTwineBands(ctx, 44, 148, 40, 3, 8);

      // Main corrugated-cardboard & painted construction-paper receiver body
      paintCorrugatedLayer(
        ctx,
        () => {
          ctx.beginPath();
          ctx.roundRect(54, 92, 148, 50, 14);
        },
        pal,
        {
          verticalFlutes: false,
          tint: forgeBranch === 'elemental' && forgeTier >= 2 ? '#cc5434' : '#569458',
          fluteSpacing: 8,
        }
      );

      // Folded brass-paper muzzle cuff
      paintPaperLayer(
        ctx,
        () => {
          ctx.beginPath();
          ctx.roundRect(194, 84, 32, 66, 9);
        },
        pal.metal,
        { speckleSeed: 1402 }
      );

      // Layered cream & gold paper ammo chamber lens
      paintPaperLayer(
        ctx,
        () => {
          ctx.beginPath();
          ctx.arc(126, 117, 16, 0, Math.PI * 2);
        },
        pal.foil,
        { edge: pal.metalEdge, edgeW: 2.4, speckleSeed: 1403 }
      );
      drawBrassBrad(ctx, 74, 117, 4.5);
      drawBrassBrad(ctx, 176, 117, 4.5);
      drawBrassBrad(ctx, 210, 100, 3.8);
      drawBrassBrad(ctx, 210, 134, 3.8);
      break;
    }
  }

  // Forge Tier II / III Embossed Origami Foil Craft Seal in upper-left corner!
  if (forgeTier >= 2) {
    paintPaperLayer(
      ctx,
      () => {
        ctx.beginPath();
        const pts = forgeTier >= 3 ? 12 : 8;
        const rOut = forgeTier >= 3 ? 23 : 18;
        const rIn = rOut * 0.72;
        for (let i = 0; i < pts * 2; i++) {
          const a = (i / (pts * 2)) * Math.PI * 2 - Math.PI / 2;
          const r = i % 2 === 0 ? rOut : rIn;
          const px = 52 + Math.cos(a) * r;
          const py = 50 + Math.sin(a) * r;
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.closePath();
      },
      pal.foilAccent,
      { edge: pal.foil, edgeW: 2.5, speckleSeed: 1500 }
    );
    ctx.fillStyle = pal.foil;
    ctx.font = '900 20px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(forgeTier >= 3 ? '★' : '✦', 52, 51);
  }
}

function buildDieCutWeaponCanvas(
  visualKind: WeaponVisualKind,
  forgeTier: number,
  forgeBranch?: WeaponForgeBranch
): HTMLCanvasElement {
  const size = 256;
  const art = document.createElement('canvas');
  art.width = size;
  art.height = size;
  const actx = art.getContext('2d')!;
  drawWeaponArt(actx, visualKind, forgeTier, forgeBranch);

  // Subtle crisp cut-cardstock rim backing (tight 4.5px craft trim so papercraft reads naturally beside sculpted clay toys!)
  const out = document.createElement('canvas');
  out.width = size;
  out.height = size;
  const ctx = out.getContext('2d')!;
  const pal = tierCraftPalette(forgeTier, forgeBranch);

  const sil = document.createElement('canvas');
  sil.width = size;
  sil.height = size;
  const sctx = sil.getContext('2d')!;
  sctx.drawImage(art, 0, 0);
  sctx.globalCompositeOperation = 'source-in';
  sctx.fillStyle = pal.paperEdge;
  sctx.fillRect(0, 0, size, size);

  const borderR = 4.5;
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    ctx.drawImage(sil, Math.cos(a) * borderR, Math.sin(a) * borderR);
  }
  ctx.drawImage(art, 0, 0);
  return out;
}

export function getWeaponTexturePair(
  visualKind: WeaponVisualKind,
  forgeTier = 1,
  forgeBranch?: WeaponForgeBranch
): { front: THREE.CanvasTexture; back: THREE.CanvasTexture } {
  const key = makeCacheKey(visualKind, forgeTier, forgeBranch);
  const existing = weaponTexCache.get(key);
  if (existing) return existing;

  const canvas = buildDieCutWeaponCanvas(visualKind, forgeTier, forgeBranch);
  const front = new THREE.CanvasTexture(canvas);
  front.colorSpace = THREE.SRGBColorSpace;
  front.anisotropy = 4;
  front.needsUpdate = true;

  const backCanvas = document.createElement('canvas');
  backCanvas.width = canvas.width;
  backCanvas.height = canvas.height;
  const bctx = backCanvas.getContext('2d')!;
  bctx.translate(canvas.width, 0);
  bctx.scale(-1, 1);
  bctx.drawImage(canvas, 0, 0);
  const back = new THREE.CanvasTexture(backCanvas);
  back.colorSpace = THREE.SRGBColorSpace;
  back.anisotropy = 4;
  back.needsUpdate = true;

  const pair = { front, back };
  weaponTexCache.set(key, pair);
  return pair;
}

/** Cached PNG data URL for displaying the EXACT same papercraft weapon prop in UI & 2D canvas! */
export function getWeaponCutoutDataUrl(
  visualKind: WeaponVisualKind = 'blaster',
  forgeTier = 1,
  forgeBranch?: WeaponForgeBranch
): string {
  const key = makeCacheKey(visualKind, forgeTier, forgeBranch);
  const cached = weaponDataUrlCache.get(key);
  if (cached) return cached;
  if (typeof document === 'undefined') return '';
  const canvas = buildDieCutWeaponCanvas(visualKind, forgeTier, forgeBranch);
  const url = canvas.toDataURL('image/png');
  weaponDataUrlCache.set(key, url);
  return url;
}

export interface EquippedWeaponPropRig {
  root: THREE.Group;
  pivot: THREE.Group;
  frontMat: THREE.MeshStandardMaterial;
  backMat: THREE.MeshStandardMaterial;
  auraMesh: THREE.Mesh;
  auraMat: THREE.MeshBasicMaterial;
  currentKey: string;
  swapPopTimer: number;
  recoilTimer: number;
  recoilKind: 'shoot' | 'swing' | 'vacuum' | 'throw';
  setWeapon: (visualKind: WeaponVisualKind, forgeTier?: number, forgeBranch?: WeaponForgeBranch, animateSwap?: boolean) => void;
  dispose: () => void;
}

/**
 * Builds a 3D double-sided thick papercraft & corrugated-cardboard weapon prop rig mounted beside a hero figurine!
 */
export function createEquippedWeaponRig(
  initialKind: WeaponVisualKind = 'blaster',
  initialTier = 1,
  initialBranch?: WeaponForgeBranch
): EquippedWeaponPropRig {
  const root = new THREE.Group();
  const pivot = new THREE.Group();
  root.add(pivot);

  const pair = getWeaponTexturePair(initialKind, initialTier, initialBranch);
  const size = 0.64;
  const planeGeo = new THREE.PlaneGeometry(size, size);

  const frontMat = new THREE.MeshStandardMaterial({
    map: pair.front,
    transparent: true,
    alphaTest: 0.28,
    roughness: 0.78,
    metalness: 0.05,
    side: THREE.FrontSide,
  });
  const backMat = new THREE.MeshStandardMaterial({
    map: pair.back,
    transparent: true,
    alphaTest: 0.28,
    roughness: 0.78,
    metalness: 0.05,
    side: THREE.FrontSide,
  });
  const coreMat = new THREE.MeshStandardMaterial({
    color: '#cfa16e',
    map: pair.front,
    transparent: true,
    alphaTest: 0.36,
    roughness: 0.94,
    side: THREE.DoubleSide,
  });

  const frontMesh = new THREE.Mesh(planeGeo, frontMat);
  frontMesh.position.z = 0.018;
  frontMesh.castShadow = true;

  const coreMesh = new THREE.Mesh(planeGeo, coreMat);
  coreMesh.position.z = 0;

  const backMesh = new THREE.Mesh(planeGeo, backMat);
  backMesh.position.z = -0.018;
  backMesh.rotation.y = Math.PI;
  backMesh.castShadow = true;

  // Forge Tier 2/3 subtle glowing craft-foil halo behind masterwork papercraft weapons!
  const auraGeo = new THREE.RingGeometry(0.18, 0.29, 18);
  const auraMat = new THREE.MeshBasicMaterial({
    color: '#ffd845',
    transparent: true,
    opacity: 0.0,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const auraMesh = new THREE.Mesh(auraGeo, auraMat);
  auraMesh.position.z = -0.024;
  auraMesh.visible = initialTier >= 2;

  pivot.add(auraMesh, coreMesh, frontMesh, backMesh);

  const currentKey = makeCacheKey(initialKind, initialTier, initialBranch);

  const rig: EquippedWeaponPropRig = {
    root,
    pivot,
    frontMat,
    backMat,
    auraMesh,
    auraMat,
    currentKey,
    swapPopTimer: 0,
    recoilTimer: 0,
    recoilKind: 'shoot',
    setWeapon(visualKind, forgeTier = 1, forgeBranch, animateSwap = false) {
      const nextKey = makeCacheKey(visualKind, forgeTier, forgeBranch);
      if (nextKey === rig.currentKey) return;
      rig.currentKey = nextKey;
      const nextPair = getWeaponTexturePair(visualKind, forgeTier, forgeBranch);
      frontMat.map = nextPair.front;
      backMat.map = nextPair.back;
      coreMat.map = nextPair.front;
      frontMat.needsUpdate = true;
      backMat.needsUpdate = true;
      coreMat.needsUpdate = true;
      auraMesh.visible = forgeTier >= 2;
      if (forgeTier >= 2) {
        auraMat.color.set(forgeBranch === 'elemental' ? '#ff8b33' : '#5ad8ff');
        auraMat.opacity = forgeTier >= 3 ? 0.56 : 0.34;
      }
      if (animateSwap) {
        rig.swapPopTimer = 0.34;
      }
    },
    dispose() {
      planeGeo.dispose();
      auraGeo.dispose();
      frontMat.dispose();
      backMat.dispose();
      coreMat.dispose();
      auraMat.dispose();
    },
  };

  return rig;
}
