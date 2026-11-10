import { clamp, wrapAngle } from '../engine/rng';
import { los, T, TILE, tileAt } from '../world/city';
import type { Game } from './game';
import type { Vehicle } from './types';

/** Heat points needed for each level (0-5). */
export const HEAT_T = [0, 10, 30, 70, 130, 220];
export const HEAT_NAMES = ['', 'Patrol', 'Pursuit', 'Roadblocks', 'Tactical', 'Enforcers'];

export function heatLevel(points: number): number {
  let l = 0;
  for (let i = 1; i < HEAT_T.length; i++) if (points >= HEAT_T[i]) l = i;
  return l;
}

export function addHeat(g: Game, pts: number) {
  const h = g.heat;
  h.points = Math.min(260, h.points + pts);
  h.level = heatLevel(h.points);
  h.unseenT = 0;
}

export function clearHeat(g: Game) {
  g.heat.points = 0;
  g.heat.level = 0;
  g.heat.unseenT = 0;
}

const FOOT_MAX = 10;

export function updateHeat(g: Game, dt: number) {
  const h = g.heat;
  const pl = g.player;
  if (h.level === 0) {
    h.points = Math.max(0, h.points - dt * 0.4);
    return;
  }
  if (g.respawnT > 0) return;
  let seen = false;
  let cars = 0;
  let foot = 0;
  for (const v of g.vehicles) {
    if (!v.cop || v.wreck || v.remove) continue;
    cars++;
    if (!seen && Math.hypot(v.x - pl.x, v.y - pl.y) < 50 && los(g.city, v.x, v.y, pl.x, pl.y)) seen = true;
  }
  for (const p of g.peds) {
    if (p.kind !== 'cop' || p.state === 'dead') continue;
    foot++;
    if (!seen && Math.hypot(p.x - pl.x, p.y - pl.y) < 40 && los(g.city, p.x, p.y, pl.x, pl.y)) seen = true;
  }
  if (seen) h.unseenT = 0;
  else h.unseenT += dt;
  if (h.unseenT > 8 + h.level * 1.5) {
    h.points = h.level > 1 ? HEAT_T[h.level - 1] : 0;
    h.level = heatLevel(h.points);
    h.unseenT = 0;
    if (h.level === 0) g.emit('banner', 0, 0, 0, 0, 'HEAT LOST', 'They have stopped looking', '#35e0ff');
  }
  h.spawnT -= dt;
  if (h.level > 0 && cars + foot / 2 < h.level && h.spawnT <= 0) {
    h.spawnT = 2.2;
    spawnCopCar(g);
  }
  if (h.level >= 3) {
    h.blockT -= dt;
    if (h.blockT <= 0) {
      h.blockT = 14;
      spawnRoadblock(g);
    }
  }
  void foot;
}

function unitFor(level: number): [string, string] {
  return level >= 5 ? ['warden', 'shotgun'] : level >= 4 ? ['bulwark', 'smg'] : ['patrol', 'pistol'];
}

function spawnCopCar(g: Game) {
  const city = g.city;
  for (let tries = 0; tries < 12; tries++) {
    const ang = g.rng.next() * Math.PI * 2;
    const d = g.viewRadius + 8 + g.rng.next() * 25;
    const tx = Math.floor((g.player.x + Math.cos(ang) * d) / TILE);
    const ty = Math.floor((g.player.y + Math.sin(ang) * d) / TILE);
    if (tileAt(city, tx, ty) !== T.Road) continue;
    if (g.field.dist[ty * city.w + tx] < 0) continue;
    const x = (tx + 0.5) * TILE;
    const y = (ty + 0.5) * TILE;
    let clear = true;
    for (const o of g.vehicles) if (Math.hypot(o.x - x, o.y - y) < 8) clear = false;
    if (!clear) continue;
    const [veh, weapon] = unitFor(g.heat.level);
    const v = g.spawnVehicle(veh, x, y, Math.atan2(g.player.y - y, g.player.x - x), 'cop');
    v.cop = { stuckT: 0, reverseT: 0, revSteer: 0, weapon };
    v.siren = true;
    return;
  }
}

function spawnRoadblock(g: Game) {
  const pv = g.pv;
  if (!pv) return;
  const sp = Math.hypot(pv.vx, pv.vy);
  if (sp < 8) return;
  const city = g.city;
  const bx = pv.x + (pv.vx / sp) * (g.viewRadius + 25);
  const by = pv.y + (pv.vy / sp) * (g.viewRadius + 25);
  const cx = Math.floor(bx / TILE);
  const cy = Math.floor(by / TILE);
  for (let r = 0; r <= 3; r++)
    for (let oy = -r; oy <= r; oy++)
      for (let ox = -r; ox <= r; ox++) {
        const tx = cx + ox;
        const ty = cy + oy;
        if (tileAt(city, tx, ty) !== T.Road) continue;
        const vi = city.vIdx[tx];
        const hi = city.hIdx[ty];
        if (vi >= 0 === hi >= 0) continue;
        for (let k = 0; k < 2; k++) {
          const x = vi >= 0 ? (city.vRoads[vi] + 0.5 + k) * TILE : (tx + 0.5) * TILE;
          const y = vi >= 0 ? (ty + 0.5) * TILE : (city.hRoads[hi] + 0.5 + k) * TILE;
          const v = g.spawnVehicle('patrol', x, y, vi >= 0 ? 0 : Math.PI / 2, 'none');
          v.siren = true;
          v.parked = true;
          const c = g.spawnPed('cop', x + (vi >= 0 ? 0 : 3), y + (vi >= 0 ? 3 : 0));
          c.state = 'attack';
          c.weapon = 'pistol';
        }
        return;
      }
}

/** Dismount the crew of a police vehicle as officers on foot. */
export function dismount(g: Game, v: Vehicle, weapon: string) {
  let foot = 0;
  for (const p of g.peds) if (p.kind === 'cop' && p.state !== 'dead') foot++;
  const n = Math.min(v.def.seats, FOOT_MAX - foot);
  const c = Math.cos(v.a);
  const s = Math.sin(v.a);
  for (let i = 0; i < n; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    const along = (i >> 1) * 1.2 - 0.3;
    const off = v.def.wid / 2 + 0.7;
    const p = g.spawnPed('cop', v.x + c * along - s * off * side, v.y + s * along + c * off * side);
    p.state = 'attack';
    p.weapon = weapon;
    p.hp = weapon === 'pistol' ? 80 : 130;
  }
}

export function driveCop(g: Game, v: Vehicle, dt: number) {
  const c = v.cop!;
  const pl = g.player;
  const dx = pl.x - v.x;
  const dy = pl.y - v.y;
  const d = Math.hypot(dx, dy);
  const sp = Math.hypot(v.vx, v.vy);
  v.handbrake = false;
  if (g.heat.level === 0 || g.respawnT > 0) {
    v.throttle = 0;
    v.steer = 0;
    v.siren = false;
    v.handbrake = true;
    if (d > g.viewRadius + 5) v.remove = true;
    return;
  }
  v.siren = true;
  if (c.reverseT > 0) {
    c.reverseT -= dt;
    v.throttle = -1;
    v.steer = c.revSteer;
    return;
  }
  // Close enough to a stopped or walking suspect: get out and make the arrest.
  const pSpeed = g.pv ? Math.hypot(g.pv.vx, g.pv.vy) : 0;
  if ((!g.pv && d < 13) || (g.pv && pSpeed < 2.5 && d < 8)) {
    if (sp < 4) {
      dismount(g, v, c.weapon);
      v.driver = 'none';
      v.cop = null;
      v.throttle = 0;
      return;
    }
    v.throttle = -1;
    v.steer = 0;
    return;
  }
  let ax = pl.x;
  let ay = pl.y;
  if (d < 32 && los(g.city, v.x, v.y, pl.x, pl.y)) {
    if (g.pv) {
      ax += g.pv.vx * 0.4;
      ay += g.pv.vy * 0.4;
    }
  } else {
    let tx = Math.floor(v.x / TILE);
    let ty = Math.floor(v.y / TILE);
    let ok = false;
    for (let k = 0; k < 3; k++) {
      const n = g.field.next(tx, ty);
      if (!n) break;
      tx = n[0];
      ty = n[1];
      ok = true;
    }
    if (ok) {
      ax = (tx + 0.5) * TILE;
      ay = (ty + 0.5) * TILE;
    }
  }
  const diff = wrapAngle(Math.atan2(ay - v.y, ax - v.x) - v.a);
  v.steer = clamp(diff * 2.5, -1, 1);
  const sharp = Math.abs(diff);
  v.throttle = sharp > 1.0 ? (sp > 9 ? -0.5 : 0.5) : 1;
  if (sharp > 1.3 && sp > 11) v.handbrake = true;
  if (sp < 0.8) {
    c.stuckT += dt;
    if (c.stuckT > 1.2) {
      c.stuckT = 0;
      c.reverseT = 1.1;
      c.revSteer = v.steer > 0 ? -1 : 1;
    }
  } else c.stuckT = 0;
}
