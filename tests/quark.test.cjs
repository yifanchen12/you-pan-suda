const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const fsp = require('node:fs/promises');
const { shareId, listShare, downloadLink } = require('../quark.cjs');
const { download } = require('../lib.cjs');

test('夸克分享进入子目录并保留匿名会话', async () => {
  assert.equal(shareId('https://pan.quark.cn/s/9be4717a694c').id, '9be4717a694c');
  const calls = [];
  const mock = async (raw, options) => {
    const url = new URL(raw); calls.push({ path: url.pathname, folder: url.searchParams.get('pdir_fid'), cookie: options.headers.Cookie });
    const data = url.pathname.endsWith('/token') ? { stoken: 'opaque-session' }
      : url.pathname.endsWith('/detail') ? { list: url.searchParams.get('pdir_fid') === '0'
        ? [{ dir: true, fid: 'folder' }]
        : [{ dir: false, fid: 'file', file_name: '教材.pdf', size: 1024, share_fid_token: 'file-token' }] }
        : [{ download_url: 'https://dl-guest.drive.quark.cn/book.pdf' }];
    return { ok: true, headers: { getSetCookie: () => url.pathname.endsWith('/token') ? ['sid=anonymous; Domain=.quark.cn'] : [] },
      json: async () => ({ code: 0, data }) };
  };
  const result = await listShare('https://pan.quark.cn/s/9be4717a694c', '', mock);
  assert.equal(result.files.length, 1);
  assert.equal(result.files[0].name, '教材.pdf');
  assert.equal(calls[2].folder, 'folder');
  const link = await downloadLink(result.session, result.files[0], mock);
  assert.equal(link.headers.Cookie, 'sid=anonymous');
  assert.equal(calls[3].cookie, 'sid=anonymous');
});

test('内置下载器向所有请求传递下载头', async () => {
  const content = Buffer.alloc(3 * 1024 * 1024, 42);
  let requests = 0;
  const server = http.createServer((req, res) => {
    requests++;
    if (req.headers.cookie !== 'sid=anonymous' || req.headers.referer !== 'https://pan.quark.cn/') {
      res.writeHead(412).end(); return;
    }
    res.setHeader('accept-ranges', 'bytes');
    if (req.method === 'HEAD') { res.setHeader('content-length', content.length); res.end(); return; }
    const range = req.headers.range?.match(/^bytes=(\d+)-(\d+)$/);
    if (range) {
      const start = Number(range[1]), end = Number(range[2]);
      res.writeHead(206, { 'content-range': `bytes ${start}-${end}/${content.length}`, 'content-length': end - start + 1 });
      res.end(content.subarray(start, end + 1)); return;
    }
    res.setHeader('content-length', content.length); res.end(content);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'suda-quark-'));
  try {
    const target = path.join(dir, 'book.bin');
    await download(`http://127.0.0.1:${server.address().port}/book`, target,
      { headers: { Cookie: 'sid=anonymous', Referer: 'https://pan.quark.cn/' } });
    assert.equal(requests >= 3, true);
    assert.deepEqual(await fsp.readFile(target), content);
  } finally {
    server.close();
    await fsp.rm(dir, { recursive: true, force: true });
  }
});
