export async function runSessionPreflight(options: {
  saveConfig: () => Promise<void>;
  getGitCredential?: () => Promise<string>;
}): Promise<string> {
  await options.saveConfig();
  return (await options.getGitCredential?.()) ?? "";
}
