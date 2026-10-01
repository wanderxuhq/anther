import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDelimited } from './tabular.ts';

test('CSV：支持 BOM、引号内分隔符/换行及双引号转义', () => {
  const csv = '\ufeffname,note\r\n"Doe, Jane","line one\r\nline ""two"""\r\n';
  assert.deepEqual(parseDelimited(csv, ','), {
    rows: [
      ['name', 'note'],
      ['Doe, Jane', 'line one\r\nline "two"'],
    ],
    truncated: false,
  });
});

test('TSV：支持空单元格、尾随分隔符和普通尾换行', () => {
  assert.deepEqual(parseDelimited('a\t\tc\t\r\n\tvalue\t\n', '\t'), {
    rows: [['a', '', 'c', ''], ['', 'value', '']],
    truncated: false,
  });
  assert.deepEqual(parseDelimited('key\tvalue\n"a\tb"\t"say ""hi""\nthere"\n', '\t'), {
    rows: [['key', 'value'], ['a\tb', 'say "hi"\nthere']],
    truncated: false,
  });
});

test('保留中间空记录，但不为单个尾换行添加记录', () => {
  assert.deepEqual(parseDelimited('a\n\nb\n', ','), {
    rows: [['a'], [''], ['b']],
    truncated: false,
  });
  assert.deepEqual(parseDelimited('', ','), { rows: [], truncated: false });
});

test('达到行数上限后只返回预览行，并标记是否还有记录', () => {
  assert.deepEqual(parseDelimited('a,b\r\nc,d\r\ne,f', ',', 2), {
    rows: [['a', 'b'], ['c', 'd']],
    truncated: true,
  });
  assert.deepEqual(parseDelimited('a,b\nc,d\n', ',', 2), {
    rows: [['a', 'b'], ['c', 'd']],
    truncated: false,
  });
  assert.deepEqual(parseDelimited('a\n', ',', 1), {
    rows: [['a']],
    truncated: false,
  });
  assert.deepEqual(parseDelimited('a,b', ',', 0), { rows: [], truncated: true });
});

test('引号解析仅生成纯文本单元格', () => {
  const source = 'value\n"=1+1"\n"<script>alert(1)</script>"';
  assert.deepEqual(parseDelimited(source, ','), {
    rows: [['value'], ['=1+1'], ['<script>alert(1)</script>']],
    truncated: false,
  });
});
