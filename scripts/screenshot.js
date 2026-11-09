'use strict';
/**
 * 生成 README 用的界面截图 docs/screenshot.png。
 *   env -u ELECTRON_RUN_AS_NODE ./node_modules/.bin/electron scripts/screenshot.js
 */
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const OUT = path.join(__dirname, '..', 'docs', 'screenshot.png');

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  ipcMain.handle('app:info', () => ({
    version: '1.0.0', name: '水印工坊', platform: process.platform,
    isMac: process.platform === 'darwin', downloads: app.getPath('downloads'),
  }));
  ipcMain.handle('file:write', () => ({ path: '', size: 0 }));
  ipcMain.handle('file:unique', () => '');
  ipcMain.handle('files:pick', () => ({ files: [] }));
  ipcMain.handle('files:folder', () => ({ files: [] }));
  ipcMain.handle('file:read', () => null);
  ipcMain.handle('dir:pick', () => null);
  ipcMain.handle('file:exists', () => false);
  ipcMain.handle('shell:open', () => '');
  ipcMain.handle('shell:show', () => {});
  ipcMain.handle('dialog:error', () => {});

  const win = new BrowserWindow({
    show: false,
    width: 1320,
    height: 840,
    backgroundColor: '#f5f6fa',
    webPreferences: {
      preload: path.join(__dirname, '..', 'src', 'main', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  const url = new URL('file://' + path.join(__dirname, '..', 'src', 'renderer', 'index.html'));
  url.searchParams.set('demo', '1');
  await win.loadURL(url.toString());
  await new Promise((r) => setTimeout(r, 2200));
  const image = await win.webContents.capturePage();
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, image.toPNG());
  console.log('screenshot written:', OUT);
  app.exit(0);
});
