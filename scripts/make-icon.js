'use strict';
/**
 * 生成应用图标 build/icon.png（1024×1024）。
 * 用 Electron 的 Canvas 绘制，避免引入 sharp/canvas 之类的原生依赖。
 *   env -u ELECTRON_RUN_AS_NODE ./node_modules/.bin/electron scripts/make-icon.js
 */
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const SIZE = 1024;
const OUT = path.join(__dirname, '..', 'build', 'icon.png');

const drawScript = `(async () => {
  const S = ${SIZE};
  const c = document.createElement('canvas');
  c.width = S; c.height = S;
  const ctx = c.getContext('2d');

  // macOS 风格：图形按 824/1024 内缩，四周留透明边距
  const M = S * 0.096;
  const B = S - M * 2;
  const r = B * 0.225;

  const roundRect = (x, y, w, h, rad) => {
    ctx.beginPath();
    ctx.moveTo(x + rad, y);
    ctx.arcTo(x + w, y, x + w, y + h, rad);
    ctx.arcTo(x + w, y + h, x, y + h, rad);
    ctx.arcTo(x, y + h, x, y, rad);
    ctx.arcTo(x, y, x + w, y, rad);
    ctx.closePath();
  };

  // 背景：圆角矩形 + 对角渐变
  const bg = ctx.createLinearGradient(M, M, M + B, M + B);
  bg.addColorStop(0, '#6b98ff');
  bg.addColorStop(0.45, '#3563f6');
  bg.addColorStop(1, '#1f36b0');
  roundRect(M, M, B, B, r);
  ctx.fillStyle = bg;
  ctx.fill();

  ctx.save();
  roundRect(M, M, B, B, r);
  ctx.clip();

  // 背景暗纹（斜向重复小字）
  ctx.globalAlpha = 0.085;
  ctx.fillStyle = '#ffffff';
  ctx.font = '600 ' + Math.round(S * 0.036) + 'px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.translate(S / 2, S / 2);
  ctx.rotate(-26 * Math.PI / 180);
  for (let y = -S * 0.8; y <= S * 0.8; y += S * 0.135) {
    for (let x = -S * 0.9; x <= S * 0.9; x += S * 0.245) {
      ctx.fillText('水印工坊', x, y);
    }
  }
  ctx.restore();

  // 纸张
  const pw = B * 0.60;
  const ph = B * 0.76;
  const px = (S - pw) / 2;
  const py = (S - ph) / 2 + S * 0.008;
  const pr = B * 0.052;
  ctx.save();
  ctx.shadowColor = 'rgba(8, 18, 64, 0.38)';
  ctx.shadowBlur = S * 0.045;
  ctx.shadowOffsetY = S * 0.016;
  ctx.fillStyle = '#ffffff';
  roundRect(px, py, pw, ph, pr);
  ctx.fill();
  ctx.restore();

  // 内容：标题条 + 文本行 + 小色块
  ctx.fillStyle = '#c3d1f0';
  roundRect(px + pw * 0.13, py + ph * 0.11, pw * 0.34, ph * 0.030, ph * 0.015);
  ctx.fill();
  ctx.fillStyle = '#e3e9f8';
  [0.21, 0.265, 0.32, 0.375, 0.43].forEach((t, i) => {
    const w = pw * (i === 2 ? 0.5 : 0.72);
    roundRect(px + pw * 0.13, py + ph * t, w, ph * 0.019, ph * 0.0095);
    ctx.fill();
  });
  ctx.fillStyle = 'rgba(53, 99, 246, 0.14)';
  roundRect(px + pw * 0.13, py + ph * 0.60, pw * 0.74, ph * 0.26, B * 0.03);
  ctx.fill();

  // 纸张上的水印字：斜向重复，蓝色半透明
  ctx.save();
  roundRect(px, py, pw, ph, pr);
  ctx.clip();
  ctx.translate(px + pw / 2, py + ph / 2);
  ctx.rotate(-26 * Math.PI / 180);
  ctx.fillStyle = 'rgba(53, 99, 246, 0.22)';
  ctx.font = '600 ' + Math.round(B * 0.056) + 'px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let y = -ph; y <= ph; y += B * 0.165) {
    for (let x = -pw; x <= px + pw; x += B * 0.30) {
      ctx.fillText('仅限指定用途', x, y);
    }
  }
  ctx.restore();

  return c.toDataURL('image/png');
})()`;

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 200, height: 200, webPreferences: { offscreen: false } });
  await win.loadURL('data:text/html,<html><body></body></html>');
  const dataUrl = await win.webContents.executeJavaScript(drawScript, true);
  const base64 = String(dataUrl).split(',')[1];
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, Buffer.from(base64, 'base64'));
  console.log('icon written:', OUT, fs.statSync(OUT).size, 'bytes');
  app.exit(0);
});
