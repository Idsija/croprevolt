import { GRAFT_REGISTRY } from '../data/grafts';
import type { BattleUnit, CoverObject } from '../engine/types';
import { roundRect } from './particles';

/**
 * Paper-Craft Sprite Registry:
 * Preloads all 20 hand-inked watercolor die-cut PNG sprites:
 * - 6 Produce heroes + 4 Barnyard Animal allies (pig, rooster, sheep, goat)
 * - 5 Farmer/Contraption/Boss enemies + 5 Isometric Cover props
 */
const PNG_SPRITE_KEYS = [
  'potato',
  'pea',
  'lemon',
  'chili',
  'carrot',
  'blackberry',
  'pig',
  'rooster',
  'sheep',
  'goat',
  'digger',
  'digger_heavy',
  'trimmer',
  'sprayer',
  'mower',
  'scarecrow',
  'crate',
  'haystack',
  'stone',
  'thorns',
  'cage',
] as const;

const SPRITE_MAP = new Map<string, HTMLImageElement>();
let spritesPreloaded = false;

export function preloadPaperCraftSprites(): void {
  if (spritesPreloaded || typeof Image === 'undefined') return;
  spritesPreloaded = true;
  for (const key of PNG_SPRITE_KEYS) {
    if (SPRITE_MAP.has(key)) continue;
    const img = new Image();
    img.src = `/sprites/${key}.png`;
    SPRITE_MAP.set(key, img);
  }
}

export function registerCustomSprite(visualKind: string, img: HTMLImageElement): void {
  SPRITE_MAP.set(visualKind, img);
}

export function getSpriteUrl(visualKind: string): string {
  return `/sprites/${visualKind}.png`;
}

function getReadySprite(key: string): HTMLImageElement | null {
  preloadPaperCraftSprites();
  const img = SPRITE_MAP.get(key);
  if (img && img.complete && img.naturalWidth > 0) return img;
  return null;
}

const INK = '#452a16';
const PAPER_RIM = '#fbf3df';

const UNIT_HEIGHTS: Record<string, number> = {
  potato: 68,
  pea: 76,
  lemon: 64,
  chili: 66,
  carrot: 76,
  blackberry: 68,
  pig: 70,
  rooster: 80,
  sheep: 76,
  goat: 80,
  digger: 94,
  digger_heavy: 88,
  trimmer: 98,
  sprayer: 88,
  mower: 72,
  scarecrow: 118,
};

const SPRITE_DEFAULT_FACING: Record<string, 'left' | 'right'> = {
  potato: 'right',
  pea: 'right',
  lemon: 'right',
  chili: 'right',
  carrot: 'right',
  blackberry: 'right',
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
};

function drawSoftGroundShadow(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  rx: number,
  ry: number,
  rotation = -0.22
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rotation);
  ctx.fillStyle = 'rgba(42, 22, 8, 0.13)';
  ctx.beginPath();
  ctx.ellipse(0, 0, rx * 1.24, ry * 1.24, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(42, 22, 8, 0.22)';
  ctx.beginPath();
  ctx.ellipse(0, 0, rx * 0.86, ry * 0.86, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

export function drawUnitStandee(
  ctx: CanvasRenderingContext2D,
  unit: BattleUnit,
  screenX: number,
  screenY: number,
  scale: number,
  time: number,
  opts: {
    isSelected?: boolean;
    isInspectedEnemy?: boolean;
    isDone?: boolean;
    isDashTarget?: boolean;
    isAttackTarget?: boolean;
    hitFlash?: number;
    jumpHeight?: number;
  } = {}
): void {
  const s = scale;
  const activeLift = opts.isSelected ? 1.07 : 1;
  const bob =
    Math.sin(time * (opts.isSelected ? 4.2 : 2.8) + unit.pos.x * 1.7 + unit.pos.y) *
    (opts.isSelected ? 2.1 : 1.2) *
    s;
  const jumpLift = (opts.jumpHeight ?? 0) * s;

  ctx.save();
  ctx.translate(screenX, screenY);

  const shadowShrink = Math.max(0.42, 1 - jumpLift / 135);
  drawSoftGroundShadow(
    ctx,
    -6 * s * shadowShrink,
    3 * s,
    (unit.isBoss ? 28 : unit.isAnimal ? 25 : 20) * s * shadowShrink,
    (unit.isBoss ? 11.5 : unit.isAnimal ? 10 : 8.5) * s * shadowShrink
  );

  if (jumpLift < 4) {
    ctx.fillStyle = 'rgba(54, 30, 12, 0.42)';
    ctx.beginPath();
    ctx.ellipse(0, 4 * s, (unit.isAnimal ? 15 : 12) * s, 3.2 * s, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // Unmistakable sunlit pedestal spotlight for active hero!
  if (opts.isSelected) {
    const pulse = 1 + Math.sin(time * 5.2) * 0.055;
    const glow = ctx.createRadialGradient(0, 2 * s, 3 * s, 0, 2 * s, 34 * s * pulse);
    glow.addColorStop(0, 'rgba(255, 245, 166, 0.72)');
    glow.addColorStop(0.65, 'rgba(246, 200, 68, 0.34)');
    glow.addColorStop(1, 'rgba(246, 200, 68, 0)');
    ctx.save();
    ctx.scale(1, 0.52);
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(0, 4 * s, 36 * s * pulse, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Crisp outer paper-cream + inner golden-ink die-cut ring
    ctx.strokeStyle = INK;
    ctx.lineWidth = 5.4 * s;
    ctx.beginPath();
    ctx.ellipse(0, 2 * s, 26.5 * s * pulse, 13.5 * s * pulse, 0, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = '#fff9d6';
    ctx.lineWidth = 3.2 * s;
    ctx.stroke();

    ctx.save();
    ctx.strokeStyle = '#f2b824';
    ctx.lineWidth = 1.8 * s;
    ctx.setLineDash([5 * s, 4 * s]);
    ctx.lineDashOffset = -time * 18 * s;
    ctx.beginPath();
    ctx.ellipse(0, 2 * s, 31.5 * s, 16 * s, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  } else if (opts.isInspectedEnemy) {
    const pulse = 1 + Math.sin(time * 6.5) * 0.06;
    ctx.strokeStyle = 'rgba(229, 62, 48, 0.38)';
    ctx.lineWidth = 8.5 * s;
    ctx.beginPath();
    ctx.ellipse(0, 2 * s, 26 * s * pulse, 13.5 * s * pulse, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = '#fff2ee';
    ctx.lineWidth = 3.6 * s;
    ctx.stroke();
    ctx.strokeStyle = '#e53e30';
    ctx.lineWidth = 2.2 * s;
    ctx.stroke();
  }

  // Show Dash and/or Attack target rings cleanly (even simultaneously!)
  if (!opts.isSelected && opts.isDashTarget) {
    const pulse = 1 + Math.sin(time * 7) * 0.08;
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 123, 41, 0.38)';
    ctx.lineWidth = 7 * s;
    ctx.beginPath();
    ctx.ellipse(0, 2 * s, 27 * s * pulse, 13.8 * s * pulse, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = '#ff7b29';
    ctx.lineWidth = 3 * s;
    ctx.setLineDash([6 * s, 4 * s]);
    ctx.stroke();
    ctx.restore();
  }
  if (!opts.isSelected && opts.isAttackTarget) {
    const pulse = 1 + Math.sin(time * 6) * 0.05;
    ctx.strokeStyle = 'rgba(255, 240, 232, 0.88)';
    ctx.lineWidth = 4.6 * s;
    ctx.beginPath();
    ctx.ellipse(0, 2 * s, 22.5 * s * pulse, 11.4 * s * pulse, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = '#e53e30';
    ctx.lineWidth = 2.6 * s;
    ctx.stroke();
  }

  const targetH = (UNIT_HEIGHTS[unit.visualKind] ?? 72) * s * activeLift;
  const img = getReadySprite(unit.visualKind);
  const defaultFace = SPRITE_DEFAULT_FACING[unit.visualKind] ?? 'right';
  const shouldFlip = unit.facing !== defaultFace;

  ctx.save();
  ctx.translate(0, -jumpLift + bob);
  if (opts.isDone && !opts.isSelected) {
    ctx.globalAlpha = 0.72;
  }

  if (img) {
    const aspect = img.naturalWidth / img.naturalHeight;
    const drawH = targetH;
    const drawW = drawH * aspect;

    ctx.save();
    if (shouldFlip) ctx.scale(-1, 1);
    ctx.drawImage(img, -drawW / 2, -drawH + 6 * s, drawW, drawH);

    if (opts.hitFlash && opts.hitFlash > 0) {
      ctx.globalCompositeOperation = 'source-atop';
      ctx.fillStyle = `rgba(255, 255, 255, ${Math.min(0.75, opts.hitFlash)})`;
      ctx.fillRect(-drawW / 2, -drawH + 6 * s, drawW, drawH);
    }
    ctx.restore();
  } else {
    ctx.fillStyle = PAPER_RIM;
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2 * s;
    ctx.beginPath();
    ctx.ellipse(0, -targetH * 0.45, 20 * s, targetH * 0.45, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  ctx.globalAlpha = 1;

  // Living Wool Half-Cover badge on Woolly Bulwark!
  if (unit.livingHalfCover) {
    drawPaperShieldBadge(ctx, 26 * s, -22 * s, 'half', s * 0.8);
  }

  // Done check seal near base for spent player heroes
  if (opts.isDone) {
    const cx = 19 * s;
    const cy = -4 * s;
    ctx.fillStyle = PAPER_RIM;
    ctx.strokeStyle = INK;
    ctx.lineWidth = 1.6 * s;
    ctx.beginPath();
    ctx.arc(cx, cy, 8.5 * s, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#5bb847';
    ctx.beginPath();
    ctx.arc(cx, cy, 6.4 * s, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = '#fffdf5';
    ctx.lineWidth = 2.1 * s;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(cx - 3.2 * s, cy + 0.3 * s);
    ctx.lineTo(cx - 0.8 * s, cy + 2.8 * s);
    ctx.lineTo(cx + 3.6 * s, cy - 2.6 * s);
    ctx.stroke();
  }

  if (unit.team === 'player' && unit.tier === 'heirloom') {
    ctx.save();
    ctx.translate(0, -targetH + 4 * s);
    ctx.scale(s, s);
    ctx.fillStyle = '#f6c945';
    ctx.strokeStyle = INK;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(-8, 4);
    ctx.lineTo(-9, -4);
    ctx.lineTo(-3, 0);
    ctx.lineTo(0, -6);
    ctx.lineTo(3, 0);
    ctx.lineTo(9, -4);
    ctx.lineTo(8, 4);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  if (unit.graftIds.length > 0) {
    unit.graftIds.slice(0, 3).forEach((gid, idx) => {
      const g = GRAFT_REGISTRY[gid];
      if (!g) return;
      const gx = (unit.isAnimal ? 25 : 20) * s;
      const gy = -targetH * 0.56 + idx * 12 * s;
      ctx.fillStyle = PAPER_RIM;
      ctx.strokeStyle = INK;
      ctx.lineWidth = 1.4 * s;
      ctx.beginPath();
      ctx.arc(gx, gy, 6 * s, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = g.badgeColor;
      ctx.beginPath();
      ctx.arc(gx, gy, 3.8 * s, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  const barY = -targetH - (unit.team === 'player' && unit.tier === 'heirloom' ? 14 : 6) * s;
  const barW = (unit.isBoss ? 54 : 38) * s;
  const barH = 6.5 * s;

  ctx.fillStyle = PAPER_RIM;
  ctx.strokeStyle = INK;
  ctx.lineWidth = 1.5 * s;
  roundRect(ctx, -barW / 2 - 2 * s, barY - 2 * s, barW + 4 * s, barH + 4 * s, 4 * s);
  ctx.fill();
  ctx.stroke();

  const hpRatio = Math.max(0, Math.min(1, unit.hp / unit.maxHp));
  ctx.fillStyle = '#ddd0b6';
  roundRect(ctx, -barW / 2, barY, barW, barH, 2.5 * s);
  ctx.fill();

  ctx.fillStyle = unit.team === 'player' ? '#5cb848' : unit.isBoss ? '#de6e24' : '#d9483b';
  if (hpRatio > 0) {
    roundRect(ctx, -barW / 2, barY, Math.max(3 * s, barW * hpRatio), barH, 2.5 * s);
    ctx.fill();
  }

  // Die-cut bouncing paper pointer chevron above active hero or inspected enemy!
  if (opts.isSelected || opts.isInspectedEnemy) {
    const arrowBounce = Math.abs(Math.sin(time * 5.2)) * 5.5 * s;
    const ay = barY - 12 * s - arrowBounce;
    const fill = opts.isSelected ? '#f8cc3d' : '#e54537';
    ctx.save();
    ctx.translate(0, ay);

    // Paper-cream die-cut outer silhouette
    ctx.fillStyle = PAPER_RIM;
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2.1 * s;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(0, 9.5 * s);
    ctx.lineTo(-10.5 * s, -6.5 * s);
    ctx.lineTo(10.5 * s, -6.5 * s);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Inner painted chevron
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.moveTo(0, 5.5 * s);
    ctx.lineTo(-6.6 * s, -4.2 * s);
    ctx.lineTo(6.6 * s, -4.2 * s);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  if (unit.team === 'player') {
    const pips = [
      { active: !unit.actions.hasMoved, color: '#45b6db' },
      { active: !unit.actions.hasAttacked, color: '#e55342' },
      { active: !unit.actions.hasUsedSkill, color: '#9b5de5' },
    ];
    pips.forEach((pip, idx) => {
      const px = (-9 + idx * 9) * s;
      const py = barY + barH + 5.5 * s;
      ctx.fillStyle = pip.active ? pip.color : '#cfc1a6';
      ctx.strokeStyle = INK;
      ctx.lineWidth = 1.2 * s;
      ctx.beginPath();
      ctx.arc(px, py, 2.8 * s, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    });
  }

  if (unit.statuses.length > 0) {
    const statusMap: Record<string, { icon: string; bg: string }> = {
      burn: { icon: '🔥', bg: '#ff7043' },
      rooted: { icon: '🌿', bg: '#558b2f' },
      acid: { icon: '🧪', bg: '#cddc39' },
      shield: { icon: '🛡️', bg: '#42a5f5' },
      boosted: { icon: '⚡', bg: '#ffca28' },
      feared: { icon: '😱', bg: '#ab47bc' },
    };
    unit.statuses.slice(0, 2).forEach((st, idx) => {
      const info = statusMap[st.kind];
      if (!info) return;
      const sx = -barW / 2 - 11 * s - idx * 14 * s;
      const sy = barY + 3 * s;
      ctx.fillStyle = info.bg;
      ctx.strokeStyle = INK;
      ctx.lineWidth = 1.2 * s;
      ctx.beginPath();
      ctx.arc(sx, sy, 6.2 * s, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.font = `${Math.round(9 * s)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(info.icon, sx, sy + 0.5 * s);
    });
  }

  ctx.restore();
  ctx.restore();
}

export function drawCoverObject(
  ctx: CanvasRenderingContext2D,
  cover: CoverObject,
  cx: number,
  cy: number,
  tileW: number,
  tileH: number,
  scale: number,
  time: number,
  isTargetable = false
): void {
  ctx.save();
  ctx.translate(cx, cy);

  if (isTargetable) {
    ctx.strokeStyle = '#ff6b35';
    ctx.lineWidth = 2.8 * scale;
    ctx.beginPath();
    ctx.ellipse(0, 2 * scale, tileW * 0.42, tileH * 0.4, 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  drawSoftGroundShadow(
    ctx,
    -5 * scale,
    5 * scale,
    tileW * (cover.kind === 'haystack' ? 0.42 : 0.38),
    tileH * 0.39,
    -0.14
  );

  const img = getReadySprite(cover.kind);
  let topY = -44 * scale;

  if (img) {
    const aspect = img.naturalWidth / img.naturalHeight;
    let drawW = tileW * 0.88;
    let drawH = drawW / aspect;
    let anchorY = tileH * 0.36;

    if (cover.kind === 'crate' || cover.kind === 'cage') {
      drawW = tileW * 0.92;
      drawH = drawW / aspect;
      anchorY = tileH * 0.46;
    } else if (cover.kind === 'haystack') {
      drawH = 92 * scale;
      drawW = drawH * aspect;
      anchorY = tileH * 0.24;
    } else if (cover.kind === 'stone') {
      drawW = tileW * 0.72;
      drawH = drawW / aspect;
      anchorY = tileH * 0.42;
    } else if (cover.kind === 'thorns') {
      drawW = tileW * 0.84;
      drawH = drawW / aspect;
      anchorY = tileH * 0.28;
    }

    ctx.drawImage(img, -drawW / 2, -drawH + anchorY, drawW, drawH);
    topY = -drawH + anchorY;
  } else {
    ctx.fillStyle = '#c89457';
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2 * scale;
    roundRect(ctx, -20 * scale, -32 * scale, 40 * scale, 34 * scale, 5 * scale);
    ctx.fill();
    ctx.stroke();
  }

  if (cover.kind === 'cage') {
    ctx.save();
    ctx.translate(0, topY - 12 * scale + Math.sin(time * 4) * 2.5 * scale);
    ctx.fillStyle = '#f6d55c';
    ctx.strokeStyle = INK;
    ctx.lineWidth = 1.8 * scale;
    roundRect(ctx, -30 * scale, -10 * scale, 60 * scale, 20 * scale, 7 * scale);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = INK;
    ctx.font = `700 ${Math.round(10.5 * scale)}px "Fredoka", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('RESCUE!', 0, 1 * scale);
    ctx.restore();
  }

  if (cover.destructible && cover.hp < cover.maxHp) {
    const ratio = Math.max(0, cover.hp / cover.maxHp);
    const barY = topY - 10 * scale;
    ctx.fillStyle = PAPER_RIM;
    ctx.strokeStyle = INK;
    ctx.lineWidth = 1.4 * scale;
    roundRect(ctx, -16 * scale, barY, 32 * scale, 6 * scale, 3 * scale);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#e07a32';
    roundRect(ctx, -15 * scale, barY + 1 * scale, 30 * scale * ratio, 4 * scale, 2 * scale);
    ctx.fill();
  }

  ctx.restore();
}

export function drawPaperShieldBadge(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  level: 'half' | 'full',
  scale: number,
  highlight = false
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);

  ctx.fillStyle = 'rgba(42, 22, 8, 0.24)';
  ctx.save();
  ctx.translate(1.8, 2.6);
  drawShieldPath(ctx, 13.5);
  ctx.fill();
  ctx.restore();

  ctx.fillStyle = highlight ? '#fff7cf' : PAPER_RIM;
  ctx.strokeStyle = highlight ? '#d97706' : '#c9b48f';
  ctx.lineWidth = highlight ? 2.4 : 1.6;
  drawShieldPath(ctx, 13.5);
  ctx.fill();
  ctx.stroke();

  ctx.save();
  drawShieldPath(ctx, 9.6);
  ctx.clip();
  if (level === 'full') {
    ctx.fillStyle = '#6f8ea8';
    ctx.fillRect(-11, -13, 22, 26);
    ctx.fillStyle = 'rgba(255, 250, 236, 0.25)';
    ctx.fillRect(-11, -13, 11, 26);
  } else {
    ctx.fillStyle = '#f7efe0';
    ctx.fillRect(-11, -13, 11, 26);
    ctx.fillStyle = '#7e5c3e';
    ctx.fillRect(0, -13, 11, 26);
  }
  ctx.restore();

  ctx.strokeStyle = INK;
  ctx.lineWidth = 1.6;
  drawShieldPath(ctx, 9.6);
  ctx.stroke();
  ctx.restore();
}

function drawShieldPath(ctx: CanvasRenderingContext2D, r: number): void {
  ctx.beginPath();
  ctx.moveTo(0, -r);
  ctx.lineTo(r * 0.86, -r * 0.68);
  ctx.lineTo(r * 0.8, r * 0.12);
  ctx.quadraticCurveTo(r * 0.54, r * 0.84, 0, r * 1.06);
  ctx.quadraticCurveTo(-r * 0.54, r * 0.84, -r * 0.8, r * 0.12);
  ctx.lineTo(-r * 0.86, -r * 0.68);
  ctx.closePath();
}
