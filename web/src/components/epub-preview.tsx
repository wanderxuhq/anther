import { DocumentReader } from './document-reader.tsx';
import { createEpubReader } from '../readers/epub.ts';
import { registerReaderNavigation } from '../readers/navigation.ts';
import type { ReaderFactory } from '../readers/types.ts';
import { createUrlReader } from '../readers/url-connector.ts';

export default function EpubPreview(props: { url: string; path: string; navigationKey?: string }) {
  const createReader: ReaderFactory = (host) => {
    const reader = createUrlReader(props.navigationKey, createEpubReader, host);
    const disconnect = props.navigationKey ? registerReaderNavigation(props.navigationKey, reader) : undefined;
    return { ...reader, destroy() { disconnect?.(); reader.destroy(); } };
  };
  return <DocumentReader url={props.url} path={props.path} createReader={createReader} />;
}
