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
    const open = element('button', '', '打开网盘');
    open.onclick = () => window.suda.open(item.url).catch(error => toast(error.message));
    const copy = element('button', '', '复制链接');
    copy.onclick = () => navigator.clipboard.writeText(`${item.url}${item.code ? ` 提取码：${item.code}` : ''}`).then(() => toast('已复制链接'));
    const remove = element('button', 'danger', '删除');
    remove.onclick = async () => { if (!confirm(`删除“${item.title}”资料卡？`)) return; await window.suda.remove(item.id); resources = resources.filter(x => x.id !== item.id); renderLibrary(); };
    actions.append(open, copy, remove);
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
    top.append(element('strong', '', task.name), element('span', '', task.accelerated ? '4 路分段' : '单路传输'));
    const bar = element('div', 'progress');
    const fill = element('div');
    fill.style.width = `${task.total ? Math.min(100, task.received / task.total * 100) : 0}%`;
    bar.append(fill);
    const bottom = element('div', 'task-bottom');
    const speed = task.seconds ? formatBytes(task.received / task.seconds) + '/s' : '计算中';
    const status = task.status === '完成' ? `完成 · ${formatBytes(task.received)}` : task.status === '失败' ? task.message : `${task.status} · ${formatBytes(task.received)} / ${formatBytes(task.total)} · ${speed}`;
    bottom.append(element('span', '', status));
    const action = element('button', '', task.status === '下载中' ? '暂停' : task.status === '完成' ? '查看文件' : '');
    if (task.status === '下载中') action.onclick = () => window.suda.pause(task.id);
    if (task.status === '完成') action.onclick = () => window.suda.showFile(task.destination);
    bottom.append(action);
    box.append(top, bar, bottom);
    container.append(box);
  }
}

document.querySelectorAll('.side-link').forEach(button => button.onclick = () => showView(button.dataset.view));
$('add-toggle').onclick = () => { $('add-form').classList.remove('hidden'); $('raw-link').focus(); };
$('close-form').onclick = () => $('add-form').classList.add('hidden');
$('search').oninput = renderLibrary;
$('provider-filter').onchange = renderLibrary;
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
    const parsed = await window.suda.parse(raw);
    const result = await window.suda.start(raw, $('download-mode').value);
    if (result.canceled) return;
    tasks.set(result.id, { id: result.id, name: decodeURIComponent(new URL(parsed.url).pathname.split('/').pop()) || '课程资料', status: '下载中', received: 0, total: result.size, seconds: 0, accelerated: result.accelerated });
    if (earlyEvents.has(result.id)) { const event = earlyEvents.get(result.id); earlyEvents.delete(result.id); updateTask(event.data, event.status); }
    renderTasks(); toast('下载已开始');
  } catch (error) { toast(error.message); }
};
window.suda.onProgress(data => updateTask(data));
window.suda.onComplete(data => { updateTask(data, '完成'); toast('下载完成'); });
window.suda.onError(data => { updateTask(data, '失败'); toast(data.message); });
window.suda.list().then(items => { resources = items; renderLibrary(); }).catch(error => toast(error.message));
