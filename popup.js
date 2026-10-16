/* TubeEQ v2 popup */
const $ = s => document.querySelector(s);
const DEFAULTS = JSON.parse(JSON.stringify(TQ.DEFAULTS));
let state = JSON.parse(JSON.stringify(DEFAULTS));
let rt = { src: 'manual', channelName: '', remembered: false };
let status = 'no-video';
let vizPort = null;

const t = k => TQ.t(state.lang, k);
const fmtDb = db => (db > 0 ? '+' : '') + Number(db).toFixed(1);

/* Donate: dien link Ko-fi / PayPal.Me khi mo lai trang tip; de trong = an nut */
const DONATE_URL = '';

/* ---------- build vertical band sliders ---------- */
const bandsEl = $('#bands');
TQ.BANDS.forEach((b, i) => {
  const d = document.createElement('div');
  d.className = 'band';
  d.innerHTML =
    '<span class="bval" id="bv' + i + '">+0.0</span>' +
    '<input type="range" id="bs' + i + '" min="-12" max="12" step="0.5" value="0" title="">' +
    '<span class="blabel" id="bl' + i + '"></span>';
  bandsEl.appendChild(d);
  d.querySelector('input').addEventListener('input', e => {
    state.gains[i] = parseFloat(e.target.value);
    state.preset = 'custom';
    render(false);
    push();
  });
});

/* ---------- build fx sliders ---------- */
const fxEl = $('#fx');
TQ.FX.forEach(fx => {
  const d = document.createElement('div');
  d.className = 'fx';
  d.innerHTML =
    '<div class="fx-head"><span class="fxlabel" id="fxl_' + fx.id + '"></span>' +
    '<span class="val" id="fxv_' + fx.id + '"></span></div>' +
    '<input type="range" id="fxs_' + fx.id + '" min="0" max="10" step="1" value="' + fx.def + '" title="">';
  fxEl.appendChild(d);
  d.querySelector('input').addEventListener('input', e => {
    state.effects[fx.id] = parseInt(e.target.value, 10);
    render(false);
    push();
  });
});

/* ---------- preset select ---------- */
function buildPresetOptions() {
  const sel = $('#preset');
  sel.innerHTML = '';
  TQ.PRESET_GROUPS.forEach(gr => {
    const og = document.createElement('optgroup');
    og.label = t('groups')[gr.id];
    gr.keys.forEach(k => {
      const o = document.createElement('option');
      o.value = k; o.textContent = t('names')[k];
      og.appendChild(o);
    });
    sel.appendChild(og);
  });
  const o = document.createElement('option');
  o.value = 'custom'; o.textContent = t('custom');
  sel.appendChild(o);
  const mine = Object.keys(state.customPresets || {});
  if (mine.length) {
    const og = document.createElement('optgroup');
    og.label = t('myPresets');
    mine.sort().forEach(name => {
      const u = document.createElement('option');
      u.value = 'user:' + name; u.textContent = name;
      og.appendChild(u);
    });
    sel.appendChild(og);
  }
}

/* user preset helpers */
function userPresetName() {
  return state.preset && state.preset.indexOf('user:') === 0 ? state.preset.slice(5) : null;
}
function applyUserPreset(name) {
  const p = (state.customPresets || {})[name];
  if (!p || !Array.isArray(p.g) || p.g.length !== 10) return false;
  state.gains = [...p.g];
  state.effects = Object.assign({}, TQ.DEFAULTS.effects, p.fx || {});
  state.preset = 'user:' + name;
  return true;
}

/* ---------- i18n static ---------- */
function applyI18n() {
  document.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
  $('#nonstopLabel').title = t('nonstopDesc');
  $('#importCode').placeholder = t('importPh');
  $('#savePreset').title = t('saveTip');
  $('#saveName').placeholder = t('saveNamePh');
  $('#hint').textContent = t('hint');
  $('#lang').textContent = state.lang.toUpperCase();
  TQ.BANDS.forEach((b, i) => {
    $('#bl' + i).textContent = b.label;
  });
  buildPresetOptions();
}

/* ---------- render ---------- */
function render(full = true) {
  if (full) applyI18n();
  TQ.BANDS.forEach((_, i) => {
    $('#bs' + i).value = state.gains[i];
    $('#bv' + i).textContent = fmtDb(state.gains[i]);
    const tip = t('bandTags')[i] + ' — ' + (t('bandDesc')[i] || '');
    $('#bl' + i).title = tip;
    $('#bs' + i).title = tip;
  });
  TQ.FX.forEach(fx => {
    $('#fxs_' + fx.id).value = state.effects[fx.id];
    $('#fxv_' + fx.id).textContent = state.effects[fx.id] + '/10';
    $('#fxl_' + fx.id).textContent = t('fxNames')[fx.id];
    const tip = t('fxDesc')[fx.id] || '';
    $('#fxl_' + fx.id).title = tip;
    $('#fxs_' + fx.id).title = tip;
  });
  const upn = userPresetName();
  $('#preset').value = TQ.PRESETS[state.preset] ? state.preset
    : (upn && state.customPresets[upn] ? state.preset : 'custom');
  $('#vol').value = state.volume;
  $('#volval').textContent = state.volume + '%';
  $('#smart').checked = state.smart;
  $('#nonstop').checked = !!state.nonstop;
  const p = $('#power');
  p.classList.toggle('on', state.enabled);
  document.body.classList.toggle('disabled', !state.enabled);
  const ab = $('#ab');
  ab.classList.toggle('active', state.ab);
  ab.title = t('abHint') + (state.ab ? ' — ' + t('abOn') : '');

  // status line
  const dot = $('#sdot'), txt = $('#stext');
  dot.className = 'sdot ' + (status === 'ready' ? (state.enabled ? 'ok' : 'warn') : status === 'needs-reload' ? 'warn' : 'bad');
  let s = status === 'ready' ? (state.enabled ? t('statusOk') : t('statusOff'))
        : status === 'needs-reload' ? t('statusReload') : t('statusNoVideo');
  const pname = TQ.PRESETS[state.preset] ? t('names')[state.preset]
    : (userPresetName() || t('custom'));
  const via = (state.preset === 'custom' && !userPresetName()) ? '' : ' · ' + pname + ' (' + t('via' + cap(rt.src || 'manual')) + ')';
  txt.textContent = s + (status === 'ready' && state.enabled ? via : '');

  // remember button
  const rb = $('#remember');
  if (rt.channelName) {
    rb.disabled = false;
    rb.textContent = (rt.remembered ? t('forget') : t('remember')) + ' — ' + rt.channelName;
    rb.classList.toggle('remembered', rt.remembered);
  } else {
    rb.disabled = true;
    rb.textContent = t('remember') + '…';
  }
}
function cap(s) { s = String(s || ''); return s.charAt(0).toUpperCase() + s.slice(1); }
// diet gains la tu ban cu (5 band) - neu khong slider se nhan undefined
function fixGains() {
  if (!Array.isArray(state.gains) || state.gains.length !== 10) state.gains = [...DEFAULTS.gains];
}

/* ---------- comms ---------- */
function isYouTubeTab(tab) {
  return tab && tab.url && /^https:\/\/([a-z0-9-]+\.)?youtube\.com\//.test(tab.url);
}
async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}
let pushTimer = null;
async function push() {
  clearTimeout(pushTimer);
  pushTimer = setTimeout(async () => {
    try { await chrome.storage.sync.set({ tqV2: state }); } catch (e) {}
    try {
      const tab = await activeTab();
      if (isYouTubeTab(tab)) await chrome.tabs.sendMessage(tab.id, { type: 'tq-state', state });
    } catch (e) {}
  }, 60);
}
function showDiag(txt) {
  const h = $('#hint');
  h.textContent = txt;
  h.classList.remove('hidden');
}
async function pull() {
  try {
    const tab = await activeTab();
    if (!isYouTubeTab(tab)) { status = 'no-video'; $('#hint').textContent = t('hint'); $('#hint').classList.remove('hidden'); render(false); return; }
    $('#hint').classList.add('hidden');
    const r = await Promise.race([
      chrome.tabs.sendMessage(tab.id, { type: 'tq-get' }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout: tab không trả lời sau 3s')), 3000)),
    ]);
    if (r && r.state) {
      const keepLang = state.lang;
      state = Object.assign(JSON.parse(JSON.stringify(DEFAULTS)), r.state);
      state.lang = r.state.lang || keepLang;
      fixGains();
      rt = r.rt || rt; status = r.status || 'ready';
      render(false);
      if (r.lastHookError) showDiag('Lỗi bắt video: ' + r.lastHookError);
      else if (status === 'error') showDiag('Lỗi nội bộ content script, chụp màn hình gửi tôi nhé.');
    }
  } catch (e) {
    status = 'needs-reload'; render(false);
    showDiag('Không liên lạc được với tab (' + String((e && e.message) || e) + '). Hãy F5 tab YouTube.');
  }
}

/* ---------- events ---------- */
$('#preset').addEventListener('change', e => {
  const k = e.target.value;
  if (k.indexOf('user:') === 0) { if (applyUserPreset(k.slice(5))) { render(false); push(); } }
  else if (TQ.PRESETS[k]) { state.gains = [...TQ.PRESETS[k].g]; state.preset = k; render(false); push(); }
});
$('#power').addEventListener('click', () => { state.enabled = !state.enabled; render(false); push(); });
$('#ab').addEventListener('click', () => { state.ab = !state.ab; render(false); push(); });
$('#reset').addEventListener('click', () => {
  const lang = state.lang;
  state = JSON.parse(JSON.stringify(DEFAULTS)); state.lang = lang;
  render(false); push();
});
$('#vol').addEventListener('input', e => {
  state.volume = parseInt(e.target.value, 10);
  $('#volval').textContent = state.volume + '%';
  push();
});
$('#smart').addEventListener('change', e => { state.smart = e.target.checked; push(); });
$('#nonstop').addEventListener('change', e => { state.nonstop = e.target.checked; push(); });
$('#lang').addEventListener('click', () => {
  state.lang = state.lang === 'vi' ? 'en' : 'vi';
  render(true); push();
});
$('#remember').addEventListener('click', async () => {
  try {
    const tab = await activeTab();
    if (!isYouTubeTab(tab)) return;
    const r = await chrome.tabs.sendMessage(tab.id, { type: 'tq-remember', forget: rt.remembered });
    if (r) { rt.remembered = r.remembered; render(false); }
  } catch (e) {}
});
$('#share').addEventListener('click', async () => {
  const code = TQ.encodePreset(state.gains);
  try { await navigator.clipboard.writeText(code); } catch (e) {}
  const toast = $('#toast');
  toast.textContent = t('copied') + ' ' + code;
  toast.classList.remove('hidden');
  setTimeout(() => toast.classList.add('hidden'), 2500);
});
$('#importToggle').addEventListener('click', () => $('#importRow').classList.toggle('hidden'));
$('#importApply').addEventListener('click', () => {
  const g = TQ.decodePreset($('#importCode').value);
  if (g) { state.gains = g; state.preset = 'custom'; render(false); push(); $('#importRow').classList.add('hidden'); }
});

/* ---------- save / delete user presets ---------- */
$('#savePreset').addEventListener('click', () => {
  const row = $('#saveRow');
  row.classList.toggle('hidden');
  const upn = userPresetName();
  $('#saveName').value = upn || '';
  $('#saveDelete').classList.toggle('hidden', !upn);
  if (!row.classList.contains('hidden')) $('#saveName').focus();
});
$('#saveApply').addEventListener('click', () => {
  const name = $('#saveName').value.trim().slice(0, 24);
  if (!name) { $('#saveName').focus(); return; }
  state.customPresets = state.customPresets || {};
  state.customPresets[name] = { g: [...state.gains], fx: Object.assign({}, state.effects) };
  state.preset = 'user:' + name;
  $('#saveRow').classList.add('hidden');
  const toast = $('#toast');
  toast.textContent = t('presetSaved') + ' ' + name;
  toast.classList.remove('hidden');
  setTimeout(() => toast.classList.add('hidden'), 2500);
  render(true); push();
});
$('#saveDelete').addEventListener('click', () => {
  const upn = userPresetName();
  if (!upn) return;
  delete state.customPresets[upn];
  state.preset = 'custom';
  $('#saveRow').classList.add('hidden');
  render(true); push();
});

/* ---------- visualizer ---------- */
const viz = $('#viz'), vctx = viz.getContext('2d');
function drawViz(bins, clip) {
  const W = viz.width, H = viz.height;
  vctx.clearRect(0, 0, W, H);
  const n = bins.length, bw = W / n;
  for (let i = 0; i < n; i++) {
    const h = (bins[i] / 255) * H;
    vctx.fillStyle = '#ff3b5c';
    vctx.fillRect(i * bw + 1, H - h, bw - 2, h);
  }
  const c = $('#clip');
  c.classList.toggle('hot', !!clip);
}
async function startViz() {
  try {
    const tab = await activeTab();
    if (!isYouTubeTab(tab)) return;
    vizPort = chrome.tabs.connect(tab.id, { name: 'tq-viz' });
    vizPort.onMessage.addListener(m => drawViz(m.bins, m.clip));
    vizPort.onDisconnect.addListener(() => { void chrome.runtime.lastError; vizPort = null; });
  } catch (e) {}
}

/* ---------- boot ---------- */
(async () => {
  try {
    const r = await chrome.storage.sync.get({ tqV2: null });
    if (r.tqV2) {
      const fx = r.tqV2.effects;
      state = Object.assign(JSON.parse(JSON.stringify(DEFAULTS)), r.tqV2);
      state.effects = Object.assign({}, DEFAULTS.effects, fx || {}); // va cho state cu (v2.0)
      fixGains();
    }
  } catch (e) {}
  render(true);
  await pull();
  startViz();
  setInterval(pull, 2500); // dong bo khi chuyen video (auto preset)
  if (DONATE_URL) {
    const dn = $('#donate');
    dn.classList.remove('hidden');
    dn.addEventListener('click', () => { try { chrome.tabs.create({ url: DONATE_URL }); } catch (e) {} });
  }
})();
