// server/tab-store.ts
type UserState = { front: string | null; opened: Set<string>; lastSeen: number };

/**
 * 内存级共享标签存储。存续规则：
 * 标签从列表移除 ⟺ 没有任何活跃用户把 front 指向它。
 * 不活跃（心跳超时）用户的前台持有被忽略，但其 opened 集合保留。
 */
export class TabStore {
  private tabs: string[] = [];
  private users = new Map<string, UserState>();

  constructor(
    private heartbeatTimeoutMs = 90_000,
    private now: () => number = Date.now,
  ) {}

  list(): string[] {
    return [...this.tabs];
  }

  open(userId: string, path: string): void {
    const u = this.user(userId);
    u.opened.add(path);
    if (!this.tabs.includes(path)) this.tabs.push(path);
  }

  close(userId: string, path: string): void {
    const u = this.user(userId);
    u.opened.delete(path);
    if (u.front === path) u.front = null;
    if (this.hasActiveFront(path)) return;
    this.tabs = this.tabs.filter((t) => t !== path);
  }

  setFront(userId: string, path: string | null): void {
    this.user(userId).front = path;
  }

  heartbeat(userId: string): void {
    this.user(userId); // user() 内刷新 lastSeen
  }

  restore(paths: string[]): boolean {
    if (this.tabs.length > 0) return false;
    this.tabs = [...new Set(paths)];
    return true;
  }

  private user(userId: string): UserState {
    let u = this.users.get(userId);
    if (!u) {
      u = { front: null, opened: new Set(), lastSeen: this.now() };
      this.users.set(userId, u);
    }
    u.lastSeen = this.now(); // 任何操作顺带更新心跳
    return u;
  }

  private isActive(u: UserState): boolean {
    return this.now() - u.lastSeen < this.heartbeatTimeoutMs;
  }

  private hasActiveFront(path: string): boolean {
    for (const u of this.users.values()) {
      if (u.front === path && this.isActive(u)) return true;
    }
    return false;
  }
}
