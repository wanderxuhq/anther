import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFragment, serializeFragment } from './url-fragment.ts';
import { parseUrl, serializeUrl } from './url-state.ts';

test('fragment values round-trip delimiters, Unicode, literal plus and percent signs', () => {
  const fields = new URLSearchParams({ heading: '中文;冒号:#&=+% /', lbp: '2@1/3#42' });
  const fragment = serializeFragment(fields);
  assert(fragment.includes('lbp:2@1/3%2342'));
  assert(!fragment.slice(1).includes('#'));
  assert.deepEqual([...parseFragment(fragment)], [...fields]);
  assert.equal(parseFragment('#heading:a+b').get('heading'), 'a+b');
});

test('fragment order is irrelevant, the last duplicate wins, malformed fields are isolated', () => {
  const value = parseUrl('http://host/book.pdf#zoom:150;garbage;page:2;page:7;x:%ZZ;y:600;unknown:value');
  assert.deepEqual(value.reader, { kind: 'pdf', page: 7, y: 600, zoom: 1.5 });
  assert.equal(serializeUrl(value), '/book.pdf#page:7;y:600;zoom:150');
});

test('position fields only use fragments; query remains resource/configuration state', () => {
  assert.equal(serializeUrl(parseUrl('http://host/a.txt?line=9#line:3')), '/a.txt#line:3');
  assert.equal(serializeUrl(parseUrl('http://host/movie.mp4?t=9&rate=2')), '/movie.mp4');
  const value = parseUrl('http://host/_/database/a.zip?entry=data.db&object=users&filter=name&value=A%3BB#offset:100;row:103;expanded:1');
  assert.equal(value.database?.filter?.value, 'A;B');
  assert.equal(value.database?.offset, 100);
  assert.equal(value.database?.table?.row, 103);
  assert.deepEqual(parseUrl('http://host' + serializeUrl(value)), value);
});

test('file names and archive entries containing # and ; remain separate from positions', () => {
  const value = parseUrl('http://host/books%23%3B.zip?inside=inner%23.zip&entry=book%3B.epub#lbp:2@1/3%2342;zoom:125');
  assert.equal(value.path, 'books#;.zip'); assert.equal(value.entry, 'book;.epub');
  assert.deepEqual(value.reader, { kind: 'epub', lbp: '2@1/3#42', zoom: 1.25 });
  assert.deepEqual(parseUrl('http://host' + serializeUrl(value)), value);
});
