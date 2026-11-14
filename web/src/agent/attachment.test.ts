import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promptContentForAttachment, type PromptAttachment } from './attachment.ts';

function attachment(overrides: Partial<PromptAttachment>): PromptAttachment {
  return {
    id: 'a1',
    kind: 'file',
    name: 'a.txt',
    mimeType: 'text/plain',
    size: 10,
    uri: 'file:///a.txt',
    ...overrides,
  };
}

test('maps image attachments to image blocks', () => {
  assert.deepEqual(promptContentForAttachment(attachment({
    kind: 'image',
    name: 'a.png',
    mimeType: 'image/png',
    data: 'abc',
    uri: 'file:///a.png',
  }), false), {
    type: 'image',
    mimeType: 'image/png',
    data: 'abc',
    uri: 'file:///a.png',
  });
});

test('maps audio attachments to audio blocks', () => {
  assert.deepEqual(promptContentForAttachment(attachment({
    kind: 'audio',
    name: 'a.wav',
    mimeType: 'audio/wav',
    data: 'abc',
  }), true), {
    type: 'audio',
    mimeType: 'audio/wav',
    data: 'abc',
  });
});

test('embeds text files when embeddedContext is supported', () => {
  assert.deepEqual(promptContentForAttachment(attachment({
    name: 'notes.md',
    mimeType: 'text/markdown',
    text: '# notes',
    uri: 'file:///notes.md',
  }), true), {
    type: 'resource',
    resource: {
      uri: 'file:///notes.md',
      mimeType: 'text/markdown',
      text: '# notes',
    },
  });
});

test('falls back to resource links without embeddedContext', () => {
  assert.deepEqual(promptContentForAttachment(attachment({
    name: 'notes.md',
    mimeType: 'text/markdown',
    text: '# notes',
    uri: 'file:///notes.md',
  }), false), {
    type: 'resource_link',
    uri: 'file:///notes.md',
    name: 'notes.md',
    mimeType: 'text/markdown',
    size: 10,
  });
});
