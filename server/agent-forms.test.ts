import { test } from 'node:test';
import assert from 'node:assert/strict';
import type * as acp from '@agentclientprotocol/sdk';
import { formFromElicitation, formResponse } from './agent-forms.ts';

function formRequest(overrides: Record<string, unknown> = {}): acp.CreateElicitationRequest {
  return {
    mode: 'form',
    sessionId: 'ses_1',
    message: 'Which package manager?',
    requestedSchema: {
      type: 'object',
      title: 'Package manager',
      properties: {
        pm: {
          type: 'string',
          title: 'Manager',
          oneOf: [
            { const: 'bun', title: 'Bun', description: 'Fast all-in-one' },
            { const: 'npm', title: 'npm' },
          ],
        },
        tags: {
          type: 'array',
          title: 'Tags',
          items: {
            anyOf: [
              { const: 'fast', title: 'Fast' },
              { const: 'stable', title: 'Stable' },
            ],
          },
          default: ['fast'],
          minItems: 1,
          maxItems: 2,
        },
        count: { type: 'integer', title: 'Count', minimum: 1, maximum: 5, default: 2 },
        dryRun: { type: 'boolean', title: 'Dry run', default: false },
      },
      required: ['pm'],
    },
    ...overrides,
  } as acp.CreateElicitationRequest;
}

test('maps an ACP form elicitation into an anther form', () => {
  const form = formFromElicitation('form_1', formRequest());
  assert.ok(form);
  assert.equal(form.id, 'form_1');
  assert.equal(form.sessionID, 'ses_1');
  assert.equal(form.title, 'Package manager');
  assert.equal(form.message, 'Which package manager?');
  assert.equal(form.state.status, 'pending');
  assert.deepEqual(form.fields.map((field) => field.key), ['pm', 'tags', 'count', 'dryRun']);

  const pm = form.fields[0];
  assert.equal(pm.required, true);
  assert.equal(pm.type, 'string');
  assert.deepEqual(pm.options, [
    { value: 'bun', label: 'Bun', description: 'Fast all-in-one' },
    { value: 'npm', label: 'npm', description: undefined },
  ]);

  const tags = form.fields[1];
  assert.equal(tags.type, 'multiselect');
  assert.deepEqual(tags.options?.map((option) => option.value), ['fast', 'stable']);
  assert.deepEqual(tags.default, ['fast']);
  assert.equal(tags.minimum, 1);
  assert.equal(tags.maximum, 2);

  const count = form.fields[2];
  assert.equal(count.type, 'integer');
  assert.equal(count.minimum, 1);
  assert.equal(count.maximum, 5);
  assert.equal(count.default, 2);

  const dryRun = form.fields[3];
  assert.equal(dryRun.type, 'boolean');
  assert.equal(dryRun.default, false);
});

test('maps plain enum strings and string constraints', () => {
  const form = formFromElicitation('form_2', formRequest({
    requestedSchema: {
      type: 'object',
      properties: {
        mode: { type: 'string', enum: ['quick', 'full'], default: 'quick' },
        name: { type: 'string', minLength: 2, maxLength: 20, format: 'email' },
      },
      required: ['mode'],
    },
  }));
  assert.ok(form);
  assert.deepEqual(form.fields[0].options, [
    { value: 'quick', label: 'quick' },
    { value: 'full', label: 'full' },
  ]);
  assert.equal(form.fields[0].default, 'quick');
  assert.equal(form.fields[1].minLength, 2);
  assert.equal(form.fields[1].maxLength, 20);
  assert.equal(form.fields[1].format, 'email');
});

test('falls back to the message when the schema has no title', () => {
  const form = formFromElicitation('form_3', formRequest({
    message: 'Pick one',
    requestedSchema: { type: 'object', properties: {} },
  }));
  assert.equal(form?.title, 'Pick one');
  assert.equal(form?.message, 'Pick one');
  assert.deepEqual(form?.fields, []);
});

test('declines unsupported elicitation scopes and modes', () => {
  assert.equal(formFromElicitation('form_4', {
    mode: 'form',
    requestId: 'req_1',
    message: 'Request scoped',
    requestedSchema: { type: 'object', properties: {} },
  } as acp.CreateElicitationRequest), undefined);

  assert.equal(formFromElicitation('form_5', {
    mode: 'url',
    sessionId: 'ses_1',
    elicitationId: 'url_1',
    url: 'https://example.com',
    message: 'Open this',
  } as acp.CreateElicitationRequest), undefined);
});

test('builds accept, decline and cancel responses', () => {
  assert.deepEqual(formResponse('accept', { pm: 'bun' }), {
    action: 'accept',
    content: { pm: 'bun' },
  });
  assert.deepEqual(formResponse('decline'), { action: 'decline' });
  assert.deepEqual(formResponse('cancel'), { action: 'cancel' });
});
