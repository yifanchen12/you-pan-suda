const test = require('node:test');
const assert = require('node:assert/strict');
const { endpointFor, submit, status, pause } = require('../engines.cjs');

test('下载器接口只允许本机地址', () => {
  assert.equal(endpointFor('gopeed', 'http://localhost:9999/'), 'http://localhost:9999');
  assert.throws(() => endpointFor('gopeed', 'https://example.com'), /本机/);
  assert.throws(() => endpointFor('gdownload', 'http://127.0.0.1:16888/jsonrpc'), /根地址/);
});

test('Gopeed 接收文件地址并返回进度', async () => {
  const calls = [];
  const mock = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/api/v1/tasks')) return { ok: true, json: async () => ({ code: 0, data: 'task-1' }) };
    if (url.endsWith('/status')) return { ok: true, json: async () => ({ code: 0, data: { status: 'running', downloaded: 100, total: 200, speed: 50 } }) };
    return { ok: true, json: async () => ({ code: 0 }) };
  };
  const task = await submit('gopeed', 'https://example.com/book.pdf', '教材.pdf', { secret: 'test-only' }, mock);
  assert.equal(task.id, 'task-1');
  assert.deepEqual(JSON.parse(calls[0].options.body), { req: { url: 'https://example.com/book.pdf' }, opts: { name: '教材.pdf' } });
  assert.equal(calls[0].options.headers['X-Api-Token'], 'test-only');
  assert.deepEqual(await status(task, mock), { state: 'running', received: 100, total: 200, speed: 50 });
  await pause(task, mock);
  assert.equal(calls[2].options.method, 'PUT');
});

test('GDownload 通过本机 aria2 RPC 接收任务', async () => {
  const calls = [];
  const mock = async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) });
    const method = calls.at(-1).body.method;
    return { ok: true, json: async () => ({ result: method === 'aria2.addUri' ? 'gid-1' : method === 'aria2.tellStatus'
      ? { status: 'active', completedLength: '20', totalLength: '100', downloadSpeed: '10' } : 'OK' }) };
  };
  const task = await submit('gdownload', 'https://example.com/book.pdf', '教材.pdf', { secret: 'test-only' }, mock);
  assert.equal(task.id, 'gid-1');
  assert.equal(calls[0].url, 'http://127.0.0.1:16888/jsonrpc');
  assert.deepEqual(calls[0].body.params, ['token:test-only', ['https://example.com/book.pdf'], { out: '教材.pdf' }]);
  assert.deepEqual(await status(task, mock), { state: 'active', received: 20, total: 100, speed: 10, message: '' });
  await pause(task, mock);
  assert.equal(calls[2].body.method, 'aria2.pause');
});
