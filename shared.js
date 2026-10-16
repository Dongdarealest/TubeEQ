/* TubeEQ v2.1 — shared constants (loaded by content script AND popup) */
const TQ = {};

TQ.BANDS = [
  { f: 31,    type: 'lowshelf',  q: 0.7, label: '31'  },
  { f: 62,    type: 'peaking',   q: 1.0, label: '62'  },
  { f: 125,   type: 'peaking',   q: 1.0, label: '125' },
  { f: 250,   type: 'peaking',   q: 1.0, label: '250' },
  { f: 500,   type: 'peaking',   q: 1.0, label: '500' },
  { f: 1000,  type: 'peaking',   q: 1.0, label: '1k'  },
  { f: 2000,  type: 'peaking',   q: 1.0, label: '2k'  },
  { f: 4000,  type: 'peaking',   q: 1.0, label: '4k'  },
  { f: 8000,  type: 'peaking',   q: 1.0, label: '8k'  },
  { f: 16000, type: 'highshelf', q: 0.7, label: '16k' },
];

/* 10 gains each, dB (-12..+12) */
TQ.PRESETS = {
  flat:      { g: [0,0,0,0,0,0,0,0,0,0] },
  bass:      { g: [7,6,4,2,0,0,0,0,1,2] },
  treble:    { g: [0,0,0,0,0,1,2,3,5,7] },
  vocal:     { g: [-2,0,1,3,5,4,2,1,0,0] },
  loud:      { g: [5,4,3,1,0,0,0,1,3,4] },
  rock:      { g: [5,4,2,0,-1,-1,0,2,4,5] },
  pop:       { g: [3,4,3,1,0,0,1,2,3,4] },
  jazz:      { g: [4,3,2,1,0,1,2,2,1,0] },
  classical: { g: [2,2,1,0,0,0,1,2,3,4] },
  electronic:{ g: [6,5,3,1,0,0,1,2,4,5] },
  lofi:      { g: [5,4,3,2,1,0,-1,-2,-3,-5] },
  vpop:      { g: [3,4,3,2,1,1,2,3,3,2] },
  edm:       { g: [6,6,4,2,0,0,2,3,5,6] },
};

TQ.PRESET_GROUPS = [
  { id: 'basic',     keys: ['flat','bass','treble','vocal','loud'] },
  { id: 'music',     keys: ['rock','pop','jazz','classical','electronic','lofi'] },
  { id: 'community', keys: ['vpop','edm'] },
];

/* YouTube <meta itemprop="genre"> -> preset suggestion */
TQ.GENRE_MAP = {
  'Music': 'loud',
  'Gaming': 'bass',
  'News & Politics': 'vocal',
  'Education': 'vocal',
  'People & Blogs': 'vocal',
  'Howto & Style': 'vocal',
  'Comedy': 'vocal',
  'Nonprofits & Activism': 'vocal',
};

/* FxSound-style effect sliders: 0..10 */
TQ.FX = [
  { id: 'clarity',  def: 3 },
  { id: 'ambience', def: 0 },
  { id: 'surround', def: 0 },
  { id: 'dynBoost', def: 4 },
  { id: 'restore',  def: 3 },
];

TQ.DEFAULTS = {
  enabled: true,
  gains: [0,0,0,0,0,0,0,0,0,0],
  preset: 'flat',
  volume: 100,          // 0..200 (%)
  smart: true,          // auto preset by video genre
  nonstop: false,      // auto-confirm "Continue watching?" so idle never pauses you
  lang: 'vi',           // 'vi' | 'en'
  ab: false,            // A/B compare (true = listening to original)
  effects: { clarity: 3, ambience: 0, surround: 0, dynBoost: 4, restore: 3 },
  perChannel: {},       // channelKey -> { gains:[...], preset, name }
  customPresets: {},    // name -> { g:[...], fx:{...} }  (user-saved, shown under "My presets")
};

/* preset share code: TQ1.<base64 of 10 bytes> */
TQ.encodePreset = function (gains) {
  const bytes = gains.map(g => Math.max(0, Math.min(48, Math.round((g + 12) * 2))));
  return 'TQ1.' + btoa(String.fromCharCode.apply(null, bytes));
};
TQ.decodePreset = function (code) {
  const m = /^TQ1\.([A-Za-z0-9+/=]+)$/.exec((code || '').trim());
  if (!m) return null;
  try {
    const s = atob(m[1]);
    if (s.length !== 10) return null;
    return Array.from(s).map(ch => (ch.charCodeAt(0) / 2) - 12);
  } catch (e) { return null; }
};

TQ.I18N = {
vi: {
  preset: 'Preset', custom: 'Tùy chỉnh', volume: 'Âm lượng',
  smart: 'EQ thông minh theo loại video', remember: 'Nhớ cho kênh này', forget: 'Bỏ nhớ kênh này',
  nonstop: 'Nonstop', nonstopDesc: 'Tự bấm "Tiếp tục xem" khi YouTube hỏi vì không thao tác', donate: 'Ủng hộ',
  share: 'Chia sẻ', importBtn: 'Nhập mã', importPh: 'Dán mã preset…', apply: 'Áp dụng', copied: 'Đã copy mã preset!',
  saveTip: 'Lưu cấu hình hiện tại thành preset', saveNamePh: 'Tên preset…', saveBtn: 'Lưu',
  myPresets: 'Của tôi', deleteBtn: 'Xóa', presetSaved: 'Đã lưu preset!',
  ab: 'A/B', abHint: 'So sánh với bản gốc', abOn: 'đang nghe bản gốc', reset: 'Đặt lại',
  statusOk: 'Đang xử lý tiếng', statusOff: 'Đang tắt',
  statusReload: 'Hãy tải lại tab YouTube (F5)', statusNoVideo: 'Chưa thấy video',
  hint: 'Mở một video YouTube rồi bấm lại icon TubeEQ nhé.',
  viaChannel: 'theo kênh', viaSmart: 'tự động', viaManual: 'tay chỉnh',
  bandTags: ['siêu trầm','trầm sâu','trầm ấm','độ ấm','trung trầm','giọng nói','độ rõ','chi tiết','độ sáng','không khí'],
  fxTitle: 'Hiệu ứng',
  fxNames: { clarity: 'Trong', ambience: 'Vang', surround: 'Rộng', dynBoost: 'Căng', restore: 'Giả lập Lossless' },
  fxDesc: {
    clarity: 'Kích thích harmonic dải cao — tiếng trong, chi tiết hơn mà không chói.',
    ambience: 'Reverb nhẹ — cảm giác không gian như nghe trong phòng.',
    surround: 'Mở rộng stereo — âm trường rộng hơn.',
    dynBoost: 'Nén thông minh — tiếng căng, to đều mà không vỡ.',
    restore: 'Giả lập chất lossless: phục hồi transient bị codec lossy làm mờ — tiếng trống, guitar gảy sắc lại như bản gốc.',
  },
  bandDesc: [
    'Siêu trầm — độ rung, lực nện của bass. Tăng nhiều dễ rè loa nhỏ.',
    'Trầm sâu — tiếng trống bass, guitar bass.',
    'Trầm ấm — độ dày của nhạc cụ và giọng hát.',
    'Trầm trung — độ ấm; tăng quá tay gây ù, bí.',
    'Trung trầm — độ đầy, "hộp tiếng" của nhạc cụ.',
    'Trung — độ rõ của lời nói và guitar.',
    'Trung cao — độ nét, sự hiện diện của giọng hát.',
    'Cao trung — độ sắc, chi tiết nhạc cụ.',
    'Cao — độ sáng, tiếng hi-hat, không khí.',
    'Siêu cao — độ thoáng, "air" của bản nhạc.',
  ],
  groups: { basic: 'Cơ bản', music: 'Theo dòng nhạc', community: 'Cộng đồng' },
  names: { flat:'Tắt (Flat)', bass:'Bass Boost', treble:'Treble Boost', vocal:'Vocal', loud:'Loudness',
    rock:'Rock', pop:'Pop', jazz:'Jazz', classical:'Classical', electronic:'Electronic', lofi:'Lofi',
    vpop:'V-Pop', edm:'EDM' },
},
en: {
  preset: 'Preset', custom: 'Custom', volume: 'Volume',
  smart: 'Smart EQ by video type', remember: 'Remember for this channel', forget: 'Forget this channel',
  nonstop: 'Nonstop', nonstopDesc: 'Auto-click "Continue watching" when YouTube asks due to inactivity', donate: 'Donate',
  share: 'Share', importBtn: 'Import', importPh: 'Paste preset code…', apply: 'Apply', copied: 'Preset code copied!',
  saveTip: 'Save current settings as a preset', saveNamePh: 'Preset name…', saveBtn: 'Save',
  myPresets: 'My presets', deleteBtn: 'Delete', presetSaved: 'Preset saved!',
  ab: 'A/B', abHint: 'Compare with original', abOn: 'listening to original', reset: 'Reset',
  statusOk: 'Processing audio', statusOff: 'Off',
  statusReload: 'Reload the YouTube tab (F5)', statusNoVideo: 'No video found',
  hint: 'Open a YouTube video, then click the TubeEQ icon again.',
  viaChannel: 'per channel', viaSmart: 'auto', viaManual: 'manual',
  bandTags: ['sub-bass','deep bass','warm bass','warmth','low mids','vocals','presence','detail','brightness','air'],
  fxTitle: 'Effects',
  fxNames: { clarity: 'Crystal', ambience: 'Space', surround: 'Wide', dynBoost: 'Punch', restore: 'Simulated Lossless' },
  fxDesc: {
    clarity: 'High-frequency harmonic exciter — clearer, more detailed, never harsh.',
    ambience: 'Gentle reverb — a sense of room space.',
    surround: 'Stereo widener — a wider soundstage.',
    dynBoost: 'Smart compression — loud and punchy without clipping.',
    restore: 'Simulated lossless: restores transients smeared by lossy codecs — drums and plucks snap like the original.',
  },
  bandDesc: [
    'Sub-bass — rumble and physical punch. Too much distorts small speakers.',
    'Deep bass — kick drum, bass guitar.',
    'Warm bass — body of instruments and vocals.',
    'Low mids — warmth; too much sounds muddy.',
    'Mid-low — fullness, the "boxy" range.',
    'Mids — clarity of speech and guitars.',
    'Upper mids — presence and definition of vocals.',
    'High mids — edge and instrument detail.',
    'Treble — brightness, hi-hats, air.',
    'Top end — openness and shimmer.',
  ],
  groups: { basic: 'Basic', music: 'By genre', community: 'Community' },
  names: { flat:'Off (Flat)', bass:'Bass Boost', treble:'Treble Boost', vocal:'Vocal', loud:'Loudness',
    rock:'Rock', pop:'Pop', jazz:'Jazz', classical:'Classical', electronic:'Electronic', lofi:'Lofi',
    vpop:'V-Pop', edm:'EDM' },
},
};
TQ.t = function (lang, key) { return (TQ.I18N[lang] && TQ.I18N[lang][key]) || TQ.I18N.en[key] || key; };
