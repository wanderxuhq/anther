import type { Database as DB, BindableValue, SqlValue } from '@sqlite.org/sqlite-wasm';

/** Finalize every statement, including iterators stopped by the result budget. */
export class QueryDatabase {
  constructor(private db: DB) {}
  exec(sql: string) { this.db.exec(sql); }
  prepare(sql: string) {
    const db = this.db;
    function* rows(arrays: boolean, args: BindableValue[]) {
      const statement = db.prepare(sql);
      try {
        if (args.length) statement.bind(args);
        while (statement.step()) yield arrays ? statement.get([]) : statement.get({});
      } finally { statement.finalize(); }
    }
    return {
      all: (...args: BindableValue[]) => [...rows(false, args)] as Record<string, SqlValue>[],
      get: (...args: BindableValue[]) => {
        for (const row of rows(false, args)) return row as Record<string, SqlValue>;
      },
      arrays: (...args: BindableValue[]) => rows(true, args) as Generator<SqlValue[]>,
    };
  }
}
