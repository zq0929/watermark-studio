/* PDF 水印：pdf-lib 在页面坐标系中叠加一张透明水印图层（每页尺寸缓存一次）。 */
(function () {
  'use strict';

  const R = window.WM.render;
  const PX_PER_PT = 2; // 144 dpi 的水印图层，矢量叠加前先栅格化

  function lib() {
    if (!window.PDFLib) throw new Error('PDF 引擎未加载（pdf-lib）');
    return window.PDFLib;
  }

  /** 解析页码："" / "全部" → 全部；支持 "1-3,5"、"-3"、"2-" */
  function parseRange(input, total) {
    const raw = String(input == null ? '' : input).trim();
    if (!raw || raw === '全部' || raw === 'all' || raw === '*') {
      return Array.from({ length: total }, (_, i) => i);
    }
    const set = new Set();
    for (const part of raw.split(/[,，;；\s]+/)) {
      if (!part) continue;
      const m = part.match(/^(\d*)\s*[-–~至]\s*(\d*)$/);
      if (m) {
        const a = m[1] ? parseInt(m[1], 10) : 1;
        const b = m[2] ? parseInt(m[2], 10) : total;
        const lo = Math.max(1, Math.min(a, b));
        const hi = Math.min(total, Math.max(a, b));
        for (let p = lo; p <= hi; p += 1) set.add(p - 1);
      } else if (/^\d+$/.test(part)) {
        const p = parseInt(part, 10);
        if (p >= 1 && p <= total) set.add(p - 1);
      }
    }
    return Array.from(set).sort((a, b) => a - b);
  }

  function pageBox(page) {
    try {
      const box = page.getCropBox ? page.getCropBox() : page.getMediaBox();
      if (box && box.width > 0 && box.height > 0) return box;
    } catch { /* 回退到 MediaBox */ }
    const mb = page.getMediaBox();
    return mb;
  }

  function pageRotation(page) {
    try {
      const deg = page.getRotation();
      const angle = deg && typeof deg.angle === 'number' ? deg.angle : 0;
      return ((Math.round(angle) % 360) + 360) % 360;
    } catch {
      return 0;
    }
  }

  function canvasToPng(canvas) {
    return new Promise((resolve, reject) => {
      canvas.toBlob(async (blob) => {
        if (!blob) return reject(new Error('水印图层生成失败'));
        resolve(new Uint8Array(await blob.arrayBuffer()));
      }, 'image/png');
    });
  }

  async function process(item, options) {
    const { PDFDocument } = lib();
    const opts = R.normalize(options);
    let doc;
    try {
      doc = await PDFDocument.load(item.bytes, { updateMetadata: false });
    } catch (err) {
      const msg = String((err && err.message) || err);
      if (/encrypt/i.test(msg)) throw new Error('该 PDF 已加密，暂不支持添加水印');
      throw new Error('无法解析该 PDF：' + msg);
    }

    const pages = doc.getPages();
    if (!pages.length) throw new Error('该 PDF 没有页面');
    const targets = parseRange(opts.pdfRange, pages.length);
    if (!targets.length) throw new Error('页码范围没有匹配到任何页面');

    const cache = new Map();
    let applied = 0;
    for (const index of targets) {
      const page = pages[index];
      const box = pageBox(page);
      const rot = pageRotation(page);
      const key = `${Math.round(box.width)}x${Math.round(box.height)}|${rot}`;
      let image = cache.get(key);
      if (!image) {
        const cw = Math.max(8, Math.round(box.width * PX_PER_PT));
        const ch = Math.max(8, Math.round(box.height * PX_PER_PT));
        const canvas = document.createElement('canvas');
        canvas.width = cw;
        canvas.height = ch;
        // 页面 /Rotate 会在显示时顺时针旋转 rot 度，因此内容坐标系里的角度要加上 rot
        R.paint(canvas, Object.assign({}, opts, { angle: opts.angle + rot }));
        image = await doc.embedPng(await canvasToPng(canvas));
        cache.set(key, image);
      }
      page.drawImage(image, {
        x: box.x,
        y: box.y,
        width: box.width,
        height: box.height,
      });
      applied += 1;
    }

    const out = await doc.save({ useObjectStreams: true });
    return {
      bytes: new Uint8Array(out),
      ext: '.pdf',
      pages: applied,
      totalPages: pages.length,
      mime: 'application/pdf',
    };
  }

  /** 读取 PDF 基本信息（页数、首页尺寸与旋转），用于预览与页码提示。 */
  async function inspect(bytes) {
    const { PDFDocument } = lib();
    const doc = await PDFDocument.load(bytes, { updateMetadata: false });
    const pages = doc.getPages();
    const first = pages[0];
    const box = first ? pageBox(first) : { width: 595, height: 842 };
    return {
      pageCount: pages.length,
      width: box.width,
      height: box.height,
      rotation: first ? pageRotation(first) : 0,
    };
  }

  window.WM = window.WM || {};
  window.WM.pdfEngine = { process, parseRange, inspect };
})();
