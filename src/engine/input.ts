import { emptyInput, InputState } from '../sim/types';
import type { Vec } from '../world/city';

/** Keyboard, mouse and gamepad, sampled once per simulation tick. */
export class Input {
  private keys = new Set<string>();
  private pressed = new Set<string>();
  private mouseX = 0;
  private mouseY = 0;
  private mouseDown = false;
  private mouseT = -1e9;
  private wheel = 0;
  private padPrev: boolean[] = [];
  onPause: (() => void) | null = null;
  onMute: (() => void) | null = null;
  onAny: (() => void) | null = null;

  constructor(target: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
      if (!e.repeat) {
        this.pressed.add(e.code);
        if (e.code === 'Escape' || e.code === 'KeyP') this.onPause?.();
        if (e.code === 'KeyM') this.onMute?.();
        this.onAny?.();
      }
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.mouseDown = false;
    });
    target.addEventListener('mousemove', (e) => {
      this.mouseX = e.clientX;
      this.mouseY = e.clientY;
      this.mouseT = performance.now();
    });
    target.addEventListener('mousedown', (e) => {
      if (e.button === 0) this.mouseDown = true;
      this.mouseT = performance.now();
      this.onAny?.();
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouseDown = false;
    });
    target.addEventListener('wheel', (e) => (this.wheel += Math.sign(e.deltaY)), { passive: true });
    target.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  sample(toWorld: (sx: number, sy: number) => Vec): InputState {
    const k = this.keys;
    const p = this.pressed;
    const s = emptyInput();
    s.mx = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    s.my = (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0) - (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0);
    s.handbrake = k.has('Space');
    s.fire = this.mouseDown || k.has('ControlLeft');
    s.enter = p.has('KeyE') || p.has('Enter');
    s.interact = p.has('KeyF');
    s.nextW = p.has('KeyQ') || p.has('Tab') || this.wheel > 0;
    s.prevW = p.has('KeyZ') || this.wheel < 0;
    for (let i = 1; i <= 7; i++) if (p.has('Digit' + i)) s.slot = i - 1;
    s.aim = performance.now() - this.mouseT < 4000 || this.mouseDown;
    const w = toWorld(this.mouseX, this.mouseY);
    s.aimX = w.x;
    s.aimY = w.y;

    const pad = navigator.getGamepads?.()[0];
    if (pad) {
      const dz = (v: number) => (Math.abs(v) < 0.2 ? 0 : v);
      const b = pad.buttons.map((x) => x.pressed);
      const edge = (i: number) => b[i] && !this.padPrev[i];
      const ax = dz(pad.axes[0] ?? 0);
      const ay = dz(pad.axes[1] ?? 0);
      if (ax || ay) {
        s.mx = ax;
        s.my = ay;
      }
      const rt = pad.buttons[7]?.value ?? 0;
      const lt = pad.buttons[6]?.value ?? 0;
      if (rt > 0.1 || lt > 0.1) {
        // Triggers drive; on foot the right trigger fires.
        s.my = lt - rt;
        s.fire = s.fire || rt > 0.5;
      }
      s.handbrake = s.handbrake || !!b[0];
      s.fire = s.fire || !!b[1];
      s.enter = s.enter || edge(3);
      s.interact = s.interact || edge(2);
      s.nextW = s.nextW || edge(5);
      s.prevW = s.prevW || edge(4);
      if (edge(9)) this.onPause?.();
      this.padPrev = b;
    }
    this.pressed.clear();
    this.wheel = 0;
    return s;
  }
}
