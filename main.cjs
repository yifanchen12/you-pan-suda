const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('node:path');
const fsp = require('node:fs/promises');
const crypto = require('node:crypto');
const { parseResource, safeName, inspectDirect, download } = require('./lib.cjs');
const { resolveShare } = require('./parser.cjs');
const external = require('./engines.cjs');
const quark = require('./quark.cjs');
const { nextAvailablePath, releasePath } = require('./destination.cjs');

let window;
const active = new Map();
const handedOff = new Map();
const quarkFiles = new Map();
const chosenDirectories = new Set();
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
  ipcMain.handle('download:choose-directory', async () => {
    const choice = await dialog.showOpenDialog(window, {
      title: '选择课程资料保存位置', defaultPath: app.getPath('downloads'),
      properties: ['openDirectory', 'createDirectory'], buttonLabel: '保存到这里'
    });
    if (choice.canceled || !choice.filePaths[0]) return '';
    const directory = path.resolve(choice.filePaths[0]);
    chosenDirectories.add(directory);
    return directory;
  });
  ipcMain.handle('share:resolve', async (_event, item, endpoint) => {
    if (new URL(item.url).hostname === 'pan.quark.cn') {
      const result = await quark.listShare(item.url, item.code);
      return { provider: '夸克网盘', files: result.files.map(file => {
        const key = crypto.randomUUID();
        quarkFiles.set(key, { session: result.session, file });
        return { key, name: file.name, size: file.size };
      }) };
    }
    return resolveShare(item, endpoint);
  });
  ipcMain.handle('download:start', async (event, { raw, mode, suggestedName, engine, settings, quarkKey, directory }) => {
    const quarkItem = quarkKey ? quarkFiles.get(quarkKey) : null;
    if (quarkKey && !quarkItem) throw new Error('夸克分享会话已失效，请重新解析');
    const source = quarkItem ? await quark.downloadLink(quarkItem.session, quarkItem.file) : { url: parseResource(raw).url, headers: {} };
    const { url, headers } = source;
    if (engine && engine !== 'builtin') {
      const task = await external.submit(engine, url, suggestedName, settings, fetch, headers);
      let polling = false;
      const timer = setInterval(async () => {
        if (polling) return;
        polling = true;
        try {
          const state = await external.status(task);
          event.sender.send('download:progress', { id: task.id, received: state.received,
            total: state.total, speed: state.speed, state: state.state });
          if (['done', 'complete'].includes(state.state)) {
            clearInterval(timer); handedOff.delete(task.id);
            event.sender.send('download:complete', { id: task.id, received: state.received, total: state.total });
          } else if (['error', 'removed'].includes(state.state)) {
            clearInterval(timer); handedOff.delete(task.id);
            event.sender.send('download:error', { id: task.id, message: state.message || '下载器任务失败' });
          }
        } catch (error) {
          clearInterval(timer); handedOff.delete(task.id);
          event.sender.send('download:error', { id: task.id, message: error.message });
        } finally { polling = false; }
      }, 2000);
      handedOff.set(task.id, { task, timer });
      return { id: task.id, name: task.name, size: 0, engine, accelerated: true };
    }
    const info = await inspectDirect(url, undefined, headers);
    let destination;
    if (directory) {
      if (!chosenDirectories.has(path.resolve(directory))) throw new Error('请重新选择保存文件夹');
      destination = await nextAvailablePath(directory, suggestedName || info.filename);
    } else {
      const choice = await dialog.showSaveDialog(window, {
        title: '保存课程资料', defaultPath: path.join(app.getPath('downloads'), safeName(suggestedName || info.filename)),
        buttonLabel: '开始下载'
      });
      if (choice.canceled || !choice.filePath) return { canceled: true };
      destination = choice.filePath;
    }
    const id = crypto.randomUUID();
    const controller = new AbortController();
    active.set(id, controller);
    const started = Date.now();
    let lastSent = 0;
    const promise = download(url, destination, {
      signal: controller.signal, mode, headers,
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
    }).finally(() => { active.delete(id); releasePath(destination); });
    void promise;
    return { id, destination, size: info.size, name: safeName(suggestedName || info.filename), accelerated: mode !== 'single' && info.ranges && info.size >= 2 * 1024 * 1024 };
  });
  ipcMain.handle('download:pause', async (_event, id) => {
    if (handedOff.has(id)) return external.pause(handedOff.get(id).task);
    active.get(id)?.abort(); return true;
  });
  ipcMain.handle('file:show', (_event, location) => { shell.showItemInFolder(location); return true; });
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
