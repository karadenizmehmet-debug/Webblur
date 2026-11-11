/*
  WebBlur — fotoğraflardaki yüzleri cihaz üzerinde gizler (blur, mozaik, emoji, düz renk).
  Fotoğraflar hiçbir sunucuya gönderilmez: yüz tespiti (face-api / SSD MobileNet)
  ve bulanıklaştırma tarayıcıda yapılır.
  Mehmet Karadeniz, 2026-2027
*/
'use strict';

const APP_VERSION = '1.2';

const MODEL_URL = './model';
const DETECT_MAX_SIDE = 1600;     // tespit için kullanılan çözünürlük
const THUMB_MAX_SIDE = 360;       // küçük önizleme
const PREVIEW_MAX_SIDE = 1600;    // düzenleyici önizleme
const EXPORT_MAX_PIXELS = 16_000_000; // iOS tuval sınırı
const MIN_SCORE_STORED = 0.2;     // bu skorun altı hiç saklanmaz
const JPEG_QUALITY = 0.92;
const SETTINGS_KEY = 'webblur.settings';

const DEFAULT_SETTINGS = {
  strength: 30, padding: 20, threshold: 45, shape: 'ellipse',
  mode: 'blur', emoji: '😊', color: '#111827',
};
const EMOJIS = ['😊', '🙂', '😄', '😎', '😇', '🤩', '🥳', '🤓', '🐱', '🐶', '🐼', '⭐', '❤️', '🌸'];
const MIX = 'mix';
const COLORS = ['#111827', '#ffffff', '#4f46e5', '#16a34a', '#f59e0b', '#ec4899'];
const STRENGTH_LABEL = { blur: 'Blur derecesi', pixel: 'Mozaik boyutu' };

const state = {
  photos: [],
  settings: loadSettings(),
  modelReady: false,
  queue: Promise.resolve(),
  editor: { index: -1, source: null, addMode: false, showBoxes: true, compare: false, zoom: 1, tx: 0, ty: 0 },
};

const $ = (id) => document.getElementById(id);
const els = {
  fileInput: $('fileInput'), status: $('status'), grid: $('grid'), empty: $('empty'), bar: $('bar'),
  strength: $('strength'), padding: $('padding'), threshold: $('threshold'), shapeSeg: $('shapeSeg'),
  strengthVal: $('strengthVal'), paddingVal: $('paddingVal'), thresholdVal: $('thresholdVal'),
  zipBtn: $('zipBtn'), shareBtn: $('shareBtn'), clearBtn: $('clearBtn'),
  editor: $('editor'), edCanvas: $('edCanvas'), edTitle: $('edTitle'), edLoading: $('edLoading'),
  edStrength: $('edStrength'), edStrengthVal: $('edStrengthVal'),
  edClose: $('edClose'), edPrev: $('edPrev'), edNext: $('edNext'),
  edAdd: $('edAdd'), edUndo: $('edUndo'), edRedo: $('edRedo'), edClearAll: $('edClearAll'),
  edStage: $('edStage'), edZoomIn: $('edZoomIn'), edZoomOut: $('edZoomOut'), edZoomReset: $('edZoomReset'), edBoxes: $('edBoxes'), edCompare: $('edCompare'), edRemove: $('edRemove'),
  toast: $('toast'),
  modeSeg: $('modeSeg'), edModeSeg: $('edModeSeg'), emojiWrap: $('emojiWrap'), emojiRow: $('emojiRow'),
  colorWrap: $('colorWrap'), colorRow: $('colorRow'), shapeRow: $('shapeRow'),
  strengthRow: $('strengthRow'), strengthLabel: $('strengthLabel'),
  edStrengthRow: $('edStrengthRow'), edStrengthLabel: $('edStrengthLabel'),
};

/* ---------- Ayarlar ---------- */

function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    return { ...DEFAULT_SETTINGS, ...saved };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function saveSettings() {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings)); } catch { /* özel mod */ }
}

function syncSettingsUI() {
  const s = state.settings;
  els.strength.value = s.strength;
  els.edStrength.value = s.strength;
  els.padding.value = s.padding;
  els.threshold.value = s.threshold;
  els.strengthVal.textContent = `%${s.strength}`;
  els.edStrengthVal.textContent = `%${s.strength}`;
  els.paddingVal.textContent = `%${s.padding}`;
  els.thresholdVal.textContent = `%${s.threshold}`;
  for (const b of els.shapeSeg.querySelectorAll('button')) {
    b.classList.toggle('on', b.dataset.shape === s.shape);
  }
  for (const b of els.edModeSeg.querySelectorAll('button')) {
    b.classList.toggle('on', b.dataset.mode === s.mode);
  }
  for (const b of els.modeSeg.querySelectorAll('button')) {
    b.classList.toggle('on', b.dataset.mode === s.mode);
  }
  for (const b of els.emojiRow.querySelectorAll('button')) {
    b.classList.toggle('on', b.dataset.emoji === s.emoji);
  }
  for (const b of els.colorRow.querySelectorAll('button')) {
    b.classList.toggle('on', b.dataset.color === s.color);
  }
  const hasStrength = s.mode in STRENGTH_LABEL;
  els.strengthRow.hidden = !hasStrength;
  els.edStrengthRow.hidden = !hasStrength;
  if (hasStrength) {
    els.strengthLabel.textContent = STRENGTH_LABEL[s.mode];
    els.edStrengthLabel.textContent = STRENGTH_LABEL[s.mode];
  }
  els.emojiWrap.hidden = s.mode !== 'emoji';
  els.colorWrap.hidden = s.mode !== 'solid';
  els.shapeRow.hidden = s.mode === 'emoji';
}

function buildPickers() {
  els.emojiRow.innerHTML = [...EMOJIS, MIX]
    .map((e) => `<button type="button" data-emoji="${e}" title="${e === MIX ? 'Karışık' : e}">${e === MIX ? '🔀' : e}</button>`)
    .join('');
  els.colorRow.innerHTML = COLORS
    .map((c) => `<button type="button" data-color="${c}" style="--sw:${c}" aria-label="${c}"></button>`)
    .join('');
}

function setSetting(key, value) {
  state.settings[key] = value;
  saveSettings();
  syncSettingsUI();
  scheduleRedraw();
}

let redrawTimer = 0;
function scheduleRedraw() {
  cancelAnimationFrame(redrawTimer);
  redrawTimer = requestAnimationFrame(() => {
    redrawEditor();
    for (const p of state.photos) drawThumb(p);
  });
}

/* ---------- Görüntü yardımcıları ---------- */

async function decodeImage(file) {
  if ('createImageBitmap' in window) {
    try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch { /* aşağıdaki yola düş */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

const sizeOf = (src) => ({ w: src.naturalWidth || src.width, h: src.naturalHeight || src.height });

function releaseImage(src) {
  if (src && typeof src.close === 'function') src.close();
}

function scaledCanvas(src, maxSide, maxPixels = Infinity) {
  const { w, h } = sizeOf(src);
  let scale = Math.min(1, maxSide / Math.max(w, h));
  if (w * h * scale * scale > maxPixels) scale = Math.sqrt(maxPixels / (w * h));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * scale));
  c.height = Math.max(1, Math.round(h * scale));
  const ctx = c.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, c.width, c.height);
  return c;
}

const supportsCanvasFilter = (() => {
  const ctx = document.createElement('canvas').getContext('2d');
  if (!ctx || !('filter' in ctx)) return false;
  ctx.filter = 'blur(2px)';
  return ctx.filter === 'blur(2px)';
})();

/* ---------- Bulanıklaştırma ---------- */

function activeFaces(photo) {
  const t = state.settings.threshold / 100;
  return photo.faces.filter((f) => f.manual || f.score >= t);
}

function faceRegion(face, W, H) {
  const pad = state.settings.padding / 100;
  const bw = face.w * W * (1 + 2 * pad);
  const bh = face.h * H * (1 + 2 * pad) * 1.12; // yüzler kutudan biraz uzundur
  const cx = (face.x + face.w / 2) * W;
  const cy = (face.y + face.h / 2) * H - face.h * H * 0.04;
  return { cx, cy, bw, bh };
}

function blurRadius(bw, bh) {
  return Math.max(1.5, Math.min(bw, bh) * (state.settings.strength / 100) * 0.22);
}

function blurInto(tctx, source, sx, sy, sw, sh, radius) {
  const tw = tctx.canvas.width;
  const th = tctx.canvas.height;
  if (supportsCanvasFilter) {
    tctx.filter = `blur(${radius.toFixed(1)}px)`;
    tctx.drawImage(source, sx, sy, sw, sh, 0, 0, tw, th);
    tctx.filter = 'none';
    return;
  }
  // Eski Safari: küçült-büyüt ile yumuşak bulanıklık
  const factor = Math.max(1, radius / 1.6);
  const small = document.createElement('canvas');
  small.width = Math.max(1, Math.round(tw / factor));
  small.height = Math.max(1, Math.round(th / factor));
  const sctx = small.getContext('2d');
  sctx.imageSmoothingQuality = 'high';
  sctx.drawImage(source, sx, sy, sw, sh, 0, 0, small.width, small.height);
  tctx.imageSmoothingQuality = 'high';
  tctx.drawImage(small, 0, 0, tw, th);
}

function drawMask(tctx, cx, cy, bw, bh) {
  tctx.globalCompositeOperation = 'destination-in';
  if (state.settings.shape === 'rect') {
    tctx.fillStyle = '#000';
    tctx.fillRect(cx - bw / 2, cy - bh / 2, bw, bh);
  } else {
    tctx.save();
    tctx.translate(cx, cy);
    tctx.scale(bw / 2, bh / 2);
    const g = tctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    g.addColorStop(0, 'rgba(0,0,0,1)');
    g.addColorStop(0.78, 'rgba(0,0,0,1)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    tctx.fillStyle = g;
    tctx.beginPath();
    tctx.arc(0, 0, 1, 0, Math.PI * 2);
    tctx.fill();
    tctx.restore();
  }
  tctx.globalCompositeOperation = 'source-over';
}

function pixelateInto(tctx, source, sx, sy, sw, sh, block) {
  const tw = tctx.canvas.width;
  const th = tctx.canvas.height;
  const small = document.createElement('canvas');
  small.width = Math.max(1, Math.round(tw / block));
  small.height = Math.max(1, Math.round(th / block));
  const sctx = small.getContext('2d');
  sctx.imageSmoothingQuality = 'high';
  sctx.drawImage(source, sx, sy, sw, sh, 0, 0, small.width, small.height);
  tctx.imageSmoothingEnabled = false;
  tctx.drawImage(small, 0, 0, tw, th);
  tctx.imageSmoothingEnabled = true;
}

function pickEmoji(face) {
  if (state.settings.emoji !== MIX) return state.settings.emoji;
  return EMOJIS[(face.k ?? 0) % EMOJIS.length];
}

function drawEmoji(ctx, emoji, cx, cy, bw, bh) {
  const size = Math.max(bw, bh) * 0.98;
  ctx.save();
  ctx.font = `${size}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  const m = ctx.measureText(emoji);
  const asc = m.actualBoundingBoxAscent || size * 0.8;
  const desc = m.actualBoundingBoxDescent || size * 0.2;
  const left = m.actualBoundingBoxLeft ?? m.width / 2;
  const right = m.actualBoundingBoxRight ?? m.width / 2;
  ctx.fillText(emoji, cx + (left - right) / 2, cy + (asc - desc) / 2);
  ctx.restore();
}

function drawSolid(ctx, cx, cy, bw, bh) {
  ctx.save();
  ctx.fillStyle = state.settings.color;
  ctx.beginPath();
  if (state.settings.shape === 'rect') ctx.rect(cx - bw / 2, cy - bh / 2, bw, bh);
  else ctx.ellipse(cx, cy, bw / 2, bh / 2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** Bulanık / mozaik: yüz bölgesini geçici tuvalde işleyip maskeyle geri koyar. */
function drawFiltered(ctx, tctx, source, region, W, H, kx, ky) {
  const { cx, cy, bw, bh } = region;
  const pixel = state.settings.mode === 'pixel';
  const r = blurRadius(bw, bh);
  const margin = pixel ? 2 : r * 2.5;
  const x0 = Math.max(0, Math.floor(cx - bw / 2 - margin));
  const y0 = Math.max(0, Math.floor(cy - bh / 2 - margin));
  const x1 = Math.min(W, Math.ceil(cx + bw / 2 + margin));
  const y1 = Math.min(H, Math.ceil(cy + bh / 2 + margin));
  if (x1 - x0 < 2 || y1 - y0 < 2) return;

  tctx.canvas.width = x1 - x0;
  tctx.canvas.height = y1 - y0;
  const args = [source, x0 * kx, y0 * ky, (x1 - x0) * kx, (y1 - y0) * ky];
  if (pixel) {
    const block = Math.max(3, Math.min(bw, bh) * (state.settings.strength / 100) * 0.3);
    pixelateInto(tctx, ...args, block);
  } else {
    blurInto(tctx, ...args, r);
  }
  drawMask(tctx, cx - x0, cy - y0, bw, bh);
  ctx.drawImage(tctx.canvas, x0, y0);
}

/** source ölçeğinde (W×H) bir tuvale yüzleri seçili yöntemle gizleyerek çizer. */
function renderBlurred(ctx, source, W, H, faces) {
  ctx.drawImage(source, 0, 0, W, H);
  const srcSize = sizeOf(source);
  const kx = srcSize.w / W;
  const ky = srcSize.h / H;
  const tctx = document.createElement('canvas').getContext('2d');
  const mode = state.settings.mode;

  for (const face of faces) {
    if (!face.on) continue;
    const region = faceRegion(face, W, H);
    if (mode === 'emoji') drawEmoji(ctx, pickEmoji(face), region.cx, region.cy, region.bw, region.bh);
    else if (mode === 'solid') drawSolid(ctx, region.cx, region.cy, region.bw, region.bh);
    else drawFiltered(ctx, tctx, source, region, W, H, kx, ky);
  }
}

/* ---------- Yüz tespiti ---------- */

async function loadModel() {
  try {
    await faceapi.tf.ready();
    await faceapi.nets.ssdMobilenetv1.loadFromUri(MODEL_URL);
    state.modelReady = true;
    setStatus('Hazır. Fotoğraf ekleyebilirsiniz.');
    for (const p of state.photos) if (p.status === 'bekliyor') enqueueDetect(p);
  } catch (err) {
    console.error(err);
    setStatus('Yüz tespit modeli yüklenemedi. Sayfayı yenileyin.');
  }
}

function iou(a, b) {
  const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const inter = ix * iy;
  const smaller = Math.min(a.w * a.h, b.w * b.h);
  return { iou: inter / (a.w * a.h + b.w * b.h - inter), overSmaller: inter / smaller };
}

function mergeDetections(list) {
  const sorted = [...list].sort((a, b) => b.score - a.score);
  const kept = [];
  for (const d of sorted) {
    const dup = kept.some((k) => {
      const o = iou(k, d);
      return o.iou > 0.35 || o.overSmaller > 0.6;
    });
    if (!dup) kept.push(d);
  }
  return kept;
}

async function detectOn(canvas, offX, offY, W, H) {
  const options = new faceapi.SsdMobilenetv1Options({ minConfidence: MIN_SCORE_STORED, maxResults: 200 });
  const results = await faceapi.detectAllFaces(canvas, options);
  return results.map((r) => ({
    x: (r.box.x + offX) / W,
    y: (r.box.y + offY) / H,
    w: r.box.width / W,
    h: r.box.height / H,
    score: r.score,
  }));
}

/** Tüm kare + örtüşen 2×2 parçalar: kalabalık fotoğraflardaki küçük yüzler için. */
async function detectFaces(canvas) {
  const W = canvas.width;
  const H = canvas.height;
  const found = await detectOn(canvas, 0, 0, W, H);

  if (Math.max(W, H) >= 700) {
    const tw = Math.round(W * 0.6);
    const th = Math.round(H * 0.6);
    const tile = document.createElement('canvas');
    tile.width = tw;
    tile.height = th;
    const tctx = tile.getContext('2d');
    for (const fx of [0, 0.4]) {
      for (const fy of [0, 0.4]) {
        const ox = Math.round(W * fx);
        const oy = Math.round(H * fy);
        tctx.drawImage(canvas, ox, oy, tw, th, 0, 0, tw, th);
        found.push(...(await detectOn(tile, ox, oy, W, H)));
      }
    }
  }
  return mergeDetections(found)
    .sort((a, b) => a.x - b.x)
    .map((f) => ({ ...f, on: true, manual: false, k: newFaceKey() }));
}

function enqueueDetect(photo) {
  state.queue = state.queue.then(() => runDetect(photo));
}

async function runDetect(photo) {
  if (!state.photos.includes(photo)) return;
  photo.status = 'taranıyor';
  renderTile(photo);
  updateStatus();
  try {
    const img = await decodeImage(photo.file);
    const canvas = scaledCanvas(img, DETECT_MAX_SIDE);
    releaseImage(img);
    photo.faces = await detectFaces(canvas);
    canvas.width = 0;
    photo.status = 'hazır';
  } catch (err) {
    console.error(err);
    photo.status = 'hata';
  }
  renderTile(photo);
  updateStatus();
  if (state.editor.index >= 0 && state.photos[state.editor.index] === photo) redrawEditor();
}

/* ---------- Fotoğraf listesi ---------- */

let nextId = 1;
let faceKey = 0;
const newFaceKey = () => faceKey++;

async function addFiles(files) {
  const images = [...files].filter((f) => f.type.startsWith('image/') || /\.(jpe?g|png|webp|heic|heif)$/i.test(f.name));
  for (const file of images) {
    const photo = { id: nextId++, file, name: file.name, faces: [], status: 'bekliyor', thumb: null, tile: null, undo: [], redo: [] };
    state.photos.push(photo);
    createTile(photo);
    try {
      const img = await decodeImage(file);
      photo.thumb = scaledCanvas(img, THUMB_MAX_SIDE);
      releaseImage(img);
    } catch (err) {
      console.error(err);
      photo.status = 'hata';
    }
    renderTile(photo);
    if (photo.status !== 'hata' && state.modelReady) enqueueDetect(photo);
  }
  updateStatus();
}

function createTile(photo) {
  const tile = document.createElement('div');
  tile.className = 'tile';
  tile.innerHTML = '<canvas></canvas><span class="badge"></span><div class="spin">Bekliyor…</div>';
  tile.addEventListener('click', () => openEditor(state.photos.indexOf(photo)));
  photo.tile = tile;
  els.grid.appendChild(tile);
  updateLayout();
}

function drawThumb(photo) {
  if (!photo.tile || !photo.thumb) return;
  const c = photo.tile.querySelector('canvas');
  c.width = photo.thumb.width;
  c.height = photo.thumb.height;
  renderBlurred(c.getContext('2d'), photo.thumb, c.width, c.height, activeFaces(photo));
}

function renderTile(photo) {
  if (!photo.tile) return;
  drawThumb(photo);
  const badge = photo.tile.querySelector('.badge');
  const spin = photo.tile.querySelector('.spin');
  const labels = { bekliyor: 'Bekliyor…', taranıyor: 'Yüzler aranıyor…', hata: 'Açılamadı' };
  spin.hidden = photo.status === 'hazır';
  spin.textContent = labels[photo.status] || '';
  const n = activeFaces(photo).filter((f) => f.on).length;
  badge.hidden = photo.status !== 'hazır';
  badge.textContent = n ? `${n} yüz gizlendi` : (activeFaces(photo).length ? 'Kapama kaldırıldı' : 'Yüz bulunamadı');
  badge.classList.toggle('warn', n === 0);
}

function refreshBadges() {
  for (const p of state.photos) renderTile(p);
}

function updateLayout() {
  const has = state.photos.length > 0;
  els.empty.hidden = has;
  els.bar.hidden = !has;
}

function updateStatus() {
  if (!state.modelReady) return;
  const total = state.photos.length;
  const pending = state.photos.filter((p) => p.status === 'bekliyor' || p.status === 'taranıyor').length;
  if (!total) setStatus('Hazır. Fotoğraf ekleyebilirsiniz.');
  else if (pending) setStatus(`Yüzler aranıyor… ${total - pending}/${total}`);
  else setStatus(`${total} fotoğraf hazır. Ayarları değiştirince önizleme anında güncellenir.`);
  els.zipBtn.disabled = pending > 0;
  els.shareBtn.disabled = pending > 0;
}

function setStatus(text) { els.status.textContent = text; }

function removePhoto(index) {
  const [p] = state.photos.splice(index, 1);
  if (p && p.tile) p.tile.remove();
  updateLayout();
  updateStatus();
}

/* ---------- Düzenleyici ---------- */

async function openEditor(index) {
  if (index < 0 || index >= state.photos.length) return;
  const ed = state.editor;
  ed.index = index;
  ed.compare = false;
  els.edCompare.classList.remove('active');
  resetZoom();
  els.editor.hidden = false;
  document.body.style.overflow = 'hidden';
  const photo = state.photos[index];
  els.edTitle.textContent = `${index + 1}/${state.photos.length} · ${photo.name}`;
  els.edLoading.hidden = false;
  if (ed.source) ed.source.width = 0;
  ed.source = null;
  redrawEditor();
  try {
    const img = await decodeImage(photo.file);
    if (ed.index !== index) { releaseImage(img); return; }
    ed.source = scaledCanvas(img, PREVIEW_MAX_SIDE);
    releaseImage(img);
  } catch (err) {
    console.error(err);
    toast('Fotoğraf açılamadı.');
  }
  els.edLoading.hidden = true;
  redrawEditor();
  resetZoom();
}

function closeEditor() {
  const ed = state.editor;
  ed.index = -1;
  if (ed.source) ed.source.width = 0;
  ed.source = null;
  ed.addMode = false;
  els.edAdd.classList.remove('active');
  els.editor.hidden = true;
  document.body.style.overflow = '';
  refreshBadges();
}

function redrawEditor(draft) {
  const ed = state.editor;
  if (ed.index < 0) return;
  const photo = state.photos[ed.index];
  const src = ed.source || photo.thumb;
  if (!src) return;
  const c = els.edCanvas;
  c.width = src.width;
  c.height = src.height;
  const ctx = c.getContext('2d');
  const faces = activeFaces(photo);
  if (ed.compare) ctx.drawImage(src, 0, 0);
  else renderBlurred(ctx, src, c.width, c.height, faces);

  if (ed.showBoxes && !ed.compare) {
    const lw = Math.max(1, c.width / 400 / ed.zoom);
    ctx.lineWidth = lw;
    for (const f of faces) {
      ctx.setLineDash(f.on ? [] : [lw * 3, lw * 2]);
      ctx.strokeStyle = f.on ? (f.manual ? '#60a5fa' : '#22c55e') : '#ef4444';
      ctx.strokeRect(f.x * c.width, f.y * c.height, f.w * c.width, f.h * c.height);
    }
    ctx.setLineDash([]);
  }
  if (draft) {
    ctx.lineWidth = Math.max(2, c.width / 400);
    ctx.strokeStyle = '#60a5fa';
    ctx.strokeRect(draft.x * c.width, draft.y * c.height, draft.w * c.width, draft.h * c.height);
  }
  updateEditorButtons();
}

function pointerToNorm(e) {
  const r = els.edCanvas.getBoundingClientRect();
  return {
    x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
    y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
  };
}

function defaultBoxSize(photo) {
  const sizes = photo.faces.map((f) => f.w).sort((a, b) => a - b);
  const w = sizes.length ? sizes[Math.floor(sizes.length / 2)] : 0.12;
  const c = els.edCanvas;
  return { w, h: (w * c.width) / c.height };
}

function setupEditorPointer() {
  const stage = els.edStage;
  const c = els.edCanvas;
  const pointers = new Map();
  let gesture = null;

  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

  stage.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.ed-zoom')) return;
    stage.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const ed = state.editor;
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const m = mid(a, b);
      gesture = { type: 'pinch', d0: dist(a, b), z0: ed.zoom, m0: m };
      redrawEditor();
      return;
    }
    if (pointers.size > 2) return;
    gesture = {
      type: 'single', onCanvas: e.target === c, moved: false,
      px: e.clientX, py: e.clientY, tx0: ed.tx, ty0: ed.ty,
      start: pointerToNorm(e),
    };
  });

  stage.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId) || !gesture) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const ed = state.editor;

    if (gesture.type === 'pinch' && pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      const m = mid(a, b);
      zoomAt(gesture.z0 * (dist(a, b) / gesture.d0), gesture.m0.x, gesture.m0.y);
      // iki parmağın orta noktası kayınca görüntüyü de kaydır
      ed.tx += m.x - gesture.m0.x;
      ed.ty += m.y - gesture.m0.y;
      gesture.m0 = m;
      gesture.z0 = ed.zoom;
      gesture.d0 = dist(a, b);
      applyZoom();
      return;
    }
    if (gesture.type !== 'single') return;
    if (Math.hypot(e.clientX - gesture.px, e.clientY - gesture.py) > 8) gesture.moved = true;
    if (ed.addMode && gesture.onCanvas) {
      redrawEditor(boxFrom(gesture.start, pointerToNorm(e)));
    } else if (gesture.moved && ed.zoom > 1) {
      ed.tx = gesture.tx0 + (e.clientX - gesture.px);
      ed.ty = gesture.ty0 + (e.clientY - gesture.py);
      applyZoom();
    }
  });

  const finish = (e, cancelled) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    const g = gesture;
    if (g && g.type === 'pinch') {
      // ikinci parmak kalkınca yeni tek-parmak hareketi başlamasın
      if (pointers.size === 0) gesture = null;
      else gesture = { type: 'ended' };
      return;
    }
    gesture = pointers.size ? { type: 'ended' } : null;
    if (!g || g.type !== 'single' || cancelled || !g.onCanvas) { redrawEditor(); return; }

    const ed = state.editor;
    const photo = state.photos[ed.index];
    if (!photo) return;
    const p = pointerToNorm(e);
    if (ed.addMode) {
      const box = g.moved ? boxFrom(g.start, p) : null;
      if (box && box.w > 0.005 && box.h > 0.005) {
        pushHistory(photo);
        photo.faces.push({ ...box, score: 1, on: true, manual: true, k: newFaceKey() });
      } else if (!g.moved) {
        const s = defaultBoxSize(photo);
        pushHistory(photo);
        photo.faces.push({ x: p.x - s.w / 2, y: p.y - s.h / 2, w: s.w, h: s.h, score: 1, on: true, manual: true, k: newFaceKey() });
      }
    } else if (!g.moved) {
      toggleFaceAt(photo, p);
    }
    redrawEditor();
    renderTile(photo);
  };

  stage.addEventListener('pointerup', (e) => finish(e, false));
  stage.addEventListener('pointercancel', (e) => finish(e, true));

  stage.addEventListener('wheel', (e) => {
    e.preventDefault();
    zoomAt(state.editor.zoom * Math.exp(-e.deltaY * 0.0015), e.clientX, e.clientY);
  }, { passive: false });
}

function boxFrom(a, b) {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) };
}

/* ---------- Geri al / ileri al ---------- */

const HISTORY_LIMIT = 60;
const snapshot = (photo) => photo.faces.map((f) => ({ ...f }));

/** Yüz listesini değiştirmeden önce çağrılır. */
function pushHistory(photo) {
  photo.undo.push(snapshot(photo));
  if (photo.undo.length > HISTORY_LIMIT) photo.undo.shift();
  photo.redo.length = 0;
}

function stepHistory(from, to) {
  const ed = state.editor;
  const photo = state.photos[ed.index];
  if (!photo || !photo[from].length) return;
  photo[to].push(snapshot(photo));
  photo.faces = photo[from].pop();
  redrawEditor();
  renderTile(photo);
}

const undo = () => stepHistory('undo', 'redo');
const redo = () => stepHistory('redo', 'undo');

function visibleOnCount(photo) {
  return activeFaces(photo).filter((f) => f.on).length;
}

/** Tüm kapamaları kaldırır; hepsi zaten kaldırılmışsa geri getirir. */
function toggleAllFaces() {
  const photo = state.photos[state.editor.index];
  if (!photo || !activeFaces(photo).length) return;
  const turnOn = visibleOnCount(photo) === 0;
  pushHistory(photo);
  for (const f of activeFaces(photo)) f.on = turnOn;
  redrawEditor();
  renderTile(photo);
}

function updateEditorButtons() {
  const photo = state.photos[state.editor.index];
  els.edUndo.disabled = !photo || !photo.undo.length;
  els.edRedo.disabled = !photo || !photo.redo.length;
  const any = photo && activeFaces(photo).length > 0;
  els.edClearAll.disabled = !any;
  els.edClearAll.textContent = any && visibleOnCount(photo) === 0 ? 'Tümünü geri getir' : 'Tümünü kaldır';
}

/* ---------- Yakınlaştırma ---------- */

const ZOOM_MIN = 1;
const ZOOM_MAX = 8;

function applyZoom() {
  const ed = state.editor;
  const c = els.edCanvas;
  // Görüntü, büyütülmemiş kutusunun dışına kaçmasın
  const w = c.offsetWidth;
  const h = c.offsetHeight;
  ed.tx = Math.min(0, Math.max((1 - ed.zoom) * w, ed.tx));
  ed.ty = Math.min(0, Math.max((1 - ed.zoom) * h, ed.ty));
  c.style.transform = ed.zoom === 1 ? '' : `translate(${ed.tx}px, ${ed.ty}px) scale(${ed.zoom})`;
  els.edZoomReset.textContent = `%${Math.round(ed.zoom * 100)}`;
}

/** Ekrandaki (clientX, clientY) noktası sabit kalacak şekilde yakınlaştırır. */
function zoomAt(newZoom, clientX, clientY) {
  const ed = state.editor;
  const r = els.edCanvas.getBoundingClientRect();
  const baseLeft = r.left - ed.tx;
  const baseTop = r.top - ed.ty;
  const lx = (clientX - r.left) / ed.zoom;
  const ly = (clientY - r.top) / ed.zoom;
  ed.zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, newZoom));
  ed.tx = clientX - baseLeft - lx * ed.zoom;
  ed.ty = clientY - baseTop - ly * ed.zoom;
  applyZoom();
}

function zoomCenter(factor) {
  const r = els.edStage.getBoundingClientRect();
  zoomAt(state.editor.zoom * factor, r.left + r.width / 2, r.top + r.height / 2);
}

function resetZoom() {
  const ed = state.editor;
  ed.zoom = 1;
  ed.tx = 0;
  ed.ty = 0;
  applyZoom();
}

function toggleFaceAt(photo, p) {
  const hits = activeFaces(photo)
    .filter((f) => p.x >= f.x && p.x <= f.x + f.w && p.y >= f.y && p.y <= f.y + f.h)
    .sort((a, b) => a.w * a.h - b.w * b.h);
  const f = hits[0];
  if (!f) return;
  pushHistory(photo);
  if (f.manual && f.on) photo.faces.splice(photo.faces.indexOf(f), 1); // elle eklenen kutu silinir
  else f.on = !f.on;
}

/* ---------- Dışa aktarma ---------- */

function outputName(photo, used) {
  const base = photo.name.replace(/\.[^.]+$/, '') || 'foto';
  const ext = photo.file.type === 'image/png' ? 'png' : 'jpg';
  let name = `${base}_blur.${ext}`;
  let i = 2;
  while (used.has(name)) name = `${base}_blur_${i++}.${ext}`;
  used.add(name);
  return name;
}

async function exportPhoto(photo) {
  const img = await decodeImage(photo.file);
  const c = scaledCanvas(img, Infinity, EXPORT_MAX_PIXELS);
  const ctx = c.getContext('2d');
  renderBlurred(ctx, img, c.width, c.height, activeFaces(photo));
  releaseImage(img);
  const type = photo.file.type === 'image/png' ? 'image/png' : 'image/jpeg';
  const blob = await new Promise((res) => c.toBlob(res, type, JPEG_QUALITY));
  c.width = 0;
  if (!blob) throw new Error('Görüntü oluşturulamadı');
  return blob;
}

async function exportAll(onProgress) {
  const used = new Set();
  const out = [];
  for (let i = 0; i < state.photos.length; i++) {
    const p = state.photos[i];
    if (p.status === 'hata') continue;
    onProgress(i + 1, state.photos.length);
    out.push({ name: outputName(p, used), blob: await exportPhoto(p) });
  }
  return out;
}

function stamp() {
  const d = new Date();
  const z = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${z(d.getMonth() + 1)}${z(d.getDate())}_${z(d.getHours())}${z(d.getMinutes())}`;
}

function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

async function withBusy(btn, fn) {
  const label = btn.textContent;
  els.zipBtn.disabled = true;
  els.shareBtn.disabled = true;
  try {
    await fn((i, n) => { btn.textContent = `Hazırlanıyor ${i}/${n}`; });
  } catch (err) {
    if (err && err.name === 'AbortError') return;
    console.error(err);
    toast('İşlem tamamlanamadı: ' + (err && err.message ? err.message : err));
  } finally {
    btn.textContent = label;
    updateStatus();
  }
}

async function downloadZip() {
  await withBusy(els.zipBtn, async (progress) => {
    const files = await exportAll(progress);
    const zip = new JSZip();
    for (const f of files) zip.file(f.name, f.blob);
    els.zipBtn.textContent = 'ZIP oluşturuluyor…';
    const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' });
    downloadBlob(blob, `webblur_${stamp()}.zip`);
    toast(`${files.length} fotoğraf ZIP olarak indirildi.`);
  });
}

async function shareFiles() {
  await withBusy(els.shareBtn, async (progress) => {
    const items = await exportAll(progress);
    const files = items.map((f) => new File([f.blob], f.name, { type: f.blob.type }));
    if (!navigator.canShare || !navigator.canShare({ files })) {
      for (const f of items) downloadBlob(f.blob, f.name);
      return;
    }
    await navigator.share({ files, title: 'WebBlur' });
  });
}

/* ---------- Genel ---------- */

let toastTimer = 0;
function toast(msg) {
  els.toast.textContent = msg;
  els.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { els.toast.hidden = true; }, 3200);
}

function bindEvents() {
  els.fileInput.addEventListener('change', () => {
    addFiles(els.fileInput.files);
    els.fileInput.value = '';
  });

  const onStrength = (e) => setSetting('strength', Number(e.target.value));
  els.strength.addEventListener('input', onStrength);
  els.edStrength.addEventListener('input', onStrength);
  els.padding.addEventListener('input', (e) => setSetting('padding', Number(e.target.value)));
  els.threshold.addEventListener('input', (e) => setSetting('threshold', Number(e.target.value)));
  els.threshold.addEventListener('change', refreshBadges);
  els.shapeSeg.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b) setSetting('shape', b.dataset.shape);
  });

  const onMode = (e) => {
    const b = e.target.closest('button');
    if (b) setSetting('mode', b.dataset.mode);
  };
  els.modeSeg.addEventListener('click', onMode);
  els.edModeSeg.addEventListener('click', onMode);
  els.emojiRow.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b) setSetting('emoji', b.dataset.emoji);
  });
  els.colorRow.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b) setSetting('color', b.dataset.color);
  });

  els.zipBtn.addEventListener('click', downloadZip);
  els.shareBtn.addEventListener('click', shareFiles);
  els.clearBtn.addEventListener('click', () => {
    if (!confirm('Tüm fotoğraflar listeden çıkarılsın mı?')) return;
    while (state.photos.length) removePhoto(0);
  });

  els.edClose.addEventListener('click', closeEditor);
  els.edPrev.addEventListener('click', () => openEditor(state.editor.index - 1));
  els.edNext.addEventListener('click', () => openEditor(state.editor.index + 1));
  els.edAdd.addEventListener('click', () => {
    state.editor.addMode = !state.editor.addMode;
    els.edAdd.classList.toggle('active', state.editor.addMode);
  });
  els.edBoxes.addEventListener('click', () => {
    state.editor.showBoxes = !state.editor.showBoxes;
    els.edBoxes.textContent = state.editor.showBoxes ? 'Kutuları gizle' : 'Kutuları göster';
    redrawEditor();
  });
  els.edCompare.addEventListener('click', () => {
    state.editor.compare = !state.editor.compare;
    els.edCompare.classList.toggle('active', state.editor.compare);
    redrawEditor();
  });
  els.edRemove.addEventListener('click', () => {
    const i = state.editor.index;
    closeEditor();
    removePhoto(i);
  });
  els.edUndo.addEventListener('click', undo);
  els.edRedo.addEventListener('click', redo);
  els.edClearAll.addEventListener('click', toggleAllFaces);
  els.edZoomIn.addEventListener('click', () => zoomCenter(1.5));
  els.edZoomOut.addEventListener('click', () => zoomCenter(1 / 1.5));
  els.edZoomReset.addEventListener('click', resetZoom);
  window.addEventListener('resize', () => { if (state.editor.index >= 0) resetZoom(); });

  document.addEventListener('keydown', (e) => {
    if (state.editor.index < 0) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); (e.shiftKey ? redo : undo)(); return; }
    if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
    if (e.key === '+' || e.key === '=') zoomCenter(1.5);
    if (e.key === '-') zoomCenter(1 / 1.5);
    if (e.key === '0') resetZoom();
    if (e.key === 'Escape') closeEditor();
    if (e.key === 'ArrowLeft') openEditor(state.editor.index - 1);
    if (e.key === 'ArrowRight') openEditor(state.editor.index + 1);
  });

  // Masaüstünde sürükle-bırak
  document.addEventListener('dragover', (e) => e.preventDefault());
  document.addEventListener('drop', (e) => {
    e.preventDefault();
    if (e.dataTransfer && e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
  });

  setupEditorPointer();
}

function init() {
  if (navigator.canShare) {
    try {
      const probe = new File([new Blob(['x'], { type: 'image/jpeg' })], 'a.jpg', { type: 'image/jpeg' });
      els.shareBtn.hidden = !navigator.canShare({ files: [probe] });
    } catch { /* paylaşım yok */ }
  }
  buildPickers();
  syncSettingsUI();
  bindEvents();
  updateLayout();
  loadModel();
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register(`sw.js?v=${APP_VERSION}`).catch(() => { /* çevrimdışı önbellek opsiyonel */ });
  }
}

init();
