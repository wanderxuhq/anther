import { createSignal } from 'solid-js';

export const [currentFile, setCurrentFile] = createSignal<string | null>(null);
export const [roMode, setRoMode] = createSignal(true);
export const [tabs, setTabs] = createSignal<string[]>([]);
