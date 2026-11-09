/* 水印工坊 · 渲染进程 UI 逻辑 */
(function () {
  'use strict';

  const R = window.WM.render;
  const IMG = window.WM.imageEngine;
  const PDFE = window.WM.pdfEngine;

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const SETTINGS_KEY = 'watermark-studio.settings.v3';

  const state = {
    items: [],
    nextId: 1,
    selectedId: null,
    opts: Object.assign({}, R.DEFAULTS, { imageFormat: 'auto', pdfRange: '全部' }),
    suffix: '_水印',
    outputMode: 'same',
    outputDir: null,
    info: null,
    running: false,
    lastOutDir: null,
    settingsTimer: null,
    previewTimer: null,
    previewSeq: 0,
  };

  /* -------------------------------- 工具函数 -------------------------------- */

  function toast(message, kind) {
    const el = $('#toast');
    el.textContent = message;
    el.className = 'toast on' + (kind ? ' ' + kind : '');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { el.className = 'toast' + (kind ? ' ' + kind : ''); }, 2600);
  }

  function setStatus(text) { $('#status-text').textContent = text; }

  function setProgress(ratio) {
    const pct = Math.max(0, Math.min(1, ratio || 0)) * 100;
    $('#progress-fill').style.width = pct.toFixed(1) + '%';
  }

  function fmtSize(bytes) {
    if (!bytes && bytes !== 0) return '';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' KB';
    return (bytes / 1024 / 1024).toFixed(1) + ' MB';
  }

  function baseName(name) { return String(name || '').replace(/\.[^.\\/]+$/, ''); }
  function dirName(p) {
    const s = String(p || '');
    const i = Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\'));
    return i > 0 ? s.slice(0, i) : '';
  }
  function fileName(p) {
    const s = String(p || '');
    const i = Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\'));
    return i >= 0 ? s.slice(i + 1) : s;
  }

  function currentItem() { return state.items.find((it) => it.id === state.selectedId) || null; }

  function debounce(fn) {
    let t = null;
    return function () {
      const args = arguments;
      clearTimeout(t);
      t = setTimeout(() => fn.apply(null, args), 90);
    };
  }

  /* --------------------------------- 设置持久化 -------------------------------- */

  function saveSettings() {
    clearTimeout(state.settingsTimer);
    state.settingsTimer = setTimeout(() => {
      try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify({
          opts: state.opts,
          suffix: state.suffix,
          outputMode: state.outputMode,
          outputDir: state.outputDir,
        }));
      } catch { /* 忽略配额问题 */ }
    }, 250);
  }

  function loadSettings() {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (data && data.opts) state.opts = Object.assign(state.opts, data.opts);
      if (typeof data.suffix === 'string') state.suffix = data.suffix;
      if (data.outputMode === 'custom' || data.outputMode === 'same') state.outputMode = data.outputMode;
      if (typeof data.outputDir === 'string') state.outputDir = data.outputDir;
    } catch { /* 忽略损坏的本地设置 */ }
  }

  /* ---------------------------------- 文件队列 --------------------------------- */

  function addFiles(files) {
    if (!files || !files.length) return;
    for (const f of files) {
      const ext = (f.ext || '.' + String(f.name || '').split('.').pop()).toLowerCase();
      const kind = f.kind || (ext === '.pdf' ? 'pdf' : 'image');
      if (kind !== 'pdf' && kind !== 'image') continue;
      const dupe = state.items.some((it) => it.path && f.path && it.path === f.path);
      if (dupe) continue;
      const item = {
        id: state.nextId++,
        name: f.name || fileName(f.path) || '未命名',
        path: f.path || '',
        ext,
        kind,
        size: f.size || (f.bytes ? f.bytes.length : 0),
        bytes: f.bytes,
        status: 'pending',
        outPath: null,
        error: null,
        pdfInfo: null,
        thumbUrl: null,
      };
      if (kind === 'image') {
        try { item.thumbUrl = URL.createObjectURL(new Blob([item.bytes])); } catch { /* 忽略 */ }
      }
      state.items.push(item);
      if (!state.selectedId) state.selectedId = item.id;
    }
    renderFileList();
    renderPreview();
    updateRunButton();
    setStatus(state.items.length ? `已添加 ${state.items.length} 个文件` : '就绪');
  }

  async function addFromPicker() {
    const res = await window.wm.pickFiles();
    if (res && res.files && res.files.length) addFiles(res.files);
    else if (res && res.files && !res.files.length) setStatus('没有可用的文件');
  }

  async function addFromFolder() {
    const res = await window.wm.pickFolder();
    if (res && res.files && res.files.length) addFiles(res.files);
    else if (res && res.files && !res.files.length) toast('该文件夹里没有支持的图片或 PDF', 'err');
  }

  async function addFromDrop(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    const out = [];
    for (const f of files) {
      const ext = '.' + String(f.name || '').split('.').pop().toLowerCase();
      if (!['.jpg', '.jpeg', '.png', '.webp', '.bmp', '.gif', '.avif', '.pdf'].includes(ext)) continue;
      if (f.size > 300 * 1024 * 1024) { toast(`文件过大，已跳过：${f.name}`, 'err'); continue; }
      const path = window.wm.pathForFile ? window.wm.pathForFile(f) : '';
      try {
        const bytes = new Uint8Array(await f.arrayBuffer());
        out.push({ name: f.name, path, ext, kind: ext === '.pdf' ? 'pdf' : 'image', size: bytes.length, bytes });
      } catch {
        toast(`读取失败：${f.name}`, 'err');
      }
    }
    addFiles(out);
  }

  function removeItem(id) {
    const item = state.items.find((it) => it.id === id);
    if (!item) return;
    if (item.thumbUrl) { try { URL.revokeObjectURL(item.thumbUrl); } catch { /* 忽略 */ } }
    state.items = state.items.filter((it) => it.id !== id);
    if (state.selectedId === id) state.selectedId = state.items.length ? state.items[0].id : null;
    renderFileList();
    renderPreview();
    updateRunButton();
  }

  function clearItems() {
    for (const it of state.items) if (it.thumbUrl) { try { URL.revokeObjectURL(it.thumbUrl); } catch { /* 忽略 */ } }
    state.items = [];
    state.selectedId = null;
    state.lastOutDir = null;
    setProgress(0);
    $('#run-summary').textContent = '';
    $('#btn-open-output').disabled = true;
    renderFileList();
    renderPreview();
    updateRunButton();
    setStatus('队列已清空');
  }

  function renderFileList() {
    const list = $('#file-list');
    list.textContent = '';
    $('#file-count').textContent = String(state.items.length);
    $('#file-empty').hidden = state.items.length > 0;

    for (const item of state.items) {
      const li = document.createElement('li');
      li.className = 'file-item' + (item.id === state.selectedId ? ' on' : '');
      li.dataset.id = String(item.id);

      const thumb = document.createElement('div');
      thumb.className = 'thumb' + (item.kind === 'pdf' ? ' pdf' : '');
      if (item.kind === 'image' && item.thumbUrl) {
        const img = document.createElement('img');
        img.src = item.thumbUrl;
        img.alt = '';
        thumb.appendChild(img);
      } else {
        thumb.textContent = item.kind === 'pdf' ? 'PDF' : item.ext.replace('.', '').slice(0, 4).toUpperCase();
      }

      const main = document.createElement('div');
      main.className = 'file-main';
      const nameEl = document.createElement('div');
      nameEl.className = 'file-name';
      nameEl.textContent = item.name;
      nameEl.title = item.path || item.name;
      const sub = document.createElement('div');
      sub.className = 'file-sub';
      const dot = document.createElement('span');
      dot.className = 'dot' + (item.status === 'done' ? ' done' : item.status === 'error' ? ' error' : item.status === 'busy' ? ' busy' : '');
      const label = document.createElement('span');
      const parts = [fmtSize(item.size)];
      if (item.status === 'done') parts.push('已生成 ' + (item.outPath ? fileName(item.outPath) : ''));
      else if (item.status === 'error') parts.push('失败');
      else if (item.status === 'busy') parts.push('处理中…');
      label.textContent = parts.filter(Boolean).join(' · ');
      sub.append(dot, label);
      if (item.status === 'error' && item.error) {
        const err = document.createElement('span');
        err.className = 'err-text';
        err.textContent = item.error;
        err.title = item.error;
        sub.appendChild(err);
      }
      main.append(nameEl, sub);

      const rm = document.createElement('button');
      rm.className = 'remove';
      rm.title = '移除';
      rm.textContent = '✕';
      rm.dataset.remove = String(item.id);

      li.append(thumb, main, rm);
      list.appendChild(li);
    }
  }

  /* ----------------------------------- 预览 ----------------------------------- */

  const schedulePreview = debounce(renderPreview);

  function showPreviewEmpty(message) {
    $('#preview-canvas').hidden = true;
    $('#preview-empty').hidden = false;
    if (message) {
      $('#preview-empty').innerHTML = '';
      const p = document.createElement('p');
      p.textContent = message;
      $('#preview-empty').appendChild(p);
    }
  }

  async function renderPreview() {
    const seq = ++state.previewSeq;
    const item = currentItem();
    const canvas = $('#preview-canvas');
    const stage = $('#preview-stage');

    if (!item) {
      showPreviewEmpty();
      $('#preview-meta').textContent = '';
      $('#preview-note').textContent = '';
      $('#btn-open-result').disabled = true;
      return;
    }
    if (!item.bytes) { showPreviewEmpty('文件内容不可用'); return; }

    $('#preview-note').textContent = item.kind === 'pdf' ? 'PDF 页面示意' : '';
    $('#btn-open-result').disabled = !(item.status === 'done' && item.outPath);

    try {
      const box = { w: Math.max(120, stage.clientWidth - 36), h: Math.max(120, stage.clientHeight - 36) };
      if (item.kind === 'image') await previewImage(item, canvas, box, seq);
      else await previewPdf(item, canvas, box, seq);
      if (seq !== state.previewSeq) return;
      canvas.hidden = false;
      $('#preview-empty').hidden = true;
    } catch (err) {
      if (seq !== state.previewSeq) return;
      showPreviewEmpty('预览失败：' + ((err && err.message) || err));
    }
  }

  function fitScale(w, h, box) {
    return Math.min(box.w / w, box.h / h, 1.6);
  }

  function prepareCanvas(canvas, w, h) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.round(w * dpr));
    canvas.height = Math.max(1, Math.round(h * dpr));
    canvas.style.width = w.toFixed(1) + 'px';
    canvas.style.height = h.toFixed(1) + 'px';
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    return ctx;
  }

  async function previewImage(item, canvas, box, seq) {
    const bmp = await IMG.decode(item.bytes);
    if (seq !== state.previewSeq) { if (bmp.close) bmp.close(); return; }
    const iw = bmp.width || bmp.naturalWidth;
    const ih = bmp.height || bmp.naturalHeight;
    const scale = fitScale(iw, ih, box);
    const w = Math.max(40, Math.round(iw * scale));
    const h = Math.max(40, Math.round(ih * scale));
    const ctx = prepareCanvas(canvas, w, h);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bmp, 0, 0, w, h);
    if (bmp.close) bmp.close();
    const ov = R.overlay(w, h, state.opts, 2);
    ctx.drawImage(ov, 0, 0, w, h);
    $('#preview-meta').textContent = `${iw} × ${ih} px · ${fmtSize(item.size)}`;
  }

  async function previewPdf(item, canvas, box, seq) {
    if (!item.pdfInfo) item.pdfInfo = await PDFE.inspect(item.bytes);
    if (seq !== state.previewSeq) return;
    const info = item.pdfInfo;
    const rot = info.rotation || 0;
    const visual = rot % 180 === 90 ? { w: info.height, h: info.width } : { w: info.width, h: info.height };
    const scale = fitScale(visual.w, visual.h, box);
    const w = Math.max(60, Math.round(visual.w * scale));
    const h = Math.max(60, Math.round(visual.h * scale));
    const ctx = prepareCanvas(canvas, w, h);

    // 页面底
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);

    // 内容占位：表头 + 文本行
    ctx.fillStyle = '#e7ebf4';
    const pad = w * 0.075;
    const lineH = Math.max(3, h * 0.009);
    ctx.fillRect(pad, pad, w * 0.34, lineH * 2.2);
    ctx.fillRect(pad, pad + lineH * 3.4, w * 0.52, lineH);
    let y = pad + lineH * 6.4;
    for (let i = 0; i < 14 && y < h - pad; i += 1) {
      const width = w * (i % 5 === 0 ? 0.42 : 0.62);
      ctx.fillRect(pad, y, width, lineH);
      y += lineH * 2.6;
    }
    // PDF 角标
    ctx.fillStyle = '#d5dbe8';
    ctx.font = `600 ${Math.max(9, w * 0.026)}px -apple-system, "PingFang SC", sans-serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText('PDF 页面示意', pad, h - pad * 0.55);

    // 水印（示意页与真实页面同角度、同比例）
    const ov = R.overlay(w, h, state.opts, 2);
    ctx.drawImage(ov, 0, 0, w, h);

    const applied = PDFE.parseRange(state.opts.pdfRange, info.pageCount).length;
    const mm = (pt) => (pt * 25.4 / 72).toFixed(0);
    $('#preview-meta').textContent = `${info.pageCount} 页 · 第 1 页 ${mm(info.width)}×${mm(info.height)} mm · 将处理 ${applied} 页`;
    if (!applied) $('#preview-note').textContent = '页码设置未匹配任何页面';
  }

  /* --------------------------------- 参数读取 --------------------------------- */

  function readOptsFromUi() {
    const o = state.opts;
    o.text = $('#opt-text').value;
    o.fontKey = $('#opt-font').value;
    o.bold = $('#opt-bold').checked;
    o.sizePct = Number($('#opt-size').value) / 100;
    o.angle = Number($('#opt-angle').value);
    o.opacity = Number($('#opt-opacity').value) / 100;
    const gap = Number($('#opt-gap').value);
    o.gapX = 1.8 * gap;
    o.gapY = 2.9 * gap;
    o.color = $('#opt-color').value;
    o.layout = $('#seg-layout button.on') ? $('#seg-layout button.on').dataset.layout : 'tile';
    o.imageFormat = $('#opt-format').value;
    o.pdfRange = $('#opt-range').value || '全部';
    state.suffix = $('#opt-suffix').value;
    const outSeg = $('#seg-output button.on');
    state.outputMode = outSeg ? outSeg.dataset.mode : 'same';
    return R.normalize(o);
  }

  function syncUiFromState() {
    const o = state.opts;
    $('#opt-text').value = o.text;
    $('#opt-font').value = o.fontKey;
    $('#opt-bold').checked = !!o.bold;
    $('#opt-size').value = String((o.sizePct * 100).toFixed(1));
    $('#opt-angle').value = String(o.angle);
    $('#opt-opacity').value = String(Math.round(o.opacity * 100));
    $('#opt-gap').value = String((o.gapX / 1.8).toFixed(2));
    $('#opt-color').value = o.color;
    $('#opt-format').value = o.imageFormat || 'auto';
    $('#opt-range').value = o.pdfRange || '';
    $('#opt-suffix').value = state.suffix;
    updateSliderLabels();
    markSwatch(o.color);
    markLayout(o.layout);
    markOutputMode(state.outputMode);
    updateOutDirLabel();
    markChip();
  }

  function updateSliderLabels() {
    $('#val-size').textContent = (Number($('#opt-size').value)).toFixed(1) + '%';
    $('#val-angle').textContent = $('#opt-angle').value + '°';
    $('#val-opacity').textContent = $('#opt-opacity').value + '%';
    const gap = Number($('#opt-gap').value);
    $('#val-gap').textContent = gap < 0.8 ? '密' : gap > 1.4 ? '疏' : '中';
  }

  function markSwatch(color) {
    $$('.swatch[data-color]').forEach((el) => el.classList.toggle('on', el.dataset.color.toLowerCase() === String(color).toLowerCase()));
  }
  function markLayout(layout) {
    $$('#seg-layout button').forEach((b) => b.classList.toggle('on', b.dataset.layout === layout));
  }
  function markOutputMode(mode) {
    $$('#seg-output button').forEach((b) => b.classList.toggle('on', b.dataset.mode === mode));
    $('#out-dir-row').hidden = mode !== 'custom';
  }
  function markChip() {
    const text = state.opts.text;
    $$('#preset-chips .chip').forEach((c) => c.classList.toggle('on', c.dataset.text === text));
  }
  function updateOutDirLabel() {
    const label = $('#out-dir-label');
    if (state.outputDir) {
      label.textContent = state.outputDir;
      label.title = state.outputDir;
      label.classList.remove('muted');
    } else {
      label.textContent = '未选择（默认保存到源文件旁）';
      label.title = '';
      label.classList.add('muted');
    }
  }

  /* ---------------------------------- 处理流程 --------------------------------- */

  function resolveOutputDir(item) {
    if (state.outputMode === 'custom' && state.outputDir) return state.outputDir;
    if (item && item.path) return dirName(item.path);
    if (state.lastOutDir) return state.lastOutDir;
    if (state.info && state.info.downloads) return state.info.downloads;
    return '';
  }

  function updateRunButton() {
    const btn = $('#btn-run');
    const label = $('#run-label');
    if (state.running) {
      btn.disabled = true;
      label.textContent = '正在处理…';
      return;
    }
    btn.disabled = state.items.length === 0;
    label.textContent = state.items.length ? `开始处理（${state.items.length} 个文件）` : '开始处理';
  }

  async function runAll() {
    if (state.running) return;
    const opts = readOptsFromUi();
    saveSettings();
    if (!state.items.length) { toast('请先添加文件', 'err'); return; }
    if (state.outputMode === 'custom' && !state.outputDir) {
      const dir = await window.wm.pickDir();
      if (!dir) { toast('请选择输出文件夹', 'err'); return; }
      state.outputDir = dir;
      updateOutDirLabel();
    }

    state.running = true;
    updateRunButton();
    setProgress(0);
    $('#run-summary').textContent = '';
    $('#run-summary').className = 'run-summary';
    $('#btn-open-output').disabled = true;

    let ok = 0;
    let fail = 0;
    let lastDir = '';
    let index = 0;

    for (const item of state.items) {
      index += 1;
      item.status = 'busy';
      item.error = null;
      renderFileList();
      setStatus(`处理中 ${index}/${state.items.length}：${item.name}`);
      try {
        const res = item.kind === 'pdf'
          ? await PDFE.process(item, opts)
          : await IMG.process(item, opts);

        const dir = resolveOutputDir(item);
        if (!dir) throw new Error('无法确定输出目录，请指定输出文件夹');
        const outPath = await window.wm.uniquePath(dir, baseName(item.name) + (state.suffix || ''), res.ext);
        await window.wm.writeFile(outPath, res.bytes);

        item.status = 'done';
        item.outPath = outPath;
        item.result = { bytes: res.bytes.length, pages: res.pages, width: res.width, height: res.height };
        if (item.kind === 'image' && item.thumbUrl) {
          try { URL.revokeObjectURL(item.thumbUrl); } catch { /* 忽略 */ }
          item.thumbUrl = URL.createObjectURL(new Blob([res.bytes], { type: res.mime }));
        }
        lastDir = dir;
        state.lastOutDir = dir;
        ok += 1;
      } catch (err) {
        item.status = 'error';
        item.error = (err && err.message) || String(err);
        fail += 1;
      }
      setProgress(index / state.items.length);
      renderFileList();
    }

    state.running = false;
    updateRunButton();
    renderPreview();

    const summary = `完成：成功 ${ok} 个${fail ? `，失败 ${fail} 个` : ''}`;
    $('#run-summary').textContent = summary;
    $('#run-summary').className = 'run-summary ' + (fail ? 'err' : 'ok');
    setStatus(fail ? summary + ' · 点失败项查看原因' : summary + (lastDir ? ' · 已保存到 ' + lastDir : ''));
    $('#btn-open-output').disabled = !lastDir;
    if (fail) toast(summary, 'err');
    else toast('全部处理完成', 'ok');
  }

  /* ---------------------------------- 事件绑定 --------------------------------- */

  function bindEvents() {
    $('#dropzone').addEventListener('click', addFromPicker);
    $('#dropzone').addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') addFromPicker(); });
    $('#btn-add').addEventListener('click', addFromPicker);
    $('#btn-add-folder').addEventListener('click', addFromFolder);
    $('#btn-clear').addEventListener('click', () => { if (state.items.length) clearItems(); });

    $('#file-list').addEventListener('click', (e) => {
      const rm = e.target.closest('[data-remove]');
      if (rm) { removeItem(Number(rm.dataset.remove)); return; }
      const li = e.target.closest('.file-item');
      if (!li) return;
      const id = Number(li.dataset.id);
      if (id === state.selectedId) return;
      state.selectedId = id;
      renderFileList();
      renderPreview();
    });

    // 设置项
    const onOpt = () => { readOptsFromUi(); saveSettings(); markChip(); markSwatch(state.opts.color); schedulePreview(); };
    $('#opt-text').addEventListener('input', onOpt);
    $('#opt-font').addEventListener('change', onOpt);
    $('#opt-bold').addEventListener('change', onOpt);
    ['#opt-size', '#opt-angle', '#opt-opacity', '#opt-gap'].forEach((sel) => {
      $(sel).addEventListener('input', () => { updateSliderLabels(); onOpt(); });
    });
    $('#opt-color').addEventListener('input', () => { state.opts.color = $('#opt-color').value; markSwatch(state.opts.color); saveSettings(); schedulePreview(); });
    $$('.swatch[data-color]').forEach((el) => {
      el.addEventListener('click', () => {
        state.opts.color = el.dataset.color;
        $('#opt-color').value = el.dataset.color;
        markSwatch(el.dataset.color);
        saveSettings();
        schedulePreview();
      });
    });
    $$('.angle-quick button').forEach((btn) => {
      btn.addEventListener('click', () => {
        $('#opt-angle').value = btn.dataset.angle;
        updateSliderLabels();
        state.opts.angle = Number(btn.dataset.angle);
        saveSettings();
        schedulePreview();
      });
    });
    $('#seg-layout').addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;
      markLayout(btn.dataset.layout);
      state.opts.layout = btn.dataset.layout;
      saveSettings();
      schedulePreview();
    });
    $('#seg-output').addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;
      state.outputMode = btn.dataset.mode;
      markOutputMode(state.outputMode);
      if (state.outputMode === 'custom' && !state.outputDir) pickOutputDir();
      saveSettings();
    });
    $('#opt-format').addEventListener('change', onOpt);
    $('#opt-range').addEventListener('input', onOpt);
    $('#opt-suffix').addEventListener('input', () => { state.suffix = $('#opt-suffix').value; saveSettings(); });
    $('#btn-pick-dir').addEventListener('click', pickOutputDir);
    $('#btn-open-output').addEventListener('click', () => {
      const dir = state.lastOutDir || state.outputDir;
      if (dir) window.wm.openPath(dir);
    });
    $('#btn-open-result').addEventListener('click', () => {
      const item = currentItem();
      if (item && item.outPath) window.wm.openPath(item.outPath);
    });
    $('#btn-run').addEventListener('click', runAll);
    $('#btn-reset').addEventListener('click', resetSettings);

    // 帮助
    $('#btn-help').addEventListener('click', () => { $('#help-modal').hidden = false; });
    $('#btn-help-close').addEventListener('click', () => { $('#help-modal').hidden = true; });
    $('#help-modal').addEventListener('click', (e) => { if (e.target === $('#help-modal')) $('#help-modal').hidden = true; });
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !$('#help-modal').hidden) $('#help-modal').hidden = true;
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); runAll(); }
    });

    // 拖拽
    let dragDepth = 0;
    const overlay = $('#drag-overlay');
    window.addEventListener('dragover', (e) => {
      if (!e.dataTransfer || !Array.from(e.dataTransfer.types || []).includes('Files')) return;
      e.preventDefault();
      if (dragDepth === 0) overlay.classList.add('on');
      dragDepth = 1;
    });
    window.addEventListener('dragleave', (e) => {
      if (!e.relatedTarget) { dragDepth = 0; overlay.classList.remove('on'); }
    });
    window.addEventListener('drop', async (e) => {
      e.preventDefault();
      dragDepth = 0;
      overlay.classList.remove('on');
      await addFromDrop(e.dataTransfer ? e.dataTransfer.files : null);
    });

    // 尺寸变化时重绘预览
    const ro = new ResizeObserver(() => schedulePreview());
    ro.observe($('#preview-stage'));

    // 菜单动作
    if (window.wm.onMenu) {
      window.wm.onMenu((action) => {
        if (action === 'add-files') addFromPicker();
        else if (action === 'add-folder') addFromFolder();
        else if (action === 'run') runAll();
        else if (action === 'open-output') {
          const dir = state.lastOutDir || state.outputDir;
          if (dir) window.wm.openPath(dir);
          else toast('还没有输出文件夹', 'err');
        }
      });
    }
  }

  async function pickOutputDir() {
    const dir = await window.wm.pickDir(state.outputDir || undefined);
    if (dir) {
      state.outputDir = dir;
      state.outputMode = 'custom';
      markOutputMode('custom');
      updateOutDirLabel();
      saveSettings();
    }
  }

  function resetSettings() {
    state.opts = Object.assign({}, R.DEFAULTS, { imageFormat: 'auto', pdfRange: '全部' });
    state.suffix = '_水印';
    state.outputMode = 'same';
    state.outputDir = null;
    syncUiFromState();
    saveSettings();
    schedulePreview();
    toast('已恢复默认参数');
  }

  /* ----------------------------------- 启动 ----------------------------------- */

  function buildPresets() {
    const box = $('#preset-chips');
    box.textContent = '';
    for (const text of R.PRESETS) {
      const b = document.createElement('button');
      b.className = 'chip';
      b.type = 'button';
      b.dataset.text = text;
      b.textContent = text.replace(/^仅用于/, '');
      b.title = text;
      b.addEventListener('click', () => {
        state.opts.text = text;
        $('#opt-text').value = text;
        markChip();
        saveSettings();
        schedulePreview();
      });
      box.appendChild(b);
    }
  }

  async function init() {
    try {
      state.info = await window.wm.info();
    } catch { state.info = { platform: 'darwin', downloads: '' }; }
    document.body.classList.add(state.info.isMac ? 'platform-mac' : 'platform-win');
    if (state.info.version) $('#version-text').textContent = `v${state.info.version}`;

    loadSettings();
    buildPresets();
    syncUiFromState();
    bindEvents();
    renderFileList();
    renderPreview();
    updateRunButton();
    setStatus('就绪 · 拖入文件开始');

    const params = new URLSearchParams(location.search);
    if (params.get('demo') === '1') {
      const img = await makeSyntheticImage();
      const pdf = await makeSyntheticPdf();
      addFiles([
        { name: '付款回单-示例.jpg', path: '', ext: '.jpg', kind: 'image', size: img.length, bytes: img },
        { name: '合同扫描件-示例.pdf', path: '', ext: '.pdf', kind: 'pdf', size: pdf.bytes.length, bytes: pdf.bytes },
      ]);
      state.selectedId = state.items[0].id;
      renderFileList();
      renderPreview();
    }

    if (params.get('selftest') === '1') {
      runSelfTest().catch((err) => {
        try { window.wm.selftest({ error: String((err && err.stack) || err) }); } catch { /* 忽略 */ }
      });
    }
  }

  /* --------------------------------- 自检（构建时验证） -------------------------------- */

  async function selftestOutPath(name) {
    const dir = new URLSearchParams(location.search).get('out') || '.';
    return dir.replace(/\/$/, '') + '/' + name;
  }

  async function makeSyntheticImage() {
    const c = document.createElement('canvas');
    c.width = 1000;
    c.height = 1300;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, c.width, c.height);

    ctx.fillStyle = '#b4232a';
    ctx.font = '700 30px -apple-system, "PingFang SC", sans-serif';
    ctx.fillText('示例贸易有限公司  付款回单（样例）', 80, 96);
    ctx.fillStyle = '#6b7280';
    ctx.font = '400 15px -apple-system, "PingFang SC", sans-serif';
    ctx.fillText('SAMPLE TRADING CO., LTD.  ·  PAYMENT RECEIPT', 80, 124);
    ctx.fillStyle = '#b4232a';
    ctx.fillRect(80, 142, 840, 3);

    const rows = [
      ['付款人', '上海示例国际贸易有限公司'],
      ['账　号', '1001 2663 0920 0016 953'],
      ['开户行', '示例银行 城南支行'],
      ['收款人', '成都示例科技有限公司 沈阳分公司'],
      ['账　号', '1001 2663 1920 0447 455'],
      ['金　额', 'CNY 1,000,000.00（壹佰万元整）'],
      ['用　途', '货款结算 · 合同编号 HT-2026-0119'],
      ['交易流水号', '15066823'],
      ['交易时间', '2026-01-26 13:42:21'],
    ];
    const top = 180;
    const rowH = 74;
    const labelW = 210;
    ctx.strokeStyle = '#d7dbe3';
    ctx.lineWidth = 2;
    ctx.font = '400 19px -apple-system, "PingFang SC", sans-serif';
    rows.forEach((row, i) => {
      const y = top + i * rowH;
      ctx.strokeRect(80, y, 840, rowH);
      ctx.beginPath();
      ctx.moveTo(80 + labelW, y);
      ctx.lineTo(80 + labelW, y + rowH);
      ctx.stroke();
      ctx.fillStyle = '#4b5563';
      ctx.font = '500 18px -apple-system, "PingFang SC", sans-serif';
      ctx.fillText(row[0], 100, y + rowH / 2 + 6);
      ctx.fillStyle = '#111827';
      ctx.font = '400 19px -apple-system, "PingFang SC", sans-serif';
      ctx.fillText(row[1], 80 + labelW + 24, y + rowH / 2 + 7);
    });

    const noteY = top + rows.length * rowH + 46;
    ctx.fillStyle = '#9ca3af';
    ctx.font = '400 16px -apple-system, "PingFang SC", sans-serif';
    ctx.fillText('本回单仅供对账使用，不作为收款方发货依据，请勿重复记账。', 80, noteY);

    ctx.save();
    ctx.globalAlpha = 0.12;
    ctx.strokeStyle = '#b4232a';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(760, 1010, 92, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = '#b4232a';
    ctx.font = '700 20px -apple-system, "PingFang SC", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('电子回单', 760, 1002);
    ctx.fillText('专 用 章', 760, 1030);
    ctx.restore();
    ctx.textAlign = 'left';

    return new Uint8Array(await (await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.93))).arrayBuffer());
  }

  async function makeSyntheticPdf() {
    const { PDFDocument, StandardFonts, rgb, degrees } = window.PDFLib;
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    for (let i = 0; i < 3; i += 1) {
      const page = doc.addPage([595, 842]);
      page.drawText('Watermark Studio self-test page ' + (i + 1), { x: 60, y: 760, size: 18, font, color: rgb(0.2, 0.2, 0.25) });
      for (let l = 0; l < 12; l += 1) {
        page.drawText('Lorem ipsum dolor sit amet, consectetur adipiscing elit ' + (l + 1), {
          x: 60, y: 720 - l * 26, size: 11, font, color: rgb(0.55, 0.57, 0.62),
        });
      }
      if (i === 1) page.setRotation(degrees(90));
      if (i === 2) page.setRotation(degrees(270));
    }
    return { bytes: new Uint8Array(await doc.save()), info: doc };
  }

  async function runSelfTest() {
    const results = {};
    const opts = R.normalize(Object.assign({}, R.DEFAULTS, { pdfRange: '全部' }));

    const imgBytes = await makeSyntheticImage();
    const imgOut = await IMG.process({ kind: 'image', ext: '.jpg', name: 'synthetic.jpg', bytes: imgBytes }, opts);
    const imgPath = await selftestOutPath('out-image.jpg');
    await window.wm.writeFile(imgPath, imgOut.bytes);
    results.image = { path: imgPath, bytes: imgOut.bytes.length, width: imgOut.width, height: imgOut.height };

    const pdf = await makeSyntheticPdf();
    const pdfOut = await PDFE.process({ kind: 'pdf', ext: '.pdf', name: 'synthetic.pdf', bytes: pdf.bytes }, opts);
    const pdfPath = await selftestOutPath('out-doc.pdf');
    await window.wm.writeFile(pdfPath, pdfOut.bytes);
    results.pdf = { path: pdfPath, bytes: pdfOut.bytes.length, pages: pdfOut.pages, totalPages: pdfOut.totalPages };

    const pdfRange = await PDFE.process({ kind: 'pdf', ext: '.pdf', name: 'synthetic.pdf', bytes: pdf.bytes }, Object.assign({}, opts, { pdfRange: '2' }));
    const rangePath = await selftestOutPath('out-doc-page2.pdf');
    await window.wm.writeFile(rangePath, pdfRange.bytes);
    results.range = { path: rangePath, pages: pdfRange.pages, totalPages: pdfRange.totalPages, bytes: pdfRange.bytes.length };

    const centerOut = await IMG.process({ kind: 'image', ext: '.jpg', name: 'synthetic.jpg', bytes: imgBytes }, Object.assign({}, opts, { layout: 'center', angle: 0, opacity: 0.35 }));
    const centerPath = await selftestOutPath('out-image-center.jpg');
    await window.wm.writeFile(centerPath, centerOut.bytes);
    results.center = { path: centerPath, bytes: centerOut.bytes.length };

    // 旋转页单页样本（便于目视核对 /Rotate 90、270 的角度是否正确）
    for (const [rot, name] of [[90, 'out-doc-rot90.pdf'], [270, 'out-doc-rot270.pdf']]) {
      const { PDFDocument } = window.PDFLib;
      const srcDoc = await PDFDocument.load(pdf.bytes);
      const single = await PDFDocument.create();
      const [copied] = await single.copyPages(srcDoc, [rot === 90 ? 1 : 2]);
      single.addPage(copied);
      const singleBytes = new Uint8Array(await single.save());
      const singleOut = await PDFE.process({ kind: 'pdf', ext: '.pdf', name: 'rot.pdf', bytes: singleBytes }, opts);
      const singlePath = await selftestOutPath(name);
      await window.wm.writeFile(singlePath, singleOut.bytes);
      results['rot' + rot] = { path: singlePath, bytes: singleOut.bytes.length, pages: singleOut.pages };
    }

    // 参数变体（用于挑选默认值）
    const params = new URLSearchParams(location.search);
    const variantsArg = params.get('variants');
    const fixturePath = params.get('fixture');
    let fixtureItem = null;
    if (fixturePath) {
      const f = await window.wm.readFile(fixturePath);
      if (f) fixtureItem = { kind: f.kind, ext: f.ext, name: f.name, bytes: f.bytes };
    }
    if (fixtureItem) {
      const fxOut = fixtureItem.kind === 'pdf'
        ? await PDFE.process(fixtureItem, opts)
        : await IMG.process(fixtureItem, opts);
      const fxPath = await selftestOutPath('out-fixture.' + (fixtureItem.kind === 'pdf' ? 'pdf' : 'jpg'));
      await window.wm.writeFile(fxPath, fxOut.bytes);
      results.fixture = { path: fxPath, bytes: fxOut.bytes.length };
    }

    if (variantsArg) {
      const list = [
        ['A', { sizePct: 0.040, gapX: 1.15, gapY: 1.65, opacity: 0.22 }],
        ['B', { sizePct: 0.038, gapX: 1.8, gapY: 2.9, opacity: 0.18 }],
        ['C', { sizePct: 0.034, gapX: 2.0, gapY: 3.3, opacity: 0.16 }],
        ['D', { sizePct: 0.045, gapX: 1.6, gapY: 2.5, opacity: 0.20 }],
      ];
      results.variants = [];
      for (const [tag, patch] of list) {
        const vopts = R.normalize(Object.assign({}, opts, patch));
        const src = fixtureItem || { kind: 'image', ext: '.jpg', name: 'synthetic.jpg', bytes: imgBytes };
        const out = src.kind === 'pdf'
          ? await PDFE.process(src, vopts)
          : await IMG.process(src, vopts);
        const p = await selftestOutPath('variant-' + tag + (src.kind === 'pdf' ? '.pdf' : '.jpg'));
        await window.wm.writeFile(p, out.bytes);
        results.variants.push({ tag, path: p, patch, bytes: out.bytes.length });
      }
    }

    results.opts = { sizePct: opts.sizePct, angle: opts.angle, opacity: opts.opacity, color: opts.color };
    try { await window.wm.selftest(results); } catch { /* 非自检环境 */ }
  }

  window.addEventListener('DOMContentLoaded', init);
})();
