import * as THREE from 'three';
import { FACTIONS, isPolice } from '../data/defs';
import type { Game } from '../sim/game';
import type { GameEvent, Ped, Vehicle } from '../sim/types';
import { Vec } from '../world/city';
import { buildCityMesh, CityView, softTexture } from '../world/cityMesh';

const FLAT = () => new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);

interface P {
  x: number; y: number; z: number; vx: number; vy: number; vz: number; life: number; max: number; size: number; grow: number; r: number; g: number; b: number;
}
class Particles {
  mesh: THREE.InstancedMesh;
  list: P[] = [];
  private m = new THREE.Matrix4();
  private c = new THREE.Color();
  constructor(private max: number, private additive: boolean, tex: THREE.Texture, opacity: number) {
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, opacity, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending });
    this.mesh = new THREE.InstancedMesh(FLAT(), mat, max);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.renderOrder = additive ? 4 : 3;
  }
  add(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, size: number, grow: number, col: number) {
    if (this.list.length >= this.max) this.list.shift();
    this.list.push({ x, y, z, vx, vy, vz, life, max: life, size, grow, r: ((col >> 16) & 255) / 255, g: ((col >> 8) & 255) / 255, b: (col & 255) / 255 });
  }
  update(dt: number) {
    const l = this.list;
    for (let i = l.length - 1; i >= 0; i--) {
      const p = l[i];
      p.life -= dt;
      if (p.life <= 0) {
        l[i] = l[l.length - 1];
        l.pop();
        continue;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      p.size += p.grow * dt;
    }
    for (let i = 0; i < l.length; i++) {
      const p = l[i];
      const f = p.life / p.max;
      const s = this.additive ? p.size : p.size * Math.min(1, f * 3);
      this.m.makeScale(s, 1, s);
      this.m.setPosition(p.x, Math.max(0.1, p.z), p.y);
      this.mesh.setMatrixAt(i, this.m);
      const k = this.additive ? f : 1;
      this.mesh.setColorAt(i, this.c.setRGB(p.r * k, p.g * k, p.b * k));
    }
    this.mesh.count = l.length;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}

interface VehView {
  g: THREE.Group;
  bodyMat: THREE.MeshLambertMaterial;
  mats: THREE.MeshLambertMaterial[];
  lamps: THREE.Object3D[];
  beam: THREE.Mesh;
  bars: THREE.Mesh[];
  flash: THREE.Mesh | null;
  color: number;
  wreck: boolean;
}
interface PedView {
  g: THREE.Group;
  feet: THREE.Mesh[];
  arms: THREE.Mesh[];
  gun: THREE.Mesh;
  blood: THREE.Mesh;
  dead: boolean;
}

function labelTexture(text: string, color: string): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = 256;
  cv.height = 96;
  const g = cv.getContext('2d')!;
  g.font = '700 54px "Avenir Next Condensed","Arial Narrow",sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.shadowColor = color;
  g.shadowBlur = 16;
  g.fillStyle = color;
  g.fillText(text, 128, 50);
  g.fillStyle = '#fff';
  g.shadowBlur = 0;
  g.globalAlpha = 0.7;
  g.fillText(text, 128, 50);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const PICK_STYLE: Record<string, [string, string]> = {
  pistol: ['SIDE', '#35e0ff'], smg: ['BUZZ', '#35e0ff'], shotgun: ['SCAT', '#35e0ff'], flamer: ['TORCH', '#ff8a2a'], rocket: ['LANCE', '#ff3d6a'],
  grenade: ['PINE', '#ff3d6a'], health: ['+', '#5dff7a'], armor: ['ARM', '#6a8cff'], cash: ['$', '#ffd21f'], package: ['PKG', '#ff3d9a'],
};

export class Renderer {
  three: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(50, 1, 1, 400);
  cx = 0;
  cy = 0;
  ch = 44;
  private city: CityView;
  private vehs = new Map<number, VehView>();
  private peds = new Map<number, PedView>();
  private picks = new Map<number, THREE.Mesh>();
  private pickTex = new Map<string, THREE.Texture>();
  private lambert = new Map<number, THREE.MeshLambertMaterial>();
  private basic = new Map<number, THREE.MeshBasicMaterial>();
  private box = new THREE.BoxGeometry(1, 1, 1);
  private sphere = new THREE.SphereGeometry(1, 10, 8);
  private flat = FLAT();
  private fire: Particles;
  private smoke: Particles;
  private bullets: THREE.InstancedMesh;
  private skids: THREE.InstancedMesh;
  private skidN = 0;
  private beamTex: THREE.Texture;
  private soft: THREE.Texture;
  private shadowMat: THREE.MeshBasicMaterial;
  private bloodMat: THREE.MeshBasicMaterial;
  private objective: THREE.Mesh;
  private playerRing: THREE.Mesh;
  private targetRings: THREE.Mesh[] = [];
  private zoneRings: THREE.Mesh[] = [];
  private dummy = new THREE.Object3D();
  private col = new THREE.Color();
  private ray = new THREE.Raycaster();
  private t = 0;

  constructor(canvas: HTMLCanvasElement, game: Game) {
    this.three = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.three.setPixelRatio(Math.min(2, window.devicePixelRatio));
    this.scene.background = new THREE.Color(0x071a2e);
    this.scene.add(new THREE.HemisphereLight(0xaab8ff, 0x30304a, 1.5));
    const sun = new THREE.DirectionalLight(0xffffff, 1.4);
    sun.position.set(-0.5, 1, -0.35);
    this.scene.add(sun);
    this.camera.up.set(0, 0, -1);
    this.city = buildCityMesh(game.city);
    this.scene.add(this.city.group);
    this.soft = softTexture();
    this.fire = new Particles(700, true, this.soft, 1);
    this.smoke = new Particles(400, false, softTexture('rgba(255,255,255,0.9)', 'rgba(255,255,255,0.5)'), 0.5);
    this.scene.add(this.smoke.mesh, this.fire.mesh);

    this.bullets = new THREE.InstancedMesh(this.box, new THREE.MeshBasicMaterial(), 256);
    this.bullets.frustumCulled = false;
    this.bullets.count = 0;
    this.scene.add(this.bullets);
    this.skids = new THREE.InstancedMesh(FLAT(), new THREE.MeshBasicMaterial({ color: 0x08080c, transparent: true, opacity: 0.4, depthWrite: false }), 900);
    this.skids.frustumCulled = false;
    this.skids.count = 0;
    this.scene.add(this.skids);

    const bc = document.createElement('canvas');
    bc.width = 128;
    bc.height = 64;
    const bg = bc.getContext('2d')!;
    const gr = bg.createLinearGradient(0, 0, 128, 0);
    gr.addColorStop(0, 'rgba(255,240,200,0.75)');
    gr.addColorStop(1, 'rgba(255,240,200,0)');
    bg.fillStyle = gr;
    bg.beginPath();
    bg.moveTo(0, 22);
    bg.lineTo(128, 0);
    bg.lineTo(128, 64);
    bg.lineTo(0, 42);
    bg.fill();
    this.beamTex = new THREE.CanvasTexture(bc);
    this.shadowMat = new THREE.MeshBasicMaterial({ color: 0, transparent: true, opacity: 0.4, depthWrite: false });
    this.bloodMat = new THREE.MeshBasicMaterial({ color: 0x6a0812, transparent: true, opacity: 0.8, depthWrite: false, map: softTexture('rgba(255,255,255,1)', 'rgba(255,255,255,0.9)') });

    const ring = (color: number, r: number) => {
      const m = new THREE.Mesh(new THREE.RingGeometry(r * 0.78, r, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      m.renderOrder = 2;
      this.scene.add(m);
      return m;
    };
    this.objective = ring(0xffd21f, 3);
    this.playerRing = ring(0x35e0ff, 0.75);
    for (let i = 0; i < 8; i++) this.targetRings.push(ring(0xff2a3a, 1.3));
    game.city.anchors.forEach((a, d) => {
      const defs: [Vec, number, string, string][] = [
        [a.terminal, FACTIONS[d].color, 'JOBS', FACTIONS[d].css],
        [a.safehouse, 0xe8ecff, 'SAFE', '#e8ecff'],
        [a.paint, 0xff3d9a, 'PAINT', '#ff3d9a'],
      ];
      for (const [p, color, text, css] of defs) {
        const r = ring(color, 2.4);
        r.position.set(p.x, 0.1, p.y);
        this.zoneRings.push(r);
        const lab = new THREE.Mesh(this.flat, new THREE.MeshBasicMaterial({ map: labelTexture(text, css), transparent: true, depthWrite: false }));
        lab.scale.set(5, 1, 1.9);
        lab.position.set(p.x, 0.12, p.y - 3.4);
        lab.renderOrder = 2;
        this.scene.add(lab);
      }
    });
    this.cx = game.player.x;
    this.cy = game.player.y;
    this.resize();
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.three.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  screenToWorld(sx: number, sy: number): Vec {
    const ndc = new THREE.Vector2((sx / window.innerWidth) * 2 - 1, -(sy / window.innerHeight) * 2 + 1);
    this.ray.setFromCamera(ndc, this.camera);
    const o = this.ray.ray.origin;
    const d = this.ray.ray.direction;
    const t = -o.y / d.y;
    return { x: o.x + d.x * t, y: o.z + d.z * t };
  }

  private lam(color: number) {
    let m = this.lambert.get(color);
    if (!m) this.lambert.set(color, (m = new THREE.MeshLambertMaterial({ color })));
    return m;
  }
  private bas(color: number) {
    let m = this.basic.get(color);
    if (!m) this.basic.set(color, (m = new THREE.MeshBasicMaterial({ color })));
    return m;
  }
  private part(parent: THREE.Object3D, mat: THREE.Material, sx: number, sy: number, sz: number, x: number, y: number, z: number, geo: THREE.BufferGeometry = this.box) {
    const m = new THREE.Mesh(geo, mat);
    m.scale.set(sx, sy, sz);
    m.position.set(x, y, z);
    parent.add(m);
    return m;
  }

  private buildVehicle(v: Vehicle): VehView {
    const d = v.def;
    const g = new THREE.Group();
    const bodyMat = new THREE.MeshLambertMaterial({ color: v.color });
    const glass = new THREE.MeshLambertMaterial({ color: 0x101824 });
    const mats = [bodyMat, glass];
    const k = d.kind;
    const big = k === 'van' || k === 'tactical' || k === 'enforcer';
    const bh = k === 'bus' ? 1.0 : big ? 0.9 : k === 'sports' ? 0.45 : 0.55;
    const [cl, co, chh] = k === 'bus' ? [0.94, 0, 0.8] : big ? [0.76, -0.08, 0.75] : k === 'pickup' ? [0.3, 0.1, 0.55] : k === 'sports' ? [0.4, -0.1, 0.4] : [0.48, -0.06, 0.5];
    const base = 0.3;
    this.part(g, this.shadowMat, d.len + 0.9, 1, d.wid + 0.9, 0, 0.03, 0, this.flat);
    this.part(g, bodyMat, d.len, bh, d.wid, 0, base + bh / 2, 0);
    this.part(g, glass, d.len * cl, chh, d.wid * 0.88, d.len * co, base + bh + chh / 2, 0);
    let roofMat: THREE.MeshLambertMaterial = bodyMat;
    if (k === 'patrol') mats.push((roofMat = new THREE.MeshLambertMaterial({ color: 0xe8ecf4 })));
    this.part(g, roofMat, d.len * cl * 0.84, 0.07, d.wid * 0.8, d.len * co, base + bh + chh + 0.035, 0);
    if (k === 'pickup') {
      const bed = new THREE.MeshLambertMaterial({ color: 0x1a1c22 });
      mats.push(bed);
      this.part(g, bed, d.len * 0.42, 0.1, d.wid * 0.82, -d.len * 0.24, base + bh + 0.05, 0);
    }
    const lamps: THREE.Object3D[] = [];
    for (const s of [-1, 1]) {
      lamps.push(this.part(g, this.bas(0xfff4c8), 0.1, 0.2, 0.42, d.len / 2 + 0.01, base + bh * 0.6, s * d.wid * 0.32));
      lamps.push(this.part(g, this.bas(0xff2030), 0.1, 0.2, 0.42, -d.len / 2 - 0.01, base + bh * 0.6, s * d.wid * 0.32));
    }
    if (k === 'taxi') lamps.push(this.part(g, this.bas(0xffe14a), 0.5, 0.22, 0.9, d.len * co, base + bh + chh + 0.18, 0));
    const beam = this.part(g, new THREE.MeshBasicMaterial({ map: this.beamTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.55 }), 12, 1, 7, d.len / 2 + 6, 0.09, 0, this.flat);
    beam.renderOrder = 2;
    lamps.push(beam);
    const bars: THREE.Mesh[] = [];
    let flash: THREE.Mesh | null = null;
    if (isPolice(d)) {
      const y = base + bh + chh + 0.15;
      bars.push(this.part(g, new THREE.MeshBasicMaterial({ color: 0xff2030 }), 0.4, 0.16, d.wid * 0.36, d.len * co, y, -d.wid * 0.2));
      bars.push(this.part(g, new THREE.MeshBasicMaterial({ color: 0x3060ff }), 0.4, 0.16, d.wid * 0.36, d.len * co, y, d.wid * 0.2));
      flash = this.part(g, new THREE.MeshBasicMaterial({ map: this.soft, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }), 16, 1, 16, 0, 0.1, 0, this.flat);
      flash.renderOrder = 2;
    }
    this.scene.add(g);
    return { g, bodyMat, mats, lamps, beam, bars, flash, color: v.color, wreck: false };
  }

  private buildPed(p: Ped): PedView {
    const g = new THREE.Group();
    const inner = new THREE.Group();
    inner.scale.setScalar(1.3);
    g.add(inner);
    const cloth = p.kind === 'gang' || p.kind === 'target' ? this.lam(FACTIONS[Math.max(0, p.faction)].color) : this.lam(p.kind === 'player' ? 0xf4f6ff : p.color);
    const skin = this.lam(p.skin);
    const dark = this.lam(0x20222a);
    const feet = [this.part(inner, dark, 0.3, 0.2, 0.17, 0, 0.12, -0.14), this.part(inner, dark, 0.3, 0.2, 0.17, 0, 0.12, 0.14)];
    this.part(inner, cloth, 0.34, 0.6, 0.64, 0, 1.0, 0);
    const arms = [this.part(inner, cloth, 0.3, 0.2, 0.16, 0.05, 1.05, -0.4), this.part(inner, cloth, 0.3, 0.2, 0.16, 0.05, 1.05, 0.4)];
    this.part(inner, skin, 0.2, 0.2, 0.2, 0.02, 1.55, 0, this.sphere);
    if (p.kind === 'cop') this.part(inner, this.lam(0x101830), 0.24, 0.1, 0.24, 0, 1.72, 0, this.sphere);
    else if (p.kind === 'player') this.part(inner, this.lam(0xff3d9a), 0.22, 0.1, 0.22, -0.02, 1.72, 0, this.sphere);
    else this.part(inner, this.lam([0x2a1c12, 0x111111, 0x8a6a3a, 0x5a2a1a][p.id % 4]), 0.2, 0.1, 0.2, -0.03, 1.7, 0, this.sphere);
    const gun = this.part(inner, dark, 0.55, 0.09, 0.09, 0.5, 1.05, 0.34);
    const blood = this.part(g, this.bloodMat, 0.1, 1, 0.1, 0, 0.04, 0, this.flat);
    blood.visible = false;
    blood.renderOrder = 1;
    this.scene.add(g);
    return { g, feet, arms, gun, blood, dead: false };
  }

  private pickup(kind: string): THREE.Mesh {
    let tex = this.pickTex.get(kind);
    if (!tex) {
      const [label, color] = PICK_STYLE[kind] ?? ['?', '#fff'];
      const cv = document.createElement('canvas');
      cv.width = cv.height = 96;
      const g = cv.getContext('2d')!;
      g.fillStyle = 'rgba(8,10,18,0.85)';
      g.strokeStyle = color;
      g.lineWidth = 6;
      g.shadowColor = color;
      g.shadowBlur = 10;
      g.beginPath();
      g.roundRect(10, 10, 76, 76, 14);
      g.fill();
      g.stroke();
      g.shadowBlur = 0;
      g.fillStyle = color;
      g.font = `800 ${label.length > 3 ? 22 : label.length > 1 ? 30 : 50}px "Avenir Next Condensed","Arial Narrow",sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(label, 48, 50);
      tex = new THREE.CanvasTexture(cv);
      tex.colorSpace = THREE.SRGBColorSpace;
      this.pickTex.set(kind, tex);
    }
    const m = new THREE.Mesh(this.flat, new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
    m.renderOrder = 2;
    this.scene.add(m);
    return m;
  }

  /** Turn a simulation event into particles. */
  fx(e: GameEvent) {
    const R = Math.random;
    if (e.type === 'shot') {
      if (e.s === 'flamer') return;
      this.fire.add(e.x + Math.cos(e.a) * 0.4, e.y + Math.sin(e.a) * 0.4, 1.4, 0, 0, 0, 0.06, e.s === 'shotgun' || e.s === 'rocket' ? 2.6 : 1.6, 0, 0xffd880);
    } else if (e.type === 'explosion') {
      for (let i = 0; i < 28; i++) {
        const a = R() * 6.28;
        const s = R() * e.n * 1.6;
        this.fire.add(e.x, e.y, 1 + R() * 2, Math.cos(a) * s, Math.sin(a) * s, R() * 3, 0.35 + R() * 0.55, 2.5 + R() * 3, 3, R() < 0.5 ? 0xff9a30 : 0xffd060);
      }
      this.fire.add(e.x, e.y, 2, 0, 0, 0, 0.18, e.n * 3.2, 10, 0xfff0c0);
      for (let i = 0; i < 12; i++) {
        const a = R() * 6.28;
        const s = R() * 3;
        this.smoke.add(e.x, e.y, 2 + R() * 2, Math.cos(a) * s, Math.sin(a) * s, 2, 1.2 + R() * 1.2, 3 + R() * 2, 2, 0x1a1a20);
      }
      for (let i = 0; i < 14; i++) {
        const a = R() * 6.28;
        const s = 8 + R() * 14;
        this.fire.add(e.x, e.y, 1, Math.cos(a) * s, Math.sin(a) * s, 0, 0.3 + R() * 0.4, 0.5, 0, 0xffe080);
      }
    } else if (e.type === 'hit') {
      const blood = e.s === 'blood';
      for (let i = 0; i < (blood ? 5 : 4); i++) {
        const a = R() * 6.28;
        const s = 1 + R() * (blood ? 2.5 : 7);
        if (blood) this.smoke.add(e.x, e.y, 1, Math.cos(a) * s, Math.sin(a) * s, 0, 0.35, 0.55, 0, 0xb0101c);
        else this.fire.add(e.x, e.y, 1, Math.cos(a) * s, Math.sin(a) * s, 0, 0.18, 0.45, 0, 0xffe080);
      }
    } else if (e.type === 'crash') {
      for (let i = 0; i < Math.min(12, 3 + e.n); i++) {
        const a = R() * 6.28;
        const s = 3 + R() * 8;
        this.fire.add(e.x, e.y, 0.8, Math.cos(a) * s, Math.sin(a) * s, 0, 0.25, 0.4, 0, 0xffc860);
      }
    } else if (e.type === 'splash') {
      for (let i = 0; i < 18; i++) {
        const a = R() * 6.28;
        const s = 1 + R() * 5;
        this.smoke.add(e.x, e.y, 0.5, Math.cos(a) * s, Math.sin(a) * s, 0, 0.8, 1.2 + R(), 1, 0x9fd0ff);
      }
    } else if (e.type === 'pickup') {
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * 6.28;
        this.fire.add(e.x, e.y, 1, Math.cos(a) * 4, Math.sin(a) * 4, 0, 0.3, 0.6, 0, 0x80f0ff);
      }
    }
  }

  render(game: Game, dt: number) {
    this.t += dt;
    const t = this.t;
    const pl = game.player;
    const pv = game.pv;

    // Camera: straight down, pulling back with speed.
    const sp = pv ? Math.hypot(pv.vx, pv.vy) : 0;
    const lead = pv ? 0.45 : 0;
    const tx = pl.x + (pv ? pv.vx * lead : 0);
    const ty = pl.y + (pv ? pv.vy * lead : 0);
    const k = Math.min(1, dt * 5);
    this.cx += (tx - this.cx) * k;
    this.cy += (ty - this.cy) * k;
    this.ch += ((pv ? 50 + sp * 1.15 : 42) - this.ch) * Math.min(1, dt * 1.6);
    this.camera.position.set(this.cx, this.ch, this.cy);
    this.camera.lookAt(this.cx, 0, this.cy);
    this.camera.updateMatrixWorld();
    game.viewRadius = this.ch * Math.tan((25 * Math.PI) / 180) * Math.hypot(this.camera.aspect, 1) + 6;
    this.city.updateLights(game.time);

    // Vehicles.
    const seen = new Set<number>();
    for (const v of game.vehicles) {
      seen.add(v.id);
      let w = this.vehs.get(v.id);
      if (!w) this.vehs.set(v.id, (w = this.buildVehicle(v)));
      w.g.position.set(v.x, 0, v.y);
      w.g.rotation.y = -v.a;
      if (w.color !== v.color && !w.wreck) {
        w.color = v.color;
        w.bodyMat.color.set(v.color);
      }
      if (v.wreck && !w.wreck) {
        w.wreck = true;
        for (const m of w.mats) m.color.set(0x15151a);
        for (const l of w.lamps) l.visible = false;
        for (const b of w.bars) b.visible = false;
        if (w.flash) w.flash.visible = false;
      }
      if (!w.wreck) {
        w.beam.visible = v.driver !== 'none';
        if (w.flash) {
          const on = v.siren;
          const ph = Math.floor(t * 6 + v.id) % 2 === 0;
          w.flash.visible = on;
          (w.flash.material as THREE.MeshBasicMaterial).color.set(ph ? 0xff2030 : 0x3060ff);
          w.bars[0].visible = !on || ph;
          w.bars[1].visible = !on || !ph;
        }
      }
      const c = Math.cos(v.a);
      const s = Math.sin(v.a);
      if (v.fireT > 0) {
        for (let i = 0; i < 2; i++) this.fire.add(v.x + (Math.random() - 0.5) * v.def.len * 0.7, v.y + (Math.random() - 0.5) * v.def.wid, 1.4, 0, 0, 3, 0.4, 1.6 + Math.random(), 1, Math.random() < 0.5 ? 0xff8a20 : 0xffc840);
        if (Math.random() < 0.3) this.smoke.add(v.x, v.y, 2, Math.random() - 0.5, Math.random() - 0.5, 3, 1.4, 2, 2, 0x16161c);
      } else if (!v.wreck && v.hp < v.def.hp * 0.35 && Math.random() < 0.35) {
        this.smoke.add(v.x + c * v.def.len * 0.35, v.y + s * v.def.len * 0.35, 1.2, -v.vx * 0.1, -v.vy * 0.1, 2, 0.9, 1.1, 1.5, v.hp < v.def.hp * 0.15 ? 0x18181c : 0x8a8a94);
      } else if (v.wreck && v.wreckT > 15 && Math.random() < 0.12) this.smoke.add(v.x, v.y, 1.5, 0, 0, 2, 1.5, 1.6, 1.5, 0x202026);
      if (v.skid > 4.5 && Math.hypot(v.vx, v.vy) > 4) {
        for (const side of [-1, 1]) {
          this.dummy.position.set(v.x - c * v.def.len * 0.32 - s * side * v.def.wid * 0.4, 0.02, v.y - s * v.def.len * 0.32 + c * side * v.def.wid * 0.4);
          this.dummy.rotation.set(0, -Math.atan2(v.vy, v.vx), 0);
          this.dummy.scale.set(0.9, 1, 0.28);
          this.dummy.updateMatrix();
          this.skids.setMatrixAt(this.skidN % 900, this.dummy.matrix);
          this.skidN++;
        }
        this.skids.count = Math.min(900, this.skidN);
        this.skids.instanceMatrix.needsUpdate = true;
      }
    }
    for (const [id, w] of this.vehs)
      if (!seen.has(id)) {
        this.scene.remove(w.g);
        for (const m of w.mats) m.dispose();
        this.vehs.delete(id);
      }

    // Pedestrians.
    seen.clear();
    for (const p of game.peds) {
      seen.add(p.id);
      let w = this.peds.get(p.id);
      if (!w) this.peds.set(p.id, (w = this.buildPed(p)));
      const inner = w.g.children[0];
      w.g.position.set(p.x, 0, p.y);
      w.g.visible = !(p === pl && pv);
      const dead = p.state === 'dead';
      if (dead !== w.dead) {
        w.dead = dead;
        inner.scale.set(1.3, dead ? 0.25 : 1.3, 1.3);
        w.blood.visible = dead;
        w.blood.scale.set(0.3, 1, 0.3);
        w.gun.visible = false;
      }
      if (dead) {
        const bs = Math.min(2.4, w.blood.scale.x + dt * 0.8);
        w.blood.scale.set(bs, 1, bs);
        continue;
      }
      inner.rotation.y = -p.a;
      const sw = p.moving ? Math.sin(p.walk) * 0.24 : 0;
      w.feet[0].position.x = sw;
      w.feet[1].position.x = -sw;
      const armed = p === pl ? game.weapon !== 'fists' : p.state === 'attack' && p.weapon !== 'fists';
      w.gun.visible = armed;
      w.arms[0].position.x = 0.05 - sw * 0.8;
      w.arms[1].position.x = armed ? 0.3 : 0.05 + sw * 0.8;
    }
    for (const [id, w] of this.peds)
      if (!seen.has(id)) {
        this.scene.remove(w.g);
        this.peds.delete(id);
      }

    // Pickups.
    seen.clear();
    for (const k2 of game.pickups) {
      if (!k2.active) continue;
      seen.add(k2.id);
      let m = this.picks.get(k2.id);
      if (!m) this.picks.set(k2.id, (m = this.pickup(k2.kind)));
      const s = 1.5 + Math.sin(t * 4 + k2.id) * 0.18;
      m.scale.set(s, 1, s);
      m.position.set(k2.x, 0.3, k2.y);
    }
    for (const [id, m] of this.picks)
      if (!seen.has(id)) {
        this.scene.remove(m);
        (m.material as THREE.Material).dispose();
        this.picks.delete(id);
      }

    // Projectiles.
    let n = 0;
    for (const pr of game.projectiles) {
      if (pr.kind === 'flamer') {
        this.fire.add(pr.x, pr.y, 1.2, pr.vx * 0.3, pr.vy * 0.3, 0.5, 0.16, 0.9 + (0.55 - pr.life) * 3, 4, Math.random() < 0.5 ? 0xff7a18 : 0xffc040);
        continue;
      }
      if (n >= 256) break;
      const rocket = pr.kind === 'rocket';
      const gren = pr.kind === 'grenade';
      this.dummy.position.set(pr.x, 1.3, pr.y);
      this.dummy.rotation.set(0, -Math.atan2(pr.vy, pr.vx), 0);
      this.dummy.scale.set(gren ? 0.3 : rocket ? 1.0 : 1.3, gren ? 0.3 : 0.12, gren ? 0.3 : rocket ? 0.22 : 0.08);
      this.dummy.updateMatrix();
      this.bullets.setMatrixAt(n, this.dummy.matrix);
      this.bullets.setColorAt(n, this.col.set(gren ? 0x2c4a2c : rocket ? 0xd0d0d8 : 0xffe9a0));
      n++;
      if (rocket) this.smoke.add(pr.x, pr.y, 1.3, 0, 0, 0.5, 0.5, 0.7, 1.5, 0xb0b0b8);
    }
    this.bullets.count = n;
    this.bullets.instanceMatrix.needsUpdate = true;
    if (this.bullets.instanceColor) this.bullets.instanceColor.needsUpdate = true;

    // Markers.
    const pulse = 1 + Math.sin(t * 5) * 0.12;
    for (const r of this.zoneRings) r.scale.setScalar(1 + Math.sin(t * 2.5 + r.position.x) * 0.06);
    this.playerRing.visible = !pv && pl.state !== 'dead';
    this.playerRing.position.set(pl.x, 0.08, pl.y);
    const o = game.objective;
    this.objective.visible = !!o;
    if (o) {
      this.objective.position.set(o.x, 0.15, o.y);
      this.objective.scale.setScalar(pulse);
    }
    const m = game.mission;
    let ri = 0;
    if (m) {
      for (const tg of m.targets) if (tg.state !== 'dead' && ri < 8) this.targetRings[ri++].position.set(tg.x, 0.1, tg.y);
      for (const tv of m.targetVs)
        if (!tv.wreck && !tv.remove && ri < 8) {
          this.targetRings[ri].position.set(tv.x, 0.1, tv.y);
          this.targetRings[ri++].scale.setScalar(2.6);
        }
    }
    for (let i = 0; i < 8; i++) {
      this.targetRings[i].visible = i < ri;
      if (i < ri && this.targetRings[i].scale.x < 2) this.targetRings[i].scale.setScalar(pulse);
    }

    this.fire.update(dt);
    this.smoke.update(dt);
    this.three.render(this.scene, this.camera);
  }
}
