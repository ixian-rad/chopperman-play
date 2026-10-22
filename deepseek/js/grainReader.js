/**
 * A small top-down "reader" for the end grain.
 *
 * The 3D guide is foreshortened from the low chase camera, so the shape of the
 * grain, the marked Precision Six shot and the orange hazard rings are hard to
 * read before a swing. This canvas is a 2D diagram of exactly the same data:
 * growth rings, piths, knots, steel/stone, the nearest check, the loose ring arc,
 * the seated wedges, the aim crosshair and the blade angle.
 */

const TAU = Math.PI * 2;
const INK = 'rgba(241, 236, 223, 0.9)';
const FAINT = 'rgba(241, 236, 223, 0.22)';
const GOLD = '#ffd27a';
const MINT = '#bdeee0';
const ORANGE = '#ff8a2f';

export class GrainReader {
  constructor(canvas) {
    this.canvas = canvas || null;
    this.ctx = this.canvas?.getContext?.('2d') || null;
    this.lastDraw = -Infinity;
    this.enabled = Boolean(this.ctx);
    if (this.canvas) {
      this.size = this.canvas.width || 160;
    } else {
      this.size = 160;
    }
  }

  update(state = {}, { force = false } = {}) {
    if (!this.enabled) return;
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (!force && now - this.lastDraw < 90) return;
    this.lastDraw = now;
    this.draw(state);
  }

  draw(state) {
    const ctx = this.ctx;
    const canvas = this.canvas;
    if (!ctx || !canvas) return;
    const size = this.size;
    const cx = size / 2;
    const cy = size / 2;
    const debris = state.debris;
    const radius = Math.max(0.04, debris?.radius || 0.2);
    const scale = (size / 2 - 15) / radius;
    const px = (x) => cx + (Number(x) || 0) * scale;
    const py = (z) => cy + (Number(z) || 0) * scale;

    ctx.clearRect(0, 0, size, size);
    // Dark end grain disc.
    ctx.beginPath();
    ctx.arc(cx, cy, radius * scale + 5, 0, TAU);
    ctx.fillStyle = '#17180f';
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(224, 164, 88, 0.55)';
    ctx.stroke();

    if (!debris) {
      ctx.fillStyle = FAINT;
      ctx.font = '8px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('NO ROUND', cx, cy + 3);
      return;
    }

    // Growth rings.
    for (let i = 1; i <= 6; i += 1) {
      ctx.beginPath();
      ctx.arc(cx, cy, (radius * scale * i) / 6.4, 0, TAU);
      ctx.strokeStyle = i % 2 ? 'rgba(206, 174, 120, 0.22)' : 'rgba(206, 174, 120, 0.12)';
      ctx.stroke();
    }

    // Loose ring arc: the pale target on a ring-shaken round.
    if (debris.log?.ringShake && !debris.ringShakeLoose) {
      const angle = debris.ringShakeAngle ?? 0;
      const half = Math.max(0.25, debris.ringArcHalfWidth || 0.45);
      ctx.beginPath();
      ctx.arc(cx, cy, radius * scale * 0.88, angle - half, angle + half);
      ctx.lineWidth = 5;
      ctx.strokeStyle = 'rgba(189, 238, 224, 0.68)';
      ctx.stroke();
      ctx.lineWidth = 1;
    }

    // Nearest natural check: a radial gold line through the pith.
    if (Number.isFinite(debris.masterSeam)) {
      ctx.beginPath();
      ctx.moveTo(cx - Math.cos(debris.masterSeam) * radius * scale, cy - Math.sin(debris.masterSeam) * radius * scale);
      ctx.lineTo(cx + Math.cos(debris.masterSeam) * radius * scale, cy + Math.sin(debris.masterSeam) * radius * scale);
      ctx.strokeStyle = 'rgba(255, 210, 122, 0.6)';
      ctx.setLineDash([3, 3]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Piths / twin piths.
    ctx.fillStyle = 'rgba(236, 218, 170, 0.95)';
    for (const pith of debris.piths || [{ x: 0, z: 0 }]) {
      ctx.beginPath();
      ctx.arc(px(pith.x), py(pith.z), 2.1, 0, TAU);
      ctx.fill();
    }

    // Knots: dark rings with a tight core.
    for (const knot of state.knots || []) {
      ctx.beginPath();
      ctx.arc(px(knot.x), py(knot.z), Math.max(2.5, (knot.radius || 0.03) * scale), 0, TAU);
      ctx.fillStyle = 'rgba(52, 32, 16, 0.95)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(170, 112, 64, 0.75)';
      ctx.stroke();
    }

    // Embedded steel / stone: orange hazard ring.
    for (const hazard of state.hazards || []) {
      const hx = px(hazard.x);
      const hy = py(hazard.z);
      ctx.beginPath();
      ctx.arc(hx, hy, Math.max(4, (hazard.radius || 0.015) * scale + 2.5), 0, TAU);
      ctx.fillStyle = 'rgba(255, 138, 47, 0.18)';
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = ORANGE;
      ctx.stroke();
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(hx, hy, 1.6, 0, TAU);
      ctx.fillStyle = ORANGE;
      ctx.fill();
    }

    // Seated wedges: small steel diamonds.
    for (const slot of debris.wedgeSlots || []) {
      const wx = px(slot.x);
      const wy = py(slot.z);
      ctx.beginPath();
      ctx.moveTo(wx, wy - 4);
      ctx.lineTo(wx + 3, wy);
      ctx.lineTo(wx, wy + 4);
      ctx.lineTo(wx - 3, wy);
      ctx.closePath();
      ctx.fillStyle = 'rgba(169, 198, 207, 0.9)';
      ctx.fill();
    }

    // Marked Precision Six target: mint grade radius and a crosshair dot.
    if (state.target) {
      ctx.beginPath();
      ctx.arc(px(state.target.x), py(state.target.z), 0.09 * scale, 0, TAU);
      ctx.strokeStyle = 'rgba(185, 227, 140, 0.75)';
      ctx.setLineDash([2, 2]);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(px(state.target.x), py(state.target.z), 1.8, 0, TAU);
      ctx.fillStyle = '#d9f5b5';
      ctx.fill();
    }

    // Aim crosshair + blade direction.
    if (state.aim) {
      const ax = px(state.aim.x);
      const ay = py(state.aim.z);
      ctx.beginPath();
      ctx.arc(ax, ay, 3.2, 0, TAU);
      ctx.strokeStyle = INK;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(ax - 6, ay);
      ctx.lineTo(ax - 3.5, ay);
      ctx.moveTo(ax + 3.5, ay);
      ctx.lineTo(ax + 6, ay);
      ctx.moveTo(ax, ay - 6);
      ctx.lineTo(ax, ay - 3.5);
      ctx.moveTo(ax, ay + 3.5);
      ctx.lineTo(ax, ay + 6);
      ctx.stroke();
      const bladeAngle = Math.atan2(state.aim.z, state.aim.x) + (state.bladeOffset || 0);
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(ax + Math.cos(bladeAngle) * radius * scale * 0.38, ay + Math.sin(bladeAngle) * radius * scale * 0.38);
      ctx.strokeStyle = 'rgba(244, 236, 211, 0.95)';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.lineWidth = 1;
    }

    // Small caption.
    ctx.fillStyle = 'rgba(241, 236, 223, 0.42)';
    ctx.font = '7px monospace';
    ctx.textAlign = 'left';
    ctx.fillText('END GRAIN', 6, size - 6);
  }
}
