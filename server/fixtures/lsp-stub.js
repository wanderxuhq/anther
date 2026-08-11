#!/usr/bin/env node
// server/fixtures/lsp-stub.js
// 测试用假 LSP 服务器：Content-Length 帧 JSON-RPC over stdio。
// env 故障注入：LSP_STUB_SILENT=1（不回 initialize）/ LSP_STUB_CRASH=1（即退）/ LSP_STUB_DIAGS=1（推固定诊断）
if (process.env.LSP_STUB_CRASH === '1') process.exit(1);

function send(obj) {
  const body = JSON.stringify(obj);
  process.stdout.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
}

// 极简帧解析：只处理单帧（stub 仅用于小消息往返测试）
// 注意：不依赖 readline 行事件——帧体末行往往没有 \n 结尾（本 stub 的 send() 也不加），
// readline 会一直缓冲到最后一行直到 EOF 才派发；改用原始 data 累积解析。
let buf = '';
process.stdin.on('data', (chunk) => {
  buf += chunk;
  const m = buf.match(/^Content-Length: (\d+)\r?\n\r?\n/);
  if (!m) return;
  const len = Number(m[1]);
  const headerLen = m[0].length;
  if (buf.length < headerLen + len) return;
  let msg;
  try { msg = JSON.parse(buf.slice(headerLen, headerLen + len)); } catch { buf = ''; return; }
  buf = '';
  handle(msg);
});

function handle(msg) {
  if (msg.method === 'initialize') {
    if (process.env.LSP_STUB_SILENT === '1') return;
    send({ jsonrpc: '2.0', id: msg.id, result: {
      capabilities: { textDocumentSync: 1, completionProvider: { triggerCharacters: ['.'] } },
      serverInfo: { name: 'lsp-stub', version: '1' },
    } });
    return;
  }
  if (msg.method === 'textDocument/didOpen' || msg.method === 'textDocument/didChange') {
    if (process.env.LSP_STUB_DIAGS === '1') {
      send({ jsonrpc: '2.0', method: 'textDocument/publishDiagnostics', params: {
        uri: msg.params.textDocument.uri,
        diagnostics: [{
          range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
          message: 'stub diag', severity: 1,
        }],
      } });
    }
    return;
  }
  if (msg.method === 'textDocument/completion') {
    send({ jsonrpc: '2.0', id: msg.id, result: {
      isIncomplete: false,
      items: [{ label: 'stubItem', kind: 6, detail: 'stub detail' }],
    } });
    return;
  }
  if (msg.id !== undefined) send({ jsonrpc: '2.0', id: msg.id, result: null });
}
