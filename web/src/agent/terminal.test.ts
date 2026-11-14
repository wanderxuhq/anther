import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stripTerminalControl, terminalIdsFromContent } from './terminal.ts';

test('collects unique terminal ids from tool-call content', () => {
  const content = [
    { type: 'terminal', terminalId: 'term_1' },
    { type: 'content', content: { type: 'text', text: 'x' } },
    { type: 'terminal', terminalId: 'term_2' },
    { type: 'terminal', terminalId: 'term_1' },
  ];
  assert.deepEqual(terminalIdsFromContent(content), ['term_1', 'term_2']);
});

test('ignores malformed tool-call content', () => {
  assert.deepEqual(terminalIdsFromContent(undefined), []);
  assert.deepEqual(terminalIdsFromContent(null), []);
  assert.deepEqual(terminalIdsFromContent({ type: 'terminal', terminalId: 'x' }), []);
  assert.deepEqual(terminalIdsFromContent([{ type: 'terminal' }, { type: 'content' }]), []);
});

test('strips CSI color sequences', () => {
  assert.equal(stripTerminalControl('\x1b[31mred\x1b[0m'), 'red');
  assert.equal(stripTerminalControl('\x1b[1;32mok\x1b[0m\n'), 'ok\n');
});

test('strips OSC titles and other control sequences', () => {
  assert.equal(stripTerminalControl('\x1b]0;title\x07hello'), 'hello');
  assert.equal(stripTerminalControl('\x1b]7;file://host/path\x1b\\next'), 'next');
  assert.equal(stripTerminalControl('\x1b[2K\x1b[1Gdone'), 'done');
});

test('preserves ordinary text, newlines, tabs and unicode', () => {
  assert.equal(stripTerminalControl('中文\n\temoji 😀\n'), '中文\n\temoji 😀\n');
});

test('normalizes carriage returns', () => {
  assert.equal(stripTerminalControl('a\r\nb\rc'), 'a\nb\nc');
});
