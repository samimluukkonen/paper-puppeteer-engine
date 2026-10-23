# Creating Your First Character

[All guides](../README.md#guides) · [Rig building](rig-building.md) · [Animation Editor](animation-editor.md)

Create a character entirely in the editor using your own artwork. No existing character files or hand-written JSON are needed. Keep the browser tab open while working: imported images live in memory. Download a complete character ZIP before refreshing or leaving.

## Start and build a skeleton

1. Open **Rig Editor** and click **+ New Character** in the header. This also works if the previously selected character failed to load.
2. Enter **Character name**, such as `Forest Guardian`, and check the suggested **Character ID**, such as `forest-guardian`. IDs use lowercase letters, numbers and single hyphens and must be unique in this browser tab. Click **Create Character**. Your workspace starts with one `root` bone and an empty `default` skin.
3. Select `root` in **Hierarchy**. Under **Build skeleton**, enter `body` in **New bone ID** and click **+ Add Bone**. Select `body`, add `head`, then select `body` again to add other branches. Each new bone uses the selected bone as its parent. **Bone ID / name** and **Rename bone** change IDs; do this before creating animation tracks. The required root cannot be deleted.
4. Use **Joint Editing** to drag joint markers in the canvas, or edit the selected bone's local position, rotation, scale and length in the inspector. Finish numeric inputs with Tab. Position the head above its parent body. Parent length constrains direct child distance. Rotate a parent in the bind pose to check that children follow. Rig **Undo/Redo** restores these edits.

## Add and align artwork

5. Prepare separate transparent PNG or static WebP images for your body parts. Expand **Artwork import & replacement** and use **Import new artwork** for each file. Import adds real image bytes to the character library; it does not automatically create rig references.
6. Select `head`, enter `head-visual` in **New slot ID**, and click **+ Add Slot**. In **Attachments & skins**, enter `head-art` in **Attachment ID**, choose the imported **Attachment artwork**, and click **Create attachment**. Select the slot and choose `head-art` under **Assigned attachment**. Repeat for other parts. Bones describe motion, slots place artwork on bones, and attachments describe images and alignment.
7. Select the slot in **Hierarchy** to align its attachment in the inspector. Adjust normalized origins (0–1), pixel origins or artwork offsets so the image rotates around its intended joint. Slot transforms position the slot itself; slot depth controls draw order. Check facing and visibility while aligning.
8. Keep **Active skin** set to `default` while assigning parts. New Character already created this skin; your assignments build its appearance. **Clear assignment** explicitly hides a slot; **Remove override** removes its mapping. Extra skins can inherit, replace or hide default pieces. The default skin exports to `skins/default.json`; attachment definitions remain in `rig.json`.

## Create the first animation

9. Click the header's **Animation Editor** tab. Your character, unsaved rig, skins and imported images stay available. With no clips, the editor displays **No animation**. Click **+ New Animation**, enter `idle` in **Animation name / ID**, keep **Duration (seconds)** at `1`, choose **Animation FPS** and **Loop enabled**, then click **Create Animation**. The clip starts empty in the rig's bind pose.

   Expand the bone list and select `head`. Set the timeline time input to `0`, enter `0` in **Rotation (°)**, and click **Set Rotation (°) key**. At `0.5` seconds set `30` degrees and click the same key button. At `1` second set `0` again. Inputs use degrees and seconds; exported keys use radians and milliseconds. Press **Play**, then pause to edit. **Clip settings** offers smooth or stepped playback. Animation **Undo/Redo** affects keys independently of rig history. The animation download button saves `idle.json` separately. The character ZIP includes every session clip, including inactive and unsaved clips.

## Export and load

10. Expand **Character package** in either editor. Readiness guidance identifies root-only skeletons, missing artwork, missing animations and unassigned default slots. These can be intentional drafts and remain exportable when structurally valid. **Ready for export validation** means the content checklist is complete; download still validates the actual files.

    Finish inputs and apply or cancel artwork proposals, then click **Download character ZIP**. Fix any reported missing bone, attachment, skin, texture or invalid path and retry. Export errors retain your work. Save `forest-guardian.zip` and extract it into your application's served `characters/forest-guardian/` directory. ZIP entries start at `character.json`:

    ```text
    character.json
    rig.json
    skins/default.json
    animations/idle.json
    images/your-artwork.png
    ```

    These are ordinary version-1 files and your actual image bytes. No demo artwork or temporary preview URLs are required. **Reload exported package** opens the exact exported snapshot through CharacterLoader and Puppet. **Import ZIP for runtime preview** checks a saved editor ZIP. Play `idle`, check skins and facing, then **Close preview** to resume authoring. ZIP import does not restore an editable project.

11. In another Phaser application, install the engine and load the extracted package inside your scene:

    ```ts
    import { loadSceneCharacter, Puppet } from 'paper-puppeteer-engine/runtime';

    // Inside your Phaser.Scene subclass:
    async create() {
      const definition = await loadSceneCharacter(
        this,
        '/characters/forest-guardian/character.json',
        { allowWebp: true },
      );
      if (!definition) return;
      const puppet = new Puppet(this, { definition, x: 380, y: 380 });
      puppet.play('idle');
    }
    ```

    Serve all extracted files over HTTP, preserving relative paths. `loadSceneCharacter` uses the standard `CharacterLoader` and loads textures before Puppet creation. Puppet owns its scene update/shutdown listeners; the host scene owns textures. See [runtime integration](runtime-integration.md) for the full consumer and cleanup.

## Keep your work

Editor tabs retain documents, history, image assets and skin assignments. Individual JSON exports and complete ZIP exports have independent checkpoints. Downloading a ZIP does not clear individual document dirty states or overwrite source files, so a navigation warning can remain after a package download.

Complete [local autosave](local-autosave.md) snapshots retain committed rigs, animations and applied image bytes after **Local draft saved**. After refresh, choose **Recover Draft** to open a detached project working copy. Undo/Redo history restarts; edits since the last completed save can be lost. Keep a complete character/project ZIP for a disk copy before closing the tab. Root-only rigs, artwork-free rigs, animation-free rigs and intentionally empty slots remain valid runtime packages; broken hierarchy, missing images and unknown references must be repaired before export.
