# Mirrored keyframe authoring

[All guides](../README.md#guides)

Milestone v0.5.4.3, package version `0.5.4-3`, adds explicit current-pose and selected-key mirroring commands to the animation editor authoring layer. [React mirror controls](react-mirroring-tools.md) and [hardening](mirroring-hardening-verification.md) are now complete. The existing [bone symmetry mapping](bone-symmetry-mapping.md), [bind-relative pose math](pose-mirroring.md), runtime evaluator, batch edits and document history remain authoritative.

## APIs

[keyframeMirroring.ts](../src/devtools/animation-editor/keyframeMirroring.ts), also exported through the editor's `keyframes.ts` compatibility entry, provides pure proposals:

```ts
mirrorCurrentPoseToKeys(animation, rig, mapping, currentTimeMs, direction, options);
mirrorSelectedKeyframes(animation, rig, mapping, selectedKeys, direction);
```

Both return `{ animation, keys }`. Key references use `{ boneId, property, timeMs }` in milliseconds. The original animation and rig are never mutated or frozen. Invalid requests throw actionable errors; mirror math failures retain their structured issues through `AnimationValidationError`. These are editor APIs, not new engine package exports or file schemas.

The state facade exposes intentional authored commands using its session mapping and timeline selection:

```ts
state.mirrorCurrentPoseToKeys('left-to-right');
state.mirrorCurrentPoseToKeys('swap', {
  boneIds: ['leftArm', 'rightArm'],
  properties: ['rotation'],
});
state.mirrorSelectedKeyframes('right-to-left');
```

State commands return a success boolean and report validation issues on failure. Current-pose mirroring defaults to the selected source bone, or all mapped source bones when no bone is selected. Explicit `boneIds` override that scope; an empty array selects none. The pure current-pose API defaults to all mapped source bones.

## Evaluation and sparse properties

Current-pose mirroring evaluates the held authored pose with existing playback sampling, before temporary transform drafts, presets, IK and render projection. It writes keys at the exact current time, without snapping, duration extension or resampling. By default each source bone contributes only properties authored anywhere on its track. Unanimated bones with no requested properties are excluded from transform reflection, so their unsupported bind transforms do not block unrelated sparse edits; complete mapping/hierarchy validation still applies. Explicit `properties` intentionally keys those properties, including bind values on otherwise unanimated bones.

Selected-key mirroring resolves every reference against the original animation and groups sources by exact authored time. It evaluates each time through the existing runtime clip evaluator and calls `mirrorPose` with those source bones. Evaluated context includes unselected properties: for example, mirrored X can depend on Y in rotated bind frames. Only selected destination properties are written. Unselected properties never become keys merely because they contributed to mirror math.

Selected keys use raw authored sampling rather than stepped playback quantization. A rotation key at 350 ms retains its authored value even when a 10 FPS preview would hold the 300 ms sample. Current-pose mirroring intentionally samples that held preview value, while authoring it at 350 ms.

Left-to-right and right-to-left require references on the requested source side; wrong-side or unpaired references reject the complete request. Swap sends each requested source to its counterpart using the unchanged original animation. It does not synthesize additional unselected counterpart keys. The optional `mirrorPose` fifth argument, `{ sourceBoneIds }`, scopes reflection while retaining complete mapping validation and the existing math.

## Timing, metadata and collisions

Source key times and animation duration remain exact. The version 1 format supports clip-level linear interpolation only, including its implicit default; the declaration remains unchanged. Smooth/stepped playback settings and FPS remain unchanged. No per-key interpolation format or new evaluator is introduced.

Mirroring reuses `setBonePropertyKeyframes` with `preserveTiming: true`, matching group paste/movement replacement. Existing destination keys within the shared one-nanosecond time tolerance are replaced on the affected property. Sibling properties retain their own values and times. External collisions are removed before inserting the full group, so distinct nearby source times survive. Duplicate source references resolve to one write; duplicate destination identities cannot create duplicate keys.

All mapping, source, transform and destination checks finish before a proposed batch passes existing animation validation. Singular scales, animated axis-sign changes and unrepresentable shear retain the pose core's rejection behavior. A failure at any source/time exposes no partial authored mutation.

## Transactions and ownership

[AnimationEditorKeyframeCommands](../src/devtools/animation-editor/AnimationEditorKeyframeCommands.ts) constructs the complete proposal before touching playback, gestures, drafts or selection. One successful command pauses playback, cancels gestures, restores the held clock time and installs one document snapshot. It creates one history entry and one dirty-state invalidation for changed authored data, with one state notification after selection is coherent. An unchanged authored result adds no history entry. Empty operations return false without installing a snapshot.

Destination keys become selected. Selected-key mirroring follows the original primary key to its counterpart; bone/property selection follows that destination. The playhead does not seek to the primary key. Undo restores the exact previous snapshot, including replaced destination rows, and Redo restores the committed mirror snapshot. Selection follows existing history reconciliation rather than entering authored history. Saved checkpoints retain their normal dirty behavior.

Events, event payloads, slots, attachment assignments, skins, facing and IK targets are never mirrored or authored. The implementation does not read live Puppet joints, so final IK rotations cannot be baked into these commands.

## Verification and deferred features

[keyframeMirroring.test.ts](../tests/keyframeMirroring.test.ts) covers both APIs, all directions, bind-aware single bones, multiple bones/properties/times, evaluated context, sparse defaults, explicit property scopes, stepped sampling, exact collision timing, immutable inputs, atomic errors, one notification/history entry, dirty checkpoints, selection reconciliation, Undo/Redo and shipped pre-IK animation sampling.

Verification on October 11, 2026:

- `npm run typecheck`: passed.
- `npm run test`: passed; 1,606 tests passed and 28 optional profiling tests skipped, across 99 passing and 3 skipped files. This milestone adds 27 mirroring authoring regressions.
- `npm run build`: passed, including demo/library output, declarations and the plain Node `/core` check.
- `npm run lint`, `npm run format:check`, `npm run check:version` and `git diff --check`: passed.

Automatic animation generation, time reversal, cross-animation mirroring, event/IK target mirroring, sprite replacement and rig joint editing remain deferred. Browser tests remain local-only by repository policy.
