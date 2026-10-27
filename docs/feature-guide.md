# Using Feature Guide

Open **Feature Guide** in the shared header. Choose **Project Workspace**, **Rig Editor**, **Animation Editor**, or **Scene Editor**, find the feature you want to learn, and select **Start Guide**. Rig and Animation tours can switch within their shared character workspace. Project and Scene tours run in their respective workspaces; use the Views links to move between workspaces after downloading unsaved work.

Guides appear in alphabetical order within each editor category. Use **Search guides** to filter titles and descriptions in the selected category; searches ignore capitalization and match all entered words. The search stays in place when switching categories. Choose **Clear search** to show the full category again.

**Project Workspace** opens the same catalog. Choose an editor category and a character or scene, then start the guide. The selected editor opens and checks its live requirements. Create assets first with **+ New Character** or **+ New Scene** when the project is empty. The standalone character-creation tour is unavailable within project editors; use Project Workspace to create characters.

Choose the **Project Workspace** category for **Importing and Managing Audio**, a seven-step Explain tour of WAV/MP3/OGG import, Music/Ambience/Sound effects/Voice categories, Play/Stop and preview volume, rename/removal, project Undo/Redo and portable saving. Create or import a project first; no character, scene or audio asset is required. The tour reveals Audio and the Project controls without importing files, changing assets or starting sound. See [Audio assets](audio-assets.md).

Scene Editor offers Explain tours, including creating a scene, Actors, animation clips, root motion, movement, timing, cameras, artwork and export. Prerequisites track the open scene, selected Actor and selected action. Tours reveal existing controls without editing data or starting playback. See [Making Your First Scene](making-your-first-scene.md).

For an integrated scene, use **Importing Audio**, **Audio Timeline**, **Creating Dialogue**, and **Audio and Scene Timing** in the Scene category. These focused tours need only an open scene, work with empty timelines, and preserve selection, history and preview state. Importing Audio explains the round trip through the project library; **Project Workspace → Importing and Managing Audio** spotlights the actual import and audition controls. See [Creating an Audiovisual Scene](creating-an-audiovisual-scene.md).

Choose **Scene Editor → Audio Playback & Synchronization** for a nine-step tour of browser audio unlock/retry, Play/Pause, silent scrubbing, playback after seeking, speed and pitch, preview mute, Restart/Stop and portable saving. It needs only an open scene and works without audio or Actors. It reveals controls without enabling audio, starting sound or changing playhead, speed, mute, selection, camera preview or history. Use **Visual Audio Timeline** for clip placement, trims, volume, loops and fades. See [Scene audio playback](scene-audio-playback.md).

Animation Editor offers **Environment Preview**, a ten-step Explain tour of static image import/selection, world transforms, shared ground alignment, fixed/follow cameras, playback, seeking and local recovery/project saving. It works with an empty selected animation and no background image. The tour reveals controls without changing preview settings or authored motion. See [Animation Environment Preview](animation-environment-preview.md).

**Preview Displacement** is a seven-step Animation tour of preview-only opt-in, time/X/Y points, segment interpolation, synchronized playback, the spatial trajectory and reset/saving. It supports an empty selected clip without points, artwork or IK. The tour preserves settings, authored motion, playhead and history. See [Animation preview displacement](motion-preview.md).

**Creating Root Motion** and **Root Motion vs Pelvis Animation** explain independent root X/Y tracks, skeletal posing, fixed-world preview and Graph Editor curves. **Using Root Motion** in Scene Editor explains Movement source, conflicts, looping and final Actor position. These tours only reveal controls. See the [root-motion workflow](root-motion-hardening.md).

The bright outline identifies the real control or panel. The dimmed area is protected from accidental interaction. **Explain** steps describe controls without changing your project. **Back**, **Next**, and **Finish** move through explanations; **Exit** or **Escape** closes the guide. Inspector sections start collapsed and open as their controls are explained.

Some steps offer **Try It**. Choose it to enable only the highlighted real control. You can use the mouse or Tab/Shift+Tab and Enter/Space. The guide’s navigation remains available. Choose **Explain** to stop practicing. Practice is optional: **Next** continues without requiring completion, and detected success never advances automatically.

Practice currently supports bone selection and the X key button in **Create Your First Keyframe**, plus the checkbox in **Onion Skinning**. Selection and onion skinning change only editor selection or preview preferences. Setting a key changes your **real animation** using the current value and playhead time; the guide says so before you opt in. It uses the normal validation, dirty state, and Undo/Redo. Exit the guide to use Undo/Redo or other controls. No demo content is created for you.

Use **Restart guide** to return to step one, or **Choose another guide** to return to the catalog. Restarting or exiting does not undo practice edits. Guides do not save completion progress.

Unavailable guides explain what is missing, such as a loaded character, valid rig, selected animation, authored keys, or selected IK target. **Show prerequisite** points to a relevant tutorial when one exists. You may need to exit the explanation and perform its task before the original guide becomes available. Missing or hidden targets show **Skip** and recovery guidance; you can also go Back, restart, choose another guide, or exit without refreshing.
