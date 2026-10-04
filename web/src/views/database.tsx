import { archiveLimits } from '../archive-settings.ts';
import { createEffect, createMemo, createSignal, onCleanup, Show, on } from 'solid-js';
import type { DatabaseTab } from '../tab-model.ts';
import { DatabaseController, databaseSnapshot, saveDatabaseSnapshot } from '../database/controller.ts';
import { createDatabaseSource } from '../database/file-source.ts';
import { ArchiveFeedback } from '../components/archive-feedback.tsx';
import { ensureArchive, archiveSession } from '../archive-sessions.ts';
import { DatabaseView } from '../components/database-view.tsx';
import { openDatabaseTab, updateDatabaseNavigation, tabs } from '../stores.ts';

export function DatabasePane(props: { tab: DatabaseTab; onController(controller: DatabaseController | null): void }) {
  const id = props.tab.id;
  const query = (value: Pick<DatabaseTab, 'sort' | 'filter' | 'offset' | 'cursor'>) => JSON.stringify([value.sort ?? null, value.filter ?? null, value.offset ?? 0, value.cursor ?? null]);
  const initial = () => ({ sort: props.tab.sort, filter: props.tab.filter, pages: [{ offset: props.tab.offset ?? 0, ...(props.tab.cursor ? { cursor: props.tab.cursor } : {}) }] });
  const saved = databaseSnapshot(id), savedPage = saved?.pages.at(-1);
  const restored = saved && query({ ...saved, offset: savedPage?.offset, cursor: savedPage?.cursor }) === query(props.tab) ? saved : initial();
  const controller = new DatabaseController(createDatabaseSource(props.tab), props.tab.object, props.tab.mode, restored);
  const [state, setState] = createSignal(controller.state);
  let restoring = false;
  const unsubscribe = controller.subscribe((state) => {
    setState(state);
    if (restoring || state.busy || !state.rows || state.rows.offset !== state.pages.at(-1)!.offset) return;
    const page = state.pages.at(-1)!;
    const target = { sort: state.sort, filter: state.filter, offset: page.offset || undefined, cursor: page.cursor };
    if (query(target) !== query(props.tab)) updateDatabaseNavigation(id, { ...target,
      ...(JSON.stringify([state.sort, state.filter]) !== JSON.stringify([props.tab.sort, props.tab.filter]) ? { table: undefined } : {}) });
  });
  props.onController(controller);
  createEffect(() => {
    const target = initial(), page = controller.state.pages.at(-1)!;
    if (query(props.tab) === query({ ...controller.state, offset: page.offset, cursor: page.cursor })) return;
    restoring = true;
    try { controller.restore(target); } finally { restoring = false; }
  });
  // Remember the error's origin even while another archive operation clears the shared status.
  const archiveFailure = createMemo(on(() => state().error, (error) => !!props.tab.archive && !!error && archiveSession(props.tab.path, props.tab.archive.chain)?.error === error));
  if (props.tab.archive) createEffect(on(archiveLimits, () => controller.refresh(), { defer: true }));
  void controller.load();
  onCleanup(() => { if (tabs().some((tab) => tab.id === id)) saveDatabaseSnapshot(id, controller.snapshot()); unsubscribe(); controller.dispose(); props.onController(null); });
  return <>
    <Show when={props.tab.archive}>{(archive) => <ArchiveFeedback path={props.tab.path} chain={archive().chain} entry={archive().entry} priority={30} retry={(password) => {
      void ensureArchive(props.tab.path, password, true, archive().chain).then(() => controller.refresh()).catch(() => {});
    }}/>}</Show>
    <Show when={!archiveFailure()}><DatabaseView state={state()} mode={props.tab.mode} object={props.tab.object} controller={controller}
    position={props.tab.table} onPosition={(table) => updateDatabaseNavigation(id, { table })}
    onOpen={(object) => openDatabaseTab(props.tab.path, { object, mode: 'data', archive: props.tab.archive })}/></Show></>;
}
