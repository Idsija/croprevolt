export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
  outline?: string;
  life: number;
  maxLife: number;
  gravity: number;
  rotation: number;
  vRot: number;
  shape: 'rect' | 'circle' | 'star';
}

export interface FloatingPopup {
  x: number;
  y: number;
  text: string;
  color: string;
  bgColor: string;
  life: number;
  maxLife: number;
  scale: number;
}

export class ParticleSystem {
  public particles: Particle[] = [];
  public popups: FloatingPopup[] = [];

  public spawnBurst(
    x: number,
    y: number,
    colors: string[],
    count = 14,
    shape: Particle['shape'] = 'rect'
  ): void {
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.5;
      const speed = 55 + Math.random() * 115;
      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 65,
        size: 4 + Math.random() * 5,
        color: colors[i % colors.length],
        outline: '#4a2e19',
        life: 0.45 + Math.random() * 0.35,
        maxLife: 0.8,
        gravity: 270,
        rotation: Math.random() * Math.PI * 2,
        vRot: (Math.random() - 0.5) * 10,
        shape,
      });
    }
  }

  public spawnPopup(
    x: number,
    y: number,
    text: string,
    color = '#4a2e19',
    bgColor = '#fbf4e2',
    scale = 1
  ): void {
    this.popups.push({
      x,
      y,
      text,
      color,
      bgColor,
      life: 1.05,
      maxLife: 1.05,
      scale,
    });
  }

  public update(dt: number): void {
    for (const p of this.particles) {
      p.life -= dt;
      p.vy += p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rotation += p.vRot * dt;
    }
    this.particles = this.particles.filter((p) => p.life > 0);

    for (const pop of this.popups) {
      pop.life -= dt;
      pop.y -= 28 * dt;
    }
    this.popups = this.popups.filter((p) => p.life > 0);
  }

  public render(ctx: CanvasRenderingContext2D): void {
    for (const p of this.particles) {
      const alpha = Math.max(0, Math.min(1, p.life / (p.maxLife * 0.45)));
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rotation);
      ctx.fillStyle = p.color;
      ctx.strokeStyle = p.outline ?? '#4a2e19';
      ctx.lineWidth = 1.4;

      if (p.shape === 'circle') {
        ctx.beginPath();
        ctx.arc(0, 0, p.size * 0.55, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      } else {
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.72);
        ctx.strokeRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.72);
      }
      ctx.restore();
    }

    // Die-cut paper badge floating popups!
    for (const pop of this.popups) {
      const t = 1 - pop.life / pop.maxLife;
      const alpha = pop.life < 0.25 ? pop.life / 0.25 : 1;
      const popBounce = t < 0.16 ? 0.65 + (t / 0.16) * 0.45 : 1;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(pop.x, pop.y);
      ctx.scale(popBounce * pop.scale, popBounce * pop.scale);

      ctx.font = '700 13px "Fredoka", "Trebuchet MS", sans-serif';
      const w = Math.max(32, ctx.measureText(pop.text).width + 16);
      const h = 22;

      // Soft desk lift shadow
      ctx.fillStyle = 'rgba(46, 24, 9, 0.26)';
      roundRect(ctx, -w / 2 - 2, -h / 2 + 2.5, w + 4, h + 4, 10);
      ctx.fill();

      // Matte cream cardstock die-cut outer rim matching standee silhouettes!
      ctx.fillStyle = '#f8f1dc';
      roundRect(ctx, -w / 2 - 3, -h / 2 - 3, w + 6, h + 6, 10);
      ctx.fill();

      // Hand-inked inner watercolor badge
      ctx.fillStyle = pop.bgColor;
      ctx.strokeStyle = '#4a2c17';
      ctx.lineWidth = 1.9;
      roundRect(ctx, -w / 2, -h / 2, w, h, 7.5);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = pop.color;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(pop.text, 0, 1);
      ctx.restore();
    }
  }
}

export function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}
