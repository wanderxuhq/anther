// web/src/editor/language.test.ts
// 匹配逻辑纯函数，node --test 可测；loadLanguage 依赖 vite 动态 import，留手动验证。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeLanguage } from './language.ts';

test('describeLanguage: 扩展名匹配', () => {
  assert.equal(describeLanguage('a.ts')?.name, 'TypeScript');
  assert.equal(describeLanguage('a.tsx')?.name, 'TSX');
  assert.equal(describeLanguage('a.js')?.name, 'JavaScript');
  assert.equal(describeLanguage('a.md')?.name, 'Markdown');
  assert.equal(describeLanguage('a.py')?.name, 'Python');
  assert.equal(describeLanguage('a.json')?.name, 'JSON');
});

test('describeLanguage: 扩展名大小写不敏感', () => {
  assert.equal(describeLanguage('a.TS')?.name, 'TypeScript');
});

test('describeLanguage: 含目录路径按 basename 提取扩展名', () => {
  assert.equal(describeLanguage('dir/deep/a.tsx')?.name, 'TSX');
});

test('describeLanguage: 精确文件名匹配', () => {
  assert.equal(describeLanguage('Dockerfile')?.name, 'Dockerfile');
  assert.equal(describeLanguage('Jenkinsfile')?.name, 'Groovy');
  assert.equal(describeLanguage('CMakeLists.txt')?.name, 'CMake');
  assert.equal(describeLanguage('Gemfile')?.name, 'Ruby');
  assert.equal(describeLanguage('nginx.conf')?.name, 'Nginx');
});

test('describeLanguage: 无扩展名/未知扩展名/点文件降级为 null', () => {
  assert.equal(describeLanguage('Makefile'), null); // language-data 未覆盖 Makefile
  assert.equal(describeLanguage('a.xyzabc'), null);
  assert.equal(describeLanguage('.gitignore'), null);
});
