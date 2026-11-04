const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('node:path');
const fsp = require('node:fs/promises');
const crypto = require('node:crypto');
const { parseResource, safeName, inspectDirect, download } = require('./lib.cjs');

let window;
const active = new Map();
const dataFile = () => path.join(app.getPath('userData'), 'resources.json');

async function readResources() {
  try {
    const content = JSON.parse(await fsp.readFile(dataFile(), 'utf8'));
    return Array.isArray(content) ? content : [];
  } catch { return []; }
}

async function writeResources(items) {
  await fsp.mkdir(path.dirname(dataFile()), { recursive: true });
  const tmp = `${dataFile()}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(items, null, 2), 'utf8');
  await fsp.rename(tmp, dataFile());
}

function createWindow() {
  window = new BrowserWindow({
    width: 1200, height: 820, minWidth: 880, minHeight: 620,
    title: '邮盘速达', backgroundColor: '#f6f8fc',
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  window.loadFile(path.join(__dirname, 'index.html'));
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
}

app.whenReady().then(() => {
  ipcMain.handle('resources:list', readResources);
  ipcMain.handle('resources:add', async (_event, fields) => {
    const parsed = parseResource(fields.text);
    const items = await readResources();
    const item = {
      id: crypto.randomUUID(), ...parsed,
      title: safeName(fields.title || parsed.provider),
      course: safeName(fields.course || '未分类课程'),
      note: String(fields.note || '').trim().slice(0, 500),
      addedAt: new Date().toISOString()
    };
    items.unshift(item);
    await writeResources(items);
    return item;
  });
  ipcMain.handle('resources:remove', async (_event, id) => {
    const items = await readResources();
    await writeResources(items.filter(item => item.id !== id));
    return true;
  });
  ipcMain.handle('link:parse', (_event, text) => parseResource(text));
  ipcMain.handle('link:open', (_event, raw) => {
    const { url } = parseResource(raw);
    return shell.openExternal(url);
  });
  ipcMain.handle('download:inspect', async (_event, raw) => {
    const { url } = parseResource(raw);
    return inspectDirect(url);
  });
  ipcMain.handle('download:start', async (event, { raw, mode }) => {
    const { url } = parseResource(raw);
    const info = await inspectDirect(url);
    const choice = await dialog.showSaveDialog(window, {
      title: '保存课程资料', defaultPath: path.join(app.getPath('downloads'), info.filename),
      buttonLabel: '开始下载'
    });
    if (choice.canceled || !choice.filePath) return { canceled: true };
    const id = crypto.randomUUID();
    const controller = new AbortController();
    active.set(id, controller);
    const destination = choice.filePath;
    const started = Date.now();
    let lastSent = 0;
    const promise = download(url, destination, {
      signal: controller.signal, mode,
      onProgress(received, total) {
        const now = Date.now();
        if (now - lastSent < 150 && received !== total) return;
        lastSent = now;
        event.sender.send('download:progress', { id, received, total, seconds: Math.max((now - started) / 1000, .001) });
      }
    }).then(result => {
      event.sender.send('download:complete', { id, destination, ...result });
    }).catch(error => {
      event.sender.send('download:error', { id, message: controller.signal.aborted ? '已暂停，可再次下载以续传' : error.message });
    }).finally(() => active.delete(id));
    void promise;
    return { id, destination, size: info.size, accelerated: mode !== 'single' && info.ranges && info.size >= 2 * 1024 * 1024 };
  });
  ipcMain.handle('download:pause', (_event, id) => { active.get(id)?.abort(); return true; });
  ipcMain.handle('file:show', (_event, location) => { shell.showItemInFolder(location); return true; });
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
