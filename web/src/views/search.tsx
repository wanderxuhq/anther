// web/src/views/search.tsx
// 全局搜索视图（Task 17）：关键词 + 大小写 + 排除框 → SSE 流式结果，
// 按文件分组（VS Code 式），点击匹配跳转到文件对应行。
import { createSignal, For, Show } from 'solid-js';
import { searchStream, type SearchFile } from '../api.ts';
import { gotoLine0 } from '../stores.ts';
import { splitByQuery } from './search-util.ts';

const DEFAULT_EXCLUDE = '.git,node_modules,dist';

export function SearchView() {
  const [query, setQuery] = createSignal('');
  const [caseSensitive, setCaseSensitive] = createSignal(false);
  const [exclude, setExclude] = createSignal(DEFAULT_EXCLUDE);
  const [files, setFiles] = createSignal<SearchFile[]>([]);
  const [expanded, setExpanded] = createSignal<Set<string>>(new Set());
  const [searching, setSearching] = createSignal(false);
  const [truncated, setTruncated] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [status, setStatus] = createSignal<{ fileCount: number; matchCount: number } | null>(null);

  let seq = 0; // 序号 guard：只接受当前搜索的过期回调（与 loadDoc 同款）
  let cancelCurrent: (() => void) | undefined;
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;

  function scheduleSearch() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(runSearch, 300);
  }

  function runSearch() {
    const q = query().trim();
    const mySeq = ++seq;
    cancelCurrent?.(); // 取消旧流：服务端收到断开即停
    setError(null);
    setTruncated(false);
    setStatus(null);
    if (!q) {
      setFiles([]);
      setSearching(false);
      return;
    }
    setFiles([]);
    setSearching(true);
    cancelCurrent = searchStream(
      { q, caseSensitive: caseSensitive(), exclude: exclude() },
      {
        onFile: (f) => { if (mySeq === seq) setFiles((prev) => [...prev, f]); },
        onDone: (d) => {
          if (mySeq !== seq) return;
          setSearching(false);
          setTruncated(d.truncated);
          setStatus({ fileCount: d.fileCount, matchCount: d.matchCount });
        },
        onError: (m) => { if (mySeq === seq) { setSearching(false); setError(m); } },
      },
    ).cancel;
  }

  // 桌面端自动聚焦输入框；移动端（粗指针）不弹键盘，由用户点输入框
  const inputEl = (el: HTMLInputElement | undefined) => {
    if (el && !window.matchMedia('(pointer: coarse)').matches) el.focus();
  };

  function toggleGroup(path: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path); else next.add(path);
      return next;
    });
  }

  return (
    <div class="search-view">
      <Show when={error()}>
        <div class="error-banner">{error()}</div>
      </Show>
      <div class="search-inputs">
        <input
          ref={inputEl}
          class="search-query"
          type="search"
          placeholder="搜索文件内容"
          value={query()}
          onInput={(e) => { setQuery(e.currentTarget.value); scheduleSearch(); }}
        />
        <div class="search-options">
          <label class="search-toggle">
            <input
              type="checkbox"
              checked={caseSensitive()}
              onChange={(e) => { setCaseSensitive(e.currentTarget.checked); runSearch(); }}
            />
            Aa 大小写
          </label>
          <input
            class="search-exclude"
            type="text"
            placeholder="排除目录（逗号分隔）"
            value={exclude()}
            onInput={(e) => { setExclude(e.currentTarget.value); scheduleSearch(); }}
          />
        </div>
      </div>
      <div class="search-status">
        <Show when={searching()}>
          搜索中…（<button class="link-btn" onClick={() => { ++seq; cancelCurrent?.(); setSearching(false); }}>取消</button>）
        </Show>
        <Show when={status() && !searching()}>
          {status()!.fileCount} 个文件 / {status()!.matchCount} 处匹配
          <Show when={truncated()}><span class="search-truncated">（结果过多，请细化关键词）</span></Show>
        </Show>
        <Show when={!query().trim() && !searching() && !error()}>
          输入关键词开始搜索
        </Show>
        <Show when={query().trim() && !searching() && !error() && status() && status()!.matchCount === 0}>
          无结果
        </Show>
      </div>
      <div class="search-results">
        <For each={files()}>
          {(f) => (
            <div class="search-group">
              <button class="search-group-head" onClick={() => toggleGroup(f.path)}>
                <span class="tree-arrow">{expanded().has(f.path) ? '▾' : '▸'}</span>
                <span class="search-group-path">{f.path}</span>
                <span class="search-group-count">{f.matches.length}</span>
              </button>
              <Show when={expanded().has(f.path)}>
                <div class="search-group-body">
                  <For each={f.matches}>
                    {(m) => (
                      <button class="search-match" onClick={() => gotoLine0(f.path, m.line - 1)}>
                        <span class="search-match-line">{m.line}</span>
                        <span class="search-match-text">
                          <For each={splitByQuery(m.text, query(), caseSensitive())}>
                            {(part) => part.match ? <mark>{part.text}</mark> : part.text}
                          </For>
                        </span>
                      </button>
                    )}
                  </For>
                </div>
              </Show>
            </div>
          )}
        </For>
      </div>
    </div>
  );
}
