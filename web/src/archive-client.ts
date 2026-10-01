import type { ArchiveReply, ArchiveRequest } from './archive.ts';

export class ArchiveClient {
  private worker = new Worker(new URL('./archive.worker.ts', import.meta.url), { type: 'module' });
  private pending = new Map<number, { resolve: (value: ArchiveReply) => void; reject: (error: Error) => void }>();
  private next = 0;
  constructor(private progress: (value: number | undefined) => void) {
    this.worker.onmessage = (event: MessageEvent<ArchiveReply>) => {
      const reply = event.data;
      if (reply.progress !== undefined) { this.progress(reply.progress); return; }
      const pending = this.pending.get(reply.id);
      if (!pending) return;
      this.pending.delete(reply.id);
      if (reply.error) pending.reject(Object.assign(new Error(reply.error), { passwordRequired: reply.passwordRequired, passwordDepth: reply.passwordDepth, limit: reply.limit }));
      else pending.resolve(reply);
    };
    this.worker.onerror = () => this.close();
  }
  request(request: Omit<ArchiveRequest, 'id'>): Promise<ArchiveReply> {
    const id = ++this.next;
    return new Promise((resolve, reject) => { this.pending.set(id, { resolve, reject }); this.worker.postMessage({ ...request, id }); });
  }
  close() {
    this.worker.terminate();
    for (const pending of this.pending.values()) pending.reject(new Error('Archive operation cancelled'));
    this.pending.clear();
  }
}
