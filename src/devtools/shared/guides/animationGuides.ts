import { GUIDE_TARGETS as targets } from './anchors.js';
import type { GuideDefinition, GuidePrerequisite, GuideStep } from './types.js';

const rig: readonly GuidePrerequisite[] = [
  { capability: 'character', reason: 'Load or create a character first.', guideId: 'rig-new-character' },
  { capability: 'valid-rig', reason: 'A valid rig is needed to preview an animation.' },
];
const animation: readonly GuidePrerequisite[] = [
  ...rig,
  { capability: 'animation', reason: 'Create or select an animation first.', guideId: 'animation-new' },
];
const ik: readonly GuidePrerequisite[] = [
  ...animation,
  {
    capability: 'ik-constraints',
    reason: 'Add an IK constraint in the Rig Editor first.',
    guideId: 'rig-ik-constraints',
  },
];
const step = (id: string, title: string, description: string, targetId: string): GuideStep => ({
  id,
  title,
  description,
  targetId,
  preparation: 'reveal-target',
  mode: 'explain',
});

/** Navigation only reveals UI. Optional practice always uses the existing editor controls. */
export const animationGuides: readonly GuideDefinition[] = [
  {
    id: 'animation-ground-reference',
    title: 'Using Ground Reference',
    description: 'Inspect contact against a fixed preview reference and explicitly align an authored IK target.',
    editor: 'animation',
    category: 'animation',
    prerequisites: rig,
    steps: [
      step(
        'enable',
        'Enable the line',
        'After exiting this tour, enable Show ground guide. The line is a visual reference, not a physics floor. Settings belong to this character in this browser, independently of animation keys.',
        targets.animationGroundVisible,
      ),
      step(
        'position',
        'Position Ground Y',
        'Enter a finite Ground Y and press Enter, or drag the amber ↕ Ground label in the preview. This uses fixed preview-world coordinates, including the character preview placement; it is not Scene Editor ground Y. Guide Undo/Redo affects preferences only.',
        targets.animationGroundY,
      ),
      step(
        'contact',
        'Inspect foot contact',
        'Enable Show foot contact markers to inspect rig contacts and signed ground distances while playing or scrubbing. Choose a contact and confirm its existing foot IK constraint for explicit preview/apply alignment. Root translation, facing and scale affect contacts; the reference stays fixed. Jumping or flying poses remain free to leave the line.',
        targets.animationCanvas,
      ),
      step(
        'align',
        'Align an IK target where supported',
        'With an animation and authored IK target selected, Align IK target Y to guide writes X/Y keys at the playhead while preserving world X. Animation Undo/Redo restores this real edit. Without IK, use the reference visually. No sole-contact marker is inferred, and solver reach or influence can limit contact.',
        targets.animationGroundAlign,
      ),
      step(
        'reset',
        'Hide or reset the guide',
        'Reset Ground Y restores the preview default without moving the character. Uncheck Show ground guide to hide it. Preferences survive switching clips and reopening the character here; animation and character exports carry authored edits, without guide preferences.',
        targets.animationGroundReset,
      ),
    ],
  },
  {
    id: 'animation-new',
    title: 'Create a New Animation',
    description: 'Start an empty clip for the loaded rig without importing JSON.',
    editor: 'animation',
    category: 'animation',
    prerequisites: rig,
    steps: [
      step(
        'new',
        'Start an empty clip',
        'After exiting this tour, choose + New Animation. No existing animation JSON is required. A character with only a root bone can start here.',
        targets.animationNew,
      ),
      step(
        'settings',
        'Choose name, duration and FPS',
        'The Create new animation dialog asks for Animation name / ID, Duration (seconds), Animation FPS and Loop enabled. Use a unique ID with letters, numbers, - or _. Choose Create Animation when ready; confirm any unsaved-work prompt deliberately.',
        targets.animationNew,
      ),
      step(
        'selection',
        'Find your new animation',
        'Animation selects a clip for this character. A new clip is selected with empty tracks and stepped playback at your chosen FPS. Each clip keeps its own working edits when you switch.',
        targets.animationSelection,
      ),
      step(
        'bones',
        'Choose what to animate',
        'Open Bones and select any bone in your rig, or select its joint in the preview. Use Create Your First Keyframe to add motion after creating the clip.',
        targets.animationBones,
      ),
      step(
        'save',
        'Keep the new clip',
        'Download JSON exports committed animation data. Download character ZIP in Character package includes the new clip and its manifest entry. Neither action writes files into your project.',
        targets.animationExport,
      ),
    ],
  },
  {
    id: 'animation-first-keyframe',
    title: 'Create Your First Keyframe',
    description: 'Select a bone, place the playhead and commit a local transform key.',
    editor: 'animation',
    category: 'animation',
    prerequisites: animation,
    steps: [
      {
        ...step(
          'bone',
          'Select a bone',
          'Open Bones and choose any bone in this rig. Selecting an IK target or event shows a different inspector.',
          targets.animationBones,
        ),
        mode: 'try-it',
        practice: {
          targetId: targets.animationBones,
          instruction: 'Choose a bone in the highlighted Bones list. This changes selection only.',
          changesProject: false,
          completion: { capability: 'selected-bone', message: 'A bone is selected.' },
        },
      },
      step(
        'time',
        'Place the playhead',
        'Enter Time (s), or drag the timeline ruler, to choose the key time. Start at 0 for the initial pose. Scrubbing cancels temporary transform edits, so place the playhead before entering values.',
        targets.animationTime,
      ),
      step(
        'value',
        'Enter a local transform',
        'Selection details shows the selected bone’s local transform relative to its parent. Enter a position, rotation or scale value. Rotation uses degrees. Yellow fields are temporary and do not yet belong to the animation.',
        targets.animationProperties,
      ),
      {
        ...step(
          'key',
          'Commit the property key',
          'Click ◇ beside a property to set a key at the playhead. ◆ updates an existing key. Each property is keyed separately. Optional practice uses the X key button with the current value.',
          targets.animationProperties,
        ),
        mode: 'try-it',
        practice: {
          targetId: targets.animationXKey,
          instruction:
            'Click Set X key to commit the current X value at the playhead. This changes your real animation. Undo and Redo remain available after exiting the guide.',
          changesProject: true,
          prerequisites: [
            {
              capability: 'selected-bone',
              reason: 'Select a bone first, using the first step of this guide.',
              guideId: 'animation-first-keyframe',
            },
          ],
          completion: { capability: 'selected-x-key', message: 'An X key is present at the current playhead.' },
        },
      },
      step(
        'track',
        'Inspect the result',
        'Expand the bone’s timeline row to see its property key. A collapsed bone diamond summarizes timing; expand it to edit individual keys. Add another key at a different time to create movement.',
        targets.animationTracks,
      ),
    ],
  },
  {
    id: 'animation-animate-bone',
    title: 'Animate a Bone',
    description: 'Make two poses on one bone and preview the motion between them.',
    editor: 'animation',
    category: 'animation',
    prerequisites: animation,
    steps: [
      step(
        'bone',
        'Choose a bone',
        'After exiting this tour, choose a bone in Bones. Any bone ID works; use one whose movement is easy to see in your character.',
        targets.animationBones,
      ),
      step(
        'first',
        'Key the starting pose',
        'Set Time (s) to 0, then enter a local transform in Selection details and click its ◇ button. Key each property you want to animate.',
        targets.animationProperties,
      ),
      step(
        'second-time',
        'Move to a later time',
        'Drag the ruler to another time within the clip. Do this before changing the next pose: moving the playhead cancels uncommitted field values.',
        targets.animationRuler,
      ),
      step(
        'second',
        'Key the next pose',
        'Change the same property and click its diamond again. Two keys on that property define the motion. A temporary yellow value alone will not be exported.',
        targets.animationProperties,
      ),
      step(
        'sampling',
        'Choose smooth or stepped motion',
        'Clip settings → Mode selects Smooth or Stepped. Smooth evaluates continuously between keys; Stepped samples poses using FPS. FPS changes sampling without moving authored key times. Clip interpolation currently supports Linear only.',
        targets.animationSettings,
      ),
      step(
        'preview',
        'Play and review',
        'Use Restart, Play and Loop preview to review the clip. Speed changes preview speed only. Undo and Redo revisit committed animation edits.',
        targets.animationPlayback,
      ),
    ],
  },
  {
    id: 'animation-timeline-navigation',
    title: 'Timeline Navigation',
    description: 'Play, scrub, zoom and find bone, IK and event tracks.',
    editor: 'animation',
    category: 'animation',
    prerequisites: animation,
    steps: [
      step(
        'playback',
        'Preview the animation',
        'Restart returns to the start; Play toggles playback and Loop preview repeats it. Space plays or pauses outside typing controls. Home and End seek to the clip boundaries.',
        targets.animationPlayback,
      ),
      step(
        'ruler',
        'Scrub without editing',
        'Drag the ruler to scrub. With ruler focus, arrow keys scrub time and Home/End seek to the boundaries without moving selected keys.',
        targets.animationRuler,
      ),
      step(
        'time',
        'Enter an exact time',
        'Time (s) accepts continuous seconds. Frame appears when the clip has authored FPS and uses zero-based frame numbers. Speed affects preview playback only.',
        targets.animationTime,
      ),
      step(
        'zoom',
        'Zoom and pan',
        'Use the zoom controls, or Ctrl/Cmd + wheel over the timeline, to zoom. Buttons anchor at the playhead; wheel zoom anchors at the pointer. Shift + wheel pans horizontally, and zoom can reveal a horizontal scrollbar.',
        targets.animationZoom,
      ),
      step(
        'tracks',
        'Find and expand tracks',
        'Search tracks finds bone IDs, properties, IK targets and Events. Tracks filters the list. Tracks → Expand All, Collapse All and Expand Selected change disclosure state. Clear Filters restores the track view; these controls do not edit keys.',
        targets.animationTrackNavigation,
      ),
      step(
        'view',
        'Bring timing back into view',
        'Timeline View offers Fit Entire Animation, Fit Selected Keyframes, Center Playhead and Follow playhead. Expand bone rows to edit individual property keys; collapsed diamonds are timing summaries.',
        targets.animationTracks,
      ),
    ],
  },
  {
    id: 'animation-keyframe-editing',
    title: 'Keyframe Editing',
    description: 'Select, move, copy, duplicate and delete bone property keys.',
    editor: 'animation',
    category: 'animation',
    prerequisites: [
      ...animation,
      {
        capability: 'bone-keyframes',
        guideId: 'animation-first-keyframe',
        reason: 'Create a bone property key first. Use Create Your First Keyframe, or select a clip with bone keys.',
      },
    ],
    steps: [
      step(
        'select',
        'Select property keys',
        'Expand a bone row and click a property key. Ctrl/Cmd-click toggles a key; Shift-click selects a range on one property track. Drag empty lanes to select a rectangle; Ctrl/Cmd adds to the selection.',
        targets.animationTracks,
      ),
      step(
        'move',
        'Move keys in time',
        'Drag a selected key to move the selection together. Left/Right nudges with timeline focus; Shift nudges ten steps. Moving onto a key on the same property replaces that destination. Escape cancels a drag. These group operations apply to bone keys.',
        targets.animationTracks,
      ),
      step(
        'copy',
        'Copy, paste and duplicate',
        'Timeline Edit provides Copy Keys, Paste Keys and Duplicate Keys. With timeline focus use Ctrl/Cmd+C, V or D. Paste places copied content at the playhead, preserving tracks and spacing; duplication offsets bone keys by one authored frame. Collisions replace destination values.',
        targets.animationKeyEditing,
      ),
      step(
        'delete',
        'Delete deliberately',
        'Delete Selected Keys removes all selected bone keys, including hidden ones. Delete/Backspace works with timeline focus outside inputs. Undo restores a committed edit. IK keys have single-key deletion and nudging, without group clipboard or marker dragging.',
        targets.animationKeyEditing,
      ),
    ],
  },
  {
    id: 'animation-interpolation',
    title: 'Interpolation',
    description: 'Understand smooth/stepped sampling and the clip’s Linear interpolation.',
    editor: 'animation',
    category: 'animation',
    prerequisites: animation,
    steps: [
      step(
        'mode',
        'Choose how poses are sampled',
        'Clip settings → Mode selects Smooth for continuous motion or Stepped for frame-sampled poses. FPS controls the stepped sampling rate. These settings edit the clip, while authored key times stay unchanged.',
        targets.animationSettings,
      ),
      step(
        'linear',
        'Understand Clip interpolation',
        'Clip interpolation offers Default (Linear) and Linear. They evaluate identically. This format currently supports no easing curves or per-key interpolation overrides; Stepped is a playback sampling mode.',
        targets.animationSettings,
      ),
      step(
        'inspect',
        'Inspect an outgoing segment',
        'Select a bone property key, then open Key details. Selected key interpolation is read-only and inherited from the clip. A final key has no outgoing segment; choose a key with another key after it on that property to inspect the segment.',
        targets.animationInterpolation,
      ),
      step(
        'compare',
        'Review the motion',
        'After exiting, play or scrub to compare Smooth and Stepped. Use Undo to restore a setting you changed. Reading this guide does not change Mode, FPS or interpolation.',
        targets.animationPlayback,
      ),
    ],
  },
  {
    id: 'animation-onion-skinning',
    title: 'Onion Skinning',
    description: 'Compare neighboring authored poses with configurable ghost overlays.',
    editor: 'animation',
    category: 'animation',
    prerequisites: animation,
    steps: [
      {
        ...step(
          'enable',
          'Show neighboring poses',
          'Enable Onion Skinning above the preview. Ghosts help compare poses around the current playhead without creating animation keys.',
          targets.animationOnion,
        ),
        mode: 'try-it',
        practice: {
          targetId: targets.animationOnion,
          instruction: 'Enable the highlighted Onion Skinning checkbox. This changes a preview preference only.',
          changesProject: false,
          completion: { capability: 'onion-enabled', message: 'Onion Skinning is enabled.' },
        },
      },
      step(
        'counts',
        'Choose previous and next poses',
        'Preview options → Onion settings provides Previous poses and Next poses, each from 0 to 3. Set a count to zero to hide that direction. Frame spacing from 1 to 5 uses authored frames.',
        targets.animationOnionSettings,
      ),
      step(
        'appearance',
        'Separate the ghosts visually',
        'Adjust Previous opacity, Next opacity and the two colors in Onion settings. These are preview preferences. Ghosts show authored poses before IK preview, so an IK reach can differ from the ghost.',
        targets.animationOnionSettings,
      ),
      step(
        'compare',
        'Scrub and compare',
        'Scrub to compare the live pose with its neighbors. A clip with no changing bone keys may show overlapping ghosts. Ghosts are read-only and never appear in exported animation JSON.',
        targets.animationCanvas,
      ),
    ],
  },
  {
    id: 'animation-pose-library',
    title: 'Pose Library',
    description: 'Save useful FK poses, preview them safely and reuse them as animation keys.',
    editor: 'animation',
    category: 'animation',
    prerequisites: animation,
    steps: [
      step(
        'save',
        'Save a useful pose',
        'Tools → Pose Library saves the authored pose at the playhead. After exiting this tour, commit or cancel temporary edits, enter a Pose name and choose Full character or Selected bones in Save scope. Selected timeline keys supply multiple bone IDs; otherwise the selected bone is used. Save Current Pose captures FK local transforms before IK, excluding IK targets and temporary edits.',
        targets.animationPoseSave,
      ),
      step(
        'browse',
        'Find and select a pose',
        'Search poses filters the character library by name. Select a saved row to use it. Full poses store every bone; partial poses affect only stored bones and properties. Existing presets appear here too. Preview and Apply require the same character and compatible rig hierarchy, bind transforms and IK configuration; the panel explains incompatible or missing bones.',
        targets.animationPoseBrowse,
      ),
      step(
        'preview',
        'Preview without creating keys',
        'After exiting the tour, choose Preview to inspect the selected pose at the current animation time. It pauses playback and uses the destination animation’s normal IK once. It creates no keys, dirty state or Undo entry. Cancel preview, Escape or closing Pose Library restores the underlying animation. Reading this guide does not start a preview.',
        targets.animationPoseActions,
      ),
      step(
        'apply',
        'Apply at the playhead',
        'Select the destination animation and place its playhead before choosing Apply Pose. Stored FK values create or update relevant keys as one Animation Undo/Redo edit. Partial poses preserve unrelated bones and tracks. IK target values remain those of the destination animation, so final IK appearance can differ. Continue editing or mirroring the resulting keys normally.',
        targets.animationPoseApply,
      ),
      step(
        'organize',
        'Rename or delete deliberately',
        'Select a saved row, then choose Rename and Save name to change its label while retaining its ID. Delete asks for confirmation and removes the reusable pose without removing previously applied keys. This tour never submits a name, confirms deletion or changes the library.',
        targets.animationPoseActions,
      ),
      step(
        'history',
        'Use the right Undo history',
        'Undo library edit and Redo library edit restore saved-pose creation, renames and deletion. Animation Undo/Redo restores applied keys separately. If a later rig edit removed a referenced bone, undo that rig change before restoring the pose. Preview is view state and belongs to neither history.',
        targets.animationPoseHistory,
      ),
      step(
        'keep',
        'Keep the reusable library',
        'Download character ZIP includes saved poses and their manifest entries. Project ZIPs and local autosave include the library too; Project asset libraries show a counted Poses group. Animation JSON contains the resulting keys, not the reusable library. Reading the guide does not download files or create a save checkpoint.',
        targets.rigPackage,
      ),
    ],
  },
  {
    id: 'animation-mirroring',
    title: 'Mirrored Animation',
    description: 'Map bone pairs, preview the opposite side and commit when ready.',
    editor: 'animation',
    category: 'animation',
    prerequisites: animation,
    steps: [
      step(
        'pairs',
        'Configure your rig’s pairs',
        'Open Tools → Mirror tools, then Configure Bone Pairs. Add pair lets you choose actual Left and Right bone IDs. Use inferred pairs is optional: review them for your rig. Valid mappings are browser preferences; no particular bone names are required.',
        targets.animationMirrorPairs,
      ),
      step(
        'direction',
        'Choose direction and scope',
        'Choose Left → Right, Right → Left or Swap. Mirror Current Pose uses the selected source bone, or all mapped source bones when no bone is selected. The panel explains missing pairs and incompatible selections.',
        targets.animationMirrorDirection,
      ),
      step(
        'preview',
        'Preview before committing',
        'Preview Mirrored Pose shows a violet overlay that follows the playhead. M toggles preview with workspace focus. Preview copies authored bone poses before IK; temporary edits and IK targets are excluded. Closing the panel hides the preview.',
        targets.animationMirrorActions,
      ),
      step(
        'commit',
        'Commit only when ready',
        'Mirror Current Pose writes keys at the playhead. Mirror Selected Keys requires bone keys on the chosen source side. Destination keys can be replaced. Each commit is one Undo operation. Reading this tour does not enable preview or commit keys.',
        targets.animationMirrorActions,
      ),
    ],
  },
  {
    id: 'animation-ik-targets',
    title: 'IK Target Animation',
    description: 'Drag a selected IK target and commit position and influence keys.',
    editor: 'animation',
    category: 'ik',
    prerequisites: [
      ...ik,
      {
        capability: 'tool:selected-ik',
        reason:
          'Exit the guide picker and select an IK constraint in the timeline or its preview crosshair, then start IK Target Animation.',
      },
    ],
    steps: [
      step(
        'target',
        'Inspect the selected constraint',
        'The selected constraint appears as IK target: followed by its ID. Target X and Target Y use absolute puppet-local coordinates before facing or camera projection. Influence (mix) ranges from 0 to 1.',
        targets.animationIK,
      ),
      step(
        'options',
        'Enable authored target dragging',
        'Preview options contains Show IK targets and Drag IK targets. Turn off IK preview (fixed targets) to manipulate the authored animation targets. The rig must already contain a compatible IK chain.',
        targets.animationIKOptions,
      ),
      step(
        'drag',
        'Position the requested target',
        'After exiting, choose a time, then drag the constraint’s crosshair in the preview. Releasing leaves temporary values; Escape during dragging restores the previous preview. Circles on the limb show solved contact positions, which may differ from the requested crosshair.',
        targets.animationCanvas,
      ),
      step(
        'commit',
        'Commit position and influence',
        'Set Target Key commits X and Y together at the held playhead. Individual diamonds key X, Y or Influence (mix) separately. Dragging alone does not save keys. Cancel IK edits discards temporary values.',
        targets.animationIK,
      ),
      step(
        'motion',
        'Repeat at another time',
        'Move the playhead, drag to another position and choose Set Target Key again. IK keys support single selection, arrow nudging, deletion and Undo/Redo. Group clipboard and marker dragging are unavailable. Use Play to inspect the reach.',
        targets.animationPlayback,
      ),
    ],
  },
  {
    id: 'animation-ik-baking',
    title: 'IK Baking',
    description: 'Convert authored IK motion into sampled bone rotation keys.',
    editor: 'animation',
    category: 'ik',
    prerequisites: [
      ...ik,
      {
        capability: 'ik-keyframes',
        reason:
          'Create authored IK target or influence keys first. Use IK Target Animation; fixed-target preview alone is not authored IK motion.',
      },
    ],
    steps: [
      step(
        'preview-options',
        'Use authored IK motion',
        'Baking is useful when a consumer needs bone tracks rather than live IK. Turn off IK preview (fixed targets) first. Baking samples authored IK over the entire animation; it does not capture a temporary crosshair drag.',
        targets.animationIKOptions,
      ),
      step(
        'setup',
        'Choose constraints and density',
        'Open Tools → Bake IK. In IK Baking, choose enabled Constraints to bake and Sampling FPS. The panel explains incompatible constraints. Higher sampling rates create more bone rotation keys. Output interpolation is Linear.',
        targets.animationBake,
      ),
      step(
        'review',
        'Review the proposed keys',
        'Review Generated keys, Existing keys to replace and Constraints deactivated for this animation. The clip retains Mode, FPS and interpolation settings. Fidelity results compare joints and endpoints at keys and between keys.',
        targets.animationBake,
      ),
      step(
        'compare',
        'Compare the proposed motion',
        'Preview Bake adds a violet proposed animation over the original. After exiting the tour, scrub to compare the motion. Closing IK Baking clears the preview. Preview does not write the proposal into the animation.',
        targets.animationBakeActions,
      ),
      step(
        'commit',
        'Bake deliberately',
        'Bake IK commits bone rotation keys and deactivates the baked constraints for this animation in one Undo operation. Review replacements first, then export when satisfied. This tour never previews or runs Bake IK.',
        targets.animationBakeActions,
      ),
    ],
  },
  {
    id: 'animation-events',
    title: 'Animation Events',
    description: 'Add timed markers with names and optional JSON payloads.',
    editor: 'animation',
    category: 'animation',
    prerequisites: animation,
    steps: [
      step(
        'add',
        'Add an event at the playhead',
        'After exiting this tour, place the playhead and choose + Event. This creates and selects an event marker. Empty animations can contain events; this tour adds none.',
        targets.animationEvents,
      ),
      step(
        'inspect',
        'Name the event and payload',
        'Select an event marker to show Event in Selection details. Edit Name and Data (JSON; blank removes data). Time (seconds) controls timing. Commit on blur or Enter; JSON uses Ctrl/Cmd+Enter. Escape resets field drafts. Invalid JSON is reported without committing.',
        targets.animationProperties,
      ),
      step(
        'timing',
        'Adjust marker timing',
        'Drag an event marker to move only its time, or nudge it with timeline arrow keys. Same-time events remain separate. Tracks → Event track controls visibility. Scrubbing inspects poses without firing playback events.',
        targets.animationTracks,
      ),
      step(
        'edit',
        'Copy or remove an event',
        'Timeline Edit commands apply to a selected event as well as bone keys. Copy, paste and duplicate preserve event data. Delete Event in Selection details removes the selected event. Undo restores committed edits; export includes event times, names and payloads.',
        targets.animationKeyEditing,
      ),
    ],
  },
  {
    id: 'animation-rig-tweak',
    title: 'Rig-Tweak Mode',
    description: 'Adjust shared rig alignment while keeping animation key authoring distinct.',
    editor: 'animation',
    category: 'animation',
    prerequisites: rig,
    steps: [
      step(
        'mode',
        'Enter Rig Tweak deliberately',
        'After exiting this tour, set Editor Mode to Rig Tweak. Playback pauses at the current pose. Commit or cancel temporary animation edits first. This mode edits shared rig data, affecting every animation using that rig.',
        targets.animationMode,
      ),
      step(
        'tools',
        'Adjust rig alignment',
        'Rig Tweak reveals rig hierarchy, selection tools and rig Undo/Redo in the inspector. Joint Editing, Artwork Offset Editing, Sprite Origin Editing and Slot Transform Editing change rig alignment rather than animation keys. Use the Rig Editor to build or restructure the skeleton.',
        targets.animationMode,
      ),
      step(
        'review',
        'Review the shared result',
        'Review alignment on the preview and compare with Undo rig / Redo rig in Rig Tweak. Motion and IK can change when the underlying rig changes. This tour stays in the current mode and does not modify the rig.',
        targets.animationCanvas,
      ),
      step(
        'return',
        'Return to animation authoring',
        'Set Editor Mode back to Animation to edit keys and preview motion. Download rig JSON in Rig Tweak keeps rig edits; Download JSON in Animation saves the clip. Character package → Download character ZIP keeps both together.',
        targets.animationMode,
      ),
    ],
  },
  {
    id: 'animation-exporting',
    title: 'Exporting Animations',
    description: 'Check the clip, download JSON and keep it in a character package.',
    editor: 'animation',
    category: 'animation',
    prerequisites: animation,
    steps: [
      step(
        'validate',
        'Check animation status',
        'Review the animation status for Validation: OK or reported issues. Export validates the committed animation. Temporary yellow fields are excluded: commit their diamonds or cancel them before deciding what to save.',
        targets.animationValidation,
      ),
      step(
        'download',
        'Download the selected clip',
        'Download JSON saves committed keys, IK, events and settings for the selected Animation. A successful export creates a clean session checkpoint while retaining Undo/Redo. It does not write a file into your project.',
        targets.animationExport,
      ),
      step(
        'integration',
        'Keep the complete character',
        'Character package → Download character ZIP includes working animations with rig, skins, images and manifest entries, including newly created clips. For separate JSON downloads, place the file in the character folder and reference its filename in character.json animations.',
        targets.rigPackage,
      ),
      step(
        'roundtrip',
        'Check a saved clip',
        'File tools offers Import / Paste Animation JSON and Reload Current Export for a round-trip check. Import replaces the current clip and clears Undo/Redo after any required confirmation. Keep a download first. Reading this tour never exports, imports or marks the clip clean.',
        targets.animationExport,
      ),
    ],
  },
  {
    id: 'animation-foot-contact-ground',
    title: 'Aligning Feet to Ground',
    description: 'Inspect evaluated contacts and explicitly commit a supported IK correction.',
    editor: 'animation',
    category: 'animation',
    prerequisites: animation,
    steps: [
      step(
        'ground',
        'Enable the ground guide',
        'After exiting this tour, enable Show ground guide and set Ground Y in preview-world coordinates. Guide settings are browser preferences, independent of the clip.',
        targets.animationGroundVisible,
      ),
      step(
        'show',
        'Show contact markers',
        'Enable Show foot contact markers. They follow the final pose after IK through playback, scrubbing, root motion and facing. Positive distance is below ground; negative is above. Create missing contacts in the Rig Editor.',
        targets.animationContactsVisible,
      ),
      step(
        'select',
        'Select a contact and IK constraint',
        'Choose a Foot contact marker and confirm its existing Foot IK constraint. Without an applicable constraint, use manual posing. Disabled IK, unsupported chain scales or externally owned targets cannot provide a correction.',
        targets.animationContactSelection,
      ),
      step(
        'preview',
        'Preview the correction',
        'Choose Align Selected Foot Contact to Ground. A tinted pose previews the result without changing keys. Review the residual and tolerance (default 0.5 world units). Unreachable or limited results cannot be applied. Changing time, facing, clip or ground discards the proposal.',
        targets.animationContactPreview,
      ),
      step(
        'commit',
        'Commit and Undo',
        'Apply IK target keys explicitly writes X/Y at the playhead as one animation Undo/Redo edit. Existing bone keys stay intact. Cancel alignment preview discards the proposal. Rig Tweak owns rig edits separately and does not author contact animation tracks.',
        targets.animationContactApply,
      ),
    ],
  },
];
