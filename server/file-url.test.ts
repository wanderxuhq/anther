// server/file-url.test.ts
// OSC 7 file:// URL → 平台路径。Windows 分支在 Linux/macOS 上也能测（显式传 platform）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileUrlPath } from './file-url.ts';

test('非 file:// 原样返回', () => {
  assert.equal(fileUrlPath('/home/a b'), '/home/a b');
  assert.equal(fileUrlPath('C:\\Users\\a'), 'C:\\Users\\a');
  assert.equal(fileUrlPath(''), '');
});

test('Windows：本机盘符路径（空 host 与 OSC 7 的 hostname 形式）', () => {
  const local = 'DESKTOP-TEST';
  assert.equal(fileUrlPath('file:///C:/Users/a%20b', 'win32', local), 'C:\\Users\\a b');
  assert.equal(fileUrlPath('file://DESKTOP-TEST/C:/Users/中文', 'win32', local), 'C:\\Users\\中文');
  // hostname 大小写不敏感
  assert.equal(fileUrlPath('file://desktop-test/C:/x', 'win32', local), 'C:\\x');
});

test('Windows：cmd PROMPT 的反斜杠与裸百分号', () => {
  assert.equal(fileUrlPath('file://HOST/C:\\Users\\a\\b', 'win32', 'HOST'), 'C:\\Users\\a\\b');
  assert.equal(fileUrlPath('file:///C:/100%', 'win32', 'HOST'), 'C:\\100%');
});

test('Windows：UNC 路径与远程 host', () => {
  assert.equal(fileUrlPath('file://server/share/dir', 'win32', 'HOST'), '\\\\server\\share\\dir');
  assert.equal(fileUrlPath('file://server/share/%E4%B8%AD', 'win32', 'HOST'), '\\\\server\\share\\中');
});

test('POSIX：忽略 host，只取 pathname', () => {
  assert.equal(fileUrlPath('file://HOST/home/a%20b', 'linux', 'HOST'), '/home/a b');
  assert.equal(fileUrlPath('file://server/share/x', 'linux', 'HOST'), '/share/x');
});
