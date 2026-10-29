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
        'Choose **Compatible character / rig**, then optionally enable **Compatible rig only**. Each row explains its compatibility. Direct reuse currently requires the **same source character identity**; matching bone names on a different character does not establish a compatible rig. Incompatible or unavailable rigs cannot be reused or copied onto that target. Cross-rig retargeting is deferred; other source characters can still be previewed and located.',
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
