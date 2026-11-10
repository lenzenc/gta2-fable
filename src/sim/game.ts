import { FACTIONS, isPolice, rivalOf, VEHICLES, WEAPONS } from '../data/defs';
import { clamp, RNG } from '../engine/rng';
import { City, districtAtW, generateCity, T, TILE, tileAt, Vec } from '../world/city';
import { addHeat, clearHeat, dismount, driveCop, updateHeat } from './heat';
import { failMission, MissionRun, Offer, updateMission } from './missions';
import { FlowField } from './path';
import { spawnPeds, stepPeds } from './peds';
import { updatePlayer } from './player';
import { driveTraffic, spawnTraffic } from './traffic';
import { emptyInput, GameEvent, InputState, Ped, PedKind, Pickup, Projectile, Vehicle } from './types';
import { collideVehicles, stepVehicle } from './vehicle';
import { stepProjectiles } from './weapons';

const CLOTHES = [0x4a6fa5, 0xa54a4a, 0x4aa56b, 0xa58d4a, 0x7d4aa5, 0xd0d0d8, 0x30343c, 0xc86a9a, 0x3c8c8c];
const SKIN = [0xf0c8a0, 0xd9a878, 0xa87850, 0x7a5236, 0x5a3a26];

export class Game {
  city: City;
  rng: RNG;
  field: FlowField;
  time = 0;
  vehicles: Vehicle[] = [];
  peds: Ped[] = [];
  projectiles: Projectile[] = [];
  pickups: Pickup[] = [];
  events: GameEvent[] = [];
  player: Ped;
  /** Vehicle the player is driving, if any. */
  pv: Vehicle | null = null;
  cash = 0;
  rep = [0, 0, 0];
  done = new Set<string>();
  ammo: Record<string, number> = {};
  weapon = 'fists';
  heat = { points: 0, level: 0, unseenT: 0, spawnT: 0, blockT: 6 };
  mission: MissionRun | null = null;
  offer: Offer | null = null;
  objective: Vec | null = null;
  objectiveText = '';
  prompt = '';
  input: InputState = emptyInput();
  viewRadius = 60;
  nextId = 1;
  respawnT = 0;
  respawnKind = '';
  won = false;
  kills = { peds: 0, vehicles: 0 };
  homeDistrict = 0;
  inSafe = true;
  inPaint = false;
  trafficT = 0;
  pedT = 0;
  fieldT = 0;
  shotsNoise = 0;
  parkedTiles = new Set<number>();
  /** Set by the host to persist progress. */
  onSave: (() => void) | null = null;

  constructor(seed = 20261109) {
    this.city = generateCity(seed);
    this.rng = new RNG(seed ^ 0x5bd1e995);
    this.field = new FlowField(this.city);
    for (const p of this.city.pickups) this.addPickup(p.x, p.y, p.kind, false);
    const s = this.city.anchors[0].safehouse;
    this.player = this.spawnPed('player', s.x, s.y);
    this.player.state = 'idle';
    this.populate();
  }

  /** Fill the surroundings with traffic and pedestrians (start, load, respawn). */
  populate() {
    for (let i = 0; i < 500; i++) spawnTraffic(this, 0, 14);
    for (let i = 0; i < 300; i++) spawnPeds(this, 0, 8);
  }

  emit(type: string, x = 0, y = 0, a = 0, n = 0, s = '', s2 = '', s3 = '') {
    this.events.push({ type, x, y, a, n, s, s2: s3 ? `${s2}|${s3}` : s2 });
  }

  addPickup(x: number, y: number, kind: string, temp: boolean, amount?: number): Pickup {
    const amt = amount ?? (kind === 'cash' ? 500 : kind === 'health' || kind === 'armor' ? 100 : (WEAPONS[kind]?.pickup ?? 0));
    const p: Pickup = { id: this.nextId++, x, y, kind, amount: amt, active: true, respawnT: 0, temp, ttl: 30, missionTag: false };
    this.pickups.push(p);
    return p;
  }

  spawnVehicle(defId: string, x: number, y: number, a: number, driver: Vehicle['driver']): Vehicle {
    const def = VEHICLES[defId];
    const v: Vehicle = {
      id: this.nextId++, def, x, y, a, vx: 0, vy: 0, av: 0, hp: def.hp, fireT: 0, wreck: false, wreckT: 0, remove: false, driver, ai: null, cop: null,
      color: this.rng.pick(def.colors), throttle: 0, steer: 0, handbrake: false, parked: false, siren: false, missionTag: false, byPlayerT: -99, skid: 0, parkTile: -1,
    };
    this.vehicles.push(v);
    return v;
  }

  spawnPed(kind: PedKind, x: number, y: number): Ped {
    const p: Ped = {
      id: this.nextId++, kind, x, y, a: this.rng.next() * 6.28, hp: kind === 'cop' ? 80 : kind === 'player' ? 100 : 40, armor: 0, faction: -1, state: 'wander',
      tx: x, ty: y, dir: 0, speed: this.rng.range(1.4, 2.0), fleeT: 0, fx: 0, fy: 0, cooldown: this.rng.next(), weapon: kind === 'cop' ? 'pistol' : 'fists', deadT: 0,
      walk: this.rng.next() * 6, moving: false, color: kind === 'cop' ? 0x1c2c6a : this.rng.pick(CLOTHES), skin: this.rng.pick(SKIN), remove: false, hostile: false,
      crossing: 0, missionTag: false, arrestT: 0,
    };
    this.peds.push(p);
    return p;
  }

  /** Nearest open spot to p that is not inside a building or another vehicle. */
  freeSpot(p: Vec, minSep: number): Vec {
    const cx = Math.floor(p.x / TILE);
    const cy = Math.floor(p.y / TILE);
    for (let r = 0; r <= 5; r++)
      for (let oy = -r; oy <= r; oy++)
        for (let ox = -r; ox <= r; ox++) {
          if (Math.max(Math.abs(ox), Math.abs(oy)) !== r) continue;
          const t = tileAt(this.city, cx + ox, cy + oy);
          if (t === T.Building || t === T.Water) continue;
          const x = r === 0 ? p.x : (cx + ox + 0.5) * TILE;
          const y = r === 0 ? p.y : (cy + oy + 0.5) * TILE;
          let ok = true;
          for (const v of this.vehicles) if (Math.hypot(v.x - x, v.y - y) < minSep) ok = false;
          if (ok) return { x, y };
        }
    return { x: p.x, y: p.y };
  }

  addCash(n: number) {
    this.cash = Math.max(0, this.cash + n);
    if (n > 0) this.emit('cash', 0, 0, 0, n);
  }
  addRep(f: number, n: number) {
    this.rep[f] = clamp(this.rep[f] + n, -100, 100);
  }
  crime(pts: number) {
    addHeat(this, pts);
  }

  /** Frighten civilians and traffic around a point. */
  scare(x: number, y: number, r: number) {
    for (const p of this.peds) {
      if (p.kind !== 'civ' || p.state === 'dead' || p.state === 'flee') continue;
      if (Math.hypot(p.x - x, p.y - y) > r) continue;
      p.state = 'flee';
      p.fleeT = 4 + this.rng.next() * 3;
      p.fx = x;
      p.fy = y;
      p.tx = p.ty = 0;
    }
    for (const v of this.vehicles) if (v.ai && Math.hypot(v.x - x, v.y - y) < r) v.ai.panicT = 4;
  }

  damagePed(p: Ped, dmg: number, byPlayer: boolean, sx: number, sy: number) {
    if (p.state === 'dead') return;
    if (p.kind === 'player') {
      if (this.respawnT > 0) return;
      const ab = Math.min(p.armor, dmg * 0.7);
      p.armor -= ab;
      dmg -= ab;
    }
    p.hp -= dmg;
    this.emit('hit', p.x, p.y, 0, 0, 'blood');
    if (p.hp <= 0) {
      this.killPed(p, byPlayer);
      return;
    }
    if (p.kind === 'civ') {
      p.state = 'flee';
      p.fleeT = 6;
      p.fx = sx;
      p.fy = sy;
      p.tx = p.ty = 0;
      if (byPlayer) this.crime(4);
    } else if (p.kind === 'gang' || p.kind === 'target') {
      if (byPlayer) {
        if (p.kind === 'gang' && !p.hostile) this.addRep(p.faction, -2);
        p.hostile = true;
        p.state = 'attack';
      }
    } else if (p.kind === 'cop' && byPlayer) this.crime(15);
  }

  killPed(p: Ped, byPlayer: boolean) {
    p.state = 'dead';
    p.deadT = 14;
    p.hp = 0;
    p.moving = false;
    if (p.kind === 'player') {
      this.playerDown('dead', 'You were killed');
      return;
    }
    if (byPlayer) {
      this.kills.peds++;
      if (p.kind === 'civ') this.crime(10);
      else if (p.kind === 'cop') this.crime(40);
      else {
        this.crime(5);
        if (p.faction >= 0) {
          this.addRep(p.faction, -4);
          // The faction whose rival this is approves.
          this.addRep((p.faction + 2) % 3, 2);
        }
      }
    }
    if (p.kind !== 'civ' && p.weapon !== 'fists') this.addPickup(p.x, p.y, p.weapon, true, Math.ceil(WEAPONS[p.weapon].pickup / 2));
    else if (this.rng.chance(0.5)) this.addPickup(p.x, p.y, 'cash', true, 10 + this.rng.int(0, 5) * 10);
  }

  damageVehicle(v: Vehicle, dmg: number, byPlayer: boolean) {
    if (v.wreck || v.remove || dmg <= 0) return;
    v.hp -= dmg;
    if (byPlayer) {
      v.byPlayerT = this.time;
      if (isPolice(v.def) && v !== this.pv) this.crime(Math.min(8, dmg * 0.2));
    }
    if (v.ai) v.ai.panicT = 5;
    v.parked = false;
    if (v.hp <= 0 && v.fireT <= 0) {
      v.hp = 0;
      v.fireT = 2 + this.rng.next() * 1.2;
      if (v.driver === 'ai') {
        const d = this.spawnPed('civ', v.x - Math.sin(v.a) * -(v.def.wid / 2 + 0.8), v.y + Math.cos(v.a) * -(v.def.wid / 2 + 0.8));
        d.state = 'flee';
        d.fleeT = 7;
        d.fx = v.x;
        d.fy = v.y;
        d.tx = d.ty = 0;
        v.driver = 'none';
        v.ai = null;
      } else if (v.driver === 'cop' && v.cop) {
        dismount(this, v, v.cop.weapon);
        v.driver = 'none';
        v.cop = null;
      }
    }
  }

  explode(x: number, y: number, r: number, dmg: number, byPlayer: boolean) {
    this.emit('explosion', x, y, 0, r);
    for (const v of this.vehicles) {
      if (v.remove) continue;
      const dx = v.x - x;
      const dy = v.y - y;
      const d = Math.max(0, Math.hypot(dx, dy) - v.def.len / 2);
      if (d > r) continue;
      const f = 1 - d / (r + 1);
      this.damageVehicle(v, dmg * f, byPlayer);
      const dd = Math.hypot(dx, dy) || 1;
      const push = (f * 9000) / v.def.mass;
      v.vx += (dx / dd) * push;
      v.vy += (dy / dd) * push;
    }
    for (const p of this.peds) {
      if (p.state === 'dead' || (p === this.player && this.pv)) continue;
      const d = Math.hypot(p.x - x, p.y - y);
      if (d > r) continue;
      this.damagePed(p, dmg * (1 - d / (r + 1)), byPlayer, x, y);
    }
    this.scare(x, y, 32);
    if (byPlayer) this.crime(6);
  }

  leaveVehicle() {
    const v = this.pv;
    if (!v) return;
    const c = Math.cos(v.a);
    const s = Math.sin(v.a);
    const off = v.def.wid / 2 + 0.75;
    const spots: Vec[] = [
      { x: v.x + s * off, y: v.y - c * off },
      { x: v.x - s * off, y: v.y + c * off },
      { x: v.x - c * (v.def.len / 2 + 0.8), y: v.y - s * (v.def.len / 2 + 0.8) },
    ];
    const ok = spots.find((p) => {
      const t = tileAt(this.city, Math.floor(p.x / TILE), Math.floor(p.y / TILE));
      return t !== T.Building && t !== T.Water;
    });
    const p = ok ?? spots[0];
    this.player.x = p.x;
    this.player.y = p.y;
    v.driver = 'none';
    v.throttle = 0;
    v.steer = 0;
    this.pv = null;
  }

  playerDown(kind: 'dead' | 'busted', why: string) {
    if (this.respawnT > 0) return;
    this.respawnT = 3.5;
    this.respawnKind = kind;
    if (this.pv) this.leaveVehicle();
    if (kind === 'dead') {
      this.player.state = 'dead';
      this.player.hp = 0;
    }
    failMission(this, kind === 'dead' ? 'You went down' : 'You were booked');
    this.emit('banner', 0, 0, 0, 0, kind === 'dead' ? 'FLATLINED' : 'BOOKED', why, kind === 'dead' ? '#ff3d6a' : '#6a8cff');
  }

  respawn() {
    const p = this.player;
    let best = 0;
    let bd = 1e18;
    this.city.anchors.forEach((a, i) => {
      const d = Math.hypot(a.safehouse.x - p.x, a.safehouse.y - p.y);
      if (d < bd) {
        bd = d;
        best = i;
      }
    });
    const s = this.city.anchors[best].safehouse;
    p.x = s.x;
    p.y = s.y;
    p.hp = 100;
    p.armor = 0;
    p.state = 'idle';
    this.ammo = {};
    this.weapon = 'fists';
    this.cash = Math.floor(this.cash * 0.9);
    clearHeat(this);
    this.inSafe = true;
    for (const o of this.peds) if (o.kind === 'cop') o.remove = true;
    for (const v of this.vehicles) if (isPolice(v.def)) v.remove = true;
    this.cleanup(0);
    this.populate();
  }

  private zones() {
    const p = this.player;
    // Safehouses: save and patch up.
    let safe = false;
    this.city.anchors.forEach((a, i) => {
      if (this.pv || Math.hypot(a.safehouse.x - p.x, a.safehouse.y - p.y) > 2.6) return;
      safe = true;
      if (this.inSafe || this.mission) {
        if (this.mission) this.prompt = 'Finish the job before saving';
        return;
      }
      this.homeDistrict = i;
      p.hp = 100;
      this.emit('banner', 0, 0, 0, 0, 'PROGRESS SAVED', 'Patched up at the safehouse', '#e8ecff');
      this.onSave?.();
    });
    this.inSafe = safe;
    // Paint shops: new colour, repairs, and the heat forgets you.
    let paint = false;
    for (const a of this.city.anchors) {
      const v = this.pv;
      if (!v || Math.hypot(a.paint.x - v.x, a.paint.y - v.y) > 3.6) continue;
      paint = true;
      if (this.inPaint) continue;
      if (isPolice(v.def)) this.prompt = 'They will not respray that';
      else if (this.cash < 400) this.prompt = 'Respray costs $400';
      else {
        this.cash -= 400;
        v.hp = v.def.hp;
        v.color = this.rng.pick([0xc8343c, 0x2f6fd0, 0xe0e0e8, 0x2e9c6a, 0xd88a1e, 0x7a4fd0, 0x1fb5c4, 0xff3d9a]);
        clearHeat(this);
        this.emit('banner', 0, 0, 0, 0, 'RESPRAYED', 'Fresh paint, clean record  −$400', '#ff3d9a');
        this.emit('respray', v.x, v.y, 0, v.id);
      }
    }
    this.inPaint = paint;
  }

  private stepPickups(dt: number) {
    const p = this.player;
    for (const k of this.pickups) {
      if (!k.active) {
        if (!k.temp) {
          k.respawnT -= dt;
          if (k.respawnT <= 0) k.active = true;
        }
        continue;
      }
      if (k.temp && !k.missionTag) {
        k.ttl -= dt;
        if (k.ttl <= 0) {
          k.active = false;
          continue;
        }
      }
      if (this.respawnT > 0 || (this.pv && k.kind !== 'package')) continue;
      if (Math.hypot(k.x - p.x, k.y - p.y) > (this.pv ? 3 : 1.3)) continue;
      if (k.kind === 'health') {
        if (p.hp >= 100) continue;
        p.hp = 100;
      } else if (k.kind === 'armor') {
        if (p.armor >= 100) continue;
        p.armor = 100;
      } else if (k.kind === 'cash') this.addCash(k.amount);
      else if (k.kind !== 'package') {
        this.ammo[k.kind] = (this.ammo[k.kind] ?? 0) + k.amount;
        if (this.weapon === 'fists') this.weapon = k.kind;
      }
      k.active = false;
      k.respawnT = 50;
      this.emit('pickup', k.x, k.y, 0, k.amount, k.kind);
    }
  }

  cleanup(dt: number) {
    const p = this.player;
    const desp = this.viewRadius + 60;
    for (const v of this.vehicles) {
      if (v.wreck) {
        v.wreckT -= dt;
        if (v.wreckT <= 0) v.remove = true;
      }
      if (!v.remove && v !== this.pv && !v.missionTag && Math.hypot(v.x - p.x, v.y - p.y) > desp) v.remove = true;
      if (v.remove && v.parkTile >= 0) this.parkedTiles.delete(v.parkTile);
    }
    for (const o of this.peds) if (o !== p && !o.missionTag && !o.remove && Math.hypot(o.x - p.x, o.y - p.y) > desp) o.remove = true;
    if (this.vehicles.some((v) => v.remove)) this.vehicles = this.vehicles.filter((v) => !v.remove);
    if (this.peds.some((o) => o.remove)) this.peds = this.peds.filter((o) => !o.remove);
    if (this.pickups.some((k) => k.temp && !k.active)) this.pickups = this.pickups.filter((k) => !k.temp || k.active);
  }

  tick(dt: number) {
    this.events.length = 0;
    this.time += dt;
    this.prompt = '';
    this.fieldT -= dt;
    if (this.fieldT <= 0) {
      this.fieldT = 0.3;
      this.field.compute(Math.floor(this.player.x / TILE), Math.floor(this.player.y / TILE));
    }
    updatePlayer(this, dt);
    for (const v of this.vehicles) {
      if (v.ai) driveTraffic(this, v, dt);
      else if (v.cop) driveCop(this, v, dt);
    }
    for (const v of this.vehicles) stepVehicle(this, v, dt);
    collideVehicles(this);
    if (this.pv) {
      this.player.x = this.pv.x;
      this.player.y = this.pv.y;
    }
    stepPeds(this, dt);
    stepProjectiles(this, dt);
    this.stepPickups(dt);
    // Sustained gunfire draws attention.
    if (this.shotsNoise > 0) {
      if (this.shotsNoise >= 6) {
        this.crime(3);
        this.shotsNoise = 0;
      }
      this.shotsNoise = Math.max(0, this.shotsNoise - dt * 0.5);
    }
    updateHeat(this, dt);
    updateMission(this, dt);
    this.zones();
    spawnTraffic(this, dt);
    spawnPeds(this, dt);
    this.cleanup(dt);
  }

  /** District the player is currently in. */
  district(): number {
    return districtAtW(this.city, this.player.x, this.player.y);
  }
}
export { FACTIONS, rivalOf };
