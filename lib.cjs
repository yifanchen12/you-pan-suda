const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');

const providers = [
  ['百度网盘', /(^|\.)pan\.baidu\.com$/],
  ['夸克网盘', /(^|\.)pan\.quark\.cn$/],
  ['阿里云盘', /(^|\.)(aliyundrive|alipan)\.com$/],
  ['123云盘', /(^|\.)123(49|pan|684)\.com$/],
  ['蓝奏云', /(^|\.)(lanzou[a-z0-9]*|lanzn)\.com$/],
  ['悟空网盘', /(^|\.)(wukongpan|wukong)\.[a-z.]+$/],
  ['天翼云盘', /(^|\.)cloud\.189\.cn$/],
  ['迅雷云盘', /(^|\.)pan\.xunlei\.com$/],
  ['OneDrive', /(^|\.)(1drv\.ms|onedrive\.live\.com)$/],
];

function parseResource(input) {
  const raw = String(input || '').trim();
  const match = raw.match(/https?:\/\/[^\s<>"“”]+/i);
  if (!match) throw new Error('没有找到 http 或 https 链接');
  const link = match[0].replace(/[，。；;,.)）]+$/, '');
  const url = new URL(link);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('仅支持 http/https 链接');
  const host = url.hostname.toLowerCase();
  const provider = providers.find(([, pattern]) => pattern.test(host))?.[0] || '其他网盘/网站';
  const code = raw.match(/(?:提取码|访问码|密码|口令)\s*[:：]?\s*([a-z\d]{4,8})/i)?.[1]
    || ['pwd', 'password', 'passcode'].map(key => url.searchParams.get(key)).find(Boolean) || '';
  return { url: url.href, provider, code };
}

function safeName(value) {
  return String(value || '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim().slice(0, 120) || '课程资料';
}

async function inspectDirect(url, signal, headers = {}, fetcher = fetch) {
  const parsed = new URL(url);
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('仅支持 http/https 下载地址');
  let size = 0;
  let ranges = false;
  let filename = safeName(parsed.pathname.split('/').pop() || '课程资料');
  try { filename = safeName(decodeURIComponent(parsed.pathname.split('/').pop() || '课程资料')); } catch { /* use encoded name */ }
  try {
    const head = await fetcher(url, { method: 'HEAD', headers, signal });
    if (head.ok) {
      size = Number(head.headers.get('content-length')) || 0;
      ranges = /bytes/i.test(head.headers.get('accept-ranges') || '');
      const disposition = head.headers.get('content-disposition') || '';
      const n = disposition.match(/filename\*=UTF-8''([^;]+)|filename="?([^";]+)"?/i);
      if (n) filename = safeName(decodeURIComponent(n[1] || n[2]));
    }
  } catch (error) {
    if (signal?.aborted) throw error;
  }
  const probe = await fetcher(url, { headers: { ...headers, Range: 'bytes=0-0' }, signal });
  if (!probe.ok) throw new Error(`下载源返回 HTTP ${probe.status}`);
  if (/text\/html/i.test(probe.headers.get('content-type') || '')) {
    await probe.body?.cancel();
    throw new Error('这是网页而不是文件直链，请到资料库打开网盘页面');
  }
  const contentRange = probe.headers.get('content-range') || '';
  const rangeSize = Number(contentRange.match(/^bytes\s+0-0\/(\d+)$/i)?.[1]);
  if (probe.status === 206 && rangeSize > 0) { ranges = true; size = rangeSize; }
  if (probe.status === 200 && !size) size = Number(probe.headers.get('content-length')) || 0;
  await probe.body?.cancel();
  return { size, ranges, filename };
}

async function streamToFile(response, file, append, onBytes, signal) {
  if (!response.ok || !response.body) throw new Error(`下载失败：HTTP ${response.status}`);
  const counter = new Transform({ transform(chunk, _encoding, callback) { onBytes(chunk.length); callback(null, chunk); } });
  await pipeline(Readable.fromWeb(response.body), counter, fs.createWriteStream(file, { flags: append ? 'a' : 'w' }), { signal });
}

async function downloadSingle(url, destination, info, signal, onProgress, headers, fetcher) {
  const part = `${destination}.part`;
  const marker = `${destination}.part.json`;
  const sourceHash = crypto.createHash('sha256').update(url).digest('hex');
  let meta;
  try { meta = JSON.parse(await fsp.readFile(marker, 'utf8')); } catch { /* fresh task */ }
  if (!meta || meta.sourceHash !== sourceHash || meta.size !== info.size) {
    await fsp.rm(part, { force: true });
    await fsp.writeFile(marker, JSON.stringify({ sourceHash, size: info.size }));
  }
  let offset = info.ranges ? (await fsp.stat(part).catch(() => ({ size: 0 }))).size : 0;
  if (info.size && offset >= info.size) offset = 0;
  let response = await fetcher(url, { headers: offset ? { ...headers, Range: `bytes=${offset}-` } : headers, signal });
  if (offset && response.status !== 206) { await response.body?.cancel(); offset = 0; response = await fetcher(url, { headers, signal }); }
  if (!response.ok) throw new Error(`下载源返回 HTTP ${response.status}`);
  let received = offset;
  onProgress(received, info.size);
  await streamToFile(response, part, offset > 0, bytes => { received += bytes; onProgress(received, info.size); }, signal);
  if (info.size && received !== info.size) throw new Error(`文件大小不符：收到 ${received} 字节，应为 ${info.size} 字节`);
  await fsp.rename(part, destination);
  await fsp.rm(marker, { force: true });
  return received;
}

async function downloadParallel(url, destination, info, signal, onProgress, headers, fetcher, segments = 4) {
  const count = Math.min(segments, Math.ceil(info.size / (1024 * 1024)));
  const marker = `${destination}.parts.json`;
  const sourceHash = crypto.createHash('sha256').update(url).digest('hex');
  let meta;
  try { meta = JSON.parse(await fsp.readFile(marker, 'utf8')); } catch { /* fresh task */ }
  if (!meta || meta.sourceHash !== sourceHash || meta.size !== info.size || meta.count !== count) {
    for (let i = 0; i < segments; i++) await fsp.rm(`${destination}.part.${i}`, { force: true });
    await fsp.writeFile(marker, JSON.stringify({ sourceHash, size: info.size, count }));
  }
  const chunkSize = Math.ceil(info.size / count);
  const blocks = await Promise.all(Array.from({ length: count }, async (_, i) => {
    const start = i * chunkSize;
    const end = Math.min(info.size - 1, start + chunkSize - 1);
    const file = `${destination}.part.${i}`;
    const fileSize = (await fsp.stat(file).catch(() => ({ size: 0 }))).size;
    if (fileSize > end - start + 1) await fsp.rm(file, { force: true });
    const existing = fileSize > end - start + 1 ? 0 : fileSize;
    return { start, end, file, existing };
  }));
  let received = blocks.reduce((sum, block) => sum + block.existing, 0);
  onProgress(received, info.size);
  await Promise.all(blocks.map(async block => {
    if (block.existing === block.end - block.start + 1) return;
    const response = await fetcher(url, { headers: { ...headers, Range: `bytes=${block.start + block.existing}-${block.end}` }, signal });
    if (response.status !== 206) { await response.body?.cancel(); throw new Error('下载源不支持分段传输'); }
    const expectedRange = `bytes ${block.start + block.existing}-${block.end}/${info.size}`;
    if (response.headers.get('content-range') !== expectedRange) {
      await response.body?.cancel(); throw new Error('下载源返回了错误的分段范围');
    }
    await streamToFile(response, block.file, block.existing > 0, bytes => { received += bytes; onProgress(received, info.size); }, signal);
  }));
  const temp = `${destination}.downloading`;
  const output = fs.createWriteStream(temp);
  try {
    for (const block of blocks) {
      const actual = (await fsp.stat(block.file)).size;
      if (actual !== block.end - block.start + 1) throw new Error('分段文件大小不符');
      await new Promise((resolve, reject) => {
        const input = fs.createReadStream(block.file);
        input.on('error', reject).on('end', resolve).pipe(output, { end: false });
      });
    }
    await new Promise((resolve, reject) => output.end(error => error ? reject(error) : resolve()));
    await fsp.rename(temp, destination);
    for (const block of blocks) await fsp.rm(block.file, { force: true });
    await fsp.rm(marker, { force: true });
    return info.size;
  } catch (error) { output.destroy(); await fsp.rm(temp, { force: true }); throw error; }
}

async function download(url, destination, options = {}) {
  const { signal, onProgress = () => {}, mode = 'auto', headers = {}, fetcher = fetch } = options;
  const info = await inspectDirect(url, signal, headers, fetcher);
  await fsp.mkdir(path.dirname(destination), { recursive: true });
  const accelerated = mode !== 'single' && info.ranges && info.size >= 2 * 1024 * 1024;
  const bytes = accelerated
    ? await downloadParallel(url, destination, info, signal, onProgress, headers, fetcher)
    : await downloadSingle(url, destination, info, signal, onProgress, headers, fetcher);
  return { bytes, accelerated, info };
}

module.exports = { parseResource, safeName, inspectDirect, download };
