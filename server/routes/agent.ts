// server/routes/agent.ts
// HTTP/SSE bridge for the built-in ACP agent.
import type { IncomingMessage, ServerResponse } from 'node:http';
import type * as acp from '@agentclientprotocol/sdk';
import type { Router } from '../http.ts';
import type { AcpAgent, AgentEvent } from '../agent.ts';
import { HttpError } from '../http-error.ts';

function required(value: unknown, name: string): string {
  if (typeof value !== 'string' || value === '') throw new HttpError(400, `${name} is required`);
  return value;
}

function record(body: unknown): Record<string, unknown> {
  return body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : {};
}

function contentBlocks(value: unknown): acp.ContentBlock[] {
  if (!Array.isArray(value) || value.length === 0) throw new HttpError(400, 'content is required');
  if (value.length > 20) throw new HttpError(400, 'too many content blocks');
  return value.map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new HttpError(400, 'invalid content block');
    }
    const block = entry as Record<string, unknown>;
    if (block.type === 'text') {
      if (typeof block.text !== 'string' || block.text.trim() === '') {
        throw new HttpError(400, 'text content is required');
      }
      return { type: 'text', text: block.text };
    }
    if (block.type === 'image' || block.type === 'audio') {
      if (typeof block.mimeType !== 'string' || typeof block.data !== 'string' || block.data === '') {
        throw new HttpError(400, `${block.type} content requires mimeType and data`);
      }
      return {
        type: block.type,
        mimeType: block.mimeType,
        data: block.data,
        ...(block.type === 'image' && typeof block.uri === 'string' ? { uri: block.uri } : {}),
      };
    }
    if (block.type === 'resource_link') {
      if (typeof block.uri !== 'string' || typeof block.name !== 'string') {
        throw new HttpError(400, 'resource_link content requires uri and name');
      }
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
      if (!resource || typeof resource !== 'object' || Array.isArray(resource)) {
        throw new HttpError(400, 'resource content requires resource');
      }
      const value = resource as Record<string, unknown>;
      if (typeof value.uri !== 'string'
        || (typeof value.text !== 'string' && typeof value.blob !== 'string')) {
        throw new HttpError(400, 'resource content requires uri and text/blob');
      }
      return {
        type: 'resource',
        resource: {
          uri: value.uri,
          ...(typeof value.mimeType === 'string' ? { mimeType: value.mimeType } : {}),
          ...(typeof value.text === 'string' ? { text: value.text } : {}),
          ...(typeof value.blob === 'string' ? { blob: value.blob } : {}),
        },
      };
    }
    throw new HttpError(400, 'unsupported content block');
  }) as acp.ContentBlock[];
}

function send(res: ServerResponse, event: AgentEvent): void {
  if (res.writableEnded || res.destroyed) return;
  try { res.write(`data: ${JSON.stringify(event)}\n\n`); } catch { /* disconnected */ }
}

export function registerAgentRoutes(router: Router, agent: AcpAgent): void {
  router.get('/_/agent/api/status', () => agent.status());
  router.get('/_/agent/api/discovery', () => agent.discovery());
  router.post('/_/agent/api/select-agent', async (_req, body) => {
    const input = record(body);
    return agent.selectAgent(required(input.agentID, 'agentID'));
  });
  router.post('/_/agent/api/auth', async (_req, body) => {
    const input = record(body);
    try {
      return await agent.authenticate(required(input.methodID, 'methodID'));
    } catch (error) {
      throw new HttpError(400, error instanceof Error ? error.message : String(error));
    }
  });
  router.post('/_/agent/api/logout', async () => {
    try {
      return await agent.logout();
    } catch (error) {
      throw new HttpError(400, error instanceof Error ? error.message : String(error));
    }
  });

  router.get('/_/agent/api/models', async () => ({ data: await agent.modelsResponse() }));
  router.get('/_/agent/api/providers', async () => ({ data: await agent.providers() }));
  router.get('/_/agent/api/commands', async () => ({ data: await agent.commandsResponse() }));

  router.get('/_/agent/api/sessions', async () => ({ data: await agent.listSessions() }));
  router.get('/_/agent/api/session', async (_req, _body, query) => {
    const id = required(query.get('sessionID'), 'sessionID');
    return agent.session(id);
  });
  router.get('/_/agent/api/messages', async (_req, _body, query) => {
    const id = required(query.get('sessionID'), 'sessionID');
    const { updates, configOptions, modes } = await agent.messages(id);
    return { data: updates, configOptions, modes };
  });
  router.post('/_/agent/api/sessions', () => agent.createSession());
  router.post('/_/agent/api/sessions/remove', async (_req, body) => {
    const input = record(body);
    await agent.remove(required(input.sessionID, 'sessionID'));
    return {};
  });
  router.post('/_/agent/api/sessions/fork', async (_req, body) => {
    const input = record(body);
    return agent.fork(required(input.sessionID, 'sessionID'));
  });
  router.post('/_/agent/api/sessions/config', async (_req, body) => {
    const input = record(body);
    const value = input.value;
    if (typeof value !== 'string' && typeof value !== 'boolean') throw new HttpError(400, 'value is required');
    return {
      data: await agent.setConfig(
        required(input.sessionID, 'sessionID'),
        required(input.configID, 'configID'),
        value,
      ),
    };
  });

  router.post('/_/agent/api/sessions/mode', async (_req, body) => {
    const input = record(body);
    return {
      modes: await agent.setMode(
        required(input.sessionID, 'sessionID'),
        required(input.modeID, 'modeID'),
      ),
    };
  });

  router.post('/_/agent/api/prompt', async (_req, body) => {
    const input = record(body);
    const content = input.content === undefined
      ? [{ type: 'text' as const, text: required(input.text, 'text') }]
      : contentBlocks(input.content);
    return agent.prompt(required(input.sessionID, 'sessionID'), content);
  });
  router.post('/_/agent/api/interrupt', async (_req, body) => {
    const input = record(body);
    await agent.cancel(required(input.sessionID, 'sessionID'));
    return {};
  });

  router.get('/_/agent/api/permissions', async (_req, _body, query) => {
    const id = required(query.get('sessionID'), 'sessionID');
    return { data: agent.permissions(id) };
  });
  router.post('/_/agent/api/permission/reply', async (_req, body) => {
    const input = record(body);
    await agent.replyPermission(
      required(input.requestID, 'requestID'),
      required(input.optionId, 'optionId'),
    );
    return {};
  });

  router.get('/_/agent/api/forms', async (_req, _body, query) => {
    const id = required(query.get('sessionID'), 'sessionID');
    return { data: agent.forms(id) };
  });
  router.post('/_/agent/api/forms/reply', async (_req, body) => {
    const input = record(body);
    const action = input.action;
    if (action !== 'accept' && action !== 'decline' && action !== 'cancel') {
      throw new HttpError(400, 'action must be accept, decline or cancel');
    }
    if (input.content !== undefined && (typeof input.content !== 'object' || input.content === null || Array.isArray(input.content))) {
      throw new HttpError(400, 'content must be an object');
    }
    await agent.replyForm(
      required(input.formID, 'formID'),
      action,
      input.content as Record<string, unknown> | undefined,
    );
    return {};
  });

  router.sse('/_/agent/api/events', async (req: IncomingMessage, res: ServerResponse) => {
    res.on('error', () => {});
    const unsubscribe = agent.subscribe((event) => send(res, event));
    send(res, { type: 'state', status: 'starting' });
    if (req.destroyed) { unsubscribe(); return; }
    await new Promise<void>((resolve) => {
      req.on('close', () => { unsubscribe(); resolve(); });
    });
  });
}
