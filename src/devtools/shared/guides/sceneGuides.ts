import { GUIDE_TARGETS as T } from './anchors.js';
import { guideStep } from './step.js';
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
    'scene-dialogue-advancement',
    'Dialogue Advancement',
    'Author Wait for Enter lines and verify one deliberate press advances one dialogue step.',
    scene,
    [
      guideStep({
        id: 'track',
        title: 'Open the dialogue track',
        description:
          'After exiting, open the **Dialogue** timeline tab and select a line. Choose **Add Dialogue Line** first if the track is empty. Selecting a line reveals its inspector; this tour preserves the current selection.',
        targetId: T.sceneDialogueTrack,
      }),
      guideStep({
        id: 'progression',
        title: 'Set Wait for Enter',
        description:
          'Choose **Dialogue progression → Wait for Enter**, then **Apply dialogue properties**. Start is the hold boundary; Duration controls silent scrubbing only. Timed lines continue automatically. Lines sharing a start advance in stable Line ID order, shown by numbered Enter markers.',
        targetId: T.sceneDialogueTiming,
      }),
      guideStep({
        id: 'preview',
        title: 'Preview a reading hold',
        description:
          'After exiting, choose **Stop**, then **Play** for a fresh pass. The line stays visible while scene time, choreography, root motion, camera, ordinary audio and future cues pause. A line at time zero waits immediately. Scrubbing is a silent cinematic sample and never waits or triggers sound.',
        targetId: T.scenePlayback,
      }),
      guideStep({
        id: 'advance',
        title: 'Advance one line',
        description:
          'Focus the canvas and press **Enter**, or use **Advance dialogue**. Held-key repeats cannot consume the next line. Each separate deliberate press advances one waiting line, including same-time exchanges. Typing fields keep Enter. Resume uses the frozen cinematic time without catching up the wait; Stop and Restart reset consumed holds.',
        targetId: T.scenePlayback,
      }),
    ],
  ),
  guide(
    'scene-dialogue-hold-presentation',
    'Idle Animation & Audio During Dialogue Holds',
    'Keep selected Actors and ambience alive while Wait for Enter dialogue freezes cinematic time.',
    actor,
    [
      guideStep({
        id: 'idle',
        title: 'Choose an optional idle',
        description:
          'In **Actor properties**, choose **Dialogue hold idle** for each Actor that should move while the viewer reads. **Hold cinematic pose** is the default. The selected existing animation loops as a sparse **snap overlay**: tracked channels replace the held pose, then snap back on Enter or Advance dialogue. Choose a compatible subtle idle. Root displacement and animation events are ignored; scene actions stay unchanged.',
        targetId: T.sceneActorProperties,
      }),
      guideStep({
        id: 'hold',
        title: 'Create a reading hold',
        description:
          'After exiting, select or add a dialogue line and choose **Wait for Enter** under **Dialogue progression**. Its start freezes the main scene clock; duration controls passive preview only. Apply dialogue properties to save. The dialogue inspector also offers Actor idle during holds and links to eligible hold audio. Camera, movement, scene fades and future cues remain frozen. Scrubbing shows only the cinematic sample and never starts idle playback.',
        targetId: T.sceneDialogueTiming,
      }),
      guideStep({
        id: 'audio',
        title: 'Configure dedicated hold audio',
        description:
          'Select an audio clip and choose **Audio playback → Hold-only loop (music / ambience)**. Use a **Music** or **Ambience** track. Start and Duration select which holds can use the loop; a window ending at scene end includes an ending hold. The loop starts at **Source offset**, uses constant Volume and stops on Advance. Ordinary scene audio, including voice and SFX, pauses and resumes at its frozen scene offset. Ordinary music does not continue automatically.',
        targetId: T.sceneAudioPlayback,
      }),
      guideStep({
        id: 'preview',
        title: 'Preview and advance',
        description:
          'After exiting this tour, **Play** to enter the hold. The subtitle stays visible and configured idle/audio loops continue using a separate local clock. **Pause** freezes the idle and stops audio; Play restores their local phase. **Advance dialogue** ends one hold and restores the exact cinematic pose before resuming. Same-time lines begin fresh holds. Restart, Stop, seek and scene switching dispose local playback. This tour never plays, edits or enables audio.',
        targetId: T.scenePlayback,
      }),
    ],
  ),
  guide(
    'scene-dialogue-authoring',
    'Dialogue & Subtitle Authoring',
    'Write timed or Wait for Enter dialogue, assign Actor speakers and save portable subtitles with optional voice references.',
    scene,
    [
      guideStep({
        id: 'add',
        title: 'Add a dialogue line',
        description:
          'After exiting this tour, set **Playhead (s)** and choose **Add Dialogue Line**. A selected Actor becomes the speaker; otherwise the line starts as narration. The initial interval lasts up to two seconds, bounded by the next line and scene end. Move the playhead earlier at scene end. Only an open scene is required; the tour never creates lines or selects Actors.',
        targetId: T.sceneDialogueAdd,
      }),
      guideStep({
        id: 'track',
        title: 'Select a line on the timeline',
        description:
          'The **Dialogue** track shares the scene ruler and playhead with actions, camera keys, transitions and audio. Each clip shows its speaker and text. After exiting, click a line to pause and select it, then open **Dialogue line** in the inspector. Edit timing in the inspector; dialogue edges also participate in shared snapping. Empty rows are ready for your first line. The tour preserves selection and playback.',
        targetId: T.sceneDialogueTrack,
      }),
      guideStep({
        id: 'text',
        title: 'Write multiline text in any language',
        description:
          '**Dialogue text** accepts multiple lines, Japanese and other Unicode text. Intentional line breaks and whitespace are preserved. Text is literal plain text, never executable markup. Empty text is allowed while drafting. Use **Apply dialogue properties** to commit the complete edit. With no line selected, this section explains how to begin; the guide never creates or edits text.',
        targetId: T.sceneDialogueText,
      }),
      guideStep({
        id: 'speaker',
        title: 'Choose an Actor or narration',
        description:
          '**Speaker Actor** selects a scene-local Actor instance, not a character definition. Two Actors using the same character can speak independently. Choose **Narration (no Actor)** for an unassociated line. **Speaker label** overrides the Actor ID or default Narrator label without changing identity. Actor renames retain speaker links; reassign lines or convert them to narration before removing a speaking Actor.',
        targetId: T.sceneDialogueSpeaker,
      }),
      guideStep({
        id: 'timing',
        title: 'Set timing and resolve overlaps',
        description:
          '**Dialogue start** and **Dialogue duration** use seconds in the inspector. Apply dialogue properties validates the whole proposal. Choose **Dialogue progression**: **Timed** keeps existing intervals; **Wait for Enter** holds playback at the start until **Advance dialogue** is clicked. Timed duration must be positive; hold duration controls passive preview and may be zero, including at scene end. Lines must end within scene duration. Only **one subtitle at a time** is shown. Overlaps are rejected except holds sharing the same start, which advance individually in stable, case-sensitive ID order. Adjacent intervals are valid. Move or shorten a conflicting line, or explicitly extend the scene. The tour changes no timing.',
        targetId: T.sceneDialogueTiming,
      }),
      guideStep({
        id: 'voice',
        title: 'Organize an optional voice reference',
        description:
          '**Voice reference** optionally links an existing scene audio clip. It is **metadata**: it never starts sound, moves the clip or changes dialogue timing. Arrange voice playback on the **audio timeline** using its own start, trim, volume, loops and fades. Clear or replace a line’s voice reference before deleting that clip or its track. None is valid, and an empty scene needs no audio to explore this step.',
        targetId: T.sceneDialogueVoice,
      }),
      guideStep({
        id: 'history',
        title: 'Duplicate, delete and undo lines',
        description:
          '**Duplicate dialogue line** assigns a new stable ID and places the copy in the next gap after the source that fits its entire duration. If no gap fits, move or shorten lines, or extend the scene. **Delete dialogue line**, or Delete/Backspace outside text controls, removes the selection. Scene **Undo/Redo** restores text, speaker and timing edits. The tour never invokes these commands or alters history.',
        targetId: T.sceneDialogueActions,
      }),
      guideStep({
        id: 'time',
        title: 'Understand deterministic subtitle timing',
        description:
          '**Timed** dialogue uses scene time. **Wait for Enter** freezes cinematic Actor playback, camera, fades and future cues at the authored start; optional **Dialogue hold idle** overlays and **Hold-only loop** audio keep presentation alive until **Advance dialogue** is clicked once per line. Waiting time never catches up. **Scrubbing** stays nonblocking and independent of earlier advances; resuming consumes holds at or before the sample. Same-time holds preview the first active ID; zero-duration holds appear exactly at their start. **Play** displays the active subtitle; Pause holds it, Restart begins again and Stop clears it. **Scrubbing** immediately displays the line at the target time without playing audio or dispatching scene cues. Subtitles stay within the cinematic camera frame and remain readable above scene fades. Branching choices and typewriter effects are outside this workflow. This tour never seeks, plays or enables audio.',
        targetId: T.sceneTime,
      }),
      guideStep({
        id: 'save',
        title: 'Save dialogue with the scene',
        description:
          '**Download scene JSON** preserves text, line breaks, speaker IDs, labels, timing, progression and voice references. **Download scene package** includes the referenced character and audio files for portable handoff. **Export Project** and local recovery retain dialogue too. JSON alone needs its referenced assets alongside it. Exit the guide before editing; authored data, selection, playhead, speed, mute, preview and Undo/Redo are preserved.',
        targetId: T.scenePackage,
      }),
    ],
  ),
  guide(
    'scene-audio-synchronization',
    'Audio Playback & Synchronization',
    'Hear scene audio, recover browser sound, seek silently and control preview speed and mute.',
    scene,
    [
      guideStep({
        id: 'clips',
        title: 'Prepare music and effects',
        description:
          'Audio clips share the **scene clock** with Actor animation, movement, camera shots, fades and cues. Overlapping music and effects play together with their authored volume, source offsets, loops and fades. If the rows are empty, use the **Visual Audio Timeline** guide after this tour to import and arrange clips. Only an open scene is required here; this tour never starts sound or changes playback.',
        targetId: T.sceneAudioTracks,
      }),
      guideStep({
        id: 'unlock',
        title: 'Enable browser audio and recover errors',
        description:
          '**Audio: disabled** means there are no clips; **locked** means sound needs a user action. After exiting, click **Play** to enable sound and load clips, or **Enable audio** beside this status to prepare audio without moving the playhead. Loading becomes ready when sound is available. If the browser blocks sound or decoding fails, allow sound or reimport a supported WAV, MP3 or OGG file, then retry Enable audio. It appears when audio is locked or has an error.',
        targetId: T.sceneAudioStatus,
      }),
      guideStep({
        id: 'play',
        title: 'Play and pause on the scene timeline',
        description:
          'After exiting, click **Play** to hear clips at their authored times. The button becomes **Pause**, which stops audible voices and holds scene time. Play resumes active clips at their current source-relative positions, including loop and fade progress. Clips that have already ended are not replayed. The guide only highlights this control; it never presses Play, resumes browser audio or pauses your preview.',
        targetId: T.scenePlayback,
      }),
      guideStep({
        id: 'seek',
        title: 'Scrub silently and listen from the middle',
        description:
          '**Playhead (s)** and ruler scrubbing pause playback and remain **silent**, even when crossing effect starts repeatedly. After exiting, seek to the middle of a clip, then use Play to hear its remaining portion from the correct source offset. Effects ending before the selected time stay silent. Visual poses, root motion, camera framing and fades update at the same selected scene time. This tour does not seek.',
        targetId: T.sceneTime,
      }),
      guideStep({
        id: 'speed',
        title: 'Change preview speed with sound',
        description:
          '**Speed** applies to scene visuals and audio together, from 0.25× through 2×. Slower playback takes longer; faster playback finishes sooner. Audio **pitch changes with speed**; there is no pitch-preserving stretch mode. Return to 1× to assess the intended sound. Speed is a preview preference and does not change authored clip times or the exported scene. The tour preserves your current speed.',
        targetId: T.scenePlaybackSpeed,
      }),
      guideStep({
        id: 'mute',
        title: 'Mute the scene preview',
        description:
          '**Mute preview audio** stops scene sound while visual playback continues. Unmuting resumes ready audio at the current scene position; if sound is locked or unavailable, use Enable audio after exiting. Mute does not edit clip volume, the source file or exported audio. Project Workspace audition has its own controls. This tour leaves the mute setting unchanged.',
        targetId: T.sceneAudioMute,
      }),
      guideStep({
        id: 'restart',
        title: 'Replay the scene from zero',
        description:
          'After exiting, **Restart** returns the scene clock to zero and starts playback again, replacing the previous voices. Opening music starts again and later effects wait for their authored times. A muted preview stays muted. If audio needs loading or browser permission, Restart prepares sound through that user action before starting. Restart is a transport command; it does not edit your scene or Undo/Redo.',
        targetId: T.sceneRestart,
      }),
      guideStep({
        id: 'stop',
        title: 'Stop sound and return to editing',
        description:
          '**Stop** silences owned audio, returns the playhead to zero and restores initial Actor placement for editing. Scene completion also ends its sound. Switching scenes, leaving the project editor or closing the scene releases its audio; hiding the editor page pauses playback. Use Play explicitly when you return. The tour never invokes Stop or changes the current playback state.',
        targetId: T.sceneStop,
      }),
      guideStep({
        id: 'save',
        title: 'Keep sound with the scene',
        description:
          '**Download scene package** includes referenced audio binaries and authored timing, trims, volume, loops and fades for portable playback. JSON alone keeps relative references; keep the files alongside it. **Export Project** and local recovery also retain audio. A standalone player must provide its own user-action audio enable control. Preview speed and mute are not exported. Exit this guide before trying playback; your scene, selection, playhead, preview and history are preserved.',
        targetId: T.scenePackage,
      }),
    ],
  ),
  guide(
    'scene-audio-timeline',
    'Visual Audio Timeline',
    'Arrange audio clips, trim source media and save volume, loops and fades with the scene.',
    scene,
    [
      guideStep({
        id: 'asset',
        title: 'Choose imported audio',
        description:
          'Import WAV, MP3 or OGG audio in Project Workspace, then open its Scene Editor. **Audio asset** lists that project’s audio library; standalone scenes list their imported audio references. If the list is empty, import audio in Project Workspace after exiting this tour. An empty scene is enough to explore every step; Actors and selected clips are optional. The tour only reveals controls and never imports, selects or plays audio.',
        targetId: T.sceneAudioAsset,
      }),
      guideStep({
        id: 'tracks',
        title: 'Organize audio tracks',
        description:
          'Choose **Track category**, then **Add audio track**. **Music**, Ambience, Sound Effects and Voice are organizational labels: any track can contain any audio asset. Add multiple tracks of the same category when useful. Choose Audio track before adding a clip, or change Clip track in the selected clip’s inspector. The tour does not create tracks.',
        targetId: T.sceneAudioAddTrack,
      }),
      guideStep({
        id: 'add',
        title: 'Place a clip at the playhead',
        description:
          'After exiting, set **Playhead (s)**, choose **Audio asset** and **Audio track**, then **Add Audio Clip**. A new clip starts at the playhead and uses decoded media duration, limited to remaining scene time; unknown media duration starts at one second. At scene end, move the playhead earlier. Clips always have finite bounds; adding or editing audio never silently extends the scene.',
        targetId: T.sceneAudioAddClip,
      }),
      guideStep({
        id: 'arrange',
        title: 'Arrange and overlap clips',
        description:
          'Click an audio clip to select it. **Drag its body** to move its scene start without changing the source offset. Snapping shares frames, playhead, Actor clip edges, camera keys, transitions and other audio edges; hold **Alt** to bypass it. **Overlapping clips** are allowed, including within one track, and appear on separate visible lanes. Use the **trash button** beside a track name to remove it. A track containing clips asks before removing them too; one **Undo** restores the track and clips. Empty audio rows are ready for your first track and clip after the tour.',
        targetId: T.sceneAudioTracks,
      }),
      guideStep({
        id: 'trim',
        title: 'Trim without changing the source file',
        description:
          'Select a clip and open Audio clip to edit **Start**, **Duration** and **Source offset** in seconds, then **Apply audio clip properties**. Drag the left edge to advance source offset and start while keeping scene end fixed; drag the right edge to change duration. Media duration is the decoded file length, separate from clip duration and scene playhead time. Non-looping clips cannot read past media end. With no clip selected, this section explains how to begin; the tour never selects one.',
        targetId: T.sceneAudioTiming,
      }),
      guideStep({
        id: 'playback',
        title: 'Set volume and bounded looping',
        description:
          '**Volume** ranges from 0 to 100%; zero is valid. **Loop** repeats the source window from **Source offset** through media end, stopping at the finite clip end. Left trimming a loop changes its repeated source window; right trimming can extend it beyond media length within scene duration. Apply audio clip properties commits the edit. Use **Play** to enable browser audio and hear clips on the scene clock. **Pause**, **Stop** and passive scrubbing are silent; playback resumes active clips from the selected time. **Mute preview audio** silences the scene; **Enable audio** retries browser restrictions or loading failures.',
        targetId: T.sceneAudioPlayback,
      }),
      guideStep({
        id: 'fades',
        title: 'Author clip fades',
        description:
          '**Fade in** and **Fade out** are durations in seconds at the clip’s scene edges; omitted values mean zero. Each fade must fit within clip duration. They describe linear gain ramps, and overlapping ramps multiply. **Apply audio clip properties** commits fades with the other properties. Audio fades are distinct from the scene’s full-frame color transitions. Audio fades follow scene playback, including speed changes and playback after seeking. Waveform previews are deferred.',
        targetId: T.sceneAudioFades,
      }),
      guideStep({
        id: 'history',
        title: 'Duplicate, delete and undo',
        description:
          '**Duplicate audio clip** creates a new stable ID at the same time, preserving its asset, track, trim, volume, loop and fades; move the copy or choose another track afterward. **Delete audio clip** or **Delete**/Backspace removes the selection. Scene Undo/Redo restores edits. A completed drag is one history entry; Escape, blur, capture loss or a selection change cancels an unfinished gesture. The source audio file stays unchanged.',
        targetId: T.sceneAudioActions,
      }),
      guideStep({
        id: 'save',
        title: 'Save timing and audio together',
        description:
          '**Download scene JSON** preserves audio tracks, asset references, timing, source offsets, volume, loops and fades. **Download scene package** includes referenced audio binaries for portable handoff; **Export Project** and local recovery retain them too. Project dependency checks block removing audio used by a scene. Keep relative assets with JSON or download a ZIP. This tour preserves the scene, selection, playback, preview and Undo/Redo.',
        targetId: T.scenePackage,
      }),
    ],
  ),
  guide(
    'scene-root-motion',
    'Using Root Motion',
    'Choose animation-owned travel, resolve movement conflicts and retain the final Actor position.',
    action,
    [
      guideStep({
        id: 'clip',
        title: 'Select an animation clip',
        description:
          'After exiting this tour, select an animation action on the **Actor timeline**. If a move, wait, face or cue is selected, select or add an animation action first. Author and save root **Position X/Y** keys in **Animation Editor** before choosing the clip here. This tour preserves selection, playback and authored data.',
        targetId: T.sceneTimeline,
      }),
      guideStep({
        id: 'source',
        title: 'Choose the movement source',
        description:
          'Open **Action properties · animation**. Set **Movement source** to **Animation root motion**, then Apply action properties. Scene-controlled is the default and ignores root translation. The root option is disabled for clips without root keys. The read-only Root displacement reports animation-local X/Y over the window; facing and scale at clip start transform it once.',
        targetId: T.sceneActionProperties,
      }),
      guideStep({
        id: 'preview',
        title: 'Preview the travel',
        description:
          'After exiting, use **Play** and **Pause**, or **Playhead (s)** to scrub forward and backward. Duration bounds travel; non-looping clips hold their endpoint and Loop within duration accumulates complete cycles. Seeking reconstructs from initial Actor placement, so returning to the same time gives the same position. The tour never starts playback or seeks.',
        targetId: T.scenePlayback,
      }),
      guideStep({
        id: 'conflicts',
        title: 'Resolve competing translation owners',
        description:
          'An **Animation root motion** clip owns translation throughout its full action window, including an endpoint hold. Overlapping move actions or another root clip on that Actor are rejected without changing either action. Shorten or move an action, or choose **Scene-controlled** when scene movement should own travel. Adjacent actions and independent Actors are allowed.',
        targetId: T.sceneActionProperties,
      }),
      guideStep({
        id: 'finish',
        title: 'Confirm and preserve the final position',
        description:
          'After playback passes the clip end, open **Runtime preview** to inspect **Position**. A +80 step from X=100 ends at X=180 at right-facing scale 1; a following idle holds it. Cancel retains applied travel; **Stop** restores authored placement. Download scene JSON preserves Movement source; Download scene package also includes character root keys for standalone runtime playback.',
        targetId: T.sceneStage,
      }),
    ],
  ),
  guide(
    'scene-cuts-fades',
    'Cinematic Cuts, Fades & Transitions',
    'Cut between camera shots and author color fades with deterministic seeking on the scene timeline.',
    scene,
    [
      guideStep({
        id: 'cut',
        title: 'Create an instant shot cut',
        description:
          'After exiting this tour, set **Playhead (s)** to the desired cut time and choose **Set Camera Cut**. The command captures X, Y and **Zoom** keys and makes the preceding keys Stepped, holding the old shot until the exact cut boundary. If needed, it adds a time-zero baseline to preserve the opening frame. All channels enter one scene Undo step. Actors are optional; the tour never creates or selects a cut.',
        targetId: T.sceneCameraCut,
      }),
      guideStep({
        id: 'shot',
        title: 'Frame the new shot',
        description:
          'Set Camera Cut enables **Camera Key Edit** mode. At the cut time, change **Center X/Y** and **Camera zoom**, then **Apply camera key** to create the close-up. The previous shot holds until this time; seeking to the exact boundary shows the new frame. Camera channels keep their existing owner and independent controls. The tour leaves key editing mode, values and selection unchanged.',
        targetId: T.sceneCameraKeyValues,
      }),
      guideStep({
        id: 'add',
        title: 'Add a fade at the playhead',
        description:
          'Choose **Effect type** → **Fade in** or **Fade out**, then Add effect. Fade in reveals the scene from black or a color; Fade out covers it. New effects start at the playhead, use black and last up to one second of remaining scene time. For an opening fade, use time 0. No Actor is required. If the playhead is at the scene end, move it earlier before adding a fade.',
        targetId: T.sceneAddTransition,
      }),
      guideStep({
        id: 'timing',
        title: 'Set fade start and duration',
        description:
          'Select a fade on the **Transitions** track, then open **Transition properties**. Edit **Fade start (seconds)** and Fade duration (seconds), and choose Apply transition properties. Duration must be positive and the effect must end within scene duration. Authored times use milliseconds on the same clock as Actors and camera keys. With no fade selected, this section explains how to begin; the tour does not select one for you.',
        targetId: T.sceneTransitionTiming,
      }),
      guideStep({
        id: 'appearance',
        title: 'Choose fade direction and color',
        description:
          '**Fade type** chooses **Fade in** from color or **Fade out** to color. Fade color uses a six-digit #rrggbb value; black is the default. Apply transition properties commits direction, color and timing together. Fade in changes opacity from 1 to 0; Fade out changes it from 0 to 1. This is a full output-frame overlay above backgrounds, Actors and foreground artwork, below editor guides. React controls stay available.',
        targetId: T.sceneTransitionAppearance,
      }),
      guideStep({
        id: 'track',
        title: 'Select fades and cut markers',
        description:
          'The upper **Transitions** row shows fade intervals; click a clip to select it and pause playback. Cut diamonds appear below: click one to seek to its time and select a camera channel key. Edit camera timing in **Selected camera key** or drag its channel diamond. Fade edges participate in ruler snapping. Empty rows are ready for your first cut or fade after the tour.',
        targetId: T.sceneTransitions,
      }),
      guideStep({
        id: 'holds',
        title: 'Hold a color and resolve conflicts',
        description:
          'A completed fade holds its **final opacity** until the next fade. For a fade-out, color hold and fade-in, leave a gap between two effects using the same color. Fade intervals **cannot overlap**; move or shorten an effect if validation reports a conflict. Adjacent fades are allowed and the later fade owns their shared boundary. **Delete transition** or Delete/Backspace removes the selected effect; scene Undo/Redo restores edits. These transitions stay within one scene.',
        targetId: T.sceneTransitionProperties,
      }),
      guideStep({
        id: 'preview',
        title: 'Preview and seek through transitions',
        description:
          'After exiting this tour, choose **Preview Through Camera** and **Play**. **Pause** inside a fade, scrub forward and backward, and return to the same time: color, opacity and framing must match. Scrub just before and exactly at a cut to see the immediate shot change. Actors and animations continue beneath fades. Seeking samples authored data without replaying a fade or dispatching external cues. The tour never changes playback, preview mode or overlays.',
        targetId: T.sceneCameraPreview,
      }),
      guideStep({
        id: 'save',
        title: 'Save shots and fades together',
        description:
          '**Download scene JSON** preserves stepped camera keys and fade IDs, times, durations, types and colors; keep its referenced assets with it. **Download scene package** includes the character and artwork files for portable handoff. Project export and local recovery retain transitions too. Standalone SceneLoader playback evaluates fades on the runner clock and cleans up its overlay on disposal. Editor selection, playhead and preview settings are not exported.',
        targetId: T.scenePackage,
      }),
    ],
  ),
  guide(
    'scene-camera-keyframes',
    'Camera Timeline & Keyframes',
    'Animate camera pans and zooms with timeline keys, outgoing curves and deterministic scene playback.',
    scene,
    [
      guideStep({
        id: 'capture',
        title: 'Capture the first shot',
        description:
          'After exiting this tour, set the **playhead** to 0 seconds and choose **Set Camera Key**. It captures the evaluated camera center and zoom on all three Camera rows and enables **Camera Key Edit** mode. You can begin in an empty scene; Actors are optional. This tour only reveals controls and never creates or selects keys.',
        targetId: T.sceneCameraSetKey,
      }),
      guideStep({
        id: 'mode',
        title: 'Choose explicit camera key editing',
        description:
          '**Camera Key Edit** mode makes **Apply camera key**, **Reset Camera**, **Frame Actor** and frame dragging author keys at the playhead. With the mode off, numeric controls edit initial settings. Wheel zoom and middle/right/Alt-drag always navigate the editor without creating keys; animated frames require Key Edit mode to drag. The tour leaves your mode unchanged.',
        targetId: T.sceneCameraKeyMode,
      }),
      guideStep({
        id: 'time',
        title: 'Choose a later shot time',
        description:
          'Set **Playhead (s)** to 3, or scrub the ruler, to place the next shot. Seeking pauses playback. The UI displays seconds; camera keys, Actors and parallax share the same millisecond scene clock. Keyed channels hold their first and last values outside their key range; channels without keys use the initial camera settings.',
        targetId: T.sceneTime,
      }),
      guideStep({
        id: 'values',
        title: 'Pan and zoom into the next shot',
        description:
          'With **Camera Key Edit** mode enabled, change **Center X/Y** and **Camera zoom**, then choose Apply camera key. Centers use scene pixels; zoom ranges from 0.1 to 8. For example, pan toward an Actor at 3 seconds and add a closer zoom at 5 seconds. **Frame Actor** can capture one explicit shot of the chosen Actor; it never enables continuous tracking.',
        targetId: T.sceneCameraKeyValues,
      }),
      guideStep({
        id: 'tracks',
        title: 'Select and move camera diamonds',
        description:
          'Camera has independent X, Y and **Zoom** rows below the Actor tracks. Click a diamond to select it and pause playback; drag it to move its time. **Snap** uses the frame grid, other camera keys, Actor clip edges and **playhead**; Alt bypasses snapping. Escape, blur or capture loss cancels a drag. Each completed drag is one scene Undo step. If the rows are empty, capture the first shot after exiting the tour.',
        targetId: T.sceneCameraTracks,
      }),
      guideStep({
        id: 'properties',
        title: 'Inspect, duplicate and delete a key',
        description:
          'Open **Cinematic Camera** → **Selected camera key** to edit a selected diamond’s exact time and value, then **Apply selected camera key**. Duplicate camera key copies its outgoing curve to an explicit time; Delete camera key or Delete/Backspace removes the selected diamond. Same-channel time collisions are rejected. Scene Undo/Redo restores these edits while retaining the Actor clock. Without a selected key this section explains how to begin; the tour never selects one for you.',
        targetId: T.sceneCameraKeyProperties,
      }),
      guideStep({
        id: 'curves',
        title: 'Shape the outgoing camera motion',
        description:
          'Choose **Linear**, **Stepped**, **Smooth** / eased preset or Bézier for the selected key’s outgoing segment. Stepped holds until the next key. Smooth uses a Bézier ease preset; Bézier exposes four normalized handle coordinates above this menu. Keep each coordinate in [0, 1] and the first X no greater than the second X. Apply selected camera key commits handle edits. Bounded curves keep zoom between its endpoint values; evaluated zoom is also clamped to [0.1, 8]. Select a diamond after the tour if no curve controls are shown.',
        targetId: T.sceneCameraKeyCurves,
      }),
      guideStep({
        id: 'preview',
        title: 'Preview and repeat a seek',
        description:
          'After exiting this tour, choose **Preview Through Camera**, then **Play**. Camera motion, Actors and background parallax advance together. **Pause**, Restart or scrub repeatedly between 2 and 5 seconds: returning to an identical time produces identical framing. Stop returns the scene clock to zero. Exit Camera Preview restores editor navigation. The tour never changes the clock, preview mode or overlays.',
        targetId: T.sceneCameraPreview,
      }),
      guideStep({
        id: 'save',
        title: 'Save camera keys and curves',
        description:
          '**Download scene JSON** preserves **Camera X/Y/Zoom** keys and their outgoing curves; keep its referenced assets with it. **Download scene package** includes the referenced character and artwork files for portable handoff. Export Project and local recovery retain the camera tracks too. At runtime, LoadedScene.applyCamera opts the host camera into the runner clock and parallax. Static and legacy scenes remain supported; editor navigation and Key Edit mode are not exported.',
        targetId: T.scenePackage,
      }),
    ],
  ),
  guide(
    'scene-cinematic-camera',
    'Cinematic Camera',
    'Author audience framing, frame an Actor and preview through the camera independently of editor navigation.',
    scene,
    [
      guideStep({
        id: 'select',
        title: 'Select the cinematic camera',
        description:
          'After exiting this tour, choose **Select Cinematic Camera** in the **Cinematic Camera** inspector. The camera defines the audience frame independently of Actors. Its selection keeps the last selected Actor available for framing. This tour only reveals controls; it does not select, move or reset anything.',
        targetId: T.sceneCameraSelect,
      }),
      guideStep({
        id: 'frame',
        title: 'Position the audience frame',
        description:
          'The blue rectangle is the 1000 × 700 **output frame**, with a 10:7 aspect ratio and a center cross. Outside camera preview, drag a frame edge to select and move the camera, or drag its center after selecting it. A completed drag is one scene **Undo** step; **Escape** cancels it without moving Actors.',
        targetId: T.sceneStage,
      }),
      guideStep({
        id: 'center',
        title: 'Set the camera center',
        description:
          '**Center X** and **Center Y** use scene pixels: X increases rightward and Y downward. They describe the middle of the audience frame, not a scroll offset. Enter both values and use **Apply camera** to commit. Scenes without saved camera settings start at center (0, 0) and zoom 1.',
        targetId: T.sceneCameraCenter,
      }),
      guideStep({
        id: 'zoom',
        title: 'Adjust zoom and reset framing',
        description:
          '**Camera zoom** ranges from 0.1 to 8. At zoom 1, the frame covers 1000 × 700 scene pixels; at zoom 2, it covers 500 × 350. **Apply camera** commits the values. **Reset Camera** restores center (0, 0) and zoom 1 as an undoable camera edit. Actor transforms and animation keys stay unchanged.',
        targetId: T.sceneCameraZoom,
      }),
      guideStep({
        id: 'actor',
        title: 'Frame an Actor',
        description:
          'Choose an Actor in **Actor to frame**, then choose **Frame Actor**. The list starts at the selected Actor, or the first Actor when none is selected. The camera fits the current rendered bounds with 20% breathing room and bounded zoom. If reliable bounds are unavailable, it centers on the initial Actor origin and keeps zoom. In a scene without Actors the button is disabled; you can still author the camera. The tour preserves your selection.',
        targetId: T.sceneCameraFrameActor,
      }),
      guideStep({
        id: 'preview',
        title: 'Preview through the camera',
        description:
          'After exiting this tour, choose **Preview Through Camera** to see audience framing with backgrounds, parallax, Actors and foreground layers. Playback and scrubbing remain available. Editor overlays start hidden; enable **Editor overlays during preview** to show ground and selection controls. **Exit Camera Preview** restores the saved editor view. This tour never switches preview modes or starts playback.',
        targetId: T.sceneCameraPreview,
      }),
      guideStep({
        id: 'navigation',
        title: 'Keep editor navigation independent',
        description:
          'Outside camera preview, **wheel zoom** and middle/right/**Alt-drag** pan navigate the editor without changing the authored camera. **Reset view** restores navigation and clears the temporary Preview camera X/Y parallax inspection offset; it does not reset cinematic framing. These navigation controls are disabled during audience preview. Preview camera X/Y is view-only and excluded from audience framing and saved camera settings.',
        targetId: T.sceneCameraNavigation,
      }),
      guideStep({
        id: 'save',
        title: 'Save the camera with the scene',
        description:
          '**Download scene JSON** stores initial camera settings and **Camera X/Y/Zoom** timeline keys, including outgoing curves. Scene packages, **Export Project** and local recovery retain them too. Set Camera Key captures the playhead camera; Camera Key Edit mode makes Apply camera key, framing and frame dragging author explicit keys. Navigation, selection, preview mode and overlays are excluded. At runtime, LoadedScene.applyCamera opts into the runner clock and parallax; reapply it after resizing.',
        targetId: T.scenePackage,
      }),
    ],
  ),
  guide(
    'scene-backgrounds-layers',
    'Backgrounds, Layers and Parallax',
    'Import scene artwork, arrange it around Actors and preview layer parallax.',
    scene,
    [
      guideStep({
        id: 'import',
        title: 'Add a background image',
        description:
          'After exiting this tour, choose **+ Add Background** in **Scene Artwork** to import a PNG or static WebP. Each image is independent scene artwork with its own placement; character rigs and attachments stay unchanged. An empty scene is enough to start.',
        targetId: T.sceneAddBackground,
      }),
      guideStep({
        id: 'reuse',
        title: 'Reuse project artwork',
        description:
          '**+ Add Image From Project** offers imported scene images and, inside a project, character package artwork. Choose an image to create another independent element. This tour does not open a picker or import anything.',
        targetId: T.sceneProjectImage,
      }),
      guideStep({
        id: 'placement',
        title: 'Position and scale artwork',
        description:
          'Select an image in **Scene Artwork** or **Scene Layers**. While stopped, drag it on the stage and use its lower-right corner to scale. Numeric **Position X/Y** sets its center; Apply image transform commits position and scale together. Escape cancels a drag; Undo/Redo restores completed edits. If no image is selected, this section explains how to begin. This tour keeps your current selection.',
        targetId: T.sceneImageTransform,
      }),
      guideStep({
        id: 'layers',
        title: 'Organize background and foreground layers',
        description:
          '**+ Add Layer** creates an artwork layer. Set its name with **Apply layer**, then use each image row’s **Layer** menu to assign it. The hierarchy lists frontmost layers first and selects obscured elements. Put mountains behind forest artwork and trees in front of the Actors band. Each Actor remains a whole Puppet; artwork cannot split its bones or interleave individual Actors.',
        targetId: T.sceneLayers,
      }),
      guideStep({
        id: 'order',
        title: 'Control depth, visibility and locks',
        description:
          '**Forward / Backward** moves a layer; row arrows order images or Actors within their band. **Visible** hides artwork without deleting it. **Lock** protects images from canvas and inspector edits for this editor session. Removing an artwork layer moves its images into Background and keeps assets, as one Undo/Redo action. Background and Actors cannot be removed. Ground guides and selected handles remain above artwork.',
        targetId: T.sceneLayerOrder,
      }),
      guideStep({
        id: 'parallax',
        title: 'Set layer parallax',
        description:
          'Each artwork layer has a **Parallax** field committed with **Apply layer**. Use 0 for fixed scrolling, 1 for normal world scrolling, a fraction for slower backgrounds, or a value above 1 for faster foregrounds. For example, try 0.2 for mountains, 0.5 for forest and 1.2 for foreground trees. The Actors band always uses 1, and authored movement paths stay unchanged.',
        targetId: T.sceneLayerParallax,
      }),
      guideStep({
        id: 'preview',
        title: 'Preview scrolling independently of placement',
        description:
          'After exiting this tour, change **Preview camera X/Y** to inspect parallax, including during choreography playback. Editor wheel zoom and middle/right/**Alt**-drag panning remain ordinary navigation. Neither navigation nor preview scroll edits image positions or creates history entries. **Reset view** clears preview scroll and navigation. The tour changes none of these values.',
        targetId: T.sceneParallaxPreview,
      }),
      guideStep({
        id: 'save',
        title: 'Save artwork with the scene',
        description:
          '**Download scene JSON** stores image references, layer order, visibility and parallax. **Download scene package** includes the image and character binaries for portable handoff; **Export Project** preserves them in the workspace ZIP. Editor-only locks, selection and preview camera values are not exported. Clean unused images retains assets needed by scene history.',
        targetId: T.scenePackage,
      }),
    ],
  ),
  guide(
    'scene-grounding-characters',
    'Grounding Characters',
    'Snap independent Actors using their evaluated bone-local contacts.',
    scene,
    [
      guideStep({
        id: 'ground',
        title: 'Enable the ground reference',
        description:
          'After exiting this tour, enable **Show ground guide** and set scene **Ground Y**. The guide never changes placement or choreography automatically.',
        targetId: T.sceneGroundVisible,
      }),
      guideStep({
        id: 'actor',
        title: 'Select an Actor',
        description:
          'Add a character if the scene is empty, then select its Actor. **Stop** playback before editing **initial placement**. Each character has its own proportions, facing and contacts.',
        targetId: T.sceneActors,
      }),
      guideStep({
        id: 'marker',
        title: 'Select a foot marker',
        description:
          'Choose **Actor foot contact marker**. The list uses that character’s rig definitions. A missing or invalid contact requires manual placement; rigs without markers can use the labeled **legacy attachment sole fallback**. Marker selections are temporary view state and must be chosen again after reopening a scene.',
        targetId: T.sceneContactMarker,
      }),
      guideStep({
        id: 'snap',
        title: 'Snap the Actor',
        description:
          '**Snap Actor to Ground** changes only initial Actor Y using the selected evaluated marker, including facing and scale. X and movement paths stay intact. Scene **Undo/Redo** restores the edit. Select and snap other Actors independently.',
        targetId: T.sceneGroundAlign,
      }),
      guideStep({
        id: 'preview',
        title: 'Preview the scene',
        description:
          '**Play** or scrub to inspect the contacts through animation and movement. Grounding sets **initial placement** only; it does not lock feet or compensate sliding. **Stop** restores placement editing. Export scene JSON or a scene package to keep the authored positions.',
        targetId: T.scenePlayback,
      }),
    ],
  ),
  guide(
    'scene-ground-reference',
    'Aligning Actors to Ground',
    'Use a scene-world reference and explicitly align Actor feet through scene Undo/Redo.',
    scene,
    [
      guideStep({
        id: 'enable',
        title: 'Enable the ground guide',
        description:
          'After exiting this tour, enable **Show ground guide** in **Scene ground**. It is a visual reference, not a physics floor. Showing or moving it does not change Actors, movement paths or scene history.',
        targetId: T.sceneGroundVisible,
      }),
      guideStep({
        id: 'position',
        title: 'Adjust scene Ground Y',
        description:
          'Enter **Ground Y** and press Enter, or drag the amber ↕ Ground label on the stage. Values are **scene-world coordinates**, independent of Animation Editor preview Y. Negative coordinates are supported. Guide **Undo/Redo** restores preferences only.',
        targetId: T.sceneGroundY,
      }),
      guideStep({
        id: 'select',
        title: 'Select an Actor',
        description:
          'Choose an Actor in the list. Different rigs and artwork sizes can have different origins. **Stop** playback before editing **initial placement**. This tour does not select an Actor for you.',
        targetId: T.sceneActors,
      }),
      guideStep({
        id: 'snap',
        title: 'Align feet to ground',
        description:
          'Choose an **Actor foot contact marker** and use **Snap Actor to Ground** to translate initial Y while preserving X. Without rig markers, **Align Feet to Ground** retains the labeled legacy attachment sole fallback. Stop playback to edit. Scene Undo/Redo restores the edit. Optional Snap to Ground uses the selected contact during placement drags; hold Shift to move freely.',
        targetId: T.sceneGroundAlign,
      }),
      guideStep({
        id: 'preview',
        title: 'Preview scene movement',
        description:
          '**Play** and scrub to inspect movement against the fixed reference. Authored paths may leave the line; no snapping runs during playback. **Stop** restores **initial placement**. Export preserves Actor edits; guide preferences stay in this browser by scene ID. Hide or Reset Ground Y in Scene ground when finished.',
        targetId: T.scenePlayback,
      }),
    ],
  ),
  guide(
    'scene-creating',
    'Creating a Scene',
    'Create an independent scene document with a finite timeline.',
    [],
    [
      guideStep({
        id: 'new',
        title: 'Create the document',
        description:
          'Choose **New Scene**, give it a unique **Scene ID** and name, and set its duration in seconds. The scene begins empty; no character is required.',
        targetId: T.sceneNew,
      }),
      guideStep({
        id: 'save',
        title: 'Keep your work',
        description:
          '**Download each scene** before leaving this page. Scenes and their **Undo histories** stay in memory while you switch between them. Character rigs and animation clips are authored in their own editors.',
        targetId: T.sceneExport,
      }),
    ],
  ),
  guide(
    'scene-adding-actor',
    'Adding an Actor',
    'Place independent instances of existing character packages in a scene.',
    scene,
    [
      guideStep({
        id: 'add',
        title: 'Choose a character package',
        description:
          'Open **Scene actors** in the inspector and choose **+ Add Actor**, then a workspace character or permanent character manifest JSON reference. Add the same package twice for two independent Actors.',
        targetId: T.sceneAddActor,
      }),
      guideStep({
        id: 'actors',
        title: 'Select and arrange Actors',
        description:
          'The **Actor list** and timeline track labels select an Actor. **Duplicate Actor** creates another instance. **Send backward** and Bring forward set drawing order. Removing referenced Actors asks before removing their actions.',
        targetId: T.sceneActors,
      }),
    ],
  ),
  guide('scene-positioning', 'Positioning an Actor', 'Set the initial placement, facing, skin and animation.', actor, [
    guideStep({
      id: 'stage',
      title: 'Move on the stage',
      description:
        'While stopped, drag an Actor or its red X and green Y handles. **Escape** cancels a move. Wheel zooms; middle/right/**Alt**-drag pans. **Stop** restores initial placement after a preview.',
      targetId: T.sceneStage,
    }),
    guideStep({
      id: 'properties',
      title: 'Set initial appearance',
      description:
        'Enter **Initial X** and **Initial Y**, then **Apply actor properties**. Facing, Skin and Initial animation configure this instance only. Initial animation starts at time zero and runs until a timeline animation replaces it.',
      targetId: T.sceneActorProperties,
    }),
  ]),
  guide(
    'scene-animation-clips',
    'Creating Animation Clips',
    'Schedule an existing character animation without changing its keys.',
    actor,
    [
      guideStep({
        id: 'type',
        title: 'Choose Play animation',
        description:
          'Choose **Play animation** as the **Action type**. Only the selected Actor’s character animations are available. Author or bake new character animations in **Animation Editor** first.',
        targetId: T.sceneActionType,
      }),
      guideStep({
        id: 'add',
        title: 'Add at the playhead',
        description:
          'Set the playhead before the scene endpoint and choose **Add action**. Open **Action properties** on the new selected clip to choose Animation, **Duration**, Loop and **Speed**. Duration is the finite scene window; Speed affects the source clip clock.',
        targetId: T.sceneAddAction,
      }),
      guideStep({
        id: 'tracks',
        title: 'Understand clip ownership',
        description:
          'Animation clips share one base animation channel per Actor and **cannot overlap**. Different Actors can animate together. Movement uses a **separate channel**, so a walk animation and a move clip may run together. Scene clips use **hard cuts**; authored crossfades are unsupported.',
        targetId: T.sceneTimeline,
      }),
    ],
  ),
  guide(
    'scene-movement',
    'Adding Movement',
    'Combine a move destination with an independently timed walk animation.',
    actor,
    [
      guideStep({
        id: 'type',
        title: 'Choose Move to position',
        description:
          'Choose **Move to position**, set the **playhead**, and **Add action**. In Action properties set Destination X/Y and Duration, then apply. The destination marker appears on the stage for a selected move.',
        targetId: T.sceneActionType,
      }),
      guideStep({
        id: 'timing',
        title: 'Pair movement and animation',
        description:
          'A move travels in a straight line from the Actor’s position at its scheduled start to its destination over **Duration**. It does not choose a walk animation or facing automatically. Add **Play animation** and Change facing actions as needed.',
        targetId: T.sceneTimeline,
      }),
    ],
  ),
  guide(
    'scene-timing',
    'Arranging Action Timing',
    'Edit clips, snapping and grouped Undo without changing character data.',
    action,
    [
      guideStep({
        id: 'properties',
        title: 'Set exact timing',
        description:
          'Start and **Duration** are in seconds. **Apply action properties** validates the whole proposal. Conflicting moves or animations are rejected; adjacent windows are allowed. Wait / hold reserves no Actor channel, and cues are markers.',
        targetId: T.sceneActionProperties,
      }),
      guideStep({
        id: 'timeline',
        title: 'Drag and resize',
        description:
          'Drag a clip to move it; drag its right edge to resize it. **Snap** uses frame positions, clip edges and the **playhead**; **Alt** bypasses snapping. Escape or a canceled drag restores the previous timing. Each finished drag is one Undo step.',
        targetId: T.sceneTimeline,
      }),
      guideStep({
        id: 'zoom',
        title: 'Inspect a long timeline',
        description:
          'Increase **Zoom** to inspect short intervals. Scroll the tracks horizontally to pan. The timeline and inspector dividers resize the desktop workspace without modifying the scene.',
        targetId: T.sceneZoom,
      }),
      guideStep({
        id: 'history',
        title: 'Undo and Redo',
        description:
          '**Undo** and **Redo** restore validated scene snapshots, including timing and destinations. Playback resets to the authored start after an edit; previewing and scrubbing create no history entries.',
        targetId: T.sceneHistory,
      }),
    ],
  ),
  guide('scene-previewing', 'Previewing a Scene', 'Play, pause and seek isolated runtime Actors.', scene, [
    guideStep({
      id: 'play',
      title: 'Use the shared scene clock',
      description:
        '**Play** runs all Actors together. **Pause** freezes the clock, **Restart** begins at zero, and Stop restores initial placement for editing. Speed changes the whole scene clock. Playback waits for referenced character artwork.',
      targetId: T.scenePlayback,
    }),
    guideStep({
      id: 'seek',
      title: 'Scrub in either direction',
      description:
        'Set **Playhead (s)** or drag the ruler. Seeking pauses and reconstructs Actors from initial data, so reaching the same time produces the same supported pose. It suppresses gameplay animation events and scene cues. Resume delivers only future events.',
      targetId: T.sceneTime,
    }),
  ]),
  guide(
    'scene-exporting',
    'Exporting a Scene',
    'Validate dependencies and choose JSON references or a portable scene ZIP.',
    scene,
    [
      guideStep({
        id: 'json',
        title: 'Validate and download JSON',
        description:
          '**Validate Scene** checks character, animation and skin references. **Download scene JSON** saves the scene document with permanent character manifest references. **Open scene JSON** or Paste scene JSON reloads it after checking dependencies. Relative editor imports resolve from this page.',
        targetId: T.sceneExport,
      }),
      guideStep({
        id: 'package',
        title: 'Package for the runtime',
        description:
          '**Download scene package** includes scene.json, referenced character files and scene artwork, retaining layer order and parallax. **SceneLoader.loadPackage** loads the exported ZIP at runtime. The editor imports scene JSON with its image references; **Export Project** includes artwork in the workspace ZIP.',
        targetId: T.scenePackage,
      }),
    ],
  ),
];

const reusableScenesGuide = guide(
  'scene-reusable-choreography',
  'Reusable Choreography and Scene Templates',
  'Save timed action groups, map Actor roles, preview independent copies and reuse scene layouts.',
  scene,
  [
    guideStep({
      id: 'select',
      title: 'Select and save a sequence',
      description:
        'After exiting this tour, **Ctrl/Cmd/Shift-click** timeline actions across Actors, then open **Choreography & templates**. Expand **Save selected actions as choreography**, name the preset and its roles. Times become relative to the first action. Audio, dialogue, camera keys and fades are opt-in; only complete items inside that range are copied.',
      targetId: T.sceneReuse,
    }),
    guideStep({
      id: 'positions',
      title: 'Choose position semantics',
      description:
        '**Relative to role origins** offsets move destinations and point-facing targets from each source origin to its destination origin. Origins default to initial Actor placement; enter the actual start position when earlier movement precedes the sequence. **Absolute** preserves scene-world positions. Root-motion clips remain unchanged and own translation only once.',
      targetId: T.sceneReuse,
    }),
    guideStep({
      id: 'insert',
      title: 'Map, preview and insert',
      description:
        'Choose a preset in **Insert choreography**, assign a different compatible Actor to each role, and enter **Insertion time** and destination origins. **Preview choreography** checks references, rig identity, ownership, duration, camera, fades, dialogue and audio without editing the scene. Different rigs require **Animation Library / Retarget to Another Character** first. **Confirm insertion** creates independent actions in one Undo step.',
      targetId: T.sceneReuse,
    }),
    guideStep({
      id: 'templates',
      title: 'Create an independent scene',
      description:
        'In **Scene templates**, choose whether to include Actors, timeline, audio and dialogue, then **Save Scene as Template**. Choose a template, unique scene ID and name, **Preview template**, then **Create Scene from Template**. Local IDs are remapped; shared assets stay referenced. Editing a copy never changes its template or source scene.',
      targetId: T.sceneReuse,
    }),
    guideStep({
      id: 'independence',
      title: 'Edit the new scene independently',
      description:
        'After **Create Scene from Template**, change placement or timing in the new scene with ordinary **Undo/Redo**. The source scene and template retain their own snapshots. Character rigs, animations, artwork and audio still use shared asset references: editing those assets affects every scene that uses them. Create an independent animation or character copy for private corrections.',
      targetId: T.sceneReuse,
    }),
    guideStep({
      id: 'preview',
      title: 'Check seeking and translation ownership',
      description:
        'After closing the dialog, scrub the inserted sequence forward and backward, then **Play** it. At the same time, Actor poses, positions and camera framing should match. Passive seeking does not deliver cues, animation events or start audio. Root-motion animation actions and move actions must have separate ownership windows. Preview does not save the scene; use **Export Project** or **Download scene package** to keep portable files.',
      targetId: T.scenePlayback,
    }),
    guideStep({
      id: 'save',
      title: 'Keep reusable assets',
      description:
        '**Export Project** and project local drafts retain the library and shared assets. Standalone scenes require **Download library JSON** as well as scene downloads. Library JSON contains references, not character, artwork or audio binaries. This tour does not open dialogs, save presets, insert copies or start playback.',
      targetId: T.sceneReuse,
    }),
  ],
);

/** Focused entries reuse verified workflow steps and their stable React/Phaser anchors. */
function focusedGuide(id: string, title: string, description: string, sourceId: string, stepIds: readonly string[]) {
  const source = [...workflowGuides, reusableScenesGuide].find((entry) => entry.id === sourceId)!;
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
  reusableScenesGuide,
  focusedGuide(
    'scene-reusing-choreography',
    'Reusable Choreography',
    'Select actions, save a preset, assign Actor roles in another scene and preview an independent insertion.',
    'scene-reusable-choreography',
    ['select', 'positions', 'insert', 'preview', 'save'],
  ),
  focusedGuide(
    'scene-templates',
    'Scene Templates',
    'Save a scene layout, create a scene from its template and edit the copy independently.',
    'scene-reusable-choreography',
    ['templates', 'independence', 'preview', 'save'],
  ),
  guide(
    'scene-importing-audio',
    'Importing Audio',
    'Find the project audio library, import and audition audio, then return to this scene.',
    scene,
    [
      guideStep({
        id: 'library',
        title: 'Open the project audio library',
        description:
          '**Audio asset** reads the open project’s audio library. After exiting this tour inside a project, choose **← Project**, then open **Audio** in Project Workspace. In a standalone scene, download its scene package before leaving, then use **Project** in **Views** to create or import a project. The tour stays in this editor and never navigates or opens files.',
        targetId: T.sceneAudioAsset,
      }),
      guideStep({
        id: 'import',
        title: 'Import music, ambience or effects',
        description:
          'In Project Workspace’s **Audio** section, choose **Import category**, then **Import Audio** for a WAV, MP3 or OGG file up to 10 MiB. Import checks file content and browser decoding, and records media duration. The file becomes available in this scene’s **Audio asset** list when you return. The category organizes the library; it does not limit which tracks can use the file.',
        targetId: T.sceneAudioAsset,
      }),
      guideStep({
        id: 'preview',
        title: 'Audition the imported file',
        description:
          'In the project **Audio** library, expand the file’s category and use its row-level **Play / Stop** control and **Preview volume**. This auditions the file independently of scene timing. Stop preview before returning. For a spotlight on those controls, use the **Importing and Managing Audio** guide in the **Project Workspace** category. This scene tour never starts sound.',
        targetId: T.sceneAudioAsset,
      }),
      guideStep({
        id: 'return',
        title: 'Return and place the audio',
        description:
          'Return with **Scene Editor** and open the timeline’s **Audio** tab. Choose **Track category** and **Add audio track**, then choose **Audio asset**, **Audio track** and **Add Audio Clip** at the playhead. Use **Audio Timeline** next for trimming and volume. Importing alone never schedules playback; project export and recovery retain the imported binary.',
        targetId: T.sceneAudioAddClip,
      }),
    ],
  ),
  focusedGuide(
    'scene-audio-timeline-basics',
    'Audio Timeline',
    'Add music, move a clip, adjust its trim and volume, and preview the result.',
    'scene-audio-timeline',
    ['tracks', 'add', 'arrange', 'trim', 'playback', 'fades'],
  ),
  focusedGuide(
    'scene-creating-dialogue',
    'Creating Dialogue',
    'Create a line, choose a speaker, edit text and timing, and preview subtitles.',
    'scene-dialogue-authoring',
    ['add', 'speaker', 'text', 'timing', 'time'],
  ),
  guide(
    'scene-audio-scene-timing',
    'Audio and Scene Timing',
    'Align an effect to animation, preview it, scrub silently and restart a fresh playback pass.',
    scene,
    [
      guideStep({
        id: 'align',
        title: 'Align a sound to animation',
        description:
          'After exiting this tour, select the Actor’s animation and inspect **Start (seconds)** in **Action properties**. Find the sword swing or impact pose by scrubbing. Use that scene time for a sound-effect clip on an audio track. A root-motion attack uses the same scene clock as movement, camera keys, cuts, fades, subtitles and audio.',
        targetId: T.sceneTimeline,
      }),
      guideStep({
        id: 'adjust',
        title: 'Adjust effect timing and source trim',
        description:
          'Select the effect, then open **Audio clip**. Set **Start** to the action’s impact time; **Source offset** skips leading silence in the file. Set **Duration**, volume and fades, then **Apply audio clip properties**. Dragging the body moves scene time; dragging the left edge changes both start and source offset. Shared snapping aligns clip edges; **Alt** bypasses it.',
        targetId: T.sceneAudioTiming,
      }),
      guideStep({
        id: 'preview',
        title: 'Preview the combined scene',
        description:
          'After exiting, choose **Play** at 1× speed to assess the effect with animation, camera and dialogue. **Pause** holds scene time and stops audio. Play resumes only clips active at that time, including their trim and fade progress. If sound is blocked or missing, inspect **Audio** status and retry **Enable audio** after correcting the file or browser permission.',
        targetId: T.scenePlayback,
      }),
      guideStep({
        id: 'scrub',
        title: 'Scrub without triggering effects',
        description:
          '**Playhead (s)** and ruler scrubbing pause playback and remain silent, including repeated backward and forward crossings of the effect. Subtitles, root motion, Actors, camera and fades are sampled at the selected time. Scene cues and animation gameplay events are suppressed. A **cue** is an optional host notification; it does not automatically start an audio clip. Schedule sound on the audio timeline.',
        targetId: T.sceneTime,
      }),
      guideStep({
        id: 'restart',
        title: 'Restart a fresh playback pass',
        description:
          'After exiting, **Restart** replaces old voices and plays from zero. Effects wait for their authored times, and scene cues can dispatch again once crossed in the new pass. Use Restart to judge the full lead-in after timing edits. This tour never plays, seeks, enables audio, edits data or changes Undo/Redo.',
        targetId: T.sceneRestart,
      }),
    ],
  ),
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
