import { test } from 'node:test';
import assert from 'node:assert/strict';
import { richContent } from './content.ts';

test('parses image blocks', () => {
  assert.deepEqual(richContent({
    type: 'image',
    mimeType: 'image/png',
    data: 'iVBORw0KGgo=',
    uri: 'file:///tmp/a.png',
  }), {
    type: 'image',
    mimeType: 'image/png',
    data: 'iVBORw0KGgo=',
    uri: 'file:///tmp/a.png',
  });
  assert.equal(richContent({ type: 'image', mimeType: 'text/plain', data: 'x' }), null);
  assert.equal(richContent({ type: 'image', mimeType: 'image/png', data: '' }), null);
});

test('parses audio blocks', () => {
  assert.deepEqual(richContent({ type: 'audio', mimeType: 'audio/wav', data: 'abc' }), {
    type: 'audio',
    mimeType: 'audio/wav',
    data: 'abc',
  });
  assert.equal(richContent({ type: 'audio', mimeType: 'image/png', data: 'abc' }), null);
});

test('parses resource links with metadata', () => {
  assert.deepEqual(richContent({
    type: 'resource_link',
    uri: 'file:///tmp/readme.md',
    name: 'readme.md',
    mimeType: 'text/markdown',
    title: 'README',
    description: 'Project docs',
    size: 42,
  }), {
    type: 'resource_link',
    uri: 'file:///tmp/readme.md',
    name: 'readme.md',
    mimeType: 'text/markdown',
    title: 'README',
    description: 'Project docs',
    size: 42,
  });
  assert.equal(richContent({ type: 'resource_link', name: 'x' }), null);
});

test('parses embedded text and blob resources', () => {
  assert.deepEqual(richContent({
    type: 'resource',
    resource: { uri: 'file:///tmp/a.md', mimeType: 'text/markdown', text: '# A' },
  }), {
    type: 'resource',
    uri: 'file:///tmp/a.md',
    mimeType: 'text/markdown',
    text: '# A',
  });
  assert.deepEqual(richContent({
    type: 'resource',
    resource: { uri: 'file:///tmp/a.png', mimeType: 'image/png', blob: 'YWJj' },
  }), {
    type: 'resource',
    uri: 'file:///tmp/a.png',
    mimeType: 'image/png',
    blob: 'YWJj',
  });
  assert.equal(richContent({ type: 'resource', resource: { uri: 'file:///x' } }), null);
});

test('ignores text and malformed blocks', () => {
  assert.equal(richContent({ type: 'text', text: 'hello' }), null);
  assert.equal(richContent(null), null);
  assert.equal(richContent('x'), null);
  assert.equal(richContent({ type: 'unknown' }), null);
});
