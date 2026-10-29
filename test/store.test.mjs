import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ConnectionStore } from '../lib/store.js'

/** Build a store backed by a throwaway directory. */
function withStore(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-db-test-'))
  try {
    fn(new ConnectionStore(join(dir, 'dsh-db.json')))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const MYSQL = {
  name: 'local',
  type: 'mysql',
  host: '127.0.0.1',
  port: 3306,
  user: 'root',
  password: 'secret',
  database: 'app',
  ssl: 'disable',
  readOnly: true,
}

test('create, summarize, resolve and delete', () => {
  withStore(store => {
    const entry = store.create(MYSQL)
    assert.match(entry.id, /^db_/)
    assert.equal(entry.name, 'local')

    const summary = store.summarize(entry)
    assert.equal(summary.hasPassword, true)
    assert.equal('password' in summary, false)

    assert.equal(store.resolve('local').id, entry.id)
    assert.equal(store.resolve('LOCAL').id, entry.id)
    assert.equal(store.resolve(entry.id).name, 'local')

    store.delete(entry.id)
    assert.equal(store.list().length, 0)
    assert.equal(store.resolve('local'), undefined)
  })
})

test('duplicate names are rejected case-insensitively', () => {
  withStore(store => {
    store.create(MYSQL)
    assert.throws(() => store.create({ ...MYSQL, name: 'LOCAL' }), /already exists/)
  })
})

test('update keeps the password when omitted and clears it when empty', () => {
  withStore(store => {
    const entry = store.create(MYSQL)
    const updated = store.update(entry.id, { name: 'renamed', readOnly: false })
    assert.equal(updated.name, 'renamed')
    assert.equal(updated.readOnly, false)
    assert.equal(updated.password, 'secret')
    assert.equal(store.list()[0].password, 'secret')

    store.update(entry.id, { password: '' })
    assert.equal(store.list()[0].password, '')
    assert.equal(store.summarize(store.list()[0]).hasPassword, false)
  })
})

test('invalid payloads are rejected', () => {
  withStore(store => {
    assert.throws(() => store.create({ ...MYSQL, type: 'sqlite' }), /type must be/)
    assert.throws(() => store.create({ ...MYSQL, port: 0 }), /port must be/)
    assert.throws(() => store.create({ ...MYSQL, ssl: 'bogus' }), /ssl must be/)
  })
})
