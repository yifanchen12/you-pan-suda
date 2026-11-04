const test = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { nextAvailablePath, releasePath } = require('../destination.cjs');

test('批量下载避开已有文件和正在下载的同名文件', async () => {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'suda-name-test-'));
  try {
    await fsp.writeFile(path.join(directory, '教材.pdf'), 'keep');
    const first = await nextAvailablePath(directory, '教材.pdf');
    const second = await nextAvailablePath(directory, '教材.pdf');
    assert.equal(path.basename(first), '教材 (2).pdf');
    assert.equal(path.basename(second), '教材 (3).pdf');
    assert.equal(await fsp.readFile(path.join(directory, '教材.pdf'), 'utf8'), 'keep');
    releasePath(first);
    releasePath(second);
  } finally {
    await fsp.rm(path.join(directory, '教材.pdf'), { force: true });
    await fsp.rmdir(directory);
  }
});
