// server/workspace.ts
// 一个工作区的全部有状态组件：文件、标签、终端、Git、LSP。
// 宿主本身和每个附加挂载各持有一套，路由通过各自的 Router 隔离。
import { FileStore } from './files.ts';
import { TabStore } from './tab-store.ts';
import { TerminalManager } from './terminal.ts';
import { Git } from './git.ts';
import { LspManager } from './lsp-manager.ts';
import type { Router } from './http.ts';
import type { IdentityProviders } from './mount-types.ts';
import { registerFsRoutes } from './routes/fs.ts';
import { registerTabsRoutes } from './routes/tabs.ts';
import { registerTerminalRoutes } from './routes/terminal.ts';
import { registerGitRoutes } from './routes/git.ts';
import { registerSystemRoutes } from './routes/system.ts';
import { registerIdentifyRoutes } from './routes/identify.ts';
import { registerLspRoutes } from './routes/lsp.ts';

export type Workspace = {
  dir: string;
  files: FileStore;
  tabs: TabStore;
  terminals: TerminalManager;
  git: Git;
  lsp: LspManager;
};

export function createWorkspace(dir: string): Workspace {
  return {
    dir,
    files: new FileStore(dir),
    tabs: new TabStore(),
    terminals: new TerminalManager(dir),
    git: new Git(dir),
    lsp: new LspManager({ workspaceRoot: dir }),
  };
}

/** 在给定 Router 上注册一整套工作区路由；同一 Router 只调用一次。 */
export function registerWorkspaceRoutes(
  router: Router,
  workspace: Workspace,
  providers: IdentityProviders,
): void {
  registerFsRoutes(router, workspace.files);
  registerTabsRoutes(router, workspace.tabs);
  registerTerminalRoutes(router, workspace.terminals, workspace.files);
  registerGitRoutes(router, workspace.git);
  registerSystemRoutes(router, workspace.dir);
  registerIdentifyRoutes(router, workspace.dir, providers);
  registerLspRoutes(router, workspace.lsp);

  router.onClose(() => workspace.terminals.closeAll());
  router.onClose(() => workspace.lsp.dispose());
}
