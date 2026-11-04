const { parseResource, safeName } = require('./lib.cjs');

const DEFAULT_ENDPOINT = 'http://127.0.0.1:6400';
const COMMUNITY_ENDPOINT = 'https://lz.qaiu.top';

function normalizeEndpoint(value) {
  const input = String(value || DEFAULT_ENDPOINT).trim();
  const endpoint = new URL(input);
  if (!['http:', 'https:'].includes(endpoint.protocol)) throw new Error('解析服务地址必须是 HTTP 或 HTTPS');
  if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash) throw new Error('解析服务地址只填写服务根地址');
  const local = ['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname.toLowerCase());
  if (!local && endpoint.protocol !== 'https:') throw new Error('远程解析服务必须使用 HTTPS');
  return endpoint.origin;
}

function isLocalEndpoint(value) {
  const endpoint = new URL(normalizeEndpoint(value));
  return ['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname.toLowerCase());
}

async function requestJson(endpoint, route, parameters, fetcher = fetch) {
  const url = new URL(route, `${endpoint}/`);
  for (const [key, value] of Object.entries(parameters)) if (value) url.searchParams.set(key, value);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetcher(url.href, { signal: controller.signal, headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`解析服务返回 HTTP ${response.status}`);
    let payload;
    try { payload = await response.json(); } catch { throw new Error('解析服务没有返回 JSON'); }
    if (payload.success === false || (payload.code && payload.code !== 200)) {
      throw new Error(String(payload.msg || payload.message || '分享链接解析失败').slice(0, 200));
    }
    return payload.data;
  } finally { clearTimeout(timer); }
}

function validDownloadUrl(value, endpoint) {
  if (!value) return null;
  let url;
  try { url = new URL(value, `${endpoint}/`); } catch { return null; }
  return ['http:', 'https:'].includes(url.protocol) ? url.href : null;
}

function directFile(data, endpoint, fallbackName) {
  const url = validDownloadUrl(data?.directLink || data?.downloadUrl, endpoint);
  if (!url) return null;
  let fallback = fallbackName;
  try { fallback = decodeURIComponent(new URL(url).pathname.split('/').pop()) || fallbackName; } catch { /* retain title */ }
  return { name: safeName(data.fileName || data.filename || fallback), size: Number(data.size) || 0, url };
}

function folderRoute(value, endpoint) {
  if (!value) return null;
  let url;
  try { url = new URL(value, `${endpoint}/`); } catch { return null; }
  if (url.origin !== endpoint || url.pathname !== '/v2/getFileList') return null;
  return `${url.pathname}${url.search}`;
}

async function listedFiles(endpoint, parameters, fetcher) {
  const root = await requestJson(endpoint, '/v2/getFileList', parameters, fetcher);
  if (!Array.isArray(root)) throw new Error('解析服务没有返回文件列表');
  const queue = [{ entries: root, depth: 0 }];
  const seen = new Set();
  const files = [];
  while (queue.length && files.length < 500) {
    const { entries, depth } = queue.shift();
    for (const entry of entries) {
      if (entry.fileType === 'folder') {
        const route = folderRoute(entry.parserUrl, endpoint);
        if (route && depth < 4 && !seen.has(route)) {
          seen.add(route);
          const children = await requestJson(endpoint, route, {}, fetcher);
          if (Array.isArray(children)) queue.push({ entries: children, depth: depth + 1 });
        }
        continue;
      }
      const url = validDownloadUrl(entry.parserUrl, endpoint);
      if (url) files.push({ name: safeName(entry.fileName), size: Number(entry.size) || 0, url });
      if (files.length >= 500) break;
    }
  }
  if (!files.length) throw new Error('分享中只有文件夹，解析服务没有返回可下载文件');
  return files;
}

async function resolveShare(input, endpointInput = DEFAULT_ENDPOINT, fetcher = fetch) {
  const endpoint = normalizeEndpoint(endpointInput);
  const parsed = parseResource(`${input.url || input} ${input.code ? `提取码：${input.code}` : ''}`);
  const parameters = { url: parsed.url, pwd: parsed.code };
  let firstError;
  try {
    const data = await requestJson(endpoint, '/json/parser', parameters, fetcher);
    const file = directFile(data, endpoint, input.title || parsed.provider);
    if (file) return { provider: parsed.provider, files: [file], endpoint };
  } catch (error) { firstError = error; }
  try {
    const files = await listedFiles(endpoint, parameters, fetcher);
    return { provider: parsed.provider, files, endpoint };
  } catch (error) {
    throw new Error(firstError ? `${firstError.message}；文件列表：${error.message}` : error.message);
  }
}

module.exports = { DEFAULT_ENDPOINT, COMMUNITY_ENDPOINT, normalizeEndpoint, isLocalEndpoint, resolveShare };
