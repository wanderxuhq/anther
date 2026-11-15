import type { FormField } from './api.ts';

export type FormFieldKind = 'external' | 'boolean' | 'multiselect' | 'select' | 'input';

/** One mutually exclusive rendering branch per field; keep the fallback exact. */
export function fieldKind(field: Pick<FormField, 'type' | 'options'>): FormFieldKind {
  if (field.type === 'external') return 'external';
  if (field.type === 'boolean') return 'boolean';
  if (field.type === 'multiselect') return 'multiselect';
  if (field.type === 'string' && (field.options?.length ?? 0) > 0) return 'select';
  return 'input';
}
