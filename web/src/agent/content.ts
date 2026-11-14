// web/src/agent/content.ts
// Parser for non-text ACP content blocks.

export type RichContent =
  | { type: 'image'; mimeType: string; data: string; uri?: string }
  | { type: 'audio'; mimeType: string; data: string }
  | {
      type: 'resource_link';
      uri: string;
      name: string;
      mimeType?: string;
      title?: string;
      description?: string;
      size?: number;
    }
  | {
      type: 'resource';
      uri: string;
      mimeType?: string;
      text?: string;
      blob?: string;
    };

export function richContent(value: unknown): RichContent | null {
  if (!value || typeof value !== 'object') return null;
  const block = value as Record<string, unknown>;
  if (block.type === 'image') {
    if (typeof block.mimeType !== 'string' || !block.mimeType.startsWith('image/')) return null;
    if (typeof block.data !== 'string' || !block.data) return null;
    return {
      type: 'image',
      mimeType: block.mimeType,
      data: block.data,
      ...(typeof block.uri === 'string' ? { uri: block.uri } : {}),
    };
  }
  if (block.type === 'audio') {
    if (typeof block.mimeType !== 'string' || !block.mimeType.startsWith('audio/')) return null;
    if (typeof block.data !== 'string' || !block.data) return null;
    return { type: 'audio', mimeType: block.mimeType, data: block.data };
  }
  if (block.type === 'resource_link') {
    if (typeof block.uri !== 'string' || typeof block.name !== 'string') return null;
    return {
      type: 'resource_link',
      uri: block.uri,
      name: block.name,
      ...(typeof block.mimeType === 'string' ? { mimeType: block.mimeType } : {}),
      ...(typeof block.title === 'string' ? { title: block.title } : {}),
      ...(typeof block.description === 'string' ? { description: block.description } : {}),
      ...(typeof block.size === 'number' ? { size: block.size } : {}),
    };
  }
  if (block.type === 'resource') {
    const resource = block.resource;
    if (!resource || typeof resource !== 'object') return null;
    const value = resource as Record<string, unknown>;
    if (typeof value.uri !== 'string') return null;
    const text = typeof value.text === 'string' ? value.text : undefined;
    const blob = typeof value.blob === 'string' ? value.blob : undefined;
    if (text === undefined && blob === undefined) return null;
    return {
      type: 'resource',
      uri: value.uri,
      ...(typeof value.mimeType === 'string' ? { mimeType: value.mimeType } : {}),
      ...(text !== undefined ? { text } : {}),
      ...(blob !== undefined ? { blob } : {}),
    };
  }
  return null;
}
