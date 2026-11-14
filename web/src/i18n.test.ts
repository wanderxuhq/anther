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

test('t：Agent 面板静态文案在中英文都存在', () => {
  setLang('en');
  assert.equal(t('agent.newChat'), 'New chat');
  assert.equal(t('agent.mode'), 'Mode');
  assert.equal(t('agent.skills'), 'Skills');
  assert.equal(t('agent.installSelected'), 'Install selected');
  assert.equal(t('agent.authRequired'), 'Sign in required');
  assert.equal(t('agent.terminalOutput'), 'Terminal output');
  assert.equal(t('agent.plan'), 'Plan');
  assert.equal(t('agent.planProgress', { done: 1, total: 3 }), '1/3 done');
  assert.equal(t('agent.sessionSettings'), 'Settings');
  assert.equal(t('agent.noPermissionOptions'), 'The agent did not provide permission options.');
  assert.equal(t('agent.attach'), 'Attach files');
  assert.equal(t('agent.richImage'), 'Attached image');
  assert.equal(t('agent.mcpServers'), 'MCP servers');
  assert.equal(t('agent.mcpSecurity').startsWith('MCP servers can run'), true);
  assert.equal(t('agent.compaction.cancelled'), 'Compaction cancelled');
  assert.equal(t('agent.compaction.failedGeneric'), 'Compaction failed');
  assert.equal(t('agent.systemPrompt'), 'System prompt');
  assert.equal(t('agent.systemPromptClear'), 'Clear');
  assert.equal(t('agent.openLink'), 'Open link');
  assert.equal(t('agent.decline'), 'Decline');
  setLang('zh');
  assert.equal(t('agent.newChat'), '新会话');
  assert.equal(t('agent.mode'), '模式');
  assert.equal(t('agent.skills'), '技能');
  assert.equal(t('agent.installSelected'), '安装所选');
  assert.equal(t('agent.authRequired'), '需要登录');
  assert.equal(t('agent.terminalOutput'), '终端输出');
  assert.equal(t('agent.plan'), '计划');
  assert.equal(t('agent.planProgress', { done: 1, total: 3 }), '1/3 已完成');
  assert.equal(t('agent.sessionSettings'), '设置');
  assert.equal(t('agent.noPermissionOptions'), 'Agent 没有提供权限选项。');
  assert.equal(t('agent.attach'), '添加附件');
  assert.equal(t('agent.richImage'), '附加图片');
  assert.equal(t('agent.mcpServers'), 'MCP 服务');
  assert.equal(t('agent.mcpSecurity').startsWith('MCP 服务可以'), true);
  assert.equal(t('agent.compaction.cancelled'), '上下文压缩已取消');
  assert.equal(t('agent.compaction.failedGeneric'), '上下文压缩失败');
  assert.equal(t('agent.systemPrompt'), '系统提示词');
  assert.equal(t('agent.systemPromptClear'), '清除');
  assert.equal(t('agent.openLink'), '打开链接');
  assert.equal(t('agent.decline'), '拒绝');
});
