import { CASH_GOAL, FACTIONS, WEAPONS } from '../data/defs';
import type { Game } from '../sim/game';
import { HEAT_NAMES } from '../sim/heat';
import { DISTRICT_NAMES, T, TILE } from '../world/city';

const $ = (id: string) => document.getElementById(id)!;
const MAP_PX = 3;

export class Hud {
  private cash = $('cash');
  private goal = $('goal');
  private pips = Array.from($('heat').querySelectorAll<HTMLElement>('i'));
  private heatName = $('heatname');
  private hp = $('hp');
  private armor = $('armor');
  private weapon = $('weapon');
  private rep = [0, 1, 2].map((i) => ({ bar: $('rep' + i), val: $('repv' + i) }));
  private objective = $('objective');
  private timer = $('timer');
  private prompt = $('prompt');
  private bannerEl = $('banner');
  private bannerT = 0;
  private district = $('district');
  private arrow = $('arrow');
  private mini = $('minimap') as HTMLCanvasElement;
  private mctx = this.mini.getContext('2d')!;
  private map: HTMLCanvasElement;
  private shownCash = 0;
  private lastDistrict = -1;
  private districtT = 0;
  private last: Record<string, string> = {};

  constructor(game: Game) {
    const c = game.city;
    this.map = document.createElement('canvas');
    this.map.width = c.w * MAP_PX;
    this.map.height = c.h * MAP_PX;
    const g = this.map.getContext('2d')!;
    const bcol = ['#5a4030', '#2c4a66', '#2f5a40'];
    for (let y = 0; y < c.h; y++)
      for (let x = 0; x < c.w; x++) {
        const t = c.tiles[y * c.w + x];
        g.fillStyle = t === T.Water ? '#0a1c30' : t === T.Road ? '#8a8fa8' : t === T.Building ? bcol[c.district[y * c.w + x]] : t === T.Park ? '#1c5a34' : '#343746';
        g.fillRect(x * MAP_PX, y * MAP_PX, MAP_PX, MAP_PX);
      }
    FACTIONS.forEach((f, i) => {
      $('repn' + i).textContent = f.name;
      $('rep' + i).style.background = f.css;
    });
  }

  private set(el: HTMLElement, key: string, text: string) {
    if (this.last[key] === text) return;
    this.last[key] = text;
    el.textContent = text;
  }

  banner(text: string, sub: string, color: string) {
    this.bannerEl.innerHTML = '';
    const h = document.createElement('h1');
    h.textContent = text;
    h.style.color = color;
    h.style.textShadow = `0 0 24px ${color}`;
    const p = document.createElement('p');
    p.textContent = sub;
    this.bannerEl.append(h, p);
    this.bannerEl.classList.remove('show');
    void this.bannerEl.offsetWidth;
    this.bannerEl.classList.add('show');
    this.bannerT = 3.6;
  }

  update(game: Game, dt: number) {
    const p = game.player;
    this.shownCash += (game.cash - this.shownCash) * Math.min(1, dt * 8);
    if (Math.abs(game.cash - this.shownCash) < 1) this.shownCash = game.cash;
    this.set(this.cash, 'cash', '$' + Math.round(this.shownCash).toString().padStart(7, '0'));
    this.set(this.goal, 'goal', game.won ? 'LEDGER CLOSED' : `GOAL $${CASH_GOAL}`);
    this.pips.forEach((el, i) => el.classList.toggle('on', i < game.heat.level));
    this.set(this.heatName, 'heat', HEAT_NAMES[game.heat.level]);
    $('heat').classList.toggle('hot', game.heat.level > 0);
    this.hp.style.width = Math.max(0, p.hp) + '%';
    this.armor.style.width = Math.max(0, p.armor) + '%';
    const w = WEAPONS[game.weapon];
    this.set(this.weapon, 'weapon', w.melee ? w.name : `${w.name}  ${game.ammo[game.weapon] ?? 0}`);
    game.rep.forEach((r, i) => {
      this.rep[i].bar.style.width = Math.abs(r) / 2 + '%';
      this.rep[i].bar.style.left = r >= 0 ? '50%' : 50 - Math.abs(r) / 2 + '%';
      this.rep[i].bar.style.opacity = r >= 0 ? '1' : '0.45';
      this.set(this.rep[i].val, 'rep' + i, (r > 0 ? '+' : '') + Math.round(r));
    });
    this.set(this.objective, 'obj', game.mission ? game.objectiveText : '');
    const m = game.mission;
    this.set(this.timer, 'timer', m && m.timed ? `${Math.floor(m.timer / 60)}:${Math.floor(m.timer % 60).toString().padStart(2, '0')}` : '');
    this.timer.classList.toggle('low', !!m && m.timed && m.timer < 20);
    this.set(this.prompt, 'prompt', game.prompt);
    this.prompt.style.opacity = game.prompt ? '1' : '0';
    if (this.bannerT > 0) {
      this.bannerT -= dt;
      if (this.bannerT <= 0) this.bannerEl.classList.remove('show');
    }
    const d = game.district();
    if (d !== this.lastDistrict) {
      this.lastDistrict = d;
      this.districtT = 3;
      this.district.textContent = DISTRICT_NAMES[d];
      this.district.style.color = FACTIONS[d].css;
    }
    this.districtT -= dt;
    this.district.style.opacity = this.districtT > 0 ? '1' : '0';

    // Objective arrow around the screen centre.
    const o = game.objective;
    if (o) {
      const dx = o.x - p.x;
      const dy = o.y - p.y;
      const dist = Math.hypot(dx, dy);
      const show = dist > game.viewRadius * 0.45;
      this.arrow.style.opacity = show ? '1' : '0';
      if (show) {
        const a = Math.atan2(dy, dx);
        const r = Math.min(window.innerWidth, window.innerHeight) * 0.36;
        this.arrow.style.transform = `translate(${Math.cos(a) * r}px, ${Math.sin(a) * r}px) rotate(${a}rad)`;
        this.arrow.dataset.d = Math.round(dist) + 'm';
      }
    } else this.arrow.style.opacity = '0';

    this.drawMap(game);
  }

  private drawMap(game: Game) {
    const g = this.mctx;
    const S = this.mini.width;
    const range = 170;
    const sc = S / range;
    const p = game.player;
    const px = (wx: number) => (wx - p.x) * sc + S / 2;
    const py = (wy: number) => (wy - p.y) * sc + S / 2;
    g.fillStyle = '#0a1c30';
    g.fillRect(0, 0, S, S);
    const k = MAP_PX / TILE;
    g.imageSmoothingEnabled = false;
    g.drawImage(this.map, (p.x - range / 2) * k, (p.y - range / 2) * k, range * k, range * k, 0, 0, S, S);
    const dot = (x: number, y: number, r: number, col: string, clampEdge = false) => {
      let X = px(x);
      let Y = py(y);
      if (clampEdge) {
        X = Math.max(5, Math.min(S - 5, X));
        Y = Math.max(5, Math.min(S - 5, Y));
      } else if (X < 0 || Y < 0 || X > S || Y > S) return;
      g.fillStyle = col;
      g.beginPath();
      g.arc(X, Y, r, 0, 7);
      g.fill();
    };
    game.city.anchors.forEach((a, i) => {
      dot(a.terminal.x, a.terminal.y, 5, FACTIONS[i].css, !game.mission);
      dot(a.safehouse.x, a.safehouse.y, 3.5, '#e8ecff');
      dot(a.paint.x, a.paint.y, 3.5, '#ff3d9a', game.heat.level > 0);
    });
    if (game.heat.level > 0) {
      const col = Math.floor(game.time * 5) % 2 ? '#ff2030' : '#3060ff';
      for (const v of game.vehicles) if (v.cop) dot(v.x, v.y, 3, col);
      for (const c of game.peds) if (c.kind === 'cop' && c.state !== 'dead') dot(c.x, c.y, 2, col);
    }
    if (game.objective) dot(game.objective.x, game.objective.y, 5 + Math.sin(game.time * 6), '#ffd21f', true);
    g.save();
    g.translate(S / 2, S / 2);
    g.rotate(p.a);
    g.fillStyle = '#fff';
    g.beginPath();
    g.moveTo(7, 0);
    g.lineTo(-5, -4.5);
    g.lineTo(-5, 4.5);
    g.fill();
    g.restore();
  }
}
