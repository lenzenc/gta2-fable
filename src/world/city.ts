import { RNG } from '../engine/rng';

export const TILE = 4;
export const T = { Water: 0, Road: 1, Sidewalk: 2, Building: 3, Park: 4, Plaza: 5 } as const;

export interface Vec {
  x: number;
  y: number;
}
export interface DistrictAnchors {
  terminal: Vec;
  safehouse: Vec;
  paint: Vec;
  spots: Vec[];
  yards: Vec[];
}
export interface PickupSpawn {
  x: number;
  y: number;
  kind: string;
}
export interface City {
  w: number;
  h: number;
  seed: number;
  tiles: Uint8Array;
  height: Uint8Array;
  district: Uint8Array;
  lot: Uint16Array;
  vRoads: number[];
  hRoads: number[];
  /** Road index for a column / row, or -1. */
  vIdx: Int16Array;
  hIdx: Int16Array;
  bridges: boolean[];
  riverIdx: number;
  anchors: DistrictAnchors[];
  pickups: PickupSpawn[];
}

export const DISTRICT_NAMES = ['Old Quay', 'Glasswork', 'Greenhouse Row'];

function genLines(rng: RNG, size: number, river: boolean) {
  const roads = [6];
  let riverIdx = -1;
  let p = 6;
  for (;;) {
    let gap = rng.int(7, 12);
    const forced = river && riverIdx < 0 && p > size * 0.42;
    if (forced) gap = 6;
    const n = p + 2 + gap;
    if (n + 2 > size - 6) break;
    if (forced) riverIdx = roads.length - 1;
    roads.push(n);
    p = n;
  }
  return { roads, riverIdx };
}

export function generateCity(seed: number, size = 128): City {
  const rng = new RNG(seed);
  const w = size;
  const h = size;
  const tiles = new Uint8Array(w * h);
  const height = new Uint8Array(w * h);
  const district = new Uint8Array(w * h);
  const lot = new Uint16Array(w * h);
  const vRoads = genLines(rng, w, false).roads;
  const hl = genLines(rng, h, true);
  const hRoads = hl.roads;
  const riverIdx = hl.riverIdx;
  const nv = vRoads.length;
  const nh = hRoads.length;
  const vIdx = new Int16Array(w).fill(-1);
  const hIdx = new Int16Array(h).fill(-1);
  vRoads.forEach((x, i) => {
    vIdx[x] = i;
    vIdx[x + 1] = i;
  });
  hRoads.forEach((y, i) => {
    hIdx[y] = i;
    hIdx[y + 1] = i;
  });
  const set = (x: number, y: number, t: number) => {
    tiles[y * w + x] = t;
  };

  // Land mass: sidewalk by default, ring road at the edge.
  const lx0 = vRoads[0] - 1;
  const lx1 = vRoads[nv - 1] + 2;
  const ly0 = hRoads[0] - 1;
  const ly1 = hRoads[nh - 1] + 2;
  for (let y = ly0; y <= ly1; y++) for (let x = lx0; x <= lx1; x++) set(x, y, T.Sidewalk);
  for (const x of vRoads)
    for (let y = hRoads[0]; y <= hRoads[nh - 1] + 1; y++) {
      set(x, y, T.Road);
      set(x + 1, y, T.Road);
    }
  for (const y of hRoads)
    for (let x = vRoads[0]; x <= vRoads[nv - 1] + 1; x++) {
      set(x, y, T.Road);
      set(x, y + 1, T.Road);
    }

  // River with bridges on alternating avenues.
  const ry0 = hRoads[riverIdx] + 3;
  const ry1 = hRoads[riverIdx + 1] - 2;
  const bridges = vRoads.map((_, i) => i % 2 === 0 || i === nv - 1);
  for (let y = ry0; y <= ry1; y++) for (let x = 0; x < w; x++) set(x, y, T.Water);
  vRoads.forEach((x, i) => {
    if (bridges[i]) {
      for (let y = ry0; y <= ry1; y++) {
        set(x, y, T.Road);
        set(x + 1, y, T.Road);
      }
    } else {
      for (const y of [ry0 - 1, ry1 + 1]) {
        set(x, y, T.Sidewalk);
        set(x + 1, y, T.Sidewalk);
      }
    }
  });

  const midX = vRoads[nv >> 1];
  const riverMid = ry0 + 2;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) district[y * w + x] = y < riverMid ? (x < midX ? 1 : 2) : 0;

  // City blocks.
  let lotId = 1;
  const emitLot = (x0: number, y0: number, x1: number, y1: number, d: number) => {
    const plaza = rng.chance(0.12);
    const ht = 4 * (d === 1 ? rng.int(2, 5) : d === 2 ? rng.int(1, 3) : rng.int(1, 2));
    const id = lotId++;
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const i = y * w + x;
        if (plaza) tiles[i] = T.Plaza;
        else {
          tiles[i] = T.Building;
          height[i] = ht;
          lot[i] = id;
        }
      }
  };
  const split = (x0: number, y0: number, x1: number, y1: number, d: number) => {
    const bw = x1 - x0 + 1;
    const bh = y1 - y0 + 1;
    const maxLot = rng.int(3, 5);
    if (bw <= maxLot && bh <= maxLot) {
      emitLot(x0, y0, x1, y1, d);
      return;
    }
    if (bw >= bh) {
      const c = rng.int(2, bw - 2);
      split(x0, y0, x0 + c - 1, y1, d);
      split(x0 + c, y0, x1, y1, d);
    } else {
      const c = rng.int(2, bh - 2);
      split(x0, y0, x1, y0 + c - 1, d);
      split(x0, y0 + c, x1, y1, d);
    }
  };
  for (let j = 0; j < nh - 1; j++) {
    if (j === riverIdx) continue;
    for (let i = 0; i < nv - 1; i++) {
      const x0 = vRoads[i] + 3;
      const x1 = vRoads[i + 1] - 2;
      const y0 = hRoads[j] + 3;
      const y1 = hRoads[j + 1] - 2;
      const d = district[((y0 + y1) >> 1) * w + ((x0 + x1) >> 1)];
      const r = rng.next();
      const parkP = d === 2 ? 0.25 : 0.07;
      if (r < parkP || r < parkP + 0.08) {
        const t = r < parkP ? T.Park : T.Plaza;
        for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) set(x, y, t);
      } else split(x0, y0, x1, y1, d);
    }
  }

  // Anchors: job terminals, safehouses, paint shops and mission locations.
  const center = (i: number): Vec => ({ x: ((i % w) + 0.5) * TILE, y: (Math.floor(i / w) + 0.5) * TILE });
  const side: number[][] = [[], [], []];
  const road: number[][] = [[], [], []];
  const open: number[][] = [[], [], []];
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? T.Water : tiles[y * w + x]);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const t = tiles[i];
      const d = district[i];
      const nearRiver = y >= ry0 - 2 && y <= ry1 + 2;
      if (t === T.Road && !nearRiver && vIdx[x] >= 0 !== hIdx[y] >= 0) road[d].push(i);
      if (t === T.Sidewalk || t === T.Park || t === T.Plaza) {
        if (!nearRiver) open[d].push(i);
        if (t !== T.Sidewalk || nearRiver) continue;
        let hasRoad = false;
        let hasWater = false;
        for (let oy = -1; oy <= 1; oy++)
          for (let ox = -1; ox <= 1; ox++) {
            const n = at(x + ox, y + oy);
            if (n === T.Water) hasWater = true;
            if (n === T.Road && (ox === 0 || oy === 0)) hasRoad = true;
          }
        if (hasRoad && !hasWater) side[d].push(i);
      }
    }
  const used: Vec[] = [];
  const pick = (cands: number[], n: number, minTiles: number): Vec[] => {
    const out: Vec[] = [];
    for (let m = minTiles; out.length < n && m >= 1; m -= 2) {
      const min = Math.max(1, m) * TILE;
      for (const i of cands) {
        const c = center(i);
        if (used.every((u) => Math.hypot(u.x - c.x, u.y - c.y) >= min)) {
          out.push(c);
          used.push(c);
          if (out.length >= n) break;
        }
      }
      if (m > 1 && m - 2 < 1) m = 3;
    }
    return out;
  };
  const anchors: DistrictAnchors[] = [];
  const pickups: PickupSpawn[] = [];
  const kinds = ['pistol', 'health', 'smg', 'cash', 'shotgun', 'armor', 'pistol', 'grenade', 'flamer', 'cash', 'rocket', 'smg'];
  for (let d = 0; d < 3; d++) {
    rng.shuffle(side[d]);
    rng.shuffle(road[d]);
    rng.shuffle(open[d]);
    anchors.push({
      terminal: pick(side[d], 1, 10)[0],
      safehouse: pick(side[d], 1, 10)[0],
      paint: pick(side[d], 1, 10)[0],
      yards: pick(side[d], 6, 6),
      spots: pick(road[d], 8, 6),
    });
    pick(open[d], kinds.length, 5).forEach((p, k) => pickups.push({ x: p.x, y: p.y, kind: kinds[k] }));
  }

  return { w, h, seed, tiles, height, district, lot, vRoads, hRoads, vIdx, hIdx, bridges, riverIdx, anchors, pickups };
}

export function tileAt(c: City, tx: number, ty: number): number {
  if (tx < 0 || ty < 0 || tx >= c.w || ty >= c.h) return T.Water;
  return c.tiles[ty * c.w + tx];
}
export function tileAtW(c: City, x: number, y: number): number {
  return tileAt(c, Math.floor(x / TILE), Math.floor(y / TILE));
}
export function districtAtW(c: City, x: number, y: number): number {
  const tx = Math.min(c.w - 1, Math.max(0, Math.floor(x / TILE)));
  const ty = Math.min(c.h - 1, Math.max(0, Math.floor(y / TILE)));
  return c.district[ty * c.w + tx];
}

export interface Hit {
  nx: number;
  ny: number;
  depth: number;
}
const hitOut: Hit = { nx: 0, ny: 0, depth: 0 };

/** Push a circle out of building tiles. Mutates p; returns the deepest contact or null. */
export function resolveCircle(c: City, p: Vec, r: number): Hit | null {
  let found = false;
  hitOut.depth = 0;
  const tx0 = Math.floor((p.x - r) / TILE);
  const tx1 = Math.floor((p.x + r) / TILE);
  const ty0 = Math.floor((p.y - r) / TILE);
  const ty1 = Math.floor((p.y + r) / TILE);
  for (let ty = ty0; ty <= ty1; ty++)
    for (let tx = tx0; tx <= tx1; tx++) {
      if (tileAt(c, tx, ty) !== T.Building) continue;
      const minx = tx * TILE;
      const miny = ty * TILE;
      const maxx = minx + TILE;
      const maxy = miny + TILE;
      const cx = Math.max(minx, Math.min(maxx, p.x));
      const cy = Math.max(miny, Math.min(maxy, p.y));
      const dx = p.x - cx;
      const dy = p.y - cy;
      const d2 = dx * dx + dy * dy;
      if (d2 >= r * r) continue;
      let nx: number;
      let ny: number;
      let depth: number;
      if (d2 > 1e-9) {
        const d = Math.sqrt(d2);
        nx = dx / d;
        ny = dy / d;
        depth = r - d;
      } else {
        const l = p.x - minx;
        const rr = maxx - p.x;
        const t = p.y - miny;
        const b = maxy - p.y;
        const m = Math.min(l, rr, t, b);
        nx = m === l ? -1 : m === rr ? 1 : 0;
        ny = nx !== 0 ? 0 : m === t ? -1 : 1;
        depth = m + r;
      }
      p.x += nx * depth;
      p.y += ny * depth;
      if (depth > hitOut.depth) {
        hitOut.nx = nx;
        hitOut.ny = ny;
        hitOut.depth = depth;
      }
      found = true;
    }
  return found ? hitOut : null;
}

/** Line of sight between two world points (blocked by buildings). */
export function los(c: City, x0: number, y0: number, x1: number, y1: number): boolean {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const d = Math.hypot(dx, dy);
  const n = Math.ceil(d / 1.5);
  for (let i = 1; i < n; i++) {
    const t = i / n;
    if (tileAtW(c, x0 + dx * t, y0 + dy * t) === T.Building) return false;
  }
  return true;
}

/** Traffic light phase at an intersection: 0 = N/S green, 1 = E/W green, 2 = all red. */
export function lightState(vi: number, hi: number, time: number): number {
  const t = (time + ((vi * 7 + hi * 13) % 16)) % 16;
  return t < 7 ? 0 : t < 8 ? 2 : t < 15 ? 1 : 2;
}
