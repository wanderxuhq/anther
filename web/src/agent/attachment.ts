// web/src/agent/attachment.ts
import type { PromptContent } from './api.ts';

export type PromptAttachment = {
  id: string;
  kind: 'image' | 'audio' | 'file';
  name: string;
  mimeType: string;
  size: number;
  uri: string;
  /** Base64 data for image/audio attachments. */
  data?: string;
  /** Text content for embedded file resources. */
  text?: string;
};

export function promptContentForAttachment(
  attachment: PromptAttachment,
  embeddedContext: boolean,
): PromptContent {
  if (attachment.kind === 'image') {
    return {
      type: 'image',
      mimeType: attachment.mimeType,
      data: attachment.data ?? '',
      uri: attachment.uri,
    };
  }
  if (attachment.kind === 'audio') {
    return {
      type: 'audio',
      mimeType: attachment.mimeType,
      data: attachment.data ?? '',
    };
  }
  if (attachment.text !== undefined && embeddedContext) {
    return {
      type: 'resource',
      resource: {
        uri: attachment.uri,
        mimeType: attachment.mimeType,
        text: attachment.text,
      },
    };
  }
  return {
    type: 'resource_link',
    uri: attachment.uri,
    name: attachment.name,
    mimeType: attachment.mimeType,
    size: attachment.size,
  };
}

export type PromptCapabilities = {
  image?: boolean;
  audio?: boolean;
  embeddedContext?: boolean;
};

export type AttachmentError =
  | 'unsupported-image'
  | 'unsupported-audio'
  | 'too-large'
  | 'read-failed';

const MAX_IMAGE_DATA = 700_000;
const MAX_AUDIO_DATA = 600_000;
const MAX_TEXT_BYTES = 150_000;
const TEXT_EXTENSIONS = new Set([
  'md', 'txt', 'json', 'js', 'jsx', 'ts', 'tsx', 'css', 'html', 'htm', 'xml',
  'yaml', 'yml', 'toml', 'py', 'go', 'rs', 'java', 'c', 'h', 'cpp', 'sh',
  'sql', 'csv', 'log', 'ini', 'conf',
]);

export async function prepareAttachment(
  file: File,
  capabilities: PromptCapabilities,
): Promise<{ attachment?: PromptAttachment; error?: AttachmentError }> {
  const uri = `file:///${encodeURIComponent(file.name)}`;
  const mimeType = file.type || 'application/octet-stream';

  if (mimeType.startsWith('image/')) {
    if (!capabilities.image) return { error: 'unsupported-image' };
    const encoded = await imageData(file);
    if (!encoded) return { error: 'too-large' };
    return {
      attachment: {
        id: attachmentID(),
        kind: 'image',
        name: file.name,
        mimeType: encoded.mimeType,
        size: file.size,
        uri,
        data: encoded.data,
      },
    };
  }

  if (mimeType.startsWith('audio/')) {
    if (!capabilities.audio) return { error: 'unsupported-audio' };
    if (file.size > MAX_AUDIO_DATA) return { error: 'too-large' };
    const encoded = await readBase64(file);
    if (!encoded) return { error: 'read-failed' };
    return {
      attachment: {
        id: attachmentID(),
        kind: 'audio',
        name: file.name,
        mimeType: encoded.mimeType || mimeType,
        size: file.size,
        uri,
        data: encoded.data,
      },
    };
  }

  let text: string | undefined;
  if (capabilities.embeddedContext && file.size <= MAX_TEXT_BYTES && isTextFile(file)) {
    try {
      text = await file.text();
    } catch {
      return { error: 'read-failed' };
    }
  }
  return {
    attachment: {
      id: attachmentID(),
      kind: 'file',
      name: file.name,
      mimeType,
      size: file.size,
      uri,
      ...(text !== undefined ? { text } : {}),
    },
  };
}

function isTextFile(file: File): boolean {
  if (file.type.startsWith('text/')) return true;
  if (!file.name.includes('.')) return false;
  return TEXT_EXTENSIONS.has(file.name.split('.').pop()?.toLowerCase() ?? '');
}

function attachmentID(): string {
  return `att_${Math.random().toString(36).slice(2, 10)}`;
}

async function imageData(file: File): Promise<{ mimeType: string; data: string } | null> {
  let blob: Blob = file;
  let encoded = await readBase64(blob);
  if (!encoded) return null;
  if (encoded.data.length > MAX_IMAGE_DATA) {
    const compressed = await compressImage(file);
    if (!compressed) return null;
    blob = compressed;
    encoded = await readBase64(blob);
    if (!encoded) return null;
  }
  if (encoded.data.length > MAX_IMAGE_DATA + 200_000) return null;
  return { mimeType: encoded.mimeType || blob.type || 'image/png', data: encoded.data };
}

async function compressImage(file: File): Promise<Blob | null> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d');
    if (!context) return null;
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    return await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, 'image/jpeg', 0.82);
    });
  } catch {
    return null;
  }
}

async function readBase64(blob: Blob): Promise<{ mimeType: string; data: string } | null> {
  const data = await new Promise<string | null>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null);
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(blob);
  });
  if (!data) return null;
  const comma = data.indexOf(',');
  if (comma < 0) return null;
  const header = data.slice(5, comma);
  const mimeType = header.split(';')[0] || blob.type;
  return { mimeType, data: data.slice(comma + 1) };
}
