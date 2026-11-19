// server/agent-profiles.ts
// Native ACP agents that anther can launch directly. Adapter-based agents are
// intentionally not included yet.
import { constants } from 'node:fs';
import { access } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

export type AgentProfile = {
  id: string;
  name: string;
  command: string;
  args: string[];
  /** Common installer locations that are not always on PATH. */
  knownPaths?: string[];
};

const PROFILES: AgentProfile[] = [
  {
    id: 'opencode',
    name: 'OpenCode',
    command: 'opencode',
    args: ['acp'],
    knownPaths: [
      path.join(homedir(), '.opencode', 'bin', 'opencode'),
      path.join(homedir(), '.local', 'bin', 'opencode'),
      '/usr/local/bin/opencode',
      '/usr/bin/opencode',
    ],
  },
  {
    id: 'command-code',
    name: 'Command Code',
    command: 'command-code',
    args: ['acp'],
    knownPaths: [
      path.join(homedir(), '.local', 'bin', 'command-code'),
      '/usr/local/bin/command-code',
    ],
  },
];

export type DiscoveredAgent = {
  profile: AgentProfile;
  executable: string;
};

type DiscoveryOptions = {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  home?: string;
  profiles?: readonly AgentProfile[];
};

/** Discover every known native ACP agent, in profile priority order. */
export async function discoverAgents(options: DiscoveryOptions = {}): Promise<DiscoveredAgent[]> {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const home = options.home ?? homedir();
  const pathEntries = (env.PATH ?? env.Path ?? '')
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean);

  const found: DiscoveredAgent[] = [];
  for (const profile of options.profiles ?? PROFILES) {
    const executable = await findExecutable(profile, pathEntries, platform, env, home);
    if (executable) found.push({ profile, executable });
  }
  return found;
}

/** Pick the highest-priority available native ACP agent. */
export async function discoverAgent(options: DiscoveryOptions = {}): Promise<DiscoveredAgent | undefined> {
  return (await discoverAgents(options))[0];
}

async function findExecutable(
  profile: AgentProfile,
  pathEntries: string[],
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
  home: string,
): Promise<string | undefined> {
  const candidates = [
    ...pathEntries.map((dir) => path.join(dir, profile.command)),
    ...(profile.knownPaths ?? []).map((entry) => entry.replace(/^~(?=$|[\\/])/, home)),
  ];
  for (const candidate of candidates) {
    for (const executable of executableCandidates(candidate, platform, env)) {
      if (await isExecutable(executable, platform)) return executable;
    }
  }
  return undefined;
}

function executableCandidates(file: string, platform: NodeJS.Platform, env: NodeJS.ProcessEnv): string[] {
  if (platform !== 'win32') return [file];
  if (path.extname(file)) return [file];
  const extensions = (env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean);
  // npm installs both a bare POSIX shim (for Git Bash) and a Windows `.cmd`
  // shim. cmd.exe only runs the PATHEXT variant, so prefer it over the bare
  // script that would fail to launch.
  return [...extensions.map((ext) => `${file}${ext.toLowerCase()}`), file];
}

async function isExecutable(file: string, platform: NodeJS.Platform): Promise<boolean> {
  const mode = platform === 'win32' ? constants.F_OK : constants.X_OK;
  try {
    await access(file, mode);
    return true;
  } catch {
    return false;
  }
}

export function agentProfiles(): readonly AgentProfile[] {
  return PROFILES;
}
