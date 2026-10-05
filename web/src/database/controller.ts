import type { DatabaseSource, DatabaseDescription, DatabaseObject, DatabaseRows, DatabaseRowsRequest, DatabaseSort } from './source.ts';

export type DatabasePage = { offset: number; cursor?: string; limit?: number };
export type DatabaseViewState = {
  pages: DatabasePage[];
  sort?: DatabaseSort;
  filter?: DatabaseRowsRequest['filter'];
};
export type DatabaseState = DatabaseViewState & {
  busy: boolean; error: string | null;
  rows: DatabaseRows | null; description: DatabaseDescription | null;
  objects: DatabaseObject[]; objectsTruncated: boolean;
};

/** Per-tab controller. No DOM, application store, URL, or transport dependencies. */
export class DatabaseController {
  state: DatabaseState;
  private listeners = new Set<(state: DatabaseState) => void>();
  private pending?: AbortController;
  private disposed = false;
  constructor(private source: DatabaseSource, private object: DatabaseObject | null,
    private mode: 'data' | 'structure', initial?: Partial<DatabaseViewState>) {
    this.state = { pages: [{ offset: 0 }], ...initial, busy: false, error: null, rows: null, description: null, objects: [], objectsTruncated: false };
  }
  subscribe(listener: (state: DatabaseState) => void) {
    this.listeners.add(listener); listener(this.state);
    return () => { this.listeners.delete(listener); };
  }
  private update(patch: Partial<DatabaseState>) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener(this.state);
  }
  async load(before?: number) {
    if (this.disposed) return false;
    this.pending?.abort();
    const pending = this.pending = new AbortController();
    this.update({ busy: true, error: null });
    try {
      if (!this.object) {
        const result = await this.source.listObjects(pending.signal);
        if (this.pending === pending && !pending.signal.aborted) this.update({ objects: result.objects, objectsTruncated: result.truncated });
      } else if (this.mode === 'structure') {
        const description = await this.source.describe(this.object, pending.signal);
        if (this.pending === pending && !pending.signal.aborted) this.update({ description });
      } else {
        const query = { object: this.object, sort: this.state.sort, filter: this.state.filter };
        let pages = this.state.pages;
        let rows: DatabaseRows;
        if (before !== undefined) {
          // A response may contain fewer than 100 rows due to its byte budget.
          // Rebuild only the preceding 100-record window, retaining page coordinates,
          // until the last response ends immediately before the current page.
          pages = [];
          let page: DatabasePage = { offset: Math.max(0, before - 100) };
          for (;;) {
            page = { ...page, limit: before - page.offset };
            rows = await this.source.readRows({ ...query, ...page }, pending.signal);
            if (this.pending !== pending || pending.signal.aborted) return false;
            if (!rows.rows.length) throw new Error('Previous page is no longer available');
            pages.push(page);
            const offset = rows.offset + rows.rows.length;
            if (offset >= before) break;
            page = { offset, cursor: rows.nextCursor };
          }
        } else rows = await this.source.readRows({ ...query, ...pages.at(-1) }, pending.signal);
        if (this.pending === pending && !pending.signal.aborted) this.update({ rows, pages });
      }
      return this.pending === pending && !pending.signal.aborted;
    } catch (error) {
      if (this.pending === pending && !pending.signal.aborted) this.update({ error: (error as Error).message });
      return false;
    } finally { if (this.pending === pending && !pending.signal.aborted) this.update({ busy: false }); }
  }
  sort(sort?: DatabaseSort) {
    this.update({ sort, pages: [{ offset: 0 }], rows: null }); void this.load();
  }
  filter(filter?: DatabaseRowsRequest['filter']) {
    this.update({ filter, pages: [{ offset: 0 }], rows: null }); void this.load();
  }
  next() {
    const rows = this.state.rows;
    if (this.state.busy || this.state.error || !rows?.hasMore) return Promise.resolve(false);
    return this.changePage([...this.state.pages, { offset: rows.offset + rows.rows.length, cursor: rows.nextCursor }]);
  }
  previous() {
    if (this.state.busy || !this.hasPrevious) return Promise.resolve(false);
    if (this.state.pages.length === 1) return this.load(this.state.pages[0].offset);
    return this.changePage(this.state.pages.slice(0, -1));
  }
  get hasPrevious() { return this.state.pages.length > 1 || (this.state.pages[0].offset > 0 && this.state.pages[0].offset <= 100_100); }
  restore(initial: Partial<DatabaseViewState>) {
    this.pending?.abort();
    this.update({ pages: initial.pages ?? [{ offset: 0 }], sort: initial.sort, filter: initial.filter, rows: null });
    void this.load();
  }
  private async changePage(pages: DatabasePage[]) {
    const previous = this.state.pages;
    this.update({ pages });
    const loaded = await this.load();
    if (!loaded && !this.disposed && this.state.pages === pages) this.update({ pages: previous });
    return loaded;
  }
  refresh() { this.pending?.abort(); this.source.refresh?.(); this.update({ pages: [{ offset: 0 }], rows: null }); void this.load(); }
  cancel() { this.pending?.abort(); this.pending = undefined; this.update({ busy: false }); }
  snapshot(): DatabaseViewState { return { pages: this.state.pages, sort: this.state.sort, filter: this.state.filter }; }
  dispose() { this.disposed = true; this.cancel(); this.listeners.clear(); this.source.dispose(); }
}

// Only lightweight navigation state is kept for inactive tabs; query results are released.
const snapshots = new Map<string, DatabaseViewState>();
export const databaseSnapshot = (id: string) => snapshots.get(id);
export function saveDatabaseSnapshot(id: string, state: DatabaseViewState) {
  snapshots.delete(id); snapshots.set(id, state);
  if (snapshots.size > 100) snapshots.delete(snapshots.keys().next().value!);
}
export const forgetDatabaseSnapshot = (id: string) => { snapshots.delete(id); };
