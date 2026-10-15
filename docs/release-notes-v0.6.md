# v0.6 Production Authoring release notes

[All guides](../README.md#guides) · [Release gates and current verdict](release-readiness.md)

Package candidate: **0.6.5**. These notes prepare the v0.6 release; they do not announce publication. Consult the readiness report for measured results and remaining acceptance work.

## Authoring and runtime

The Rig Editor configures the skeleton, joint positions, hierarchy and artwork alignment. The Animation Editor authors motion, events, bone/IK keys, interpolation and timing. Rig Tweak corrects structure at a paused animation pose with separate rig history. Asset management imports static PNG/WebP and replaces sprites with explicit pivot policies. Character ZIP export combines committed rig, clips, skins, poses and image binaries for runtime use.

The shared React workspace retains character documents, clip sessions and independent histories between editor tabs. Mirroring, onion skinning, timeline search/zoom/snapping, group edits, clipboard tools, retiming and selected-constraint IK baking are available. JSON drafts recover compatible metadata; save a complete ZIP to retain replacement artwork.

The v0.6 hardening series separates runtime/editor dependencies, stabilizes public entry points, checks supported schema fixtures, validates portable package paths and images, and verifies a separately installed Phaser consumer. v0.6.5 restores full-Rig-Editor numeric draft autosaves, fits compact desktop viewports, and corrects macOS Control-click selection and sparse-skin composition in package/standalone previews. It also adds combined workflow and repeated lifecycle/package regressions, explicit acceptance gates and current performance observations. No new rendering or animation subsystem is introduced.

## Public API contract

| Import                                 | Supported purpose                                                                                                                 |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `paper-puppeteer-engine`               | Browser runtime; compatible with `/runtime`                                                                                       |
| `paper-puppeteer-engine/runtime`       | `Puppet`, `loadSceneCharacter`, runtime types and shared engine exports; requires Phaser/browser                                  |
| `paper-puppeteer-engine/core`          | Node-safe `CharacterLoader`, `CharacterDefinition`, `Rig`, `Joint`, `AnimationPlayer`, clip evaluation, transforms and IK tooling |
| `paper-puppeteer-engine/data`          | Type-only authored data contracts                                                                                                 |
| `paper-puppeteer-engine/serialization` | Validation, parsing and deterministic authored JSON serialization without Phaser                                                  |

Declarations and source maps ship with the library. Use documented exports; editor controllers, source-relative deep imports and demo presentation are internal. Runtime data snapshots are immutable. Host applications own shared texture keys and texture lifetime; `Puppet.destroy()` releases puppet objects, IK and subscriptions. `loadSceneCharacter` cancels on scene shutdown. Scene updates advance puppets automatically unless `autoUpdate: false` is selected. Stop event subscriptions and destroy owned games on teardown.

See the [API audit](runtime-api.md), [integration guide](runtime-integration.md), and [standalone consumer instructions](https://github.com/samimluukkonen/paper-puppeteer-engine/blob/master/examples/standalone/README.md). Node 24+ is required for repository tooling; Phaser 4.2.1 is the exact runtime peer. React belongs to the editor/demo, not the library dependency graph.

## Supported data and migration

| Data                                   | Supported format                            | Evidence / limitation                                                                               |
| -------------------------------------- | ------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Character manifest                     | `version: 1`                                | Shipped characters, minimal/complete fixtures, standalone export                                    |
| Rig / bones / slots / attachments / IK | `version: 1`                                | Current exports and unchanged v0.4.3 metadata                                                       |
| Standalone / embedded skins            | `version: 1`                                | Sparse overrides, explicit clearing, precedence and multiple skins                                  |
| Animation                              | `version: 1`                                | Empty, smooth/stepped, complex tracks/events, authored IK and generated baked IK                    |
| Static pose                            | `version: 1`                                | Current complete fixture and standalone export; absent from the historical fixture                  |
| Historical release v0.4.3              | Already format `1`                          | Unchanged JSON from commit `567cbc5`; historical image binaries are not included                    |
| Editor character ZIP                   | UTF-8 stored entries emitted by this editor | Extractable by ordinary ZIP tools; third-party compression, encryption and ZIP64 import unsupported |
| Other historical format versions       | No compatibility claim                      | No available fixture establishing support; unsupported explicit versions reject                     |

**No authored-format migration is required from 0.6.4.** Library SemVer is independent of each JSON `version`. Preserve stable bone, slot, attachment, skin, clip and texture identities. Existing metadata/image paths are preserved when possible. PNG/WebP replacement may create a new path when its format changes or aliases require isolation. Preview-only facing, onion settings, camera, fixed IK targets and private texture keys never become exported runtime settings. Existing draft recovery compatibility is unchanged. See [schema compatibility](schema-compatibility.md) for defaults, older draft handling and validation details.

Update an existing checkout consumer's tarball path to `paper-puppeteer-engine-0.6.5.tgz`, reinstall and rebuild. Root and `/core` imports remain available; `/runtime`, `/data` and `/serialization` remain the explicit entry points added in 0.6.1.

## Known limitations and release work

Static whole-image PNG/WebP artwork is supported; atlas/frame replacement and animated images are unsupported. ZIP import verifies a runtime preview and does not restore a complete editable workspace. The Rig Editor configures existing skeletons; it has no general new-bone or automatic-rig generation workflow. Same-session rig JSON imports preserve the existing topology/identities; start a different character session for an incompatible skeleton. Interpolation is clip-level linear, with smooth/stepped playback; per-key curve editing is unavailable.

IK uses direct two-link chains and documented scale restrictions. Dense timelines can incur filtering/expansion and authoring costs; there is no timeline virtualization or universal FPS/memory guarantee. Save replacement binaries before leaving the session. See [artist troubleshooting](artist-workflow.md#troubleshooting) and the [readiness report](release-readiness.md) for current defects, measurements and manual verification gaps.

Registry publication still needs an owner-selected license, repository/author/license metadata and registry/access/provenance decisions. No package publication, Git tag, remote release, browser CI job or periodic dependency audit is part of this change.

For v0.7, prioritize measured dense-timeline/authoring costs and artist feedback from real production assets; consider atlas handling or more flexible rig topology only as separately scoped proposals. Choreography, physics, ragdolls, mesh deformation and automatic rigging remain future milestones.
