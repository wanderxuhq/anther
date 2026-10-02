import { createEffect, createSignal, onCleanup } from 'solid-js';
import type { DatabaseTab } from '../tab-model.ts';
import { DatabaseController, databaseSnapshot, saveDatabaseSnapshot } from '../database/controller.ts';
import { createSqliteSource } from '../database/sqlite-source.ts';
import { DatabaseView } from '../components/database-view.tsx';
import { openDatabaseTab, updateDatabaseSort, tabs } from '../stores.ts';

export function DatabasePane(props: { tab: DatabaseTab; onController(controller: DatabaseController | null): void }) {
  const id = props.tab.id;
  const saved = databaseSnapshot(id);
  const sameSort = JSON.stringify(saved?.sort) === JSON.stringify(props.tab.sort);
  const controller = new DatabaseController(createSqliteSource(props.tab.path), props.tab.object, props.tab.mode,
    { ...(sameSort ? saved : { filter: saved?.filter }), sort: props.tab.sort });
  const [state, setState] = createSignal(controller.state);
  const unsubscribe = controller.subscribe((state) => {
    setState(state);
    if (JSON.stringify(state.sort) !== JSON.stringify(props.tab.sort)) updateDatabaseSort(id, state.sort);
  });
  props.onController(controller);
  createEffect(() => {
    const sort = props.tab.sort;
    if (JSON.stringify(sort) !== JSON.stringify(controller.state.sort)) controller.sort(sort);
  });
  void controller.load();
  onCleanup(() => { if (tabs().some((tab) => tab.id === id)) saveDatabaseSnapshot(id, controller.snapshot()); unsubscribe(); controller.dispose(); props.onController(null); });
  return <DatabaseView state={state()} mode={props.tab.mode} object={props.tab.object} controller={controller}
    onOpen={(object) => openDatabaseTab(props.tab.path, { object, mode: 'data' })}/>;
}
