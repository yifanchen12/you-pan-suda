const { safeName } = require('./lib.cjs');

const API = 'https://drive-pc.quark.cn';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) quark-cloud-drive/2.5.20 Chrome/100.0.4896.160 Electron/18.3.5.4-b478491100 Safari/537.36 Channel/pckk_other_ch';

function shareId(raw) {
  const url = new URL(raw);
  if (url.hostname !== 'pan.quark.cn') throw new Error('这不是夸克分享链接');
  const id = url.pathname.match(/^\/s\/([a-zA-Z0-9]+)\/?$/)?.[1];
  if (!id) throw new Error('夸克分享链接格式不正确');
  return { id, code: url.searchParams.get('pwd') || url.searchParams.get('passcode') || '' };
}

function rememberCookies(session, response) {
  const lines = response.headers.getSetCookie?.() || [response.headers.get('set-cookie')].filter(Boolean);
  for (const line of lines) {
    const match = line.match(/^([^=;\s]+)=([^;]*)/);
    if (match) session.cookies.set(match[1], match[2]);
  }
}

function cookieHeader(session) {
  return [...session.cookies].map(([name, value]) => `${name}=${value}`).join('; ');
}

async function request(session, path, method, body, fetcher) {
  const headers = { 'User-Agent': USER_AGENT, Referer: 'https://pan.quark.cn/',
    Origin: 'https://pan.quark.cn', Accept: 'application/json, text/plain, */*' };
  if (body) headers['Content-Type'] = 'application/json';
  const cookie = cookieHeader(session);
  if (cookie) headers.Cookie = cookie;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetcher(`${API}${path}`, {
      method, headers, body: body ? JSON.stringify(body) : undefined, signal: controller.signal
    });
    rememberCookies(session, response);
    if (!response.ok) throw new Error(`夸克接口返回 HTTP ${response.status}`);
    const data = await response.json();
    if (data.code !== 0) {
      if (data.code === 23018) throw new Error('文件超出夸克访客下载限制，需要登录账号');
      throw new Error(`夸克接口拒绝请求（${data.code}）：${String(data.message || '').slice(0, 100)}`);
    }
    return data;
  } finally { clearTimeout(timer); }
}

async function listDirectory(session, folderId, fetcher) {
  const entries = [];
  for (let page = 1; page <= 20; page++) {
    const query = new URLSearchParams({ pr: 'ucpro', fr: 'pc', pwd_id: session.pwdId,
      stoken: session.stoken, pdir_fid: folderId, force: '0', _page: String(page),
      _size: '100', _fetch_banner: '0', _fetch_share: '0', _fetch_total: '1' });
    const result = await request(session, `/1/clouddrive/share/sharepage/detail?${query}`, 'GET', null, fetcher);
    const batch = result.data?.list;
    if (!Array.isArray(batch)) throw new Error('夸克没有返回文件列表');
    entries.push(...batch);
    const total = Number(result.metadata?._total);
    if (batch.length < 100 || (total > 0 && entries.length >= total)) break;
  }
  return entries;
}

async function listShare(raw, code = '', fetcher = fetch) {
  const parsed = shareId(raw);
  const session = { pwdId: parsed.id, stoken: '', cookies: new Map() };
  const token = await request(session, '/1/clouddrive/share/sharepage/token?pr=ucpro&fr=pc',
    'POST', { pwd_id: parsed.id, passcode: code || parsed.code }, fetcher);
  if (!token.data?.stoken) throw new Error('夸克没有返回分享令牌');
  session.stoken = token.data.stoken;
  const queue = [{ id: '0', depth: 0 }];
  const visited = new Set();
  const files = [];
  while (queue.length && files.length < 1000 && visited.size < 50) {
    const folder = queue.shift();
    if (visited.has(folder.id)) continue;
    visited.add(folder.id);
    for (const item of await listDirectory(session, folder.id, fetcher)) {
      if (item.dir === true) {
        if (folder.depth < 4 && typeof item.fid === 'string') queue.push({ id: item.fid, depth: folder.depth + 1 });
      } else if (typeof item.fid === 'string' && typeof item.file_name === 'string') {
        files.push({ fid: item.fid, fidToken: item.share_fid_token || '',
          name: safeName(item.file_name), size: Number(item.size) || 0 });
      }
      if (files.length >= 1000) break;
    }
  }
  if (!files.length) throw new Error('夸克分享中没有可下载的文件');
  return { session, files };
}

async function downloadLink(session, file, fetcher = fetch) {
  const body = { fids: [file.fid], pwd_id: session.pwdId, stoken: session.stoken };
  if (file.fidToken) body.fids_token = [file.fidToken];
  const result = await request(session, '/1/clouddrive/file/download?pr=ucpro&fr=pc', 'POST', body, fetcher);
  const value = result.data?.[0]?.download_url;
  if (typeof value !== 'string') throw new Error('夸克没有返回文件下载地址');
  const url = new URL(value);
  if (url.protocol !== 'https:' || !url.hostname.endsWith('.quark.cn')) throw new Error('夸克返回了非预期的下载地址');
  const headers = { 'User-Agent': USER_AGENT, Referer: 'https://pan.quark.cn/' };
  const cookie = cookieHeader(session);
  if (cookie) headers.Cookie = cookie;
  return { url: url.href, headers };
}

module.exports = { shareId, listShare, downloadLink };
