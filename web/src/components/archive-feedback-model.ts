import { archiveFeedbackKey } from '../archive.ts';

export type FeedbackHost = {
  id: number;
  path: string;
  chain: string[];
  entry?: string;
  priority: number;
};

export type FeedbackSession = { limit?: 'depth' | 'budget'; entry?: string } | undefined;

export function feedbackGroup(host: FeedbackHost, session: FeedbackSession): string {
  return archiveFeedbackKey(host.path, host.chain, session?.limit);
}

/** Prefer explicit priority, then a session already showing this exact entry, then newest host. */
export function feedbackScore(host: FeedbackHost, session: FeedbackSession): number {
  return host.priority + (session?.entry && session.entry === host.entry ? 100 : 0);
}

/** Return the single host allowed to render feedback for this group, or null if absent. */
export function visibleFeedbackHostId(
  hosts: readonly FeedbackHost[],
  ownId: number,
  sessionOf: (host: FeedbackHost) => FeedbackSession,
): number | null {
  const own = hosts.find((host) => host.id === ownId);
  if (!own) return null;
  const group = feedbackGroup(own, sessionOf(own));
  let best: FeedbackHost | undefined;
  let bestScore = -Infinity;
  for (const host of hosts) {
    const session = sessionOf(host);
    if (feedbackGroup(host, session) !== group) continue;
    const score = feedbackScore(host, session);
    if (!best || score > bestScore || (score === bestScore && host.id > best.id)) {
      best = host;
      bestScore = score;
    }
  }
  return best?.id ?? null;
}
