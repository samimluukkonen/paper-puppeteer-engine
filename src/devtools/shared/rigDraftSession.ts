/** Both editor routes recover the same character rig drafts; each browser tab retains its own envelope. */
export function rigDraftKey(pathname: string, characterId: string, filename: string): string {
  return JSON.stringify([pathname.replace(/\/animation-editor(?=\/|$)/, '/rig-editor'), characterId, filename]);
}
