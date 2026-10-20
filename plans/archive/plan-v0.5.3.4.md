# Paper Puppeteer Engine — v0.5.3.4
## Onion Skinning Production Hardening & Regression

Continue developing Paper Puppeteer Engine.

**Current completed version: v0.5.3.3**

The Animation Editor now has:
- Read-only ghost pose sampling
- Previous/next ghost rendering
- Multiple ghosts per direction
- Configurable frame spacing
- Adjustable opacity/tint
- Onion skinning controls
- Ghost synchronization
- Editor-only state isolation

This phase completes v0.5.3.

Do not introduce major new features.

## Goal

Harden the onion-skin implementation and verify that it is reliable for actual animation-authoring work.

Focus on:
1. Sampling correctness
2. Rendering correctness
3. Playback and editing synchronization
4. Performance
5. Resource lifecycle
6. IK/facing/attachment compatibility
7. Regression tests
8. Documentation

## 1. Pose evaluation correctness

Verify ghost sampling uses the existing runtime animation evaluator.

Compare sampled poses with the normal Puppet preview evaluated at the same times.

Verify:
- Parent/child transforms
- Rotation interpolation
- Partial tracks
- Stepped interpolation
- Smooth interpolation
- Bone masks/layers where applicable
- Bind/rest fallback

Do not create a separate animation evaluator.

## 2. Animation editing synchronization

Ghosts must refresh correctly after:
- Creating keys
- Updating keys
- Deleting keys
- Moving keys
- Multi-key group movement
- Copy/paste
- Duplicate
- Changing interpolation
- Undo/Redo
- Importing animation JSON
- Reverting animation
- Switching selected animation

Ghosts must always reflect the current working animation.

No stale cached animation data.

## 3. Editor navigation

Test:
- Scrubbing
- Timeline scrolling
- Timeline zoom if supported
- Playback
- Pause
- Restart
- Loop
- Playback speed changes
- Frame snapping

Ghost visibility must not change `currentTime` or playhead behavior.

## 4. Visual transform correctness

Verify correct positioning when:
- Puppet is translated
- Puppet scale changes
- Preview facing changes
- Parent bones rotate
- Sprite origins/offsets are non-default
- Attachments have different render depths
- Skins are switched

Ghost and active puppet transforms must share the correct coordinate conventions.

## 5. IK

Review ghost behavior with IK preview enabled and disabled.

Preserve the existing distinction between authored poses and IK-corrected final poses.

If the sampler renders authored poses only, make that clear in documentation and, where useful, the UI.

Do not allow procedural IK to mutate sampled authored data.

Do not attempt IK baking.

## 6. Runtime events

Ghost sampling must never dispatch animation events.

Verify that events do not fire when:
- Onion skinning is toggled
- Ghost count changes
- Ghost spacing changes
- Current time is scrubbed
- An animation is imported
- Interpolation changes
- Ghosts refresh

Normal active playback event semantics must remain unchanged.

## 7. Performance

Test with:
- One ghost per direction
- Three ghosts per direction
- Multiple attached sprites per bone
- Longer animations
- Rapid timeline scrubbing
- Normal playback

Avoid:
- Repeated texture loads
- Unbounded GameObject creation
- Per-frame rig reconstruction
- Repeated DOM rebuilding
- Redundant pose evaluations

Use bounded caching or pooling where practical.

Invalidate cached ghost poses when authored animation or relevant preview configuration changes.

Do not overengineer optimization without evidence of a bottleneck.

## 8. Resource cleanup

Verify correct cleanup when:
- Onion skinning is disabled
- Animation changes
- Character changes
- Editor route changes
- Scene shuts down
- Editor is destroyed

No orphaned Phaser objects or event listeners.

## 9. Edge cases

Test:
- No animation selected
- Empty animation
- Zero-duration animation
- One-key animation
- Very short animation
- Missing optional attachments
- Valid skin changes
- At time zero
- At animation duration
- FPS changes
- Ghost count zero
- Maximum ghost count
- Invalid control values

No crashes, invalid times, NaN transforms, or phantom ghosts.

## 10. Import/export regression

Verify onion-skin settings do not appear in:
- `animation.json`
- `rig.json`
- Character manifests

Normal animation export/import must continue to work.

Exported animation data must remain equivalent whether onion skinning is enabled or disabled.

## 11. Rig Editor regression

Verify the Rig Editor still supports:
- Bone selection
- Joint dragging
- Sprite origin/offset editing
- Slot editing
- IK preview
- Undo/Redo
- Rig export

Onion-skin visualization must remain exclusive to the Animation Editor unless explicitly integrated elsewhere.

## 12. Full Animation Editor regression

Check:
- Playback
- Scrubbing
- Timeline ruler
- Bone/property tracks
- Keyframe creation
- Keyframe movement
- Multi-selection
- Copy/paste
- Duplicate
- Snapping
- Interpolation editing
- Animation events
- History
- Validation
- Animation import/export

No regressions.

## 13. Documentation

Update artist-facing Animation Editor documentation.

Explain:
- What onion skinning is
- How to enable it
- Previous vs next ghosts
- Frame spacing
- Opacity/tint settings
- Authored FPS relationship
- Boundary behavior
- IK preview limitations
- Why ghosts are not editable animation data

Include a short workflow example for refining an arm movement using several ghost poses.

## 14. Automated tests

Expand tests where needed for:
- Sampling and evaluator equivalence
- Correct time offsets
- Boundary behavior
- Working-copy changes
- Cache invalidation
- Transient/editor-only state
- No event dispatch
- No source mutation
- Undo/Redo refresh
- Import/export independence
- Resource lifecycle where practical

Prefer pure tests and existing test patterns.

## 15. Do NOT implement yet

Explicitly defer:
- Mirrored pose/keyframe copying
- Symmetry mappings
- IK target authoring
- IK baking
- Direct ghost manipulation
- Mesh deformation
- Physics
- Scene choreography
- Sprite import/replacement workflow
- Animation Editor Rig-Tweak mode

## 16. Required commands

Run:

```bash
npm run typecheck
npm run test
npm run build
```

Fix all failures.

## Final v0.5.3 definition of done

v0.5.3 is complete when:
- Read-only neighboring poses can be sampled
- Previous/next ghosts render correctly
- Multiple ghosts work
- Spacing/opacity/tint controls work
- Ghosts update during editing and playback
- Existing animation semantics remain authoritative
- No authored data is changed by onion skinning
- Animation events are not dispatched by sampling
- Performance remains practical
- Resources clean up correctly
- Animation import/export is unaffected
- Rig Editor and Animation Editor have no regressions
- Documentation is updated
- Tests pass
- Typecheck passes
- Build passes

## Final report

Provide:
1. Implemented features
2. Ghost sampling/rendering architecture
3. Animation/editor synchronization
4. Cache and resource lifecycle
5. IK/facing behavior
6. Performance findings
7. Files/APIs changed
8. Automated tests
9. Manual verification
10. Documentation changes
11. Exact results of typecheck/test/build
12. Deferred features

Do not claim completion unless all required commands pass.
