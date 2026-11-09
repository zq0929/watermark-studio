'use strict';
/**
 * 水印工坊 · 主进程
 * 只负责窗口、菜单、文件读写与系统对话框；所有水印渲染在渲染进程完成（Canvas + pdf-lib）。
 */
const { app, BrowserWindow, ipcMain, dialog, Menu, shell, nativeTheme } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');

const isMac = process.platform === 'darwin';
const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.bmp', '.gif', '.avif']);
const PDF_EXT = new Set(['.pdf']);

let mainWindow = null;

/* ------------------------------- 窗口 ------------------------------- */

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 840,
    minWidth: 1120,
    minHeight: 700,
    show: false,
    title: '水印工坊',
    backgroundColor: '#f3f5fa',
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
    trafficLightPosition: isMac ? { x: 18, y: 20 } : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('closed', () => { mainWindow = null; });

  // 只允许在应用内部导航
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault());
}

/* ------------------------------- 菜单 ------------------------------- */

function send(action) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('menu:action', action);
}

function buildMenu() {
  const template = [
    ...(isMac ? [{
      label: app.name,
      submenu: [
        { role: 'about', label: '关于 水印工坊' },
        { type: 'separator' },
        { role: 'hide', label: '隐藏' },
        { role: 'hideOthers', label: '隐藏其他' },
        { role: 'unhide', label: '显示全部' },
        { type: 'separator' },
        { role: 'quit', label: '退出 水印工坊' },
      ],
    }] : []),
    {
      label: '文件',
      submenu: [
        { label: '添加文件…', accelerator: 'CmdOrCtrl+O', click: () => send('add-files') },
        { label: '添加文件夹…', accelerator: 'CmdOrCtrl+Shift+O', click: () => send('add-folder') },
        { type: 'separator' },
        { label: '开始处理', accelerator: 'CmdOrCtrl+Return', click: () => send('run') },
        { label: '打开输出文件夹', accelerator: 'CmdOrCtrl+Shift+E', click: () => send('open-output') },
        { type: 'separator' },
        isMac ? { role: 'close', label: '关闭窗口' } : { role: 'quit', label: '退出' },
      ],
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '拷贝' },
        { role: 'paste', label: '粘贴' },
        { role: 'selectAll', label: '全选' },
      ],
    },
    {
      label: '视图',
      submenu: [
        { role: 'reload', label: '重新载入' },
        { role: 'toggleDevTools', label: '开发者工具' },
        { type: 'separator' },
        { role: 'resetZoom', label: '实际大小' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '全屏' },
      ],
    },
    { role: 'windowMenu', label: '窗口' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/* ------------------------------- IPC ------------------------------- */

function registerIpc() {
  ipcMain.handle('app:info', () => ({
    version: app.getVersion(),
    name: app.getName(),
    platform: process.platform,
    arch: process.arch,
    isMac,
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    downloads: app.getPath('downloads'),
    home: app.getPath('home'),
    pictures: app.getPath('pictures'),
  }));

  ipcMain.handle('files:pick', async () => {
    const res = await dialog.showOpenDialog(mainWindow, {
      title: '选择图片或 PDF',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: '图片与 PDF', extensions: ['jpg', 'jpeg', 'png', 'webp', 'bmp', 'gif', 'avif', 'pdf'] },
        { name: '图片', extensions: ['jpg', 'jpeg', 'png', 'webp', 'bmp', 'gif', 'avif'] },
        { name: 'PDF', extensions: ['pdf'] },
        { name: '全部文件', extensions: ['*'] },
      ],
    });
    if (res.canceled) return { files: [] };
    return { files: await readFiles(res.filePaths) };
  });

  ipcMain.handle('files:folder', async () => {
    const res = await dialog.showOpenDialog(mainWindow, { title: '选择文件夹（图片与 PDF）', properties: ['openDirectory'] });
    if (res.canceled || !res.filePaths[0]) return { files: [] };
    const dir = res.filePaths[0];
    const names = await fs.readdir(dir, { withFileTypes: true });
    const paths = names
      .filter((d) => d.isFile())
      .map((d) => path.join(dir, d.name))
      .filter((p) => {
        const ext = path.extname(p).toLowerCase();
        return IMAGE_EXT.has(ext) || PDF_EXT.has(ext);
      })
      .sort((a, b) => a.localeCompare(b, 'zh-CN'));
    return { files: await readFiles(paths) };
  });

  ipcMain.handle('file:read', async (_e, filePath) => {
    const [file] = await readFiles([filePath]);
    return file || null;
  });

  ipcMain.handle('dir:pick', async (_e, defaultPath) => {
    const res = await dialog.showOpenDialog(mainWindow, {
      title: '选择输出文件夹',
      defaultPath: typeof defaultPath === 'string' ? defaultPath : undefined,
      properties: ['openDirectory', 'createDirectory'],
    });
    return res.canceled ? null : res.filePaths[0];
  });

  ipcMain.handle('file:write', async (_e, filePath, data) => {
    if (typeof filePath !== 'string' || !filePath) throw new Error('无效的输出路径');
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const buf = Buffer.from(data instanceof ArrayBuffer ? new Uint8Array(data) : data);
    await fs.writeFile(filePath, buf);
    return { path: filePath, size: buf.length };
  });

  ipcMain.handle('file:exists', async (_e, filePath) => {
    try { await fs.access(filePath); return true; } catch { return false; }
  });

  ipcMain.handle('file:unique', async (_e, dir, baseName, ext) => {
    let candidate = path.join(dir, `${baseName}${ext}`);
    let i = 1;
    while (true) {
      try {
        await fs.access(candidate);
        candidate = path.join(dir, `${baseName} (${i})${ext}`);
        i += 1;
      } catch {
        return candidate;
      }
    }
  });

  ipcMain.handle('shell:open', async (_e, target) => {
    if (typeof target !== 'string' || !target) return '无效路径';
    return shell.openPath(target);
  });

  ipcMain.handle('shell:show', async (_e, target) => {
    if (typeof target === 'string' && target) shell.showItemInFolder(target);
  });

  ipcMain.handle('dialog:error', async (_e, title, message) => {
    await dialog.showMessageBox(mainWindow, { type: 'error', title: title || '出错了', message: String(message || '') });
  });
}

async function readFiles(paths) {
  const out = [];
  for (const p of paths) {
    try {
      const stat = await fs.stat(p);
      if (!stat.isFile()) continue;
      const ext = path.extname(p).toLowerCase();
      const kind = PDF_EXT.has(ext) ? 'pdf' : IMAGE_EXT.has(ext) ? 'image' : null;
      if (!kind) continue;
      if (stat.size > 300 * 1024 * 1024) continue; // 单文件上限 300MB
      const buf = await fs.readFile(p);
      out.push({
        path: p,
        name: path.basename(p),
        ext,
        kind,
        size: buf.length,
        bytes: new Uint8Array(buf),
      });
    } catch {
      /* 忽略无法读取的文件 */
    }
  }
  return out;
}

/* ------------------------------- 生命周期 ------------------------------- */

app.whenReady().then(() => {
  nativeTheme.themeSource = 'light';
  app.setAboutPanelOptions({
    applicationName: '水印工坊',
    applicationVersion: app.getVersion(),
    copyright: '本地处理 · 不上传 · 支持 macOS 与 Windows',
  });
  registerIpc();
  buildMenu();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (!isMac) app.quit();
});
