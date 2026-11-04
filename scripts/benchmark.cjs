const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const fsp = require('node:fs/promises');
const { performance } = require('node:perf_hooks');
const { download } = require('../lib.cjs');

const file = Buffer.alloc(4 * 1024 * 1024);
for (let i = 0; i < file.length; i++) file[i] = i % 251;
const blockSize = 64 * 1024;
const delayMs = 25;

const server = http.createServer((request, response) => {
  response.setHeader('content-type', 'application/octet-stream');
  response.setHeader('accept-ranges', 'bytes');
  if (request.method === 'HEAD') { response.setHeader('content-length', file.length); response.end(); return; }
  const range = request.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
  const start = range ? Number(range[1]) : 0;
  const end = range ? (range[2] ? Number(range[2]) : file.length - 1) : file.length - 1;
  if (range) response.writeHead(206, { 'content-range': `bytes ${start}-${end}/${file.length}`, 'content-length': end - start + 1 });
  else response.setHeader('content-length', file.length);
  let offset = start;
  const timer = setInterval(() => {
    if (offset > end) { clearInterval(timer); response.end(); return; }
    const next = Math.min(offset + blockSize, end + 1);
    response.write(file.subarray(offset, next));
    offset = next;
  }, delayMs);
  response.on('close', () => clearInterval(timer));
});

(async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'suda-benchmark-'));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/course.bin`;
  try {
    for (const mode of ['single', 'auto']) {
      const destination = path.join(dir, `${mode}.bin`);
      const start = performance.now();
      const result = await download(url, destination, { mode });
      const seconds = (performance.now() - start) / 1000;
      const received = await fsp.readFile(destination);
      if (!received.equals(file)) throw new Error(`${mode} 模式文件校验失败`);
      console.log(`${mode === 'single' ? '单路' : '四路'}: ${seconds.toFixed(2)} 秒，${(result.bytes / seconds / 1024 / 1024).toFixed(2)} MiB/s`);
    }
    console.log('此结果只代表本机模拟的每连接限速来源，不代表真实网盘速度。');
  } finally {
    server.close();
    await fsp.rm(dir, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
