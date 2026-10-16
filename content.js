/* TubeEQ v2.1 — audio engine (content script, isolated world)
   Chain:
     video -> src -> volGain -> preGain -> 10x Biquad -> eqOut -+-> sumNode
        eqOut -> bassLP1 -> bassShaper -> bassLP2 -> bassMix -+   (bass harmonics)
        eqOut -> clarHP1 -> clarShaper -> clarHP2 -> clarMix -+   (clarity exciter)
     sumNode -> splitter -> mid/side widener -> merger -> dryG -+-> driveG
                                                       -> verb -> wetG -+  (ambience)
     driveG -> comp -> makeupG -> limiter -> analyser -> destination
*/
(() => {
'use strict';

const db2g = db => Math.pow(10, db / 20);

let ctx = null;
let srcNode, volGain, preGain, filters = [], eqOut, sumNode;
let bassLP1, bassShaper, bassLP2, bassMix;
let clarHP1, clarShaper, clarHP2, clarMix;
let split, midG, sideG, rNeg, sideNeg, merge, dryG, verb, wetG;
let transHP, transAbs, transLP, transAmt, transDelay, vca;
let driveG, comp, makeupG, limiter, analyser;
let videoEl = null;

let state = null;
let rt = { src: 'manual', channelKey: null, channelName: '', genre: '' };
let lastHref = location.href;
const vizPorts = new Set();
const freqData = new Uint8Array(32);
const timeData = new Uint8Array(64); // must equal fftSize; longer arrays leave trailing zeros -> false clip reports
let lastHookError = ''; // diagnostic: why the video could not be hooked

/* ---------- state ---------- */
function loadState() {
  const s = JSON.parse(JSON.stringify(TQ.DEFAULTS));
  const mergeFx = fx => Object.assign({}, TQ.DEFAULTS.effects, fx);
  try {
    const raw = localStorage.getItem('tq.v2');
    if (raw) {
      const p = JSON.parse(raw);
      Object.assign(s, p);
      if (p.effects) s.effects = mergeFx(p.effects);
      if (p.leveler === true && !p.effects) s.effects.dynBoost = 6; // legacy v2.0
      delete s.leveler;
    }
  } catch (e) {}
  if (!Array.isArray(s.gains) || s.gains.length !== 10) s.gains = [...TQ.DEFAULTS.gains];
  s.effects = mergeFx(s.effects);
  return s;
}
function persist() {
  try { chrome.storage.sync.set({ tqV2: state }); } catch (e) {}
  try { localStorage.setItem('tq.v2', JSON.stringify(state)); } catch (e) {}
}

/* ---------- page info ---------- */
function pageInfo() {
  let channelKey = null, channelName = '', genre = '';
  try {
    const m = document.querySelector('meta[itemprop="channelId"]');
    if (m && m.content) channelKey = 'id:' + m.content;
    const g = document.querySelector('meta[itemprop="genre"]');
    if (g && g.content) genre = g.content;
    const a = document.querySelector('#channel-name a, ytd-channel-name a');
    if (a) {
      channelName = (a.textContent || '').trim();
      if (!channelKey) {
        const href = a.getAttribute('href') || '';
        if (href) channelKey = 'href:' + href;
      }
    }
  } catch (e) {}
  return { channelKey, channelName, genre };
}

/* ---------- DSP helpers ---------- */
function satCurve(k) {
  const n = 256, c = new Float32Array(n), t = Math.tanh(k);
  for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = Math.tanh(k * x) / t; }
  return c;
}
function makeIR(seconds, decay) {
  const rate = ctx.sampleRate, len = Math.floor(rate * seconds);
  const buf = ctx.createBuffer(2, len, rate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const nse = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
      lp = lp * 0.82 + nse * 0.18;
      d[i] = lp * 0.9;
    }
  }
  return buf;
}

/* ---------- audio graph ---------- */
function ensureGraph(video) {
  try {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      ctx = new AC();
      const G = () => ctx.createGain();

      srcNode = ctx.createMediaElementSource(video);
      volGain = G(); preGain = G();
      filters = TQ.BANDS.map(b => {
        const f = ctx.createBiquadFilter();
        f.type = b.type; f.frequency.value = b.f; f.Q.value = b.q; f.gain.value = 0;
        return f;
      });
      eqOut = G(); sumNode = G();

      // bass harmonic enhancer (parallel)
      bassLP1 = ctx.createBiquadFilter(); bassLP1.type = 'lowpass'; bassLP1.frequency.value = 120;
      bassShaper = ctx.createWaveShaper(); bassShaper.curve = satCurve(2.4);
      bassLP2 = ctx.createBiquadFilter(); bassLP2.type = 'lowpass'; bassLP2.frequency.value = 280;
      bassMix = G(); bassMix.gain.value = 0;

      // clarity exciter (parallel, highs only)
      clarHP1 = ctx.createBiquadFilter(); clarHP1.type = 'highpass'; clarHP1.frequency.value = 4500;
      clarShaper = ctx.createWaveShaper(); clarShaper.curve = satCurve(1.6);
      clarHP2 = ctx.createBiquadFilter(); clarHP2.type = 'highpass'; clarHP2.frequency.value = 4500;
      clarMix = G(); clarMix.gain.value = 0;

      // mid/side stereo widener
      split = ctx.createChannelSplitter(2);
      midG = G(); midG.gain.value = 0.5;
      sideG = G(); sideG.gain.value = 0.5;
      rNeg = G(); rNeg.gain.value = -1;      // -R for side computation
      sideNeg = G(); sideNeg.gain.value = -1; // -side for right channel
      merge = ctx.createChannelMerger(2);

      // transient restorer: envelope follower -> VCA gain (lossless "snap")
      transHP = ctx.createBiquadFilter(); transHP.type = 'highpass'; transHP.frequency.value = 2500;
      transAbs = ctx.createWaveShaper();
      transAbs.curve = (() => { const n = 256, c = new Float32Array(n);
        for (let i = 0; i < n; i++) c[i] = Math.abs((i / (n - 1)) * 2 - 1); return c; })();
      transLP = ctx.createBiquadFilter(); transLP.type = 'lowpass'; transLP.frequency.value = 600;
      transAmt = G(); transAmt.gain.value = 0;
      transDelay = ctx.createDelay(0.02); transDelay.delayTime.value = 0.004;
      vca = G(); vca.gain.value = 1;

      // ambience (generated room reverb)
      dryG = G();
      verb = ctx.createConvolver(); verb.buffer = makeIR(1.4, 2.8);
      wetG = G(); wetG.gain.value = 0;

      // dynamics: drive -> compressor -> makeup -> brickwall limiter
      driveG = G(); comp = ctx.createDynamicsCompressor();
      makeupG = G(); limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -1.2; limiter.knee.value = 0;
      limiter.ratio.value = 20; limiter.attack.value = 0.001; limiter.release.value = 0.1;

      analyser = ctx.createAnalyser();
      analyser.fftSize = 64; analyser.smoothingTimeConstant = 0.55;

      // wiring
      srcNode.connect(volGain); volGain.connect(preGain);
      let n = preGain;
      filters.forEach(f => { n.connect(f); n = f; });
      n.connect(eqOut);
      eqOut.connect(sumNode);
      eqOut.connect(bassLP1); bassLP1.connect(bassShaper); bassShaper.connect(bassLP2); bassLP2.connect(bassMix); bassMix.connect(sumNode);
      eqOut.connect(clarHP1); clarHP1.connect(clarShaper); clarShaper.connect(clarHP2); clarHP2.connect(clarMix); clarMix.connect(sumNode);
      sumNode.connect(split);
      split.connect(midG, 0); split.connect(midG, 1);
      split.connect(sideG, 0); split.connect(rNeg, 1); rNeg.connect(sideG);
      midG.connect(merge, 0, 0); midG.connect(merge, 0, 1);
      sideG.connect(merge, 0, 0); sideG.connect(sideNeg, 0); sideNeg.connect(merge, 0, 1);
      // transient restorer taps post-widener
      merge.connect(transHP); transHP.connect(transAbs); transAbs.connect(transLP);
      transLP.connect(transAmt); transAmt.connect(vca.gain);
      merge.connect(transDelay); transDelay.connect(vca);
      vca.connect(dryG); dryG.connect(driveG);
      vca.connect(verb); verb.connect(wetG); wetG.connect(driveG);
      driveG.connect(comp); comp.connect(makeupG); makeupG.connect(limiter);
      limiter.connect(analyser); analyser.connect(ctx.destination);

      video.addEventListener('play', () => { if (ctx.state === 'suspended') ctx.resume().catch(() => {}); });
    } else if (video !== videoEl) {
      try { srcNode.disconnect(); } catch (e) {}
      srcNode = ctx.createMediaElementSource(video);
      srcNode.connect(volGain);
    }
    videoEl = video;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return 'ready';
  } catch (e) {
    lastHookError = String((e && e.message) || e);
    return videoEl ? 'ready' : 'needs-reload';
  }
}

function applyAudio() {
  if (!ctx) return;
  const t = ctx.currentTime;
  const on = state.enabled && !state.ab;
  const fx = state.effects;

  volGain.gain.setTargetAtTime(Math.max(0, state.volume) / 100, t, 0.05);
  const maxB = Math.max(0, ...state.gains);
  preGain.gain.setTargetAtTime(db2g(-maxB * 0.7), t, 0.05);
  filters.forEach((f, i) => f.gain.setTargetAtTime(on ? state.gains[i] : 0, t, 0.03));

  // bass harmonics: always a touch, more when you boost 31/62 Hz
  const bassAmt = Math.max(0, state.gains[0], state.gains[1]) / 12;
  bassMix.gain.setTargetAtTime(on ? 0.08 + bassAmt * 0.5 : 0, t, 0.08);
  clarMix.gain.setTargetAtTime(on ? (fx.clarity / 10) * 0.55 : 0, t, 0.08);

  // stereo width: side = 0.5*w*(L-R); w=1 -> original
  sideG.gain.setTargetAtTime(0.5 * (on ? (1 + (fx.surround / 10) * 1.6) : 1), t, 0.08);

  wetG.gain.setTargetAtTime(on ? (fx.ambience / 10) * 0.38 : 0, t, 0.1);
  dryG.gain.setTargetAtTime(on ? 1 - (fx.ambience / 10) * 0.22 : 1, t, 0.1);

  // transient restorer amount
  transAmt.gain.setTargetAtTime(on ? (fx.restore / 10) * 0.9 : 0, t, 0.1);

  // dynamic boost: drive into compressor + makeup, brickwall limiter keeps it safe
  const d = on ? fx.dynBoost : 0;
  driveG.gain.setTargetAtTime(db2g((d / 10) * 9), t, 0.08);
  makeupG.gain.setTargetAtTime(db2g((d / 10) * 3.5), t, 0.08);
  if (on && d > 0) {
    comp.threshold.setTargetAtTime(-13, t, 0.1);
    comp.knee.setTargetAtTime(14, t, 0.1);
    comp.ratio.setTargetAtTime(5, t, 0.1);
    comp.attack.setTargetAtTime(0.004, t, 0.1);
    comp.release.setTargetAtTime(0.28, t, 0.1);
  } else {
    comp.threshold.setTargetAtTime(0, t, 0.1); // transparent when off
    comp.ratio.setTargetAtTime(1, t, 0.1);
  }
}

/* ---------- auto preset ---------- */
function autoApply() {
  const info = pageInfo();
  rt.channelKey = info.channelKey;
  rt.channelName = info.channelName;
  rt.genre = info.genre;
  const saved = info.channelKey && state.perChannel[info.channelKey];
  if (saved && Array.isArray(saved.gains) && saved.gains.length === 10) {
    state.gains = [...saved.gains];
    state.preset = saved.preset || 'custom';
    if (state.preset.indexOf('user:') === 0) {
      const up = (state.customPresets || {})[state.preset.slice(5)];
      if (up) { state.effects = Object.assign({}, TQ.DEFAULTS.effects, up.fx || {}); }
      else state.preset = 'custom';
    }
    rt.src = 'channel';
  } else if (state.smart) {
    const p = TQ.GENRE_MAP[info.genre];
    if (p && TQ.PRESETS[p]) {
      state.gains = [...TQ.PRESETS[p].g];
      state.preset = p;
      rt.src = 'smart';
    } else rt.src = 'manual';
  } else rt.src = 'manual';
  persist();
}

function hookVideo(force) {
  const v = document.querySelector('.html5-main-video');
  if (!v) return 'no-video';
  const st = ensureGraph(v);
  if (st !== 'ready') return st;
  if (force || v !== videoEl || !rt._hooked) { autoApply(); rt._hooked = true; }
  applyAudio();
  return 'ready';
}

/* ---------- visualizer + clip feed ---------- */
setInterval(() => {
  if (!vizPorts.size || !analyser) return;
  analyser.getByteFrequencyData(freqData);
  analyser.getByteTimeDomainData(timeData);
  let clip = false;
  for (let i = 0; i < timeData.length; i += 8) {
    const v = timeData[i];
    if (v <= 1 || v >= 254) { clip = true; break; }
  }
  const msg = { bins: Array.from(freqData), clip };
  vizPorts.forEach(p => { try { p.postMessage(msg); } catch (e) { vizPorts.delete(p); } });
}, 70);

chrome.runtime.onConnect.addListener(port => {
  if (port.name !== 'tq-viz') return;
  vizPorts.add(port);
  port.onDisconnect.addListener(() => vizPorts.delete(port));
});

/* ---------- messages ---------- */
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'tq-state') {
    const fx = msg.state.effects;
    Object.assign(state, msg.state);
    if (fx) state.effects = Object.assign({}, TQ.DEFAULTS.effects, fx);
    if (!Array.isArray(state.gains) || state.gains.length !== 10) state.gains = [...TQ.DEFAULTS.gains];
    hookVideo(false);
    applyAudio();
    persist();
    tqRenderMini();
    sendResponse({ ok: true });
  } else if (msg.type === 'tq-get') {
    try {
      const status = hookVideo(false);
      applyAudio();
      sendResponse({ state, status, lastHookError, rt: { src: rt.src, channelName: rt.channelName, genre: rt.genre,
        channelKey: rt.channelKey, remembered: !!(rt.channelKey && state.perChannel[rt.channelKey]) } });
    } catch (e) {
      sendResponse({ state, status: 'error', lastHookError: String((e && e.stack) || e), rt: {} });
    }
  } else if (msg.type === 'tq-remember') {
    if (rt.channelKey) {
      if (msg.forget) delete state.perChannel[rt.channelKey];
      else state.perChannel[rt.channelKey] = { gains: [...state.gains], preset: state.preset, name: rt.channelName };
      persist();
    }
    sendResponse({ ok: true, remembered: !!(rt.channelKey && state.perChannel[rt.channelKey]) });
  }
  return true;
});

/* ---------- in-player floating UI ---------- */
const TQ_MINI_QUICK = ['bass', 'vocal', 'treble', 'flat'];
const TQ_MINI_ALL = ['flat','bass','treble','vocal','loud','rock','pop','jazz','classical','electronic','lofi','vpop','edm'];
let tqFloatBtn = null, tqMiniPanel = null, tqHideObs = null;

const TQ_UI_CSS = [
 '.tq-float-btn{position:absolute;top:12px;right:12px;width:40px;height:40px;border-radius:50%;',
 'background:#ff3b5c;border:2px solid #fff;cursor:pointer;z-index:60;display:flex;align-items:center;',
 'justify-content:center;box-shadow:0 2px 12px rgba(0,0,0,.5);padding:0;}',
 '.tq-float-btn svg{width:22px;height:22px;}',
 '.tq-float-btn.off{background:#3a3d47;}',
 '.tq-float-btn{transition:opacity .25s ease;}',
 '.tq-float-btn.tq-ui-hidden{opacity:0;pointer-events:none;}',
 '.tq-float-btn.pulse::after{content:"";position:absolute;inset:-2px;border-radius:50%;',
 'border:2px solid #ff3b5c;animation:tq-pulse 1.6s ease-out infinite;}',
 '@keyframes tq-pulse{0%{transform:scale(1);opacity:.9}100%{transform:scale(1.55);opacity:0}}',
 '.tq-mini{position:absolute;top:60px;right:12px;width:228px;z-index:60;background:#181920;',
 'border:2px solid #ff3b5c;border-radius:12px;padding:10px 12px;color:#e8eaf0;',
 'font:12px/1.45 -apple-system,"Segoe UI",Roboto,sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.55);}',
 '.tq-mini.hidden{display:none;}',
 '.tq-mini-head{display:flex;align-items:center;gap:8px;margin-bottom:8px;}',
 '.tq-mini-logo{width:20px;height:20px;border-radius:5px;background:#ff3b5c;display:flex;align-items:center;justify-content:center;}',
 '.tq-mini-logo svg{width:12px;height:12px;}',
 '.tq-mini-title{font-weight:700;font-size:13px;}',
 '.tq-mini-power{margin-left:auto;width:10px;height:10px;border-radius:50%;background:#35d07f;cursor:pointer;}',
 '.tq-mini-power.off{background:#555;}',
 '.tq-mini-chips{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:8px;}',
 '.tq-chip{background:#22232c;color:#cfd3de;border:1px solid #2c2f3a;border-radius:12px;',
 'padding:6px 4px;cursor:pointer;font-size:11px;text-align:center;}',
 '.tq-chip:hover{color:#fff;border-color:#3d4252;}',
 '.tq-chip.active{color:#ff3b5c;border-color:#ff3b5c;background:#2d1c22;}',
 '.tq-mini-foot{color:#787d8c;font-size:10px;text-align:center;}',
 '.tq-step{display:flex;align-items:center;gap:6px;background:#22232c;border:1px solid #2c2f3a;',
 'border-radius:10px;padding:3px 4px;margin-bottom:8px;}',
 '.tq-step button{background:none;border:none;color:#cfd3de;font-size:17px;cursor:pointer;padding:1px 10px;line-height:1;}',
 '.tq-step button:hover{color:#ff3b5c;}',
 '.tq-cur{flex:1;text-align:center;color:#fff;font-weight:600;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
].join('');

function tqTSvg() {
  return '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="4.5" rx="1" fill="#fff"/>' +
    '<rect x="9.8" y="5" width="4.5" height="14" rx="1" fill="#fff"/></svg>';
}
function tqEnsureCSS() {
  if (document.getElementById('tq-ui-css')) return;
  const s = document.createElement('style');
  s.id = 'tq-ui-css'; s.textContent = TQ_UI_CSS;
  (document.head || document.documentElement).appendChild(s);
}
function tqPresetLabel() {
  const names = TQ.t(state.lang, 'names');
  if (state.preset && state.preset.indexOf('user:') === 0) return state.preset.slice(5);
  if (TQ.PRESETS[state.preset]) return names[state.preset] || state.preset;
  return TQ.t(state.lang, 'custom');
}
function tqMiniList() {
  const names = TQ.t(state.lang, 'names');
  const customs = Object.keys(state.customPresets || {}).sort()
    .map(n => ({ key: 'user:' + n, name: n }));
  const quick = TQ_MINI_QUICK.map(k => ({ key: k, name: names[k] || k }));
  const all = customs.concat(TQ_MINI_ALL.map(k => ({ key: k, name: names[k] || k })));
  return { customs, quick, all };
}
function tqApplyKey(key) {
  if (key.indexOf('user:') === 0) {
    const p = (state.customPresets || {})[key.slice(5)];
    if (!p || !Array.isArray(p.g)) return;
    state.gains = [...p.g];
    state.effects = Object.assign({}, TQ.DEFAULTS.effects, p.fx || {});
    state.preset = key;
  } else if (TQ.PRESETS[key]) {
    state.preset = key;
    state.gains = [...TQ.PRESETS[key].g];
  } else return;
  applyAudio(); persist(); tqRenderMini();
}
function tqRenderMini() {
  if (!tqMiniPanel || !tqFloatBtn) return;
  if (!state.enabled) { // tat extension -> an nut noi
    tqFloatBtn.style.display = 'none';
    tqMiniPanel.classList.add('hidden');
    return;
  }
  tqFloatBtn.style.display = '';
  const foot = state.lang === 'vi' ? 'Mở popup để chỉnh sâu →' : 'Open popup for full controls →';
  const { customs, quick, all } = tqMiniList();
  const chips = customs.concat(quick);
  const curIdx = Math.max(0, all.findIndex(p => p.key === state.preset));
  tqMiniPanel.innerHTML =
    '<div class="tq-mini-head"><span class="tq-mini-logo">' + tqTSvg() + '</span>' +
    '<span class="tq-mini-title">TubeEQ</span>' +
    '<span class="tq-mini-power" id="tq-mini-power"></span></div>' +
    '<div class="tq-step"><button id="tq-prev">‹</button>' +
    '<span class="tq-cur">' + tqPresetLabel().replace(/</g, '&lt;') + '</span>' +
    '<button id="tq-next">›</button></div>' +
    '<div class="tq-mini-chips">' +
    chips.map(p =>
      '<button class="tq-chip' + (state.preset === p.key ? ' active' : '') + '" data-k="' + p.key.replace(/"/g, '&quot;') + '">' +
      p.name.replace(/</g, '&lt;') + '</button>').join('') +
    '</div><div class="tq-mini-foot">' + foot + '</div>';
  tqMiniPanel.querySelectorAll('.tq-chip').forEach(ch =>
    ch.addEventListener('click', () => tqApplyKey(ch.dataset.k)));
  const step = d => {
    const n = all[(curIdx + d + all.length) % all.length];
    if (n) tqApplyKey(n.key);
  };
  tqMiniPanel.querySelector('#tq-prev').addEventListener('click', () => step(-1));
  tqMiniPanel.querySelector('#tq-next').addEventListener('click', () => step(1));
  tqMiniPanel.querySelector('#tq-mini-power').addEventListener('click', () => {
    state.enabled = false;
    applyAudio(); persist(); tqRenderMini();
  });
}
function tqWatchAutohide() {
  const player = document.getElementById('movie_player');
  if (!player || !tqFloatBtn) return;
  if (tqHideObs) tqHideObs.disconnect();
  const apply = () => {
    const hidden = player.classList.contains('ytp-autohide');
    tqFloatBtn.classList.toggle('tq-ui-hidden', hidden);
    if (hidden && tqMiniPanel) tqMiniPanel.classList.add('hidden');
  };
  apply();
  tqHideObs = new MutationObserver(apply);
  tqHideObs.observe(player, { attributes: true, attributeFilter: ['class'] });
}
function tqBuildUI() {
  if (document.getElementById('tq-float-btn')) return; // da co
  const player = document.getElementById('movie_player');
  if (!player) return; // khong phai trang xem video
  tqEnsureCSS();
  tqFloatBtn = document.createElement('button');
  tqFloatBtn.id = 'tq-float-btn';
  tqFloatBtn.className = 'tq-float-btn';
  tqFloatBtn.innerHTML = tqTSvg();
  tqFloatBtn.title = 'TubeEQ';
  tqMiniPanel = document.createElement('div');
  tqMiniPanel.id = 'tq-mini-panel';
  tqMiniPanel.className = 'tq-mini hidden';
  tqFloatBtn.addEventListener('click', e => {
    e.stopPropagation();
    tqMiniPanel.classList.toggle('hidden');
    tqFloatBtn.classList.remove('pulse');
    try { chrome.storage.local.set({ tqSeenFloat: 1 }); } catch (err) {}
  });
  tqMiniPanel.addEventListener('click', e => e.stopPropagation());
  player.appendChild(tqFloatBtn);
  player.appendChild(tqMiniPanel);
  player.addEventListener('click', () => { if (tqMiniPanel) tqMiniPanel.classList.add('hidden'); });
  try {
    chrome.storage.local.get({ tqSeenFloat: 0 }, r => {
      if (tqFloatBtn && !r.tqSeenFloat) tqFloatBtn.classList.add('pulse');
    });
  } catch (err) {}
  tqRenderMini();
  tqWatchAutohide();
}

/* ---------- boot + SPA navigation ---------- */
state = loadState();
try {
  chrome.storage.sync.get({ tqV2: null }, r => {
    if (r.tqV2) {
      const fx = r.tqV2.effects;
      Object.assign(state, r.tqV2);
      if (fx) state.effects = Object.assign({}, TQ.DEFAULTS.effects, fx);
      hookVideo(false); applyAudio(); tqRenderMini();
    }
  });
} catch (e) {}

hookVideo(false);
tqBuildUI();
document.addEventListener('yt-navigate-finish', () => setTimeout(() => { rt._hooked = false; hookVideo(true); tqBuildUI(); }, 700));
setInterval(() => {
  if (location.href !== lastHref) {
    lastHref = location.href;
    setTimeout(() => { rt._hooked = false; hookVideo(true); tqBuildUI(); }, 700);
  }
  tqBuildUI(); // tu dung lai neu player bi thay (SPA)
  const v = document.querySelector('.html5-main-video');
  if (v && v !== videoEl) { rt._hooked = false; hookVideo(true); }
}, 1500);
})();
