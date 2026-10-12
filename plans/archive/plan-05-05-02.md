# Paper Puppeteer Engine — v0.5.5.2
## Runtime IK Animation Evaluation

Continue developing Paper Puppeteer Engine.

**Current completed version: v0.5.5.1**

The engine now has serializable IK target animation tracks with validation and keyframe mutation/query APIs.

Do not rewrite those systems.

Technology stack:
- React
- TypeScript
- Phaser
- Vite
- npm
- ES modules

Keep evaluator and math logic independent of React.

---

## Goal

Implement **v0.5.5.2 — Runtime IK Animation Evaluation**.

Animated IK target data must now drive the existing IK solver during playback and timeline scrubbing.

Do not create another IK solver.

## 1. Existing solver remains authoritative

Reuse:
- Existing two-bone analytical IK
- Existing bend-direction handling
- Existing unreachable-target behavior
- Existing coordinate conversion utilities
- Existing IK influence/mix implementation

Do not replace working IK mathematics.

## 2. Evaluate IK target tracks

At animation time `t`, evaluate each authored IK target's position and influence using the existing keyframe interpolation system.

Conceptually:

```text
Animation time
       ↓
Evaluate bone animation
       ↓
Evaluate IK target channels
       ↓
Resolve target transforms
       ↓
Apply existing IK constraints
       ↓
Final pose
```

The evaluated IK target state must not be stored back into AnimationDefinition.

## 3. Correct update order

Preserve the existing animation/constraint pipeline.

Review current ordering involving:
- Authored bone animation
- Animation layers
- Weapon primary grip
- Secondary grip target
- Hand IK
- Leg IK
- Foot planting
- Final rendering

Integrate animated IK targets without breaking established constraint dependencies.

Do not assume every constraint can be executed in arbitrary order.

## 4. Coordinate correctness

Interpret animated IK targets using the coordinate convention established in v0.5.5.1.

Convert to the solver's required coordinate space using existing helpers.

Verify correctness when:
- Puppet is translated
- Puppet is scaled
- Puppet faces left or right
- Parent bones rotate
- Nested constraints exist where supported

No screen-space values may leak into authored animation.

## 5. IK influence

If influence keys are supported, evaluate them over time.

Examples:

```text
0.0 s: influence 0
0.3 s: influence 1
1.0 s: influence 0
```

Preserve existing solver mixing semantics.

An IK influence of zero must return control to normal authored bone animation according to the existing runtime behavior.

## 6. Missing target channels

If an animation does not contain IK target keys:
- Preserve existing static IK behavior
- Preserve manual/runtime target overrides
- Preserve existing foot planting
- Preserve existing two-handed weapon constraints

Do not accidentally enable or disable constraints simply because an animation has no IK tracks.

## 7. Target ownership and precedence

Define deterministic precedence when:
- Rig has a default target
- Runtime API supplies a target
- Animation supplies an animated target
- A procedural system such as foot planting modifies a target
- Weapon constraints supply a secondary grip target

Preserve existing specialized constraint ownership.

Do not let a generic animated target silently override a mandatory weapon-grip target.

Document the resolution policy and test it.

## 8. Animation transitions

Ensure IK target animation behaves sensibly during:
- Crossfades
- Layered animation
- Partial animations
- Bone masks
- Animation completion
- Restart

Reuse existing animation blending semantics where possible.

Do not add an entirely separate animation state machine.

If target mixing requires a small extension, make it consistent with existing runtime layering and weighting.

## 9. Stepped and smooth interpolation

Animated target positions must respect authored interpolation.

Example:

```text
10 FPS stepped animation
Target positions update in steps
Phaser still renders at normal FPS
```

Do not throttle the entire Phaser scene.

## 10. Scrubbing

Animation Editor scrubbing should evaluate the same animated targets as normal runtime playback.

Do not advance time independently.

Scrubbing must not dispatch animation events.

## 11. IK output isolation

IK solver results modify only the evaluated/final pose.

They must NOT:
- Overwrite bone keyframes
- Modify IK target keys
- Mutate source animation
- Mutate bind/rest pose

Explicit IK baking remains deferred to v0.5.6.

## 12. Tests

Add tests for:
- Target evaluation at authored times
- Interpolation between target keys
- Animated influence
- Zero influence
- Constraint precedence
- Target coordinate conversion
- Facing
- Puppet scaling and translation
- Partial animation
- Crossfade behavior
- Stepped animation
- Unreachable targets
- Missing target tracks
- Old animation compatibility
- Source immutability
- No event dispatch during scrub

## 13. Manual verification

Use a simple arm IK constraint.

Test target positions at:

```text
0.0 s  → hand at A
0.5 s  → hand at B
1.0 s  → hand at C
```

Verify:
- Shoulder/upper arm/forearm respond correctly
- Hand reaches valid targets
- Bend direction remains stable
- Scrubbing produces correct results
- Playback works
- IK influence behaves correctly
- Facing still works

Also test existing weapon and foot planting behavior.

## 14. Do NOT implement yet

Do not implement:
- React IK timeline authoring controls
- Draggable IK gizmos
- IK target mirroring UI
- IK baking
- New IK solver algorithms
- New physics systems

## 15. Verification

Run:

```bash
npm run typecheck
npm run test
npm run build
```

Fix all failures.

## Definition of done

- Animated IK targets affect final pose
- Existing solver is reused
- Target interpolation works
- Influence interpolation works where supported
- Constraint precedence is deterministic
- Scrubbing matches runtime evaluation
- Crossfading and layering are handled consistently
- Existing IK/weapon/foot systems remain functional
- No authored bone data is overwritten
- Tests, typecheck and build pass

## Final report

Report:
1. Runtime evaluation architecture
2. IK target evaluation
3. Constraint update order
4. Coordinate conversions
5. Target precedence
6. Blending behavior
7. Files/APIs changed
8. Tests
9. Manual verification
10. Verification results
11. Deferred work

Do not claim completion unless all commands pass.
