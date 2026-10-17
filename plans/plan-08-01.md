# Paper Puppeteer Engine — v0.8.1
## Actor Foundation

Continue developing my standalone Paper Puppeteer Engine project.

**Current completed version: v0.7.5**

### Technology stack
- TypeScript (strict)
- Phaser runtime
- React + TypeScript editor UI
- Vite, npm, ES modules

Existing features include:
- Skeletal Puppet runtime
- CharacterLoader
- Animation playback, queues and state controller
- `playAndWait()` and playback lifecycle
- Animation layers, IK and attachments
- Rig Editor and Animation Editor
- Character package export

Do NOT rebuild existing systems.

## Goal

Implement **v0.8.1 — Actor Foundation**.

An Actor is a higher-level runtime entity that wraps or references an existing Puppet and provides an extensible foundation for scripted character behavior.

The Actor layer must remain optional.

### 1. Inspect runtime architecture

Before coding, inspect:
- Puppet API and constructor
- World position and transform handling
- Phaser scene integration
- v0.7 animation lifecycle
- Async playback and cancellation
- CharacterLoader
- Runtime disposal and ownership

Follow existing architecture.

### 2. Actor abstraction

Introduce a typed Actor abstraction, conceptually:

```ts
const actor = new Actor({
  id: "character-a",
  puppet,
});

actor.play("idle");
```

Names and signatures should follow existing conventions.

Do not recreate animation playback inside Actor.

Delegate animation calls to the existing Puppet/runtime controller.

### 3. Spatial transform API

Expose a stable interface to inspect and update the actor's position.

Conceptually:

```ts
actor.position;
actor.setPosition(x, y);
```

Use the coordinate conventions already established by the runtime.

Do not duplicate authoritative position state.

Actor movement and Puppet rendering must remain synchronized.

### 4. Existing playback integration

Support delegation to existing runtime functionality such as:
- `play()`
- Animation state changes
- `playAndWait()`
- Stop/cancel where supported
- Skin/attachment changes where appropriate

Do not invent different animation-completion semantics.

### 5. Identity

Give actors stable instance identities.

Actor identity is separate from:
- Character definition ID
- Animation ID
- Puppet playback instance ID

Multiple actors should be able to share the same character definition.

### 6. Lifecycle and ownership

Define clearly whether an Actor owns its Puppet or merely references it.

Support safe disposal.

Prevent:
- Double destruction
- Dangling playback listeners
- Updates after disposal
- Ownership ambiguity

### 7. Runtime independence

The Actor layer must not depend on:
- React
- Editor controllers
- Animation timeline
- Rig-Tweak tools
- Editor working-copy state

Keep pure spatial utilities independent of Phaser where possible.

### 8. Public API

Expose Actor through an appropriate runtime module entry point.

Keep the existing Puppet API fully usable without Actor.

Prefer backward-compatible additions.

### 9. Tests

Add tests covering:
- Actor creation
- Identity
- Position synchronization
- Animation delegation
- Multiple Actors sharing one character definition
- Puppet ownership
- Disposal
- Invalid/disposed operations
- Runtime/editor dependency separation

### 10. Out of scope

Do NOT implement:
- Movement interpolation
- `walkTo()`
- `lookAt()`
- Choreography sequences
- Multi-actor scripting
- Physics
- Pathfinding
- Visual scene editor

### 11. Verification

Run and fix all failures:

```bash
npm run typecheck
npm run test
npm run build
```

## Definition of done

- Actor abstraction exists
- Actor can control an existing Puppet
- Position ownership is unambiguous
- Existing animation APIs are reused
- Multiple Actors can coexist
- Lifecycle and disposal are safe
- Runtime has no React dependency
- All required commands pass

## Final report

Provide:
1. Actor architecture
2. Public APIs
3. Position and ownership semantics
4. Files changed
5. Tests
6. Exact verification command results
7. Deferred v0.8.2 work

Do not claim completion unless required commands pass.
