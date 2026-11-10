import { isPolice, WEAPON_ORDER } from '../data/defs';
import { resolveCircle, T, tileAtW } from '../world/city';
import type { Game } from './game';
import { dismount } from './heat';
import { PED_R } from './peds';
import type { Vehicle } from './types';
import { fireWeapon } from './weapons';

function owned(g: Game, w: string) {
  return w === 'fists' || (g.ammo[w] ?? 0) > 0;
}

function nearestVehicle(g: Game): Vehicle | null {
  const p = g.player;
  let best: Vehicle | null = null;
  let bd = 1.7;
  for (const v of g.vehicles) {
    if (v.wreck || v.remove || v.fireT > 0) continue;
    const dx = p.x - v.x;
    const dy = p.y - v.y;
    if (Math.abs(dx) > 8 || Math.abs(dy) > 8) continue;
    const c = Math.cos(v.a);
    const s = Math.sin(v.a);
    const lx = Math.max(0, Math.abs(dx * c + dy * s) - v.def.len / 2);
    const ly = Math.max(0, Math.abs(-dx * s + dy * c) - v.def.wid / 2);
    const d = Math.hypot(lx, ly);
    if (d < bd) {
      bd = d;
      best = v;
    }
  }
  return best;
}

export function enterVehicle(g: Game, v: Vehicle) {
  if (v.driver === 'ai') {
    const c = Math.cos(v.a);
    const s = Math.sin(v.a);
    const off = v.def.wid / 2 + 0.8;
    const d = g.spawnPed('civ', v.x + s * off, v.y - c * off);
    d.state = 'flee';
    d.fleeT = 6;
    d.fx = v.x;
    d.fy = v.y;
    d.tx = d.ty = 0;
    g.crime(4);
  } else if (v.driver === 'cop' && v.cop) {
    dismount(g, v, v.cop.weapon);
    g.crime(25);
  } else if (isPolice(v.def)) g.crime(12);
  v.ai = null;
  v.cop = null;
  v.driver = 'player';
  v.parked = false;
  v.siren = false;
  v.handbrake = false;
  g.pv = v;
  g.emit('enter', v.x, v.y, 0, 0, v.def.name);
}

export function updatePlayer(g: Game, dt: number) {
  const p = g.player;
  const inp = g.input;
  if (g.respawnT > 0) {
    g.respawnT -= dt;
    if (g.respawnT <= 0) g.respawn();
    return;
  }
  if (inp.slot >= 0 && inp.slot < WEAPON_ORDER.length && owned(g, WEAPON_ORDER[inp.slot])) g.weapon = WEAPON_ORDER[inp.slot];
  if (inp.nextW || inp.prevW) {
    let i = WEAPON_ORDER.indexOf(g.weapon);
    for (let k = 0; k < WEAPON_ORDER.length; k++) {
      i = (i + (inp.nextW ? 1 : WEAPON_ORDER.length - 1)) % WEAPON_ORDER.length;
      if (owned(g, WEAPON_ORDER[i])) break;
    }
    g.weapon = WEAPON_ORDER[i];
  }
  p.cooldown -= dt;
  const v = g.pv;
  if (v) {
    v.throttle = -inp.my;
    v.steer = inp.mx;
    v.handbrake = inp.handbrake;
    p.x = v.x;
    p.y = v.y;
    p.a = v.a;
    p.moving = false;
    if (inp.fire && p.cooldown <= 0 && (g.weapon === 'pistol' || g.weapon === 'smg')) {
      if (inp.aim) p.a = Math.atan2(inp.aimY - p.y, inp.aimX - p.x);
      fireWeapon(g, p, g.weapon, true);
      p.a = v.a;
    }
    if (Math.hypot(v.vx, v.vy) < 8) {
      g.prompt = '[E] Get out';
      if (inp.enter) g.leaveVehicle();
    }
    return;
  }
  const len = Math.hypot(inp.mx, inp.my);
  p.moving = len > 0.1;
  if (p.moving) {
    const sp = 5.4;
    p.x += (inp.mx / len) * sp * dt;
    p.y += (inp.my / len) * sp * dt;
    p.walk += dt * 16;
    if (!inp.aim) p.a = Math.atan2(inp.my, inp.mx);
  }
  if (inp.aim) p.a = Math.atan2(inp.aimY - p.y, inp.aimX - p.x);
  resolveCircle(g.city, p, PED_R);
  if (tileAtW(g.city, p.x, p.y) === T.Water) {
    g.emit('splash', p.x, p.y);
    g.playerDown('dead', 'Lost to the river');
    return;
  }
  if ((inp.fire || inp.handbrake) && p.cooldown <= 0) fireWeapon(g, p, g.weapon, true);
  const nv = nearestVehicle(g);
  if (nv) {
    g.prompt = `[E] ${nv.driver === 'none' ? 'Take' : 'Jack'} the ${nv.def.name}`;
    if (inp.enter) enterVehicle(g, nv);
  }
}
