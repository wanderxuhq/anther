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
// 且必须用 Buffer 按字节累积、按字节切 body：Content-Length 是字节数，而字符串
// 的 .length 按 UTF-16 码元计，多字节 UTF-8（如中文注释）会让字符数 < 字节数，
// 导致 buf.length 永远达不到 headerLen + len，stub 会一直等数据而挂起。
let buf = Buffer.alloc(0);
process.stdin.on('data', (chunk) => {
  buf = Buffer.concat([buf, chunk]);
  const s = buf.toString(); // 仅用于头解析；头是纯 ASCII，字符数即字节数
  const m = s.match(/^Content-Length: (\d+)\r?\n\r?\n/);
  if (!m) return;
  const len = Number(m[1]);
  const headerLen = m[0].length;
  if (buf.length < headerLen + len) return;
  let msg;
  try { msg = JSON.parse(buf.subarray(headerLen, headerLen + len).toString()); } catch { buf = Buffer.alloc(0); return; }
  buf = Buffer.alloc(0);
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
