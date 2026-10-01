import { test } from 'node:test';
import assert from 'node:assert/strict';
import { archiveChildren, archivePath, isArchiveFile, parseSevenZipListing } from './archive.ts';

test('archivePath 规范化分隔符并拒绝绝对路径、越界段和控制字符', () => {
  assert.equal(archivePath('docs\\./guide//start.md'), 'docs/guide/start.md');
  for (const path of ['/etc/passwd', '\\\\server\\share', 'C:\\outside', '../secret',
    'docs/../secret', 'docs\\..\\secret', 'bad\u0000name', 'bad\u001fname', 'bad\u007fname']) {
    assert.equal(archivePath(path), null, JSON.stringify(path));
  }
});

test('parseSevenZipListing 读取目录和加密标记，规范隐含文件路径', () => {
  const listing = [
    '7-Zip listing',
    'Path = sample.7z',
    'Type = 7z',
    '----------',
    'Path = docs',
    'Folder = +',
    'Size = 0',
    '',
    'Path = docs/private.txt',
    'Size = 7',
    'Encrypted = +',
    '',
    'Path = docs/nested/',
    'Attributes = D....',
    'Size = 0',
  ].join('\n');
  assert.deepEqual(parseSevenZipListing(listing), [
    { id: 0, path: 'docs', directory: true, size: 0, encrypted: false, link: false },
    { id: 1, path: 'docs/private.txt', directory: false, size: 7, encrypted: true, link: false },
    { id: 2, path: 'docs/nested', directory: true, size: 0, encrypted: false, link: false },
  ]);
});

test('parseSevenZipListing 拒绝恶意路径和无效元数据', () => {
  for (const path of ['../outside', '/absolute', 'C:\\outside', 'bad\u0001name']) {
    const listing = `header\n----------\nPath = ${path}\nSize = 1`;
    assert.throws(() => parseSevenZipListing(listing), /Unsupported archive entry/);
  }
  assert.throws(() => parseSevenZipListing('header\n----------\nPath = a\nSize = -1'), /Unsupported archive entry/);
});

test('archiveChildren 合并隐含目录，并限制返回的预览条目数', () => {
  const entries = [
    { id: 1, path: 'docs/one.txt', directory: false, size: 1, encrypted: false, link: false },
    { id: 2, path: 'docs/two.txt', directory: false, size: 1, encrypted: false, link: false },
    { id: 3, path: 'other.txt', directory: false, size: 1, encrypted: false, link: false },
    { id: 4, path: 'later.txt', directory: false, size: 1, encrypted: false, link: false },
  ];
  const page = archiveChildren(entries, '', 2);
  assert.deepEqual(page.map((entry) => entry.path), ['docs', 'other.txt']);
  assert.equal(page[0].directory, true);
  assert.deepEqual(archiveChildren(entries, 'docs').map((entry) => entry.path), ['docs/one.txt', 'docs/two.txt']);
});

test('isArchiveFile 大小写不敏感地识别支持的扩展名', () => {
  for (const filename of ['a.zip', 'a.jar', 'a.WAR', 'a.apk', 'a.xpi', 'a.cbz', 'a.7z', 'a.rar',
    'a.tar', 'a.gz', 'a.tgz', 'a.bz2', 'a.tbz', 'a.tbz2', 'a.xz', 'a.txz']) {
    assert.equal(isArchiveFile(filename), true, filename);
  }
  for (const filename of ['readme.txt', 'archive.zip.txt', 'photo.png']) assert.equal(isArchiveFile(filename), false, filename);
});


test('TAR 允许末尾空字段和根目录占位，保留提取所需的原始路径', () => {
  const entries = parseSevenZipListing('----------\nPath = ./\nFolder = +\nSize = 0\n\nPath = ./docs/a.txt\nFolder = -\nSize = 3\nDevice Minor = \n');
  assert.equal(entries.length, 1);
  assert.equal(entries[0].path, 'docs/a.txt');
  assert.equal(entries[0].sourcePath, './docs/a.txt');
});
