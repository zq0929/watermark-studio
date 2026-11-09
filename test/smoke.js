'use strict';
/**
 * 自检脚本：用隐藏窗口跑一遍真实渲染链路（Canvas 图片 + pdf-lib PDF），
 * 把产物写到 --out 目录，供人工/自动核对。
 *   npm run smoke -- --out=/tmp/wm-smoke
 */
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const argOut = process.argv.find((a) => a.startsWith('--out='));
const outDir = argOut ? argOut.slice(6) : path.join(__dirname, 'out');
fs.mkdirSync(outDir, { recursive: true });

let finished = false;
function finish(code, payload) {
  if (finished) return;
  finished = true;
  console.log('=== SELFTEST RESULT ===');
  console.log(JSON.stringify(payload, null, 2));
  app.exit(code);
}

process.on('uncaughtException', (err) => finish(2, { ok: false, error: String(err && err.stack) }));

app.whenReady().then(() => {
  ipcMain.handle('app:info', () => ({
    version: app.getVersion(), name: '水印工坊', platform: process.platform,
    isMac: process.platform === 'darwin', downloads: app.getPath('downloads'),
    electron: process.versions.electron, chrome: process.versions.chrome,
  }));
  ipcMain.handle('files:pick', () => ({ files: [] }));
  ipcMain.handle('files:folder', () => ({ files: [] }));
  ipcMain.handle('file:read', (_e, p) => {
    try {
      const buf = fs.readFileSync(p);
      const ext = path.extname(p).toLowerCase();
      return {
        path: p, name: path.basename(p), ext,
        kind: ext === '.pdf' ? 'pdf' : 'image',
        size: buf.length, bytes: new Uint8Array(buf),
      };
    } catch { return null; }
  });
  ipcMain.handle('dir:pick', () => null);
  ipcMain.handle('file:exists', (_e, p) => fs.existsSync(p));
  ipcMain.handle('file:unique', (_e, dir, base, ext) => {
    let candidate = path.join(dir, `${base}${ext}`);
    let i = 1;
    while (fs.existsSync(candidate)) { candidate = path.join(dir, `${base} (${i})${ext}`); i += 1; }
    return candidate;
  });
  ipcMain.handle('file:write', (_e, p, data) => {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    const buf = Buffer.from(data instanceof ArrayBuffer ? new Uint8Array(data) : data);
    fs.writeFileSync(p, buf);
    return { path: p, size: buf.length };
  });
  ipcMain.handle('shell:open', () => '');
  ipcMain.handle('shell:show', () => {});
  ipcMain.handle('dialog:error', () => {});
  ipcMain.handle('selftest:report', (_e, payload) => {
    const ok = !!(payload && !payload.error && payload.image && payload.pdf);
    finish(ok ? 0 : 1, { ok, payload });
    return true;
  });

  const win = new BrowserWindow({
    show: false,
    width: 1320,
    height: 840,
    webPreferences: {
      preload: path.join(__dirname, '..', 'src', 'main', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.webContents.on('console-message', (_e, level, message, line, source) => {
    console.log(`[renderer:${level}] ${message} (${source}:${line})`);
  });
  win.webContents.on('render-process-gone', (_e, details) => finish(3, { ok: false, error: 'render-process-gone', details }));

  const url = new URL('file://' + path.join(__dirname, '..', 'src', 'renderer', 'index.html'));
  url.searchParams.set('selftest', '1');
  url.searchParams.set('out', outDir);
  const fixture = process.argv.find((a) => a.startsWith('--fixture='));
  if (fixture) url.searchParams.set('fixture', fixture.slice(10));
  const variants = process.argv.find((a) => a.startsWith('--variants='));
  if (variants) url.searchParams.set('variants', variants.slice(11));
  win.loadURL(url.toString());

  setTimeout(() => finish(4, { ok: false, error: 'timeout 90s' }), 90000);
});
