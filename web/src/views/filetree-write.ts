import { t } from '../i18n.ts';
import type { UploadResult } from '../upload.ts';

/** Final UI state of one tree write; runTreeWrite owns putting this in the banner. */
export type TreeWriteResult = { error: string | null };

export const treeWriteSuccess = (): TreeWriteResult => ({ error: null });

/** Turn per-file upload failures into the same explicit result shape as other writes. */
export function uploadWriteResult(result: UploadResult): TreeWriteResult {
  if (result.failed.length === 0) return { error: null };
  const first = result.failed[0];
  const name = first.path.split('/').pop() ?? first.path;
  return {
    error: result.uploaded === 0 && result.failed.length === 1 && first.status === 409
      ? t('filetree.uploadExists', { name })
      : t('filetree.uploadFailed', { uploaded: result.uploaded, failed: result.failed.length, name }),
  };
}
