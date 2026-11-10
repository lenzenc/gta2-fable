import * as THREE from 'three';
import { hash2 } from '../engine/rng';
import { City, lightState, T, TILE, tileAt } from './city';

const CELL = 64;
const GRID = 8;
const SIZE = CELL * GRID;
const C = { asphalt: 0, lane: 1, sidewalk: 2, grass: 3, plaza: 4, water: 5, roof: 8, wall: 16, white: 63 };

function makeAtlas(): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = cv.height = SIZE;
  const g = cv.getContext('2d')!;
  let seed = 12345;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) & 0xffff) / 0xffff;
  const cell = (i: number, base: string, draw?: (x: number, y: number) => void, speck = 0, speckCol = '#000') => {
    const x = (i % GRID) * CELL;
    const y = Math.floor(i / GRID) * CELL;
    g.fillStyle = base;
    g.fillRect(x, y, CELL, CELL);
    for (let k = 0; k < speck; k++) {
      g.fillStyle = speckCol;
      g.globalAlpha = 0.08 + rnd() * 0.12;
      g.fillRect(x + rnd() * 62, y + rnd() * 62, 1 + rnd() * 2, 1 + rnd() * 2);
    }
    g.globalAlpha = 1;
    draw?.(x, y);
  };
  cell(C.asphalt, '#2b2d38', undefined, 90, '#000');
  cell(C.lane, '#2b2d38', (x, y) => {
    g.fillStyle = '#c9b458';
    for (let k = 0; k < 2; k++) g.fillRect(x + 61, y + 6 + k * 32, 3, 18);
    g.fillStyle = '#1e2029';
    g.fillRect(x, y, 2, CELL);
  }, 90, '#000');
  cell(C.sidewalk, '#5a5d6e', (x, y) => {
    g.strokeStyle = '#474a59';
    g.lineWidth = 1;
    for (let k = 0; k <= 4; k++) {
      g.strokeRect(x + k * 16 + 0.5, y + 0.5, 16, CELL - 1);
      g.strokeRect(x + 0.5, y + k * 16 + 0.5, CELL - 1, 16);
    }
  }, 40, '#000');
  cell(C.grass, '#225a3a', undefined, 160, '#7dff9a');
  cell(C.plaza, '#3b3d4a', (x, y) => {
    g.fillStyle = '#6a6d80';
    for (let k = 0; k < 3; k++) g.fillRect(x + 10 + k * 22, y + 4, 2, 24);
  }, 60, '#000');
  cell(C.water, '#0d2f52', (x, y) => {
    g.strokeStyle = '#2a6aa0';
    g.lineWidth = 1.5;
    for (let k = 0; k < 5; k++) {
      const wx = x + 4 + rnd() * 40;
      const wy = y + 6 + k * 12;
      g.beginPath();
      g.moveTo(wx, wy);
      g.quadraticCurveTo(wx + 6, wy - 3, wx + 14, wy);
      g.stroke();
    }
  });
  for (let v = 0; v < 4; v++)
    cell(C.roof + v, '#b4b7c4', (x, y) => {
      g.fillStyle = '#9093a2';
      if (v === 0) g.fillRect(x + 12, y + 12, 18, 14);
      if (v === 1) {
        g.fillRect(x + 36, y + 30, 16, 20);
        g.fillStyle = '#6f7282';
        g.beginPath();
        g.arc(x + 20, y + 20, 7, 0, 7);
        g.fill();
      }
      if (v === 2) for (let k = 0; k < 4; k++) g.fillRect(x + 8, y + 8 + k * 13, 48, 3);
      if (v === 3) {
        g.fillStyle = '#7fb8d8';
        g.fillRect(x + 18, y + 18, 28, 28);
        g.strokeStyle = '#6f7282';
        g.strokeRect(x + 18.5, y + 18.5, 27, 27);
      }
    }, 50, '#000');
  for (let v = 0; v < 4; v++)
    cell(C.wall + v, '#3a3d4c', (x, y) => {
      const cols = v === 2 ? 3 : 4;
      const ww = v === 1 ? 10 : 8;
      for (let r = 0; r < 2; r++)
        for (let c = 0; c < cols; c++) {
          const lit = rnd() < (v === 3 ? 0.65 : 0.35);
          g.fillStyle = lit ? (rnd() < 0.5 ? '#ffe9a8' : '#bff4ff') : '#1c2030';
          g.fillRect(x + 5 + c * (CELL / cols), y + 7 + r * 32, ww, v === 1 ? 20 : 14);
        }
    });
  cell(C.white, '#ffffff');
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

export function softTexture(inner = 'rgba(255,255,255,1)', mid = 'rgba(255,255,255,0.35)'): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const g = cv.getContext('2d')!;
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, inner);
  gr.addColorStop(0.4, mid);
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

type RGB = [number, number, number];
const PAL: { walls: RGB[]; roofs: RGB[]; neon: RGB[] }[] = [
  { walls: [[1, 0.62, 0.48], [0.95, 0.75, 0.55], [0.85, 0.55, 0.55], [1, 0.8, 0.6]], roofs: [[0.62, 0.42, 0.36], [0.55, 0.47, 0.42], [0.66, 0.52, 0.4]], neon: [[1, 0.69, 0.13], [1, 0.3, 0.5]] },
  { walls: [[0.55, 0.8, 1], [0.6, 0.95, 1], [0.7, 0.7, 1], [0.5, 0.72, 0.95]], roofs: [[0.32, 0.4, 0.55], [0.3, 0.46, 0.52], [0.38, 0.38, 0.58]], neon: [[0.21, 0.88, 1], [1, 0.24, 0.6]] },
  { walls: [[0.7, 1, 0.7], [0.92, 0.98, 0.8], [0.65, 0.88, 0.76]], roofs: [[0.36, 0.52, 0.42], [0.48, 0.54, 0.42], [0.32, 0.48, 0.48]], neon: [[0.36, 1, 0.48], [0.7, 0.45, 1]] },
];

class Builder {
  pos: number[] = [];
  uv: number[] = [];
  col: number[] = [];
  idx: number[] = [];
  /** Corners in order TL, TR, BR, BL; top colour for the first two, bottom for the rest. */
  quad(p: number[], cell: number, rot: number, top: RGB, bot: RGB = top) {
    const b = this.pos.length / 3;
    this.pos.push(...p);
    const cx = (cell % GRID) * CELL;
    const cy = Math.floor(cell / GRID) * CELL;
    const u0 = (cx + 1.5) / SIZE;
    const u1 = (cx + CELL - 1.5) / SIZE;
    const v1 = 1 - (cy + 1.5) / SIZE;
    const v0 = 1 - (cy + CELL - 1.5) / SIZE;
    const uvs = [u0, v1, u1, v1, u1, v0, u0, v0];
    for (let i = 0; i < 4; i++) {
      const k = (i - rot + 4) % 4;
      this.uv.push(uvs[k * 2], uvs[k * 2 + 1]);
      const c = i < 2 ? top : bot;
      this.col.push(c[0], c[1], c[2]);
    }
    this.idx.push(b, b + 3, b + 2, b, b + 2, b + 1);
  }
  mesh(mat: THREE.Material): THREE.Mesh {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return new THREE.Mesh(g, mat);
  }
}

const mul = (c: RGB, k: number): RGB => [c[0] * k, c[1] * k, c[2] * k];

export interface CityView {
  group: THREE.Group;
  updateLights(time: number): void;
}

export function buildCityMesh(city: City): CityView {
  const group = new THREE.Group();
  const atlas = makeAtlas();
  const mat = new THREE.MeshBasicMaterial({ map: atlas, vertexColors: true, side: THREE.DoubleSide });
  const glowMat = new THREE.MeshBasicMaterial({ map: softTexture(), vertexColors: true, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, side: THREE.DoubleSide });
  const CH = 16;
  const hAt = (tx: number, ty: number) => (tileAt(city, tx, ty) === T.Building ? city.height[ty * city.w + tx] : 0);
  const lotAt = (tx: number, ty: number) => (tx < 0 || ty < 0 || tx >= city.w || ty >= city.h ? 0 : city.lot[ty * city.w + tx]);

  for (let cy = 0; cy < city.h; cy += CH)
    for (let cx = 0; cx < city.w; cx += CH) {
      const b = new Builder();
      const gl = new Builder();
      for (let ty = cy; ty < cy + CH && ty < city.h; ty++)
        for (let tx = cx; tx < cx + CH && tx < city.w; tx++) {
          const i = ty * city.w + tx;
          const t = city.tiles[i];
          const d = city.district[i];
          const x0 = tx * TILE;
          const x1 = x0 + TILE;
          const z0 = ty * TILE;
          const z1 = z0 + TILE;
          const hv = 0.9 + hash2(tx, ty) * 0.12;
          if (t !== T.Building) {
            let cell: number = C.asphalt;
            let rot = 0;
            let tint: RGB = [hv, hv, hv];
            if (t === T.Road) {
              const vi = city.vIdx[tx];
              const hi = city.hIdx[ty];
              if (vi >= 0 && hi < 0) {
                cell = C.lane;
                rot = tx === city.vRoads[vi] ? 0 : 2;
              } else if (hi >= 0 && vi < 0) {
                cell = C.lane;
                rot = ty === city.hRoads[hi] ? 1 : 3;
              } else if (vi >= 0 && tileAt(city, tx, ty - 1) !== T.Road && tileAt(city, tx, ty + 1) === T.Road && hi < 0) cell = C.lane;
            } else if (t === T.Sidewalk) {
              cell = C.sidewalk;
              const n = PAL[d].neon[0];
              tint = [hv * (0.9 + n[0] * 0.1), hv * (0.9 + n[1] * 0.1), hv * (0.9 + n[2] * 0.1)];
            } else if (t === T.Park) cell = C.grass;
            else if (t === T.Plaza) {
              cell = C.plaza;
              rot = hash2(ty, tx) > 0.5 ? 1 : 0;
            } else if (t === T.Water) cell = C.water;
            b.quad([x0, 0, z0, x1, 0, z0, x1, 0, z1, x0, 0, z1], cell, rot, tint);
            // Street lamps along the kerb.
            if (t === T.Sidewalk && (tx * 3 + ty * 5) % 6 === 0) {
              const s = 9;
              const mx = x0 + 2;
              const mz = z0 + 2;
              gl.quad([mx - s, 0.06, mz - s, mx + s, 0.06, mz - s, mx + s, 0.06, mz + s, mx - s, 0.06, mz + s], 0, 0, [0.55, 0.42, 0.26]);
            }
            continue;
          }
          const h = city.height[i];
          const lot = city.lot[i];
          const pal = PAL[d];
          const wall = pal.walls[lot % pal.walls.length];
          const roof = mul(pal.roofs[lot % pal.roofs.length], 0.85 + hash2(lot, 7) * 0.3);
          const neonLot = hash2(lot, 3) < 0.4;
          const neon = pal.neon[lot % 2];
          const wallCell = C.wall + (lot % 4);
          b.quad([x0, h, z0, x1, h, z0, x1, h, z1, x0, h, z1], C.roof + (lot % 4), (lot >> 2) % 4, roof);
          const sides: [number, number, number, (y0: number, y1: number) => number[]][] = [
            [0, -1, 0.5, (a, c) => [x0, c, z0, x1, c, z0, x1, a, z0, x0, a, z0]],
            [0, 1, 1.0, (a, c) => [x1, c, z1, x0, c, z1, x0, a, z1, x1, a, z1]],
            [-1, 0, 0.66, (a, c) => [x0, c, z1, x0, c, z0, x0, a, z0, x0, a, z1]],
            [1, 0, 0.82, (a, c) => [x1, c, z0, x1, c, z1, x1, a, z1, x1, a, z0]],
          ];
          for (const [ox, oy, shade, f] of sides) {
            const nh = hAt(tx + ox, ty + oy);
            for (let y = nh; y < h; y += 4) {
              const k0 = shade * (0.5 + (0.5 * y) / h);
              const k1 = shade * (0.5 + (0.5 * (y + 4)) / h);
              b.quad(f(y, y + 4), wallCell, 0, mul(wall, k1), mul(wall, k0));
            }
            // Parapet / neon trim where the roof ends.
            if (lotAt(tx + ox, ty + oy) !== lot) {
              const w = 0.35;
              const y = h + 0.05;
              const col: RGB = neonLot ? mul(neon, 1.6) : mul(roof, 1.5);
              const p =
                oy === -1 ? [x0, y, z0, x1, y, z0, x1, y, z0 + w, x0, y, z0 + w]
                : oy === 1 ? [x0, y, z1 - w, x1, y, z1 - w, x1, y, z1, x0, y, z1]
                : ox === -1 ? [x0, y, z0, x0 + w, y, z0, x0 + w, y, z1, x0, y, z1]
                : [x1 - w, y, z0, x1, y, z0, x1, y, z1, x1 - w, y, z1];
              b.quad(p, C.white, 0, col);
              // Neon spill onto the pavement.
              if (neonLot && nh === 0 && (tx + ty) % 2 === 0) {
                const s = 7;
                const mx = x0 + 2 + ox * 3;
                const mz = z0 + 2 + oy * 3;
                gl.quad([mx - s, 0.07, mz - s, mx + s, 0.07, mz - s, mx + s, 0.07, mz + s, mx - s, 0.07, mz + s], 0, 0, mul(neon, 0.38));
              }
            }
          }
        }
      if (b.idx.length) group.add(b.mesh(mat));
      if (gl.idx.length) {
        const m = gl.mesh(glowMat);
        // Glow quads use the whole soft texture, not an atlas cell.
        const uv = m.geometry.getAttribute('uv') as THREE.BufferAttribute;
        for (let i = 0; i < uv.count; i += 4) {
          uv.setXY(i, 0, 1);
          uv.setXY(i + 1, 1, 1);
          uv.setXY(i + 2, 1, 0);
          uv.setXY(i + 3, 0, 0);
        }
        m.renderOrder = 1;
        group.add(m);
      }
    }

  // Traffic lights: a glowing stop bar on each approach.
  const bars: { vi: number; hi: number; ns: boolean }[] = [];
  const dummy = new THREE.Object3D();
  const geo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const lights = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ toneMapped: false }), city.vRoads.length * city.hRoads.length * 4);
  let n = 0;
  const add = (x: number, z: number, sx: number, sz: number, vi: number, hi: number, ns: boolean) => {
    dummy.position.set(x, 0.05, z);
    dummy.scale.set(sx, 1, sz);
    dummy.updateMatrix();
    lights.setMatrixAt(n, dummy.matrix);
    lights.setColorAt(n, new THREE.Color(0x00ff00));
    bars.push({ vi, hi, ns });
    n++;
  };
  city.vRoads.forEach((vx, vi) =>
    city.hRoads.forEach((hy, hi) => {
      if (tileAt(city, vx, hy) !== T.Road) return;
      if (tileAt(city, vx, hy - 1) === T.Road) add((vx + 0.5) * TILE, hy * TILE - 0.6, 3.2, 0.45, vi, hi, true);
      if (tileAt(city, vx + 1, hy + 2) === T.Road) add((vx + 1.5) * TILE, (hy + 2) * TILE + 0.6, 3.2, 0.45, vi, hi, true);
      if (tileAt(city, vx - 1, hy + 1) === T.Road) add(vx * TILE - 0.6, (hy + 1.5) * TILE, 0.45, 3.2, vi, hi, false);
      if (tileAt(city, vx + 2, hy) === T.Road) add((vx + 2) * TILE + 0.6, (hy + 0.5) * TILE, 0.45, 3.2, vi, hi, false);
    }),
  );
  lights.count = n;
  lights.frustumCulled = false;
  group.add(lights);
  const green = new THREE.Color(0x30ff70);
  const red = new THREE.Color(0xff2a3a);
  let lastKey = -1;
  return {
    group,
    updateLights(time: number) {
      const key = Math.floor(time);
      if (key === lastKey) return;
      lastKey = key;
      for (let i = 0; i < bars.length; i++) {
        const s = lightState(bars[i].vi, bars[i].hi, time);
        lights.setColorAt(i, s === (bars[i].ns ? 0 : 1) ? green : red);
      }
      if (lights.instanceColor) lights.instanceColor.needsUpdate = true;
    },
  };
}
