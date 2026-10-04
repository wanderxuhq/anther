import { usePreviewLocation } from '../preview-location.ts';
import { ImagePreview } from './image-preview.tsx';
import { TablePreview } from './table-preview.tsx';

export function LocatedImagePreview(props: { path: string; url: string; navigationKey: string }) {
  const state = usePreviewLocation(props.navigationKey);
  const position = () => { const value = state.location(); return value?.kind === 'image' ? value : null; };
  return <ImagePreview path={props.path} url={props.url} position={position()} onPosition={state.update}/>;
}
export function LocatedTablePreview(props: { path: string; content: string; navigationKey: string }) {
  const state = usePreviewLocation(props.navigationKey);
  const position = () => { const value = state.location(); return value?.kind === 'table' ? value : null; };
  return <TablePreview path={props.path} content={props.content} position={position()} onPosition={(value) => state.update({ kind: 'table', ...value })}/>;
}
