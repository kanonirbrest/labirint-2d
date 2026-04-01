export class AudioManager {
  constructor() {
    this.ctx     = null;
    this.enabled = true;
    this.muted   = false;
    this.ambientNodes = null;
    this._lastHeartbeat = 0;

    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    } catch (e) {
      this.enabled = false;
    }
  }

  get active() { return this.enabled && !this.muted && !!this.ctx; }

  resume() {
    if (this.ctx?.state === 'suspended') this.ctx.resume();
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.muted) {
      this.stopAmbient();
      window.speechSynthesis?.cancel();
    } else {
      this.startAmbient();
    }
    return this.muted;
  }

  // ── Атмосферный фон ──────────────────────────────────────────
  startAmbient() {
    if (!this.active) return;
    this.stopAmbient();
    this.resume();
    const ctx = this.ctx, now = ctx.currentTime;

    const osc1 = ctx.createOscillator();
    osc1.type = 'sine';
    osc1.frequency.value = 55;

    const osc2 = ctx.createOscillator();
    osc2.type = 'sine';
    osc2.frequency.value = 82;

    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.25;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 4;
    lfo.connect(lfoGain);
    lfoGain.connect(osc1.frequency);

    const masterGain = ctx.createGain();
    masterGain.gain.setValueAtTime(0, now);
    masterGain.gain.linearRampToValueAtTime(0.06, now + 3);

    osc1.connect(masterGain);
    osc2.connect(masterGain);
    masterGain.connect(ctx.destination);

    osc1.start(now); osc2.start(now); lfo.start(now);
    this.ambientNodes = { osc1, osc2, lfo, masterGain };
  }

  stopAmbient() {
    if (!this.ambientNodes) return;
    const now = this.ctx.currentTime;
    this.ambientNodes.masterGain.gain.linearRampToValueAtTime(0, now + 1);
    const nodes = this.ambientNodes;
    setTimeout(() => {
      try { nodes.osc1.stop(); nodes.osc2.stop(); nodes.lfo.stop(); } catch (_) {}
    }, 1100);
    this.ambientNodes = null;
  }

  // ── Шум (игрок нажал кнопку) ─────────────────────────────────
  playNoise() {
    if (!this.active) return;
    this.resume();
    const ctx = this.ctx, now = ctx.currentTime;

    const size = Math.floor(ctx.sampleRate * 0.3);
    const buf  = ctx.createBuffer(1, size, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < size; i++)
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / size, 1.2);

    const src = ctx.createBufferSource();
    src.buffer = buf;

    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1400;
    bp.Q.value = 0.8;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(1.0, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);

    src.connect(bp); bp.connect(gain); gain.connect(ctx.destination);
    src.start(now);
  }

  // ── Маньяк услышал шум ───────────────────────────────────────
  playManiacHear() {
    if (!this.active) return;
    this.resume();
    const ctx = this.ctx, now = ctx.currentTime;

    // Низкий искажённый рык
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(130, now);
    osc.frequency.linearRampToValueAtTime(42, now + 1.0);

    const dist = ctx.createWaveShaper();
    dist.curve = distortionCurve(250);
    dist.oversample = '4x';

    const rev  = this._makeReverb(1.5, 2);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.5, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 1.0);

    osc.connect(dist);
    dist.connect(rev); rev.connect(gain);
    dist.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now); osc.stop(now + 1.0);

    // Металлический скрежет/скрип
    const osc2 = ctx.createOscillator();
    osc2.type = 'square';
    osc2.frequency.setValueAtTime(280, now + 0.1);
    osc2.frequency.exponentialRampToValueAtTime(60, now + 0.5);

    const gain2 = ctx.createGain();
    gain2.gain.setValueAtTime(0.0, now + 0.1);
    gain2.gain.linearRampToValueAtTime(0.18, now + 0.2);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.5);

    osc2.connect(gain2); gain2.connect(ctx.destination);
    osc2.start(now + 0.1); osc2.stop(now + 0.5);
  }

  // ── Сердцебиение (маньяк близко) ─────────────────────────────
  playHeartbeat(proximity = 1) {
    if (!this.active) return;
    this.resume();
    const ctx = this.ctx, now = ctx.currentTime;
    const vol = 0.3 + proximity * 0.4;

    [0, 0.2].forEach((offset) => {
      const osc  = ctx.createOscillator();
      osc.type   = 'sine';
      osc.frequency.value = 50;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, now + offset);
      gain.gain.linearRampToValueAtTime(vol, now + offset + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.001, now + offset + 0.28);
      osc.connect(gain); gain.connect(ctx.destination);
      osc.start(now + offset); osc.stop(now + offset + 0.3);
    });
  }

  // ── Шаги игрока ──────────────────────────────────────────────
  playStep() {
    if (!this.active) return;
    this.resume();
    const ctx = this.ctx, now = ctx.currentTime;

    const size = Math.floor(ctx.sampleRate * 0.06);
    const buf  = ctx.createBuffer(1, size, ctx.sampleRate);
    const d    = buf.getChannelData(0);
    for (let i = 0; i < size; i++)
      d[i] = (Math.random() * 2 - 1) * (1 - i / size);

    const src = ctx.createBufferSource();
    src.buffer = buf;

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 400;

    const gain = ctx.createGain();
    gain.gain.value = 0.18;

    src.connect(lp); lp.connect(gain); gain.connect(ctx.destination);
    src.start(now);
  }

  // ── Победа ───────────────────────────────────────────────────
  playWin() {
    if (!this.active) return;
    this.resume();
    const ctx = this.ctx, now = ctx.currentTime;
    [0, 0.18, 0.36, 0.6].forEach((t, i) => {
      const osc = ctx.createOscillator();
      osc.type  = 'sine';
      osc.frequency.value = [440, 554, 660, 880][i];
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.35, now + t);
      gain.gain.exponentialRampToValueAtTime(0.001, now + t + 0.6);
      osc.connect(gain); gain.connect(ctx.destination);
      osc.start(now + t); osc.stop(now + t + 0.6);
    });
  }

  // ── Поражение ─────────────────────────────────────────────────
  playLose() {
    if (!this.active) return;
    this.resume();
    const ctx = this.ctx, now = ctx.currentTime;

    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(350, now);
    osc.frequency.exponentialRampToValueAtTime(40, now + 1.8);

    const dist = ctx.createWaveShaper();
    dist.curve = distortionCurve(220);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.55, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 1.8);

    osc.connect(dist); dist.connect(gain); gain.connect(ctx.destination);
    osc.start(now); osc.stop(now + 1.8);
  }

  // ── Речь маньяка (Web Speech API + Web Audio атмосфера) ─────
  speakManiac(text) {
    if (this.muted || !window.speechSynthesis) return;
    this.resume();

    window.speechSynthesis.cancel();

    // 1. Хриплое дыхание перед словами
    this._maniacBreath();

    // 2. Угрожающий дрон во время речи
    const stopAtmos = this._startManiacDrone();

    // 3. Голос — после вздоха, с минимальным питчем
    setTimeout(() => {
      const voices  = window.speechSynthesis.getVoices();
      const ruVoice = voices.find((v) => v.lang.startsWith('ru') && /male/i.test(v.name))
                   || voices.find((v) => v.lang.startsWith('ru'));

      const speak = (txt, rate, pitch, vol, onend) => {
        const u  = new SpeechSynthesisUtterance(txt);
        u.lang   = 'ru-RU';
        u.rate   = rate;
        u.pitch  = pitch;
        u.volume = vol;
        if (ruVoice) u.voice = ruVoice;
        if (onend) u.onend = onend;
        window.speechSynthesis.speak(u);
      };

      // Основной голос — медленно, максимально низко
      speak(text, 0.55, 0.0, 1.0, () => {
        stopAtmos();
        // Затухающее эхо той же фразы
        setTimeout(() => speak(text, 0.48, 0.0, 0.18), 180);
      });
    }, 550);
  }

  // Хриплое дыхание + низкий стон перед речью
  _maniacBreath() {
    if (!this.active) return;
    const ctx = this.ctx, now = ctx.currentTime;

    // Шум дыхания
    const size = Math.floor(ctx.sampleRate * 0.55);
    const buf  = ctx.createBuffer(1, size, ctx.sampleRate);
    const d    = buf.getChannelData(0);
    for (let i = 0; i < size; i++) {
      const env = Math.pow(Math.sin(Math.PI * i / size), 0.6);
      d[i] = (Math.random() * 2 - 1) * env;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;

    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 700; bp.Q.value = 1.2;

    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 200;

    const rev  = this._makeReverb(1.8, 2.5);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.55, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.55);

    src.connect(bp); bp.connect(hp); hp.connect(rev); rev.connect(gain);
    gain.connect(ctx.destination);
    src.start(now);

    // Низкий стон-рык
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(90, now);
    osc.frequency.linearRampToValueAtTime(48, now + 0.55);

    const dist = ctx.createWaveShaper();
    dist.curve = distortionCurve(350);
    dist.oversample = '4x';

    const gOsc = ctx.createGain();
    gOsc.gain.setValueAtTime(0.0, now);
    gOsc.gain.linearRampToValueAtTime(0.38, now + 0.15);
    gOsc.gain.exponentialRampToValueAtTime(0.001, now + 0.55);

    osc.connect(dist); dist.connect(this._makeReverb(1.2, 2));
    dist.connect(gOsc); gOsc.connect(ctx.destination);
    osc.start(now); osc.stop(now + 0.55);
  }

  // Угрожающий дрон во время речи маньяка; возвращает функцию остановки
  _startManiacDrone() {
    if (!this.active) return () => {};
    const ctx = this.ctx, now = ctx.currentTime;

    const osc1 = ctx.createOscillator();
    osc1.type = 'sawtooth'; osc1.frequency.value = 38;

    const osc2 = ctx.createOscillator();
    osc2.type = 'sine'; osc2.frequency.value = 57;

    // Вибрато
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 5.5;
    const lfoG = ctx.createGain(); lfoG.gain.value = 1.8;
    lfo.connect(lfoG); lfoG.connect(osc1.frequency);

    const dist = ctx.createWaveShaper();
    dist.curve = distortionCurve(120);

    const rev  = this._makeReverb(2.5, 3);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.14, now + 0.4);

    osc1.connect(dist); dist.connect(rev); rev.connect(gain);
    osc2.connect(gain);
    gain.connect(ctx.destination);
    osc1.start(now); osc2.start(now); lfo.start(now);

    return () => {
      const t = ctx.currentTime;
      gain.gain.linearRampToValueAtTime(0, t + 0.6);
      setTimeout(() => {
        try { osc1.stop(); osc2.stop(); lfo.stop(); } catch (_) {}
      }, 700);
    };
  }

  // Синтетический реверб через convolver
  _makeReverb(duration = 2, decay = 2) {
    const ctx = this.ctx;
    const sr   = ctx.sampleRate;
    const size = Math.floor(sr * duration);
    const buf  = ctx.createBuffer(2, size, sr);
    for (let c = 0; c < 2; c++) {
      const ch = buf.getChannelData(c);
      for (let i = 0; i < size; i++)
        ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / size, decay);
    }
    const conv = ctx.createConvolver();
    conv.buffer = buf;
    return conv;
  }

  // ── Обновление сердцебиения в игровом цикле ──────────────────
  tickHeartbeat(maniac, myPlayer) {
    if (!myPlayer || myPlayer.escaped) return;
    const dx   = myPlayer.x - maniac.x;
    const dy   = myPlayer.y - maniac.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist > 5) return;

    const now      = Date.now();
    const proximity = 1 - dist / 5;          // 0..1
    const interval  = Math.max(350, 1100 - proximity * 700);

    if (now - this._lastHeartbeat >= interval) {
      this.playHeartbeat(proximity);
      this._lastHeartbeat = now;
    }
  }

  stop() {
    this.stopAmbient();
    window.speechSynthesis?.cancel();
  }
}

function distortionCurve(amount) {
  const n = 256, curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / n - 1;
    curve[i] = ((Math.PI + amount) * x) / (Math.PI + amount * Math.abs(x));
  }
  return curve;
}
