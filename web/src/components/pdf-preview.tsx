import { DocumentReader } from './document-reader.tsx';
import { createPdfReader } from '../readers/pdf.ts';
import { registerReaderNavigation } from '../readers/navigation.ts';
import type { ReaderFactory } from '../readers/types.ts';
import { createUrlReader } from '../readers/url-connector.ts';

export default function PdfPreview(props: { url: string; path: string; navigationKey?: string }) {
  const createReader: ReaderFactory = (host) => {
    const reader = createUrlReader(props.navigationKey, createPdfReader, host);
    const disconnect = props.navigationKey ? registerReaderNavigation(props.navigationKey, reader) : undefined;
    return { ...reader, destroy() { disconnect?.(); reader.destroy(); } };
  };
  return <DocumentReader url={props.url} path={props.path} createReader={createReader} />;
}
