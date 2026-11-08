// server/mount-types.ts
// 挂载与附加的跨层数据结构：HTTP 身份接口与挂载表共用。

/** 一个工作区挂载的对外描述；workspace/base 均为规范值，不含 origin。 */
export type MountWire = {
  name: string;
  index: number;
  workspace: string;
  /** 规范地址：/-/<name>/-/<index> */
  base: string;
  /** index 0 的简写：/-/<name>；index > 0 为 null。 */
  shorthand: string | null;
  /** 宿主自身保留根路径 /，因此同时可从 /xxx 访问。 */
  legacyRoot: boolean;
};

export type AttachInfo = {
  /** --no-attach 时为 false；附加接口只接受回环地址请求。 */
  available: boolean;
};

export type IdentityProviders = {
  getMounts?: () => MountWire[];
  getAttach?: () => AttachInfo;
};
