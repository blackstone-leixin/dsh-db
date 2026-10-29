import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeValue, classifySql, assertReadOnlyStatement } from '../lib/values.js'

test('normalizeValue converts driver values to JSON-safe cells', () => {
  assert.equal(normalizeValue(null), null)
  assert.equal(normalizeValue(undefined), null)
  assert.equal(normalizeValue(12), 12)
  assert.equal(normalizeValue(true), true)
  assert.equal(normalizeValue(10n), '10')
  assert.equal(normalizeValue(new Date('2026-01-02T03:04:05.000Z')), '2026-01-02T03:04:05.000Z')
  assert.equal(normalizeValue(Buffer.from([0xde, 0xad])), '0xdead')
  assert.equal(normalizeValue({ a: 1 }), '{"a":1}')
  assert.equal(normalizeValue([1, 2]), '[1,2]')
  assert.match(normalizeValue('x'.repeat(5000)), /chars\)$/)
})

test('classifySql sees past comments, strings and identifiers', () => {
  assert.equal(classifySql('-- hi\nSELECT 1').keyword, 'SELECT')
  assert.equal(classifySql('/* c */ UPDATE t SET a = 1').keyword, 'UPDATE')
  assert.equal(classifySql("SELECT 'drop table x'").write, false)
  assert.equal(classifySql('SELECT "update" FROM t').write, false)
  assert.equal(classifySql('SELECT 1; SELECT 2').multiple, true)
})

test('read-only policy allows queries and rejects writes', () => {
  assert.doesNotThrow(() => assertReadOnlyStatement('SELECT 1'))
  assert.doesNotThrow(() => assertReadOnlyStatement('SHOW TABLES'))
  assert.doesNotThrow(() => assertReadOnlyStatement('DESCRIBE users'))
  assert.doesNotThrow(() => assertReadOnlyStatement('EXPLAIN SELECT * FROM users'))
  assert.doesNotThrow(() => assertReadOnlyStatement('WITH x AS (SELECT 1) SELECT * FROM x'))
  assert.doesNotThrow(() => assertReadOnlyStatement('SELECT $$a;b$$'))
  assert.throws(() => assertReadOnlyStatement('DELETE FROM users'), /只读/)
  assert.throws(() => assertReadOnlyStatement('CREATE TABLE t (id int)'), /只读/)
  assert.throws(() => assertReadOnlyStatement('SELECT 1; DELETE FROM users'), /一次只能执行一条/)
  assert.throws(() => assertReadOnlyStatement('WITH x AS (DELETE FROM users RETURNING *) SELECT 1'), /数据修改/)
  assert.throws(() => assertReadOnlyStatement('EXPLAIN ANALYZE DELETE FROM users'), /EXPLAIN/)
  assert.throws(() => assertReadOnlyStatement("SELECT * INTO OUTFILE '/tmp/x' FROM users"), /INTO/)
})
