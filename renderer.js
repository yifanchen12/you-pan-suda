const $ = id => document.getElementById(id);
let resources = [];
const tasks = new Map();
const earlyEvents = new Map();
let toastTimer;
let resolvedFiles = [];
const batchQueue = [];
let batchActiveId = '';
let batchStarting = false;

function toast(message) {
  const element = $('toast');
  element.textContent = String(message).replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '');
  element.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => element.classList.remove('show'), 3500);
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '未知大小';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes, unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++; }
  return `${value.toFixed(unit ? 1 : 0)} ${units[unit]}`;
}

function element(name, className, text) {
  const result = document.createElement(name);
  if (className) result.className = className;
  if (text != null) result.textContent = text;
  return result;
}

async function beginDownload(raw, mode = 'auto', suggestedName = '', quarkKey = '', options = {}) {
  const engine = options.engine || $('engine').value;
  const settings = options.settings || { endpoint: $('engine-endpoint').value.trim(), secret: $('engine-secret').value };
  const result = await window.suda.start(raw, mode, suggestedName, engine, settings, quarkKey, options.directory || '');
  if (result.canceled) return;
  tasks.set(result.id, { id: result.id, name: result.name, status: '下载中', received: 0, total: result.size, seconds: 0, speed: 0, engine: result.engine || 'builtin', accelerated: result.accelerated });
  if (earlyEvents.has(result.id)) { const event = earlyEvents.get(result.id); earlyEvents.delete(result.id); updateTask(event.data, event.status); }
  renderTasks();
  showView('download');
  if (!options.silent) toast(engine === 'builtin' ? '下载已开始' : '已交给下载器');
  return result;
}

async function pumpBatch() {
  if (batchStarting || batchActiveId || !batchQueue.length) return;
  batchStarting = true;
  const job = batchQueue.shift();
  try {
    const result = await beginDownload(job.file.url || '', job.mode, job.file.name,
      job.file.key || '', { engine: job.engine, settings: job.settings, directory: job.directory, silent: true });
    if (result?.id) {
      batchActiveId = result.id;
      if (['完成', '失败'].includes(tasks.get(result.id)?.status)) batchActiveId = '';
    }
  } catch (error) { toast(`${job.file.name}：${error.message}`); }
  finally {
    batchStarting = false;
    if (!batchActiveId && batchQueue.length) queueMicrotask(pumpBatch);
  }
}

async function resolveCard(item) {
  const endpoint = $('parser-endpoint').value.trim();
  const isQuark = new URL(item.url).hostname === 'pan.quark.cn';
  let host;
  if (!isQuark) {
    try { host = new URL(endpoint).hostname.toLowerCase(); } catch { toast('请填写有效的解析服务地址'); return false; }
  }
  if (!isQuark && !['127.0.0.1', 'localhost', '[::1]'].includes(host)
    && !confirm(`将这条分享链接和提取码发送至 ${host} 解析。确认继续？`)) return false;
  $('parser-title').textContent = item.title;
  $('parser-status').textContent = '正在解析分享链接…';
  $('parser-files').replaceChildren();
  $('parser-actions').classList.add('hidden');
  $('select-all').checked = false;
  resolvedFiles = [];
  $('parser-modal').classList.remove('hidden');
  try {
    const result = await window.suda.resolve(item, endpoint);
    $('parser-status').textContent = `找到 ${result.files.length} 个可下载文件 · ${result.provider}`;
    resolvedFiles = result.files;
    for (const file of result.files) {
      const row = element('label', 'parser-file');
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'file-choice';
      const info = element('div');
      info.append(element('strong', '', file.name), element('small', '', formatBytes(file.size)));
      row.append(checkbox, info);
      $('parser-files').append(row);
    }
    $('parser-actions').classList.toggle('hidden', !result.files.length);
    return true;
  } catch (error) {
    const local = ['127.0.0.1', 'localhost', '[::1]'].includes(host);
    $('parser-status').textContent = !isQuark && local && /fetch failed|abort|ECONNREFUSED/i.test(error.message)
      ? '无法连接本机解析服务。请先启动 NFD Parser，或主动选择社区服务。'
      : `解析失败：${error.message}`;
    return false;
  }
}

function selectedFiles() {
  return [...document.querySelectorAll('#parser-files .file-choice')]
    .flatMap((box, index) => box.checked ? [resolvedFiles[index]] : []);
}

async function selectedEngine() {
  let engine = $('engine').value;
  let settings = { endpoint: $('engine-endpoint').value.trim(), secret: $('engine-secret').value };
  if (engine !== 'builtin' && !(await window.suda.engineAvailable(engine, settings))) {
    toast(`${engine === 'gopeed' ? 'Gopeed' : 'GDownload'} 未启动，改用内置下载器`);
    engine = 'builtin';
    $('engine').value = engine;
    configureEngine();
    settings = {};
  }
  return { engine, settings };
}

async function downloadSelected() {
  const files = selectedFiles();
  if (!files.length) { toast('请先勾选文件'); return; }
  const { engine, settings } = await selectedEngine();
  const directory = engine === 'builtin' ? await window.suda.chooseFolder() : '';
  if (engine === 'builtin' && !directory) return;
  const mode = $('download-mode').value;
  batchQueue.push(...files.map(file => ({ file, engine, settings, directory, mode })));
  $('parser-modal').classList.add('hidden');
  showView('download');
  toast(`已加入 ${files.length} 个下载任务`);
  void pumpBatch();
}

function renderLibrary() {
  const search = $('search').value.trim().toLowerCase();
  const provider = $('provider-filter').value;
  const providers = [...new Set(resources.map(item => item.provider))].sort();
  $('provider-filter').replaceChildren(new Option('全部网盘', ''), ...providers.map(name => new Option(name, name)));
  $('provider-filter').value = provider;
  const visible = resources.filter(item => (!provider || item.provider === provider) && [item.title, item.course, item.provider, item.note].join(' ').toLowerCase().includes(search));
  $('count').textContent = `${resources.length} 份资料`;
  const list = $('library');
  list.replaceChildren();
  $('empty').classList.toggle('hidden', visible.length > 0);
  $('empty').querySelector('h3').textContent = resources.length ? '没有匹配的资料' : '还没有资料';
  $('empty').querySelector('p').textContent = resources.length ? '试试其他关键词或切换网盘筛选。' : '先把一条课程网盘链接收进来。';
  for (const item of visible) {
    const card = element('article', 'card');
    const top = element('div', 'card-top');
    const info = element('div');
    const icon = element('div', 'file-icon', '▤');
    const title = element('h3', '', item.title);
    const subtitle = element('small', '', `${item.course} · ${new Date(item.addedAt).toLocaleDateString('zh-CN')}`);
    info.append(title, subtitle);
    top.append(icon, info, element('span', 'provider', item.provider));
    const link = element('div', 'card-link', item.url);
    const note = element('div', 'card-note', [item.code ? `提取码：${item.code}` : '', item.note].filter(Boolean).join('　'));
    const actions = element('div', 'card-actions');
    const resolve = element('button', 'resolve-button', '解析并下载');
    resolve.onclick = () => resolveCard(item);
    const open = element('button', '', '打开网盘');
    open.onclick = () => window.suda.open(item.url).catch(error => toast(error.message));
    const copy = element('button', '', '复制链接');
    copy.onclick = () => navigator.clipboard.writeText(`${item.url}${item.code ? ` 提取码：${item.code}` : ''}`).then(() => toast('已复制链接'));
    const remove = element('button', 'danger', '删除');
    remove.onclick = async () => { if (!confirm(`删除“${item.title}”资料卡？`)) return; await window.suda.remove(item.id); resources = resources.filter(x => x.id !== item.id); renderLibrary(); };
    actions.append(resolve, open, copy, remove);
    card.append(top, link, note, actions);
    list.append(card);
  }
}

function showView(name) {
  $('library-view').classList.toggle('hidden', name !== 'library');
  $('download-view').classList.toggle('hidden', name !== 'download');
  document.querySelectorAll('.side-link').forEach(button => button.classList.toggle('active', button.dataset.view === name));
  $('page-title').textContent = name === 'library' ? '课程资料库' : '下载加速';
  $('page-subtitle').textContent = name === 'library' ? '把老师发在不同网盘的教材和课件，放到一个清楚的入口。' : '粘贴分享链接，选择文件并保存到电脑。';
}

function updateTask(data, status) {
  let task = tasks.get(data.id);
  if (!task) { earlyEvents.set(data.id, { data, status }); return; }
  if (status) task.status = status;
  if (data.received !== undefined) task.received = data.received;
  if (data.total !== undefined) task.total = data.total;
  if (data.seconds !== undefined) task.seconds = data.seconds;
  if (data.speed !== undefined) task.speed = data.speed;
  if (['pause', 'paused'].includes(data.state)) task.status = '已暂停';
  if (['ready', 'wait', 'running', 'active', 'waiting'].includes(data.state)) task.status = '下载中';
  if (data.destination) task.destination = data.destination;
  if (data.message) task.message = data.message;
  renderTasks();
}

function renderTasks() {
  const container = $('downloads');
  container.replaceChildren();
  if (!tasks.size) { container.append(element('div', 'empty-inline', '尚无下载任务')); return; }
  for (const task of [...tasks.values()].reverse()) {
    const box = element('div', 'task');
    const top = element('div', 'task-top');
    const engineName = { builtin: task.accelerated ? '4 路分段' : '单路传输', gopeed: 'Gopeed', gdownload: 'GDownload' }[task.engine];
    top.append(element('strong', '', task.name), element('span', '', engineName));
    const bar = element('div', 'progress');
    const fill = element('div');
    fill.style.width = `${task.total ? Math.min(100, task.received / task.total * 100) : 0}%`;
    bar.append(fill);
    const bottom = element('div', 'task-bottom');
    const speed = task.engine === 'builtin' ? (task.seconds ? formatBytes(task.received / task.seconds) + '/s' : '计算中') : formatBytes(task.speed) + '/s';
    const status = task.status === '完成' ? `完成 · ${formatBytes(task.received)}` : task.status === '失败' ? task.message : `${task.status} · ${formatBytes(task.received)} / ${formatBytes(task.total)} · ${speed}`;
    bottom.append(element('span', '', status));
    if (task.status === '下载中' || (task.status === '完成' && task.destination)) {
      const action = element('button', '', task.status === '下载中' ? '暂停' : '查看文件');
      if (task.status === '下载中') action.onclick = () => window.suda.pause(task.id).catch(error => toast(error.message));
      if (task.status === '完成') action.onclick = () => window.suda.showFile(task.destination);
      bottom.append(action);
    }
    box.append(top, bar, bottom);
    container.append(box);
  }
}

document.querySelectorAll('.side-link').forEach(button => button.onclick = () => showView(button.dataset.view));
$('add-toggle').onclick = () => { $('add-form').classList.remove('hidden'); $('raw-link').focus(); };
$('close-form').onclick = () => $('add-form').classList.add('hidden');
$('search').oninput = renderLibrary;
$('provider-filter').onchange = renderLibrary;
function configureEngine() {
  const engine = $('engine').value;
  const external = engine !== 'builtin';
  $('engine-endpoint-wrap').classList.toggle('hidden', !external);
  $('engine-secret-wrap').classList.toggle('hidden', !external);
  $('engine-endpoint').value = external ? (localStorage.getItem(`${engine}-endpoint`) || (engine === 'gopeed' ? 'http://127.0.0.1:9999' : 'http://127.0.0.1:16888')) : '';
  $('engine-secret').value = '';
  $('engine-secret').placeholder = engine === 'gdownload' ? '填写 GDownload RPC 密钥' : '未设置可留空';
  $('engine-hint').textContent = engine === 'gopeed' ? '先在 Gopeed 开启本机 REST API；保存位置由 Gopeed 设置决定。'
    : engine === 'gdownload' ? '先启动 GDownload；接口密钥在其 RPC 设置中查看。保存位置由 GDownload 设置决定。'
      : '内置下载器使用最多 4 路分段。';
  $('download-mode').disabled = external;
  localStorage.setItem('engine', engine);
}
$('engine').value = 'builtin';
$('engine').onchange = configureEngine;
$('engine-endpoint').onchange = () => localStorage.setItem(`${$('engine').value}-endpoint`, $('engine-endpoint').value.trim());
configureEngine();
$('parser-endpoint').value = localStorage.getItem('parser-endpoint') || 'http://127.0.0.1:6400';
$('parser-endpoint').onchange = () => localStorage.setItem('parser-endpoint', $('parser-endpoint').value.trim());
$('community-parser').onclick = () => { $('parser-endpoint').value = 'https://lz.qaiu.top'; $('parser-endpoint').dispatchEvent(new Event('change')); toast('已选择社区解析服务；解析前会再次确认发送链接'); };
$('close-parser').onclick = () => $('parser-modal').classList.add('hidden');
$('parser-modal').onclick = event => { if (event.target === $('parser-modal')) $('parser-modal').classList.add('hidden'); };
$('select-all').onchange = () => document.querySelectorAll('#parser-files .file-choice')
  .forEach(box => { box.checked = $('select-all').checked; });
$('download-selected').onclick = () => downloadSelected().catch(error => toast(error.message));
$('raw-link').oninput = async () => {
  try { const value = await window.suda.parse($('raw-link').value); $('detected').textContent = `${value.provider}${value.code ? ` · 提取码 ${value.code}` : ''}`; }
  catch { $('detected').textContent = '粘贴后自动识别网盘'; }
};
$('add-form').onsubmit = async event => {
  event.preventDefault();
  try {
    const item = await window.suda.add({ text: $('raw-link').value, title: $('resource-title').value, course: $('course').value, note: $('note').value });
    resources.unshift(item);
    $('add-form').reset(); $('add-form').classList.add('hidden');
    renderLibrary(); toast('资料卡已保存');
  } catch (error) { toast(error.message); }
};
async function handlePastedLink(downloadNow) {
  const target = $('inspect-result'); target.textContent = '正在检查下载源…';
  try {
    const raw = $('direct-url').value;
    const parsed = await window.suda.parse(raw);
    if (parsed.provider !== '其他网盘/网站') {
      target.textContent = `${parsed.provider} · 正在列出文件`;
      const shown = await resolveCard({ ...parsed, title: parsed.provider });
      target.textContent = shown ? `${parsed.provider} · 请在文件列表中勾选后下载` : '未能列出分享文件，请查看提示';
      return;
    }
    if (downloadNow) {
      const { engine, settings } = await selectedEngine();
      await beginDownload(raw, $('download-mode').value, '', '', { engine, settings });
    }
    else {
      const info = await window.suda.inspect(raw);
      target.textContent = `${info.filename} · ${formatBytes(info.size)} · ${info.ranges && info.size >= 2 * 1024 * 1024 ? '可使用分段下载' : '单路下载'}`;
    }
  } catch (error) { target.textContent = `检查失败：${error.message}`; }
}
$('inspect').onclick = () => handlePastedLink(false);
$('start-download').onclick = () => handlePastedLink(true);
window.suda.onProgress(data => updateTask(data));
window.suda.onComplete(data => {
  updateTask(data, '完成'); toast('下载完成');
  if (data.id === batchActiveId) { batchActiveId = ''; void pumpBatch(); }
});
window.suda.onError(data => {
  updateTask(data, '失败'); toast(data.message);
  if (data.id === batchActiveId) { batchActiveId = ''; void pumpBatch(); }
});
showView('download');
window.suda.list().then(items => { resources = items; renderLibrary(); }).catch(error => toast(error.message));
