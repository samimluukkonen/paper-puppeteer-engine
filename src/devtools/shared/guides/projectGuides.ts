import { GUIDE_TARGETS as T } from './anchors.js';
import type { GuideDefinition, GuideStep } from './types.js';

const step = (id: string, title: string, targetId: string, description: string): GuideStep => ({
  id,
  title,
  targetId,
  description,
  preparation: 'reveal-target',
});

export const projectGuides: readonly GuideDefinition[] = [
  {
    id: 'project-character-variants',
    title: 'Creating Character Variants and Templates',
    description:
      'Share a rig and animations, choose an appearance, or create an independent character from a reusable preset.',
    editor: 'project',
    category: 'rigging',
    prerequisites: [
      {
        capability: 'tool:project',
        reason: 'Create or import a project first. No character is required to read this guide.',
      },
    ],
    steps: [
      step(
        'source',
        'Choose a source character',
        T.projectCharacters,
        'After exiting this tour, register a character and choose **Create Character Variant** on its row. Enter a new name and review **Rig ownership**. **Reuse shared rig and animations** creates a stable character identity with an appearance selection. It does not duplicate the skeleton. This tour only reveals controls and never creates assets or opens editors.',
      ),
      step(
        'appearance',
        'Change appearance without editing the source',
        T.projectCharacters,
        'Choose an **Appearance skin** before creating the variant, or use **Appearance only** on its row later. This changes only that variant’s selected skin. Partial skins retain artwork inherited from the original default. To design new artwork, open **Edit Shared Rig**, create a new skin and map existing attachments; preserve skins already used by other characters.',
      ),
      step(
        'ownership',
        'Understand shared editing and independent copies',
        T.projectCharacters,
        '**Edit Shared Rig** and **Edit Shared Animations** open the original document owner. The shared header names every affected character. Rig, attachment, image and animation edits affect the whole group. Use **Create Independent Character Copy** for a different skeleton or private artwork; this snapshots the current character with its own identity and histories while reusing image binaries.',
      ),
      step(
        'mesh',
        'Preserve mesh geometry and corrections',
        T.projectAssets,
        'A skin selects existing rigid or mesh attachments. Meshes retain their own topology, UVs, weights and bind data. Replacing mesh artwork requires the original image dimensions and pivot. **Corrective deformation** stays with attachment and vertex IDs; it is never transferred to another mesh by a skin change. Create an independent copy to rebuild different geometry, then review or remove incompatible corrections.',
      ),
      step(
        'template',
        'Save a reusable preset',
        T.projectCharacters,
        'Enable **Reusable template** on an independent character. **New from Template** lets you select that preset, enter a name and **Create Character**. The new character opens in Rig Editor with copied rig, skins and animations and a new stable identity. Future preset edits or removal do not change copies. Unchecking the preset flag leaves the character intact; deleting an owner with shared variants is blocked.',
      ),
      step(
        'animation',
        'Reuse animations directly',
        T.projectAnimationLibrary,
        'Shared variants have the same rig identity in **Animation Library**. Choose a variant in **Compatible character / rig** to find its directly reusable animations. No playback retargeting is needed. Independent character copies use the existing compatibility and **Retarget to Another Character** workflow for later transfers.',
      ),
      step(
        'scene',
        'Use multiple appearances in one scene',
        T.projectScenes,
        'After exiting, open Scene Editor and **Add Actor** for the source and each variant. Each character starts with its selected default appearance and can use the shared animation names. Actor poses, clocks and placement are independent. Reopen the scene after changing shared assets or appearance to load current character definitions.',
      ),
      step(
        'persist',
        'Validate and keep the complete project',
        T.projectExport,
        '**Validate Project** checks shared rig owners, selected skins, textures, mesh data and animation references. Remove variant references before deleting their owner or renaming a referenced skin. **Export Project** and local autosave/recovery preserve ownership and templates. Standalone scene packages materialize complete version-1 characters, and project exports store identical image binaries once. The tour never validates, exports or changes history.',
      ),
    ],
  },
  {
    id: 'project-animation-retargeting',
    title: 'Retargeting an Animation Visually',
    description:
      'Map bones, compare synchronized source and target previews, and create an independent target animation.',
    editor: 'project',
    category: 'animation',
    prerequisites: [
      {
        capability: 'tool:project',
        reason: 'Create or import a project first. You can read this guide before adding characters.',
      },
    ],
    steps: [
      step(
        'source',
        'Choose an animation and another character',
        T.projectAnimationLibrary,
        'After exiting this tour, expand **Animation Library** and choose **Retarget to Another Character** on a source clip. Choose the **Target character** in the dialog. Both characters must belong to this project. The tour only reveals existing controls; it never opens a dialog, chooses assets or creates data.',
      ),
      step(
        'mapping',
        'Review and approve bone correspondence',
        T.projectRigMapping,
        'In the retargeting dialog, choose a saved **Bone mapping** or **Open Bone Mapping Editor**. Review **Auto Suggest** proposals, choose ambiguous matches manually, **Validate** and **Save Mapping**. Invalid or stale maps cannot preview. Partial maps skip tracks with warnings. Saving a map is explicit project metadata and uses Project Undo/Redo.',
      ),
      step(
        'options',
        'Choose supported transfer policies',
        T.projectAnimationLibrary,
        '**Root motion** preserves, scales or omits whole-character displacement. **Local translation** preserves deltas or scales by bone length. Optional **Pelvis / body translation override** requires explicit source bones. **FK-only transfer** omits source IK and suppresses target constraints on the result. Bake source IK first to transfer its solved motion. Review all skipped-track and mesh correction warnings.',
      ),
      step(
        'comparison',
        'Inspect synchronized motion and contacts',
        T.projectAnimationLibrary,
        '**Preview Result** uses two ordinary Puppets with one clock, **Play/Pause**, **Comparison time** and **Playback speed**. Both sides use the same world scale. Enable **Show ground reference** and **Show foot contact markers** to inspect travel, sliding, floating and pelvis height. These are diagnostics, with no automatic foot locking. Adjusting a mapping regenerates from the unchanged source; option changes require Preview Result again.',
      ),
      step(
        'create',
        'Create and correct an independent animation',
        T.projectCharacters,
        'After reviewing the loaded comparison and diagnostics, **Create Animation** registers a unique target document and opens it in **Animation Editor**. Correct its keys with ordinary Undo/Redo. Creation follows New Animation navigation semantics and preserves existing clip histories. **Cancel** discards temporary preview data; explicitly saved mappings remain. The source, rigs and existing Scene Actors are unchanged.',
      ),
      step(
        'persist',
        'Preserve the result and source together',
        T.projectExport,
        '**Export Project** keeps the new target animation, original source and saved mappings together. Local autosave/recovery includes the new unsaved clip. Export/import or recover, then reopen both animations to verify the handoff. This tour never previews, exports, creates assets or changes authored history.',
      ),
    ],
  },
  {
    id: 'project-rig-mapping',
    title: 'Comparing Rigs and Mapping Bones',
    description:
      'Compare rig structure, review proposed correspondences and save reusable mappings for future retargeting.',
    editor: 'project',
    category: 'animation',
    prerequisites: [
      {
        capability: 'tool:project',
        reason: 'Create or import a project first. You can read this guide before adding characters.',
      },
    ],
    steps: [
      step(
        'compare',
        'Choose the source and target rigs',
        T.projectRigMapping,
        'After exiting this tour, open **Rig compatibility & bone mapping** and choose **Source rig** and **Target rig** from the project characters. These use stable character IDs and current authored rig revisions. The comparison is independent of playback, actor facing and camera placement. The tour reveals controls only; it never chooses rigs, edits correspondence or approves a map.',
      ),
      step(
        'suggest',
        'Review automatic proposals',
        T.projectRigMapping,
        '**Auto Suggest** proposes correspondences using bone ID tokens and corresponding parent positions. Review each row. **Ambiguous** candidates stay unassigned: choose a target explicitly, or leave **Unmapped / skip** for partial coverage. Use **Remove** to clear a correspondence. Names alone never establish compatibility, and suggestions are never saved automatically.',
      ),
      step(
        'validate',
        'Understand the compatibility report',
        T.projectRigMapping,
        '**Validate** checks existing IDs, unique targets, root correspondence, parent-child consistency and current revisions. Expand **Compatibility diagnostics** to review rest transforms, orientation, proportions, missing or extra bones, IK constraints, foot markers and mesh bindings. **Exact / shared rig** requires identity and structure; **Mappable rig** needs an explicit valid map; **Partially compatible** requires skipping tracks or separate handling. Invalid or stale maps cannot be saved.',
      ),
      step(
        'limits',
        'Keep IK and mesh transfer separate',
        T.projectRigMapping,
        'A bone map does not rename IK tracks, convert puppet-local targets or remap disabled constraints. Different mesh topology cannot share vertex corrections; matching topology still does not approve cross-rig deformation transfer. **Save Mapping** does not copy or transform animation keys. Animation Library direct reuse keeps its existing identity checks. Use **Retarget to Another Character** in Animation Library for the separate visual transfer workflow.',
      ),
      step(
        'save',
        'Approve and maintain a reusable mapping',
        T.projectRigMapping,
        'Give the map a name and choose **Save Mapping** to approve it. **Saved mappings → Review mapping** loads it for editing. If rig data changes, **Review current revisions** acknowledges the new snapshot; review rows and diagnostics before saving again. **Undo Project** and **Redo Project** restore map changes. Remove saved maps before removing their characters.',
      ),
      step(
        'persist',
        'Keep mapping metadata with the project',
        T.projectExport,
        '**Export Project** preserves approved mappings and their rig fingerprints in the ZIP; committed saves also use local autosave and recovery. Import revalidates saved maps against current rigs. Stale maps are retained for repair and reported by **Validate Project**; they are never silently used. Character and animation downloads do not include project-owned mappings. This tour never exports or changes checkpoints.',
      ),
    ],
  },
  {
    id: 'project-animation-library',
    title: 'Finding and Reusing Animations',
    description: 'Find existing animation assets, preview motion, check rig compatibility and reuse or copy a clip.',
    editor: 'project',
    category: 'animation',
    prerequisites: [
      {
        capability: 'tool:project',
        reason: 'Create or import a project first. No character or animation is required to read this guide.',
      },
    ],
    steps: [
      step(
        'library',
        'Open the Animation Library',
        T.projectAnimationLibrary,
        '**Animation Library** browses the existing animations owned by your project characters. It shows their source character, stable **Animation ID**, duration and looping. An empty library is valid: add a character and create an animation in its Animation Editor after this tour. Reading the guide only reveals controls; it never opens editors, selects assets, starts playback or changes authored data.',
      ),
      step(
        'search',
        'Find a clip by name or tags',
        T.projectAnimationLibrary,
        'After exiting, enter a name, display name or optional tag in **Search animations**. Multiple search words narrow the results together. Tags and categories are never required. Use **Locate Original Asset** to open the source animation, then **Animation Library → Library metadata** in Animation Editor to edit its display name, description or tags. Labels can change without renaming the stable Animation ID.',
      ),
      step(
        'compatibility',
        'Check the target character and rig',
        T.projectAnimationLibrary,
        'Choose **Compatible character / rig**, then optionally enable **Compatible rig only**. Each row explains its compatibility. Direct reuse requires the **same shared rig identity**, including explicit character variants; matching bone names on an independent character does not establish a compatible rig. Incompatible or unavailable rigs cannot be reused or copied onto that target. Use **Retarget to Another Character** for the separate mapped transfer workflow; other source characters can also be previewed and located.',
      ),
      step(
        'preview',
        'Preview without authoring keys',
        T.projectAnimationLibrary,
        'After exiting, choose **Preview animation**. The detached runtime preview supports **Play/Pause**, **Stop / Restart** and **Loop preview**, including skeletal motion, IK, root travel and mesh deformation. These controls leave the source animation, keys and history unchanged and suppress authored events. **Close preview** releases its runtime resources. This guide never starts a preview or opens its dialog.',
      ),
      step(
        'reuse',
        'Keep the existing asset identity',
        T.projectAnimationLibrary,
        '**Use Existing Animation** opens that character’s existing animation in Animation Editor. It keeps the same source ID and creates no copy. Scene Actors and actions referring to that asset share it: editing the source can affect all those references. Use an independent copy when a new shot needs different motion.',
      ),
      step(
        'copy',
        'Create an independent variation',
        T.projectAnimationLibrary,
        '**Create Independent Copy** opens the source editor and registers an unused ID such as sword-cut-variation. Bone curves, IK and suppression, root motion, mesh deformation, events and metadata are copied independently. Edit the variation, then switch to the source to compare. **Undo/Redo** restores edits to the selected clip; creation itself is document navigation. **Create Variation** also lets you choose a custom ID and time scale.',
      ),
      step(
        'scene',
        'Use the variation in a scene',
        T.projectScenes,
        'After exiting, open a scene and select an Actor using the source character. **Animation Library** is available in Actor properties, animation action properties and the timeline’s **Actions** tab. Use Existing Animation sets the existing reference; action drafts require **Apply action properties**. Changing an action reference preserves start, duration, speed, looping and movement ownership. Reopen the scene after creating a variation to load its latest character definition.',
      ),
      step(
        'save',
        'Keep references and metadata together',
        T.projectExport,
        '**Export Project** keeps characters, clips, labels and scene references in one portable ZIP without duplicating shared clips. Committed edits also use local autosave and recovery. **Download character ZIP** includes that character’s animations; **Download JSON** includes the selected clip. Export and reload the project to compare the original and variation. This tour never downloads, marks assets saved or changes history.',
      ),
    ],
  },
  {
    id: 'project-mesh-handoff',
    title: 'Mesh Characters Across Editors',
    description: 'Take a weighted mesh from rigging and animation into scene Actors, validation and portable packages.',
    editor: 'project',
    category: 'animation',
    prerequisites: [
      {
        capability: 'tool:project',
        reason: 'Create or import a project first. You can explore this workflow before adding a character or scene.',
      },
    ],
    steps: [
      step(
        'character',
        'Keep one character through the workflow',
        T.projectCharacters,
        'After exiting this tour, use **New Character** or **Import Character ZIP** to register your character. Its **Rig Editor** and **Animation Editor** buttons open the same project character. Return to Project Workspace between editors to continue the handoff. This overview also works in an empty project; it never creates assets, opens editors or changes selection.',
      ),
      step(
        'rig',
        'Finish the rig and paint the mesh',
        T.projectCharacters,
        'Open the character’s **Rig Editor** after this tour. Finish the skeleton and artwork alignment, create an attachment slot, then follow **Editing Mesh Geometry** and **Painting Bone Weights** in Feature Guide. Finish rest transforms before conversion: the saved **bind pose** is protected. Subdivision preserves existing vertex IDs and interpolates weights; new correction vertices start neutral.',
      ),
      step(
        'artwork',
        'Preserve skins, artwork and layer order',
        T.projectAssets,
        '**Assets** lists each character’s attachments, skins and artwork. Keep the **mesh skin** name created during conversion: the original skin can still select rigid artwork. A skin can choose another sprite or mesh, but shape tracks stay with their attachment IDs. Replacing mesh artwork requires the same **image dimensions** and pivot; recreate the mesh deliberately for different proportions. Ordinary slot depth places a transparent sleeve behind or ahead of other parts.',
      ),
      step(
        'animation',
        'Animate the same attachment',
        T.projectCharacters,
        'Open this character’s **Animation Editor**, select a skin displaying the mesh, and follow **Animating Mesh Deformation**. Animate bones first; use optional sparse corrections with **neutral keys** to return to ordinary weighted skinning. **Stable vertex IDs** connect shape keys to geometry. Rig edits and Undo/Redo reject newly invalid animated references; restore required IDs or explicitly remove incompatible tracks in Animation Editor.',
      ),
      step(
        'review',
        'Compare the final silhouette and ghosts',
        T.projectCharacters,
        'In Animation Editor, scrub forward and backward through the bend. The main preview combines corrections with final **FK/IK** skinning. **Onion skins** sample their own correction shapes and FK poses before IK, and stay at the current preview placement instead of sampling root travel. Bake IK to inspect solved ghost silhouettes. Facing reflects the complete character; bone mirroring preserves correction tracks without retargeting mesh vertices. Graph Editor does not edit deformation channels.',
      ),
      step(
        'scene',
        'Place the mesh character in a scene',
        T.projectScenes,
        'After exiting, create or open a scene here. In **Scene Editor**, choose **Add Actor**, select this project character, and set its **Skin** to the mesh variant. Add an animation action using the authored clip. Adding the same character again creates an independent Actor. Use **Creating Animation Clips** and **Positioning an Actor** in the scene Feature Guide for the real controls. The scene uses the same mesh skinning as Animation Editor.',
      ),
      step(
        'travel',
        'Check travel, facing and repeated seeks',
        T.projectScenes,
        'In Scene Editor, use **Movement source → Animation root motion** for a clip with authored travel, or use scene movement actions. Do not overlap competing translation owners. Choose each Actor’s facing explicitly and seek repeatedly to the same scene time to compare the shape and placement. Camera pan/zoom, parallax and scene fades operate around the posed character. Use the existing root-motion and scene guides for detailed controls.',
      ),
      step(
        'validate',
        'Resolve dependencies before production export',
        T.projectValidate,
        'After exiting, choose **Validate Project**. Mesh dependencies include textures, bind bones and slots, weights, topology and deformation vertex IDs. Open an affected asset from the report to repair it. **Editing draft** allows missing artwork as warnings; **Production export** requires valid referenced data and image dimensions. Apply or cancel artwork proposals before exporting. Reading this step does not run validation or change the project.',
      ),
      step(
        'save',
        'Save the complete handoff',
        T.projectExport,
        '**Export Project** saves characters and scenes together. For separate handoff, use **Download character ZIP** in a character editor or **Download scene package** in Scene Editor. Packages preserve mesh geometry, UVs, weights, bind data, skins, textures and deformation tracks. Reload and select the same mesh skin to compare the bend. Standalone mesh playback requires **WebGL**; rigid characters still support Canvas. Browser recovery is a local draft, not a portable download. This tour never exports, marks data clean or changes history.',
      ),
    ],
  },
  {
    id: 'project-audio-assets',
    title: 'Importing and Managing Audio',
    description:
      'Import music, ambience, sound effects and voices, audition them and keep their binaries in project saves.',
    editor: 'project',
    category: 'audio',
    prerequisites: [
      {
        capability: 'tool:project',
        reason: 'Open Project Workspace, then create or import a project. No character or scene is required.',
      },
    ],
    steps: [
      step(
        'library',
        'Open the Audio library',
        T.projectAudio,
        '**Audio** belongs to this project, alongside its characters and scenes. Expand Audio to see the library. This tour reveals controls only: it does not import, rename, remove or play anything. You can follow it in an empty project; exit or finish the tour before trying the controls.',
      ),
      step(
        'import',
        'Import a supported audio file',
        T.projectAudioImport,
        'After exiting, choose an **Import category** and click **Import Audio**. WAV, MP3 and OGG are accepted when this browser can decode their contents. Files must be nonempty and at most **10 MiB** each. An extension or MIME type alone is not enough. If decoding fails, export a compatible encoding such as PCM WAV and retry. Filename collisions get separate paths; import never starts sound.',
      ),
      step(
        'categories',
        'Organize music, ambience, effects and voices',
        T.projectAudioCategories,
        '**Music**, **Ambience**, **Sound effects** and **Voice** are organizational categories with one shared playback backend. Each category starts collapsed and shows its count. Open one to see its asset rows, file paths and available duration. The Category selector on a row moves that asset while preserving its stable ID and binary path.',
      ),
      step(
        'preview',
        'Audition with Play, Stop and volume',
        T.projectAudioPreview,
        'After exiting, click **Play** on an audio row. Its button changes to **Stop** while loading or playing; click Stop on that same row to end the preview. Names are labels and do not play sound. Only one asset auditions at a time. Stop preview at the top also stops sound or cancels a pending Play; **Preview volume** changes audition loudness. Sound requires an explicit click and browser permission. Closing a category stops its preview; closing Audio releases decoded resources. Import and this tour never start playback. Scene audio timeline placement comes later.',
      ),
      step(
        'manage',
        'Rename or remove an audio asset',
        T.projectAudioCategories,
        'Use **Rename**, enter an Audio name and choose **Apply name**, then Done. Display names can change without breaking stable IDs or paths. **Remove** takes an asset out of the library; **Undo Project** restores its original bytes. Assets with registered dependents must have those references removed first. Scene audio references are deferred to the timeline milestone.',
      ),
      step(
        'history',
        'Undo project audio changes',
        T.projectHistory,
        'Import, rename, category changes and removal use **Undo Project** and **Redo Project**. Audition, volume and guide progress are view state and do not create history entries. Finish or exit this tour before using history. The guide itself leaves authored project data and editing checkpoints unchanged.',
      ),
      step(
        'save',
        'Keep audio in portable project saves',
        T.projectExport,
        '**Export Project** downloads a portable ZIP containing audio metadata and original binary files. **Import Project** restores those IDs, categories, names and paths and checks browser codec support. Committed edits also use the existing browser autosave and recovery; inspect **Local draft** for save status. Decoded buffers and preview settings are not saved. A download does not overwrite repository files. Scene timeline authoring and playback synchronization remain deferred to v1.3.2.',
      ),
    ],
  },
];
