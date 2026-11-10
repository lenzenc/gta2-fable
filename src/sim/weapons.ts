import { isPolice, WEAPONS } from '../data/defs';
import { T, tileAtW } from '../world/city';
import type { Game } from './game';
import type { Ped } from './types';

export function fireWeapon(g: Game, p: Ped, wid: string, byPlayer: boolean) {
  const w = WEAPONS[wid];
  if (byPlayer && !w.melee) {
    if ((g.ammo[wid] ?? 0) <= 0) {
      g.weapon = 'fists';
      return;
    }
    g.ammo[wid]--;
    if (g.ammo[wid] <= 0) g.weapon = 'fists';
  }
  p.cooldown = w.cd;
  const ca = Math.cos(p.a);
  const sa = Math.sin(p.a);
  if (w.melee) {
    g.emit('punch', p.x + ca, p.y + sa);
    for (const o of g.peds) {
      if (o === p || o.state === 'dead') continue;
      const dx = o.x - p.x;
      const dy = o.y - p.y;
      if (dx * dx + dy * dy > 1.7 * 1.7 || dx * ca + dy * sa < 0) continue;
      g.damagePed(o, w.dmg, byPlayer, p.x, p.y);
      o.x += ca * 0.4;
      o.y += sa * 0.4;
    }
    return;
  }
  const ox = p.x + ca * 0.6;
  const oy = p.y + sa * 0.6;
  for (let i = 0; i < w.pellets; i++) {
    const ang = p.a + (g.rng.next() - 0.5) * 2 * w.spread;
    const sp = w.speed * (wid === 'flamer' ? 0.8 + g.rng.next() * 0.4 : 1);
    g.projectiles.push({ x: ox, y: oy, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, life: w.life, kind: wid, dmg: w.dmg, owner: p.id, byPlayer });
  }
  g.emit('shot', ox, oy, p.a, 0, wid);
  if (byPlayer && wid !== 'flamer' && wid !== 'grenade') {
    g.scare(p.x, p.y, 24);
    g.shotsNoise += 1;
  }
}

export function stepProjectiles(g: Game, dt: number) {
  const city = g.city;
  for (let i = g.projectiles.length - 1; i >= 0; i--) {
    const pr = g.projectiles[i];
    const w = WEAPONS[pr.kind];
    let dead = false;
    let boom = false;
    if (pr.kind === 'grenade') {
      const k = Math.exp(-2.2 * dt);
      pr.vx *= k;
      pr.vy *= k;
      const nx = pr.x + pr.vx * dt;
      const ny = pr.y + pr.vy * dt;
      if (tileAtW(city, nx, pr.y) === T.Building) pr.vx *= -0.5;
      else pr.x = nx;
      if (tileAtW(city, pr.x, ny) === T.Building) pr.vy *= -0.5;
      else pr.y = ny;
      pr.life -= dt;
      if (pr.life <= 0) dead = boom = true;
    } else {
      const sp = Math.hypot(pr.vx, pr.vy);
      const steps = Math.max(1, Math.ceil((sp * dt) / 0.6));
      const sx = (pr.vx * dt) / steps;
      const sy = (pr.vy * dt) / steps;
      outer: for (let s = 0; s < steps; s++) {
        pr.x += sx;
        pr.y += sy;
        if (tileAtW(city, pr.x, pr.y) === T.Building) {
          dead = true;
          boom = !!w.blast;
          if (!boom && pr.kind !== 'flamer') g.emit('hit', pr.x - sx, pr.y - sy, 0, 0, 'spark');
          break;
        }
        for (const v of g.vehicles) {
          if (v.remove || (pr.byPlayer && v === g.pv)) continue;
          if (!pr.byPlayer && isPolice(v.def) && v !== g.pv) continue;
          const dx = pr.x - v.x;
          const dy = pr.y - v.y;
          if (Math.abs(dx) > v.def.len || Math.abs(dy) > v.def.len) continue;
          const c = Math.cos(v.a);
          const sn = Math.sin(v.a);
          if (Math.abs(dx * c + dy * sn) > v.def.len / 2 || Math.abs(-dx * sn + dy * c) > v.def.wid / 2) continue;
          dead = true;
          boom = !!w.blast;
          if (!boom) {
            g.damageVehicle(v, pr.dmg * w.vehMul * (pr.byPlayer ? 1 : 0.6), pr.byPlayer);
            if (pr.kind !== 'flamer') g.emit('hit', pr.x, pr.y, 0, 0, 'spark');
          }
          break outer;
        }
        for (const o of g.peds) {
          if (o.id === pr.owner || o.state === 'dead') continue;
          if (!pr.byPlayer && o !== g.player) continue;
          if (o === g.player && g.pv) continue;
          const dx = pr.x - o.x;
          const dy = pr.y - o.y;
          if (dx * dx + dy * dy > 0.3) continue;
          dead = true;
          boom = !!w.blast;
          if (!boom) g.damagePed(o, pr.dmg, pr.byPlayer, pr.x - sx * 4, pr.y - sy * 4);
          break outer;
        }
      }
      pr.life -= dt;
      if (pr.life <= 0 && !dead) {
        dead = true;
        boom = !!w.blast;
      }
    }
    if (boom) g.explode(pr.x, pr.y, w.blast!, pr.dmg, pr.byPlayer);
    if (dead) {
      g.projectiles[i] = g.projectiles[g.projectiles.length - 1];
      g.projectiles.pop();
    }
  }
}
