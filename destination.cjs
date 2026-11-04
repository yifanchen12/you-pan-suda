const path = require('node:path');
const fsp = require('node:fs/promises');
const { safeName } = require('./lib.cjs');

const reservedPaths = new Set();

async function nextAvailablePath(directory, name) {
  const clean = safeName(name);
  const ext = path.extname(clean);
  const stem = clean.slice(0, clean.length - ext.length);
  for (let number = 1; number < 10000; number++) {
    const filename = number === 1 ? clean : `${stem} (${number})${ext}`;
    const candidate = path.join(directory, filename);
    const key = candidate.toLowerCase();
    if (reservedPaths.has(key)) continue;
    try { await fsp.access(candidate); } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      reservedPaths.add(key);
      return candidate;
    }
  }
  throw new Error('保存文件夹中存在过多同名文件');
}

function releasePath(destination) {
  reservedPaths.delete(destination.toLowerCase());
}

module.exports = { nextAvailablePath, releasePath };
