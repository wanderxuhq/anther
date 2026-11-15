import { test } from 'node:test';
import assert from 'node:assert/strict';
import { t } from '../i18n.ts';
import { treeWriteSuccess, uploadWriteResult } from './filetree-write.ts';

test('uploadWriteResult returns a null error when every file uploaded', () => {
  assert.deepEqual(uploadWriteResult({ uploaded: 2, failed: [] }), treeWriteSuccess());
});

test('uploadWriteResult reports a single duplicate by basename', () => {
  assert.deepEqual(uploadWriteResult({
    uploaded: 0,
    failed: [{ path: 'docs/a.txt', status: 409, message: 'already exists' }],
  }), { error: t('filetree.uploadExists', { name: 'a.txt' }) });
});

test('uploadWriteResult reports mixed/partial failures with counts', () => {
  assert.deepEqual(uploadWriteResult({
    uploaded: 3,
    failed: [
      { path: 'docs/a.txt', status: 409, message: 'already exists' },
      { path: 'docs/b.txt', status: 500, message: 'disk full' },
    ],
  }), { error: t('filetree.uploadFailed', { uploaded: 3, failed: 2, name: 'a.txt' }) });
});
