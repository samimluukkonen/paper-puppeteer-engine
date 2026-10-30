# Rig compatibility and bone mapping

[All guides](../README.md#guides)

Version 1.5.2 adds rig comparisons and reusable bone correspondence. Comparison itself does not transfer animations, transform keys, change rest poses or regenerate constraints. Version 1.5.3-1 adds the separate [animation retargeting API](animation-retargeting.md), which consumes a current explicit map. Animation Library keeps its existing direct-reuse checks; the [visual retargeting workflow](animation-retargeting.md#visual-workflow) creates independent target clips with synchronized comparison.

In Project Workspace, expand **Rig compatibility & bone mapping**, then choose **Source rig** and **Target rig**. These are the current authored rigs of registered project characters, including committed edits in retained Rig Editors. Playback, camera transforms and Actor facing do not affect comparison. Finish pending imports or edits if a rig is unavailable.

Choose **Auto Suggest** to populate an unsaved proposal. Suggestions compare stable bone ID tokens (including camel case and left/right aliases) within corresponding parent groups, then consider unique hierarchy positions. The schema has no separate bone display names or anatomy metadata. Suggestions make no humanoid assumptions. Equal candidates and competing assignments stay unassigned; choose the target explicitly. Review unique structural proposals too: they describe topology, not artistic intent. **Unmapped / skip** and **Remove** exclude a source bone.

Give the map a name, choose **Validate**, and expand **Compatibility diagnostics**. A valid mapping must map root to root, use existing bone IDs, assign each source and target at most once, and preserve every mapped direct parent. Map a parent before its child. Inserted or collapsed intermediate chains require future support; remove the affected branch for a partial mapping. **Save Mapping** explicitly approves the reviewed correspondence. It can save a valid partial map; its report still lists skipped bones and unsupported systems.

| Level                | Meaning                                                                                                                                                                                        |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Exact / shared rig   | Same stable identity and structural fingerprint, with complete identity correspondence. Direct reuse is usually possible.                                                                      |
| Mappable rig         | An explicit current map covers source bones and preserves hierarchy. Rest transforms and proportions may differ; future retargeting must account for them. Extra target branches are reported. |
| Partially compatible | Root-connected correspondence exists, but approval is missing, source bones are skipped, or IK, foot markers or meshes need separate handling.                                                 |
| Incompatible         | No safe root correspondence exists, or the supplied map is invalid, references another identity, or is stale.                                                                                  |

Comparisons report effective local rest translations, rotation in radians, scale/reflection, joint-offset directions and segment lengths. The existing runtime resolves explicit parent lengths into child offsets; comparisons use the same `Rig` normalization. Keys store absolute local transforms, so even structurally equivalent rigs with different proportions cannot simply exchange keys. Actor placement/facing is outside the rig coordinate system; bone maps do not encode facing or symmetry operations.

Rig coordinates use +X right and +Y down; positive local rotation appears clockwise. FK composes parent transforms before children. Authored bone transforms provide the ordinary rest pose, while mesh attachments retain explicit bind-pose snapshots and vertex bone weights. Animation `tracks` reference bone IDs, `ikTracks` and suppression reference constraint names, and `deformationTracks` reference attachment IDs with vertex-ID offsets. These identifier domains remain separate.

IK analysis compares the mapped root/middle/end chain independently, including stable constraint names, default targets, end offsets, bend, mix, execution order, enabled state and effective segment lengths. Different constraint IDs do not rename animation `ikTracks` or `disabledIKConstraints`. Targets live in puppet-local coordinates before Actor facing and placement. Cross-rig IK track transfer is unsupported even when bone correspondence is complete. Foot contact markers have separate stable IDs and bone-local offsets; missing or changed markers require review.

Mesh analysis reports missing attachments, differing vertex IDs/order, positions, UVs, image dimensions, triangles, bind transforms and bone weights. Slots and skin selections are checked separately. A bone map does not establish attachment or vertex correspondence. Different topology cannot safely share vertex corrections, and matching topology does not approve cross-rig deformation transfer in this milestone. Rigid skin/artwork bindings are not rewritten either.

Approved maps belong to `project.json` authoring metadata, under optional `rigMappings`; version-1 projects without this field still load. Each map stores a version, stable asset ID/name, source/target character identities, compact `rig-v1:` SHA-256 structural fingerprints and data-only bone ID entries. Version-1 characters own one rig, so character identity scopes rig identity. No editor, renderer, live joint or selection object is serialized. Metadata saves/removal use **Undo Project / Redo Project**, local autosave/recovery and **Export Project / Import Project**. Standalone character or animation downloads do not include project-owned mappings.

Saved maps are revalidated against current authored rigs whenever reviewed or inspected. Bone/rest, IK, marker, slot, skin, attachment and mesh changes conservatively invalidate fingerprints. **Review mapping** preserves old fingerprints, displaying errors instead of silently rebinding. **Review current revisions** explicitly acknowledges the new snapshot; repair missing rows and review diagnostics before **Save Mapping** approves it again. Project validation reports stale/unavailable maps as warnings, so project ZIPs can preserve them for repair. They cannot be saved as current or grant reuse. Remove saved maps before removing their referenced characters.

Renderer-independent tooling can use `/core`:

```ts
import {
  analyzeRigCompatibility,
  suggestRigBoneMapping,
  createRigBoneMapping,
  validateRigBoneMapping,
} from 'paper-puppeteer-engine/core';

const source = { id: sourceCharacter.id, rig: sourceCharacter.rig };
const target = { id: targetCharacter.id, rig: targetCharacter.rig };
const proposals = suggestRigBoneMapping(source, target);
// Review/edit proposals.entries and resolve proposals.suggestions before approval.
const mapping = createRigBoneMapping(source, target, proposals.entries, 'sword-rig-map', 'Sword rigs');
const issues = validateRigBoneMapping(source, target, mapping);
const report = analyzeRigCompatibility(source, target, mapping);
```

The factory captures revisions but does not approve validity. Only accept a mapping after validation returns no errors. `rigBoneMappingSchema` supports strict data-only parsing for storage. A report never transforms keys or executes constraints. Pass a valid, reviewed map to `retargetAnimation` to create a separate target-compatible FK animation under its explicit transfer policies. The comparison report's unsupported-transfer messages describe the bone map alone; the retargeting service performs its own conservative IK and mesh handling.

The read-only **Comparing Rigs and Mapping Bones** Feature Guide is available in the Project Workspace category and can be read before adding characters. It reveals controls without changing mappings, rig selection, history, playback or save checkpoints.
