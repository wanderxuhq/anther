// server/git.ts
// 薄 git 执行器：真实 git CLI 兜底（重命名/二进制/换行差异/冲突状态全对齐 CLI）。
// execFile 数组参数不走 shell，从根上防注入；所有命令在项目根目录下执行。
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { HttpError } from './http-error.ts';

const execFileP = promisify(execFile);

export type GitChange = { path: string; status: string };
export type GitStatus = { isRepo: boolean; changes: GitChange[] };
export type GitCommit = { hash: string; shortHash: string; subject: string; author: string; time: number; decorations: string };
export type GitBranch = { name: string; current: boolean; tip: string };
export type GitBranches = { isRepo: boolean; current: string | null; branches: GitBranch[] };
export type GitLog = { isRepo: boolean; commits: GitCommit[] };
export type GitShow = { commit: GitCommit; diff: string };

/** log/show 元信息统一 format：%x00 分隔字段（%s 不含换行 → 记录按 \n 拆无歧义；%D 可空串作尾字段） */
const COMMIT_FORMAT = '%H%x00%h%x00%s%x00%an%x00%at%x00%D';

function parseCommitRecord(line: string): GitCommit | null {
  const [hash, shortHash, subject, author, time, decorations] = line.split('\0');
  if (!hash || !shortHash || !subject || !author || !time) return null;
  return { hash, shortHash, subject, author, time: Number(time), decorations: decorations ?? '' };
}

/** porcelain -z 解析：记录为 `<XY> <path>\0`；重命名/复制（R/C）多一条 `<orig>\0` 原路径记录，跳过。 */
export function parseStatus(stdout: string): GitChange[] {
  const changes: GitChange[] = [];
  const records = stdout.split('\0');
  for (let i = 0; i < records.length; i++) {
    const rec = records[i];
    if (rec.length < 4) continue; // 空记录 / 尾部空串
    const xy = rec.slice(0, 2);
    const path = rec.slice(3);
    if (!path) continue;
    if (xy.includes('R') || xy.includes('C')) i++; // 下一条记录是原路径
    changes.push({ path, status: xy });
  }
  return changes;
}

/** 显示状态字母：?? 未跟踪；有暂存位（index 列非空格）显示暂存字母，否则显示工作区位。 */
export function statusLabel(status: string): string {
  if (status === '??') return '??';
  return status.trim().slice(0, 1);
}

export class Git {
  private root: string;

  constructor(root: string) {
    this.root = root;
  }

  /** 规范化 + 根目录边界校验（与 FileStore.resolve 同款写法）。越界抛 400。 */
  private resolveInRoot(relPath: string): string {
    if (typeof relPath !== 'string' || relPath === '') throw new HttpError(400, 'invalid path');
    const abs = path.resolve(this.root, relPath);
    const rootAbs = path.resolve(this.root);
    const prefix = rootAbs.endsWith(path.sep) ? rootAbs : rootAbs + path.sep;
    if (abs !== rootAbs && !abs.startsWith(prefix)) throw new HttpError(400, 'path escapes root');
    return abs;
  }

  /**
   * 执行 git。okCodes 内的退出码视为成功（git diff 正常返回 1 表示"有差异"，不能当错误）。
   * failStatus 指定非 ok 码的 HTTP 状态（commit 失败是用户输入问题 → 400，非服务器错误 → 500）。
   * git 未安装（ENOENT）原样抛出，由 status() 识别为 isRepo:false。
   */
  private async execGit(
    args: string[],
    okCodes: number[] = [0],
    failStatus = 500,
  ): Promise<{ stdout: string; stderr: string }> {
    try {
      const { stdout, stderr } = await execFileP('git', ['-C', this.root, ...args], {
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024, // 大 diff 兜底（前端虚拟滚动，服务端不截断）
      });
      return { stdout, stderr };
    } catch (e) {
      const code = (e as { code?: string | number }).code;
      if (typeof code === 'number' && okCodes.includes(code)) {
        const { stdout, stderr } = e as { stdout?: string; stderr?: string };
        return { stdout: stdout ?? '', stderr: stderr ?? '' };
      }
      if (code === 'ENOENT') throw e; // git 未安装
      const msg = ((e as { stderr?: string }).stderr ?? '').trim() || (e as Error).message;
      throw new HttpError(failStatus, `git ${args[0]}: ${msg}`);
    }
  }

  /** git status --porcelain=v1 -z → { isRepo, changes }。非仓库 / git 缺失 → isRepo:false（前端空态）。 */
  async status(): Promise<GitStatus> {
    try {
      const { stdout } = await this.execGit(['status', '--porcelain=v1', '-z']);
      return { isRepo: true, changes: parseStatus(stdout).map((c) => ({ path: c.path, status: statusLabel(c.status) })) };
    } catch (e) {
      if ((e as { code?: string }).code === 'ENOENT') return { isRepo: false, changes: [] };
      if (e instanceof HttpError && /not a git repository|ambiguous argument/i.test(e.message)) {
        return { isRepo: false, changes: [] };
      }
      throw e;
    }
  }

  /**
   * 工作区 vs HEAD 的 unified diff 文本；未跟踪文件 HEAD 中不存在 → git diff HEAD 输出为空，
   * 回退 git diff --no-index /dev/null（整文件全 `+`，显示为"整文件新增"）。
   */
  async diff(relPath: string): Promise<string> {
    this.resolveInRoot(relPath); // 路径来自 status，此处纵深防御
    const { stdout } = await this.execGit(['diff', 'HEAD', '--', relPath], [0, 1]);
    if (stdout.length > 0) return stdout;
    const { stdout: full } = await this.execGit(['diff', '--no-index', '/dev/null', relPath], [0, 1]);
    return full;
  }

  /** 对每个勾选路径 git add，再 git commit -m <msg> -- <paths>。失败抛 400 带 git 原始错误。 */
  async commit(paths: string[], message: string): Promise<void> {
    const msg = typeof message === 'string' ? message.trim() : '';
    if (!Array.isArray(paths) || paths.length === 0) throw new HttpError(400, 'no paths selected');
    if (msg === '') throw new HttpError(400, 'empty commit message');
    for (const p of paths) {
      this.resolveInRoot(p);
      await this.execGit(['add', '--', p], [0], 400);
    }
    await this.execGit(['commit', '-m', msg, '--', ...paths], [0], 400);
  }

  /** 本地分支列表：for-each-ref 一次取 HEAD 标记 / 短名 / tip 短 hash。非仓库 → isRepo:false。 */
  async branches(): Promise<GitBranches> {
    try {
      const { stdout } = await this.execGit([
        'for-each-ref', '--format=%(HEAD)%00%(refname:short)%00%(objectname:short)', 'refs/heads',
      ]);
      const list: GitBranch[] = stdout.split('\n').filter(Boolean).map((line) => {
        const [head, name, tip] = line.split('\0');
        return { name, current: head === '*', tip };
      });
      const current = list.find((b) => b.current)?.name ?? null;
      return { isRepo: true, current, branches: list };
    } catch (e) {
      if ((e as { code?: string }).code === 'ENOENT') return { isRepo: false, current: null, branches: [] };
      if (e instanceof HttpError && /not a git repository|ambiguous argument/i.test(e.message)) {
        return { isRepo: false, current: null, branches: [] };
      }
      throw e;
    }
  }

  /** 提交日志：branch 缺省(null)=当前分支；提供则必须 ∈ branches()（白名单，防注入）。limit∈[1,100]、skip≥0 整数。非仓库 → isRepo:false 空态（spec §6.1）。 */
  async log(branch: string | null, limit: number, skip: number): Promise<GitLog> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new HttpError(400, 'invalid limit');
    if (!Number.isInteger(skip) || skip < 0) throw new HttpError(400, 'invalid skip');
    const b = await this.branches(); // 先查 isRepo：非仓库不跑 git log HEAD（会 500），直接返回空态；同时供 branch 白名单复用
    if (!b.isRepo) return { isRepo: false, commits: [] };
    let ref = 'HEAD';
    if (branch != null) {
      if (!b.branches.some((x) => x.name === branch)) throw new HttpError(400, 'unknown branch');
      ref = branch;
    }
    try {
      const { stdout } = await this.execGit([
        'log', ref, `--pretty=format:${COMMIT_FORMAT}`, `--skip=${skip}`, '-n', String(limit),
      ]);
      const commits = stdout.split('\n').filter(Boolean).map(parseCommitRecord).filter((c): c is GitCommit => c !== null);
      return { isRepo: true, commits };
    } catch (e) {
      // 空仓库（unborn，零提交）：显式传 HEAD 时 git 报 "ambiguous argument 'HEAD'"（老版本报 "does not have any commits yet"）→ 空列表而非 500
      if (e instanceof HttpError && /does not have any commits yet|ambiguous argument/i.test(e.message)) {
        return { isRepo: true, commits: [] };
      }
      throw e;
    }
  }

  /** 切换分支：name 必须 ∈ branches()。未提交改动冲突 → 400 带 git 原始 stderr（前端 Toast）。 */
  async checkout(name: string): Promise<void> {
    const b = await this.branches();
    if (!b.isRepo) throw new HttpError(400, 'not a git repository');
    if (!b.branches.some((x) => x.name === name)) throw new HttpError(400, 'unknown branch');
    await this.execGit(['checkout', name], [0], 400);
  }

  /** 新建分支并切过去（checkout -b）。名字先过 git check-ref-format 原生校验（非法名 exit 1 → 400）。 */
  async createBranch(name: string): Promise<void> {
    if (typeof name !== 'string' || name === '') throw new HttpError(400, 'invalid branch name');
    await this.execGit(['check-ref-format', '--branch', name], [0], 400);
    await this.execGit(['checkout', '-b', name], [0], 400); // 已存在/冲突 → 400 + stderr
  }

  /** 单次提交的元信息 + diff 正文。commit 只接受 log 返回的 hex（短/全 hash），白名单收紧。 */
  async show(commit: string): Promise<GitShow> {
    if (typeof commit !== 'string' || !/^[0-9a-f]{4,64}$/i.test(commit)) throw new HttpError(400, 'invalid commit');
    const { stdout: metaOut } = await this.execGit(['log', '-1', commit, `--pretty=format:${COMMIT_FORMAT}`]);
    const parsed = parseCommitRecord(metaOut.split('\n')[0]);
    if (!parsed) throw new HttpError(400, 'invalid commit');
    const { stdout: diffOut } = await this.execGit(['show', commit, '--format=']);
    return { commit: parsed, diff: diffOut.replace(/^\n+/, '') }; // 去掉 --format= 留下的头部空行
  }
}
