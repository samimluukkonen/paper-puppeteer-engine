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
const workflowGuides: readonly GuideDefinition[] = [
  guide(
    'scene-audio-timeline',
    'Visual Audio Timeline',
    'Arrange audio clips, trim source media and save volume, loops and fades with the scene.',
    scene,
    [
      step(
        'asset',
        'Choose imported audio',
        T.sceneAudioAsset,
        'Import WAV, MP3 or OGG audio in Project Workspace, then open its Scene Editor. **Audio asset** lists that project’s audio library; standalone scenes list their imported audio references. If the list is empty, import audio in Project Workspace after exiting this tour. An empty scene is enough to explore every step; Actors and selected clips are optional. The tour only reveals controls and never imports, selects or plays audio.',
      ),
      step(
        'tracks',
        'Organize audio tracks',
        T.sceneAudioAddTrack,
        'Choose **Track category**, then **Add audio track**. **Music**, Ambience, Sound Effects and Voice are organizational labels: any track can contain any audio asset. Add multiple tracks of the same category when useful. Choose Audio track before adding a clip, or change Clip track in the selected clip’s inspector. The tour does not create tracks.',
      ),
      step(
        'add',
        'Place a clip at the playhead',
        T.sceneAudioAddClip,
        'After exiting, set **Playhead (s)**, choose **Audio asset** and **Audio track**, then **Add Audio Clip**. A new clip starts at the playhead and uses decoded media duration, limited to remaining scene time; unknown media duration starts at one second. At scene end, move the playhead earlier. Clips always have finite bounds; adding or editing audio never silently extends the scene.',
      ),
      step(
        'arrange',
        'Arrange and overlap clips',
        T.sceneAudioTracks,
        'Click an audio clip to select it. **Drag its body** to move its scene start without changing the source offset. Snapping shares frames, playhead, Actor clip edges, camera keys, transitions and other audio edges; hold **Alt** to bypass it. **Overlapping clips** are allowed, including within one track, and appear on separate visible lanes. Empty audio rows are ready for your first track and clip after the tour.',
      ),
      step(
        'trim',
        'Trim without changing the source file',
        T.sceneAudioTiming,
        'Select a clip and open Audio clip to edit **Start**, **Duration** and **Source offset** in seconds, then **Apply audio clip properties**. Drag the left edge to advance source offset and start while keeping scene end fixed; drag the right edge to change duration. Media duration is the decoded file length, separate from clip duration and scene playhead time. Non-looping clips cannot read past media end. With no clip selected, this section explains how to begin; the tour never selects one.',
      ),
      step(
        'playback',
        'Set volume and bounded looping',
        T.sceneAudioPlayback,
        '**Volume** ranges from 0 to 100%; zero is valid. **Loop** repeats the source window from **Source offset** through media end, stopping at the finite clip end. Left trimming a loop changes its repeated source window; right trimming can extend it beyond media length within scene duration. Apply audio clip properties commits the edit. These are saved playback properties: synchronized audio playback and seeking arrive in v1.3.3. Use Project Workspace’s explicit audition separately.',
      ),
      step(
        'fades',
        'Author clip fades',
        T.sceneAudioFades,
        '**Fade in** and **Fade out** are durations in seconds at the clip’s scene edges; omitted values mean zero. Each fade must fit within clip duration. They describe linear gain ramps, and overlapping ramps multiply. **Apply audio clip properties** commits fades with the other properties. Audio fades are distinct from the scene’s full-frame color transitions. Waveform previews and synchronized fade playback are deferred.',
      ),
      step(
        'history',
        'Duplicate, delete and undo',
        T.sceneAudioActions,
        '**Duplicate audio clip** creates a new stable ID at the same time, preserving its asset, track, trim, volume, loop and fades; move the copy or choose another track afterward. **Delete audio clip** or **Delete**/Backspace removes the selection. Scene Undo/Redo restores edits. A completed drag is one history entry; Escape, blur, capture loss or a selection change cancels an unfinished gesture. The source audio file stays unchanged.',
      ),
      step(
        'save',
        'Save timing and audio together',
        T.scenePackage,
        '**Download scene JSON** preserves audio tracks, asset references, timing, source offsets, volume, loops and fades. **Download scene package** includes referenced audio binaries for portable handoff; **Export Project** and local recovery retain them too. Project dependency checks block removing audio used by a scene. Keep relative assets with JSON or download a ZIP. This tour preserves the scene, selection, playback, preview and Undo/Redo.',
      ),
    ],
  ),
  guide(
    'scene-root-motion',
    'Using Root Motion',
    'Choose animation-owned travel, resolve movement conflicts and retain the final Actor position.',
    action,
    [
      step(
        'clip',
        'Select an animation clip',
        T.sceneTimeline,
        'After exiting this tour, select an animation action on the **Actor timeline**. If a move, wait, face or cue is selected, select or add an animation action first. Author and save root **Position X/Y** keys in **Animation Editor** before choosing the clip here. This tour preserves selection, playback and authored data.',
      ),
      step(
        'source',
        'Choose the movement source',
        T.sceneActionProperties,
        'Open **Action properties · animation**. Set **Movement source** to **Animation root motion**, then Apply action properties. Scene-controlled is the default and ignores root translation. The root option is disabled for clips without root keys. The read-only Root displacement reports animation-local X/Y over the window; facing and scale at clip start transform it once.',
      ),
      step(
        'preview',
        'Preview the travel',
        T.scenePlayback,
        'After exiting, use **Play** and **Pause**, or **Playhead (s)** to scrub forward and backward. Duration bounds travel; non-looping clips hold their endpoint and Loop within duration accumulates complete cycles. Seeking reconstructs from initial Actor placement, so returning to the same time gives the same position. The tour never starts playback or seeks.',
      ),
      step(
        'conflicts',
        'Resolve competing translation owners',
        T.sceneActionProperties,
        'An **Animation root motion** clip owns translation throughout its full action window, including an endpoint hold. Overlapping move actions or another root clip on that Actor are rejected without changing either action. Shorten or move an action, or choose **Scene-controlled** when scene movement should own travel. Adjacent actions and independent Actors are allowed.',
      ),
      step(
        'finish',
        'Confirm and preserve the final position',
        T.sceneStage,
        'After playback passes the clip end, open **Runtime preview** to inspect **Position**. A +80 step from X=100 ends at X=180 at right-facing scale 1; a following idle holds it. Cancel retains applied travel; **Stop** restores authored placement. Download scene JSON preserves Movement source; Download scene package also includes character root keys for standalone runtime playback.',
      ),
    ],
  ),
  guide(
    'scene-cuts-fades',
    'Cinematic Cuts, Fades & Transitions',
    'Cut between camera shots and author color fades with deterministic seeking on the scene timeline.',
    scene,
    [
      step(
        'cut',
        'Create an instant shot cut',
        T.sceneCameraCut,
        'After exiting this tour, set **Playhead (s)** to the desired cut time and choose **Set Camera Cut**. The command captures X, Y and **Zoom** keys and makes the preceding keys Stepped, holding the old shot until the exact cut boundary. If needed, it adds a time-zero baseline to preserve the opening frame. All channels enter one scene Undo step. Actors are optional; the tour never creates or selects a cut.',
      ),
      step(
        'shot',
        'Frame the new shot',
        T.sceneCameraKeyValues,
        'Set Camera Cut enables **Camera Key Edit** mode. At the cut time, change **Center X/Y** and **Camera zoom**, then **Apply camera key** to create the close-up. The previous shot holds until this time; seeking to the exact boundary shows the new frame. Camera channels keep their existing owner and independent controls. The tour leaves key editing mode, values and selection unchanged.',
      ),
      step(
        'add',
        'Add a fade at the playhead',
        T.sceneAddTransition,
        'Choose **Effect type** → **Fade in** or **Fade out**, then Add effect. Fade in reveals the scene from black or a color; Fade out covers it. New effects start at the playhead, use black and last up to one second of remaining scene time. For an opening fade, use time 0. No Actor is required. If the playhead is at the scene end, move it earlier before adding a fade.',
      ),
      step(
        'timing',
        'Set fade start and duration',
        T.sceneTransitionTiming,
        'Select a fade on the **Transitions** track, then open **Transition properties**. Edit **Fade start (seconds)** and Fade duration (seconds), and choose Apply transition properties. Duration must be positive and the effect must end within scene duration. Authored times use milliseconds on the same clock as Actors and camera keys. With no fade selected, this section explains how to begin; the tour does not select one for you.',
      ),
      step(
        'appearance',
        'Choose fade direction and color',
        T.sceneTransitionAppearance,
        '**Fade type** chooses **Fade in** from color or **Fade out** to color. Fade color uses a six-digit #rrggbb value; black is the default. Apply transition properties commits direction, color and timing together. Fade in changes opacity from 1 to 0; Fade out changes it from 0 to 1. This is a full output-frame overlay above backgrounds, Actors and foreground artwork, below editor guides. React controls stay available.',
      ),
      step(
        'track',
        'Select fades and cut markers',
        T.sceneTransitions,
        'The upper **Transitions** row shows fade intervals; click a clip to select it and pause playback. Cut diamonds appear below: click one to seek to its time and select a camera channel key. Edit camera timing in **Selected camera key** or drag its channel diamond. Fade edges participate in ruler snapping. Empty rows are ready for your first cut or fade after the tour.',
      ),
      step(
        'holds',
        'Hold a color and resolve conflicts',
        T.sceneTransitionProperties,
        'A completed fade holds its **final opacity** until the next fade. For a fade-out, color hold and fade-in, leave a gap between two effects using the same color. Fade intervals **cannot overlap**; move or shorten an effect if validation reports a conflict. Adjacent fades are allowed and the later fade owns their shared boundary. **Delete transition** or Delete/Backspace removes the selected effect; scene Undo/Redo restores edits. These transitions stay within one scene.',
      ),
      step(
        'preview',
        'Preview and seek through transitions',
        T.sceneCameraPreview,
        'After exiting this tour, choose **Preview Through Camera** and **Play**. **Pause** inside a fade, scrub forward and backward, and return to the same time: color, opacity and framing must match. Scrub just before and exactly at a cut to see the immediate shot change. Actors and animations continue beneath fades. Seeking samples authored data without replaying a fade or dispatching external cues. The tour never changes playback, preview mode or overlays.',
      ),
      step(
        'save',
        'Save shots and fades together',
        T.scenePackage,
        '**Download scene JSON** preserves stepped camera keys and fade IDs, times, durations, types and colors; keep its referenced assets with it. **Download scene package** includes the character and artwork files for portable handoff. Project export and local recovery retain transitions too. Standalone SceneLoader playback evaluates fades on the runner clock and cleans up its overlay on disposal. Editor selection, playhead and preview settings are not exported.',
      ),
    ],
  ),
  guide(
    'scene-camera-keyframes',
    'Camera Timeline & Keyframes',
    'Animate camera pans and zooms with timeline keys, outgoing curves and deterministic scene playback.',
    scene,
    [
      step(
        'capture',
        'Capture the first shot',
        T.sceneCameraSetKey,
        'After exiting this tour, set the **playhead** to 0 seconds and choose **Set Camera Key**. It captures the evaluated camera center and zoom on all three Camera rows and enables **Camera Key Edit** mode. You can begin in an empty scene; Actors are optional. This tour only reveals controls and never creates or selects keys.',
      ),
      step(
        'mode',
        'Choose explicit camera key editing',
        T.sceneCameraKeyMode,
        '**Camera Key Edit** mode makes **Apply camera key**, **Reset Camera**, Frame Selected Actor and frame dragging author keys at the playhead. With the mode off, numeric controls edit initial settings. Wheel zoom and middle/right/Alt-drag always navigate the editor without creating keys; animated frames require Key Edit mode to drag. The tour leaves your mode unchanged.',
      ),
      step(
        'time',
        'Choose a later shot time',
        T.sceneTime,
        'Set **Playhead (s)** to 3, or scrub the ruler, to place the next shot. Seeking pauses playback. The UI displays seconds; camera keys, Actors and parallax share the same millisecond scene clock. Keyed channels hold their first and last values outside their key range; channels without keys use the initial camera settings.',
      ),
      step(
        'values',
        'Pan and zoom into the next shot',
        T.sceneCameraKeyValues,
        'With **Camera Key Edit** mode enabled, change **Center X/Y** and **Camera zoom**, then choose Apply camera key. Centers use scene pixels; zoom ranges from 0.1 to 8. For example, pan toward an Actor at 3 seconds and add a closer zoom at 5 seconds. Frame Selected Actor can capture one explicit shot when an Actor is selected; it never enables continuous tracking.',
      ),
      step(
        'tracks',
        'Select and move camera diamonds',
        T.sceneCameraTracks,
        'Camera has independent X, Y and **Zoom** rows below the Actor tracks. Click a diamond to select it and pause playback; drag it to move its time. **Snap** uses the frame grid, other camera keys, Actor clip edges and **playhead**; Alt bypasses snapping. Escape, blur or capture loss cancels a drag. Each completed drag is one scene Undo step. If the rows are empty, capture the first shot after exiting the tour.',
      ),
      step(
        'properties',
        'Inspect, duplicate and delete a key',
        T.sceneCameraKeyProperties,
        'Open **Cinematic Camera** → **Selected camera key** to edit a selected diamond’s exact time and value, then **Apply selected camera key**. Duplicate camera key copies its outgoing curve to an explicit time; Delete camera key or Delete/Backspace removes the selected diamond. Same-channel time collisions are rejected. Scene Undo/Redo restores these edits while retaining the Actor clock. Without a selected key this section explains how to begin; the tour never selects one for you.',
      ),
      step(
        'curves',
        'Shape the outgoing camera motion',
        T.sceneCameraKeyCurves,
        'Choose **Linear**, **Stepped**, **Smooth** / eased preset or Bézier for the selected key’s outgoing segment. Stepped holds until the next key. Smooth uses a Bézier ease preset; Bézier exposes four normalized handle coordinates above this menu. Keep each coordinate in [0, 1] and the first X no greater than the second X. Apply selected camera key commits handle edits. Bounded curves keep zoom between its endpoint values; evaluated zoom is also clamped to [0.1, 8]. Select a diamond after the tour if no curve controls are shown.',
      ),
      step(
        'preview',
        'Preview and repeat a seek',
        T.sceneCameraPreview,
        'After exiting this tour, choose **Preview Through Camera**, then **Play**. Camera motion, Actors and background parallax advance together. **Pause**, Restart or scrub repeatedly between 2 and 5 seconds: returning to an identical time produces identical framing. Stop returns the scene clock to zero. Exit Camera Preview restores editor navigation. The tour never changes the clock, preview mode or overlays.',
      ),
      step(
        'save',
        'Save camera keys and curves',
        T.scenePackage,
        '**Download scene JSON** preserves **Camera X/Y/Zoom** keys and their outgoing curves; keep its referenced assets with it. **Download scene package** includes the referenced character and artwork files for portable handoff. Export Project and local recovery retain the camera tracks too. At runtime, LoadedScene.applyCamera opts the host camera into the runner clock and parallax. Static and legacy scenes remain supported; editor navigation and Key Edit mode are not exported.',
      ),
    ],
  ),
  guide(
    'scene-cinematic-camera',
    'Cinematic Camera',
    'Author audience framing, frame an Actor and preview through the camera independently of editor navigation.',
    scene,
    [
      step(
        'select',
        'Select the cinematic camera',
        T.sceneCameraSelect,
        'After exiting this tour, choose **Select Cinematic Camera** in the **Cinematic Camera** inspector. The camera defines the audience frame independently of Actors. Its selection keeps the last selected Actor available for framing. This tour only reveals controls; it does not select, move or reset anything.',
      ),
      step(
        'frame',
        'Position the audience frame',
        T.sceneStage,
        'The blue rectangle is the 1000 × 700 **output frame**, with a 10:7 aspect ratio and a center cross. Outside camera preview, drag a frame edge to select and move the camera, or drag its center after selecting it. A completed drag is one scene **Undo** step; **Escape** cancels it without moving Actors.',
      ),
      step(
        'center',
        'Set the camera center',
        T.sceneCameraCenter,
        '**Center X** and **Center Y** use scene pixels: X increases rightward and Y downward. They describe the middle of the audience frame, not a scroll offset. Enter both values and use **Apply camera** to commit. Scenes without saved camera settings start at center (0, 0) and zoom 1.',
      ),
      step(
        'zoom',
        'Adjust zoom and reset framing',
        T.sceneCameraZoom,
        '**Camera zoom** ranges from 0.1 to 8. At zoom 1, the frame covers 1000 × 700 scene pixels; at zoom 2, it covers 500 × 350. **Apply camera** commits the values. **Reset Camera** restores center (0, 0) and zoom 1 as an undoable camera edit. Actor transforms and animation keys stay unchanged.',
      ),
      step(
        'actor',
        'Frame a selected Actor',
        T.sceneCameraFrameActor,
        'Select an Actor in **Scene Layers**, the **Actor list** or its timeline track, then choose **Frame Selected Actor**. The camera fits the current rendered bounds with 20% breathing room and bounded zoom. If reliable bounds are unavailable, it centers on the initial Actor origin and keeps zoom. With no Actor selected the button is disabled; you can still author the camera in an empty scene. The tour preserves your selection.',
      ),
      step(
        'preview',
        'Preview through the camera',
        T.sceneCameraPreview,
        'After exiting this tour, choose **Preview Through Camera** to see audience framing with backgrounds, parallax, Actors and foreground layers. Playback and scrubbing remain available. Editor overlays start hidden; enable **Editor overlays during preview** to show ground and selection controls. **Exit Camera Preview** restores the saved editor view. This tour never switches preview modes or starts playback.',
      ),
      step(
        'navigation',
        'Keep editor navigation independent',
        T.sceneCameraNavigation,
        'Outside camera preview, **wheel zoom** and middle/right/**Alt-drag** pan navigate the editor without changing the authored camera. **Reset view** restores navigation and clears the temporary Preview camera X/Y parallax inspection offset; it does not reset cinematic framing. These navigation controls are disabled during audience preview. Preview camera X/Y is view-only and excluded from audience framing and saved camera settings.',
      ),
      step(
        'save',
        'Save the camera with the scene',
        T.scenePackage,
        '**Download scene JSON** stores initial camera settings and **Camera X/Y/Zoom** timeline keys, including outgoing curves. Scene packages, **Export Project** and local recovery retain them too. Set Camera Key captures the playhead camera; Camera Key Edit mode makes Apply camera key, framing and frame dragging author explicit keys. Navigation, selection, preview mode and overlays are excluded. At runtime, LoadedScene.applyCamera opts into the runner clock and parallax; reapply it after resizing.',
      ),
    ],
  ),
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
        'After exiting this tour, choose **+ Add Background** in **Scene Artwork** to import a PNG or static WebP. Each image is independent scene artwork with its own placement; character rigs and attachments stay unchanged. An empty scene is enough to start.',
      ),
      step(
        'reuse',
        'Reuse project artwork',
        T.sceneProjectImage,
        '**+ Add Image From Project** offers imported scene images and, inside a project, character package artwork. Choose an image to create another independent element. This tour does not open a picker or import anything.',
      ),
      step(
        'placement',
        'Position and scale artwork',
        T.sceneImageTransform,
        'Select an image in **Scene Artwork** or **Scene Layers**. While stopped, drag it on the stage and use its lower-right corner to scale. Numeric **Position X/Y** sets its center; Apply image transform commits position and scale together. Escape cancels a drag; Undo/Redo restores completed edits. If no image is selected, this section explains how to begin. This tour keeps your current selection.',
      ),
      step(
        'layers',
        'Organize background and foreground layers',
        T.sceneLayers,
        '**+ Add Layer** creates an artwork layer. Set its name with **Apply layer**, then use each image row’s **Layer** menu to assign it. The hierarchy lists frontmost layers first and selects obscured elements. Put mountains behind forest artwork and trees in front of the Actors band. Each Actor remains a whole Puppet; artwork cannot split its bones or interleave individual Actors.',
      ),
      step(
        'order',
        'Control depth, visibility and locks',
        T.sceneLayerOrder,
        '**Forward / Backward** moves a layer; row arrows order images or Actors within their band. **Visible** hides artwork without deleting it. **Lock** protects images from canvas and inspector edits for this editor session. Removing an artwork layer moves its images into Background and keeps assets, as one Undo/Redo action. Background and Actors cannot be removed. Ground guides and selected handles remain above artwork.',
      ),
      step(
        'parallax',
        'Set layer parallax',
        T.sceneLayerParallax,
        'Each artwork layer has a **Parallax** field committed with **Apply layer**. Use 0 for fixed scrolling, 1 for normal world scrolling, a fraction for slower backgrounds, or a value above 1 for faster foregrounds. For example, try 0.2 for mountains, 0.5 for forest and 1.2 for foreground trees. The Actors band always uses 1, and authored movement paths stay unchanged.',
      ),
      step(
        'preview',
        'Preview scrolling independently of placement',
        T.sceneParallaxPreview,
        'After exiting this tour, change **Preview camera X/Y** to inspect parallax, including during choreography playback. Editor wheel zoom and middle/right/**Alt**-drag panning remain ordinary navigation. Neither navigation nor preview scroll edits image positions or creates history entries. **Reset view** clears preview scroll and navigation. The tour changes none of these values.',
      ),
      step(
        'save',
        'Save artwork with the scene',
        T.scenePackage,
        '**Download scene JSON** stores image references, layer order, visibility and parallax. **Download scene package** includes the image and character binaries for portable handoff; **Export Project** preserves them in the workspace ZIP. Editor-only locks, selection and preview camera values are not exported. Clean unused images retains assets needed by scene history.',
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
        'After exiting this tour, enable **Show ground guide** and set scene **Ground Y**. The guide never changes placement or choreography automatically.',
      ),
      step(
        'actor',
        'Select an Actor',
        T.sceneActors,
        'Add a character if the scene is empty, then select its Actor. **Stop** playback before editing **initial placement**. Each character has its own proportions, facing and contacts.',
      ),
      step(
        'marker',
        'Select a foot marker',
        T.sceneContactMarker,
        'Choose **Actor foot contact marker**. The list uses that character’s rig definitions. A missing or invalid contact requires manual placement; rigs without markers can use the labeled **legacy attachment sole fallback**. Marker selections are temporary view state and must be chosen again after reopening a scene.',
      ),
      step(
        'snap',
        'Snap the Actor',
        T.sceneGroundAlign,
        '**Snap Actor to Ground** changes only initial Actor Y using the selected evaluated marker, including facing and scale. X and movement paths stay intact. Scene **Undo/Redo** restores the edit. Select and snap other Actors independently.',
      ),
      step(
        'preview',
        'Preview the scene',
        T.scenePlayback,
        '**Play** or scrub to inspect the contacts through animation and movement. Grounding sets **initial placement** only; it does not lock feet or compensate sliding. **Stop** restores placement editing. Export scene JSON or a scene package to keep the authored positions.',
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
        'After exiting this tour, enable **Show ground guide** in **Scene ground**. It is a visual reference, not a physics floor. Showing or moving it does not change Actors, movement paths or scene history.',
      ),
      step(
        'position',
        'Adjust scene Ground Y',
        T.sceneGroundY,
        'Enter **Ground Y** and press Enter, or drag the amber ↕ Ground label on the stage. Values are **scene-world coordinates**, independent of Animation Editor preview Y. Negative coordinates are supported. Guide **Undo/Redo** restores preferences only.',
      ),
      step(
        'select',
        'Select an Actor',
        T.sceneActors,
        'Choose an Actor in the list. Different rigs and artwork sizes can have different origins. **Stop** playback before editing **initial placement**. This tour does not select an Actor for you.',
      ),
      step(
        'snap',
        'Align feet to ground',
        T.sceneGroundAlign,
        'Choose an **Actor foot contact marker** and use **Snap Actor to Ground** to translate initial Y while preserving X. Without rig markers, **Align Feet to Ground** retains the labeled legacy attachment sole fallback. Stop playback to edit. Scene Undo/Redo restores the edit. Optional Snap to Ground uses the selected contact during placement drags; hold Shift to move freely.',
      ),
      step(
        'preview',
        'Preview scene movement',
        T.scenePlayback,
        '**Play** and scrub to inspect movement against the fixed reference. Authored paths may leave the line; no snapping runs during playback. **Stop** restores **initial placement**. Export preserves Actor edits; guide preferences stay in this browser by scene ID. Hide or Reset Ground Y in Scene ground when finished.',
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
        'Choose **New Scene**, give it a unique **Scene ID** and name, and set its duration in seconds. The scene begins empty; no character is required.',
      ),
      step(
        'save',
        'Keep your work',
        T.sceneExport,
        '**Download each scene** before leaving this page. Scenes and their **Undo histories** stay in memory while you switch between them. Character rigs and animation clips are authored in their own editors.',
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
        'Choose **+ Add Actor**, then a workspace character or permanent character manifest JSON reference. Add the same package twice for two independent Actors.',
      ),
      step(
        'actors',
        'Select and arrange Actors',
        T.sceneActors,
        'The **Actor list** and timeline track labels select an Actor. **Duplicate Actor** creates another instance. **Send backward** and Bring forward set drawing order. Removing referenced Actors asks before removing their actions.',
      ),
    ],
  ),
  guide('scene-positioning', 'Positioning an Actor', 'Set the initial placement, facing, skin and animation.', actor, [
    step(
      'stage',
      'Move on the stage',
      T.sceneStage,
      'While stopped, drag an Actor or its red X and green Y handles. **Escape** cancels a move. Wheel zooms; middle/right/**Alt**-drag pans. **Stop** restores initial placement after a preview.',
    ),
    step(
      'properties',
      'Set initial appearance',
      T.sceneActorProperties,
      'Enter **Initial X** and **Initial Y**, then **Apply actor properties**. Facing, Skin and Initial animation configure this instance only. Initial animation starts at time zero and runs until a timeline animation replaces it.',
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
        'Choose **Play animation** as the **Action type**. Only the selected Actor’s character animations are available. Author or bake new character animations in **Animation Editor** first.',
      ),
      step(
        'add',
        'Add at the playhead',
        T.sceneAddAction,
        'Set the playhead before the scene endpoint and choose **Add action**. Open **Action properties** on the new selected clip to choose Animation, **Duration**, Loop and **Speed**. Duration is the finite scene window; Speed affects the source clip clock.',
      ),
      step(
        'tracks',
        'Understand clip ownership',
        T.sceneTimeline,
        'Animation clips share one base animation channel per Actor and **cannot overlap**. Different Actors can animate together. Movement uses a **separate channel**, so a walk animation and a move clip may run together. Scene clips use **hard cuts**; authored crossfades are unsupported.',
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
        'Choose **Move to position**, set the **playhead**, and **Add action**. In Action properties set Destination X/Y and Duration, then apply. The destination marker appears on the stage for a selected move.',
      ),
      step(
        'timing',
        'Pair movement and animation',
        T.sceneTimeline,
        'A move travels in a straight line from the Actor’s position at its scheduled start to its destination over **Duration**. It does not choose a walk animation or facing automatically. Add **Play animation** and Change facing actions as needed.',
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
        'Start and **Duration** are in seconds. **Apply action properties** validates the whole proposal. Conflicting moves or animations are rejected; adjacent windows are allowed. Wait / hold reserves no Actor channel, and cues are markers.',
      ),
      step(
        'timeline',
        'Drag and resize',
        T.sceneTimeline,
        'Drag a clip to move it; drag its right edge to resize it. **Snap** uses frame positions, clip edges and the **playhead**; **Alt** bypasses snapping. Escape or a canceled drag restores the previous timing. Each finished drag is one Undo step.',
      ),
      step(
        'zoom',
        'Inspect a long timeline',
        T.sceneZoom,
        'Increase **Zoom** to inspect short intervals. Scroll the tracks horizontally to pan. The timeline and inspector dividers resize the desktop workspace without modifying the scene.',
      ),
      step(
        'history',
        'Undo and Redo',
        T.sceneHistory,
        '**Undo** and **Redo** restore validated scene snapshots, including timing and destinations. Playback resets to the authored start after an edit; previewing and scrubbing create no history entries.',
      ),
    ],
  ),
  guide('scene-previewing', 'Previewing a Scene', 'Play, pause and seek isolated runtime Actors.', scene, [
    step(
      'play',
      'Use the shared scene clock',
      T.scenePlayback,
      '**Play** runs all Actors together. **Pause** freezes the clock, **Restart** begins at zero, and Stop restores initial placement for editing. Speed changes the whole scene clock. Playback waits for referenced character artwork.',
    ),
    step(
      'seek',
      'Scrub in either direction',
      T.sceneTime,
      'Set **Playhead (s)** or drag the ruler. Seeking pauses and reconstructs Actors from initial data, so reaching the same time produces the same supported pose. It suppresses gameplay animation events and scene cues. Resume delivers only future events.',
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
        '**Validate Scene** checks character, animation and skin references. **Download scene JSON** saves the scene document with permanent character manifest references. **Open scene JSON** or Paste scene JSON reloads it after checking dependencies. Relative editor imports resolve from this page.',
      ),
      step(
        'package',
        'Package for the runtime',
        T.scenePackage,
        '**Download scene package** includes scene.json, referenced character files and scene artwork, retaining layer order and parallax. **SceneLoader.loadPackage** loads the exported ZIP at runtime. The editor imports scene JSON with its image references; **Export Project** includes artwork in the workspace ZIP.',
      ),
    ],
  ),
];

/** Focused entries reuse verified workflow steps and their stable React/Phaser anchors. */
function focusedGuide(id: string, title: string, description: string, sourceId: string, stepIds: readonly string[]) {
  const source = workflowGuides.find((entry) => entry.id === sourceId)!;
  return guide(
    id,
    title,
    description,
    scene,
    stepIds.map((id) => source.steps.find((step) => step.id === id)!),
  );
}

export const sceneGuides: readonly GuideDefinition[] = [
  ...workflowGuides,
  focusedGuide(
    'scene-background-artwork',
    'Adding Background Artwork',
    'Import PNG/WebP artwork, reuse project images and keep the binaries with your scene.',
    'scene-backgrounds-layers',
    ['import', 'reuse', 'placement', 'save'],
  ),
  focusedGuide(
    'scene-managing-layers',
    'Managing Layers',
    'Arrange artwork behind and in front of Actors with ordering, visibility and locks.',
    'scene-backgrounds-layers',
    ['layers', 'order', 'save'],
  ),
  focusedGuide(
    'scene-understanding-parallax',
    'Understanding Parallax',
    'Choose scrolling factors and inspect depth without changing authored placement.',
    'scene-backgrounds-layers',
    ['parallax', 'preview', 'save'],
  ),
  focusedGuide(
    'scene-framing',
    'Framing a Scene',
    'Select the audience frame, fit an Actor and inspect camera preview.',
    'scene-cinematic-camera',
    ['select', 'frame', 'actor', 'preview'],
  ),
  focusedGuide(
    'scene-editing-camera',
    'Editing Cinematic Camera',
    'Set camera center and zoom while keeping editor navigation independent.',
    'scene-cinematic-camera',
    ['center', 'zoom', 'navigation', 'save'],
  ),
  focusedGuide(
    'scene-camera-keys',
    'Camera Keyframes',
    'Capture a pan and zoom, preview it and save the camera timeline.',
    'scene-camera-keyframes',
    ['capture', 'mode', 'time', 'values', 'preview', 'save'],
  ),
  focusedGuide(
    'scene-camera-cuts',
    'Creating Camera Cuts',
    'Hold a shot until an exact cut boundary and frame the next shot.',
    'scene-cuts-fades',
    ['cut', 'shot', 'track', 'preview', 'save'],
  ),
  focusedGuide(
    'scene-fade-transitions',
    'Adding Fade Transitions',
    'Create timed color fades, inspect holds and resolve overlapping intervals.',
    'scene-cuts-fades',
    ['add', 'timing', 'appearance', 'holds', 'preview', 'save'],
  ),
];
