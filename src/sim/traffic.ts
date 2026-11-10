import { TRAFFIC_POOL, VEHICLES } from '../data/defs';
import { clamp, hash2, wrapAngle } from '../engine/rng';
import { lightState, T, TILE, tileAt } from '../world/city';
import type { Game } from './game';
import type { Vehicle } from './types';

export const DX = [1, 0, -1, 0];
export const DY = [0, 1, 0, -1];
const TRAFFIC_MAX = 30;
const PARKED_MAX = 16;

/** Lane exit point (tile units) just outside an intersection for a heading. Right-hand traffic. */
function exitPoint(vx: number, hy: number, dir: number): [number, number] {
  if (dir === 0) return [vx + 2.5, hy + 1.5];
  if (dir === 1) return [vx + 0.5, hy + 2.5];
  if (dir === 2) return [vx - 0.5, hy + 0.5];
  return [vx + 1.5, hy - 0.5];
}

export function driveTraffic(g: Game, v: Vehicle, dt: number) {
  const ai = v.ai!;
  const city = g.city;
  const tx = Math.floor(v.x / TILE);
  const ty = Math.floor(v.y / TILE);
  const inB = tx >= 0 && ty >= 0 && tx < city.w && ty < city.h;
  const vi = inB ? city.vIdx[tx] : -1;
  const hi = inB ? city.hIdx[ty] : -1;
  const onRoad = tileAt(city, tx, ty) === T.Road;
  const fx = Math.cos(v.a);
  const fy = Math.sin(v.a);
  const sp = fx * v.vx + fy * v.vy;
  let desired = ai.cruise;
  const panic = ai.panicT > 0;
  if (panic) {
    ai.panicT -= dt;
    desired = 17;
  }
  let redStop = false;

  // Look for the next intersection ahead: decide the turn and respect the light.
  const inX = onRoad && vi >= 0 && hi >= 0;
  if (!inX && ai.turn < 0) {
    for (let n = 1; n <= 2; n++) {
      const ax = tx + DX[ai.dir] * n;
      const ay = ty + DY[ai.dir] * n;
      if (ax < 0 || ay < 0 || ax >= city.w || ay >= city.h) break;
      const avi = city.vIdx[ax];
      const ahi = city.hIdx[ay];
      if (avi < 0 || ahi < 0 || tileAt(city, ax, ay) !== T.Road) continue;
      const edge =
        ai.dir === 0 ? ax * TILE - v.x : ai.dir === 2 ? v.x - (ax + 1) * TILE : ai.dir === 1 ? ay * TILE - v.y : v.y - (ay + 1) * TILE;
      const dist = edge - v.def.len / 2;
      const ls = lightState(avi, ahi, g.time);
      const green = ls === (ai.dir % 2 === 1 ? 0 : 1);
      if (!green && !panic && dist < 5 && dist > -1.5) {
        desired = 0;
        redStop = true;
      }
      if (n === 1 && !redStop) chooseTurn(g, v, avi, ahi);
      break;
    }
  } else if (inX && ai.turn < 0) chooseTurn(g, v, vi, hi);

  let targX: number;
  let targY: number;
  if (ai.turn >= 0) {
    targX = ai.ex;
    targY = ai.ey;
    if (ai.turn !== ai.dir) desired = Math.min(desired, 6);
    const rel = (ai.ex - v.x) * DX[ai.turn] + (ai.ey - v.y) * DY[ai.turn];
    if (rel < 1) {
      ai.dir = ai.turn;
      ai.turn = -1;
    }
    ai.lostT = 0;
  } else if (ai.dir % 2 === 1 && vi >= 0 && onRoad) {
    targX = (city.vRoads[vi] + (ai.dir === 1 ? 0.5 : 1.5)) * TILE;
    targY = v.y + DY[ai.dir] * 7;
    ai.lostT = 0;
  } else if (ai.dir % 2 === 0 && hi >= 0 && onRoad) {
    targY = (city.hRoads[hi] + (ai.dir === 0 ? 1.5 : 0.5)) * TILE;
    targX = v.x + DX[ai.dir] * 7;
    ai.lostT = 0;
  } else {
    // Knocked off the road network: limp ahead and get recycled once out of sight.
    targX = v.x + DX[ai.dir] * 7;
    targY = v.y + DY[ai.dir] * 7;
    desired = Math.min(desired, 4);
    ai.lostT += dt;
    const far = Math.hypot(v.x - g.player.x, v.y - g.player.y) > g.viewRadius;
    if (ai.lostT > 5 && far) v.remove = true;
  }

  // Keep distance from whatever is ahead.
  if (!(ai.stuckT > 6)) {
    const look = 6 + Math.max(0, sp) * 0.9 + v.def.len / 2;
    for (const o of g.vehicles) {
      if (o === v || o.remove) continue;
      const dx = o.x - v.x;
      const dy = o.y - v.y;
      const fd = dx * fx + dy * fy;
      if (fd < 0 || fd > look + o.def.len / 2) continue;
      const ld = Math.abs(-dx * fy + dy * fx);
      const ca = Math.abs(Math.cos(o.a - v.a));
      const sa = Math.abs(Math.sin(o.a - v.a));
      const halfW = (ca * o.def.wid + sa * o.def.len) / 2;
      const halfL = (ca * o.def.len + sa * o.def.wid) / 2;
      if (ld > v.def.wid / 2 + halfW + 0.3) continue;
      const gap = fd - v.def.len / 2 - halfL;
      desired = Math.min(desired, Math.max(0, (gap - 2) * 1.5));
    }
    if (!panic)
      for (const p of g.peds) {
        if (p.state === 'dead' || (p === g.player && g.pv)) continue;
        const dx = p.x - v.x;
        const dy = p.y - v.y;
        const fd = dx * fx + dy * fy;
        if (fd < 0 || fd > look) continue;
        if (Math.abs(-dx * fy + dy * fx) > v.def.wid / 2 + 0.7) continue;
        desired = Math.min(desired, Math.max(0, (fd - v.def.len / 2 - 1.5) * 1.5));
      }
  } else desired = Math.min(desired, 4);
  if (sp < 0.5 && !redStop) ai.stuckT += dt;
  else if (sp > 2) ai.stuckT = 0;
  if (ai.stuckT > 9) ai.stuckT = 0;

  const diff = wrapAngle(Math.atan2(targY - v.y, targX - v.x) - v.a);
  v.steer = clamp(diff * 2.2, -1, 1);
  v.handbrake = false;
  if (desired <= 0 && sp < 0.6) {
    v.throttle = 0;
    v.handbrake = true;
  } else if (sp < desired) v.throttle = Math.min(1, (desired - sp) * 0.4 + 0.1);
  else if (sp > desired + 1.5) v.throttle = -1;
  else v.throttle = 0;
}

function chooseTurn(g: Game, v: Vehicle, vi: number, hi: number) {
  const ai = v.ai!;
  const city = g.city;
  const vx0 = city.vRoads[vi];
  const hy0 = city.hRoads[hi];
  const opts: number[] = [];
  const cands: [number, number][] = [
    [ai.dir, 3],
    [(ai.dir + 1) % 4, 1],
    [(ai.dir + 3) % 4, 1],
  ];
  for (const [nd, wgt] of cands) {
    const e = exitPoint(vx0, hy0, nd);
    if (tileAt(city, Math.floor(e[0]), Math.floor(e[1])) === T.Road) for (let k = 0; k < wgt; k++) opts.push(nd);
  }
  if (!opts.length) opts.push((ai.dir + 2) % 4);
  ai.turn = g.rng.pick(opts);
  const e = exitPoint(vx0, hy0, ai.turn);
  ai.ex = e[0] * TILE;
  ai.ey = e[1] * TILE;
}

/** Keep a ring of moving traffic and parked cars around the player. */
export function spawnTraffic(g: Game, dt: number, minDist?: number) {
  g.trafficT -= dt;
  if (g.trafficT > 0 && minDist === undefined) return;
  g.trafficT = 0.12;
  let moving = 0;
  let parked = 0;
  for (const v of g.vehicles) {
    if (v.driver === 'ai') moving++;
    if (v.parkTile >= 0) parked++;
  }
  const min = minDist ?? g.viewRadius + 8;
  const ang = g.rng.next() * Math.PI * 2;
  const d = min + g.rng.next() * (minDist === undefined ? 30 : 70);
  const x = g.player.x + Math.cos(ang) * d;
  const y = g.player.y + Math.sin(ang) * d;
  const tx = Math.floor(x / TILE);
  const ty = Math.floor(y / TILE);
  const city = g.city;
  const t = tileAt(city, tx, ty);
  if (t === T.Road && moving < TRAFFIC_MAX) {
    const vi = city.vIdx[tx];
    const hi = city.hIdx[ty];
    if (vi >= 0 === hi >= 0) return;
    let dir: number;
    let cx = (tx + 0.5) * TILE;
    let cy = (ty + 0.5) * TILE;
    if (vi >= 0) dir = tx === city.vRoads[vi] ? 1 : 3;
    else dir = ty === city.hRoads[hi] ? 2 : 0;
    for (const o of g.vehicles) if (Math.hypot(o.x - cx, o.y - cy) < 11) return;
    cx += (g.rng.next() - 0.5) * 0.3;
    cy += (g.rng.next() - 0.5) * 0.3;
    const v = g.spawnVehicle(g.rng.pick(TRAFFIC_POOL), cx, cy, (dir * Math.PI) / 2, 'ai');
    v.ai = { dir, turn: -1, ex: 0, ey: 0, cruise: g.rng.range(8, 11.5), panicT: 0, stuckT: 0, lostT: 0 };
    v.vx = DX[dir] * v.ai.cruise;
    v.vy = DY[dir] * v.ai.cruise;
  } else if (t === T.Plaza && parked < PARKED_MAX) {
    const idx = ty * city.w + tx;
    if (g.parkedTiles.has(idx) || hash2(tx, ty) > 0.3) return;
    const cx = (tx + 0.5) * TILE;
    const cy = (ty + 0.5) * TILE;
    for (const o of g.vehicles) if (Math.hypot(o.x - cx, o.y - cy) < 6) return;
    const pool = ['wren', 'marlow', 'marlow', 'bastion', 'kestrel', 'fare'];
    const v = g.spawnVehicle(g.rng.pick(pool), cx, cy, hash2(ty, tx) > 0.5 ? Math.PI / 2 : 0, 'none');
    v.parked = true;
    v.parkTile = idx;
    g.parkedTiles.add(idx);
    void VEHICLES;
  }
}
