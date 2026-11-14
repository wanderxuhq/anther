// server/agent-session-list.ts
// ACP session/list is cursor-paginated. Collect pages while guarding against
// agents that repeat a cursor or never stop returning one.
export type SessionPage<T extends { sessionId: string }> = {
  sessions: T[];
  nextCursor?: string | null;
};

export async function collectSessionPages<T extends { sessionId: string }>(
  loadPage: (cursor?: string) => Promise<SessionPage<T>>,
  maxPages = 100,
): Promise<T[]> {
  const sessions: T[] = [];
  const seen = new Set<string>();
  const cursors = new Set<string>();
  let cursor: string | undefined;

  for (let page = 0; page < maxPages; page++) {
    const result = await loadPage(cursor);
    for (const session of result.sessions ?? []) {
      if (seen.has(session.sessionId)) continue;
      seen.add(session.sessionId);
      sessions.push(session);
    }
    const next = result.nextCursor ?? undefined;
    if (!next || cursors.has(next)) break;
    cursors.add(next);
    cursor = next;
  }

  return sessions;
}
