/**
 * AudioManager
 * Все звуки pre-render'ятся в AudioBuffer при старте через OfflineAudioContext.
 * Воспроизведение — мгновенное (createBufferSource без синтеза в реальном времени).
 * Голос маньяка — Web Speech API с pre-warm при первом взаимодействии.
 */
export class AudioManager {
  constructor() {
    this.ctx     = null;
    this.enabled = true;
    this.muted   = false;
    this.ambientNodes   = null;
    this._lastHeartbeat = 0;
    this._buffers       = {};   // { name: AudioBuffer }
    this._speechWarmedUp = false;
    this._ruVoice        = null;

    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    } catch (e) {
      this.enabled = false;
      return;
    }

    this._preloadAll();
    this._initVoices();
  }

  get active() { return this.enabled && !this.muted && !!this.ctx; }

  // ─── Pre-render всех звуков ───────────────────────────────────
  async _preloadAll() {
    const jobs = [
      ['growl',     1.2 + 2.0, (ctx) => this._buildGrowl(ctx)],
      ['noise',     0.35,      (ctx) => this._buildNoise(ctx)],
      ['step',      0.09,      (ctx) => this._buildStep(ctx)],
      ['heartbeat', 0.55,      (ctx) => this._buildHeartbeat(ctx)],
      ['win',       1.4,       (ctx) => this._buildWin(ctx)],
      ['lose',      2.0 + 1.0, (ctx) => this._buildLose(ctx)],
      ['breath',    0.6 + 1.5, (ctx) => this._buildBreath(ctx)],
      ['enraged',   1.8 + 2.0, (ctx) => this._buildEnraged(ctx)],
    ];

    await Promise.all(jobs.map(async ([name, dur, fn]) => {
      try {
        const sr      = 44100;
        const frames  = Math.ceil(sr * dur);
        const offline = new OfflineAudioContext(2, frames, sr);
        fn(offline);
        this._buffers[name] = await offline.startRendering();
      } catch (_) {}
    }));
  }

  // ─── Вспомогательные — строители звуков ─────────────────────

  _buildGrowl(ctx) {
    const now = 0, dur = 1.2;
    const rev = _reverbOffline(ctx, 2.0);

    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(130, now);
    osc.frequency.linearRampToValueAtTime(42, now + dur);

    const dist = ctx.createWaveShaper();
    dist.curve = distortionCurve(250);
    dist.oversample = '4x';

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.5, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + dur);

    osc.connect(dist);
    dist.connect(rev);  rev.connect(gain);
    dist.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now); osc.stop(now + dur);

    // Металлический скрежет
    const osc2 = ctx.createOscillator();
    osc2.type = 'square';
    osc2.frequency.setValueAtTime(280, now + 0.1);
    osc2.frequency.exponentialRampToValueAtTime(60, now + 0.5);
    const g2 = ctx.createGain();
    g2.gain.setValueAtTime(0, now + 0.1);
    g2.gain.linearRampToValueAtTime(0.18, now + 0.2);
    g2.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
    osc2.connect(g2); g2.connect(ctx.destination);
    osc2.start(now + 0.1); osc2.stop(now + 0.5);
  }

  _buildNoise(ctx) {
    const now = 0, dur = 0.3;
    const size = Math.floor(44100 * dur);
    const buf  = ctx.createBuffer(1, size, 44100);
    const d    = buf.getChannelData(0);
    for (let i = 0; i < size; i++)
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / size, 1.2);

    const src = ctx.createBufferSource();
    src.buffer = buf;

    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 1400; bp.Q.value = 0.8;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(1.0, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + dur);

    src.connect(bp); bp.connect(gain); gain.connect(ctx.destination);
    src.start(now);
  }

  _buildStep(ctx) {
    const now = 0, size = Math.floor(44100 * 0.07);
    const buf  = ctx.createBuffer(1, size, 44100);
    const d    = buf.getChannelData(0);
    for (let i = 0; i < size; i++)
      d[i] = (Math.random() * 2 - 1) * (1 - i / size);

    const src = ctx.createBufferSource();
    src.buffer = buf;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 400;
    const g = ctx.createGain(); g.gain.value = 0.2;
    src.connect(lp); lp.connect(g); g.connect(ctx.destination);
    src.start(now);
  }

  _buildHeartbeat(ctx) {
    [0, 0.2].forEach((offset) => {
      const osc  = ctx.createOscillator();
      osc.type   = 'sine'; osc.frequency.value = 50;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, offset);
      gain.gain.linearRampToValueAtTime(0.7, offset + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.001, offset + 0.28);
      osc.connect(gain); gain.connect(ctx.destination);
      osc.start(offset); osc.stop(offset + 0.3);
    });
  }

  _buildWin(ctx) {
    [0, 0.18, 0.36, 0.6].forEach((t, i) => {
      const osc = ctx.createOscillator();
      osc.type  = 'sine';
      osc.frequency.value = [440, 554, 660, 880][i];
      const g   = ctx.createGain();
      g.gain.setValueAtTime(0.35, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
      osc.connect(g); g.connect(ctx.destination);
      osc.start(t); osc.stop(t + 0.6);
    });
  }

  _buildLose(ctx) {
    const now = 0, dur = 1.8;
    const rev = _reverbOffline(ctx, 1.5);

    const osc  = ctx.createOscillator();
    osc.type   = 'sawtooth';
    osc.frequency.setValueAtTime(350, now);
    osc.frequency.exponentialRampToValueAtTime(40, now + dur);

    const dist = ctx.createWaveShaper();
    dist.curve = distortionCurve(220);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.55, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + dur);

    osc.connect(dist);
    dist.connect(rev); rev.connect(gain);
    dist.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now); osc.stop(now + dur);
  }

  _buildEnraged(ctx) {
    const now = 0, dur = 1.8;
    const rev = _reverbOffline(ctx, 2.2);

    // Мощный нарастающий рёв
    const osc1 = ctx.createOscillator();
    osc1.type = 'sawtooth';
    osc1.frequency.setValueAtTime(60, now);
    osc1.frequency.linearRampToValueAtTime(140, now + 0.3);
    osc1.frequency.linearRampToValueAtTime(55, now + dur);

    const dist1 = ctx.createWaveShaper();
    dist1.curve = distortionCurve(400);
    dist1.oversample = '4x';

    const gain1 = ctx.createGain();
    gain1.gain.setValueAtTime(0, now);
    gain1.gain.linearRampToValueAtTime(0.7, now + 0.15);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + dur);

    osc1.connect(dist1);
    dist1.connect(rev); rev.connect(gain1);
    dist1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(now); osc1.stop(now + dur);

    // Высокочастотный скрим поверх
    const osc2 = ctx.createOscillator();
    osc2.type = 'square';
    osc2.frequency.setValueAtTime(320, now + 0.1);
    osc2.frequency.linearRampToValueAtTime(180, now + 0.6);
    const dist2 = ctx.createWaveShaper();
    dist2.curve = distortionCurve(300);
    const gain2 = ctx.createGain();
    gain2.gain.setValueAtTime(0, now + 0.1);
    gain2.gain.linearRampToValueAtTime(0.35, now + 0.25);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.8);
    osc2.connect(dist2); dist2.connect(gain2); gain2.connect(ctx.destination);
    osc2.start(now + 0.1); osc2.stop(now + 0.8);

    // Удар (низкий бум)
    const osc3 = ctx.createOscillator();
    osc3.type = 'sine';
    osc3.frequency.setValueAtTime(80, now);
    osc3.frequency.exponentialRampToValueAtTime(30, now + 0.4);
    const gain3 = ctx.createGain();
    gain3.gain.setValueAtTime(0.9, now);
    gain3.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
    osc3.connect(gain3); gain3.connect(ctx.destination);
    osc3.start(now); osc3.stop(now + 0.4);
  }

  _buildBreath(ctx) {
    const now = 0, dur = 0.55;
    const rev = _reverbOffline(ctx, 1.5);

    // Шум дыхания
    const size = Math.floor(44100 * dur);
    const buf  = ctx.createBuffer(1, size, 44100);
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

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.5, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + dur);

    src.connect(bp); bp.connect(hp);
    hp.connect(rev); rev.connect(gain);
    hp.connect(gain);
    gain.connect(ctx.destination);
    src.start(now);

    // Стон-рык
    const osc  = ctx.createOscillator();
    osc.type   = 'sawtooth';
    osc.frequency.setValueAtTime(90, now);
    osc.frequency.linearRampToValueAtTime(48, now + dur);

    const dist = ctx.createWaveShaper();
    dist.curve = distortionCurve(350); dist.oversample = '4x';

    const gOsc = ctx.createGain();
    gOsc.gain.setValueAtTime(0, now);
    gOsc.gain.linearRampToValueAtTime(0.35, now + 0.15);
    gOsc.gain.exponentialRampToValueAtTime(0.001, now + dur);

    osc.connect(dist);
    dist.connect(rev); rev.connect(gOsc);
    dist.connect(gOsc);
    gOsc.connect(ctx.destination);
    osc.start(now); osc.stop(now + dur);
  }

  // ─── Воспроизведение pre-rendered буфера ─────────────────────
  _play(name, vol = 1) {
    if (!this.active) return;
    this.resume();
    const buf = this._buffers[name];
    if (!buf) return;
    try {
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      if (vol !== 1) {
        const g = this.ctx.createGain();
        g.gain.value = vol;
        src.connect(g); g.connect(this.ctx.destination);
      } else {
        src.connect(this.ctx.destination);
      }
      src.start(this.ctx.currentTime);
    } catch (_) {}
  }

  // ─── Публичные методы воспроизведения ────────────────────────
  playNoise() {
    this._play('noise');
    this._speakPlayer();
  }
  playManiacHear() { this._play('growl'); }
  playEnraged()    { this._play('enraged'); }
  playStep()       { this._play('step'); }
  playWin()        { this._play('win'); }
  playLose()       { this._play('lose'); }

  playHeartbeat(proximity = 1) {
    this._play('heartbeat', 0.3 + proximity * 0.5);
  }

  // ─── Атмосферный фон (нельзя pre-render — бесконечный) ───────
  startAmbient() {
    if (!this.active) return;
    this.stopAmbient();
    this.resume();
    const ctx = this.ctx, now = ctx.currentTime;

    const osc1 = ctx.createOscillator();
    osc1.type = 'sine'; osc1.frequency.value = 55;
    const osc2 = ctx.createOscillator();
    osc2.type = 'sine'; osc2.frequency.value = 82;

    const lfo  = ctx.createOscillator();
    lfo.frequency.value = 0.25;
    const lfoG = ctx.createGain(); lfoG.gain.value = 4;
    lfo.connect(lfoG); lfoG.connect(osc1.frequency);

    const master = ctx.createGain();
    master.gain.setValueAtTime(0, now);
    master.gain.linearRampToValueAtTime(0.06, now + 3);

    osc1.connect(master); osc2.connect(master);
    master.connect(ctx.destination);
    osc1.start(now); osc2.start(now); lfo.start(now);

    this.ambientNodes = { osc1, osc2, lfo, master };
  }

  stopAmbient() {
    if (!this.ambientNodes) return;
    const now = this.ctx.currentTime;
    this.ambientNodes.master.gain.linearRampToValueAtTime(0, now + 1);
    const n = this.ambientNodes;
    setTimeout(() => {
      try { n.osc1.stop(); n.osc2.stop(); n.lfo.stop(); } catch (_) {}
    }, 1100);
    this.ambientNodes = null;
  }

  // ─── Крик игрока при нажатии «Шум» ──────────────────────────
  _speakPlayer() {
    if (this.muted || !window.speechSynthesis) return;
    const phrases = [
      'Эй, иди сюда!',
      'Я здесь!',
      'Иди ко мне!',
    ];
    const text = phrases[Math.floor(Math.random() * phrases.length)];
    try {
      window.speechSynthesis.cancel();
      const u    = new SpeechSynthesisUtterance(text);
      u.lang     = 'ru-RU';
      u.rate     = 1.05;   // чуть быстрее — взволнованный голос
      u.pitch    = 1.3;    // выше нормы — испуг
      u.volume   = 1.0;
      if (this._ruVoice) u.voice = this._ruVoice;
      u.onerror  = () => {};
      window.speechSynthesis.speak(u);
    } catch (_) {}
  }

  // ─── Речь маньяка ────────────────────────────────────────────
  speakManiac(text) {
    if (this.muted || !window.speechSynthesis) return;
    try {
      // Сначала хриплое дыхание из кэша — мгновенно
      this._play('breath');

      window.speechSynthesis.cancel();

      // Голос через 480мс (после вздоха)
      setTimeout(() => {
        try {
          const u    = new SpeechSynthesisUtterance(text);
          u.lang     = 'ru-RU';
          u.rate     = 0.6;
          u.pitch    = 0.1;
          u.volume   = 1.0;
          if (this._ruVoice) u.voice = this._ruVoice;
          u.onerror  = () => {};

          // Тихое эхо после основной фразы
          u.onend = () => {
            try {
              const echo  = new SpeechSynthesisUtterance(text);
              echo.lang   = 'ru-RU';
              echo.rate   = 0.5;
              echo.pitch  = 0.1;
              echo.volume = 0.14;
              if (this._ruVoice) echo.voice = this._ruVoice;
              echo.onerror = () => {};
              window.speechSynthesis.speak(echo);
            } catch (_) {}
          };

          window.speechSynthesis.speak(u);
        } catch (_) {}
      }, 480);
    } catch (_) {}
  }

  // ─── Сердцебиение в игровом цикле ────────────────────────────
  tickHeartbeat(maniac, myPlayer) {
    if (!myPlayer || myPlayer.escaped) return;
    const dx   = myPlayer.x - maniac.x;
    const dy   = myPlayer.y - maniac.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > 5) return;

    const now      = Date.now();
    const prox     = 1 - dist / 5;
    const interval = Math.max(350, 1100 - prox * 700);
    if (now - this._lastHeartbeat >= interval) {
      this.playHeartbeat(prox);
      this._lastHeartbeat = now;
    }
  }

  // ─── Утилиты ──────────────────────────────────────────────────
  resume() {
    if (this.ctx?.state === 'suspended') this.ctx.resume();
    // Pre-warm TTS при первом взаимодействии (нужно после user gesture)
    if (!this._speechWarmedUp && window.speechSynthesis) {
      this._speechWarmedUp = true;
      try {
        const u = new SpeechSynthesisUtterance(' ');
        u.volume = 0; u.rate = 2;
        window.speechSynthesis.speak(u);
      } catch (_) {}
    }
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.muted) { this.stopAmbient(); window.speechSynthesis?.cancel(); }
    else            { this.startAmbient(); }
    return this.muted;
  }

  stop() {
    this.stopAmbient();
    window.speechSynthesis?.cancel();
  }

  _initVoices() {
    const pick = () => {
      const voices   = window.speechSynthesis?.getVoices() ?? [];
      this._ruVoice  = voices.find((v) => v.lang.startsWith('ru') && /male/i.test(v.name))
                    || voices.find((v) => v.lang.startsWith('ru'))
                    || null;
    };
    pick();
    window.speechSynthesis?.addEventListener('voiceschanged', pick);
  }
}

// ─── Вспомогательные функции ──────────────────────────────────

function distortionCurve(amount) {
  const n = 256, curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / n - 1;
    curve[i] = ((Math.PI + amount) * x) / (Math.PI + amount * Math.abs(x));
  }
  return curve;
}

// Реверб-конвольвер для OfflineAudioContext (нельзя шарить буфер между разными ctx)
function _reverbOffline(ctx, duration = 2) {
  const sr   = ctx.sampleRate;
  const size = Math.floor(sr * duration);
  const buf  = ctx.createBuffer(2, size, sr);
  for (let c = 0; c < 2; c++) {
    const ch = buf.getChannelData(c);
    for (let i = 0; i < size; i++)
      ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / size, 2.5);
  }
  const conv  = ctx.createConvolver();
  conv.buffer = buf;
  return conv;
}
