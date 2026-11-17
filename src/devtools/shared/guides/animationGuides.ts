import { GUIDE_TARGETS as targets } from './anchors.js';
import { guideStep } from './step.js';
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
const step = (fields: GuideStep): GuideStep => guideStep({ mode: 'explain', ...fields });

/** Navigation only reveals UI. Optional practice always uses the existing editor controls. */
export const animationGuides: readonly GuideDefinition[] = [
  {
    id: 'animation-library',
    title: 'Using Animation Library',
    description: 'Search reusable clips, organize artist labels and choose shared assets or independent variations.',
    editor: 'animation',
    category: 'animation',
    prerequisites: animation,
    steps: [
      step({
        id: 'open',
        title: 'Browse this character’s animations',
        description:
          'After exiting this tour, choose **Animation Library** and expand its counted browser. It uses this character’s existing animation documents. Commit or cancel temporary edits and use **Animation mode** first. Reading this guide only reveals controls; it never opens the library dialog, selects a clip, starts playback or changes keys.',
        targetId: targets.animationLibrary,
      }),
      step({
        id: 'search',
        title: 'Search names and optional tags',
        description:
          'Inside the library, **Search animations** matches stable IDs, display names and tags. Rows show source character, duration, looping and compatibility. Direct reuse requires the same character’s **rig identity**. For cross-character transfer, use **Retarget to Another Character** in **Project Workspace**. Its browser also offers **Compatible character / rig** and **Compatible rig only**.',
        targetId: targets.animationLibrary,
      }),
      step({
        id: 'metadata',
        title: 'Give the selected clip readable labels',
        description:
          'Expand **Library metadata** for the selected animation. Enter an optional **Display name**, **Description** and comma-separated **Tags**, then choose **Save library metadata**. Labels do not change the stable Animation ID or motion. They use ordinary animation **Undo/Redo**, autosave and JSON/package export. Select a different source before editing its labels; manual tagging is never required.',
        targetId: targets.animationLibrary,
      }),
      step({
        id: 'preview',
        title: 'Preview on the existing canvas',
        description:
          'Choose **Preview animation** after the tour. The library closes, selects the source while retaining other clips’ edits and plays it on this canvas, including **Environment Preview** when enabled. Use **Play/Pause**, **Restart** and **Loop preview** to review skeletal motion, IK, root travel and mesh deformation. Preview creates no authored keys or history entries.',
        targetId: targets.animationPlayback,
      }),
      step({
        id: 'shared',
        title: 'Understand existing references',
        description:
          '**Use Existing Animation** and **Locate Original Asset** select the source document with its stable ID. They make no copies. Editing a shared source can affect every Scene Actor or action that references it. The library keeps other clips’ committed edits and histories when switching selection.',
        targetId: targets.animationLibrary,
      }),
      step({
        id: 'copy',
        title: 'Make a separate editable variation',
        description:
          'In the library, **Create Independent Copy** creates a deep copy with an unused ID. Bone curves, IK and suppression, root motion, deformation, metadata and event payloads remain independent. Edit the variation and return to the source to compare. The separate **Create Variation** dialog offers a custom ID and time scale. Undo/Redo applies to edits; creating a clip is navigation.',
        targetId: targets.animationVariation,
      }),
      step({
        id: 'save',
        title: 'Save and reuse in a scene',
        description:
          '**Download JSON** keeps the selected clip and its labels. Character/project ZIPs include all registered animations and stable references. In **Scene Editor**, use the library for Actor properties, animation action properties or the timeline’s **Actions** tab. Apply action drafts explicitly; existing action timing and movement ownership remain intact. Reopen the scene after creating a variation. This guide never exports or marks data clean.',
        targetId: targets.animationExport,
      }),
    ],
  },
  {
    id: 'animation-mesh-deformation',
    title: 'Animating Mesh Deformation',
    description: 'Correct a weighted sleeve or cape with sparse vertex offsets, neutral shapes and animation keys.',
    editor: 'animation',
    category: 'animation',
    prerequisites: [
      ...animation,
      {
        capability: 'mesh-attachments',
        guideId: 'rig-mesh-geometry',
        reason:
          'Create a mesh attachment in the Rig Editor first. Use Editing Mesh Geometry, then select a preview skin that displays the mesh.',
      },
    ],
    steps: [
      step({
        id: 'mode',
        title: 'Add corrections over skeletal animation',
        description:
          'After exiting this tour, enable **Edit Mesh Deformation** in the **Mesh Deformation** inspector tab. Bone weights remain the main deformation source. Optional corrections add **attachment-local bind-space offsets** before FK/IK skinning and Puppet/Actor placement; they do not change base geometry, UVs, weights, root motion or pelvis keys. This tour only reveals controls: it never enables the mode, selects a mesh or creates keys.',
        targetId: targets.animationDeformationMode,
      }),
      step({
        id: 'mesh',
        title: 'Choose the attachment and its visible skin',
        description:
          'Choose **Mesh** after exiting. The main preview needs a **skin** that displays that attachment; creating a rectangle mesh from a default skin may have made a separate mesh skin variant. Mesh names come from your character. Finish geometry and weight painting in the Rig Editor first; use **Editing Mesh Geometry** and **Painting Bone Weights** for those workflows.',
        targetId: targets.animationDeformationMesh,
      }),
      step({
        id: 'neutral',
        title: 'Bracket a correction with neutral shapes',
        description:
          'For a sword cut, animate the arm with bones first. At a time before the sharp elbow bend, use **Set neutral key**; add another after the correction should end. A neutral shape has zero offsets. Missing vertices also mean **zero offset**. A single shape holds throughout the clip, and the first/last shapes hold outside their keyed range, so neutral keys control the return to ordinary weighted skinning. **Add shape key** captures the sampled correction shape at the playhead.',
        targetId: targets.animationDeformationShapes,
      }),
      step({
        id: 'vertex',
        title: 'Select vertices in bind space',
        description:
          'Move the **playhead** to the bent elbow, then choose **Vertex** or click a **square handle** in the bind-space triangle view. **Shift-click** adds vertices to a group; dragging a selected square translates the group. These handles are separate from bone and IK controls. This view edits attachment-local corrections rather than trying to invert the posed silhouette, which can be ambiguous where weighted bones overlap.',
        targetId: targets.animationDeformationVertex,
      }),
      step({
        id: 'offsets',
        title: 'Refine the sleeve silhouette',
        description:
          'Enter **Offset X/Y** and click **Set vertex correction key**, or drag a square while watching the main textured preview. Numeric values set the requested offsets for all selected vertices; unselected corrections are retained. Corrections are sparse and belong only to the chosen animation. A drag previews temporarily and commits one **Undo** operation on release. **Escape**, pointer cancellation or window blur cancels it. **Redo** restores a committed correction.',
        targetId: targets.animationDeformationOffsets,
      }),
      step({
        id: 'timing',
        title: 'Select, retime and interpolate shape keys',
        description:
          'Find the per-mesh row under **Mesh Deformation** in the timeline. Select a key to seek to it, drag horizontally to retime, or use **arrow keys** to nudge; Shift bypasses frame snapping during a drag. **Key time (s)** and **Apply key** retime the selected shape. **Outgoing interpolation** chooses Linear or Stepped. Imported Bezier controls can be preserved; choosing another mode replaces them. Timeline **Copy/Paste**, **Duplicate** and **Delete** edit whole shape keys. Moves and pastes reject occupied times rather than overwriting another shape.',
        targetId: targets.animationDeformationTiming,
      }),
      step({
        id: 'preview',
        title: 'Scrub before, during and after the bend',
        description:
          'Scrub and play across the **neutral keys** and correction. The main preview shows final bone-weighted geometry with corrections applied once; **Smooth/Stepped** playback uses the ordinary clip timing. Seeking to the same time produces the same shape without accumulating offsets. Enable **Show mesh diagnostics** to review final FK/IK triangles, collapse, inversion and >3× edge stretch, then hide it for ordinary preview. Warnings never modify keys. **Undo/Redo** changes authored corrections, while playback and scrubbing never create keys. Use a skin containing the chosen mesh when comparing the corrected silhouette. **Onion skins** sample each neighbor’s correction shape and FK pose before IK, at the current preview placement rather than sampled root travel. Bake IK to inspect solved ghost silhouettes.',
        targetId: targets.animationCanvas,
      }),
      step({
        id: 'compatibility',
        title: 'Keep stable vertex references and tool limits in view',
        description:
          '**Stable vertex IDs** keep corrections attached through reordering and subdivision; new vertices start neutral. Deleted/replaced IDs or a missing mesh produce a topology warning and block export. Restore the IDs, or explicitly use **Remove incompatible tracks**; the editor retains the authored data until that command. **Animation Variations** scale shape times, and Pose Library, IK baking and bone mirroring preserve corrections. Mesh mirroring and deformation channels in **Graph Editor** are unavailable; use this inspector for offsets and shape interpolation. Motion Diagnostics measures bones.',
        targetId: targets.animationDeformationCompatibility,
      }),
      step({
        id: 'save',
        title: 'Save and reload the corrected animation',
        description:
          '**Download JSON** preserves committed correction keys with bones, IK, events and settings. **File tools → Reload Current Export** checks the animation round trip; import/reload replaces the session history after any required confirmation. **Character package → Download character ZIP** keeps the clip together with its mesh rig, weights, skin assignments and artwork. Reload, select the same mesh skin and scrub the elbow again. In **Scene Editor**, add this character as an Actor and choose that mesh skin. For the complete handoff, open **Mesh Characters Across Editors** under Project Workspace in Feature Guide. Runtime playback uses the same correction sampling and skinning order as the editor. Reading or finishing this tour does not export, mark the clip clean or change any authored data.',
        targetId: targets.animationExport,
      }),
    ],
  },
  {
    id: 'animation-root-motion',
    title: 'Creating Root Motion',
    description: 'Author whole-character travel with root position keys, a viewport handle and Graph Editor curves.',
    editor: 'animation',
    category: 'animation',
    prerequisites: animation,
    steps: [
      step({
        id: 'controls',
        title: 'Author travel independently of the body',
        description:
          '**Root Motion** stores real exported translation keys, separately from pelvis, bones and IK. After exiting this guide, set time to 0 and use **Set position key** with X = 0 and Y = 0. Inspector sections start collapsed; this tour only reveals controls.',
        targetId: targets.animationRootMotion,
      }),
      step({
        id: 'timeline',
        title: 'Select and retime root keys',
        description:
          'The **Root Motion** group above the skeletal tracks has **Position X** and **Position Y** rows. Select a key to seek to it; drag horizontally to retime with frame snapping, or hold Shift for free timing. Crossing another key is rejected. Delete removes one axis. Duplicate copies the selected axis one frame later, or to a different playhead time. Root keys never modify bone or IK keys.',
        targetId: targets.animationTracks,
      }),
      step({
        id: 'handle',
        title: 'Move the entire character',
        description:
          'After exiting, enable **Edit Root Motion**. At the forward step, add a position key; advance the **playhead** and drag the purple square at the character origin, or enter X = 80. Release creates one undo step for both axes. **Escape** cancels the drag. Facing and character scale transform the authored offsets; camera pan and zoom are inverted when dragging. Ground and camera stay fixed. Disable Edit Root Motion to return to ordinary bone and IK picking.',
        targetId: targets.animationRootMotion,
      }),
      step({
        id: 'curves',
        title: 'Shape travel with the existing Graph Editor',
        description:
          'Select a root **Position X** or **Position Y** key, then open **Graph Editor**. Its existing value/time controls, outgoing Linear, Stepped and Bezier interpolation, and tangent precision controls edit the selected root channel. The last key has no outgoing segment. Graph drags also commit one undo step and support Escape.',
        targetId: targets.animationGraphProperty,
      }),
      step({
        id: 'review',
        title: 'Review and save a sword attack',
        description:
          'Keep the anticipation and sword cut on skeletal keys. Author a root start at 0, a step to 80 and a final hold at 80. Scrub and play to see pelvis bob and feet travel over fixed ground. Root loop behavior chooses reset or continuous travel with **Loop preview**. **World displacement** selects **Authored Root Motion**, Preview-Only Displacement or No World Displacement; movement is never added twice. Show root trajectory only changes the view. Undo/Redo restores authored edits; animation export, reload and character packages retain root keys and curves. Preview and runtime measure displacement from the first sample, transformed once by facing and scale.',
        targetId: targets.animationRootMotion,
      }),
    ],
  },
  {
    id: 'animation-root-vs-pelvis',
    title: 'Root Motion vs Pelvis Animation',
    description: 'Keep body posing on bones and whole-character translation on independent root tracks.',
    editor: 'animation',
    category: 'animation',
    prerequisites: animation,
    steps: [
      step({
        id: 'bone',
        title: 'Find the pelvis in your skeleton',
        description:
          'After exiting this tour, select your pelvis or body bone in **Bones**. Bone names depend on your rig. The pelvis remains an ordinary skeletal bone; its keys pose the body relative to its parent. This tour never selects a bone or changes keys.',
        targetId: targets.animationBones,
      }),
      step({
        id: 'pose',
        title: 'Animate body movement within the skeleton',
        description:
          'Use the selected bone’s **position and rotation** fields and **property key** buttons for anticipation, pelvis bob, leg stepping and sword poses. Translating the pelvis can move its descendants, but does not move the outer Actor. Keep these skeletal keys when adding travel.',
        targetId: targets.animationProperties,
      }),
      step({
        id: 'root',
        title: 'Move the Actor independently',
        description:
          'Open **Root Motion** and enable **Edit Root Motion** after exiting. **Position X/Y** and the purple square move the whole character before the normal skeleton and IK pass. Facing and scale transform travel once. Compare Authored Root Motion with No World Displacement: the same body poses remain. Ground and background stay fixed; do not also add matching pelvis travel or a scene move for the same displacement.',
        targetId: targets.animationRootMotion,
      }),
    ],
  },
  {
    id: 'animation-preview-displacement',
    title: 'Preview Displacement',
    description:
      'Add a temporary world trajectory for steps, dodges, jumps or any animation while preserving authored motion.',
    editor: 'animation',
    category: 'animation',
    prerequisites: animation,
    steps: [
      step({
        id: 'enable',
        title: 'Keep authored motion and opt into displacement',
        description:
          '**Authored Root Motion** is the default. After exiting this tour, select **Use Preview-Only Displacement** to view a temporary world trajectory instead of authored root translation. **No World Displacement** suppresses both. Skeletal and IK tracks still play in every mode; no authored keys change. Enable Environment Preview above the canvas for a static background; an image is optional. This tour only reveals controls and changes no settings or animation data.',
        targetId: targets.animationDisplacementEnable,
      }),
      step({
        id: 'add',
        title: 'Add a point at animation time',
        description:
          'After exiting, pause and set **Time (s)** or scrub the existing ruler, then choose **Add position point**. It starts at that **playhead** time with the trajectory’s current offset. If that time is occupied, Add suggests the midpoint of the largest interval. Start with a zero offset at time 0. These preview points are separate from real animation keyframes; no walking-specific simulator is used.',
        targetId: targets.animationDisplacementAdd,
      }),
      step({
        id: 'points',
        title: 'Edit timed world positions',
        description:
          'Enter **Time (s)**, **Offset X** and **Offset Y**, then Apply point. X increases right and Y down in world pixels, independently of facing and scale; choose the X sign for your intended direction. A short step can use 0s → (0, 0), 0.3s → (0, 0), 0.55s → (45, 0), 1s → (45, 0). A jump can use 0s → (0, 0), 0.5s → (40, -100), 1s → (80, 0). Points sort by time. Use finite numbers and unique nonnegative times. Remove deletes only that preview point. With no points, add one after exiting this tour.',
        targetId: targets.animationDisplacementPoints,
      }),
      step({
        id: 'interpolation',
        title: 'Choose how segments move',
        description:
          '**Linear** interpolates each segment, allowing different speeds, stationary intervals, backward or sideways moves and returns to earlier positions. Equal adjacent offsets hold still. **Stepped** holds an offset until the next point’s exact time. The first and last offsets hold outside the point range. Points beyond the current clip duration are retained for a longer clip but are not reached during current playback.',
        targetId: targets.animationDisplacementInterpolation,
      }),
      step({
        id: 'time',
        title: 'Review synchronized motion',
        description:
          'After exiting, play, pause or seek with **Time (s)** and the ruler to compare the same pose with and without displacement. Both use the existing animation clock; stepped playback holds the same sampled pose and offset, including the exact clip endpoint. **Loop preview** returns to the initial displacement each cycle. Seeking to a time gives the same offset from either direction. IK continues through the normal Puppet solve; this tool does not lock feet or author IK keys.',
        targetId: targets.animationTime,
      }),
      step({
        id: 'trajectory',
        title: 'Show the spatial trajectory',
        description:
          '**Show preview trajectory** draws an independent line and circles in the viewport while displacement is enabled. It marks the preview origin’s world path, not bone motion or background artwork; stationary and repeated positions overlap. Wheel zooms and middle drag pans. **Facing** mirrors the character while world offsets and the environment keep their direction. An empty trajectory can be configured after exiting this guide.',
        targetId: targets.animationDisplacementTrajectory,
      }),
      step({
        id: 'reset',
        title: 'Disable, reset and keep the right data',
        description:
          'Uncheck **Use Preview-Only Displacement** to return to **Authored Root Motion**, or select **No World Displacement** in Root Motion. All preview points and authored skeletal motion remain intact. Reset trajectory clears points and restores Authored Root Motion. Preview Copy to Root Motion offers an explicit converted preview; Apply Copy replaces root keys in one Undo operation while retaining the preview points. Each clip retains its own trajectory, motion mode and Loop preview preference. Local drafts recover these settings and artwork as a project after refresh. Project ZIPs preserve them; production animation JSON and character ZIPs exclude them. Animation Undo/Redo remains dedicated to authored data. This guide never enables, resets or saves anything for you.',
        targetId: targets.animationDisplacementReset,
      }),
    ],
  },
  {
    id: 'animation-environment-preview',
    title: 'Environment Preview',
    description:
      'Preview animations against world artwork with fixed/follow cameras, synchronized playback and scrubbing.',
    editor: 'animation',
    category: 'animation',
    prerequisites: animation,
    steps: [
      step({
        id: 'enable',
        title: 'Enable Environment Preview',
        description:
          'After exiting this tour, enable **Environment Preview** above the canvas or in its inspector section. Use it for any animation, including attacks, jumps, rolls and in-place motion. The same character, IK, skins, facing and playback are used. This tour only reveals controls; it does not enable the preview or change your animation.',
        targetId: targets.animationEnvironmentEnable,
      }),
      step({
        id: 'import',
        title: 'Import or browse project artwork',
        description:
          '**Import Image** accepts PNG or static WebP. In a project, **Load project character images** also offers existing character artwork in **Background**. Imported project images enter the shared image library and can be reused by other animations. Standalone local drafts also retain artwork; recover the draft as a project and export a project ZIP for a portable copy. No image is required to read this guide.',
        targetId: targets.animationEnvironmentImport,
      }),
      step({
        id: 'background',
        title: 'Choose and show a background',
        description:
          '**Background** selects an image from the shared library. No background is a valid starting state: import an image first if the list is empty. **Show background** hides the image while retaining its selection and transform. A missing image can be replaced by selecting or importing another image. These controls leave keys and animation history unchanged.',
        targetId: targets.animationEnvironmentBackground,
      }),
      step({
        id: 'transform',
        title: 'Position the image in preview world',
        description:
          '**Background X/Y** identify the image center in world pixels: X increases right, Y down. The character preview origin is (380, 435). **Scale** is uniform; 1 uses native image size. Enter values and choose Apply background transform. Reset background transform restores (0, 0) and scale 1. The image is independent of the character and its bones.',
        targetId: targets.animationEnvironmentTransform,
      }),
      step({
        id: 'ground',
        title: 'Align the visible floor',
        description:
          'Enable **Show Ground Reference** to use the existing guide. Set **Ground Y** in **Ground reference**, then use Align image bottom to ground to move only the background. It preserves X and scale. For a floor inside the image, adjust Background Y until it meets the line. This never moves bones, IK targets or keyframes; alignment is available after selecting an image and showing the guide.',
        targetId: targets.animationEnvironmentGround,
      }),
      step({
        id: 'camera-mode',
        title: 'Choose Fixed or Follow Character',
        description:
          'After exiting, open **Preview Camera** inside Environment Preview. **Fixed** keeps the selected world center steady so steps, jumps and walk cycles travel across the background. **Follow Character** adds the selected authored or preview-only world displacement to that center: the character stays framed while world artwork scrolls in the viewport. Root Motion selects one movement mode; skeletal translation stays inside the skeleton. Facing and scale affect authored root travel once, while preview-only offsets use world pixels. No image or trajectory is required to read this tour.',
        targetId: targets.animationEnvironmentCameraMode,
      }),
      step({
        id: 'camera-framing',
        title: 'Set framing, zoom or reset the camera',
        description:
          '**Camera X/Y** set the world center, starting at (380, 435); Follow adds displacement to that center. Enter values and choose **Apply preview camera**. **Zoom** accepts 0.1 to 4; zoom out to inspect travel beyond the image. Wheel zooms and middle drag pans the same preview camera, including a framing offset in Follow mode. Movement is never clamped to the background. Reset Camera restores Fixed, center (380, 435) and zoom 1 without changing animation time, trajectory or background placement. This tour only reveals these controls.',
        targetId: targets.animationEnvironmentCameraTransform,
      }),
      step({
        id: 'playback',
        title: 'Use the shared playback controls',
        description:
          'After exiting, use the existing **Play/Pause**, **Restart**, **Speed** and Loop preview controls. Pose, preview displacement, ground contacts and camera share the same animation clock. Pause holds the preview. Restart returns to the configured beginning and keeps the current play/pause state. Preview-only loops reset to their first position. Authored root loops use Reset each cycle or Continuous travel in Root Motion; continuous travel adds each cycle’s end-minus-start offset. Direct seeking starts in cycle zero. No frame integrates displacement twice. Stepped playback holds pose, displacement and camera together. The guide never starts, pauses or restarts playback for you.',
        targetId: targets.animationPlayback,
      }),
      step({
        id: 'review',
        title: 'Scrub forward and backward consistently',
        description:
          'After exiting, set **Time (s)** or scrub the ruler forward and backward, then revisit the same time. Pose, preview displacement and camera return to the same evaluated state, including exact clip endpoints. Seeking does not trigger animation events, gameplay callbacks or audio. **Background** placement and **Ground Y** stay fixed in world space even in Follow mode. Facing mirrors only the character. Existing foot markers follow the final pose and displacement; passive preview never snaps feet, changes IK or corrects contact drift.',
        targetId: targets.animationTime,
      }),
      step({
        id: 'reset-save',
        title: 'Reset and keep the right assets',
        description:
          'Disabling **Environment Preview** or entering Rig Editor/Rig Tweak restores the ordinary editor viewport. Return to Animation mode and enable Environment Preview to reuse its camera settings. Background placement, ground and default camera are shared character preferences; displacement and Loop preview belong to each clip. Local drafts recover them after refresh, and project ZIPs keep them when reopened. Production animation JSON, character ZIPs and animation Undo/Redo exclude these editor preferences. Clear background removes the selection without deleting the shared image. **Reset Environment** also resets the camera and disables the mode while preserving the ground guide and library. Download a **project ZIP** to keep the preferences and images. Standalone local drafts recover into Project Workspace for this export. This guide never resets or saves anything for you.',
        targetId: targets.animationEnvironmentReset,
      }),
    ],
  },
  {
    id: 'animation-ground-reference',
    title: 'Using Ground Reference',
    description: 'Inspect contact against a fixed preview reference and explicitly align an authored IK target.',
    editor: 'animation',
    category: 'animation',
    prerequisites: rig,
    steps: [
      step({
        id: 'enable',
        title: 'Enable the line',
        description:
          'After exiting this tour, enable **Show ground guide**. The line is a visual reference, not a physics floor. Settings belong to this character in this browser, independently of animation keys.',
        targetId: targets.animationGroundVisible,
      }),
      step({
        id: 'position',
        title: 'Position Ground Y',
        description:
          'Enter a finite **Ground Y** and press Enter, or drag the amber ↕ Ground label in the preview. This uses fixed preview-world coordinates, including the character preview placement; it is not Scene Editor ground Y. Guide **Undo/Redo** affects preferences only.',
        targetId: targets.animationGroundY,
      }),
      step({
        id: 'contact',
        title: 'Inspect foot contact',
        description:
          'Enable **Show foot contact markers** to inspect rig contacts and signed ground distances while playing or scrubbing. Choose a contact and confirm its existing foot IK constraint for explicit preview/apply alignment. Root translation, facing and scale affect contacts; the reference stays fixed. Jumping or flying poses remain free to leave the line.',
        targetId: targets.animationCanvas,
      }),
      step({
        id: 'align',
        title: 'Align an IK target where supported',
        description:
          'With an animation and authored IK target selected, **Align IK target Y to guide** writes X/Y keys at the playhead while preserving world X. Animation **Undo/Redo** restores this real edit. Without IK, use the reference visually. No sole-contact marker is inferred, and solver reach or influence can limit contact.',
        targetId: targets.animationGroundAlign,
      }),
      step({
        id: 'reset',
        title: 'Hide or reset the guide',
        description:
          '**Reset Ground Y** restores the preview default without moving the character. Uncheck **Show ground guide** to hide it. Preferences survive switching clips and reopening the character here; animation and character exports carry authored edits, without guide preferences.',
        targetId: targets.animationGroundReset,
      }),
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
      step({
        id: 'new',
        title: 'Start an empty clip',
        description:
          'After exiting this tour, choose **+ New Animation**. No existing animation JSON is required. A character with only a **root bone** can start here.',
        targetId: targets.animationNew,
      }),
      step({
        id: 'settings',
        title: 'Choose name, duration and FPS',
        description:
          'The **Create new animation** dialog asks for **Animation name / ID**, **Duration (seconds)**, Animation FPS and Loop enabled. Use a unique ID with letters, numbers, - or _. Choose Create Animation when ready; confirm any unsaved-work prompt deliberately.',
        targetId: targets.animationNew,
      }),
      step({
        id: 'selection',
        title: 'Find your new animation',
        description:
          'Animation selects a clip for this character. A new clip is selected with empty tracks and stepped playback at your chosen **FPS**. Each clip keeps its own working edits when you switch.',
        targetId: targets.animationSelection,
      }),
      step({
        id: 'bones',
        title: 'Choose what to animate',
        description:
          'Open **Bones** and select any bone in your rig, or select its joint in the preview. Use **Create Your First Keyframe** to add motion after creating the clip.',
        targetId: targets.animationBones,
      }),
      step({
        id: 'save',
        title: 'Keep the new clip',
        description:
          '**Download JSON** exports committed animation data. **Download character ZIP** in **Character package** includes the new clip and its manifest entry. Neither action writes files into your project.',
        targetId: targets.animationExport,
      }),
    ],
  },
  {
    id: 'animation-variation',
    title: 'Create an Animation Variation',
    description: 'Copy an existing animation, preview optional timing changes and edit the new clip independently.',
    editor: 'animation',
    category: 'animation',
    prerequisites: animation,
    steps: [
      step({
        id: 'source',
        title: 'Choose the source animation',
        description:
          'After exiting this tour, select the animation you want to build on. **Create Variation** copies its current authored working copy, including committed unsaved edits. Finish or cancel temporary bone/IK edits and key drags first. The source animation stays unchanged; this tour only highlights controls.',
        targetId: targets.animationSelection,
      }),
      step({
        id: 'name',
        title: 'Open Create Variation and choose an ID',
        description:
          'Choose **Create Variation** to open its dialog. Check **Source**, then enter a unique **New name / ID**. The suggested ID is unused; duplicate IDs are rejected. Use letters, numbers, - or _, starting with a letter or number. The name stays the stable animation ID; **Animation Library → Library metadata** provides an optional display name. To give a later version another ID, create another variation.',
        targetId: targets.animationVariation,
      }),
      step({
        id: 'timing',
        title: 'Keep timing or scale the whole clip',
        description:
          'In the dialog, **Time scale** 1 keeps timing, 2 doubles duration and 0.5 plays twice as fast. **Duration**, bone keys, IK keys and events scale together. Curves, event payloads, loop/playback settings and baked IK suppression are preserved. Authored stepped **FPS** stays the same. Invalid scales or collapsed key times are rejected.',
        targetId: targets.animationVariation,
      }),
      step({
        id: 'preview',
        title: 'Preview before creating',
        description:
          'Change **Time scale** or scrub **Preview position** in the dialog to sample the proposal on this canvas. Preview pauses playback without changing the source, its **playhead**, exports or history, and fires no animation events. Cancel or Escape discards the proposal and restores the held source pose. This tour does not open the dialog or start a preview.',
        targetId: targets.animationCanvas,
      }),
      step({
        id: 'create',
        title: 'Create a separate New / Unsaved animation',
        description:
          'When ready, choose **Create Variation** in the dialog. The new clip is registered and selected as **New / Unsaved**, paused at zero, with its own empty edit history. The source keeps its committed edits and history. Tracks, curves and nested event payloads are independent copies; later changes to either animation never propagate to the other.',
        targetId: targets.animationSelection,
      }),
      step({
        id: 'edit',
        title: 'Edit and compare independently',
        description:
          'Select a bone or IK track and edit keys normally. **Graph Editor** refines outgoing curves; **Pose Library**, **Mirror tools** and IK baking work on the variation as usual. Undo/Redo affects edits to the selected clip; creation itself is navigation. Switch between source and variation to compare them. Revert restores the variation’s initial copied baseline.',
        targetId: targets.animationGraphToggle,
      }),
      step({
        id: 'save',
        title: 'Keep the variation and use its new ID',
        description:
          '**Download JSON** exports the selected variation. Character and project ZIPs include registered variations, including inactive ones. Reload/import uses the ordinary animation format. Scene Editor animation clips and runtime queues/states refer to the new ID; existing source references stay unchanged. Downloading does not write files into the source directory.',
        targetId: targets.animationExport,
      }),
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
      step({
        id: 'bone',
        title: 'Select a bone',
        description:
          'Open **Bones** and choose any bone in this rig. Selecting an **IK target** or event shows a different inspector.',
        targetId: targets.animationBones,
        mode: 'try-it',
        practice: {
          targetId: targets.animationBones,
          instruction: 'Choose a bone in the highlighted **Bones** list. This changes selection only.',
          changesProject: false,
          completion: { capability: 'selected-bone', message: 'A bone is selected.' },
        },
      }),
      step({
        id: 'time',
        title: 'Place the playhead',
        description:
          'Enter **Time (s)**, or drag the **timeline ruler**, to choose the key time. Start at 0 for the initial pose. Scrubbing cancels temporary transform edits, so place the **playhead** before entering values.',
        targetId: targets.animationTime,
      }),
      step({
        id: 'value',
        title: 'Enter a local transform',
        description:
          '**Selection details** shows the selected bone’s **local transform** relative to its parent. Enter a position, rotation or scale value. Rotation uses degrees. **Yellow fields** are temporary and do not yet belong to the animation.',
        targetId: targets.animationProperties,
      }),
      step({
        id: 'key',
        title: 'Commit the property key',
        description:
          '**Click ◇** beside a property to set a key at the **playhead**. **◆** updates an existing key. Each property is keyed separately. Optional practice uses the X key button with the current value.',
        targetId: targets.animationProperties,
        mode: 'try-it',
        practice: {
          targetId: targets.animationXKey,
          instruction:
            'Click **Set X key** to commit the current X value at the playhead. This changes your real animation. **Undo** and **Redo** remain available after exiting the guide.',
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
      }),
      step({
        id: 'track',
        title: 'Inspect the result',
        description:
          'Expand the bone’s **timeline row** to see its **property key**. A collapsed bone diamond summarizes timing; expand it to edit individual keys. Add another key at a different time to create movement.',
        targetId: targets.animationTracks,
      }),
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
      step({
        id: 'bone',
        title: 'Choose a bone',
        description:
          'After exiting this tour, choose a bone in **Bones**. Any bone ID works; use one whose movement is easy to see in your character.',
        targetId: targets.animationBones,
      }),
      step({
        id: 'first',
        title: 'Key the starting pose',
        description:
          'Set **Time (s)** to 0, then enter a **local transform** in **Selection details** and click its ◇ button. Key each property you want to animate.',
        targetId: targets.animationProperties,
      }),
      step({
        id: 'second-time',
        title: 'Move to a later time',
        description:
          'Drag the ruler to another time within the clip. Do this before changing the next pose: moving the **playhead** cancels **uncommitted field values**.',
        targetId: targets.animationRuler,
      }),
      step({
        id: 'second',
        title: 'Key the next pose',
        description:
          'Change the **same property** and click its diamond again. **Two keys** on that property define the motion. A **temporary yellow value** alone will not be exported.',
        targetId: targets.animationProperties,
      }),
      step({
        id: 'sampling',
        title: 'Choose smooth or stepped motion',
        description:
          '**Clip settings** → **Mode** selects **Smooth** or Stepped. Smooth evaluates continuously between keys; Stepped samples poses using FPS. FPS changes sampling without moving authored key times. Clip interpolation currently supports Linear only.',
        targetId: targets.animationSettings,
      }),
      step({
        id: 'preview',
        title: 'Play and review',
        description:
          'Use **Restart**, **Play** and **Loop preview** to review the clip. Speed changes preview speed only. Undo and Redo revisit committed animation edits.',
        targetId: targets.animationPlayback,
      }),
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
      step({
        id: 'playback',
        title: 'Preview the animation',
        description:
          '**Restart** returns to the start; **Play** toggles playback and **Loop preview** repeats it. Space plays or pauses outside typing controls. Home and End seek to the clip boundaries.',
        targetId: targets.animationPlayback,
      }),
      step({
        id: 'ruler',
        title: 'Scrub without editing',
        description:
          'Drag the ruler to scrub. With ruler focus, **arrow keys** scrub time and **Home/End** seek to the boundaries without moving selected keys.',
        targetId: targets.animationRuler,
      }),
      step({
        id: 'time',
        title: 'Enter an exact time',
        description:
          '**Time (s)** accepts continuous seconds. Frame appears when the clip has authored **FPS** and uses zero-based frame numbers. **Speed** affects preview playback only.',
        targetId: targets.animationTime,
      }),
      step({
        id: 'zoom',
        title: 'Zoom and pan',
        description:
          'The timeline’s **View** tab contains zoom controls. Use these, or **Ctrl/Cmd + wheel** over the timeline, to zoom. Buttons anchor at the **playhead**; wheel zoom anchors at the pointer. **Shift + wheel** pans horizontally, and zoom can reveal a horizontal scrollbar.',
        targetId: targets.animationZoom,
      }),
      step({
        id: 'tracks',
        title: 'Find and expand tracks',
        description:
          'The **Tracks & keys** tab groups track search, filtering and editing. Search tracks finds bone IDs, properties, **IK targets** and **Events**. Tracks filters the list. Tracks → Expand All, Collapse All and Expand Selected change disclosure state. Clear Filters restores the track view; these controls do not edit keys.',
        targetId: targets.animationTrackNavigation,
      }),
      step({
        id: 'view',
        title: 'Bring timing back into view',
        description:
          'The timeline’s **View** tab offers **Fit Entire Animation**, **Fit Selected Keyframes**, **Center Playhead** and **Follow playhead** in its Navigation menu. Expand bone rows to edit individual property keys; collapsed diamonds are timing summaries.',
        targetId: targets.animationZoom,
      }),
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
      step({
        id: 'select',
        title: 'Select property keys',
        description:
          'Expand a bone row and click a **property key**. **Ctrl/Cmd-click** toggles a key; **Shift-click** selects a range on one property track. Drag empty lanes to select a rectangle; Ctrl/Cmd adds to the selection.',
        targetId: targets.animationTracks,
      }),
      step({
        id: 'move',
        title: 'Move keys in time',
        description:
          'Drag a selected key to move the selection together. **Left/Right** nudges with timeline focus; **Shift** nudges ten steps. Moving onto a key on the same property replaces that destination. **Escape** cancels a drag. These group operations apply to bone keys.',
        targetId: targets.animationTracks,
      }),
      step({
        id: 'copy',
        title: 'Copy, paste and duplicate',
        description:
          'Timeline Edit provides **Copy** Keys, **Paste** Keys and **Duplicate** Keys. With timeline focus use Ctrl/Cmd+C, V or D. Paste places copied content at the playhead, preserving tracks and spacing; duplication offsets bone keys by one authored frame. Collisions replace destination values.',
        targetId: targets.animationKeyEditing,
      }),
      step({
        id: 'delete',
        title: 'Delete deliberately',
        description:
          '**Delete** Selected Keys removes all selected bone keys, including hidden ones. Delete/Backspace works with timeline focus outside inputs. **Undo** restores a committed edit. IK keys have single-key deletion and nudging, without group clipboard or marker dragging.',
        targetId: targets.animationKeyEditing,
      }),
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
      step({
        id: 'mode',
        title: 'Choose how poses are sampled',
        description:
          'Clip settings → Mode selects **Smooth** for continuous motion or **Stepped** for frame-sampled poses. **FPS** controls the stepped sampling rate. These settings edit the clip, while authored key times stay unchanged.',
        targetId: targets.animationSettings,
      }),
      step({
        id: 'linear',
        title: 'Understand Clip interpolation',
        description:
          'Clip **interpolation** offers Default (**Linear**) and Linear. They evaluate identically. **Graph Editor** can override an individual property segment with Linear, Stepped or Bézier curves. Auto in Graph Editor inherits the clip default. Stepped playback controls sampling independently.',
        targetId: targets.animationSettings,
      }),
      step({
        id: 'inspect',
        title: 'Inspect an outgoing segment',
        description:
          'Select a bone **property key**, then open Key details. Selected key **interpolation** is read-only. It shows the inherited default or directs you to **Graph Editor** for property curve overrides. A final key has no outgoing segment; choose a key with another key after it on that property to inspect the segment.',
        targetId: targets.animationInterpolation,
      }),
      step({
        id: 'compare',
        title: 'Review the motion',
        description:
          'After exiting, play or scrub to compare **Smooth** and **Stepped**. Use **Undo** to restore a setting you changed. Reading this guide does not change Mode, FPS or interpolation.',
        targetId: targets.animationPlayback,
      }),
    ],
  },
  {
    id: 'animation-graph-editor',
    title: 'Graph Editor',
    description: 'Inspect bone and IK curves, edit Bézier tangents and refine key timing and values.',
    editor: 'animation',
    category: 'animation',
    prerequisites: animation,
    steps: [
      step({
        id: 'open',
        title: 'Switch between Timeline and Graph Editor',
        description:
          '**Graph Editor** beside Timeline opens a visual property curve. The button returns to Timeline when the graph is open. Both views share the animation, **playhead**, track and key selection, inspectors and **Undo/Redo**. This tour reveals controls without selecting a bone, creating keys or changing curves.',
        targetId: targets.animationGraphToggle,
      }),
      step({
        id: 'property',
        title: 'Choose a supported property',
        description:
          'After exiting the tour, select a bone in **Bones** or the preview, or an IK constraint in Timeline. Property offers bone Translation X/Y, Rotation and **Scale** X/Y, or **IK target** X/Y and IK influence. Without a selection, the graph explains what to select. For an empty property, use the existing inspector diamond buttons to set two keys at different times.',
        targetId: targets.animationGraphProperty,
      }),
      step({
        id: 'curve',
        title: 'Read the evaluated curve',
        description:
          'Points are authored keys; the blue curve uses the same evaluator and **Smooth**/**Stepped** sampling as playback. Time increases rightward in seconds, values upward. Rotation displays continuous shortest-path degrees while files retain radians. The **playhead** follows the shared current time. Click a point to select its key; click or drag empty plot space to scrub.',
        targetId: targets.animationGraphCanvas,
      }),
      step({
        id: 'interpolation',
        title: 'Shape one outgoing segment',
        description:
          'Select a point with a following key on the same property. Interpolation edits only that **outgoing segment**: Auto inherits the clip’s linear default, **Linear** changes at a steady rate, **Stepped** holds until the next key, and Bézier enables tangents. The final key has no outgoing segment. These controls stay disabled until an applicable key is selected; the tour does not create one.',
        targetId: targets.animationGraphInterpolation,
      }),
      step({
        id: 'tangents',
        title: 'Drag or enter Bézier tangents',
        description:
          'After choosing **Bézier**, drag the white tangent points in the graph for live pose feedback. **Tangent precision** enters normalized segment time and progress from 0 to 1. Outgoing time cannot exceed incoming time; pointer movement clamps to valid bounds and invalid numeric controls are rejected. **Reset handles** restores horizontal endpoint tangents at one third and two thirds of the segment. Release commits one Undo operation; Escape cancels the drag.',
        targetId: targets.animationGraphTangents,
      }),
      step({
        id: 'keys',
        title: 'Refine key time and value',
        description:
          'Drag a key or enter Key time (s) and Value, then Apply key. Movement stays between neighboring keys and inside the clip; collisions are rejected instead of merging or reordering keys. **Snap** and Frames use the timeline’s authored **FPS**; Shift bypasses frame snapping. With graph focus, Left/Right moves one frame, Shift moves ten, and **Delete** removes the shared selected keys. Typing fields keep native shortcuts.',
        targetId: targets.animationGraphKeys,
      }),
      step({
        id: 'review',
        title: 'Navigate, preview and keep the curve',
        description:
          'Wheel zooms around the pointer; middle drag pans. Fit graph or F restores the complete range, and the +/− buttons zoom around the center. Navigation never changes authored keys. After exiting, play or scrub to compare the curve with the live pose, use normal **Undo/Redo**, and **Download JSON** or a character ZIP to preserve committed curves. Timeline immediately reflects graph edits.',
        targetId: targets.animationGraphNavigation,
      }),
    ],
  },
  {
    id: 'animation-bezier-handles',
    title: 'Editing Bézier Handles',
    description: 'Shape an outgoing segment with bounded tangents and precise normalized controls.',
    editor: 'animation',
    category: 'animation',
    prerequisites: animation,
    steps: [
      step({
        id: 'select',
        title: 'Choose a keyed property',
        description:
          'After this tour, select a bone or IK property and a key with a following key. **Graph Editor** shares the timeline selection. Empty properties need two keys, authored through the inspector diamonds at different times.',
        targetId: targets.animationGraphProperty,
      }),
      step({
        id: 'mode',
        title: 'Enable Bézier',
        description:
          'Choose **Bézier** in Interpolation for the selected **outgoing segment**. Auto inherits **Linear**; Stepped holds the starting value. The last key has no outgoing segment, so these controls remain disabled there. This tour never changes interpolation.',
        targetId: targets.animationGraphInterpolation,
      }),
      step({
        id: 'drag',
        title: 'Shape the transition',
        description:
          'Drag the two white **tangent points**. Their horizontal positions set progress through segment time, and vertical positions set progress between values. Handles stay inside **0 to 1** and cannot cross in time. Rotation is displayed in degrees while animation files keep radians.',
        targetId: targets.animationGraphCanvas,
      }),
      step({
        id: 'precision',
        title: 'Enter exact handles',
        description:
          'Open **Tangent precision**. Outgoing time/progress and Incoming time/progress use normalized values from 0 to 1. **Apply handles** validates all four values together. **Reset handles** restores horizontal endpoint tangents; it is an authored edit.',
        targetId: targets.animationGraphTangents,
      }),
      step({
        id: 'review',
        title: 'Preview and keep one edit',
        description:
          'During a **tangent drag** the canvas previews the proposed curve. Release commits one **Undo** step; **Escape** cancels. Play or scrub after editing, then use the normal Undo/Redo controls. Download JSON or a character ZIP preserves committed curves.',
        targetId: targets.animationGraphNavigation,
      }),
    ],
  },
  {
    id: 'animation-motion-diagnostics',
    title: 'Running Motion Diagnostics',
    description: 'Inspect possible motion issues without automatically changing the animation.',
    editor: 'animation',
    category: 'animation',
    prerequisites: animation,
    steps: [
      step({
        id: 'run',
        title: 'Analyze the selected animation',
        description:
          'Tools → **Motion Diagnostics** → **Run diagnostics** examines the selected committed animation. Commit or cancel temporary fields and drags first. Analysis is manual; playback does not rerun it. Reading this tour does not run diagnostics.',
        targetId: targets.animationMotionRun,
      }),
      step({
        id: 'options',
        title: 'Set useful thresholds',
        description:
          '**Heuristics and tolerances** controls large/rapid rotation, translation and sudden speed changes, plus cleanup tolerances. Rotation uses **radians**; positions use **rig units**. Changing options clears the old report. Fast attacks and stepped motion may be intentional.',
        targetId: targets.animationMotionOptions,
      }),
      step({
        id: 'findings',
        title: 'Inspect the actual keys',
        description:
          '**Possible issues** describes heuristic findings. **Inspect** selects the corresponding real timeline key and moves the **playhead**. The tools share the same authored data and runtime sampler. No findings does not prove that the motion looks good.',
        targetId: targets.animationMotionResults,
      }),
      step({
        id: 'candidates',
        title: 'Review safe cleanup separately',
        description:
          '**Potentially redundant property keys** has selectable candidates. Endpoints, event-time keys, nonlinear or stepped channels, **IK targets**, IK chains and ancestors, and baked rotations are protected. No candidates is a valid result. Use **Previewing and Applying Cleanup** for the next step.',
        targetId: targets.animationCleanupPreview,
      }),
    ],
  },
  {
    id: 'animation-motion-cleanup',
    title: 'Previewing and Applying Cleanup',
    description: 'Compare selected redundant-key removals, then explicitly apply one reversible edit.',
    editor: 'animation',
    category: 'animation',
    prerequisites: animation,
    steps: [
      step({
        id: 'analyze',
        title: 'Start with a current report',
        description:
          '**Run diagnostics** after committing animation edits. Editing the animation, changing options or switching clips clears stale reports and proposals. The tour reveals controls without analyzing or editing your animation.',
        targetId: targets.animationMotionRun,
      }),
      step({
        id: 'select',
        title: 'Select candidate removals',
        description:
          'Review **Potentially redundant property keys** and uncheck any keys you want to keep. **Inspect** navigates to a key. Only selected candidates enter the proposal; analysis never removes anything automatically.',
        targetId: targets.animationMotionResults,
      }),
      step({
        id: 'preview',
        title: 'Build a temporary comparison',
        description:
          '**Preview Cleanup** checks the combined removals against the original using runtime **interpolation**. It is disabled until a report has selected candidates. A failed tolerance check leaves the original intact. Authored keys, events, history and local drafts stay unchanged during preview.',
        targetId: targets.animationCleanupPreview,
      }),
      step({
        id: 'compare',
        title: 'Scrub Before and After',
        description:
          '**Comparison time (s)** scrubs the temporary canvas pose. **Before** and **After** switch between the original and proposed motion without delivering events or moving the authored playhead. Review maximum local deviations and tolerances. These controls appear after you explicitly start a preview.',
        targetId: targets.animationCleanupCompare,
      }),
      step({
        id: 'apply',
        title: 'Apply deliberately or cancel',
        description:
          'Apply Cleanup revalidates the current proposal and removes the selected property keys as one normal animation **Undo/Redo** edit. Cancel preview, **Escape** or closing the panel discards the comparison. A successful edit is eligible for autosave; JSON and character/project ZIP exports preserve it.',
        targetId: targets.animationCleanupApply,
      }),
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
      step({
        id: 'enable',
        title: 'Show neighboring poses',
        description:
          'Enable **Onion Skinning** above the preview. Ghosts help compare poses around the current **playhead** without creating animation keys.',
        targetId: targets.animationOnion,
        mode: 'try-it',
        practice: {
          targetId: targets.animationOnion,
          instruction: 'Enable the highlighted **Onion Skinning** checkbox. This changes a preview preference only.',
          changesProject: false,
          completion: { capability: 'onion-enabled', message: 'Onion Skinning is enabled.' },
        },
      }),
      step({
        id: 'counts',
        title: 'Choose previous and next poses',
        description:
          'Preview options → **Onion settings** provides **Previous poses** and **Next poses**, each from 0 to 3. Set a count to zero to hide that direction. Frame spacing from 1 to 5 uses authored frames.',
        targetId: targets.animationOnionSettings,
      }),
      step({
        id: 'appearance',
        title: 'Separate the ghosts visually',
        description:
          'Adjust **Previous opacity**, **Next opacity** and the two colors in **Onion settings**. These are preview preferences. Ghosts show authored poses before IK preview, so an IK reach can differ from the ghost.',
        targetId: targets.animationOnionSettings,
      }),
      step({
        id: 'compare',
        title: 'Scrub and compare',
        description:
          '**Scrub** to compare the live pose with its neighbors. A clip with no changing bone keys may show overlapping ghosts. **Ghosts are read-only** and never appear in exported animation JSON. Mesh ghosts include each neighbor’s sampled shape corrections before IK; root travel stays at the current preview position. Bake IK to compare solved silhouettes.',
        targetId: targets.animationCanvas,
      }),
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
      step({
        id: 'save',
        title: 'Save a useful pose',
        description:
          'Tools → **Pose Library** saves the authored pose at the playhead. After exiting this tour, commit or cancel temporary edits, enter a Pose name and choose Full character or Selected bones in **Save scope**. Selected timeline keys supply multiple bone IDs; otherwise the selected bone is used. **Save Current Pose** captures FK local transforms before IK, excluding IK targets and temporary edits.',
        targetId: targets.animationPoseSave,
      }),
      step({
        id: 'browse',
        title: 'Find and select a pose',
        description:
          '**Search poses** filters the character library by name. Select a saved row to use it. **Full poses** store every bone; **partial poses** affect only stored bones and properties. Existing presets appear here too. Preview and Apply require the same character and compatible rig hierarchy, bind transforms and IK configuration; the panel explains incompatible or missing bones.',
        targetId: targets.animationPoseBrowse,
      }),
      step({
        id: 'preview',
        title: 'Preview without creating keys',
        description:
          'After exiting the tour, choose Preview to inspect the selected pose at the current animation time. It pauses playback and uses the destination animation’s normal IK once. It creates no keys, dirty state or **Undo** entry. Cancel preview, **Escape** or closing **Pose Library** restores the underlying animation. Reading this guide does not start a preview.',
        targetId: targets.animationPoseActions,
      }),
      step({
        id: 'apply',
        title: 'Apply at the playhead',
        description:
          'Select the destination animation and place its playhead before choosing **Apply Pose**. Stored FK values create or update relevant keys as one Animation **Undo/Redo** edit. **Partial poses** preserve unrelated bones and tracks. IK target values remain those of the destination animation, so final IK appearance can differ. Continue editing or mirroring the resulting keys normally.',
        targetId: targets.animationPoseApply,
      }),
      step({
        id: 'organize',
        title: 'Rename or delete deliberately',
        description:
          'Select a saved row, then choose **Rename** and Save name to change its label while retaining its ID. **Delete** asks for confirmation and removes the reusable pose without removing previously applied keys. This tour never submits a name, confirms deletion or changes the library.',
        targetId: targets.animationPoseActions,
      }),
      step({
        id: 'history',
        title: 'Use the right Undo history',
        description:
          '**Undo library edit** and **Redo library edit** restore saved-pose creation, renames and deletion. **Animation Undo/Redo** restores applied keys separately. If a later rig edit removed a referenced bone, undo that rig change before restoring the pose. Preview is view state and belongs to neither history.',
        targetId: targets.animationPoseHistory,
      }),
      step({
        id: 'keep',
        title: 'Keep the reusable library',
        description:
          '**Download character ZIP** includes saved poses and their manifest entries. Project ZIPs and local autosave include the library too; Project asset libraries show a counted Poses group. **Animation JSON** contains the resulting keys, not the reusable library. Reading the guide does not download files or create a save checkpoint.',
        targetId: targets.rigPackage,
      }),
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
      step({
        id: 'pairs',
        title: 'Configure your rig’s pairs',
        description:
          'Open Tools → **Mirror tools**, then **Configure Bone Pairs**. Add pair lets you choose actual Left and Right bone IDs. **Use inferred pairs** is optional: review them for your rig. Valid mappings are browser preferences; no particular bone names are required.',
        targetId: targets.animationMirrorPairs,
      }),
      step({
        id: 'direction',
        title: 'Choose direction and scope',
        description:
          'Choose **Left → Right**, **Right → Left** or **Swap**. **Mirror Current Pose** uses the selected source bone, or all mapped source bones when no bone is selected. The panel explains missing pairs and incompatible selections.',
        targetId: targets.animationMirrorDirection,
      }),
      step({
        id: 'preview',
        title: 'Preview before committing',
        description:
          '**Preview Mirrored Pose** shows a violet overlay that follows the playhead. **M** toggles preview with workspace focus. Preview copies authored bone poses before IK; temporary edits and **IK targets** are excluded. Closing the panel hides the preview.',
        targetId: targets.animationMirrorActions,
      }),
      step({
        id: 'commit',
        title: 'Commit only when ready',
        description:
          '**Mirror Current Pose** writes keys at the **playhead**. Mirror Selected Keys requires bone keys on the chosen source side. Destination keys can be replaced. Each commit is one **Undo** operation. Reading this tour does not enable preview or commit keys.',
        targetId: targets.animationMirrorActions,
      }),
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
      step({
        id: 'target',
        title: 'Inspect the selected constraint',
        description:
          'The selected constraint appears as **IK target**: followed by its ID. **Target X** and **Target Y** use absolute puppet-local coordinates before facing or camera projection. Influence (mix) ranges from 0 to 1.',
        targetId: targets.animationIK,
      }),
      step({
        id: 'options',
        title: 'Enable authored target dragging',
        description:
          'Preview options contains **Show IK targets** and **Drag IK targets**. Turn off **IK preview (fixed targets)** to manipulate the authored animation targets. The rig must already contain a compatible IK chain.',
        targetId: targets.animationIKOptions,
      }),
      step({
        id: 'drag',
        title: 'Position the requested target',
        description:
          'After exiting, choose a time, then drag the constraint’s **crosshair** in the preview. Releasing leaves **temporary values**; **Escape** during dragging restores the previous preview. Circles on the limb show solved contact positions, which may differ from the requested crosshair.',
        targetId: targets.animationCanvas,
      }),
      step({
        id: 'commit',
        title: 'Commit position and influence',
        description:
          '**Set Target Key** commits X and Y together at the held playhead. Individual diamonds key X, Y or **Influence** (mix) separately. Dragging alone does not save keys. **Cancel IK edits** discards temporary values.',
        targetId: targets.animationIK,
      }),
      step({
        id: 'motion',
        title: 'Repeat at another time',
        description:
          'Move the **playhead**, drag to another position and choose **Set Target Key** again. IK keys support single selection, arrow nudging, deletion and **Undo/Redo**. Group clipboard and marker dragging are unavailable. Use Play to inspect the reach.',
        targetId: targets.animationPlayback,
      }),
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
      step({
        id: 'preview-options',
        title: 'Use authored IK motion',
        description:
          'Baking is useful when a consumer needs bone tracks rather than live IK. Turn off **IK preview (fixed targets)** first. Baking samples authored IK over the **entire animation**; it does not capture a temporary crosshair drag.',
        targetId: targets.animationIKOptions,
      }),
      step({
        id: 'setup',
        title: 'Choose constraints and density',
        description:
          'Open Tools → **Bake IK**. In IK Baking, choose enabled Constraints to bake and Sampling **FPS**. The panel explains incompatible constraints. Higher sampling rates create more bone rotation keys. Output **interpolation** is Linear.',
        targetId: targets.animationBake,
      }),
      step({
        id: 'review',
        title: 'Review the proposed keys',
        description:
          'Review **Generated keys**, **Existing keys to replace** and **Constraints deactivated for this animation**. The clip retains Mode, FPS and interpolation settings. Fidelity results compare joints and endpoints at keys and between keys.',
        targetId: targets.animationBake,
      }),
      step({
        id: 'compare',
        title: 'Compare the proposed motion',
        description:
          '**Preview Bake** adds a violet proposed animation over the original. After exiting the tour, scrub to compare the motion. Closing IK Baking clears the preview. Preview does not write the proposal into the animation.',
        targetId: targets.animationBakeActions,
      }),
      step({
        id: 'commit',
        title: 'Bake deliberately',
        description:
          '**Bake IK** commits bone rotation keys and deactivates the baked constraints for this animation in one **Undo** operation. Review replacements first, then export when satisfied. This tour never previews or runs Bake IK.',
        targetId: targets.animationBakeActions,
      }),
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
      step({
        id: 'add',
        title: 'Add an event at the playhead',
        description:
          'After exiting this tour, place the **playhead** and choose **+ Event**. This creates and selects an **event marker**. Empty animations can contain events; this tour adds none.',
        targetId: targets.animationEvents,
      }),
      step({
        id: 'inspect',
        title: 'Name the event and payload',
        description:
          'Select an **event marker** to show Event in **Selection details**. Edit Name and Data (JSON; blank removes data). Time (seconds) controls timing. Commit on blur or Enter; JSON uses **Ctrl/Cmd**+Enter. Escape resets field drafts. Invalid JSON is reported without committing.',
        targetId: targets.animationProperties,
      }),
      step({
        id: 'timing',
        title: 'Adjust marker timing',
        description:
          'Drag an **event marker** to move only its time, or nudge it with timeline **arrow keys**. Same-time events remain separate. Tracks → **Event track** controls visibility. Scrubbing inspects poses without firing playback events.',
        targetId: targets.animationTracks,
      }),
      step({
        id: 'edit',
        title: 'Copy or remove an event',
        description:
          'Timeline Edit commands apply to a selected event as well as bone keys. **Copy**, paste and duplicate preserve event data. **Delete** Event in **Selection details** removes the selected event. Undo restores committed edits; export includes event times, names and payloads.',
        targetId: targets.animationKeyEditing,
      }),
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
      step({
        id: 'mode',
        title: 'Enter Rig Tweak deliberately',
        description:
          'After exiting this tour, set **Editor Mode** to **Rig Tweak**. Playback pauses at the current pose. Commit or cancel temporary animation edits first. This mode edits **shared rig data**, affecting every animation using that rig.',
        targetId: targets.animationMode,
      }),
      step({
        id: 'tools',
        title: 'Adjust rig alignment',
        description:
          '**Rig Tweak** reveals rig hierarchy, selection tools and rig **Undo/Redo** in the inspector. **Joint Editing**, Artwork Offset Editing, Sprite Origin Editing and Slot Transform Editing change rig alignment rather than animation keys. Use the Rig Editor to build or restructure the skeleton.',
        targetId: targets.animationMode,
      }),
      step({
        id: 'review',
        title: 'Review the shared result',
        description:
          'Review alignment on the preview and compare with **Undo** rig / **Redo** rig in **Rig Tweak**. Motion and IK can change when the underlying rig changes. This tour stays in the current mode and does not modify the rig.',
        targetId: targets.animationCanvas,
      }),
      step({
        id: 'return',
        title: 'Return to animation authoring',
        description:
          'Set Editor Mode back to **Animation** to edit keys and preview motion. **Download rig JSON** in Rig Tweak keeps rig edits; **Download JSON** in Animation saves the clip. Character package → Download character ZIP keeps both together.',
        targetId: targets.animationMode,
      }),
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
      step({
        id: 'validate',
        title: 'Check animation status',
        description:
          'Review the animation status for **Validation: OK** or reported issues. Export validates the committed animation. **Temporary yellow fields** are excluded: commit their diamonds or cancel them before deciding what to save.',
        targetId: targets.animationValidation,
      }),
      step({
        id: 'download',
        title: 'Download the selected clip',
        description:
          '**Download JSON** saves committed keys, IK, events and settings for the selected Animation. A successful export creates a clean session checkpoint while retaining **Undo/Redo**. It does not write a file into your project.',
        targetId: targets.animationExport,
      }),
      step({
        id: 'integration',
        title: 'Keep the complete character',
        description:
          '**Character package** → **Download character ZIP** includes working animations with rig, skins, images and manifest entries, including newly created clips. For separate JSON downloads, place the file in the character folder and reference its filename in character.json animations.',
        targetId: targets.rigPackage,
      }),
      step({
        id: 'roundtrip',
        title: 'Check a saved clip',
        description:
          '**File tools** offers **Import / Paste Animation JSON** and **Reload Current Export** for a round-trip check. Import replaces the current clip and clears Undo/Redo after any required confirmation. Keep a download first. Reading this tour never exports, imports or marks the clip clean.',
        targetId: targets.animationExport,
      }),
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
      step({
        id: 'ground',
        title: 'Enable the ground guide',
        description:
          'After exiting this tour, enable **Show ground guide** and set **Ground Y** in preview-world coordinates. Guide settings are browser preferences, independent of the clip.',
        targetId: targets.animationGroundVisible,
      }),
      step({
        id: 'show',
        title: 'Show contact markers',
        description:
          'Enable **Show foot contact markers**. They follow the final pose after IK through playback, scrubbing, root motion and facing. Positive distance is below ground; negative is above. Create missing contacts in the Rig Editor.',
        targetId: targets.animationContactsVisible,
      }),
      step({
        id: 'select',
        title: 'Select a contact and IK constraint',
        description:
          'Choose a **Foot contact marker** and confirm its existing **Foot IK constraint**. Without an applicable constraint, use manual posing. Disabled IK, unsupported chain scales or externally owned targets cannot provide a correction.',
        targetId: targets.animationContactSelection,
      }),
      step({
        id: 'preview',
        title: 'Preview the correction',
        description:
          'Choose **Align Selected Foot Contact to Ground**. A tinted pose previews the result without changing keys. Review the residual and tolerance (default 0.5 world units). Unreachable or limited results cannot be applied. Changing time, facing, clip or ground discards the proposal.',
        targetId: targets.animationContactPreview,
      }),
      step({
        id: 'commit',
        title: 'Commit and Undo',
        description:
          '**Apply IK target keys** explicitly writes X/Y at the **playhead** as one animation **Undo/Redo** edit. Existing bone keys stay intact. Cancel alignment preview discards the proposal. Rig Tweak owns rig edits separately and does not author contact animation tracks.',
        targetId: targets.animationContactApply,
      }),
    ],
  },
];
