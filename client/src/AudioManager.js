export class AudioManager {
  constructor() {
    this.ctx     = null;
    this.enabled = true;
    this.muted   = false;
    this.ambientNodes = null;
    this._lastHeartbeat = 0;
    this._reverbBuf = null; // кэш буфера реверба — создаётся один раз

    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    } catch (e) {
      this.enabled = false;
    }

    // Загружаем голоса заранее, чтобы к моменту речи они были готовы
    if (window.speechSynthesis) {
      window.speechSynthesis.getVoices();
      window.speechSynthesis.addEventListener('voiceschanged', () => {});
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
    try {
      this.resume();
      const ctx = this.ctx, now = ctx.currentTime;
      const rev = this._makeReverb();

      // Низкий искажённый рык
      const osc  = ctx.createOscillator();
      osc.type   = 'sawtooth';
      osc.frequency.setValueAtTime(130, now);
      osc.frequency.linearRampToValueAtTime(42, now + 1.0);

      const dist = ctx.createWaveShaper();
      dist.curve = distortionCurve(250);
      dist.oversample = '4x';

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.5, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 1.0);

      osc.connect(dist);
      dist.connect(rev); rev.connect(gain);
      dist.connect(gain);                  // dry
      gain.connect(ctx.destination);
      osc.start(now); osc.stop(now + 1.0);

      // Металлический скрежет
      const osc2  = ctx.createOscillator();
      osc2.type   = 'square';
      osc2.frequency.setValueAtTime(280, now + 0.1);
      osc2.frequency.exponentialRampToValueAtTime(60, now + 0.5);
      const gain2 = ctx.createGain();
      gain2.gain.setValueAtTime(0.0,  now + 0.1);
      gain2.gain.linearRampToValueAtTime(0.18, now + 0.2);
      gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
      osc2.connect(gain2); gain2.connect(ctx.destination);
      osc2.start(now + 0.1); osc2.stop(now + 0.5);
    } catch (_) {}
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
    try {
      this.resume();
      window.speechSynthesis.cancel();

      // Хриплое дыхание перед словами
      this._maniacBreath();

      // Угрожающий дрон
      const stopAtmos = this._startManiacDrone();

      // Голос — после вздоха
      setTimeout(() => {
        try {
          const voices  = window.speechSynthesis.getVoices();
          const ruVoice = voices.find((v) => v.lang.startsWith('ru') && /male/i.test(v.name))
                       || voices.find((v) => v.lang.startsWith('ru'));

          const u    = new SpeechSynthesisUtterance(text);
          u.lang     = 'ru-RU';
          u.rate     = 0.6;
          u.pitch    = 0.1; // 0.0 игнорируется некоторыми движками; 0.1 — минимально надёжное
          u.volume   = 1.0;
          if (ruVoice) u.voice = ruVoice;
          u.onend = () => {
            stopAtmos();
            // Тихое эхо
            try {
              const echo  = new SpeechSynthesisUtterance(text);
              echo.lang   = 'ru-RU';
              echo.rate   = 0.5;
              echo.pitch  = 0.1;
              echo.volume = 0.15;
              if (ruVoice) echo.voice = ruVoice;
              window.speechSynthesis.speak(echo);
            } catch (_) {}
          };
          u.onerror = () => stopAtmos();

          window.speechSynthesis.speak(u);
        } catch (_) {}
      }, 500);
    } catch (_) {}
  }

  // Хриплое дыхание + низкий стон перед речью
  _maniacBreath() {
    if (!this.active) return;
    try {
      const ctx = this.ctx, now = ctx.currentTime;
      const rev = this._makeReverb();

      // Шум дыхания
      const size = Math.floor(ctx.sampleRate * 0.5);
      const buf  = ctx.createBuffer(1, size, ctx.sampleRate);
      const d    = buf.getChannelData(0);
      for (let i = 0; i < size; i++) {
        const env = Math.pow(Math.sin(Math.PI * i / size), 0.6);
        d[i] = (Math.random() * 2 - 1) * env;
      }
      const src  = ctx.createBufferSource();
      src.buffer = buf;

      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass'; bp.frequency.value = 700; bp.Q.value = 1.2;
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass'; hp.frequency.value = 200;

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.5, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.5);

      // wet + dry
      src.connect(bp); bp.connect(hp);
      hp.connect(rev);  rev.connect(gain);
      hp.connect(gain);                    // dry
      gain.connect(ctx.destination);
      src.start(now);

      // Низкий стон-рык
      const osc  = ctx.createOscillator();
      osc.type   = 'sawtooth';
      osc.frequency.setValueAtTime(90, now);
      osc.frequency.linearRampToValueAtTime(48, now + 0.5);

      const dist = ctx.createWaveShaper();
      dist.curve = distortionCurve(350);
      dist.oversample = '4x';

      const gOsc = ctx.createGain();
      gOsc.gain.setValueAtTime(0.0, now);
      gOsc.gain.linearRampToValueAtTime(0.35, now + 0.15);
      gOsc.gain.exponentialRampToValueAtTime(0.001, now + 0.5);

      // wet + dry
      osc.connect(dist);
      dist.connect(rev); rev.connect(gOsc);
      dist.connect(gOsc);                  // dry
      gOsc.connect(ctx.destination);
      osc.start(now); osc.stop(now + 0.5);
    } catch (_) {}
  }

  // Угрожающий дрон во время речи маньяка; возвращает функцию остановки
  _startManiacDrone() {
    if (!this.active) return () => {};
    try {
      const ctx = this.ctx, now = ctx.currentTime;
      const rev = this._makeReverb();

      const osc1 = ctx.createOscillator();
      osc1.type = 'sawtooth'; osc1.frequency.value = 38;

      const osc2 = ctx.createOscillator();
      osc2.type = 'sine'; osc2.frequency.value = 57;

      const lfo  = ctx.createOscillator();
      lfo.frequency.value = 5.5;
      const lfoG = ctx.createGain(); lfoG.gain.value = 1.8;
      lfo.connect(lfoG); lfoG.connect(osc1.frequency);

      const dist = ctx.createWaveShaper();
      dist.curve = distortionCurve(120);

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(0.14, now + 0.4);

      osc1.connect(dist);
      dist.connect(rev);  rev.connect(gain);
      dist.connect(gain);                  // dry
      osc2.connect(gain);
      gain.connect(ctx.destination);
      osc1.start(now); osc2.start(now); lfo.start(now);

      return () => {
        try {
          const t = ctx.currentTime;
          gain.gain.linearRampToValueAtTime(0, t + 0.6);
          setTimeout(() => {
            try { osc1.stop(); osc2.stop(); lfo.stop(); } catch (_) {}
          }, 700);
        } catch (_) {}
      };
    } catch (_) { return () => {}; }
  }

  // Синтетический реверб — буфер кэшируется, создаётся один раз
  _makeReverb() {
    if (!this.ctx) return this.ctx?.createGain() ?? null;
    if (!this._reverbBuf) {
      const sr   = this.ctx.sampleRate;
      const size = Math.floor(sr * 2.0); // 2 секунды
      const buf  = this.ctx.createBuffer(2, size, sr);
      for (let c = 0; c < 2; c++) {
        const ch = buf.getChannelData(c);
        for (let i = 0; i < size; i++)
          ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / size, 2.5);
      }
      this._reverbBuf = buf;
    }
    const conv  = this.ctx.createConvolver();
    conv.buffer = this._reverbBuf;
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
