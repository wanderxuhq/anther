// web/src/upload.ts
// 批量上传：多选文件 / 文件夹选择 / 拖拽（含递归目录）统一成 { file, relativePath }，
// 先按需递归建目录，再逐个上传。路径计算是纯函数，便于单测。
import { api, ApiError } from './api.ts';

export type UploadEntry = { file: File; relativePath: string };
export type UploadFailure = { path: string; status?: number; message: string };
export type UploadResult = { uploaded: number; failed: UploadFailure[] };

/** 统一分隔符并去掉开头的 './'；保留 `..` 交给服务端边界校验拒绝。 */
export function normalizeRelativePath(value: string): string {
  return value.replace(/\\/g, '/').split('/').filter((part) => part !== '' && part !== '.').join('/');
}

/** 根目录用 '.' 表示；避免生成 './name'。 */
export function joinUploadPath(base: string, relativePath: string): string {
  return base === '.' || base === '' ? relativePath : `${base}/${relativePath}`;
}

/** 所有需要创建的目录（浅 → 深、去重）。 */
export function directoriesFor(entries: readonly UploadEntry[]): string[] {
  const dirs = new Set<string>();
  for (const entry of entries) {
    const parts = entry.relativePath.split('/');
    let prefix = '';
    for (let i = 0; i < parts.length - 1; i++) {
      prefix = prefix ? `${prefix}/${parts[i]}` : parts[i];
      dirs.add(prefix);
    }
  }
  return [...dirs].sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b));
}

/** FileList（含 webkitdirectory 的 webkitRelativePath）→ 上传条目。 */
export function entriesFromFiles(files: ArrayLike<File>): UploadEntry[] {
  const entries: UploadEntry[] = [];
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const relativePath = normalizeRelativePath(file.webkitRelativePath || file.name);
    if (relativePath) entries.push({ file, relativePath });
  }
  return entries;
}

function joinRelative(prefix: string, name: string): string {
  const clean = normalizeRelativePath(name);
  return prefix && clean ? `${prefix}/${clean}` : clean || prefix;
}

function readFileEntry(entry: FileSystemFileEntry): Promise<File> {
  return new Promise((resolve, reject) => entry.file(resolve, reject));
}

/** readEntries 每次最多返回 100 条，必须循环读到空数组。 */
async function readDirectory(entry: FileSystemDirectoryEntry): Promise<FileSystemEntry[]> {
  const reader = entry.createReader();
  const all: FileSystemEntry[] = [];
  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
    if (batch.length === 0) return all;
    all.push(...batch);
  }
}

async function walkEntry(entry: FileSystemEntry, prefix: string, out: UploadEntry[]): Promise<void> {
  if (entry.isFile) {
    const file = await readFileEntry(entry as FileSystemFileEntry);
    out.push({ file, relativePath: joinRelative(prefix, file.name) });
    return;
  }
  if (!entry.isDirectory) return;
  const directory = entry as FileSystemDirectoryEntry;
  const next = joinRelative(prefix, entry.name);
  for (const child of await readDirectory(directory)) await walkEntry(child, next, out);
}

/** 拖拽事件 → 上传条目；支持文件夹递归，老浏览器回退到 dataTransfer.files。 */
export async function entriesFromDataTransfer(data: DataTransfer): Promise<UploadEntry[]> {
  const entries: UploadEntry[] = [];
  for (const item of Array.from(data.items ?? [])) {
    if (item.kind !== 'file') continue;
    const entry = item.webkitGetAsEntry?.();
    if (entry) await walkEntry(entry, '', entries);
  }
  return entries.length > 0 ? entries : entriesFromFiles(data.files);
}

/**
 * 上传到 base 目录（'.' 为根）。目录先递归创建；文件冲突（409）等失败逐条记录，
 * 不中断其余文件。onProgress 在每处理完一个文件后回调。
 */
export async function uploadEntries(
  base: string,
  entries: readonly UploadEntry[],
  onProgress?: (done: number, total: number) => void,
): Promise<UploadResult> {
  for (const dir of directoriesFor(entries)) {
    await api.mkDir(joinUploadPath(base, dir), true);
  }
  const failed: UploadFailure[] = [];
  let uploaded = 0;
  for (const entry of entries) {
    const path = joinUploadPath(base, entry.relativePath);
    try {
      await api.upload(path, entry.file);
      uploaded++;
    } catch (e) {
      failed.push({
        path,
        status: e instanceof ApiError ? e.status : undefined,
        message: (e as Error).message,
      });
    }
    onProgress?.(uploaded + failed.length, entries.length);
  }
  return { uploaded, failed };
}
