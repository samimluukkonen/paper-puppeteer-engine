import type { Actor } from './Actor.js';
import type { Puppet } from './Puppet.js';

/** A choreography branch already has exclusive control of this Actor's Puppet. */
export class ChoreographyConflictError extends Error {
  constructor(readonly actorId: string) {
    super(`Choreography Actor "${actorId}" conflicts with another choreography branch.`);
    this.name = 'ChoreographyConflictError';
  }
}

// Share claims across contexts and Actor wrappers without retaining Puppets globally.
const claims = new WeakSet<Puppet>();

export function claimChoreographyActor(actor: Actor): () => void {
  if (claims.has(actor.puppet)) throw new ChoreographyConflictError(actor.id);
  claims.add(actor.puppet);
  return () => claims.delete(actor.puppet);
}
