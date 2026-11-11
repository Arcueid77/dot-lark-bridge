import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { privateMkdtempSync, cleanupPrivateFixture, fixtureChmodSync, assertPrivateFixture } from '@dot-bridge/core/platform/test-fixtures.js';
import { Store } from '../src/store.js';
import { config } from './helpers.js';

function fixture(t, bridgeMode) {
  const directory = privateMkdtempSync(path.join(os.tmpdir(), 'lark-private-db-'));
  cleanupPrivateFixture(t, directory);
  const dbPath = path.join(directory, 'bridge.sqlite');
  const settings = config({ dbPath, bridgeMode, authMode: 'oauth' });
  return { directory, dbPath, settings };
}
function rejectsUnchanged(settings, target) {
  const before = fs.readFileSync(target), stat = fs.statSync(target);
  assert.throws(() => { const store = new Store(settings); store.close(); }, /unsafe/);
  assert.deepEqual(fs.readFileSync(target), before);
  assert.equal(fs.statSync(target).mode, stat.mode);
  assert.equal(fs.statSync(target).uid, stat.uid);
}

for (const mode of ['tunnel', 'sites']) {
  test(`${mode} durable storage creates private files and preserves state across reopen`, t => {
    const f = fixture(t, mode);
    const first = new Store(f.settings);
    try { first.run('INSERT INTO metadata VALUES (?,?)', 'synthetic-restart', 'kept'); }
    finally { first.close(); }
    assertPrivateFixture(assert, f.directory, 0o700); assertPrivateFixture(assert, f.dbPath, 0o600);
    const second = new Store(f.settings);
    try { assert.equal(second.get('SELECT value FROM metadata WHERE key=?', 'synthetic-restart').value, 'kept'); }
    finally { second.close(); }
  });

  test(`${mode} refuses a non-private existing database without changing bytes or permissions`, t => {
    const f = fixture(t, mode); new Store(f.settings).close();
    fixtureChmodSync(f.dbPath, 0o644); rejectsUnchanged(f.settings, f.dbPath);
  });

  test(`${mode} refuses a non-private database directory without changing its permissions`, t => {
    const f = fixture(t, mode); new Store(f.settings).close();
    fixtureChmodSync(f.directory, 0o755); rejectsUnchanged(f.settings, f.dbPath);
  });

  test(`${mode} refuses hardlinked database and SQLite sidecars before opening`, t => {
    const f = fixture(t, mode); new Store(f.settings).close();
    const alias = path.join(f.directory, 'alias');
    fs.linkSync(f.dbPath, alias); rejectsUnchanged(f.settings, f.dbPath); fs.unlinkSync(alias);
    for (const suffix of ['-wal', '-shm', '-journal']) {
      const sidecar = f.dbPath + suffix;
      fs.linkSync(f.dbPath, sidecar); rejectsUnchanged(f.settings, f.dbPath); fs.unlinkSync(sidecar);
    }
  });

  test(`${mode} rejects Linux symlink paths and unsafe sidecars without touching their targets`, { skip: process.platform !== 'linux' }, t => {
    const f = fixture(t, mode); new Store(f.settings).close();
    const target = path.join(f.directory, 'original.sqlite'); fs.renameSync(f.dbPath, target);
    fs.symlinkSync(target, f.dbPath); rejectsUnchanged(f.settings, target); fs.unlinkSync(f.dbPath); fs.renameSync(target, f.dbPath);
    const alias = path.join(f.directory, 'directory-link'); fs.symlinkSync(f.directory, alias);
    rejectsUnchanged({ ...f.settings, dbPath: path.join(alias, 'bridge.sqlite') }, f.dbPath);
    for (const suffix of ['-wal', '-shm', '-journal']) {
      const sidecar = f.dbPath + suffix;
      fs.symlinkSync(f.dbPath, sidecar); rejectsUnchanged(f.settings, f.dbPath); fs.unlinkSync(sidecar);
      fs.writeFileSync(sidecar, 'synthetic-sidecar', { mode: 0o644 });
      rejectsUnchanged(f.settings, sidecar); fs.unlinkSync(sidecar);
    }
  });

  test(`${mode} rejects foreign-owned Linux database files`, { skip: process.platform !== 'linux' || process.getuid?.() !== 0 }, t => {
    const f = fixture(t, mode); new Store(f.settings).close();
    fs.chownSync(f.dbPath, 65534, 65534); rejectsUnchanged(f.settings, f.dbPath);
  });
}
