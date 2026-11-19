// server/agent-spawn.ts
// Launch command for a native ACP agent.
//
// On Windows npm installs CLIs as `.cmd` shims, and Node cannot spawn a batch
// file directly (`spawn('opencode.cmd')` throws EINVAL), so those must run
// through cmd.exe (`shell: true`). With a shell, Node concatenates the
// executable and args into one command line without escaping, so the
// executable has to be quoted to survive spaces and cmd metacharacters.
// Other executables spawn directly: args stay separate, paths need no quoting,
// and killing the child hits the agent instead of an intermediate cmd.exe.

export type AgentSpawnCommand = {
  file: string;
  shell: boolean;
};

export function agentSpawnCommand(
  executable: string,
  platform: NodeJS.Platform = process.platform,
): AgentSpawnCommand {
  if (platform !== 'win32' || !/\.(cmd|bat)$/i.test(executable)) {
    return { file: executable, shell: false };
  }
  return { file: `"${executable}"`, shell: true };
}
