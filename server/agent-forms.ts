// server/agent-forms.ts
// Map ACP elicitation requests into the flat form model used by anther's UI.
import type * as acp from '@agentclientprotocol/sdk';

export type AgentFormOption = {
  value: string;
  label: string;
  description?: string;
};

export type AgentFormField = {
  key: string;
  title?: string;
  description?: string;
  required?: boolean;
  type: 'string' | 'number' | 'integer' | 'boolean' | 'multiselect';
  options?: AgentFormOption[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  format?: string;
  default?: unknown;
};

export type AgentForm = {
  id: string;
  sessionID: string;
  mode: 'form' | 'url';
  title: string;
  message?: string;
  toolCallID?: string;
  url?: string;
  elicitationID?: string;
  fields: AgentFormField[];
  metadata?: Record<string, unknown>;
  state: { status: 'pending' };
};

type JsonSchema = Record<string, unknown>;

/**
 * Only session-scoped elicitations can be attached to an anther session tab.
 * Request-scoped requests are declined. URL elicitations are surfaced with the
 * target URL; the browser UI obtains consent before opening it.
 */
export function formFromElicitation(id: string, params: acp.CreateElicitationRequest): AgentForm | undefined {
  const scope = params as unknown as {
    sessionId?: unknown;
    requestedSchema?: unknown;
    message?: unknown;
    toolCallId?: unknown;
    url?: unknown;
    elicitationId?: unknown;
  };
  if (typeof scope.sessionId !== 'string' || !scope.sessionId) return undefined;
  const message = typeof scope.message === 'string' && scope.message ? scope.message : undefined;
  const metadata = isRecord(params._meta) ? params._meta : undefined;

  if (params.mode === 'url') {
    const url = httpUrl(scope.url);
    if (!url) return undefined;
    return {
      id,
      sessionID: scope.sessionId,
      mode: 'url',
      title: message ?? '',
      message,
      toolCallID: typeof scope.toolCallId === 'string' ? scope.toolCallId : undefined,
      url,
      elicitationID: typeof scope.elicitationId === 'string' ? scope.elicitationId : undefined,
      fields: [],
      metadata,
      state: { status: 'pending' },
    };
  }
  if (params.mode !== 'form') return undefined;

  const schema = isRecord(scope.requestedSchema) ? scope.requestedSchema : undefined;
  if (!schema) return undefined;

  const properties = isRecord(schema.properties) ? schema.properties : {};
  const required = new Set(
    Array.isArray(schema.required)
      ? schema.required.filter((value): value is string => typeof value === 'string')
      : [],
  );
  const fields: AgentFormField[] = [];
  for (const [key, value] of Object.entries(properties)) {
    if (!isRecord(value)) continue;
    const field = mapField(key, value, required.has(key));
    if (field) fields.push(field);
  }

  return {
    id,
    sessionID: scope.sessionId,
    mode: 'form',
    title: typeof schema.title === 'string' && schema.title
      ? schema.title
      : typeof scope.message === 'string' && scope.message
        ? scope.message
        : 'Input needed',
    message: typeof scope.message === 'string' && scope.message ? scope.message : undefined,
    toolCallID: typeof scope.toolCallId === 'string' ? scope.toolCallId : undefined,
    fields,
    metadata,
    state: { status: 'pending' },
  };
}

export function formResponse(
  action: 'accept' | 'decline' | 'cancel',
  content?: Record<string, unknown>,
): acp.CreateElicitationResponse {
  if (action === 'accept') {
    return content && Object.keys(content).length > 0
      ? { action, content: content as acp.ElicitationAcceptAction['content'] }
      : { action };
  }
  return { action };
}

function mapField(key: string, schema: JsonSchema, required: boolean): AgentFormField | undefined {
  const type = typeof schema.type === 'string' ? schema.type : '';
  const base = {
    key,
    title: typeof schema.title === 'string' ? schema.title : undefined,
    description: typeof schema.description === 'string' ? schema.description : undefined,
    required: required || undefined,
  };

  if (type === 'string') {
    const options = optionsFrom(schema.oneOf) ?? optionsFrom(schema.enum);
    return {
      ...base,
      type: 'string',
      options,
      default: schema.default ?? undefined,
      minLength: numberOrUndefined(schema.minLength),
      maxLength: numberOrUndefined(schema.maxLength),
      format: typeof schema.format === 'string' ? schema.format : undefined,
    };
  }
  if (type === 'number' || type === 'integer') {
    return {
      ...base,
      type,
      minimum: numberOrUndefined(schema.minimum),
      maximum: numberOrUndefined(schema.maximum),
      default: schema.default ?? undefined,
    };
  }
  if (type === 'boolean') {
    return { ...base, type: 'boolean', default: schema.default ?? undefined };
  }
  if (type === 'array') {
    const items = isRecord(schema.items) ? schema.items : undefined;
    const options = optionsFrom(items?.anyOf) ?? optionsFrom(items?.enum);
    if (!options || options.length === 0) return undefined;
    return {
      ...base,
      type: 'multiselect',
      options,
      default: schema.default ?? undefined,
      minimum: numberOrUndefined(schema.minItems),
      maximum: numberOrUndefined(schema.maxItems),
    };
  }

  // ACP only defines primitive form properties. Keep an unknown custom type
  // usable as free text instead of dropping a required field.
  return { ...base, type: 'string', default: schema.default ?? undefined };
}

function optionsFrom(value: unknown): AgentFormOption[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const options: AgentFormOption[] = [];
  for (const entry of value) {
    if (typeof entry === 'string') {
      options.push({ value: entry, label: entry });
      continue;
    }
    if (!isRecord(entry)) continue;
    const optionValue = typeof entry.const === 'string'
      ? entry.const
      : typeof entry.value === 'string'
        ? entry.value
        : undefined;
    if (optionValue === undefined) continue;
    options.push({
      value: optionValue,
      label: typeof entry.title === 'string' && entry.title ? entry.title : optionValue,
      description: typeof entry.description === 'string' ? entry.description : undefined,
    });
  }
  return options.length > 0 ? options : undefined;
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function httpUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const raw = value.trim();
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
