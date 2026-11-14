import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { t } from '../i18n.ts';

marked.setOptions({ gfm: true, breaks: true });

export function renderMarkdown(text: string): string {
  if (!text) return '';
  try {
    const html = marked.parse(text, { async: false }) as string;
    return DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });
  } catch {
    return escapeHtml(text);
  }
}

export function enhanceMarkdown(root: HTMLElement): void {
  for (const link of root.querySelectorAll('a')) {
    link.setAttribute('target', '_blank');
    link.setAttribute('rel', 'noopener noreferrer');
  }
  for (const pre of root.querySelectorAll('pre')) {
    const existing = pre.querySelector<HTMLButtonElement>(':scope > .md-code-copy');
    if (existing) {
      existing.textContent = t('agent.copy');
      continue;
    }
    const code = pre.querySelector('code');
    if (!code) continue;
    pre.classList.add('md-pre');
    const language = Array.from(code.classList)
      .find((name) => name.startsWith('language-'))?.slice('language-'.length);
    const label = document.createElement('span');
    label.className = 'md-code-lang';
    label.textContent = language ?? 'code';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'md-code-copy';
    button.textContent = t('agent.copy');
    button.addEventListener('click', () => {
      const value = code.textContent ?? '';
      void copyText(value).then((ok) => {
        button.textContent = ok ? t('agent.copied') : t('agent.copyFailed');
        window.setTimeout(() => { button.textContent = t('agent.copy'); }, 1200);
      });
    });
    pre.appendChild(label);
    pre.appendChild(button);
  }
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const area = document.createElement('textarea');
      area.value = text;
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand('copy');
      area.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
