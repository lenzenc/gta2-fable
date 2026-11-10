/** All sound is synthesised with Web Audio; there are no audio assets. */
export class AudioSys {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private noise!: AudioBuffer;
  private engOsc!: OscillatorNode;
  private engGain!: GainNode;
  private sirOsc!: OscillatorNode;
  private sirGain!: GainNode;
  muted = false;

  /** Must be called from a user gesture. */
  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(ctx.destination);
    this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

    this.engOsc = ctx.createOscillator();
    this.engOsc.type = 'sawtooth';
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 420;
    this.engGain = ctx.createGain();
    this.engGain.gain.value = 0;
    this.engOsc.connect(lp).connect(this.engGain).connect(this.master);
    this.engOsc.start();

    this.sirOsc = ctx.createOscillator();
    this.sirOsc.type = 'triangle';
    this.sirGain = ctx.createGain();
    this.sirGain.gain.value = 0;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 1.6;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 180;
    lfo.connect(lfoGain).connect(this.sirOsc.frequency);
    this.sirOsc.frequency.value = 760;
    this.sirOsc.connect(this.sirGain).connect(this.master);
    this.sirOsc.start();
    lfo.start();
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.ctx) this.master.gain.value = this.muted ? 0 : 0.5;
  }

  private burst(dur: number, vol: number, f0: number, f1: number, type: BiquadFilterType = 'lowpass') {
    const ctx = this.ctx;
    if (!ctx || vol <= 0.01) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.6 + Math.random() * 0.8;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random() * 0.5, dur + 0.05);
  }
  private tone(freq: number, dur: number, vol: number, type: OscillatorType = 'square', slide = 0) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  shot(kind: string, vol: number) {
    if (kind === 'flamer') this.burst(0.12, vol * 0.12, 900, 300);
    else if (kind === 'shotgun') this.burst(0.28, vol * 0.7, 2600, 200);
    else if (kind === 'rocket') this.burst(0.5, vol * 0.5, 1200, 150, 'bandpass');
    else if (kind === 'grenade') this.tone(300, 0.1, vol * 0.15, 'triangle', -150);
    else {
      this.burst(kind === 'smg' ? 0.08 : 0.14, vol * 0.5, 3800, 500);
      this.tone(kind === 'smg' ? 210 : 150, 0.06, vol * 0.25, 'square', -80);
    }
  }
  boom(vol: number) {
    this.burst(1.1, vol * 1.2, 900, 40);
    this.tone(70, 0.5, vol * 0.7, 'sine', -40);
  }
  crash(vol: number) {
    this.burst(0.22, vol * 0.6, 1800, 200);
  }
  punch(vol: number) {
    this.burst(0.07, vol * 0.4, 500, 120);
  }
  blip(kind: 'pickup' | 'cash' | 'good' | 'bad' | 'ui') {
    if (kind === 'pickup') this.tone(660, 0.12, 0.18, 'square', 400);
    else if (kind === 'cash') {
      this.tone(880, 0.08, 0.15, 'square');
      setTimeout(() => this.tone(1320, 0.14, 0.15, 'square'), 70);
    } else if (kind === 'good') {
      [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => this.tone(f, 0.22, 0.16, 'triangle'), i * 110));
    } else if (kind === 'bad') {
      [330, 262, 196].forEach((f, i) => setTimeout(() => this.tone(f, 0.3, 0.18, 'sawtooth'), i * 160));
    } else this.tone(440, 0.05, 0.1, 'square');
  }

  /** Continuous sounds: engine pitch follows speed, siren follows pursuit. */
  update(inVehicle: boolean, speedNorm: number, throttle: number, siren: number) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    this.engOsc.frequency.setTargetAtTime(48 + speedNorm * 130 + Math.abs(throttle) * 14, t, 0.08);
    this.engGain.gain.setTargetAtTime(inVehicle ? 0.07 + Math.abs(throttle) * 0.04 : 0, t, 0.1);
    this.sirGain.gain.setTargetAtTime(siren * 0.07, t, 0.2);
  }
}
