// web/src/i18n.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectLang, setLang, t } from './i18n.ts';

test('detectLang：?lang= 覆盖优先于浏览器语言', () => {
  assert.equal(detectLang(['en-US'], 'zh'), 'zh');
  assert.equal(detectLang(['zh-CN'], 'en'), 'en');
});

test('detectLang：zh* 浏览器语言 → zh；其余 → en（默认 + fallback）', () => {
  assert.equal(detectLang(['zh-CN'], null), 'zh');
  assert.equal(detectLang(['zh-Hans', 'zh-CN'], null), 'zh');
  assert.equal(detectLang(['en-US'], null), 'en');
  assert.equal(detectLang(['de-DE', 'fr-FR'], null), 'en');
  assert.equal(detectLang([], null), 'en');
});

test('detectLang：非法覆盖值忽略，走浏览器语言', () => {
  assert.equal(detectLang(['fr-FR'], 'xx'), 'en');
  assert.equal(detectLang(['zh-CN'], 'xx'), 'zh');
});

test('t：按当前 lang 取词', () => {
  setLang('en');
  assert.equal(t('menu'), 'Menu');
  setLang('zh');
  assert.equal(t('menu'), '菜单');
});

test('t：{n} 插值', () => {
  setLang('en');
  assert.equal(t('terminal.name', { n: 3 }), 'Terminal 3');
  setLang('zh');
  assert.equal(t('terminal.name', { n: 3 }), '终端 3');
});

test('t：未知 key 回退 key 本身（永不空白）', () => {
  setLang('zh');
  assert.equal(t('view.files'), '文件');
  setLang('en');
  assert.equal(t('missing.key'), 'missing.key');
});
