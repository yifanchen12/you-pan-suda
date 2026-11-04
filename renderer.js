const $ = id => document.getElementById(id);
let resources = [];
const tasks = new Map();
const earlyEvents = new Map();
let toastTimer;

function toast(message) {
  const element = $('toast');
  element.textContent = message;
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

async function beginDownload(raw, mode = 'auto', suggestedName = '', quarkKey = '') {
  const engine = $('engine').value;
  const settings = { endpoint: $('engine-endpoint').value.trim(), secret: $('engine-secret').value };
  const result = await window.suda.start(raw, mode, suggestedName, engine, settings, quarkKey);
  if (result.canceled) return;
  tasks.set(result.id, { id: result.id, name: result.name, status: '下载中', received: 0, total: result.size, seconds: 0, speed: 0, engine: result.engine || 'builtin', accelerated: result.accelerated });
  if (earlyEvents.has(result.id)) { const event = earlyEvents.get(result.id); earlyEvents.delete(result.id); updateTask(event.data, event.status); }
  renderTasks();
  showView('download');
  toast(engine === 'builtin' ? '下载已开始' : '已交给下载器');
}

async function resolveCard(item) {
  const endpoint = $('parser-endpoint').value.trim();
  const isQuark = new URL(item.url).hostname === 'pan.quark.cn';
  let host;
  if (!isQuark) {
    try { host = new URL(endpoint).hostname.toLowerCase(); } catch { toast('请填写有效的解析服务地址'); return; }
  }
  if (!isQuark && !['127.0.0.1', 'localhost', '[::1]'].includes(host)
    && !confirm(`将这条分享链接和提取码发送至 ${host} 解析。确认继续？`)) return;
  $('parser-title').textContent = item.title;
  $('parser-status').textContent = '正在解析分享链接…';
  $('parser-files').replaceChildren();
  $('parser-modal').classList.remove('hidden');
  try {
    const result = await window.suda.resolve(item, endpoint);
    $('parser-status').textContent = `找到 ${result.files.length} 个可下载文件 · ${result.provider}`;
    for (const file of result.files) {
      const row = element('div', 'parser-file');
      const info = element('div');
      info.append(element('strong', '', file.name), element('small', '', formatBytes(file.size)));
      const button = element('button', 'primary', '下载');
      button.onclick = () => beginDownload(file.url || '', 'auto', file.name, file.key || '').catch(error => toast(error.message));
      row.append(info, button);
      $('parser-files').append(row);
    }
  } catch (error) {
    const local = ['127.0.0.1', 'localhost', '[::1]'].includes(host);
    $('parser-status').textContent = !isQuark && local && /fetch failed|abort|ECONNREFUSED/i.test(error.message)
      ? '无法连接本机解析服务。请先启动 NFD Parser，或主动选择社区服务。'
      : `解析失败：${error.message}`;
  }
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
  $('page-subtitle').textContent = name === 'library' ? '把老师发在不同网盘的教材和课件，放到一个清楚的入口。' : '支持分段的直链会使用最多 4 路下载，并显示实时速度。';
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
$('engine').value = localStorage.getItem('engine') || 'builtin';
$('engine').onchange = configureEngine;
$('engine-endpoint').onchange = () => localStorage.setItem(`${$('engine').value}-endpoint`, $('engine-endpoint').value.trim());
configureEngine();
$('parser-endpoint').value = localStorage.getItem('parser-endpoint') || 'http://127.0.0.1:6400';
$('parser-endpoint').onchange = () => localStorage.setItem('parser-endpoint', $('parser-endpoint').value.trim());
$('community-parser').onclick = () => { $('parser-endpoint').value = 'https://lz.qaiu.top'; $('parser-endpoint').dispatchEvent(new Event('change')); toast('已选择社区解析服务；解析前会再次确认发送链接'); };
$('close-parser').onclick = () => $('parser-modal').classList.add('hidden');
$('parser-modal').onclick = event => { if (event.target === $('parser-modal')) $('parser-modal').classList.add('hidden'); };
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
$('inspect').onclick = async () => {
  const target = $('inspect-result'); target.textContent = '正在检查下载源…';
  try {
    const info = await window.suda.inspect($('direct-url').value);
    target.textContent = `${info.filename} · ${formatBytes(info.size)} · ${info.ranges && info.size >= 2 * 1024 * 1024 ? '可使用分段下载' : '单路下载'}`;
  } catch (error) { target.textContent = `检查失败：${error.message}`; }
};
$('start-download').onclick = async () => {
  try {
    const raw = $('direct-url').value;
    await beginDownload(raw, $('download-mode').value);
  } catch (error) { toast(error.message); }
};
window.suda.onProgress(data => updateTask(data));
window.suda.onComplete(data => { updateTask(data, '完成'); toast('下载完成'); });
window.suda.onError(data => { updateTask(data, '失败'); toast(data.message); });
window.suda.list().then(items => { resources = items; renderLibrary(); }).catch(error => toast(error.message));
