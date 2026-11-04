const { safeName } = require('./lib.cjs');

const DEFAULTS = { gopeed: 'http://127.0.0.1:9999', gdownload: 'http://127.0.0.1:16888' };

function endpointFor(engine, value) {
  if (!DEFAULTS[engine]) throw new Error('未知下载器');
  const url = new URL(String(value || DEFAULTS[engine]).trim());
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname.toLowerCase())
    || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('下载器接口只能填写本机 HTTP 根地址');
  }
  return url.origin;
}

async function postJson(url, body, headers = {}, fetcher = fetch, method = 'POST') {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetcher(url, {
      method, headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body), signal: controller.signal
    });
    if (!response.ok) throw new Error(`下载器接口返回 HTTP ${response.status}`);
    return await response.json();
  } finally { clearTimeout(timer); }
}

async function getJson(url, headers = {}, fetcher = fetch) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetcher(url, { headers, signal: controller.signal });
    if (!response.ok) throw new Error(`下载器接口返回 HTTP ${response.status}`);
    return await response.json();
  } finally { clearTimeout(timer); }
}

function ariaParams(secret, rest) {
  return secret ? [`token:${secret}`, ...rest] : rest;
}

async function ariaCall(endpoint, secret, method, params, fetcher = fetch) {
  const result = await postJson(`${endpoint}/jsonrpc`, {
    jsonrpc: '2.0', id: 'suda', method: `aria2.${method}`, params: ariaParams(secret, params)
  }, {}, fetcher);
  if (result.error) throw new Error(String(result.error.message || 'GDownload RPC 调用失败'));
  return result.result;
}

function gopeedData(result) {
  if (result.code !== 0) throw new Error(String(result.msg || 'Gopeed 调用失败'));
  return result.data;
}

async function submit(engine, raw, name, settings = {}, fetcher = fetch) {
  const url = new URL(raw);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('下载地址必须是 HTTP 或 HTTPS');
  const endpoint = endpointFor(engine, settings.endpoint);
  const secret = String(settings.secret || '');
  if (engine === 'gdownload' && !secret) throw new Error('请填写 GDownload 设置中的 RPC 密钥');
  const filename = safeName(name || decodeURIComponent(url.pathname.split('/').pop()) || '课程资料');
  if (engine === 'gopeed') {
    const headers = secret ? { 'X-Api-Token': secret } : {};
    const id = gopeedData(await postJson(`${endpoint}/api/v1/tasks`, {
      req: { url: url.href }, opts: { name: filename }
    }, headers, fetcher));
    if (typeof id !== 'string' || !id) throw new Error('Gopeed 未返回任务编号');
    return { id, engine, endpoint, secret, name: filename };
  }
  const id = await ariaCall(endpoint, secret, 'addUri', [[url.href], { out: filename }], fetcher);
  if (typeof id !== 'string' || !id) throw new Error('GDownload 未返回任务编号');
  return { id, engine, endpoint, secret, name: filename };
}

async function status(task, fetcher = fetch) {
  if (task.engine === 'gopeed') {
    const headers = task.secret ? { 'X-Api-Token': task.secret } : {};
    const data = gopeedData(await getJson(`${task.endpoint}/api/v1/tasks/${encodeURIComponent(task.id)}/status`, headers, fetcher));
    return { state: data.status, received: Number(data.downloaded) || 0,
      total: Number(data.total) || 0, speed: Number(data.speed) || 0 };
  }
  const data = await ariaCall(task.endpoint, task.secret, 'tellStatus', [task.id, ['status', 'totalLength', 'completedLength', 'downloadSpeed', 'errorMessage']], fetcher);
  return { state: data.status, received: Number(data.completedLength) || 0,
    total: Number(data.totalLength) || 0, speed: Number(data.downloadSpeed) || 0,
    message: data.errorMessage || '' };
}

async function pause(task, fetcher = fetch) {
  if (task.engine === 'gopeed') {
    const headers = task.secret ? { 'X-Api-Token': task.secret } : {};
    gopeedData(await postJson(`${task.endpoint}/api/v1/tasks/${encodeURIComponent(task.id)}/pause`, {}, headers, fetcher, 'PUT'));
  } else await ariaCall(task.endpoint, task.secret, 'pause', [task.id], fetcher);
}

module.exports = { DEFAULTS, endpointFor, submit, status, pause };
