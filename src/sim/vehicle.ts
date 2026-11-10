import { isPolice, VehicleDef } from '../data/defs';
import { resolveCircle, T, tileAtW } from '../world/city';
import type { Game } from './game';
import type { Vehicle } from './types';

const offCache = new Map<string, number[]>();
/** Offsets along the car's length of the circles used as its collision hull. */
export function circleOffsets(def: VehicleDef): number[] {
  let o = offCache.get(def.id);
  if (!o) {
    const e = def.len / 2 - def.wid / 2;
    o = def.len > 6 ? [-e, -e / 2, 0, e / 2, e] : [-e, 0, e];
    offCache.set(def.id, o);
  }
  return o;
}

const tmp = { x: 0, y: 0 };

export function stepVehicle(g: Game, v: Vehicle, dt: number) {
  if (v.remove) return;
  const def = v.def;
  if (v.fireT > 0) {
    v.fireT -= dt;
    if (v.fireT <= 0) {
      v.wreck = true;
      v.wreckT = 25;
      v.siren = false;
      const byPlayer = g.time - v.byPlayerT < 8;
      if (g.pv === v) {
        g.pv = null;
        v.driver = 'none';
        g.damagePed(g.player, 999, false, v.x, v.y);
      }
      v.driver = 'none';
      v.ai = null;
      v.cop = null;
      g.explode(v.x, v.y, 6.5, 95, byPlayer);
      if (byPlayer) {
        g.kills.vehicles++;
        if (isPolice(def)) g.crime(25);
      }
    }
  }
  if (v.parked) {
    v.vx = v.vy = v.av = 0;
    v.skid = 0;
    return;
  }
  const c = Math.cos(v.a);
  const s = Math.sin(v.a);
  let vf = v.vx * c + v.vy * s;
  let vl = -v.vx * s + v.vy * c;
  let thr = v.throttle;
  let st = v.steer;
  let hb = v.handbrake;
  if (v.wreck || v.fireT > 0 || v.driver === 'none') {
    thr = 0;
    st = 0;
    hb = true;
  }
  const power = v.hp < def.hp * 0.3 ? 0.7 : 1;
  if (thr > 0) {
    if (vf < -0.5) vf += 18 * dt;
    else vf += def.accel * thr * power * dt * Math.max(0, 1 - vf / def.maxSpeed);
  } else if (thr < 0) {
    if (vf > 0.5) vf += 20 * thr * dt;
    else vf += def.accel * 0.7 * thr * dt * Math.max(0, 1 + vf / (def.maxSpeed * 0.4));
  } else vf -= Math.sign(vf) * Math.min(Math.abs(vf), 2.2 * dt);
  vf -= vf * 0.06 * dt;
  let grip = def.grip;
  if (hb) {
    vf -= Math.sign(vf) * Math.min(Math.abs(vf), 11 * dt);
    grip *= 0.22;
  }
  vl *= Math.exp(-grip * dt);
  v.skid = Math.abs(vl);
  v.vx = c * vf - s * vl;
  v.vy = s * vf + c * vl;
  const sf = Math.max(-1, Math.min(1, vf / 5));
  v.a += ((st * def.steer * sf) / (1 + Math.abs(vf) / 45)) * dt + v.av * dt;
  v.av *= Math.exp(-5 * dt);
  v.x += v.vx * dt;
  v.y += v.vy * dt;

  // Buildings.
  const c2 = Math.cos(v.a);
  const s2 = Math.sin(v.a);
  const r = def.wid / 2;
  for (const o of circleOffsets(def)) {
    tmp.x = v.x + c2 * o;
    tmp.y = v.y + s2 * o;
    const hit = resolveCircle(g.city, tmp, r);
    if (!hit) continue;
    v.x += hit.nx * hit.depth;
    v.y += hit.ny * hit.depth;
    const vn = v.vx * hit.nx + v.vy * hit.ny;
    if (vn < 0) {
      v.vx -= 1.25 * vn * hit.nx;
      v.vy -= 1.25 * vn * hit.ny;
      v.vx *= 0.985;
      v.vy *= 0.985;
      const imp = -vn;
      v.av += (c2 * o * hit.ny - s2 * o * hit.nx) * imp * 0.05;
      if (imp > 6) {
        g.damageVehicle(v, (imp - 6) * 1.6, false);
        g.emit('crash', tmp.x - hit.nx * r, tmp.y - hit.ny * r, 0, imp);
      }
    }
  }

  // Water.
  if (tileAtW(g.city, v.x, v.y) === T.Water) {
    g.emit('splash', v.x, v.y);
    v.remove = true;
    if (g.pv === v) {
      g.pv = null;
      g.playerDown('dead', 'Lost to the river');
    }
  }
}

/** Vehicle against vehicle: circle hulls, mass-weighted impulses and damage. */
export function collideVehicles(g: Game) {
  const vs = g.vehicles;
  for (let i = 0; i < vs.length; i++) {
    const a = vs[i];
    if (a.remove) continue;
    for (let j = i + 1; j < vs.length; j++) {
      const b = vs[j];
      if (b.remove) continue;
      const reach = (a.def.len + b.def.len) / 2;
      const ddx = a.x - b.x;
      const ddy = a.y - b.y;
      if (ddx * ddx + ddy * ddy > reach * reach) continue;
      if (a.parked && b.parked) continue;
      const ra = a.def.wid / 2;
      const rb = b.def.wid / 2;
      const ca = Math.cos(a.a);
      const sa = Math.sin(a.a);
      const cb = Math.cos(b.a);
      const sb = Math.sin(b.a);
      let best = 0;
      let nx = 0;
      let ny = 0;
      let oa = 0;
      let ob = 0;
      for (const fa of circleOffsets(a.def))
        for (const fb of circleOffsets(b.def)) {
          const dx = a.x + ca * fa - (b.x + cb * fb);
          const dy = a.y + sa * fa - (b.y + sb * fb);
          const d = Math.hypot(dx, dy);
          const pen = ra + rb - d;
          if (pen > best && d > 1e-6) {
            best = pen;
            nx = dx / d;
            ny = dy / d;
            oa = fa;
            ob = fb;
          }
        }
      if (best <= 0) continue;
      const heavy = (v: Vehicle) => v.def.mass * (v.wreck ? 2 : 1);
      const ima = 1 / heavy(a);
      const imb = 1 / heavy(b);
      const tot = ima + imb;
      a.x += nx * best * (ima / tot);
      a.y += ny * best * (ima / tot);
      b.x -= nx * best * (imb / tot);
      b.y -= ny * best * (imb / tot);
      const rv = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
      a.parked = false;
      b.parked = false;
      if (rv >= 0) continue;
      const jimp = (-1.3 * rv) / tot;
      a.vx += jimp * ima * nx;
      a.vy += jimp * ima * ny;
      b.vx -= jimp * imb * nx;
      b.vy -= jimp * imb * ny;
      a.av += (ca * oa * ny - sa * oa * nx) * jimp * ima * 0.06;
      b.av -= (cb * ob * ny - sb * ob * nx) * jimp * imb * 0.06;
      const imp = -rv;
      if (imp > 3) {
        const byPlayer = a === g.pv || b === g.pv;
        const base = Math.max(0, imp - 4) * 1.3;
        g.damageVehicle(a, base * Math.min(1.8, b.def.mass / a.def.mass), byPlayer && b === g.pv);
        g.damageVehicle(b, base * Math.min(1.8, a.def.mass / b.def.mass), byPlayer && a === g.pv);
        g.emit('crash', (a.x + b.x) / 2, (a.y + b.y) / 2, 0, imp);
      }
    }
  }
}
