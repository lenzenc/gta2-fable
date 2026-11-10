import { City, T } from '../world/city';

/** Breadth-first distance field from one tile; pursuers descend it to reach the player. */
export class FlowField {
  dist: Int16Array;
  private q: Int32Array;
  private w: number;
  private h: number;
  constructor(private city: City) {
    this.w = city.w;
    this.h = city.h;
    this.dist = new Int16Array(this.w * this.h).fill(-1);
    this.q = new Int32Array(this.w * this.h);
  }
  compute(tx: number, ty: number, maxDist = 64) {
    const { w, h, dist, q } = this;
    const tiles = this.city.tiles;
    dist.fill(-1);
    if (tx < 0 || ty < 0 || tx >= w || ty >= h) return;
    let head = 0;
    let tail = 0;
    dist[ty * w + tx] = 0;
    q[tail++] = ty * w + tx;
    while (head < tail) {
      const i = q[head++];
      const d = dist[i];
      if (d >= maxDist) continue;
      const x = i % w;
      const y = (i / w) | 0;
      for (let k = 0; k < 4; k++) {
        const nx = x + (k === 0 ? 1 : k === 2 ? -1 : 0);
        const ny = y + (k === 1 ? 1 : k === 3 ? -1 : 0);
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = ny * w + nx;
        if (dist[j] >= 0) continue;
        const t = tiles[j];
        if (t === T.Building || t === T.Water) continue;
        dist[j] = d + 1;
        q[tail++] = j;
      }
    }
  }
  /** Neighbouring tile one step closer to the source, or null. */
  next(tx: number, ty: number): [number, number] | null {
    const { w, h, dist } = this;
    if (tx < 0 || ty < 0 || tx >= w || ty >= h) return null;
    let best = dist[ty * w + tx];
    if (best < 0) best = 32767;
    let bx = -1;
    let by = -1;
    for (let k = 0; k < 4; k++) {
      const nx = tx + (k === 0 ? 1 : k === 2 ? -1 : 0);
      const ny = ty + (k === 1 ? 1 : k === 3 ? -1 : 0);
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const d = dist[ny * w + nx];
      if (d >= 0 && d < best) {
        best = d;
        bx = nx;
        by = ny;
      }
    }
    return bx < 0 ? null : [bx, by];
  }
}
