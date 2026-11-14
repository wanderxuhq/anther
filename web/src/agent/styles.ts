export const css = `
:host {
  display: flex;
  flex: 1;
  min-width: 0;
  min-height: 0;
  color: inherit;
}
.op-root-host {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
}
.op-app {
  --op-bg: var(--bg, #fff);
  --op-fg: inherit;
  --op-border: var(--border, #e2e2e6);
  --op-muted: var(--muted, #8a8a93);
  --op-accent: var(--accent, #3b82f6);
  --op-hover: var(--row-hover, rgba(59, 130, 246, .1));
  --op-menu-bg: var(--menu-bg, #fff);
  --op-menu-fg: var(--menu-fg, #1f2328);
  --op-menu-border: var(--menu-border, #e2e2e6);
  --op-menu-hover: var(--menu-hover, rgba(0, 0, 0, .05));
  --op-shadow: var(--menu-shadow, 0 12px 32px rgba(0, 0, 0, .16));
  --op-danger: var(--menu-danger, #dc2626);
  --op-success: var(--toast-success, #16a34a);
  --op-error: var(--toast-error, #dc2626);
  --op-radius: 6px;
  --op-radius-lg: 8px;
  flex: 1;
  display: flex;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  position: relative;
  background: var(--op-bg);
  color: var(--op-fg);
  font: 14px/1.5 system-ui, -apple-system, sans-serif;
}
.op-app *, .op-app *::before, .op-app *::after { box-sizing: border-box; }
.op-app button, .op-app input, .op-app textarea, .op-app select { font: inherit; color: inherit; }
.op-app button { cursor: pointer; }
.op-app button:disabled { cursor: default; opacity: .5; }
.op-app :focus-visible { outline: 2px solid var(--op-accent); outline-offset: 2px; }
.op-app button:focus-visible,
.op-app select:focus-visible,
.op-app input:focus-visible,
.op-app textarea:focus-visible { outline: none; }
.op-app button:focus-visible { background: var(--op-hover); }
.op-app .op-send:focus-visible { background: var(--op-accent); filter: brightness(1.08); }
.op-app .op-btn.primary:focus-visible { background: var(--op-accent); color: #fff; }
.op-agent:focus-within, .op-runtime-agent:focus-within { background: var(--op-hover); }

.op-main {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.op-icon-btn {
  width: 32px;
  height: 32px;
  display: inline-grid;
  place-items: center;
  border: 0;
  border-radius: var(--op-radius);
  background: transparent;
  color: var(--op-muted);
  flex: 0 0 auto;
}
.op-icon-btn:hover:not(:disabled) { background: var(--op-hover); color: var(--op-fg); }
.op-icon-btn.active { background: var(--op-hover); color: var(--op-accent); }

.op-resume-backdrop {
  position: absolute;
  inset: 0;
  z-index: 90;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: 64px 16px 16px;
  background: rgba(0, 0, 0, .4);
}
.op-resume-panel {
  width: min(620px, 100%);
  max-height: min(72vh, 640px);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--op-menu-border);
  border-radius: var(--op-radius-lg);
  background: var(--op-menu-bg);
  color: var(--op-menu-fg);
  box-shadow: var(--op-shadow);
}
.op-resume-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 11px 12px 0;
}
.op-resume-heading { display: flex; align-items: baseline; gap: 8px; min-width: 0; }
.op-resume-title { font-size: 13px; font-weight: 650; }
.op-resume-agent { color: var(--op-muted); font-size: 11px; }
.op-resume-search {
  display: flex;
  align-items: center;
  gap: 7px;
  height: 34px;
  margin: 8px 12px 10px;
  padding: 0 9px;
  border: 1px solid var(--op-border);
  border-radius: var(--op-radius);
  background: var(--op-bg);
  color: var(--op-muted);
}
.op-resume-search:focus-within { border-color: var(--op-accent); }
.op-resume-search input {
  flex: 1;
  min-width: 0;
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--op-fg);
  font-size: 13px;
}
.op-resume-list { flex: 1; min-height: 0; overflow-y: auto; padding: 0 8px 8px; }
.op-resume-group {
  position: sticky;
  top: 0;
  z-index: 1;
  padding: 7px 8px 4px;
  background: var(--op-menu-bg);
  color: var(--op-muted);
  font-size: 11px;
  font-weight: 500;
}
.op-session-row {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 9px;
  border: 1px solid transparent;
  border-radius: var(--op-radius);
  background: transparent;
  color: var(--op-menu-fg);
  text-align: left;
}
.op-session-row:hover, .op-session-row.active { background: var(--op-menu-hover); }
.op-session-row.current {
  border-color: color-mix(in srgb, var(--op-accent) 40%, var(--op-border));
  background: color-mix(in srgb, var(--op-accent) 6%, transparent);
}
.op-session-icon {
  width: 30px;
  height: 30px;
  border-radius: var(--op-radius);
  display: grid;
  place-items: center;
  flex: 0 0 auto;
  color: var(--op-accent);
  background: color-mix(in srgb, var(--op-accent) 12%, transparent);
}
.op-session-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.op-session-title { font-size: 13px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.op-session-meta { display: flex; align-items: center; gap: 8px; min-width: 0; color: var(--op-muted); font-size: 11px; }
.op-session-id {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font: 10px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  opacity: .65;
}
.op-resume-empty {
  padding: 42px 16px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  color: var(--op-muted);
  text-align: center;
}
.op-resume-empty strong { color: var(--op-fg); font-size: 14px; }
.op-resume-empty span { font-size: 12px; }
.op-resume-foot {
  flex: 0 0 auto;
  display: flex;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 12px;
  border-top: 1px solid var(--op-menu-border);
  color: var(--op-muted);
  font-size: 10px;
}
.op-skills-panel {
  width: min(760px, 100%);
  max-height: min(82vh, 760px);
}
.op-skills-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 2px 12px 14px;
}
.op-skills-section { padding: 9px 0 14px; }
.op-skills-section + .op-skills-section { border-top: 1px solid var(--op-menu-border); }
.op-skills-section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;
}
.op-skills-section-title {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
  font-size: 12px;
  font-weight: 650;
}
.op-skills-section-title > svg { color: var(--op-accent); flex: 0 0 auto; }
.op-skills-count {
  padding: 0 6px;
  border: 1px solid var(--op-border);
  border-radius: 999px;
  color: var(--op-muted);
  font-size: 10px;
  font-weight: 500;
  line-height: 18px;
  white-space: nowrap;
}
.op-skill-list { display: flex; flex-direction: column; gap: 1px; }
.op-skill-row {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 7px 8px;
  border-radius: var(--op-radius);
}
.op-skill-row:hover { background: var(--op-menu-hover); }
.op-skill-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.op-skill-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  font-weight: 600;
}
.op-skill-desc {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--op-muted);
  font-size: 11.5px;
}
.op-skill-select .op-skill-desc { white-space: normal; line-height: 1.4; overflow-wrap: anywhere; }
.op-skill-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 5px; min-width: 0; }
.op-skill-chip {
  padding: 0 6px;
  border: 1px solid var(--op-border);
  border-radius: 999px;
  background: var(--op-bg);
  color: var(--op-muted);
  font-size: 10px;
  line-height: 17px;
  white-space: nowrap;
}
.op-skill-chip.warn {
  color: #b45309;
  border-color: color-mix(in srgb, #f59e0b 40%, var(--op-border));
  background: color-mix(in srgb, #f59e0b 7%, transparent);
}
.op-skill-source {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--op-muted);
  font: 10px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  opacity: .78;
}
.op-skills-empty {
  padding: 24px 12px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 5px;
  color: var(--op-muted);
  text-align: center;
}
.op-skills-empty strong { color: var(--op-fg); font-size: 13px; }
.op-skills-empty span { font-size: 11px; }
.op-skills-loading {
  padding: 32px 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: var(--op-muted);
  font-size: 12px;
}
.op-source-row { display: flex; align-items: center; gap: 7px; }
.op-source-row .op-input { flex: 1; min-width: 0; }
.op-source-row .op-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  flex: 0 0 auto;
  white-space: nowrap;
}
.op-skills-hint { margin-top: 6px; color: var(--op-muted); font-size: 11px; }
.op-skills-error {
  display: flex;
  align-items: flex-start;
  gap: 7px;
  margin-top: 8px;
  padding: 8px 9px;
  border: 1px solid color-mix(in srgb, var(--op-danger) 30%, var(--op-border));
  border-radius: var(--op-radius);
  background: color-mix(in srgb, var(--op-danger) 6%, transparent);
  color: var(--op-danger);
  font-size: 11.5px;
  line-height: 1.4;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.op-skills-error svg { flex: 0 0 auto; margin-top: 1px; }
.op-skill-preview {
  margin-top: 10px;
  border: 1px solid var(--op-border);
  border-radius: var(--op-radius);
  overflow: hidden;
}
.op-skill-preview-head {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--op-border);
  background: color-mix(in srgb, var(--op-muted) 5%, transparent);
}
.op-skill-preview-head .op-skill-source { flex: 1; }
.op-skill-preview-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 7px 10px 0;
}
.op-skill-preview-actions .op-skills-hint { margin-top: 0; }
.op-link {
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--op-accent);
  font-size: 11px;
}
.op-link:hover { text-decoration: underline; }
.op-skill-select-list {
  max-height: 280px;
  overflow-y: auto;
  padding: 6px;
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.op-skill-select {
  display: flex;
  align-items: flex-start;
  gap: 9px;
  padding: 7px 8px;
  border-radius: var(--op-radius);
  cursor: pointer;
}
.op-skill-select:hover { background: var(--op-menu-hover); }
.op-skill-select input { margin-top: 3px; flex: 0 0 auto; accent-color: var(--op-accent); }
.op-skill-path {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--op-muted);
  font: 10px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  opacity: .72;
}
.op-skill-targets {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 2px 10px 8px;
  border-top: 1px solid var(--op-border);
}
.op-skill-targets .op-field-label { padding-top: 8px; }
.op-skill-target-list { display: flex; flex-wrap: wrap; gap: 8px 18px; }
.op-skill-target { align-items: flex-start; gap: 7px; }
.op-skill-target-main { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.op-skill-target-main code {
  color: var(--op-muted);
  font: 10px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
.op-skill-preview-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 10px;
  border-top: 1px solid var(--op-border);
}
.op-skill-preview-foot .op-skills-hint { margin-top: 0; }
.op-skill-preview-foot .op-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex: 0 0 auto;
}
.op-skills-warnings {
  margin-top: 8px;
  padding: 8px 9px;
  border: 1px solid color-mix(in srgb, #f59e0b 30%, var(--op-border));
  border-radius: var(--op-radius);
  background: color-mix(in srgb, #f59e0b 6%, transparent);
  font-size: 11px;
}
.op-skills-warnings-title { margin-bottom: 4px; font-weight: 600; color: #b45309; }
.op-skills-warning { display: flex; align-items: flex-start; gap: 6px; line-height: 1.4; color: var(--op-muted); overflow-wrap: anywhere; }
.op-skills-warning code {
  flex: 0 0 auto;
  color: #b45309;
  font: 10px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
.op-skill-result {
  margin-top: 8px;
  border: 1px solid var(--op-border);
  border-radius: var(--op-radius);
  overflow: hidden;
}
.op-skill-result-title {
  padding: 7px 9px;
  border-bottom: 1px solid var(--op-border);
  color: var(--op-muted);
  font-size: 11px;
  font-weight: 600;
}
.op-skill-result-row {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 5px 9px;
  font-size: 11px;
}
.op-skill-result-row + .op-skill-result-row {
  border-top: 1px solid color-mix(in srgb, var(--op-border) 60%, transparent);
}
.op-skill-result-row svg { flex: 0 0 auto; color: var(--op-success); }
.op-skill-result-row.warn svg { color: #b45309; }
.op-skill-result-row.error svg { color: var(--op-danger); }
.op-skill-result-row.error span:last-child { overflow-wrap: anywhere; }
.op-skill-result-row code {
  margin-left: auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--op-muted);
  font: 10px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
.op-skills-body::-webkit-scrollbar, .op-skill-select-list::-webkit-scrollbar { width: 6px; height: 6px; }
.op-skills-body::-webkit-scrollbar-thumb, .op-skill-select-list::-webkit-scrollbar-thumb {
  background: color-mix(in srgb, var(--op-muted) 38%, transparent);
  border-radius: 4px;
}
.op-auth {
  flex: 0 0 auto;
  margin: 10px 24px 0;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  border: 1px solid color-mix(in srgb, var(--op-accent) 28%, var(--op-border));
  border-radius: var(--op-radius-lg);
  background: color-mix(in srgb, var(--op-accent) 5%, transparent);
}
.op-auth-head { display: flex; align-items: flex-start; gap: 9px; }
.op-auth-icon {
  width: 30px;
  height: 30px;
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  border-radius: var(--op-radius);
  color: var(--op-accent);
  background: color-mix(in srgb, var(--op-accent) 12%, transparent);
}
.op-auth-copy { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.op-auth-copy strong { font-size: 13px; font-weight: 650; }
.op-auth-copy span { color: var(--op-muted); font-size: 11.5px; line-height: 1.4; }
.op-auth-actions { display: flex; flex-wrap: wrap; gap: 7px; }
.op-auth-actions .op-btn { display: inline-flex; align-items: center; gap: 6px; }
.op-auth-hint { color: color-mix(in srgb, currentColor 65%, transparent); font-size: 10px; }
.op-auth-empty { color: var(--op-muted); font-size: 11.5px; }
.op-chatbar {
  flex: 0 0 auto;
  min-height: 40px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 24px;
  border-bottom: 1px solid var(--op-border);
}
.op-chatbar-sessions {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 30px;
  padding: 0 7px;
  border: 1px solid transparent;
  border-radius: var(--op-radius);
  background: transparent;
  color: var(--op-muted);
  font-size: 13px;
}
.op-chatbar-sessions:hover { background: var(--op-hover); color: var(--op-fg); }
.op-chatbar-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--op-fg);
  font-size: 14px;
}
.op-chatbar-working { display: inline-flex; align-items: center; gap: 5px; color: var(--op-muted); font-size: 11px; }
.op-plan {
  margin: 10px 0;
  padding: 10px 12px;
  border: 1px solid var(--op-border);
  border-radius: var(--op-radius-lg);
  background: color-mix(in srgb, var(--op-muted) 4%, transparent);
}
.op-plan-head {
  display: flex;
  align-items: center;
  gap: 7px;
  margin-bottom: 7px;
  font-size: 12px;
  font-weight: 650;
}
.op-plan-head > svg { color: var(--op-accent); flex: 0 0 auto; }
.op-plan-progress { margin-left: auto; color: var(--op-muted); font-size: 10px; font-weight: 500; }
.op-plan-list { display: flex; flex-direction: column; gap: 1px; }
.op-plan-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 4px 2px;
  font-size: 12px;
  line-height: 1.4;
}
.op-plan-status {
  width: 16px;
  height: 16px;
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  color: var(--op-muted);
}
.op-plan-row.completed .op-plan-status { color: var(--op-success); }
.op-plan-row.in_progress .op-plan-status { color: var(--op-accent); }
.op-plan-dot {
  width: 7px;
  height: 7px;
  display: block;
  border: 1.5px solid var(--op-muted);
  border-radius: 50%;
}
.op-plan-content { flex: 1; min-width: 0; overflow-wrap: anywhere; }
.op-plan-row.completed .op-plan-content { color: var(--op-muted); text-decoration: line-through; }
.op-plan-row.in_progress .op-plan-content { font-weight: 550; }
.op-plan-priority {
  width: 6px;
  height: 6px;
  margin-top: 5px;
  flex: 0 0 auto;
  border-radius: 50%;
}
.op-plan-priority.high { background: var(--op-danger); }
.op-plan-priority.medium { background: #f59e0b; }
.op-plan-priority.low { background: var(--op-muted); }
.op-message-wrap { flex: 1; min-height: 0; position: relative; display: flex; }
.op-messages {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 22px 24px 12px;
  display: flex;
  flex-direction: column;
  gap: 18px;
  scroll-behavior: smooth;
}
.op-message { width: 100%; max-width: 920px; margin: 0 auto; min-width: 0; }
.op-user { display: flex; flex-direction: column; align-items: flex-end; gap: 4px; }
.op-user-bubble {
  max-width: min(78%, 680px);
  padding: 9px 13px;
  border-radius: 10px 10px 3px 10px;
  background: var(--op-accent);
  color: #fff;
  white-space: pre-wrap;
  word-break: break-word;
  line-height: 1.55;
}
.op-rich-list { display: flex; flex-direction: column; gap: 7px; margin-top: 8px; }
.op-user-bubble .op-rich-list { margin-top: 9px; }
.op-user-bubble .op-rich-file,
.op-user-bubble .op-rich-resource {
  border-color: rgba(255, 255, 255, .28);
  background: rgba(255, 255, 255, .12);
  color: #fff;
}
.op-user-bubble .op-rich-file > svg,
.op-user-bubble .op-rich-resource summary > svg { color: rgba(255, 255, 255, .8); }
.op-user-bubble .op-rich-file-uri,
.op-user-bubble .op-rich-file-size { color: rgba(255, 255, 255, .68); }
.op-user-bubble .op-rich-text {
  border-color: rgba(255, 255, 255, .22);
  background: rgba(0, 0, 0, .12);
  color: #fff;
}
.op-rich-image {
  display: block;
  align-self: flex-start;
  width: auto;
  height: auto;
  max-width: min(100%, 640px);
  max-height: 420px;
  object-fit: contain;
  border: 1px solid var(--op-border);
  border-radius: var(--op-radius);
  background: color-mix(in srgb, var(--op-muted) 6%, transparent);
}
.op-rich-audio { display: block; align-self: flex-start; width: min(480px, 100%); height: 36px; }
.op-rich-file {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
  padding: 6px 8px;
  border: 1px solid var(--op-border);
  border-radius: var(--op-radius);
  background: color-mix(in srgb, var(--op-muted) 4%, transparent);
  color: var(--op-fg);
}
.op-rich-file > svg { flex: 0 0 auto; color: var(--op-muted); }
.op-rich-file-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.op-rich-file-name { font-size: 11.5px; font-weight: 550; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.op-rich-file-uri {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--op-muted);
  font: 10px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
.op-rich-file-size { flex: 0 0 auto; color: var(--op-muted); font-size: 10px; }
.op-rich-resource {
  border: 1px solid var(--op-border);
  border-radius: var(--op-radius);
  background: color-mix(in srgb, var(--op-muted) 4%, transparent);
  overflow: hidden;
}
.op-rich-resource summary {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  cursor: pointer;
  color: var(--op-fg);
  font-size: 11.5px;
  list-style: none;
}
.op-rich-resource summary::-webkit-details-marker { display: none; }
.op-rich-resource summary > svg { flex: 0 0 auto; color: var(--op-muted); }
.op-rich-text {
  margin: 0;
  max-height: 300px;
  overflow: auto;
  padding: 8px;
  border-top: 1px solid var(--op-border);
  font: 11px/1.45 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.op-message-foot {
  display: flex;
  align-items: center;
  gap: 4px;
  color: var(--op-muted);
  font-size: 11px;
}
.op-message-foot .op-icon-btn { width: 22px; height: 22px; }
.op-system {
  align-self: center;
  display: flex;
  align-items: center;
  gap: 6px;
  max-width: 720px;
  padding: 3px 9px;
  border-radius: 999px;
  color: var(--op-muted);
  font-size: 11px;
  background: color-mix(in srgb, var(--op-fg) 4%, transparent);
}
.op-system.error { color: var(--op-error); background: color-mix(in srgb, var(--op-error) 8%, transparent); }
.op-system.retry { color: #b45309; background: color-mix(in srgb, #f59e0b 10%, transparent); }
.op-system.compaction { color: var(--op-accent); background: color-mix(in srgb, var(--op-accent) 8%, transparent); }
.op-assistant { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.op-message-head {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
  color: var(--op-muted);
  font-size: 11px;
}
.op-avatar {
  width: 25px;
  height: 25px;
  border-radius: var(--op-radius);
  display: grid;
  place-items: center;
  color: var(--op-accent);
  background: color-mix(in srgb, var(--op-accent) 10%, transparent);
  flex: 0 0 auto;
}
.op-assistant-name { font-weight: 650; color: var(--op-fg); font-size: 12px; }
.op-assistant-model { max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.op-message-spacer { flex: 1; }
.op-usage { display: inline-flex; gap: 5px; white-space: nowrap; }
.op-message-head .op-icon-btn { width: 24px; height: 24px; }
.op-markdown { min-width: 0; word-break: break-word; line-height: 1.65; }
.op-markdown > :first-child { margin-top: 0; }
.op-markdown > :last-child { margin-bottom: 0; }
.op-markdown p { margin: 0 0 .7em; }
.op-markdown h1, .op-markdown h2, .op-markdown h3, .op-markdown h4 {
  margin: 1.1em 0 .45em;
  line-height: 1.3;
  font-weight: 650;
}
.op-markdown h1 { font-size: 1.35em; }
.op-markdown h2 { font-size: 1.2em; }
.op-markdown h3 { font-size: 1.08em; }
.op-markdown ul, .op-markdown ol { margin: .4em 0 .8em; padding-left: 1.35em; }
.op-markdown li { margin: .18em 0; }
.op-markdown blockquote {
  margin: .6em 0;
  padding: .1em 0 .1em .9em;
  border-left: 3px solid var(--op-border);
  color: var(--op-muted);
}
.op-markdown a { color: var(--op-accent); text-decoration: none; }
.op-markdown a:hover { text-decoration: underline; }
.op-markdown code {
  padding: .12em .35em;
  border-radius: 4px;
  background: color-mix(in srgb, var(--op-fg) 7%, transparent);
  font: .88em ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
.op-markdown pre, .md-pre, .op-tool-input, .op-tool-output, .op-diff {
  margin: .6em 0;
  padding: 11px 12px;
  border: 1px solid var(--op-border);
  border-radius: var(--op-radius);
  background: color-mix(in srgb, var(--op-fg) 4%, var(--op-bg));
  overflow: auto;
  max-height: 420px;
  font: 12px/1.55 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  tab-size: 2;
}
.op-markdown pre code { padding: 0; background: transparent; font: inherit; }
.md-pre { position: relative; }
.op-markdown pre.md-pre { padding-top: 30px; }
.md-code-lang {
  position: absolute;
  top: 7px;
  left: 10px;
  color: var(--op-muted);
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: .05em;
}
.md-code-copy {
  position: absolute;
  top: 5px;
  right: 6px;
  height: 20px;
  padding: 0 6px;
  border: 1px solid var(--op-border);
  border-radius: 5px;
  background: var(--op-bg);
  color: var(--op-muted);
  font-size: 10px;
}
.md-code-copy:hover { color: var(--op-accent); border-color: var(--op-accent); }
.op-markdown table { border-collapse: collapse; margin: .7em 0; max-width: 100%; display: block; overflow: auto; }
.op-markdown th, .op-markdown td { border: 1px solid var(--op-border); padding: 5px 9px; text-align: left; }
.op-markdown th { background: color-mix(in srgb, var(--op-fg) 5%, transparent); }
.op-markdown hr { border: 0; border-top: 1px solid var(--op-border); margin: 1em 0; }
.op-markdown img { max-width: 100%; border-radius: 6px; }

.op-reasoning {
  border: 1px solid var(--op-border);
  border-radius: var(--op-radius);
  background: color-mix(in srgb, var(--op-fg) 2.5%, transparent);
  overflow: hidden;
}
.op-reasoning summary {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 9px;
  color: var(--op-muted);
  font-size: 11px;
  cursor: pointer;
  list-style: none;
}
.op-reasoning summary::-webkit-details-marker { display: none; }
.op-reasoning-chevron { margin-left: auto; transition: transform .15s; }
.op-reasoning[open] .op-reasoning-chevron { transform: rotate(90deg); }
.op-reasoning-body {
  padding: 0 10px 9px;
  color: var(--op-muted);
  font-size: 12px;
  line-height: 1.6;
  white-space: pre-wrap;
  max-height: 260px;
  overflow: auto;
}

.op-tools { display: flex; flex-direction: column; gap: 6px; }
.op-tool {
  border: 1px solid var(--op-border);
  border-radius: var(--op-radius);
  background: color-mix(in srgb, var(--op-fg) 2%, transparent);
  overflow: hidden;
}
.op-tool.error { border-color: color-mix(in srgb, var(--op-danger) 38%, var(--op-border)); }
.op-tool-head {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 7px 9px;
  cursor: pointer;
  list-style: none;
  min-width: 0;
  font-size: 12px;
}
.op-tool-head::-webkit-details-marker { display: none; }
.op-tool-status { display: inline-flex; color: var(--op-muted); flex: 0 0 auto; }
.op-tool.completed .op-tool-status { color: var(--op-success); }
.op-tool.error .op-tool-status { color: var(--op-error); }
.op-tool-name { font-weight: 600; white-space: nowrap; }
.op-tool-summary {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--op-muted);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 11px;
}
.op-tool-spacer { flex: 1; }
.op-tool-duration { color: var(--op-muted); font-size: 10px; white-space: nowrap; }
.op-tool-chevron { color: var(--op-muted); transition: transform .15s; flex: 0 0 auto; }
.op-tool[open] .op-tool-chevron { transform: rotate(90deg); }
.op-tool-body { border-top: 1px solid var(--op-border); padding: 9px; display: flex; flex-direction: column; gap: 9px; }
.op-tool-section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  color: var(--op-muted);
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: .06em;
}
.op-tool-section-head .op-icon-btn { width: 22px; height: 22px; }
.op-tool-input, .op-tool-output { margin: 3px 0 0; max-height: 320px; }
.op-diff { display: block; padding: 0; }
.op-diff-line { display: block; padding: 0 10px; white-space: pre; }
.op-diff-line.add { background: var(--diff-add-bg, rgba(34, 197, 94, .13)); color: var(--diff-status-add, #15803d); }
.op-diff-line.del { background: var(--diff-del-bg, rgba(239, 68, 68, .12)); color: var(--diff-status-del, #b91c1c); }
.op-diff-line.meta { color: var(--op-muted); background: color-mix(in srgb, var(--op-fg) 4%, transparent); }
.op-tool-terminals { display: flex; flex-direction: column; gap: 6px; margin-top: 8px; }
.op-tool-terminal {
  overflow: hidden;
  border: 1px solid var(--op-border);
  border-radius: var(--op-radius);
  background: color-mix(in srgb, var(--op-muted) 4%, transparent);
}
.op-tool-terminal-head {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 8px;
  border-bottom: 1px solid var(--op-border);
  color: var(--op-muted);
  font-size: 10px;
}
.op-tool-terminal-head > svg { flex: 0 0 auto; }
.op-tool-terminal-hint { color: var(--op-muted); font: 10px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
.op-tool-terminal-output {
  margin: 0;
  max-height: 260px;
  overflow: auto;
  padding: 8px;
  background: color-mix(in srgb, var(--op-bg) 88%, var(--op-muted));
  color: var(--op-fg);
  font: 11px/1.45 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.op-tool-files { display: flex; flex-wrap: wrap; gap: 5px; }
.op-file-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 100%;
  padding: 2px 6px;
  border: 1px solid var(--op-border);
  border-radius: 5px;
  color: var(--op-muted);
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.op-tool-error, .op-message-error {
  color: var(--op-error);
  background: color-mix(in srgb, var(--op-error) 8%, transparent);
  border: 1px solid color-mix(in srgb, var(--op-error) 25%, transparent);
  border-radius: var(--op-radius);
  padding: 7px 9px;
  font-size: 12px;
  white-space: pre-wrap;
  word-break: break-word;
}
.op-message-error { display: flex; gap: 7px; align-items: flex-start; }
.op-message-error > div { min-width: 0; }
.op-link-btn {
  display: inline;
  border: 0;
  padding: 0;
  margin-top: 4px;
  background: transparent;
  color: var(--op-accent);
  font-size: 12px;
  text-decoration: underline;
}
.op-message-empty { color: var(--op-muted); font-size: 12px; font-style: italic; }
.op-typing {
  display: flex;
  align-items: center;
  gap: 6px;
  max-width: 920px;
  margin: 0 auto;
  color: var(--op-muted);
  font-size: 11px;
}

.op-permission, .op-form {
  width: 100%;
  max-width: 920px;
  margin: 0 auto;
  border: 1px solid var(--op-border);
  border-radius: var(--op-radius-lg);
  background: var(--op-bg);
  padding: 11px 12px;
  display: flex;
  flex-direction: column;
  gap: 9px;
}
.op-form { border-color: var(--op-border); background: var(--op-bg); }
.op-permission-head, .op-form-head { display: flex; align-items: flex-start; gap: 8px; }
.op-permission-icon, .op-form-icon {
  width: 28px;
  height: 28px;
  border-radius: var(--op-radius);
  display: grid;
  place-items: center;
  color: #b45309;
  background: color-mix(in srgb, #f59e0b 14%, transparent);
  flex: 0 0 auto;
}
.op-form-icon { color: var(--op-accent); background: color-mix(in srgb, var(--op-accent) 12%, transparent); }
.op-permission-title, .op-form-title { font-weight: 650; font-size: 13px; }
.op-permission-action { color: var(--op-muted); font-size: 12px; }
.op-form-subtitle { color: var(--op-muted); font-size: 11px; white-space: pre-wrap; }
.op-form-error { color: var(--op-error); font-size: 11px; }
.op-permission-message { color: var(--op-muted); font-size: 12px; white-space: pre-wrap; }
.op-permission-resources { display: flex; flex-wrap: wrap; gap: 5px; }
.op-permission-resources code {
  padding: 1px 5px;
  border: 1px solid var(--op-border);
  border-radius: 4px;
  background: var(--op-bg);
  font: 11px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
.op-permission-actions, .op-form-actions { display: flex; flex-wrap: wrap; gap: 6px; }
.op-btn {
  height: 32px;
  padding: 0 11px;
  border: 1px solid var(--op-border);
  border-radius: var(--op-radius);
  background: var(--op-bg);
  color: var(--op-fg);
  font-size: 12px;
  font-weight: 520;
}
.op-btn:hover:not(:disabled) { border-color: var(--op-accent); color: var(--op-accent); }
.op-btn.primary { background: var(--op-accent); border-color: var(--op-accent); color: #fff; }
.op-btn.primary:hover:not(:disabled) { filter: brightness(1.06); color: #fff; }
.op-btn.danger { color: var(--op-danger); border-color: color-mix(in srgb, var(--op-danger) 38%, var(--op-border)); }
.op-btn.danger:hover:not(:disabled) { background: color-mix(in srgb, var(--op-danger) 8%, transparent); color: var(--op-danger); }
.op-field { display: flex; flex-direction: column; gap: 3px; }
.op-field-label { font-size: 12px; font-weight: 550; }
.op-required { color: var(--op-danger); margin-left: 2px; }
.op-field-desc { color: var(--op-muted); font-size: 11px; }
.op-input {
  height: 34px;
  padding: 0 9px;
  border: 1px solid var(--op-border);
  border-radius: var(--op-radius);
  background: var(--op-bg);
  color: var(--op-fg);
  outline: none;
}
.op-input:focus { border-color: var(--op-accent); }
.op-multiselect { display: flex; flex-wrap: wrap; gap: 6px 12px; }
.op-check { display: inline-flex; align-items: center; gap: 5px; font-size: 12px; color: var(--op-fg); }
.op-check input { accent-color: var(--op-accent); }
.op-external { color: var(--op-accent); font-size: 12px; text-decoration: underline; text-underline-offset: 2px; }

.op-composer {
  flex: 0 0 auto;
  position: relative;
  padding: 10px 24px 14px;
  background: var(--op-bg);
}
.op-file-input { display: none; }
.op-attachments { display: flex; flex-wrap: wrap; gap: 6px; padding: 9px 10px 0; }
.op-attachment {
  display: flex;
  align-items: center;
  gap: 6px;
  max-width: 230px;
  min-width: 0;
  padding: 4px 5px 4px 4px;
  border: 1px solid var(--op-border);
  border-radius: var(--op-radius);
  background: color-mix(in srgb, var(--op-muted) 5%, transparent);
}
.op-attachment-thumb { width: 26px; height: 26px; object-fit: cover; border-radius: 4px; flex: 0 0 auto; }
.op-attachment-icon {
  width: 26px;
  height: 26px;
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  border-radius: 4px;
  color: var(--op-muted);
  background: color-mix(in srgb, var(--op-muted) 10%, transparent);
}
.op-attachment-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
}
.op-attachment-remove {
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  padding: 1px;
  border: 0;
  background: transparent;
  color: var(--op-muted);
}
.op-attachment-remove:hover { color: var(--op-danger); }
.op-composer-box {
  max-width: 920px;
  margin: 0 auto;
  border: 1px solid var(--op-border);
  border-radius: var(--op-radius-lg);
  background: var(--op-bg);
}
.op-composer-box:focus-within { border-color: var(--op-accent); }
.op-textarea {
  display: block;
  width: 100%;
  min-height: 44px;
  max-height: 220px;
  resize: none;
  border: 0;
  outline: 0;
  padding: 11px 12px 4px;
  background: transparent;
  color: var(--op-fg);
  line-height: 1.55;
  font-size: 14px;
  overflow-y: auto;
}
.op-composer-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 7px 7px;
}
.op-composer-tools { display: flex; align-items: center; gap: 3px; min-width: 0; flex: 1; }
.op-composer-actions { display: flex; align-items: center; gap: 4px; flex: 0 0 auto; }
.op-model-picker { position: relative; min-width: 0; }
.op-model-button {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  max-width: 260px;
  height: 30px;
  padding: 0 7px;
  border: 1px solid transparent;
  border-radius: var(--op-radius);
  background: transparent;
  color: var(--op-muted);
  font-size: 12px;
}
.op-model-button:hover { background: var(--op-hover); color: var(--op-fg); }
.op-ellipsis { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.op-agent {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 30px;
  padding: 0 6px;
  border-radius: var(--op-radius);
  color: var(--op-muted);
  font-size: 12px;
  max-width: 160px;
}
.op-agent:hover { background: var(--op-hover); }
.op-runtime-agent {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 30px;
  padding: 0 6px;
  border: 1px solid transparent;
  border-radius: var(--op-radius);
  color: var(--op-muted);
  font-size: 12px;
  max-width: 170px;
}
.op-runtime-agent:hover { background: var(--op-hover); }
.op-runtime-agent select {
  appearance: none;
  border: 0;
  outline: 0;
  background: transparent;
  color: inherit;
  font-size: 12px;
  max-width: 120px;
}
.op-runtime-agent select:disabled { cursor: default; opacity: .55; }
.op-fatal-agent {
  margin-top: 6px;
  color: var(--op-fg);
  border-color: var(--op-border);
  background: var(--op-bg);
}
.op-agent select {
  appearance: none;
  border: 0;
  outline: 0;
  background: transparent;
  color: inherit;
  max-width: 112px;
  padding: 0;
  font-size: 12px;
  cursor: pointer;
}
.op-send {
  width: 32px;
  height: 32px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: var(--op-radius);
  background: var(--op-accent);
  color: #fff;
}
.op-send:hover:not(:disabled) { filter: brightness(1.08); }
.op-send:disabled { background: color-mix(in srgb, var(--op-fg) 12%, transparent); color: var(--op-muted); opacity: 1; }
.op-send-stop { background: color-mix(in srgb, var(--op-danger) 14%, transparent); color: var(--op-danger); }
.op-send-stop .op-stop-square { width: 10px; height: 10px; }
.op-composer-hint {
  max-width: 920px;
  margin: 5px auto 0;
  display: flex;
  justify-content: space-between;
  gap: 10px;
  padding: 0 4px;
  color: var(--op-muted);
  font-size: 12px;
}

.op-config-picker { position: relative; min-width: 0; }
.op-config-button { max-width: 150px; }
.op-popover.op-config-popover { left: 0; bottom: calc(100% + 8px); width: min(360px, calc(100vw - 32px)); }
.op-config-head {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--op-menu-border);
  color: var(--op-muted);
  font-size: 11px;
  font-weight: 600;
}
.op-config-head > svg { color: var(--op-accent); }
.op-config-list { max-height: 340px; overflow-y: auto; padding: 4px; }
.op-config-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px;
  border-radius: var(--op-radius);
}
.op-config-row:hover { background: var(--op-menu-hover); }
.op-config-copy { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.op-config-name { font-size: 12px; font-weight: 550; }
.op-config-desc { color: var(--op-muted); font-size: 10.5px; line-height: 1.35; }
.op-config-select {
  max-width: 140px;
  height: 28px;
  padding: 0 5px;
  border: 1px solid var(--op-border);
  border-radius: var(--op-radius);
  background: var(--op-bg);
  color: var(--op-fg);
  font-size: 11px;
}
.op-config-check { width: 16px; height: 16px; accent-color: var(--op-accent); }
.op-popover, .op-command-menu {
  position: absolute;
  z-index: 50;
  width: min(380px, calc(100vw - 32px));
  border: 1px solid var(--op-menu-border);
  border-radius: var(--op-radius-lg);
  background: var(--op-menu-bg);
  color: var(--op-menu-fg);
  box-shadow: var(--op-shadow);
  overflow: hidden;
}
.op-model-popover { left: 0; bottom: calc(100% + 8px); }
.op-popover-head {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--op-menu-border);
  color: var(--op-muted);
}
.op-popover-head input {
  flex: 1;
  min-width: 0;
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--op-menu-fg);
  font-size: 12px;
}
.op-popover-list { max-height: 340px; overflow-y: auto; padding: 4px; }
.op-popover-empty { padding: 18px; text-align: center; color: var(--op-muted); font-size: 12px; }
.op-model-group { padding: 3px 0; }
.op-model-group-label {
  padding: 4px 8px;
  color: var(--op-muted);
  font-size: 11px;
  font-weight: 500;
}
.op-model-option {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border: 0;
  border-radius: 5px;
  background: transparent;
  text-align: left;
}
.op-model-option:hover { background: var(--op-menu-hover); }
.op-model-option.active { background: var(--op-hover); color: var(--op-accent); }
.op-model-option-main { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.op-model-option-id { color: var(--op-muted); font-size: 10px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.op-command-menu { left: 24px; bottom: calc(100% + 6px); }
.op-command-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 7px 9px;
  border-bottom: 1px solid var(--op-menu-border);
  color: var(--op-muted);
  font-size: 11px;
  font-weight: 500;
}
.op-command-list { max-height: 260px; overflow-y: auto; padding: 4px; }
.op-command-option {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 1px;
  padding: 6px 8px;
  border: 0;
  border-radius: 5px;
  background: transparent;
  text-align: left;
}
.op-command-option:hover { background: var(--op-menu-hover); }
.op-command-name { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; color: var(--op-accent); }
.op-command-desc { color: var(--op-muted); font-size: 11px; }

.op-empty {
  margin: auto;
  padding: 32px 16px;
  max-width: 580px;
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 9px;
}
.op-empty-mark {
  width: 32px;
  height: 32px;
  display: grid;
  place-items: center;
  color: var(--op-muted);
  margin-bottom: 3px;
}
.op-empty h2 { margin: 0; font-size: 18px; letter-spacing: -.01em; }
.op-empty p { margin: 0; max-width: 430px; color: var(--op-muted); font-size: 13px; }
.op-suggestions {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 7px;
  width: 100%;
  margin-top: 12px;
}
.op-suggestion {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
  padding: 8px 10px;
  border: 1px solid var(--op-border);
  border-radius: var(--op-radius);
  background: var(--op-bg);
  text-align: left;
  color: var(--op-muted);
  font-size: 12px;
}
.op-suggestion:hover { border-color: var(--op-border); color: var(--op-fg); background: var(--op-hover); }
.op-suggestion span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.op-jump {
  position: absolute;
  right: 20px;
  bottom: 12px;
  width: 30px;
  height: 30px;
  display: grid;
  place-items: center;
  border: 1px solid var(--op-border);
  border-radius: 50%;
  background: var(--op-bg);
  color: var(--op-muted);
  box-shadow: var(--op-shadow);
}
.op-loading, .op-fatal {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  color: var(--op-muted);
  padding: 24px;
  text-align: center;
}
.op-fatal h2 { margin: 0; color: var(--op-fg); font-size: 18px; }
.op-fatal p { margin: 0; max-width: 520px; font-size: 13px; }
.op-fatal-hint { color: var(--op-muted); font-size: 12px; }
.op-fatal-hint code { font-family: ui-monospace, Menlo, Consolas, monospace; background: color-mix(in srgb, var(--op-fg) 6%, transparent); padding: 1px 4px; border-radius: 4px; }
.op-fatal-icon {
  width: 46px;
  height: 46px;
  border-radius: var(--op-radius-lg);
  display: grid;
  place-items: center;
  color: var(--op-error);
  background: var(--op-hover);
}
.op-error-banner {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 7px;
  margin: 8px 24px 0;
  padding: 7px 9px;
  border: 1px solid color-mix(in srgb, var(--op-error) 28%, var(--op-border));
  border-radius: var(--op-radius);
  background: color-mix(in srgb, var(--op-error) 7%, transparent);
  color: var(--op-error);
  font-size: 12px;
}
.op-error-banner span { flex: 1; min-width: 0; }
.op-pending {
  flex: 0 0 auto;
  max-height: 42vh;
  overflow-y: auto;
  padding: 8px 24px 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.op-toast {
  position: absolute;
  left: 50%;
  bottom: 92px;
  transform: translateX(-50%);
  z-index: 80;
  max-width: min(520px, calc(100vw - 32px));
  padding: 10px 16px;
  border-radius: var(--op-radius-lg);
  background: var(--toast-bg, #2c2c31);
  color: var(--toast-fg, #f4f4f6);
  font-size: 13px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.op-toast.error { background: var(--op-error); }

.op-modal-backdrop {
  position: absolute;
  inset: 0;
  z-index: 100;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  background: rgba(0, 0, 0, .4);
}
.op-modal {
  width: min(400px, 100%);
  border: 1px solid var(--op-border);
  border-radius: var(--op-radius-lg);
  background: var(--op-bg);
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 9px;
}
.op-modal-title { font-size: 15px; font-weight: 650; }
.op-modal-message { color: var(--op-muted); font-size: 13px; }
.op-modal-actions { display: flex; justify-content: flex-end; gap: 7px; margin-top: 5px; }

.op-spinner {
  display: inline-block;
  border: 2px solid color-mix(in srgb, currentColor 22%, transparent);
  border-top-color: currentColor;
  border-radius: 50%;
  animation: op-spin .7s linear infinite;
  flex: 0 0 auto;
}
@keyframes op-spin { to { transform: rotate(360deg); } }
@keyframes op-pulse { 0%, 100% { opacity: 1; } 50% { opacity: .35; } }


.op-messages::-webkit-scrollbar, .op-popover-list::-webkit-scrollbar, .op-tool-input::-webkit-scrollbar, .op-tool-output::-webkit-scrollbar, .op-diff::-webkit-scrollbar, .op-reasoning-body::-webkit-scrollbar { width: 6px; height: 6px; }
.op-messages::-webkit-scrollbar-thumb, .op-popover-list::-webkit-scrollbar-thumb, .op-tool-input::-webkit-scrollbar-thumb, .op-tool-output::-webkit-scrollbar-thumb, .op-diff::-webkit-scrollbar-thumb, .op-reasoning-body::-webkit-scrollbar-thumb { background: color-mix(in srgb, var(--op-muted) 38%, transparent); border-radius: 4px; }

@media (max-width: 900px) {
  .op-messages { padding: 16px 12px 8px; }
  .op-composer { padding: 8px 10px 10px; }
  .op-command-menu { left: 10px; }
  .op-error-banner { margin: 8px 12px 0; }
  .op-pending { padding: 8px 12px 0; }
  .op-resume-backdrop { padding: 16px 12px; }
  .op-resume-panel { max-height: calc(100dvh - 32px); }
  .op-skills-panel .op-resume-agent { display: none; }
  .op-source-row { flex-direction: column; align-items: stretch; }
  .op-source-row .op-btn { width: 100%; }
  .op-skill-preview-foot { flex-direction: column; align-items: stretch; }
  .op-skill-preview-foot .op-btn { width: 100%; }
  .op-auth { margin: 8px 12px 0; }
  .op-chatbar { padding: 0 12px; }
  .op-suggestions { grid-template-columns: 1fr; }
  .op-user-bubble { max-width: 88%; }
  .op-model-button { max-width: 160px; }
  .op-agent { max-width: 120px; }
  .op-agent select { max-width: 82px; }
}
@media (max-width: 680px) {
  .op-popover.op-config-popover {
    position: fixed;
    left: 12px;
    right: 12px;
    bottom: 110px;
    width: auto;
    max-height: min(60vh, 420px);
    overflow-y: auto;
  }
}
@media (max-width: 560px) {
  .op-config-button .op-ellipsis { display: none; }
  .op-composer-hint { display: none; }
  .op-usage { display: none; }
  .op-messages { gap: 14px; }
  .op-empty h2 { font-size: 19px; }
  .op-chatbar-sessions span { display: none; }
  .op-resume-foot span:last-child { display: none; }
  .op-skill-row { align-items: flex-start; }
  .op-skill-result-row code { display: none; }
}
@media (prefers-reduced-motion: reduce) {
  .op-app *, .op-app *::before, .op-app *::after {
    animation-duration: .001ms !important;
    animation-iteration-count: 1 !important;
    scroll-behavior: auto !important;
    transition-duration: .001ms !important;
  }
}
`;
