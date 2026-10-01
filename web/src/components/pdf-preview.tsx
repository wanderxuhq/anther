import { DocumentReader } from './document-reader.tsx';
import { createPdfReader } from '../readers/pdf.ts';

export default function PdfPreview(props: { url: string; path: string }) {
  return <DocumentReader url={props.url} path={props.path} createReader={createPdfReader} />;
}
