import { describe, expect, it } from 'vitest';
import { MISSIONS } from '../src/data/missions';
import { Game } from '../src/sim/game';
import { addHeat, heatLevel, HEAT_T } from '../src/sim/heat';
import { locPos, startMission } from '../src/sim/missions';
import { enterVehicle } from '../src/sim/player';
import { generateCity, T, TILE, tileAt, tileAtW } from '../src/world/city';

const DT = 1 / 60;
const run = (g: Game, secs: number, each?: () => void) => {
  for (let i = 0; i < secs * 60; i++) {
    each?.();
    g.tick(DT);
  }
};

describe('city generation', () => {
  it('is deterministic for a seed', () => {
    const a = generateCity(42);
    const b = generateCity(42);
    expect(Array.from(a.tiles)).toEqual(Array.from(b.tiles));
    expect(a.anchors).toEqual(b.anchors);
    expect(Array.from(generateCity(43).tiles)).not.toEqual(Array.from(a.tiles));
  });

  it('has one connected road network', () => {
    for (const seed of [1, 42, 20261109]) {
      const c = generateCity(seed);
      const roads: number[] = [];
      c.tiles.forEach((t, i) => t === T.Road && roads.push(i));
      const seen = new Set<number>([roads[0]]);
      const q = [roads[0]];
      while (q.length) {
        const i = q.pop()!;
        const x = i % c.w;
        const y = Math.floor(i / c.w);
        for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
          const j = ny * c.w + nx;
          if (tileAt(c, nx, ny) === T.Road && !seen.has(j)) {
            seen.add(j);
            q.push(j);
          }
        }
      }
      expect(seen.size).toBe(roads.length);
    }
  });

  it('places every anchor on walkable ground in the right district', () => {
    const c = generateCity(20261109);
    expect(c.anchors.length).toBe(3);
    c.anchors.forEach((a, d) => {
      expect(a.yards.length).toBe(6);
      expect(a.spots.length).toBe(8);
      for (const p of [a.terminal, a.safehouse, a.paint, ...a.yards]) {
        expect(tileAtW(c, p.x, p.y)).toBe(T.Sidewalk);
        expect(c.district[Math.floor(p.y / TILE) * c.w + Math.floor(p.x / TILE)]).toBe(d);
      }
      for (const p of a.spots) expect(tileAtW(c, p.x, p.y)).toBe(T.Road);
    });
    expect(c.bridges.filter(Boolean).length).toBeGreaterThanOrEqual(2);
  });
});

describe('vehicles', () => {
  const setup = () => {
    const g = new Game(7);
    const s = g.city.anchors[0].spots[0];
    const v = g.spawnVehicle('kestrel', s.x, s.y, 0, 'none');
    g.player.x = s.x;
    g.player.y = s.y;
    enterVehicle(g, v);
    return { g, v };
  };

  it('accelerates but never exceeds top speed', () => {
    const { g, v } = setup();
    let max = 0;
    run(g, 6, () => {
      g.input.my = -1;
      max = Math.max(max, Math.hypot(v.vx, v.vy));
    });
    expect(max).toBeGreaterThan(8);
    expect(max).toBeLessThanOrEqual(v.def.maxSpeed + 0.01);
  });

  it('never ends up inside a building', () => {
    const { g, v } = setup();
    run(g, 20, () => {
      g.input.my = -1;
      g.input.mx = Math.sin(g.time * 1.3) > 0.4 ? 1 : 0;
      if (!v.remove) expect(tileAtW(g.city, v.x, v.y)).not.toBe(T.Building);
    });
  });
});

describe('heat', () => {
  it('maps points to levels', () => {
    expect(heatLevel(0)).toBe(0);
    HEAT_T.forEach((t, i) => i > 0 && expect(heatLevel(t)).toBe(i));
    expect(heatLevel(HEAT_T[2] - 1)).toBe(1);
  });

  it('sends units after the player and cools off when they lose sight', () => {
    const g = new Game(7);
    addHeat(g, HEAT_T[2]);
    expect(g.heat.level).toBe(2);
    run(g, 8);
    expect(g.vehicles.some((v) => v.def.kind === 'patrol')).toBe(true);
    // Remove every unit and keep them from respawning in view: heat must decay to zero.
    for (let i = 0; i < 60 * 60 && g.heat.level > 0; i++) {
      for (const v of g.vehicles) if (v.cop) v.remove = true;
      for (const p of g.peds) if (p.kind === 'cop') p.remove = true;
      g.tick(DT);
    }
    expect(g.heat.level).toBe(0);
  });
});

describe('world simulation', () => {
  it('keeps traffic moving on the roads', () => {
    const g = new Game(7);
    run(g, 30);
    const ai = g.vehicles.filter((v) => v.ai);
    expect(ai.length).toBeGreaterThan(8);
    for (const v of ai) expect(tileAtW(g.city, v.x, v.y)).not.toBe(T.Building);
    const moving = ai.filter((v) => Math.hypot(v.vx, v.vy) > 2).length;
    expect(moving / ai.length).toBeGreaterThan(0.4);
    expect(g.peds.length).toBeGreaterThan(10);
    expect(g.player.hp).toBe(100);
  });

  it('survives a long chaotic session', () => {
    const g = new Game(99);
    g.ammo = { smg: 500, rocket: 20, grenade: 20 };
    g.weapon = 'smg';
    run(g, 90, () => {
      const t = g.time;
      g.input.mx = Math.sin(t * 0.7) > 0 ? 1 : -1;
      g.input.my = Math.cos(t * 0.5) > 0 ? 1 : -1;
      g.input.fire = Math.sin(t * 3) > 0;
      g.input.enter = Math.floor(t * 60) % 240 === 0;
      g.input.nextW = Math.floor(t * 60) % 400 === 0;
    });
    for (const v of g.vehicles) expect(Number.isFinite(v.x + v.y + v.a)).toBe(true);
    for (const p of g.peds) expect(Number.isFinite(p.x + p.y)).toBe(true);
  });
});

describe('missions and reputation', () => {
  it('completes a collection job and pays out', () => {
    const g = new Game(20261109);
    const def = MISSIONS.find((m) => m.id === 'bs1')!;
    startMission(g, def);
    g.tick(DT);
    expect(g.mission!.packages.length).toBe(3);
    for (const pk of [...g.mission!.packages]) {
      g.player.x = pk.x;
      g.player.y = pk.y;
      g.tick(DT);
    }
    g.tick(DT);
    expect(g.mission!.step).toBe(1);
    const t = locPos(g.city, { d: 0, k: 'terminal' });
    g.player.x = t.x;
    g.player.y = t.y;
    g.tick(DT);
    g.tick(DT);
    expect(g.mission).toBeNull();
    expect(g.done.has('bs1')).toBe(true);
    expect(g.cash).toBe(def.reward);
    expect(g.rep[0]).toBe(20);
    expect(g.rep[1]).toBe(-10);
  });

  it('fails a delivery when the vehicle is destroyed', () => {
    const g = new Game(20261109);
    startMission(g, MISSIONS.find((m) => m.id === 'vh1')!);
    g.tick(DT);
    const v = g.mission!.vehicle!;
    g.damageVehicle(v, 9999, false);
    run(g, 5);
    expect(g.mission).toBeNull();
    expect(g.done.has('vh1')).toBe(false);
  });

  it('every mission location resolves', () => {
    const g = new Game(20261109);
    for (const m of MISSIONS)
      for (const s of m.steps) {
        const locs = 'locs' in s ? s.locs : 'loc' in s ? [s.loc] : [];
        for (const l of locs) expect(locPos(g.city, l)).toBeTruthy();
      }
  });

  it('turns a faction hostile when its members are killed', () => {
    const g = new Game(5);
    const p = g.spawnPed('gang', g.player.x + 3, g.player.y);
    p.faction = 1;
    g.killPed(p, true);
    expect(g.rep[1]).toBeLessThan(0);
    expect(g.rep[0]).toBeGreaterThan(0);
    expect(g.heat.points).toBeGreaterThan(0);
  });
});
