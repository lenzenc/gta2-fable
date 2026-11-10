import { CASH_GOAL, FACTIONS, rivalOf, VEHICLES } from '../data/defs';
import { Loc, MissionDef, MISSIONS, Step } from '../data/missions';
import { City, Vec } from '../world/city';
import type { Game } from './game';
import { addHeat, HEAT_T } from './heat';
import type { Ped, Pickup, Vehicle } from './types';

export interface MissionRun {
  def: MissionDef;
  step: number;
  started: boolean;
  timer: number;
  timed: boolean;
  vehicle: Vehicle | null;
  targets: Ped[];
  targetVs: Vehicle[];
  packages: Pickup[];
}
export interface Offer {
  faction: number;
  def: MissionDef | null;
  locked: boolean;
}

export function locPos(city: City, loc: Loc): Vec {
  const a = city.anchors[loc.d];
  if (loc.k === 'terminal') return a.terminal;
  if (loc.k === 'safehouse') return a.safehouse;
  if (loc.k === 'paint') return a.paint;
  const list = loc.k === 'yard' ? a.yards : a.spots;
  return list[(loc.i ?? 0) % list.length];
}

export function nextMission(g: Game, faction: number): MissionDef | null {
  return MISSIONS.find((m) => m.faction === faction && !g.done.has(m.id)) ?? null;
}

export function startMission(g: Game, def: MissionDef) {
  g.mission = { def, step: 0, started: false, timer: 0, timed: false, vehicle: null, targets: [], targetVs: [], packages: [] };
  g.emit('banner', 0, 0, 0, 0, def.title.toUpperCase(), def.brief, FACTIONS[def.faction].css);
}

function endMission(g: Game) {
  const m = g.mission;
  if (!m) return;
  if (m.vehicle) m.vehicle.missionTag = false;
  for (const t of m.targets) t.missionTag = false;
  for (const v of m.targetVs) v.missionTag = false;
  for (const p of m.packages) {
    p.active = false;
    p.ttl = 0;
  }
  g.mission = null;
  g.objective = null;
  g.objectiveText = '';
}

export function failMission(g: Game, why: string) {
  if (!g.mission) return;
  g.emit('banner', 0, 0, 0, 0, 'JOB BLOWN', why, '#ff3d6a');
  endMission(g);
}

function initStep(g: Game, m: MissionRun, s: Step) {
  m.started = true;
  m.timed = 'time' in s && s.time !== undefined;
  m.timer = m.timed ? (s as { time: number }).time : 0;
  if (s.t === 'steal') {
    const p = g.freeSpot(locPos(g.city, s.loc), 5);
    const v = g.spawnVehicle(s.veh, p.x, p.y, 0, 'none');
    v.missionTag = true;
    v.parked = true;
    m.vehicle = v;
  } else if (s.t === 'eliminate') {
    m.targets = [];
    const c = locPos(g.city, s.loc);
    for (let i = 0; i < s.n; i++) {
      const p = g.freeSpot({ x: c.x + Math.cos(i * 2.4) * 3, y: c.y + Math.sin(i * 2.4) * 3 }, 1);
      const t = g.spawnPed('target', p.x, p.y);
      t.faction = s.faction;
      t.weapon = s.weapon;
      t.hp = 70;
      t.state = 'idle';
      t.missionTag = true;
      m.targets.push(t);
    }
  } else if (s.t === 'destroy') {
    m.targetVs = [];
    const c = locPos(g.city, s.loc);
    for (let i = 0; i < s.n; i++) {
      const p = g.freeSpot(c, 6);
      const v = g.spawnVehicle(s.veh, p.x, p.y, i % 2 ? Math.PI / 2 : 0, 'none');
      v.color = FACTIONS[rivalOf(m.def.faction)].color;
      v.missionTag = true;
      v.parked = true;
      m.targetVs.push(v);
    }
  } else if (s.t === 'collect') {
    m.packages = s.locs.map((l) => {
      const p = locPos(g.city, l);
      const pk: Pickup = { id: g.nextId++, x: p.x, y: p.y, kind: 'package', amount: 0, active: true, respawnT: 0, temp: true, ttl: 1e9, missionTag: true };
      g.pickups.push(pk);
      return pk;
    });
  } else if (s.t === 'heat') {
    if (g.heat.points < HEAT_T[s.level]) addHeat(g, HEAT_T[s.level] - g.heat.points);
  } else if (s.t === 'give') {
    g.ammo[s.weapon] = (g.ammo[s.weapon] ?? 0) + s.ammo;
    g.weapon = s.weapon;
  }
}

const near = (g: Game, p: Vec, r: number) => Math.hypot(g.player.x - p.x, g.player.y - p.y) < r;
function nearest<A extends Vec>(g: Game, list: A[]): A | null {
  let best: A | null = null;
  let bd = 1e18;
  for (const o of list) {
    const d = (o.x - g.player.x) ** 2 + (o.y - g.player.y) ** 2;
    if (d < bd) {
      bd = d;
      best = o;
    }
  }
  return best;
}

export function updateMission(g: Game, dt: number) {
  // Job terminals.
  g.offer = null;
  if (!g.mission && !g.pv && g.respawnT <= 0) {
    for (let f = 0; f < 3; f++) {
      if (!near(g, g.city.anchors[f].terminal, 2.6)) continue;
      const def = nextMission(g, f);
      const locked = !!def && g.rep[f] < def.repReq;
      g.offer = { faction: f, def, locked };
      if (!def) g.prompt = `${FACTIONS[f].name}: no more work for you`;
      else if (locked) g.prompt = `${FACTIONS[f].name} want more respect first (${Math.round(g.rep[f])}/${def.repReq})`;
      else {
        g.prompt = `[F] Take job: ${def.title} — $${def.reward}`;
        if (g.input.interact) startMission(g, def);
      }
    }
  }
  if (!g.won && g.cash >= CASH_GOAL) {
    g.won = true;
    g.emit('banner', 0, 0, 0, 0, 'THE LEDGER IS YOURS', `$${CASH_GOAL} banked — the city answers to you now`, '#ffd21f');
  }
  const m = g.mission;
  if (!m) return;
  const s = m.def.steps[m.step];
  if (!m.started) initStep(g, m, s);
  if (m.vehicle && (m.vehicle.wreck || m.vehicle.remove || m.vehicle.fireT > 0)) {
    failMission(g, 'The vehicle was destroyed');
    return;
  }
  if (m.timed) {
    m.timer -= dt;
    if (m.timer <= 0) {
      failMission(g, 'Out of time');
      return;
    }
  }
  let done = false;
  g.objectiveText = s.text;
  if (s.t === 'goto') {
    const p = locPos(g.city, s.loc);
    g.objective = p;
    done = near(g, p, 4.5);
  } else if (s.t === 'steal') {
    g.objective = m.vehicle;
    done = g.pv === m.vehicle;
    if (done && s.heat) addHeat(g, Math.max(0, HEAT_T[s.heat] - g.heat.points));
  } else if (s.t === 'deliver') {
    const p = locPos(g.city, s.loc);
    if (g.pv === m.vehicle) {
      g.objective = p;
      done = near(g, p, 5.5);
    } else {
      g.objective = m.vehicle;
      g.objectiveText = `Get back in the ${m.vehicle ? m.vehicle.def.name : 'vehicle'}`;
    }
  } else if (s.t === 'eliminate') {
    const alive = m.targets.filter((t) => t.state !== 'dead');
    for (const t of alive)
      if (t.state === 'idle' && near(g, t, 20)) {
        t.state = 'attack';
        t.hostile = true;
      }
    g.objective = nearest(g, alive);
    g.objectiveText = `${s.text} (${m.targets.length - alive.length}/${m.targets.length})`;
    done = alive.length === 0;
  } else if (s.t === 'destroy') {
    const alive = m.targetVs.filter((v) => !v.wreck && !v.remove);
    g.objective = nearest(g, alive);
    g.objectiveText = `${s.text} (${m.targetVs.length - alive.length}/${m.targetVs.length})`;
    done = alive.length === 0;
  } else if (s.t === 'collect') {
    const left = m.packages.filter((p) => p.active);
    g.objective = nearest(g, left);
    g.objectiveText = `${s.text} (${m.packages.length - left.length}/${m.packages.length})`;
    done = left.length === 0;
  } else if (s.t === 'heat') {
    g.objective = null;
    done = g.heat.level === 0;
  } else if (s.t === 'give') done = true;

  if (!done) return;
  m.step++;
  m.started = false;
  if (m.step < m.def.steps.length) return;
  const def = m.def;
  if (m.vehicle && g.pv === m.vehicle) {
    // Hand the delivery over: step out of it.
    g.leaveVehicle();
    m.vehicle.remove = true;
  }
  g.done.add(def.id);
  g.addCash(def.reward);
  g.addRep(def.faction, 20);
  g.addRep(rivalOf(def.faction), -10);
  g.emit('banner', 0, 0, 0, 0, 'JOB DONE', `+$${def.reward} · ${FACTIONS[def.faction].name} respect up`, '#5dff7a');
  endMission(g);
  void VEHICLES;
}
