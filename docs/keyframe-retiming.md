# Bulk keyframe retiming — v0.5.7.4

[All guides](../README.md#guides)

Select several bone property keys across tracks, including hidden selected keys if desired. Open **Tools → Retime selected keys**. The panel displays the actual property-key count, a positive time scale, and an anchor choice. For example, 0.5× halves the time distances from the anchor, while 1.5× increases them by half.

Choose **First selected time** to hold the earliest key in place, or **Playhead** to scale times on both sides of the current editor clock. Click **Preview** for a numerical table of every authored before/after time and the number of unselected destination keys that would be replaced. Preview never modifies authored data, dirties the animation, creates history, seeks the playhead, pauses playback, samples a puppet pose, or dispatches animation events. Closing/unmounting the panel clears its preview. Selection, animation/session, scale and anchor changes also invalidate it; playhead changes invalidate a Playhead-anchored preview.

**Apply** validates a fresh proposal against the current selection and clock, pauses playback, commits one history snapshot, refreshes the animation preview and keeps updated keys selected with the same primary member. One **Undo** restores the exact original snapshot, including any replaced destination keys; **Redo** restores the committed result. History uses the existing selection reconciliation rules, so keys that no longer exist at selected times are removed from the selection. Scale 1× and a zero-span group anchored at its first time are no-ops and create no history.

## Supported data and policies

- All ordinary bone transform properties: X/Y, rotation and Scale X/Y. Sparse siblings that are not selected keep their authored times and values.
- Typed IK X/Y target and Mix/Influence channels. The editor's existing IK selection supports one channel key at a time; the pure operation can accept several IK keys, or a mixed bone/IK group. It never interprets an IK constraint as a bone.
- Animation events are excluded and their markers, times, names and payloads stay unchanged.
- Authored values, bone/constraint identities, clip-level interpolation, playback mode/FPS, loop settings, disabled IK constraints and unrelated tracks remain unchanged. Values are read from authored keys, never recomputed from the evaluated puppet pose.
- Scale must be finite and greater than zero. Reverse time is unsupported.
- Duration never expands. A proposed time outside `[0, duration]` rejects the entire operation. The shared nanosecond time tolerance only normalizes boundary floating point noise; it is not a per-key duration-clamping policy.
- Frame/key/event/playhead snapping preferences do not affect retiming. Every time follows `anchor + (oldTime - anchor) * scale` without individual frame snaps.
- All selected source properties are removed from a detached candidate before destination replacement, so a selected key's original position is never an external collision. Unselected matching destination properties use the existing group-movement policy: replace every match within the shared time tolerance while preserving unrelated sparse-row siblings. Selected destinations keep their exact proportional times, even when closer than the lookup tolerance.
- Duplicate destinations that cannot preserve distinct selected keys at JavaScript's time precision reject the entire proposal. Invalid factors, references, bounds, precision or final animation validation commit nothing and create no history entry.

## Editor APIs

The editor compatibility module `keyframes.ts` exports `retimeSelectedKeys`, `RetimeOptions`, `RetimeResult`, `RetimeChange` and `RetimeKeySelection`. These editor APIs are not engine package exports. The operation receives a validated rig and existing bone/IK selection references in editor seconds; options and change summaries use authored milliseconds explicitly.

```ts
const proposal = retimeSelectedKeys(animation, rig, selectedKeys, {
  scale: 0.5,
  anchor: 'playhead',
  playheadTimeMs: 500,
});
// proposal.animation is a detached, validated candidate.
// proposal.keys contains canonical destination selection references.
// proposal.changes contains before/after references and exact authored milliseconds.
// proposal.replacedKeys counts replaced unselected property keys.
```

`AnimationEditorState.previewKeyframeRetiming({ scale, anchor })` builds the proposal without session mutations. `AnimationEditorState.retimeSelectedKeyframes({ scale, anchor })` commits through the existing document/history boundary. Both use the sole current editor clock for Playhead anchoring. The React controller retains numerical proposals only while their dependencies remain current.

The shared `setTrackPropertyKeyframes` mutation helper now resides in engine `keyframeAuthoring.ts`, with property typing for both bone and IK rows. Existing setters, paste and group movement reuse the same implementation; retiming uses its timing-preserving batch policy and the existing final animation validator.

## Verification

Unit regressions in `animationEditorRetiming.test.ts` cover compression/expansion, both anchors, multiple tracks, mixed bone/IK keys, external replacements, selected source overlap, tolerant neighboring keys, fractional authored times, zero-span/no-op groups, invalid factors/references, bounds/precision atomicity, interpolation/FPS/event preservation, primary selection, notification ordering, Undo/Redo, source immutability and runtime-compatible JSON export.

Local-only `animationRetiming.spec.ts` browser scenarios exercise numerical preview, 0.5× compression, Undo, 1.5× expansion, destination replacement, Redo, playback and JSON download, Playhead anchoring, duration overflow, invalid factors, close/reopen, animation-switch cleanup and selected IK Influence-channel retiming. Run these against development and production builds with an installed Chrome:

```bash
npm run typecheck
npm run test
npm run build
PLAYWRIGHT_CHANNEL=chrome npx playwright test tests/browser/animationRetiming.spec.ts
```

For a human check, select several keys across multiple bone tracks, compress to 0.5×, Undo, expand to 1.5×, try Playhead anchoring, replace a same-property destination key, and reject an overflowing scale. Confirm failed proposals change nothing, play the result, use Undo/Redo, and inspect unchanged event markers. A selected IK key can be tested using Playhead anchoring, since its first-time anchor gives a zero span.

Marker overlays for retiming, IK group-selection UI, automatic event retiming, optional retiming snapping, reverse-time keys, key reduction, easing changes, motion paths, new IK solvers and scene choreography remain deferred.
