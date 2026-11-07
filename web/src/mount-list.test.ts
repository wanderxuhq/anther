// web/src/mount-list.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isCurrentMount, isInstancesPath, mountHref, mountLabel, type MountInfo } from './mount-list.ts';

const host: MountInfo = {
  name: 'anther', index: 0, workspace: '/repo/anther',
  base: '/-/anther/-/0', shorthand: '/-/anther', legacyRoot: true,
};
const first: MountInfo = {
  name: 'qlang', index: 0, workspace: '/repo/qlang',
  base: '/-/qlang/-/0', shorthand: '/-/qlang', legacyRoot: false,
};
const second: MountInfo = {
  name: 'qlang', index: 1, workspace: '/other/qlang',
  base: '/-/qlang/-/1', shorthand: null, legacyRoot: false,
};

test('mountHref：宿主优先根路径，其余优先简写，最后规范地址', () => {
  assert.equal(mountHref(host), '/');
  assert.equal(mountHref(first), '/-/qlang/');
  assert.equal(mountHref(second), '/-/qlang/-/1/');
});

test('isCurrentMount：根、简写、规范地址都能识别当前实例', () => {
  assert.equal(isCurrentMount(host, ''), true);
  assert.equal(isCurrentMount(host, '/-/anther'), true);
  assert.equal(isCurrentMount(host, '/-/anther/-/0'), true);
  assert.equal(isCurrentMount(host, '/-/qlang'), false);

  assert.equal(isCurrentMount(first, '/-/qlang'), true);
  assert.equal(isCurrentMount(first, '/-/qlang/-/0'), true);
  assert.equal(isCurrentMount(first, '/-/qlang/-/1'), false);
  assert.equal(isCurrentMount(second, '/-/qlang/-/1'), true);
  assert.equal(isCurrentMount(second, '/-/qlang'), false);
});

test('isInstancesPath：/- 和 /-/ 是实例列表页', () => {
  assert.equal(isInstancesPath('/-'), true);
  assert.equal(isInstancesPath('/-/'), true);
  assert.equal(isInstancesPath('/-/qlang'), false);
  assert.equal(isInstancesPath('/-/qlang/-/0'), false);
  assert.equal(isInstancesPath('/_/file/-'), false);
});

test('mountLabel：index > 0 才追加 #index', () => {
  assert.equal(mountLabel(host), 'anther');
  assert.equal(mountLabel(first), 'qlang');
  assert.equal(mountLabel(second), 'qlang #1');
});
