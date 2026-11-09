/* 图片水印：解码 → Canvas 合成 → 编码。全部在本地完成。 */
(function () {
  'use strict';

  const R = window.WM.render;
  const MAX_SIDE = 14000; // Canvas 上限保护

  async function decode(bytes) {
    const blob = new Blob([bytes]);
    if (typeof createImageBitmap === 'function') {
      try {
        return await createImageBitmap(blob, { imageOrientation: 'from-image' });
      } catch {
        /* 部分格式不支持选项，退回默认解码 */
        try { return await createImageBitmap(blob); } catch { /* 继续退回 <img> */ }
      }
    }
    const url = URL.createObjectURL(blob);
    try {
      const img = await new Promise((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error('图片解码失败（格式可能不受支持）'));
        el.src = url;
      });
      return img;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  function resolveFormat(srcExt, preferred) {
    if (preferred === 'jpg' || preferred === 'png') return preferred;
    const ext = String(srcExt || '').toLowerCase().replace('.', '');
    if (ext === 'jpg' || ext === 'jpeg') return 'jpg';
    if (ext === 'png' || ext === 'webp' || ext === 'gif' || ext === 'avif' || ext === 'bmp') return 'png';
    return 'png';
  }

  async function process(item, options) {
    const opts = R.normalize(options);
    const bitmap = await decode(item.bytes);
    const iw = bitmap.width || bitmap.naturalWidth;
    const ih = bitmap.height || bitmap.naturalHeight;
    if (!iw || !ih) throw new Error('无法读取图片尺寸');

    const scale = Math.min(1, MAX_SIDE / Math.max(iw, ih));
    const w = Math.max(1, Math.round(iw * scale));
    const h = Math.max(1, Math.round(ih * scale));

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    const fmt = resolveFormat(item.ext, opts.imageFormat);
    // JPEG 不支持透明：先铺白底；PNG 保留原透明区域
    if (fmt === 'jpg') {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, w, h);
    }
    ctx.drawImage(bitmap, 0, 0, w, h);
    if (typeof bitmap.close === 'function') bitmap.close();

    const s = R.suggestedSupersample(w, h);
    const ov = R.overlay(w, h, opts, s);
    ctx.drawImage(ov, 0, 0, w, h);

    const mime = fmt === 'jpg' ? 'image/jpeg' : 'image/png';
    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('图片编码失败'))), mime, 0.95);
    });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    return {
      bytes,
      ext: fmt === 'jpg' ? '.jpg' : '.png',
      width: w,
      height: h,
      sourceWidth: iw,
      sourceHeight: ih,
      scaled: scale < 1,
      mime,
    };
  }

  window.WM = window.WM || {};
  window.WM.imageEngine = { process, decode, resolveFormat };
})();
