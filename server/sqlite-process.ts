import { queryDatabase } from './sqlite-query.ts';
import type { SqliteQueryMessage, SqliteReply } from './sqlite-protocol.ts';

const reply = (message: SqliteReply) => process.send?.(message, () => process.exit());
function onQuery(message: unknown) {
  if (!message || typeof message !== 'object' || !('type' in message) || message.type !== 'sqlite:query') return;
  process.off('message', onQuery);
  const query = message as SqliteQueryMessage;
  try { reply({ type: 'sqlite:result', result: queryDatabase(query.filename, query.request) }); }
  catch (error) {
    reply({ type: 'sqlite:error', error: error instanceof Error ? error.message : 'Unable to read database' });
  }
}
process.on('message', onQuery);
