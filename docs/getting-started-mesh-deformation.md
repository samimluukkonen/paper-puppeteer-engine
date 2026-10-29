# Getting Started with Mesh Deformation

[All guides](../README.md#guides)

Keep rigid sprites for parts that move as a single cutout. Use an optional mesh for a sleeve, long hair, a cape or flexible clothing that needs to bend between bones. Meshes follow authored animation; they do not simulate cloth.

## Make a flexible sleeve

1. Open your project, choose a character and open **Rig Editor**. Finish the skeleton, joint positions and artwork alignment in **Bind pose**. The bind pose is the saved rest configuration used to calculate how bones move the mesh. Changing it afterward is guarded; restore the rest transforms or deliberately recreate/rebind the mesh.
2. Select the sleeve slot through **Hierarchy** or **Mesh geometry → Mesh attachment slot**. A bone sprite must first become a slot attachment through **Attachments & skins**. Use a whole PNG/WebP image; atlas frames are unsupported.
3. Choose **Convert to Mesh Attachment**. Four vertices (points with stable IDs) and two triangles cover the image. UV coordinates say which image pixel belongs to each vertex. The original sprite stays available. Converting the default skin selects a new mesh skin variant; remember that skin name.
4. Select an elbow edge with **Mesh edge** or click it on the canvas, then **Subdivide edge**. Add detail where the surface bends. Drag cyan diamonds or use **Mesh vertex → Vertex X/Y**. Subdivision interpolates UVs and weights and preserves existing IDs. Invalid geometry is rejected with feedback.
5. Choose **Paint Bone Weights** in the **Mesh geometry** tab, then **Influence bone**. Painting is a mode within that tab; **Edit Mesh Geometry** switches back to vertex/edge tools. Paint upper-arm influence near the shoulder and forearm influence toward the cuff. Weights specify each bone's share of a vertex's movement. Gray is zero, blue is weak and orange is strong; selected vertices show exact percentages and bone names. Brush radius is in screen pixels. Painting affects existing vertices, not image pixels.
6. Use **Selected bone weight** for precision and **Normalize mesh weights** explicitly when needed. Each vertex totals 100%, with at most four bones. Painting preserves other influence ratios; the influence limit keeps the strongest others. **Reset mesh weights** deliberately assigns the whole mesh to its slot bone. Every stroke is one Undo; Escape cancels a stroke.
7. Expand **Preview deformation** and use a test bend or an existing animation pose. IK positions the skeleton; mesh deformation then uses the final solved bone transforms. It does not replace IK. Adjust weights until the elbow silhouette works through the full bend.
8. Optionally enable **Show mesh diagnostics**. Cyan triangles/handles show the final rendered mesh; yellow marks edges stretched beyond three times rest length; red marks inversion, collapse (at most 1% remaining local area), or nonfinite geometry. Text lists warning counts and influence bone IDs. These are review hints, never automatic repairs or export blockers. Disable diagnostics and leave Mesh/Weights edit mode to judge clean artwork.
9. Use **Undo/Redo** to compare, then **Character package → Download character ZIP**. A rig JSON download preserves geometry but omits artwork and separate skins. Reload the complete package and select the same mesh skin.

The short **Creating a Mesh Attachment** tutorial, detailed **Editing Mesh Geometry** tutorial and **Painting Bone Weights** tutorial highlight real controls in Feature Guide. Navigation only reveals UI; it never converts, paints, subdivides or saves.

## Animate a sword attack

Open **Animation Editor**, create or choose the attack, and choose a preview skin displaying the sleeve. Animate upper arm and forearm with FK/IK first. Add root motion for a forward step when appropriate; root travel, facing and camera movement apply outside the mesh.

For a difficult elbow pose, open **Mesh Deformation**, enable **Edit Mesh Deformation**, choose the mesh and set a correction using bind-space square handles or **Offset X/Y → Set vertex correction key**. Corrections are attachment-local offsets applied before skinning; the main canvas shows the final posed result. Add **Set neutral key** before and after to return to ordinary weights. Scrub forward and backward, play, and compare with diagnostics enabled and disabled. Diagnostics also work with correction editing off, without pausing playback or adding keys. They inspect only the selected mesh visible in the active skin.

The **Animating Mesh Deformation** tutorial covers shape keys, timeline timing, interpolation, Undo/Redo and saving. **Download JSON** keeps animation keys; **Download character ZIP** keeps their rig and artwork dependencies too. Deleting an animated vertex is guarded: restore its stable ID or explicitly remove incompatible tracks in Animation Editor. New subdivision vertices start with neutral correction offsets.

Environment Preview adds a background/camera around the same character. Onion skins sample their own corrections and FK pose before IK and use the current preview placement; bake IK when comparing solved ghost silhouettes. Bone mirroring preserves mesh corrections without retargeting them. Graph Editor does not expose shape channels.

## Put it in a scene and keep it

Open **Scene Editor** from the project, add the character as an Actor and choose its mesh skin. Add the sword-attack animation action, preview root travel and camera movement, then add another instance if needed. Each Actor owns independent geometry while borrowing shared textures. A character can mix rigid sprites and several meshes; characters without meshes need no conversion.

Run **Validate Project**, export the project ZIP, reload it, choose the same skins and compare the attack. Character and scene packages preserve mesh vertices, triangles, UVs, weights, bind snapshots and correction tracks. Local autosave/recovery retains drafts, but a portable ZIP is the durable handoff. Missing images block production export; malformed mesh data is rejected before replacing a valid document. Standalone mesh playback requires WebGL. See [runtime integration](mesh-integration.md) for loading and ownership details.

## Fix common distortions deliberately

| Symptom                              | Check and explicit action                                                                                                                                                         |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sleeve stretches or elbow folds flat | Inspect weights and triangle density around the bend; add subdivisions, blend influences, or author a small corrective key. Extreme linear-blend bends can still collapse.        |
| Texture appears torn or distorted    | Inspect UV continuity and stretched triangles. Moving vertices retains UVs; subdivision averages them. Replace artwork only with identical dimensions/pivot or recreate the mesh. |
| Mesh is offset from bones            | Restore the saved bind configuration and check the selected slot/skin. Actor/camera movement should never enter bind data.                                                        |
| Triangles invert                     | Reduce extreme bends or offsets, adjust weights and preview both sides of the motion. Warnings do not repair your art.                                                            |
| Wrong layer, facing or opacity       | Check slot depth, preview facing and slot/bone opacity. Meshes use the same ordering and presentation as rigid attachments.                                                       |
| Mesh disappears after reload         | Select the saved mesh skin and confirm referenced artwork exists. Canvas cannot render meshes.                                                                                    |

Diagnostics compare attachment-local rendered geometry against its rest vertices, excluding global facing/camera/Actor placement. Nonuniform posed mount scaling can affect reported stretch ratios; warnings are not a physical strain calculation. They do not detect every overlap, UV seam or artistic problem. Use textured preview as the final visual check.

## Keep the workload practical

Use the fewest vertices that hold the silhouette, especially when many Actors or onion skins are visible. Each mesh supports up to 1,024 vertices and 2,048 triangles, with up to four influences per vertex. Start small and subdivide locally. Disable diagnostics during ordinary playback. Geometry buffers are reused; skinning runs on the CPU after FK/IK. See the [v1.4 readiness report](mesh-production-readiness.md) for measured workloads and verification boundaries.

Deferred: cloth simulation, soft-body physics, mesh collision, automatic weight generation, advanced mesh retargeting, multi-resolution meshes, GPU-only optimization and complex shape-key libraries. These are outside v1.4.
