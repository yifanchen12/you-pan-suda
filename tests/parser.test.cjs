const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const fsp = require('node:fs/promises');
const { download } = require('../lib.cjs');
const { normalizeEndpoint, isLocalEndpoint, resolveShare } = require('../parser.cjs');

test('解析服务地址限制为本机 HTTP 或远程 HTTPS', () => {
  assert.equal(normalizeEndpoint('http://127.0.0.1:6400/'), 'http://127.0.0.1:6400');
  assert.equal(isLocalEndpoint('http://localhost:6400'), true);
  assert.equal(isLocalEndpoint('https://lz.qaiu.top'), false);
  assert.throws(() => normalizeEndpoint('http://example.com'), /HTTPS/);
  assert.throws(() => normalizeEndpoint('https://user:pass@example.com'), /根地址/);
});

test('分享链接解析后交给下载器，无须打开网盘页面', async () => {
  const content = Buffer.from('BUPT course material test\n'.repeat(500));
  let parserCalls = 0;
  const server = http.createServer((request, response) => {
    const target = new URL(request.url, 'http://localhost');
    if (target.pathname === '/json/parser') {
      parserCalls++;
      assert.equal(target.searchParams.get('url'), 'https://lanzoux.com/test123');
      assert.equal(target.searchParams.get('pwd'), 'ab12');
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ code: 200, success: true, data: { fileName: '讲义.txt', size: content.length, directLink: `http://127.0.0.1:${server.address().port}/file` } }));
      return;
    }
    if (target.pathname === '/file') {
      response.setHeader('content-type', 'application/octet-stream');
      response.setHeader('content-length', content.length);
      if (request.method === 'HEAD') response.end(); else response.end(content);
      return;
    }
    response.writeHead(404).end();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'suda-parser-test-'));
  try {
    const result = await resolveShare({ url: 'https://lanzoux.com/test123', code: 'ab12', title: '课堂讲义' }, `http://127.0.0.1:${server.address().port}`);
    assert.equal(result.files.length, 1);
    assert.equal(result.files[0].name, '讲义.txt');
    const destination = path.join(dir, result.files[0].name);
    await download(result.files[0].url, destination);
    assert.deepEqual(await fsp.readFile(destination), content);
    assert.equal(parserCalls, 1);
  } finally {
    server.close();
    await fsp.rm(dir, { recursive: true, force: true });
  }
});

test('文件夹列表会留下可下载文件', async () => {
  const calls = [];
  const mock = async raw => {
    const url = new URL(raw); calls.push(url.pathname);
    return { ok: true, json: async () => url.pathname === '/json/parser'
      ? { code: 200, success: true, data: {} }
      : { code: 200, success: true, data: [
        { fileType: 'folder', fileName: '子目录', parserUrl: '/d/lz/child' },
        { fileType: 'file', fileName: '教材.pdf', size: 123, parserUrl: '/d/lz/book' }
      ] } };
  };
  const result = await resolveShare('https://lanzoux.com/folder', 'http://127.0.0.1:6400', mock);
  assert.deepEqual(calls, ['/json/parser', '/v2/getFileList']);
  assert.deepEqual(result.files, [{ name: '教材.pdf', size: 123, url: 'http://127.0.0.1:6400/d/lz/book' }]);
});
