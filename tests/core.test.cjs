const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const fsp = require('node:fs/promises');
const { parseResource, download } = require('../lib.cjs');

test('识别常见和未收录网盘，并提取访问码', () => {
  assert.deepEqual(parseResource('教材：https://pan.baidu.com/s/abc 提取码：7g3k'), { url: 'https://pan.baidu.com/s/abc', provider: '百度网盘', code: '7g3k' });
  assert.equal(parseResource('https://wukongpan.com/s/abc').provider, '悟空网盘');
  assert.equal(parseResource('https://misc.example/s/abc').provider, '其他网盘/网站');
});

test('分段下载得到原文件；不支持 Range 时转为单路下载', async () => {
  const contents = Buffer.alloc(3 * 1024 * 1024);
  for (let i = 0; i < contents.length; i++) contents[i] = i % 251;
  const requestedRanges = [];
  const server = http.createServer((req, res) => {
    if (req.url === '/page') { res.setHeader('content-type', 'text/html'); res.end('<html>share page</html>'); return; }
    const ranged = req.url === '/range';
    res.setHeader('content-type', 'application/octet-stream');
    if (ranged) res.setHeader('accept-ranges', 'bytes');
    if (req.method === 'HEAD') { res.setHeader('content-length', contents.length); res.end(); return; }
    const match = ranged && req.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
    if (match) {
      requestedRanges.push(req.headers.range);
      const start = Number(match[1]);
      const end = match[2] ? Number(match[2]) : contents.length - 1;
      res.writeHead(206, { 'content-range': `bytes ${start}-${end}/${contents.length}`, 'content-length': end - start + 1 });
      res.end(contents.subarray(start, end + 1));
      return;
    }
    res.setHeader('content-length', contents.length); res.end(contents);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'suda-test-'));
  try {
    const fast = path.join(dir, 'fast.bin');
    const a = await download(`${base}/range`, fast);
    assert.equal(a.accelerated, true);
    assert.deepEqual(await fsp.readFile(fast), contents);
    const resumed = path.join(dir, 'resumed.bin');
    const url = `${base}/range`;
    await fsp.writeFile(`${resumed}.part`, contents.subarray(0, 1024 * 1024));
    await fsp.writeFile(`${resumed}.part.json`, JSON.stringify({ sourceHash: crypto.createHash('sha256').update(url).digest('hex'), size: contents.length }));
    const resumedResult = await download(url, resumed, { mode: 'single' });
    assert.equal(resumedResult.accelerated, false);
    assert.deepEqual(await fsp.readFile(resumed), contents);
    assert.ok(requestedRanges.includes('bytes=1048576-'));
    const slow = path.join(dir, 'slow.bin');
    const b = await download(`${base}/no-range`, slow);
    assert.equal(b.accelerated, false);
    assert.deepEqual(await fsp.readFile(slow), contents);
    await assert.rejects(download(`${base}/page`, path.join(dir, 'page.html')), /网页而不是文件直链/);
  } finally {
    server.close();
    await fsp.rm(dir, { recursive: true, force: true });
  }
});
