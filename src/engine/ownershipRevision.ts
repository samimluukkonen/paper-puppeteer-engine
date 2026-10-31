// Internal, conservative invalidation shared by movement and playback commands. A callback
// can change any Actor, so checking only the Actor that just updated is insufficient.
// Clock advances and natural completions retain ownership and must not bump this revision.
let revision = 0;

export function getOwnershipRevision(): number {
  return revision;
}

export function invalidateOwnership(): void {
  revision++;
}
