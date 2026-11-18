// web/src/mathjax.ts
// MathJax is loaded lazily by the Markdown preview; keeping the imports in this
// module lets Vite put the engine in its own chunk.
import { mathjax } from 'mathjax-full/js/mathjax.js';
import { TeX } from 'mathjax-full/js/input/tex.js';
import { SVG } from 'mathjax-full/js/output/svg.js';
import { liteAdaptor } from 'mathjax-full/js/adaptors/liteAdaptor.js';
import { RegisterHTMLHandler } from 'mathjax-full/js/handlers/html.js';
import { AllPackages } from 'mathjax-full/js/input/tex/AllPackages.js';

const adaptor = liteAdaptor();
RegisterHTMLHandler(adaptor);

// `html` permits CSS/HTML injection through TeX; everything else (including
// mhchem) matches Obsidian's MathJax package set for normal math usage.
const packages = AllPackages.filter((name) => name !== 'html');
const tex = new TeX({ packages });
tex.formatError = (error) => { throw error; };
const svg = new SVG({ fontCache: 'local' });

export type MathJaxSvg = { markup: string; style: string };
export type MathJaxRenderer = (source: string, display: boolean) => MathJaxSvg;

/** One document per preview render isolates labels/tags between notes. */
export function createMathJaxRenderer(): MathJaxRenderer {
  const mathDocument = mathjax.document('', { InputJax: tex, OutputJax: svg });
  return (source, display) => {
    const node = mathDocument.convert(source, { display });
    const html = adaptor.outerHTML(node as never);
    const start = html.indexOf('<svg');
    const end = html.lastIndexOf('</svg>');
    if (start < 0 || end < start) throw new Error('MathJax did not produce SVG');
    const markup = html.slice(start, end + 6);
    const style = /style="(vertical-align:[^"]+)"/.exec(markup)?.[1] ?? '';
    return { markup, style };
  };
}
