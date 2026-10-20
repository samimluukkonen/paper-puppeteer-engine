# Paper Puppeteer Engine — v0.8.3
## Facing & Spatial Targeting

Continue developing Paper Puppeteer Engine.

**Current completed version: v0.8.2**

Stack: TypeScript (strict), Phaser runtime, React editor, Vite, npm and ES modules.

Existing systems:
- Actor/Puppet integration
- Actor movement
- Walking animation integration
- Existing Puppet facing support
- Skeletal transforms and attachment mirroring

Do not rebuild the facing implementation.

## Goal

Allow Actors to face positions and other Actors using the engine's existing orientation capabilities.

Target usage:

```ts
actor.faceLeft();
actor.faceRight();

actor.lookAt(otherActor);
actor.lookAt({ x: 500, y: 300 });
```

Use the actual project's API conventions.

## 1. Inspect existing facing model

Determine whether the Puppet supports:
- Left/right facing
- Horizontal flipping
- Additional facing orientations
- Facing-aware IK and attachment transforms

Do not assume it supports arbitrary 360-degree rotation.

### 2. Explicit facing API

Expose appropriate Actor methods that delegate to the existing Puppet facing system.

For a left/right-facing character:

```ts
actor.faceLeft();
actor.faceRight();
```

Do not mutate authored animation keyframes.

### 3. lookAt()

Allow an Actor to face:
- A point
- Another Actor

For left/right-facing rigs, use the target's horizontal position to select the appropriate supported facing direction.

Do not rotate the full skeleton to arbitrary angles unless the current runtime supports that behavior.

### 4. Same-position targeting

Handle cases where target and actor have the same horizontal position.

Prefer preserving current facing.

Avoid oscillating or selecting arbitrary directions.

### 5. World coordinates

Use actual Actor world positions.

Do not use:
- Screen pixel positions
- React viewport coordinates
- Raw pointer coordinates

Respect current Phaser transform conventions.

### 6. Move-facing integration

Optionally let `walkTo()` automatically orient the Actor toward its movement direction.

Make this configurable.

Example:

```ts
await actor.walkTo(500, 300, {
  faceMovement: true,
});
```

Do not change facing repeatedly when movement is effectively stationary.

### 7. IK and attachments

Verify facing changes preserve:
- IK target interpretation
- Weapon placement
- Slots and attachments
- Bone hierarchy
- Authored animation values

Do not bake mirrored poses or swap skin attachments merely because Actor changes facing.

### 8. Stale targets

If an Actor references another Actor as a look target:
- Handle disposed targets
- Handle self-targeting
- Handle invalid positions

For this phase, a one-time `lookAt()` operation is sufficient.

Continuous tracking can be deferred.

### 9. Tests

Cover:
- Facing left/right
- Target left/right
- Same horizontal position
- Actor target
- Self-target
- Disposed target
- Movement auto-facing
- Facing with IK
- Facing with attachments
- Authored animation immutability

### 10. Out of scope

Do NOT implement:
- Continuous target tracking
- Head-only look constraints
- 360-degree character rotation
- Camera tracking
- Pathfinding
- Scene sequencing

### 11. Verification

Run:

```bash
npm run typecheck
npm run test
npm run build
```

Fix all failures.

## Definition of done

- Actor can change supported facing directions
- `lookAt()` works for positions and Actors
- World-coordinate conventions are correct
- Walking can orient the Actor if configured
- IK/attachments remain compatible
- Animation data is never modified
- All required commands pass

## Final report

Describe:
1. Facing APIs
2. Spatial targeting behavior
3. Movement integration
4. Limitations of supported facing directions
5. Files/APIs changed
6. Tests
7. Verification results
8. Deferred functionality

Do not claim completion unless all commands pass.
