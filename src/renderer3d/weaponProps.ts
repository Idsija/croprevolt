import * as THREE from 'three';
import type { WeaponForgeBranch, WeaponVisualKind } from '../engine/types';

/**
 * Hand-crafted Paper Mario Die-Cut Cardboard Weapon Cutout Generator!
 *
 * Powers BOTH:
 * 1. The 3D visually equipped weapon prop mounted directly on every hero standee
 *    in PaperDioramaRenderer (with live recoil, melee swing, vacuum spin & paper-flip swap!).
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

function tierTrimPalette(forgeTier: number, forgeBranch?: WeaponForgeBranch): {
  trim: string;
  glow: string;
  accent: string;
  paperEdge: string;
} {
  if (forgeTier >= 3 && forgeBranch === 'elemental') {
    return { trim: '#ff7b24', glow: '#ffe169', accent: '#d93226', paperEdge: '#fff2cf' };
  }
  if (forgeTier >= 3 && forgeBranch === 'tactical') {
    return { trim: '#f2c138', glow: '#75e8ff', accent: '#2472b8', paperEdge: '#eefaff' };
  }
  if (forgeTier >= 2 && forgeBranch === 'elemental') {
    return { trim: '#eb6c28', glow: '#ffd257', accent: '#b83228', paperEdge: '#fff5dc' };
  }
  if (forgeTier >= 2 && forgeBranch === 'tactical') {
    return { trim: '#d9b23b', glow: '#6cd9ff', accent: '#2f6ea6', paperEdge: '#f2f9ff' };
  }
  return { trim: '#c9973e', glow: '#fff1b8', accent: '#755029', paperEdge: '#fdf6e4' };
}

function drawWeaponArt(
  ctx: CanvasRenderingContext2D,
  kind: WeaponVisualKind,
  forgeTier: number,
  forgeBranch?: WeaponForgeBranch
): void {
  const pal = tierTrimPalette(forgeTier, forgeBranch);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  const ink = '#3b2110';

  const strokeAndFill = (fill: string, lw = 7) => {
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.strokeStyle = ink;
    ctx.lineWidth = lw;
    ctx.stroke();
  };

  switch (kind) {
    case 'duster': {
      // Luigi-style Poltergust Garden Vacuum Duster!
      // Brass flared suction nozzle on right
      ctx.beginPath();
      ctx.moveTo(148, 108);
      ctx.lineTo(222, 76);
      ctx.lineTo(232, 166);
      ctx.lineTo(148, 146);
      ctx.closePath();
      strokeAndFill(pal.trim, 7);

      // Suction swirl accent inside nozzle mouth
      ctx.strokeStyle = pal.glow;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(216, 122, 18, -1.1, 1.1);
      ctx.stroke();

      // Main teal-copper canister tank
      ctx.beginPath();
      ctx.roundRect(44, 88, 112, 74, 24);
      strokeAndFill(forgeBranch === 'elemental' && forgeTier >= 2 ? '#c94a36' : '#3d8f8a', 7);

      // Brass pressure bands
      ctx.fillStyle = pal.trim;
      ctx.fillRect(66, 90, 14, 70);
      ctx.fillRect(120, 90, 14, 70);
      ctx.strokeStyle = ink;
      ctx.lineWidth = 5;
      ctx.strokeRect(66, 90, 14, 70);
      ctx.strokeRect(120, 90, 14, 70);

      // Dial gauge on side
      ctx.beginPath();
      ctx.arc(100, 125, 16, 0, Math.PI * 2);
      strokeAndFill('#fff8e6', 5);
      ctx.strokeStyle = '#c93824';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(100, 125);
      ctx.lineTo(110, 114);
      ctx.stroke();

      // Top carry handle + trigger grip
      ctx.beginPath();
      ctx.roundRect(72, 64, 56, 22, 10);
      strokeAndFill('#8c5a30', 6);
      ctx.beginPath();
      ctx.roundRect(48, 158, 28, 42, 10);
      strokeAndFill('#704522', 6);
      break;
    }

    case 'hammer': {
      // Classic Paper Mario Giant Barrel Mallet!
      // Diagonal wooden handle
      ctx.save();
      ctx.translate(128, 132);
      ctx.rotate(-0.42);
      ctx.beginPath();
      ctx.roundRect(-14, -10, 28, 118, 12);
      strokeAndFill('#9c6633', 7);

      // Oversized barrel mallet head
      ctx.beginPath();
      ctx.roundRect(-64, -76, 128, 72, 22);
      strokeAndFill(forgeBranch === 'elemental' && forgeTier >= 2 ? '#b84228' : '#7a4926', 8);

      // Forged brass/iron endcaps
      ctx.beginPath();
      ctx.roundRect(-68, -72, 22, 64, 8);
      strokeAndFill(pal.trim, 6);
      ctx.beginPath();
      ctx.roundRect(46, -72, 22, 64, 8);
      strokeAndFill(pal.trim, 6);

      // Paper Mario Star emblem on center of hammer!
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
      strokeAndFill(pal.glow, 4.5);
      ctx.restore();
      break;
    }

    case 'boomerang': {
      // Swept Curving Leaf/Feather Boomerang!
      ctx.beginPath();
      ctx.moveTo(54, 62);
      ctx.quadraticCurveTo(188, 52, 212, 192);
      ctx.quadraticCurveTo(186, 206, 168, 186);
      ctx.quadraticCurveTo(148, 108, 60, 106);
      ctx.quadraticCurveTo(38, 86, 54, 62);
      ctx.closePath();
      strokeAndFill(forgeBranch === 'elemental' && forgeTier >= 2 ? '#d95826' : '#58a842', 7.5);

      // Bold craft stripes
      ctx.strokeStyle = pal.glow;
      ctx.lineWidth = 10;
      ctx.beginPath();
      ctx.moveTo(78, 84);
      ctx.quadraticCurveTo(156, 84, 184, 164);
      ctx.stroke();

      // Tip caps
      ctx.beginPath();
      ctx.arc(62, 84, 12, 0, Math.PI * 2);
      strokeAndFill(pal.trim, 5);
      ctx.beginPath();
      ctx.arc(190, 178, 12, 0, Math.PI * 2);
      strokeAndFill(pal.trim, 5);
      break;
    }

    case 'whip': {
      // Coiled Briar/Vine Grapple Hook!
      // Wooden handle
      ctx.beginPath();
      ctx.roundRect(36, 152, 34, 62, 12);
      strokeAndFill('#7d4b24', 7);

      // Coiled emerald vine rope
      ctx.strokeStyle = ink;
      ctx.lineWidth = 22;
      ctx.beginPath();
      ctx.moveTo(64, 160);
      ctx.bezierCurveTo(92, 66, 176, 190, 184, 96);
      ctx.stroke();
      ctx.strokeStyle = forgeBranch === 'elemental' && forgeTier >= 2 ? '#a83b75' : '#4fa33c';
      ctx.lineWidth = 12;
      ctx.stroke();

      // Curved brass grapple hook claw at tip
      ctx.beginPath();
      ctx.moveTo(184, 96);
      ctx.lineTo(206, 62);
      ctx.quadraticCurveTo(234, 64, 224, 98);
      ctx.lineTo(204, 88);
      ctx.lineTo(196, 108);
      ctx.closePath();
      strokeAndFill(pal.trim, 6);
      break;
    }

    case 'bellows': {
      // Scorching Brass & Leather Forge Bellows!
      ctx.beginPath();
      ctx.moveTo(154, 114);
      ctx.lineTo(232, 120);
      ctx.lineTo(232, 138);
      ctx.lineTo(154, 144);
      ctx.closePath();
      strokeAndFill(pal.trim, 6.5);

      // Accordion red-brown leather pouch
      ctx.beginPath();
      ctx.moveTo(46, 78);
      ctx.lineTo(160, 106);
      ctx.lineTo(160, 152);
      ctx.lineTo(46, 180);
      ctx.closePath();
      strokeAndFill('#c94326', 7);

      // Wooden paddles & brass rivets
      ctx.beginPath();
      ctx.roundRect(38, 66, 124, 26, 10);
      strokeAndFill('#855228', 6);
      ctx.beginPath();
      ctx.roundRect(38, 166, 124, 26, 10);
      strokeAndFill('#855228', 6);

      // Ember flame tongue peeking out nozzle
      ctx.beginPath();
      ctx.moveTo(222, 118);
      ctx.quadraticCurveTo(246, 129, 222, 144);
      ctx.closePath();
      strokeAndFill('#ffd845', 4);
      break;
    }

    case 'drone': {
      // Clockwork Popper Glider Sentry!
      // Little spinning propeller top
      ctx.beginPath();
      ctx.roundRect(74, 58, 108, 16, 8);
      strokeAndFill(pal.trim, 6);
      ctx.fillStyle = ink;
      ctx.fillRect(122, 72, 12, 22);

      // Round brass kettle-pod body
      ctx.beginPath();
      ctx.arc(128, 134, 48, 0, Math.PI * 2);
      strokeAndFill(forgeBranch === 'elemental' && forgeTier >= 2 ? '#e06324' : '#e0a938', 7);

      // Cute angry brass visor eyes on the drone!
      ctx.beginPath();
      ctx.roundRect(96, 114, 64, 28, 10);
      strokeAndFill('#362317', 5);
      ctx.fillStyle = pal.glow;
      ctx.beginPath();
      ctx.arc(114, 128, 8, 0, Math.PI * 2);
      ctx.arc(142, 128, 8, 0, Math.PI * 2);
      ctx.fill();
      break;
    }

    case 'lance': {
      // Swashbuckling Leaf Rapier!
      ctx.save();
      ctx.translate(128, 128);
      ctx.rotate(-0.55);
      // Tapered steel-silver blade
      ctx.beginPath();
      ctx.moveTo(-14, 18);
      ctx.lineTo(0, -108);
      ctx.lineTo(14, 18);
      ctx.closePath();
      strokeAndFill(forgeBranch === 'elemental' && forgeTier >= 2 ? '#ffba52' : '#d8e8f0', 6.5);
      // Leaf basket guard
      ctx.beginPath();
      ctx.ellipse(0, 26, 36, 18, 0, 0, Math.PI * 2);
      strokeAndFill(pal.trim, 6);
      // Hilt
      ctx.beginPath();
      ctx.roundRect(-10, 38, 20, 48, 8);
      strokeAndFill('#734220', 6);
      ctx.restore();
      break;
    }

    case 'sniper': {
      // Long-Barrel Pea Pod Sniper Rifle!
      ctx.beginPath();
      ctx.roundRect(30, 122, 76, 34, 12);
      strokeAndFill('#8c582b', 6.5);
      // Long green-brass barrel
      ctx.beginPath();
      ctx.roundRect(92, 112, 136, 26, 10);
      strokeAndFill(forgeBranch === 'elemental' && forgeTier >= 2 ? '#c44626' : '#4c943c', 7);
      // Flared muzzle tip
      ctx.beginPath();
      ctx.roundRect(216, 106, 20, 38, 6);
      strokeAndFill(pal.trim, 6);
      // Brass spyglass scope on top
      ctx.beginPath();
      ctx.roundRect(102, 82, 72, 22, 9);
      strokeAndFill(pal.trim, 6);
      ctx.beginPath();
      ctx.arc(168, 93, 8, 0, Math.PI * 2);
      strokeAndFill(pal.glow, 3.5);
      break;
    }

    case 'mortar': {
      // Stout Garden Mortar Cannon!
      ctx.save();
      ctx.translate(128, 136);
      ctx.rotate(-0.48);
      // Chunky riveted mortar barrel
      ctx.beginPath();
      ctx.roundRect(-36, -74, 72, 118, 18);
      strokeAndFill(forgeBranch === 'elemental' && forgeTier >= 2 ? '#a83c26' : '#586875', 7.5);
      // Brass rim collar
      ctx.beginPath();
      ctx.roundRect(-44, -80, 88, 24, 9);
      strokeAndFill(pal.trim, 6.5);
      // Glowing ordnance shell peeking out mouth
      ctx.beginPath();
      ctx.arc(0, -82, 24, Math.PI, 0);
      strokeAndFill(pal.glow, 5.5);
      // Wooden carriage wheel
      ctx.beginPath();
      ctx.arc(-20, 42, 26, 0, Math.PI * 2);
      strokeAndFill('#9c632e', 6.5);
      ctx.restore();
      break;
    }

    case 'scatter': {
      // Blunderbuss Seed Scattergun!
      ctx.beginPath();
      ctx.roundRect(36, 130, 68, 36, 14);
      strokeAndFill('#8a5228', 6.5);
      ctx.beginPath();
      ctx.moveTo(92, 114);
      ctx.lineTo(222, 88);
      ctx.lineTo(222, 166);
      ctx.lineTo(92, 152);
      ctx.closePath();
      strokeAndFill(pal.trim, 7);
      // Band
      ctx.fillStyle = '#c94030';
      ctx.fillRect(124, 108, 22, 46);
      ctx.strokeStyle = ink;
      ctx.lineWidth = 5;
      ctx.strokeRect(124, 108, 22, 46);
      break;
    }

    case 'bow': {
      // Storybook Longbow + Feathered Quill Arrow!
      ctx.strokeStyle = ink;
      ctx.lineWidth = 20;
      ctx.beginPath();
      ctx.arc(96, 128, 76, -1.25, 1.25);
      ctx.stroke();
      ctx.strokeStyle = '#9c632d';
      ctx.lineWidth = 11;
      ctx.stroke();

      // Bowstring
      ctx.strokeStyle = '#f2e8cf';
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(120, 56);
      ctx.lineTo(80, 128);
      ctx.lineTo(120, 200);
      ctx.stroke();

      // Nocked feathered arrow
      ctx.strokeStyle = ink;
      ctx.lineWidth = 12;
      ctx.beginPath();
      ctx.moveTo(76, 128);
      ctx.lineTo(212, 128);
      ctx.stroke();
      ctx.strokeStyle = pal.trim;
      ctx.lineWidth = 6;
      ctx.stroke();
      // Arrowhead
      ctx.beginPath();
      ctx.moveTo(202, 110);
      ctx.lineTo(234, 128);
      ctx.lineTo(202, 146);
      ctx.closePath();
      strokeAndFill(pal.glow, 5);
      break;
    }

    case 'hose': {
      // Pressurized Pond-Water Hose Blaster!
      ctx.strokeStyle = ink;
      ctx.lineWidth = 22;
      ctx.beginPath();
      ctx.moveTo(42, 184);
      ctx.quadraticCurveTo(54, 112, 116, 116);
      ctx.stroke();
      ctx.strokeStyle = '#2d8bb5';
      ctx.lineWidth = 13;
      ctx.stroke();
      // Brass spray gun nozzle
      ctx.beginPath();
      ctx.roundRect(108, 96, 86, 42, 12);
      strokeAndFill(pal.trim, 6.5);
      ctx.beginPath();
      ctx.moveTo(192, 102);
      ctx.lineTo(232, 92);
      ctx.lineTo(232, 142);
      ctx.lineTo(192, 132);
      ctx.closePath();
      strokeAndFill('#4ec8f0', 6);
      break;
    }

    case 'slingshot': {
      // Forked Oak Garden Slingshot!
      ctx.strokeStyle = ink;
      ctx.lineWidth = 26;
      ctx.beginPath();
      ctx.moveTo(128, 212);
      ctx.lineTo(128, 136);
      ctx.moveTo(128, 142);
      ctx.lineTo(76, 72);
      ctx.moveTo(128, 142);
      ctx.lineTo(180, 72);
      ctx.stroke();
      ctx.strokeStyle = '#945d2d';
      ctx.lineWidth = 15;
      ctx.stroke();
      // Elastic band + pouch
      ctx.strokeStyle = '#d94538';
      ctx.lineWidth = 8;
      ctx.beginPath();
      ctx.moveTo(78, 78);
      ctx.lineTo(128, 104);
      ctx.lineTo(178, 78);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(128, 104, 16, 0, Math.PI * 2);
      strokeAndFill(pal.glow, 5);
      break;
    }

    case 'blaster':
    default: {
      // Chunky Cardboard Cartoon Carbine Blaster!
      ctx.beginPath();
      ctx.roundRect(42, 134, 48, 52, 12);
      strokeAndFill('#7a4b24', 6.5);
      ctx.beginPath();
      ctx.roundRect(56, 94, 148, 48, 18);
      strokeAndFill(forgeBranch === 'elemental' && forgeTier >= 2 ? '#cc4928' : '#4a8c4e', 7);
      ctx.beginPath();
      ctx.roundRect(198, 86, 30, 62, 10);
      strokeAndFill(pal.trim, 6.5);
      ctx.beginPath();
      ctx.arc(126, 118, 14, 0, Math.PI * 2);
      strokeAndFill(pal.glow, 4.5);
      break;
    }
  }

  // Forge Tier Masterwork Gem / Star Seal in upper-left corner!
  if (forgeTier >= 2) {
    ctx.beginPath();
    ctx.arc(54, 52, forgeTier >= 3 ? 22 : 17, 0, Math.PI * 2);
    strokeAndFill(pal.accent, 5);
    ctx.fillStyle = pal.glow;
    ctx.font = '900 22px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(forgeTier >= 3 ? '★' : '✦', 54, 53);
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

  // Paint authentic thick cream Paper Mario die-cut sticker border behind the weapon silhouette!
  const out = document.createElement('canvas');
  out.width = size;
  out.height = size;
  const ctx = out.getContext('2d')!;
  const pal = tierTrimPalette(forgeTier, forgeBranch);

  // Create tinted silhouette stamp for cream sticker backing
  const sil = document.createElement('canvas');
  sil.width = size;
  sil.height = size;
  const sctx = sil.getContext('2d')!;
  sctx.drawImage(art, 0, 0);
  sctx.globalCompositeOperation = 'source-in';
  sctx.fillStyle = pal.paperEdge;
  sctx.fillRect(0, 0, size, size);

  // Stamp ring around silhouette for crisp die-cut sticker border
  const borderR = 9;
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
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

/** Cached PNG data URL for displaying the EXACT same die-cut Paper Mario weapon prop in UI & 2D canvas! */
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
 * Builds a 3D double-sided Paper Mario cardboard weapon prop rig mounted directly on a hero standee!
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
  const size = 0.62;
  const planeGeo = new THREE.PlaneGeometry(size, size);

  const frontMat = new THREE.MeshStandardMaterial({
    map: pair.front,
    transparent: true,
    alphaTest: 0.25,
    roughness: 0.68,
    metalness: 0.08,
    side: THREE.FrontSide,
  });
  const backMat = new THREE.MeshStandardMaterial({
    map: pair.back,
    transparent: true,
    alphaTest: 0.25,
    roughness: 0.68,
    metalness: 0.08,
    side: THREE.FrontSide,
  });
  const coreMat = new THREE.MeshStandardMaterial({
    color: '#e5d4b0',
    map: pair.front,
    transparent: true,
    alphaTest: 0.35,
    roughness: 0.9,
    side: THREE.DoubleSide,
  });

  const frontMesh = new THREE.Mesh(planeGeo, frontMat);
  frontMesh.position.z = 0.016;
  frontMesh.castShadow = true;

  const coreMesh = new THREE.Mesh(planeGeo, coreMat);
  coreMesh.position.z = 0;

  const backMesh = new THREE.Mesh(planeGeo, backMat);
  backMesh.position.z = -0.016;
  backMesh.rotation.y = Math.PI;
  backMesh.castShadow = true;

  // Forge Tier 2/3 subtle glowing craft halo behind masterwork weapons!
  const auraGeo = new THREE.RingGeometry(0.18, 0.29, 18);
  const auraMat = new THREE.MeshBasicMaterial({
    color: '#ffd845',
    transparent: true,
    opacity: 0.0,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const auraMesh = new THREE.Mesh(auraGeo, auraMat);
  auraMesh.position.z = -0.022;
  auraMesh.visible = initialTier >= 2;

  pivot.add(auraMesh, coreMesh, frontMesh, backMesh);

  let currentKey = makeCacheKey(initialKind, initialTier, initialBranch);

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
