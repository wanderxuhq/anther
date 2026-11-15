import type { ArchiveReply, ArchiveRequest } from './archive.ts';

type Pending = {
  resolve: (value: ArchiveReply) => void;
  reject: (error: Error) => void;
  onProgress?: (value: number) => void;
};

export class ArchiveClient {
  private worker = new Worker(new URL('./archive.worker.ts', import.meta.url), { type: 'module' });
  private pending = new Map<number, Pending>();
  private next = 0;
  constructor() {
    this.worker.onmessage = (event: MessageEvent<ArchiveReply>) => {
      const reply = event.data;
      const pending = this.pending.get(reply.id);
      if (!pending) return;
      if (reply.progress !== undefined) { pending.onProgress?.(reply.progress); return; }
      this.pending.delete(reply.id);
      if (reply.error) pending.reject(Object.assign(new Error(reply.error), { passwordRequired: reply.passwordRequired, passwordDepth: reply.passwordDepth, limit: reply.limit }));
      else pending.resolve(reply);
    };
    this.worker.onerror = () => this.close();
  }
  request(request: Omit<ArchiveRequest, 'id'>, onProgress?: (value: number) => void): Promise<ArchiveReply> {
    const id = ++this.next;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, onProgress });
      this.worker.postMessage({ ...request, id });
    });
  }
  close() {
    this.worker.terminate();
    for (const pending of this.pending.values()) pending.reject(new Error('Archive operation cancelled'));
    this.pending.clear();
  }
}
