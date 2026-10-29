# Schema versions and compatibility

[All guides](../README.md#guides)

Engine release **1.4.2-1** supports the following authored JSON formats. Engine SemVer and JSON `version` fields are separate: upgrading the engine does not upgrade character files.

| Document                     | Supported version                | Required fields                                                          | Optional fields                                                                          |
| ---------------------------- | -------------------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| Scene                        | `2` (`SCENE_FORMAT_VERSION`)     | `version`, `id`, `name`, `duration`, `actors`, `actions`                 | See [scene actions and version-1 migration](scene-editor.md#timing-and-ownership)        |
| Rig                          | `1` (`RIG_FORMAT_VERSION`)       | `version`, `root`, `bones`                                               | `name`, `slots`, `attachments`, `skins`, `ik`, `footContactMarkers`                      |
| Animation                    | `1` (`ANIMATION_FORMAT_VERSION`) | `version`, `name`, `duration`, `loop`, `tracks`                          | `interpolation`, `playback`, `events`, `ikTracks`, `disabledIKConstraints`, `rootMotion` |
| Skin, embedded or standalone | `1`                              | `version`, `name`, `slots`                                               | None                                                                                     |
| Static pose                  | `1` (`POSE_FORMAT_VERSION`)      | `version`, `name`, `bones`                                               | `library` provenance (v1.1.1)                                                            |
| Character manifest           | `1` (`CHARACTER_FORMAT_VERSION`) | `version`, `id`, `rig`, `defaultSkin`, `skins`, `animations`, `textures` | `poses`                                                                                  |

The authoritative runtime validators are Zod definitions in `src/engine/schemas.ts`, plus reference/timeline checks in `validation.ts`, `externalData.ts`, `Pose.ts` and `CharacterDefinition.ts`. The editor JSON Schemas in `schemas/` are generated from these same file shapes with `npm run schemas:generate`. JSON Schemas describe structure and scalar constraints; loading still requires semantic validation. The TypeScript contracts are `RigJsonDefinition`, `AnimationJsonDefinition`, `SkinDefinition`, `PoseDefinition` and `CharacterManifest`, available through `/data` and the relevant runtime/serialization entry points. TypeScript-defined runtime rigs and clips omit file-level version metadata; this does not make unversioned imported JSON valid.

## Nested fields and defaults

Optional [foot contact markers](foot-contact-markers.md) extend version-1 rigs with stable IDs, names, existing bone references and finite bone-local coordinates. Marker IDs must be unique; no pairs or contacts are required.

Identifiers are nonempty strings; `__proto__` is reserved. Every authored number must be finite. Transforms use local `x`, `y`, `rotation` in radians and unitless `scaleX`/`scaleY`. Omitted joint/slot/attachment transforms default to zero translation/rotation and unit scale. Defaults are evaluated at runtime; importing or serializing does not insert them into authored files.

- Each bone requires `id`. Every non-root bone requires `parent`; the root has no parent. Optional fields are the five transforms, nonnegative `length`, `depth` and `sprite`. Omitted length is inferred from child geometry where needed; render ordering follows the existing hierarchy/depth rules.
- A bone sprite requires `texture`. Optional fields are `frame`, `x`, `y`, `originX`, `originY`, `scaleX`, `scaleY`, `depth`. Origins default to `0.5` and must be within `0..1`. Sprite offsets default to zero and scales to one. Omitted frame uses the texture's base frame.
- Each slot requires `id`, `bone`; optional fields are transforms and `depth`. Omitted depth follows its bone's render order. Each attachment requires `id`, `texture`; optional fields are `frame`, transforms and normalized origins. Attachment IDs are independent of texture keys and bone IDs.
- A skin's `slots` dictionary maps slot IDs to attachment IDs or `null`. `setSkin` replaces the whole selection, leaving omitted slots empty. `applySkin` overlays only named slots; omitted slots retain their current assignment, and `null` clears one. A standalone skin replaces an embedded skin with the same name; other embedded skins remain available.
- Each IK definition requires `name`, `rootBone`, `middleBone`, `endBone`, naming three directly connected joints. Optional fields are `target` (finite `x` and `y` in puppet-local coordinates; omitted targets preserve existing runtime/animation behavior), `endOffset` (both `x` and `y` required when present; default zero), `bendDirection` (default `1`, also accepts `-1`), `mix` (`0..1`, default `1`), `enabled` (default `true`), `priority` (default `0`). Constraints evaluate in priority order.
- An animation's duration is positive milliseconds; `loop` is required. `tracks` maps bone IDs to arrays of rows requiring `time`, with optional transform channels. Empty tracks and sparse transform rows remain supported. Times must increase strictly within `0..duration`; duplicate row times reject. Omitted properties use existing sparse-track and bind-pose behavior. Rotation uses shortest-angle linear interpolation; omitted `interpolation` means `linear`, the only supported authored mode.
- `ikTracks` maps constraint names to rows with `time` and at least one of `x`, `y`, `mix`. Time rules match bone tracks; mix is within `0..1`. Missing channels retain existing solver fallback behavior. Baked IK uses ordinary bone tracks and `disabledIKConstraints`; suppression names must be unique, known rig constraints. These fields have no separate format version.
- Optional `rootMotion.translationKeys` uses strictly ordered sparse millisecond rows with at least one finite `x` or `y` and optional outgoing property `curves`. Empty tracks are valid; times and curves follow bone/IK rules. These animation-local offsets remain independent of skeletal/IK channels, preview preferences and scene movement. See [root-motion coordinates, normalization and loop semantics](root-motion.md).
- Omitted animation playback means smooth. Explicit playback is `{ "mode": "smooth" }` or `{ "mode": "stepped", "fps": positiveFiniteNumber }`. Editor FPS fallback is 10 where a sampling rate is needed; it is not an implicit authored stepped mode. Event rows require `time` and `name`, optionally `data` containing any JSON value. Event times stay within the clip; repeated names and equal-time events are valid and preserve authored tie order. Event arrays need not be sorted in files.
- Pose `bones` maps bone IDs to sparse transforms; omitted values retain the existing pose/bind blending behavior. Manifest arrays and dictionaries may be empty where their references allow it, but `defaultSkin` must name a declared standalone skin. Omitted `poses` means no presets. Omitted rig collections and animation events/IK collections mean empty collections without rewriting the source.

## Cross-file and import validation

`validateRigDefinition`, `validateAnimationDefinition`, `validatePoseDefinition` and `validateCharacterDefinition` accept unknown data. Parsers and `CharacterDefinition.fromData` throw before producing runtime state when validation fails. External JSON is checked as plain JSON before schema access: accessors, hidden/symbol properties, class instances, sparse arrays, cycles, nonfinite numbers and excessive nesting reject. File schemas reject unknown fields instead of silently deleting them. Runtime shape schemas may strip extras for diagnostic collection, but a failed file parse never returns their projected data as a successful import.

Validation checks bone IDs/parents/root/cycles, IK chain topology and names, slot bones, skin slot/attachment assignments, bone and IK animation references, baked suppression, key/event times, texture keys, manifest skin names, unique animation names and unique pose names. Duplicate bone, slot, attachment, skin or constraint identifiers reject. Metadata paths cannot be reused across roles or repeated animation/pose entries; texture keys may share an image file. An image path cannot also name metadata. Nested character diagnostics retain field paths such as `animations[0].tracks.absent` and include the source filename in the message.

`CharacterData.rig` supplies the rig document directly; `skins`, `animations` and `poses` index documents by manifest path. `CharacterLoader` resolves and fetches those paths, fails on unresolved metadata, and checks all referenced texture keys against the manifest. It loads metadata only. Actual image presence/decoding and atlas frame existence require the artwork/runtime layer. The host may preload an atlas; rig/attachment frame fields remain supported. Complete ZIP validation verifies every image resource and rejects any frame other than omitted/`__BASE`, because those packages contain static images. Existing artwork preflight checks host texture/frame catalogs before installation.

General runtime URL resolution remains compatible with existing assets: relative parent paths, redirects, custom I/O, atlas overrides and temporary preview blob URLs remain available. Hosts can restrict resolved destinations with `CharacterLoadOptions.urlPolicy`. The optional `pathPolicy(path, field)` runs on each authored metadata/image reference **before URL normalization** and before related requests. Throwing rejects the load with the manifest filename and field. Package loading uses the existing `packagePath` rules here: plain relative paths, no traversal/dot segments, absolute URLs, percent escapes, query/hash, backslashes, control characters or ambiguous segments. Its URL policy also requires every referenced resource to exist inside the isolated package. ZIP validation rejects case-insensitive collisions and metadata/image collisions. These package restrictions do not redefine the general runtime URL format.

Editor imports validate a candidate before replacing a working document. Failed imports retain the working/source snapshots, history and saved baseline; only validation status changes. Package loading/preview similarly constructs a detached definition and never installs partial metadata or marks existing documents saved. Byte, workload, resource and timeout limits are described in [character loading](characters.md).

## Deterministic serialization

The renderer-independent `/serialization` entry point exposes:

```ts
import {
  serializeRigDefinition,
  serializeAnimationDefinition,
  serializeSkinDefinition,
  serializeCharacterManifest,
} from 'paper-puppeteer-engine/serialization';

const rigJson = serializeRigDefinition(rigFile);
const clipJson = serializeAnimationDefinition(animationFile, validatedRig);
const skinJson = serializeSkinDefinition(skinFile, validatedRig);
const manifestJson = serializeCharacterManifest(manifest);
```

These functions accept versioned authored files as unknown, validate before serialization, and return two-space JSON with a final newline. They sort object keys using JavaScript's deterministic key ordering, preserve authored array order and finite numeric precision, and retain optional-field absence and rig name metadata. JSON's standard normalization of negative zero to zero still applies. Manifest serialization checks its shape and internal references; resource resolution requires character/package validation. Do not pass a `Rig`, compiled clip, player, React state or Phaser object; serializers reject runtime/transient fields rather than guessing what to discard. Export the retained `definition.rigFile` and `definition.manifest` when preserving source metadata.

Canonical dictionary ordering can change skin catalog enumeration order after loading a manifest; skin names, overrides and assignments remain identical. Authored arrays retain order, including equal-time events and rig bones. Package metadata uses the same canonical key ordering; standalone editor skin downloads use the validated skin serializer. Existing editor animation/rig exporters retain their established field order and narrowly scoped numeric cleanup. The rig editor's fallback field sorting is now independent of the host locale. Each export boundary is stable on subsequent import/export cycles; different export boundaries need not emit identical whitespace or field order.

No serializer writes runtime indexes, evaluated poses, clocks, selection, draft metadata, preview preferences, texture leases or bake fidelity reports. Authored IK targets and baked suppression remain part of the clip. Package preview object URLs are temporary runtime copies and never replace source manifest paths in downloaded assets.

## Compatibility and migration policy

Version 1 remains the only supported authored file version. Missing/unsupported versions reject; the engine never auto-upgrades an imported asset. There is **no authored rig/animation/skin/pose/manifest format migration** in this release. Real v0.4.3 JSON fixtures already use version 1 and load unchanged, including their missing modern optional fields. Keep old assets under version control, validate the complete character with the current loader, and export to a separate destination before replacing originals. Files with unsupported versions or unknown fields require explicit author review; do not delete fields or substitute the engine release number for the file version.

Existing compatibility mechanisms remain narrowly scoped:

- `inspectRigDraft` accepts earlier browser drafts containing a raw rig file and current version-1 envelopes with saved directions/standalone skins. It validates topology/source compatibility, derives missing direction information, and returns a detached frozen snapshot without mutating input. Repeating inspection yields the same result; installed draft data can be inspected again.
- `draftSource`/`sameDraftSource` accept older raw/canonical JSON source fingerprints and the old runtime-index-bearing rig representation. Source matching computes the current `sha256-v1` identity without changing authored JSON; recovery retains an older draft until its replacement is durable.
- Character package artwork origin conversion operates only on an explicitly captured export proposal. Pixel pivot multipliers become normalized origins plus exact rotated/scaled offsets, preserving authored geometry. Repeated exports of the same input remain deterministic; reloaded packages have already consumed this transient replacement metadata and do not compound the conversion.

The existing package limitation to static PNG/WebP files and base frames remains. No historical version, retargeting rule or format-upgrade path is introduced.

## Fixtures and validation commands

The focused `tests/schemaCompatibility.test.ts` suite reads minimal, complete and unaltered v0.4.3 fixtures from `tests/fixtures/compatibility/`. The historical documents were extracted from repository commit `567cbc5`; tests need neither git nor network access. Coverage includes 20 canonical cycles per document, reordered dictionary keys, missing defaults, immutable input, loader/validator agreement, invalid manifests and references, duplicate IDs/times, rejected transient data, transactional imports and existing draft conversion. Representative runtime probes include start, interpolated points, near-end and exact-end, plus event crossings and skin override/clearing behavior. Production bake generation/commit is round-tripped for both smooth and stepped playback.

```bash
npx vitest run tests/schemaCompatibility.test.ts tests/characterPackage.test.ts
npm run typecheck
npm run test
npm run build
```

The broader suite covers package binary/frame/path validation, pivot conversion, editor exports, runtime rendering and import lifecycle failures. Browser smoke tests remain local-only; see [development checks](development.md#checks-and-profiling). Regenerate editor schemas only when their source shapes change, then run `tests/validationConsistency.test.ts` to verify schema parity.

No v0.6.3 work is specified by the v0.6.2 plan. Atlas packaging and support for any future data version require a separate design and explicit migration policy; they remain outside this release.

## v0.6.2 verification record

| Command                | Result                                                                                    |
| ---------------------- | ----------------------------------------------------------------------------------------- |
| `npm run typecheck`    | Exit 0                                                                                    |
| `npm run test`         | Exit 0; 141 files passed, 3 skipped; 2380 tests passed, 32 skipped                        |
| `npm run build`        | Exit 0; demo, library, declarations and built Node entry checks passed                    |
| `npm run test:package` | Exit 0; isolated consumer, public declarations, documentation and browser bundling passed |
| `npm run lint`         | Exit 0; no findings                                                                       |
| `npm run format:check` | Exit 0                                                                                    |
| `git diff --check`     | Exit 0                                                                                    |

The demo build reports two `lucide-react` module-level `use client` directive warnings; the build completes successfully. The skipped tests are the repository's opt-in profiling suites. No browser suite was needed for these metadata/serialization changes.

Changed implementation files: `src/engine/authoredSerialization.ts`, `CharacterDefinition.ts`, `CharacterLoader.ts`, `core.ts`, `serialization.ts`; `src/devtools/rig-editor/RigEditorState.ts`, `rigSerialization.ts`; `src/devtools/shared/package/characterPackage.ts`.

Changed verification files: `tests/schemaCompatibility.test.ts`, `tests/characterDefinition.test.ts`, `tests/characterPackage.test.ts`, and all 21 files under `tests/fixtures/compatibility/` (fixture guide, three minimal documents, seven complete documents, nine historical documents, and the invalid-manifest cases).

Changed release/documentation files: `package.json`, `package-lock.json`, `README.md`, `CHANGELOG.md`, `docs/characters.md`, `docs/development.md`, and this guide. Generated JSON Schemas are unchanged because their version-1 shapes are unchanged.

The [v1.1.1 Pose Library](pose-library.md) adds optional `library` metadata to version-1 poses: stable ID, character ID, canonical rig signature and `fk-local` provenance. Legacy pose files remain valid. Character validation rejects duplicate library IDs; editor Preview/Apply additionally require exact compatible character/rig identity. Runtime sparse pose application remains unchanged.

The [v1.4.2.1 mesh attachment foundation](mesh-attachments.md) adds strict optional `type: "mesh"` attachments with `meshVersion: 1` and explicit bind-pose metadata to version-1 rigs. Omitted attachment types retain the original rigid sprite interpretation. No automatic conversion or outer-format migration occurs.

The [v1.4.4 mesh deformation animation guide](mesh-deformation-animation.md) documents sparse shape keys, bind-space authoring, evaluation order, topology diagnostics and animation-tool compatibility.
