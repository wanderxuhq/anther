// web/src/ro-mode-effect.test.ts
// 回归测试（2026-08-08 铅笔切换无效）：App.tsx 的只读切换 effect 里，
// `editor?.setReadOnly(roMode())` 在 editor 未创建（异步加载中）时被可选链短路，
// 参数 roMode() 不求值 → Solid 依赖追踪未建立 → 之后切换 roMode 信号不触发 effect。
// 修复：先 `const ro = roMode()` 求值建立依赖，再调用。此测试锁定修复后行为。
import { test } from 'node:test';
import assert from 'node:assert/strict';
// 直接导入浏览器版：node 下 'solid-js' 按 exports 解析到 SSR 版（dist/server.js），
// 其 createEffect 不调度运行（SSR 一次性渲染），响应式测试必须用 dist/solid.js。
import { createEffect, createRoot, createSignal } from 'solid-js/dist/solid.js';

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

type FakeEditor = { setReadOnly: (r: boolean) => void };

test('编辑器延迟创建后，✎ 切换必须触发 setReadOnly（依赖在 effect 首次运行即建立）', async () => {
  const applied: boolean[] = [];
  await createRoot(async (dispose) => {
    const [roMode, setRoMode] = createSignal(true);
    let editor: FakeEditor | undefined;

    createEffect(() => {
      const ro = roMode(); // 修复后写法：先求值建立依赖，再经可选链调用
      editor?.setReadOnly(ro);
    });
    await tick(); // effect 首次运行：模拟文件加载未完成，editor 为 undefined

    editor = { setReadOnly: (r) => applied.push(r) }; // 文件加载完成，编辑器创建

    setRoMode(false); // 用户点击 ✎
    await tick();
    assert.deepEqual(applied, [false], '切到编辑模式应调用 setReadOnly(false)');

    setRoMode(true); // 再切回只读
    await tick();
    assert.deepEqual(applied, [false, true], '切回只读应调用 setReadOnly(true)');

    dispose();
  });
});
