import { GUIDE_TARGETS as T } from './anchors.js';
import type { GuideDefinition, GuidePrerequisite, GuideStep } from './types.js';

const scene: readonly GuidePrerequisite[] = [
  { capability: 'tool:scene', reason: 'Create or open a scene first.', guideId: 'scene-creating' },
];
const actor: readonly GuidePrerequisite[] = [
  ...scene,
  { capability: 'tool:scene-actor', reason: 'Add and select an Actor first.', guideId: 'scene-adding-actor' },
];
const action: readonly GuidePrerequisite[] = [
  ...actor,
  { capability: 'tool:scene-action', reason: 'Select a timeline action first.', guideId: 'scene-animation-clips' },
];
const step = (id: string, title: string, targetId: string, description: string): GuideStep => ({
  id,
  title,
  targetId,
  description,
  preparation: 'reveal-target',
});
const guide = (
  id: string,
  title: string,
  description: string,
  prerequisites: readonly GuidePrerequisite[],
  steps: readonly GuideStep[],
): GuideDefinition => ({ id, title, description, editor: 'scene', category: 'scene', prerequisites, steps });

/** Explain tours reuse the shared spotlight. Revealing panels never authors data or starts playback. */
export const sceneGuides: readonly GuideDefinition[] = [
  guide(
    'scene-backgrounds-layers',
    'Backgrounds, Layers and Parallax',
    'Import scene artwork, arrange it around Actors and preview layer parallax.',
    scene,
    [
      step(
        'import',
        'Add a background image',
        T.sceneAddBackground,
        'After exiting this tour, choose + Add Background in Scene Artwork to import a PNG or static WebP. Each image is independent scene artwork with its own placement; character rigs and attachments stay unchanged. An empty scene is enough to start.',
      ),
      step(
        'reuse',
        'Reuse project artwork',
        T.sceneProjectImage,
        '+ Add Image From Project offers imported scene images and, inside a project, character package artwork. Choose an image to create another independent element. This tour does not open a picker or import anything.',
      ),
      step(
        'placement',
        'Position and scale artwork',
        T.sceneImageTransform,
        'Select an image in Scene Artwork or Scene Layers. While stopped, drag it on the stage and use its lower-right corner to scale. Numeric Position X/Y sets its center; Apply image transform commits position and scale together. Escape cancels a drag; Undo/Redo restores completed edits. If no image is selected, this section explains how to begin. This tour keeps your current selection.',
      ),
      step(
        'layers',
        'Organize background and foreground layers',
        T.sceneLayers,
        '+ Add Layer creates an artwork layer. Set its name with Apply layer, then use each image row’s Layer menu to assign it. The hierarchy lists frontmost layers first and selects obscured elements. Put mountains behind forest artwork and trees in front of the Actors band. Each Actor remains a whole Puppet; artwork cannot split its bones or interleave individual Actors.',
      ),
      step(
        'order',
        'Control depth, visibility and locks',
        T.sceneLayerOrder,
        'Forward / Backward moves a layer; row arrows order images or Actors within their band. Visible hides artwork without deleting it. Lock protects images from canvas and inspector edits for this editor session. Removing an artwork layer moves its images into Background and keeps assets, as one Undo/Redo action. Background and Actors cannot be removed. Ground guides and selected handles remain above artwork.',
      ),
      step(
        'parallax',
        'Set layer parallax',
        T.sceneLayerParallax,
        'Each artwork layer has a Parallax field committed with Apply layer. Use 0 for fixed scrolling, 1 for normal world scrolling, a fraction for slower backgrounds, or a value above 1 for faster foregrounds. For example, try 0.2 for mountains, 0.5 for forest and 1.2 for foreground trees. The Actors band always uses 1, and authored movement paths stay unchanged.',
      ),
      step(
        'preview',
        'Preview scrolling independently of placement',
        T.sceneParallaxPreview,
        'After exiting this tour, change Preview camera X/Y to inspect parallax, including during choreography playback. Editor wheel zoom and middle/right/Alt-drag panning remain ordinary navigation. Neither navigation nor preview scroll edits image positions or creates history entries. Reset view clears preview scroll and navigation. The tour changes none of these values.',
      ),
      step(
        'save',
        'Save artwork with the scene',
        T.scenePackage,
        'Download scene JSON stores image references, layer order, visibility and parallax. Download scene package includes the image and character binaries for portable handoff; Export Project preserves them in the workspace ZIP. Editor-only locks, selection and preview camera values are not exported. Clean unused images retains assets needed by scene history.',
      ),
    ],
  ),
  guide(
    'scene-grounding-characters',
    'Grounding Characters',
    'Snap independent Actors using their evaluated bone-local contacts.',
    scene,
    [
      step(
        'ground',
        'Enable the ground reference',
        T.sceneGroundVisible,
        'After exiting this tour, enable Show ground guide and set scene Ground Y. The guide never changes placement or choreography automatically.',
      ),
      step(
        'actor',
        'Select an Actor',
        T.sceneActors,
        'Add a character if the scene is empty, then select its Actor. Stop playback before editing initial placement. Each character has its own proportions, facing and contacts.',
      ),
      step(
        'marker',
        'Select a foot marker',
        T.sceneContactMarker,
        'Choose Actor foot contact marker. The list uses that character’s rig definitions. A missing or invalid contact requires manual placement; rigs without markers can use the labeled legacy attachment sole fallback. Marker selections are temporary view state and must be chosen again after reopening a scene.',
      ),
      step(
        'snap',
        'Snap the Actor',
        T.sceneGroundAlign,
        'Snap Actor to Ground changes only initial Actor Y using the selected evaluated marker, including facing and scale. X and movement paths stay intact. Scene Undo/Redo restores the edit. Select and snap other Actors independently.',
      ),
      step(
        'preview',
        'Preview the scene',
        T.scenePlayback,
        'Play or scrub to inspect the contacts through animation and movement. Grounding sets initial placement only; it does not lock feet or compensate sliding. Stop restores placement editing. Export scene JSON or a scene package to keep the authored positions.',
      ),
    ],
  ),
  guide(
    'scene-ground-reference',
    'Aligning Actors to Ground',
    'Use a scene-world reference and explicitly align Actor feet through scene Undo/Redo.',
    scene,
    [
      step(
        'enable',
        'Enable the ground guide',
        T.sceneGroundVisible,
        'After exiting this tour, enable Show ground guide in Scene ground. It is a visual reference, not a physics floor. Showing or moving it does not change Actors, movement paths or scene history.',
      ),
      step(
        'position',
        'Adjust scene Ground Y',
        T.sceneGroundY,
        'Enter Ground Y and press Enter, or drag the amber ↕ Ground label on the stage. Values are scene-world coordinates, independent of Animation Editor preview Y. Negative coordinates are supported. Guide Undo/Redo restores preferences only.',
      ),
      step(
        'select',
        'Select an Actor',
        T.sceneActors,
        'Choose an Actor in the list. Different rigs and artwork sizes can have different origins. Stop playback before editing initial placement. This tour does not select an Actor for you.',
      ),
      step(
        'snap',
        'Align feet to ground',
        T.sceneGroundAlign,
        'Choose an Actor foot contact marker and use Snap Actor to Ground to translate initial Y while preserving X. Without rig markers, Align Feet to Ground retains the labeled legacy attachment sole fallback. Stop playback to edit. Scene Undo/Redo restores the edit. Optional Snap to Ground uses the selected contact during placement drags; hold Shift to move freely.',
      ),
      step(
        'preview',
        'Preview scene movement',
        T.scenePlayback,
        'Play and scrub to inspect movement against the fixed reference. Authored paths may leave the line; no snapping runs during playback. Stop restores initial placement. Export preserves Actor edits; guide preferences stay in this browser by scene ID. Hide or Reset Ground Y in Scene ground when finished.',
      ),
    ],
  ),
  guide(
    'scene-creating',
    'Creating a Scene',
    'Create an independent scene document with a finite timeline.',
    [],
    [
      step(
        'new',
        'Create the document',
        T.sceneNew,
        'Choose New Scene, give it a unique Scene ID and name, and set its duration in seconds. The scene begins empty; no character is required.',
      ),
      step(
        'save',
        'Keep your work',
        T.sceneExport,
        'Download each scene before leaving this page. Scenes and their Undo histories stay in memory while you switch between them. Character rigs and animation clips are authored in their own editors.',
      ),
    ],
  ),
  guide(
    'scene-adding-actor',
    'Adding an Actor',
    'Place independent instances of existing character packages in a scene.',
    scene,
    [
      step(
        'add',
        'Choose a character package',
        T.sceneAddActor,
        'Choose + Add Actor, then a workspace character or permanent character manifest JSON reference. Add the same package twice for two independent Actors.',
      ),
      step(
        'actors',
        'Select and arrange Actors',
        T.sceneActors,
        'The Actor list and timeline track labels select an Actor. Duplicate Actor creates another instance. Send backward and Bring forward set drawing order. Removing referenced Actors asks before removing their actions.',
      ),
    ],
  ),
  guide('scene-positioning', 'Positioning an Actor', 'Set the initial placement, facing, skin and animation.', actor, [
    step(
      'stage',
      'Move on the stage',
      T.sceneStage,
      'While stopped, drag an Actor or its red X and green Y handles. Escape cancels a move. Wheel zooms; middle/right/Alt-drag pans. Stop restores initial placement after a preview.',
    ),
    step(
      'properties',
      'Set initial appearance',
      T.sceneActorProperties,
      'Enter Initial X and Initial Y, then Apply actor properties. Facing, Skin and Initial animation configure this instance only. Initial animation starts at time zero and runs until a timeline animation replaces it.',
    ),
  ]),
  guide(
    'scene-animation-clips',
    'Creating Animation Clips',
    'Schedule an existing character animation without changing its keys.',
    actor,
    [
      step(
        'type',
        'Choose Play animation',
        T.sceneActionType,
        'Choose Play animation as the Action type. Only the selected Actor’s character animations are available. Author or bake new character animations in Animation Editor first.',
      ),
      step(
        'add',
        'Add at the playhead',
        T.sceneAddAction,
        'Set the playhead before the scene endpoint and choose Add action. Open Action properties on the new selected clip to choose Animation, Duration, Loop and Speed. Duration is the finite scene window; Speed affects the source clip clock.',
      ),
      step(
        'tracks',
        'Understand clip ownership',
        T.sceneTimeline,
        'Animation clips share one base animation channel per Actor and cannot overlap. Different Actors can animate together. Movement uses a separate channel, so a walk animation and a move clip may run together. Scene clips use hard cuts; authored crossfades are unsupported.',
      ),
    ],
  ),
  guide(
    'scene-movement',
    'Adding Movement',
    'Combine a move destination with an independently timed walk animation.',
    actor,
    [
      step(
        'type',
        'Choose Move to position',
        T.sceneActionType,
        'Choose Move to position, set the playhead, and Add action. In Action properties set Destination X/Y and Duration, then apply. The destination marker appears on the stage for a selected move.',
      ),
      step(
        'timing',
        'Pair movement and animation',
        T.sceneTimeline,
        'A move travels in a straight line from the Actor’s position at its scheduled start to its destination over Duration. It does not choose a walk animation or facing automatically. Add Play animation and Change facing actions as needed.',
      ),
    ],
  ),
  guide(
    'scene-timing',
    'Arranging Action Timing',
    'Edit clips, snapping and grouped Undo without changing character data.',
    action,
    [
      step(
        'properties',
        'Set exact timing',
        T.sceneActionProperties,
        'Start and Duration are in seconds. Apply action properties validates the whole proposal. Conflicting moves or animations are rejected; adjacent windows are allowed. Wait / hold reserves no Actor channel, and cues are markers.',
      ),
      step(
        'timeline',
        'Drag and resize',
        T.sceneTimeline,
        'Drag a clip to move it; drag its right edge to resize it. Snap uses frame positions, clip edges and the playhead; Alt bypasses snapping. Escape or a canceled drag restores the previous timing. Each finished drag is one Undo step.',
      ),
      step(
        'zoom',
        'Inspect a long timeline',
        T.sceneZoom,
        'Increase Zoom to inspect short intervals. Scroll the tracks horizontally to pan. The timeline and inspector dividers resize the desktop workspace without modifying the scene.',
      ),
      step(
        'history',
        'Undo and Redo',
        T.sceneHistory,
        'Undo and Redo restore validated scene snapshots, including timing and destinations. Playback resets to the authored start after an edit; previewing and scrubbing create no history entries.',
      ),
    ],
  ),
  guide('scene-previewing', 'Previewing a Scene', 'Play, pause and seek isolated runtime Actors.', scene, [
    step(
      'play',
      'Use the shared scene clock',
      T.scenePlayback,
      'Play runs all Actors together. Pause freezes the clock, Restart begins at zero, and Stop restores initial placement for editing. Speed changes the whole scene clock. Playback waits for referenced character artwork.',
    ),
    step(
      'seek',
      'Scrub in either direction',
      T.sceneTime,
      'Set Playhead (s) or drag the ruler. Seeking pauses and reconstructs Actors from initial data, so reaching the same time produces the same supported pose. It suppresses gameplay animation events and scene cues. Resume delivers only future events.',
    ),
  ]),
  guide(
    'scene-exporting',
    'Exporting a Scene',
    'Validate dependencies and choose JSON references or a portable scene ZIP.',
    scene,
    [
      step(
        'json',
        'Validate and download JSON',
        T.sceneExport,
        'Validate Scene checks character, animation and skin references. Download scene JSON saves the scene document with permanent character manifest references. Open scene JSON or Paste scene JSON reloads it after checking dependencies. Relative editor imports resolve from this page.',
      ),
      step(
        'package',
        'Package for the runtime',
        T.scenePackage,
        'Download scene package includes scene.json, referenced character files and scene artwork, retaining layer order and parallax. SceneLoader.loadPackage loads the exported ZIP at runtime. The editor imports scene JSON with its image references; Export Project includes artwork in the workspace ZIP.',
      ),
    ],
  ),
];
