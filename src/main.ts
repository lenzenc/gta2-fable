import { AudioSys } from './engine/audio';
import { Input } from './engine/input';
import { Hud } from './render/hud';
import { Renderer } from './render/renderer';
import { Game } from './sim/game';
import { applySave, clearSave, readSave, writeSave } from './sim/save';

const STEP = 1 / 60;
const canvas = document.getElementById('c') as HTMLCanvasElement;
const title = document.getElementById('title')!;
const pause = document.getElementById('pause')!;
const btnNew = document.getElementById('new')!;
const btnCont = document.getElementById('continue')!;

const game = new Game();
const renderer = new Renderer(canvas, game);
const hud = new Hud(game);
const audio = new AudioSys();
const input = new Input(canvas);
let state: 'title' | 'play' | 'paused' = 'title';

game.onSave = () => writeSave(game);
window.addEventListener('resize', () => renderer.resize());
input.onAny = () => audio.init();
input.onMute = () => audio.toggleMute();
input.onPause = () => {
  if (state === 'title') return;
  state = state === 'play' ? 'paused' : 'play';
  pause.classList.toggle('show', state === 'paused');
};

const save = readSave();
if (!save) btnCont.style.display = 'none';
const begin = (load: boolean) => {
  audio.init();
  if (load && save) {
    applySave(game, save);
    game.populate();
  } else clearSave();
  renderer.cx = game.player.x;
  renderer.cy = game.player.y;
  title.classList.remove('show');
  state = 'play';
  hud.banner('NEON LEDGER', 'Find a JOBS terminal. Bank $60,000. Own the city.', '#35e0ff');
};
btnNew.addEventListener('click', () => begin(false));
btnCont.addEventListener('click', () => begin(true));

function vol(x: number, y: number) {
  const d = Math.hypot(x - game.player.x, y - game.player.y);
  return Math.max(0, 1 - d / 80) ** 2;
}

function handleEvents() {
  for (const e of game.events) {
    renderer.fx(e);
    switch (e.type) {
      case 'shot':
        audio.shot(e.s, vol(e.x, e.y));
        break;
      case 'explosion':
        audio.boom(vol(e.x, e.y));
        break;
      case 'crash':
        audio.crash(vol(e.x, e.y) * Math.min(1, e.n / 12));
        break;
      case 'punch':
        audio.punch(vol(e.x, e.y));
        break;
      case 'pickup':
        audio.blip(e.s === 'cash' ? 'cash' : 'pickup');
        break;
      case 'enter':
        audio.blip('ui');
        break;
      case 'banner': {
        const [sub, color] = e.s2.split('|');
        hud.banner(e.s, sub, color ?? '#fff');
        if (e.s === 'JOB DONE' || e.s === 'THE LEDGER IS YOURS') audio.blip('good');
        else if (e.s === 'JOB BLOWN' || e.s === 'FLATLINED' || e.s === 'BOOKED') audio.blip('bad');
        break;
      }
    }
  }
}

let last = performance.now();
let acc = 0;
function frame(now: number) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (state === 'play') {
    acc += dt;
    let n = 0;
    while (acc >= STEP && n < 4) {
      game.input = input.sample((x, y) => renderer.screenToWorld(x, y));
      game.tick(STEP);
      handleEvents();
      acc -= STEP;
      n++;
    }
    if (n === 4) acc = 0;
  }
  renderer.render(game, state === 'paused' ? 0 : dt);
  hud.update(game, dt);
  const pv = game.pv;
  let siren = 0;
  if (game.heat.level > 0) for (const v of game.vehicles) if (v.siren) siren = Math.max(siren, vol(v.x, v.y));
  audio.update(state === 'play' && !!pv, pv ? Math.hypot(pv.vx, pv.vy) / pv.def.maxSpeed : 0, pv ? pv.throttle : 0, state === 'play' ? siren : 0);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Exposed for debugging and automated checks.
Object.assign(window, { __game: game, __renderer: renderer });
