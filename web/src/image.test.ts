import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isImageFile, isBinaryImage, resolveImageSource } from './image.ts';

test('图片识别支持常见扩展名及大小写，SVG 保留文本编辑能力', () => {
  for (const path of ['a.png', 'a.apng', 'a.jpg', 'a.JPEG', 'a.GIF', 'a.webp', 'a.avif', 'a.bmp', 'a.ico']) {
    assert.equal(isImageFile(path), true);
    assert.equal(isBinaryImage(path), true);
  }
  assert.equal(isImageFile('dir/image.SVG'), true);
  assert.equal(isBinaryImage('dir/image.SVG'), false);
  for (const path of [null, 'image.png.txt', 'image.png/readme.md', 'a.ts']) assert.equal(isImageFile(path), false);
});

test('Markdown 本地图片按文档路径解析，正确处理中文、编码字符、上级目录和根路径', () => {
  for (const [src, document, expected] of [
    ['images/a.png', 'README.md', 'images/a.png'],
    ['../images/图%20%23%25.png', 'docs/guide.md', 'images/图 #%.png'],
    ['/assets/logo.svg', 'docs/nested/readme.md', 'assets/logo.svg'],
    ['pic.png?v=2', '-/文件 #/README.md', '-/文件 #/pic.png'],
  ]) assert.equal(resolveImageSource(src, document), `/api/image?path=${encodeURIComponent(expected)}`);
  assert.equal(resolveImageSource('sprite.svg#icon', 'docs/readme.md'), '/api/image?path=docs%2Fsprite.svg#icon');
  for (const source of ['https://example.com/a.png', '//example.com/a.png', 'data:image/png;base64,AAAA', '#icon', '%zz']) {
    assert.equal(resolveImageSource(source, 'README.md'), source);
  }
});
