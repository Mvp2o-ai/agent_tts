/** Keep an explicit live auth update that arrived while secure storage loaded. */
export function resolveDesiredGitCredential(
  desiredCredential: string,
  revisionBeforeFetch: number,
  revisionAfterFetch: number,
  fetchedCredential: string,
): string {
  return revisionBeforeFetch === revisionAfterFetch
    ? fetchedCredential
    : desiredCredential;
}
