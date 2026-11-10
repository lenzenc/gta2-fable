import { WEAPONS } from '../data/defs';
import { wrapAngle } from '../engine/rng';
import { districtAtW, los, resolveCircle, T, TILE, tileAt } from '../world/city';
import type { Game } from './game';
import { DX, DY } from './traffic';
import type { Ped } from './types';
import { fireWeapon } from './weapons';

const WALK = (t: number) => t === T.Sidewalk || t === T.Park || t === T.Plaza;
const PED_MAX = 46;
export const PED_R = 0.35;

function chooseNext(g: Game, p: Ped) {
  const c = g.city;
  const cx = Math.floor(p.x / TILE);
  const cy = Math.floor(p.y / TILE);
  const go = (d: number) => {
    p.dir = d;
    p.tx = (cx + DX[d] + 0.5) * TILE + (g.rng.next() - 0.5) * 2;
    p.ty = (cy + DY[d] + 0.5) * TILE + (g.rng.next() - 0.5) * 2;
  };
  if (p.crossing > 0) {
    p.crossing--;
    go(p.dir);
    return;
  }
  if (!WALK(tileAt(c, cx, cy))) {
    // Stranded on a road: head for the nearest pavement in a straight line.
    for (let r = 1; r <= 5; r++)
      for (let d = 0; d < 4; d++) {
        if (!WALK(tileAt(c, cx + DX[d] * r, cy + DY[d] * r))) continue;
        let clear = true;
        for (let k = 1; k < r; k++) if (tileAt(c, cx + DX[d] * k, cy + DY[d] * k) === T.Building) clear = false;
        if (clear) {
          go(d);
          return;
        }
      }
    p.tx = p.x;
    p.ty = p.y;
    return;
  }
  const f = p.dir;
  const l = (p.dir + 3) % 4;
  const r = (p.dir + 1) % 4;
  const b = (p.dir + 2) % 4;
  const w = (d: number) => WALK(tileAt(c, cx + DX[d], cy + DY[d]));
  for (const d of [f, l, r])
    if (
      tileAt(c, cx + DX[d], cy + DY[d]) === T.Road &&
      tileAt(c, cx + DX[d] * 2, cy + DY[d] * 2) === T.Road &&
      WALK(tileAt(c, cx + DX[d] * 3, cy + DY[d] * 3)) &&
      g.rng.chance(0.07)
    ) {
      p.crossing = 2;
      go(d);
      return;
    }
  const opts: number[] = [];
  if (w(f)) opts.push(f, f, f, f, f, f);
  if (w(l)) opts.push(l);
  if (w(r)) opts.push(r);
  if (!opts.length) opts.push(w(b) ? b : f);
  go(g.rng.pick(opts));
}

function move(g: Game, p: Ped, dx: number, dy: number, speed: number, dt: number) {
  const d = Math.hypot(dx, dy) || 1;
  p.x += (dx / d) * speed * dt;
  p.y += (dy / d) * speed * dt;
  p.a += wrapAngle(Math.atan2(dy, dx) - p.a) * Math.min(1, dt * 10);
  p.walk += dt * speed * 3.2;
  p.moving = true;
  return resolveCircle(g.city, p, PED_R);
}

function chase(g: Game, p: Ped, dt: number, speed: number, stop: number, dist: number) {
  if (dist <= stop) return;
  const pl = g.player;
  let ax = pl.x;
  let ay = pl.y;
  if (!los(g.city, p.x, p.y, pl.x, pl.y)) {
    const n = g.field.next(Math.floor(p.x / TILE), Math.floor(p.y / TILE));
    if (n) {
      ax = (n[0] + 0.5) * TILE;
      ay = (n[1] + 0.5) * TILE;
    }
  }
  move(g, p, ax - p.x, ay - p.y, speed, dt);
}

export function stepPeds(g: Game, dt: number) {
  const pl = g.player;
  const playerUp = g.respawnT <= 0;
  const pSpeed = g.pv ? Math.hypot(g.pv.vx, g.pv.vy) : 0;
  for (const p of g.peds) {
    if (p.state === 'dead') {
      if (p !== pl) {
        p.deadT -= dt;
        if (p.deadT <= 0) p.remove = true;
      }
      continue;
    }
    if (p !== pl) {
      p.moving = false;
      p.cooldown -= dt;
      const dx = pl.x - p.x;
      const dy = pl.y - p.y;
      const dist = Math.hypot(dx, dy);
      if (p.state === 'wander') {
        if (p.kind === 'gang' && playerUp && g.rep[p.faction] <= -25 && dist < 16 && los(g.city, p.x, p.y, pl.x, pl.y)) {
          p.state = 'attack';
          p.hostile = true;
        } else if (p.kind === 'cop') {
          // Stood-down officers walk off and are recycled out of view.
          if (dist > g.viewRadius) p.remove = true;
        }
        const tx = p.tx - p.x;
        const ty = p.ty - p.y;
        if (tx * tx + ty * ty < 0.16) chooseNext(g, p);
        else move(g, p, tx, ty, p.speed, dt);
      } else if (p.state === 'flee') {
        p.fleeT -= dt;
        let fx = p.x - p.fx;
        let fy = p.y - p.fy;
        const fd = Math.hypot(fx, fy) || 1;
        fx /= fd;
        fy /= fd;
        // tx/ty hold a wall-slide bias while fleeing.
        const hit = move(g, p, fx + p.tx, fy + p.ty, 4.6, dt);
        if (hit) {
          const sgn = -hit.ny * fx + hit.nx * fy >= 0 ? 1.5 : -1.5;
          p.tx = -hit.ny * sgn;
          p.ty = hit.nx * sgn;
        } else {
          p.tx *= 0.97;
          p.ty *= 0.97;
        }
        if (p.fleeT <= 0) {
          p.state = 'wander';
          p.dir = g.rng.int(0, 3);
          p.tx = p.x;
          p.ty = p.y;
        }
      } else if (p.state === 'attack') {
        const isCop = p.kind === 'cop';
        if (!playerUp || (isCop && g.heat.level === 0) || (!isCop && p.kind !== 'target' && dist > 45)) {
          p.state = 'wander';
          p.hostile = false;
          p.dir = g.rng.int(0, 3);
          p.tx = p.x;
          p.ty = p.y;
          continue;
        }
        const sees = dist < 30 && los(g.city, p.x, p.y, pl.x, pl.y);
        const canShoot = !isCop || g.heat.level >= 2;
        const arresting = isCop && (!g.pv || pSpeed < 2);
        const stop = arresting ? 0.9 : canShoot ? (isCop ? 6 : 10) : 1;
        if (!sees || dist > stop) chase(g, p, dt, isCop ? 5.0 : 4.2, stop, dist);
        if (sees) p.a += wrapAngle(Math.atan2(dy, dx) - p.a) * Math.min(1, dt * 12);
        if (isCop) {
          const reach = g.pv ? g.pv.def.wid / 2 + 1.3 : 1.25;
          if (arresting && dist < reach) {
            p.arrestT += dt;
            if (p.arrestT > 0.7) g.playerDown('busted', 'Processed and released');
          } else p.arrestT = 0;
        }
        if (canShoot && sees && dist < 24 && p.cooldown <= 0 && !(arresting && dist < 3)) {
          const keep = p.a;
          p.a += (g.rng.next() - 0.5) * 0.22;
          fireWeapon(g, p, p.weapon, false);
          p.a = keep;
          p.cooldown = WEAPONS[p.weapon].cd * (p.weapon === 'smg' ? 2.2 : 1) + 0.45 + g.rng.next() * 0.7;
        }
      }
    }
    if (p === pl && g.pv) continue;

    // Vehicles: get run over or shoved aside.
    for (const v of g.vehicles) {
      if (v.remove) continue;
      const dx = p.x - v.x;
      const dy = p.y - v.y;
      const reach = v.def.len / 2 + 1;
      if (Math.abs(dx) > reach || Math.abs(dy) > reach) continue;
      const c = Math.cos(v.a);
      const s = Math.sin(v.a);
      const lx = dx * c + dy * s;
      const ly = -dx * s + dy * c;
      const hx = v.def.len / 2 + PED_R;
      const hy = v.def.wid / 2 + PED_R;
      if (Math.abs(lx) > hx || Math.abs(ly) > hy) continue;
      const sp = Math.hypot(v.vx, v.vy);
      const closing = -(v.vx * dx + v.vy * dy) < 0;
      if (sp > 4 && closing) {
        g.damagePed(p, (sp - 2.5) * 9, v === g.pv, v.x, v.y);
        v.vx *= 0.985;
        v.vy *= 0.985;
      }
      // Push out along the shallower axis.
      const px = hx - Math.abs(lx);
      const py = hy - Math.abs(ly);
      let ox = 0;
      let oy = 0;
      if (px < py) ox = Math.sign(lx || 1) * px;
      else oy = Math.sign(ly || 1) * py;
      p.x += c * ox - s * oy;
      p.y += s * ox + c * oy;
      if ((p as Ped).state === 'dead') break;
    }
  }
}

export function spawnPeds(g: Game, dt: number, minDist?: number) {
  g.pedT -= dt;
  if (g.pedT > 0 && minDist === undefined) return;
  g.pedT = 0.1;
  let n = 0;
  for (const p of g.peds) if ((p.kind === 'civ' || p.kind === 'gang') && p.state !== 'dead') n++;
  if (n >= PED_MAX) return;
  const min = minDist ?? g.viewRadius + 4;
  const ang = g.rng.next() * Math.PI * 2;
  const d = min + g.rng.next() * (minDist === undefined ? 22 : 60);
  const x = g.player.x + Math.cos(ang) * d;
  const y = g.player.y + Math.sin(ang) * d;
  const tx = Math.floor(x / TILE);
  const ty = Math.floor(y / TILE);
  const t = tileAt(g.city, tx, ty);
  if (t !== T.Sidewalk && t !== T.Park) return;
  const cx = (tx + 0.5) * TILE + (g.rng.next() - 0.5) * 2;
  const cy = (ty + 0.5) * TILE + (g.rng.next() - 0.5) * 2;
  const gang = g.rng.chance(0.2);
  const p = g.spawnPed(gang ? 'gang' : 'civ', cx, cy);
  if (gang) {
    p.faction = districtAtW(g.city, cx, cy);
    p.weapon = g.rng.chance(0.25) ? 'smg' : 'pistol';
    p.hp = 60;
  }
  p.state = 'wander';
  p.dir = g.rng.int(0, 3);
  p.tx = cx;
  p.ty = cy;
}
