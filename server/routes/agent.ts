// server/routes/agent.ts
// HTTP/SSE bridge for the built-in ACP agent.
import type { IncomingMessage, ServerResponse } from 'node:http';
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
    return agent.prompt(required(input.sessionID, 'sessionID'), required(input.text, 'text'));
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
    const decision = input.decision;
    if (decision !== 'once' && decision !== 'always' && decision !== 'reject') {
      throw new HttpError(400, 'decision must be once, always or reject');
    }
    await agent.replyPermission(required(input.requestID, 'requestID'), decision);
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
