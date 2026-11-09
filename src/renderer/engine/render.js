/* 水印绘制引擎：纯 Canvas，无第三方依赖，渲染进程内运行。 */
(function () {
  'use strict';

  const FONTS = {
    hei: '"PingFang SC","Hiragino Sans GB","Microsoft YaHei","Source Han Sans SC","Noto Sans SC","Helvetica Neue",Arial,sans-serif',
    song: '"Songti SC","STSong","SimSun","Source Han Serif SC","Noto Serif SC",serif',
    kai: '"Kaiti SC","STKaiti","KaiTi","Noto Serif SC",serif',
  };

  const DEFAULTS = {
    text: '仅用于浦发银行汇款额度调整',
    fontKey: 'hei',
    bold: false,
    sizePct: 0.030,   // 字号 = 画布短边 × sizePct
    angle: 20,        // 逆时针角度（度）
    opacity: 0.15,    // 0.02 – 1
    color: '#3b3b3b',
    gapX: 3.6,        // 横向间距（相对字号）
    gapY: 5.8,        // 纵向上行距（相对字号）
    stagger: true,    // 交错排布
    layout: 'tile',   // tile 平铺 | center 居中
  };

  const PRESETS = [
    '仅用于浦发银行汇款额度调整',
    '仅用于办理银行业务',
    '仅用于内部审核',
    '仅用于报销凭证',
    '仅用于合同签订',
    '仅用于入职材料',
    '仅用于签证申请',
  ];

  function clamp(v, min, max) {
    const n = Number(v);
    if (!Number.isFinite(n)) return min;
    return Math.min(max, Math.max(min, n));
  }

  function normalize(opts) {
    const o = Object.assign({}, DEFAULTS, opts || {});
    o.text = String(o.text == null ? '' : o.text);
    o.fontKey = FONTS[o.fontKey] ? o.fontKey : 'hei';
    o.sizePct = clamp(o.sizePct, 0.008, 0.25);
    o.angle = clamp(o.angle, -90, 90);
    o.opacity = clamp(o.opacity, 0.02, 1);
    o.gapX = clamp(o.gapX, 0.1, 8);
    o.gapY = clamp(o.gapY, 0.1, 8);
    o.color = /^#[0-9a-f]{6}$/i.test(String(o.color)) ? o.color : DEFAULTS.color;
    o.layout = o.layout === 'center' ? 'center' : 'tile';
    return o;
  }

  function fontString(o, px) {
    return `${o.bold ? '600' : '400'} ${px.toFixed(2)}px ${FONTS[o.fontKey]}`;
  }

  /** 在给定的 canvas 上绘制水印（canvas 尺寸即最终像素尺寸）。 */
  function paint(canvas, options) {
    const o = normalize(options);
    const ctx = canvas.getContext('2d');
    const W = canvas.width;
    const H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    const text = o.text.replace(/\r/g, '');
    if (!text.trim() || W < 8 || H < 8) return o;

    const lines = text.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
    if (!lines.length) return o;

    const minDim = Math.min(W, H);
    const fontPx = Math.max(4, minDim * o.sizePct);
    ctx.font = fontString(o, fontPx);
    ctx.fillStyle = o.color;
    ctx.globalAlpha = o.opacity;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.imageSmoothingQuality = 'high';

    const lineH = fontPx * 1.28;
    const widths = lines.map((l) => ctx.measureText(l).width);
    const blockW = Math.max.apply(null, widths);
    const blockH = lineH * lines.length;
    const rad = (o.angle * Math.PI) / 180;

    function drawBlock(cx, cy) {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(rad);
      for (let i = 0; i < lines.length; i += 1) {
        const dy = (i - (lines.length - 1) / 2) * lineH;
        ctx.fillText(lines[i], 0, dy);
      }
      ctx.restore();
    }

    if (o.layout === 'center') {
      // 单条居中：按宽度自适应，最多占画布 72%
      const targetW = W * 0.72;
      let scale = targetW / Math.max(blockW, 1);
      scale = Math.min(scale, (H * 0.42) / Math.max(blockH, 1));
      const px = Math.max(6, fontPx * scale);
      ctx.font = fontString(o, px);
      const lh = px * 1.28;
      const bw = Math.max.apply(null, lines.map((l) => ctx.measureText(l).width));
      const bh = lh * lines.length;
      ctx.save();
      ctx.translate(W / 2, H / 2);
      ctx.rotate(rad);
      for (let i = 0; i < lines.length; i += 1) {
        const dy = (i - (lines.length - 1) / 2) * lh;
        ctx.fillText(lines[i], 0, dy);
      }
      ctx.restore();
      return o;
    }

    // 平铺：保证每个角落都被覆盖
    let stepX = blockW + fontPx * o.gapX;
    let stepY = blockH + fontPx * o.gapY;
    const margin = blockW + fontPx * 3;
    const cells = ((W + margin * 2) / stepX) * ((H + margin * 2) / stepY);
    if (cells > 9000) {
      const k = Math.sqrt(cells / 9000);
      stepX *= k;
      stepY *= k;
    }

    let row = 0;
    for (let y = -margin; y < H + margin; y += stepY) {
      const offset = o.stagger && row % 2 === 1 ? stepX / 2 : 0;
      for (let x = -margin + offset; x < W + margin; x += stepX) {
        drawBlock(x, y);
      }
      row += 1;
    }
    return o;
  }

  /** 生成覆盖层画布：按 supersample 倍绘制，调用方再缩放合成，可得到平滑文字边缘。 */
  function overlay(w, h, options, supersample) {
    const s = clamp(supersample || 1, 1, 4);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(w * s));
    canvas.height = Math.max(1, Math.round(h * s));
    paint(canvas, options);
    return canvas;
  }

  function suggestedSupersample(w, h) {
    const maxDim = Math.max(w, h);
    if (maxDim <= 1200) return 2.5;
    if (maxDim <= 2600) return 2;
    if (maxDim <= 4200) return 1.5;
    return 1;
  }

  window.WM = window.WM || {};
  window.WM.render = { DEFAULTS, PRESETS, FONTS, normalize, paint, overlay, suggestedSupersample, clamp };
})();
