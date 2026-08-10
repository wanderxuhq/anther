// web/src/views/diff-model.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseUnifiedDiff, buildInlineDoc } from './diff-model.ts';

// 多行字符串辅助：数组 join（diff 内容含 `+`/`-`/空格前缀，不用模板缩进）
const D = (...lines: string[]) => lines.join('\n');

test('parseUnifiedDiff：多文件拆分 + add/del 计数 + 路径', () => {
  const text = D(
    'diff --git a/src/a.ts b/src/a.ts',
    'index abc..def 100644',
    '--- a/src/a.ts',
    '+++ b/src/a.ts',
    '@@ -1,3 +1,4 @@',
    ' keep',
    '-gone',
    '+added',
    '+added2',
    'diff --git a/src/b.ts b/src/b.ts',
    'index 111..222 100644',
    '--- a/src/b.ts',
    '+++ b/src/b.ts',
    '@@ -5 +5,2 @@',
    ' ctx',
    '-old',
    '+new',
  );
  const files = parseUnifiedDiff(text);
  assert.equal(files.length, 2);
  const [a, b] = files;
  assert.equal(a.path, 'src/a.ts');
  assert.equal(a.status, 'modified');
  assert.equal(a.addCount, 2);
  assert.equal(a.delCount, 1);
  assert.equal(b.path, 'src/b.ts');
  assert.equal(b.addCount, 1);
  assert.equal(b.delCount, 1);
});

test('buildInlineDoc：hunk 内 ctx→del→add 子块顺序 + 行号（del 为 null）', () => {
  const text = D(
    'diff --git a/x b/x',
    '--- a/x',
    '+++ b/x',
    '@@ -10,6 +20,7 @@',
    ' ctx-a',
    '-del-1',
    '-del-2',
    '+add-1',
    '+add-2',
    ' ctx-b',
  );
  const file = parseUnifiedDiff(text)[0];
  const { doc, kinds, numbers } = buildInlineDoc(file);
  assert.deepEqual(kinds, ['ctx', 'del', 'del', 'add', 'add', 'ctx']);
  assert.deepEqual(numbers, [20, null, null, 21, 22, 23]);
  assert.equal(doc, D('ctx-a', 'del-1', 'del-2', 'add-1', 'add-2', 'ctx-b'));
});

test('buildInlineDoc：多 hunk 各自从 newStart 起编号', () => {
  const text = D(
    'diff --git a/x b/x',
    '--- a/x',
    '+++ b/x',
    '@@ -1,2 +1,2 @@',
    ' a1',
    '+b1',
    '@@ -10,2 +11,2 @@',
    ' c1',
    '-d1',
    '+e1',
  );
  const { numbers } = buildInlineDoc(parseUnifiedDiff(text)[0]);
  assert.deepEqual(numbers, [1, 2, 11, null, 12]);
});

test('parseUnifiedDiff：重命名 → status renamed + oldPath', () => {
  const text = D(
    'diff --git a/src/old.ts b/src/new.ts',
    'similarity index 90%',
    'rename from src/old.ts',
    'rename to src/new.ts',
    'index abc..def 100644',
    '--- a/src/old.ts',
    '+++ b/src/new.ts',
    '@@ -1 +1 @@',
    '-old',
    '+new',
  );
  const file = parseUnifiedDiff(text)[0];
  assert.equal(file.status, 'renamed');
  assert.equal(file.oldPath, 'src/old.ts');
  assert.equal(file.path, 'src/new.ts');
});

test('parseUnifiedDiff：二进制 → status binary + 空 hunks', () => {
  const text = D(
    'diff --git a/img.png b/img.png',
    'index 111..222 100644',
    'Binary files a/img.png and b/img.png differ',
  );
  const file = parseUnifiedDiff(text)[0];
  assert.equal(file.status, 'binary');
  assert.equal(file.addCount, 0);
  assert.equal(file.delCount, 0);
  assert.deepEqual(file.hunks, []);
});

test('parseUnifiedDiff：新增二进制文件 → status binary（new file mode 行在 Binary files 之前）', () => {
  const text = D(
    'diff --git a/dev/null b/new.png',
    'new file mode 100644',
    'index 0000000..e69de29',
    'Binary files /dev/null and b/new.png differ',
  );
  const file = parseUnifiedDiff(text)[0];
  assert.equal(file.status, 'binary');
  assert.equal(file.addCount, 0);
  assert.equal(file.delCount, 0);
  assert.deepEqual(file.hunks, []);
});

test('parseUnifiedDiff：删除二进制文件 → status binary（deleted file mode 行在 Binary files 之前）', () => {
  const text = D(
    'diff --git a/gone.png b/gone.png',
    'deleted file mode 100644',
    'index 111..000 100644',
    'Binary files a/gone.png and /dev/null differ',
  );
  const file = parseUnifiedDiff(text)[0];
  assert.equal(file.status, 'binary');
  assert.equal(file.addCount, 0);
  assert.equal(file.delCount, 0);
  assert.deepEqual(file.hunks, []);
});

test('parseUnifiedDiff：新增文件 → status added（a/ 侧为 /dev/null 仍取 b/ 路径）', () => {
  const text = D(
    'diff --git a/dev/null b/new.txt',
    'new file mode 100644',
    'index 0000000..e69de29',
    '--- /dev/null',
    '+++ b/new.txt',
    '@@ -0,0 +1 @@',
    '+hello',
  );
  const file = parseUnifiedDiff(text)[0];
  assert.equal(file.status, 'added');
  assert.equal(file.path, 'new.txt');
});

test('parseUnifiedDiff：删除文件 → status deleted + a/ 侧路径', () => {
  const text = D(
    'diff --git a/gone.txt b/gone.txt',
    'deleted file mode 100644',
    'index 111..000 100644',
    '--- a/gone.txt',
    '+++ /dev/null',
    '@@ -1 +0,0 @@',
    '-bye',
  );
  const file = parseUnifiedDiff(text)[0];
  assert.equal(file.status, 'deleted');
  assert.equal(file.path, 'gone.txt');
});

test('parseUnifiedDiff：\\ No newline 标记行丢弃', () => {
  const text = D(
    'diff --git a/x b/x',
    '--- a/x',
    '+++ b/x',
    '@@ -1 +1 @@',
    '-old',
    '\\ No newline at end of file',
    '+new',
  );
  const { kinds } = buildInlineDoc(parseUnifiedDiff(text)[0]);
  assert.deepEqual(kinds, ['del', 'add']);
});

test('parseUnifiedDiff：空 diff → 空数组', () => {
  assert.deepEqual(parseUnifiedDiff(''), []);
});
