import { GUIDE_TARGETS as targets } from './anchors.js';
import type { GuideDefinition, GuidePrerequisite, GuideStep } from './types.js';

const character: readonly GuidePrerequisite[] = [
  { capability: 'character', reason: 'Load or create a character first.', guideId: 'rig-new-character' },
];
const validRig: readonly GuidePrerequisite[] = [
  ...character,
  { capability: 'valid-rig', reason: 'A valid rig is needed to inspect joint positions.' },
];
const step = (id: string, title: string, description: string, targetId: string): GuideStep => ({
  id,
  title,
  description,
  targetId,
  preparation: 'reveal-target',
  mode: 'explain',
});

/** Instructions describe existing controls. Preparation can only reveal UI; it never performs these tasks. */
export const rigGuides: readonly GuideDefinition[] = [
  {
    id: 'rig-new-character',
    prerequisites: [
      {
        capability: 'tool:new-character',
        reason: 'Use + New Character in Project Workspace. This tour covers standalone Rig Editor controls.',
      },
    ],
    title: 'Creating a New Character',
    description: 'Start a root-only character draft and learn how to keep it.',
    editor: 'rig',
    category: 'rigging',
    steps: [
      step(
        'create',
        'Start a character draft',
        'After exiting this tour, choose **+ New Character**. Enter a Character name and a unique lowercase, hyphenated **Character ID**, then choose **Create Character**. Confirm any unsaved-work prompt only when ready to leave your current character.',
        targets.rigNewCharacter,
      ),
      step(
        'character',
        'Recognize your new character',
        'The **Character menu** identifies the current character. A new draft opens in the Rig Editor with one **root bone**, an empty **default skin**, and no artwork or animations. Drafts stay in this browser tab.',
        targets.rigCharacter,
      ),
      step(
        'keep',
        'Keep the complete character',
        'Open **Character package** and choose **Download character ZIP** to keep your rig, skins, images and animations. Save and extract the ZIP yourself; creating a draft does not save files to your project.',
        targets.rigPackage,
      ),
    ],
  },
  {
    id: 'rig-creating-bones',
    title: 'Creating Bones',
    description: 'Build a parent-child skeleton with the hierarchy and Add Bone.',
    editor: 'rig',
    category: 'rigging',
    prerequisites: character,
    steps: [
      step(
        'hierarchy',
        'Choose a parent bone',
        '**Bones** and joints form the skeleton. Select a bone in **Hierarchy** to make it the parent of your next bone. With no bone selected, **Add Bone** uses the root as parent.',
        targets.rigHierarchy,
      ),
      step(
        'name',
        'Name the new bone',
        'Enter a unique **New bone ID** in **Build skeleton**. The Parent hint shows where the new bone will be attached. Use **Bind pose** when building the skeleton.',
        targets.rigBuildSkeleton,
      ),
      step(
        'add',
        'Add the child bone',
        'Choose **+ Add Bone** after entering the ID. The new child becomes selected. Repeat with another selected parent to build branches; this tour does not add bones for you.',
        targets.rigAddBone,
      ),
      step(
        'position',
        'Position the joint',
        'Choose **Joint Editing** in Edit, then drag the new **joint marker** on the canvas. Use **Selection details** for numeric x and y values relative to its parent.',
        targets.rigEditMode,
      ),
      step(
        'review',
        'Review the skeleton',
        'Review the **joint positions** in the canvas. Use **Undo** or **Redo** to revisit rig edits, then **Download character ZIP** to keep the complete character.',
        targets.rigCanvas,
      ),
    ],
  },
  {
    id: 'rig-joint-editing',
    title: 'Editing Joint Positions',
    description: 'Move skeleton joints on the canvas and enter precise local coordinates.',
    editor: 'rig',
    category: 'rigging',
    prerequisites: validRig,
    steps: [
      step(
        'hierarchy',
        'Choose a bone',
        'Select the bone you want to move in **Hierarchy**. Its joint belongs to the skeleton; moving it also moves its children and attached artwork.',
        targets.rigHierarchy,
      ),
      step(
        'tool',
        'Choose Joint Editing',
        'Set Edit to **Joint Editing**. This moves the skeleton joint. **Artwork Offset Editing** and **Sprite Origin Editing** adjust artwork separately.',
        targets.rigEditMode,
      ),
      step(
        'bind-pose',
        'Use Bind pose',
        'Choose **Bind pose** before editing joints. Selecting an animation pose previews bone tracks and disables joint and slot transform edits.',
        targets.rigPreviewPose,
      ),
      step(
        'preview',
        'Drag the joint marker',
        'On the canvas, drag the bone’s **joint marker** to its new position. **Grid** controls translation snapping. **Escape** cancels a drag; wheel zooms and middle drag pans.',
        targets.rigCanvas,
      ),
      step(
        'joint-properties',
        'Enter precise joint coordinates',
        '**Selection details** shows the selected bone’s bind transform. Edit **x and y** in its parent’s coordinates. These are joint positions, separate from **spriteOffsetX and spriteOffsetY**.',
        targets.rigSelection,
      ),
      step(
        'history',
        'Review or undo the edit',
        '**Undo** and **Redo** revisit rig changes. When satisfied, use **Download rig.json** for the rig or **Download character ZIP** in Character package for the whole character.',
        targets.rigHistory,
      ),
    ],
  },
  {
    id: 'rig-importing-artwork',
    title: 'Importing Artwork',
    description: 'Import PNG/WebP images, choose assets, and understand replacements.',
    editor: 'rig',
    category: 'artwork',
    prerequisites: character,
    steps: [
      step(
        'import',
        'Add an image to the library',
        'Use **Import new artwork** to choose a **PNG or WebP**. This adds an image asset to the session library; it does not create a bone, slot or attachment.',
        targets.rigImportArtwork,
      ),
      step(
        'asset',
        'Choose an artwork asset',
        '**Artwork asset** lists imported and existing images by texture key and filename. Select an image to inspect its size, preview and current rig references.',
        targets.rigArtworkAsset,
      ),
      step(
        'replace',
        'Understand image replacement',
        '**Import sprite** replaces the selected image. Choose **Replacement scope** first, then an Alignment policy if offered. **Preview Replacement** and **Apply Replacement** are explicit actions; Cancel discards the proposal. If any affected attachment is a mesh, keep its original **image dimensions** and pivot, including inactive skins. Different proportions require deliberate mesh recreation; rigid alignment policies cannot remap mesh UVs or contact markers.',
        targets.rigReplaceArtwork,
      ),
      step(
        'attach',
        'Make the artwork visible',
        'For a new image, use **Create sprite attachment**: enter an Attachment ID, choose Attachment artwork, then **Create attachment**. Select an **Attachment slot** and assign it in the **active skin** to display it.',
        targets.rigCreateAttachment,
      ),
      step(
        'keep',
        'Save images with the character',
        'Applied images stay in memory. **Download character ZIP** includes images; **Download rig.json** does not. Artwork Undo and Redo are separate from rig Undo and Redo.',
        targets.rigPackage,
      ),
    ],
  },
  {
    id: 'rig-aligning-sprites',
    title: 'Aligning Sprites',
    description: 'Place artwork relative to joints and adjust its pivot without moving the skeleton.',
    editor: 'rig',
    category: 'artwork',
    prerequisites: [
      ...character,
      {
        capability: 'rig-artwork',
        guideId: 'rig-importing-artwork',
        reason:
          'Add artwork to a bone or create a sprite attachment first. Use Importing Artwork and Slots and Attachments.',
      },
    ],
    steps: [
      step(
        'selection',
        'Select artwork to align',
        'Select a bone with a sprite or a slot with an assigned attachment in **Hierarchy**. An empty bone or slot has no sprite to align. Use **Bind pose** for a clear joint reference.',
        targets.rigHierarchy,
      ),
      step(
        'offset',
        'Move artwork relative to its joint',
        'Choose **Artwork Offset Editing** in Edit, then drag artwork or its pivot on the canvas. **Sprite offset** positions the image relative to its bone or slot without moving the skeleton.',
        targets.rigEditMode,
      ),
      step(
        'origin',
        'Adjust the artwork pivot',
        'Choose **Sprite Origin Editing** to drag across artwork. **Sprite origin** is the image pivot. Changing it keeps the offset and joint fixed, so the artwork shifts around the pivot.',
        targets.rigCanvas,
      ),
      step(
        'precision',
        'Use numeric artwork values',
        '**Selection details** provides **spriteOffsetX/Y** and normalized **originX/Y**. With a loaded image it also shows Origin X/Y in pixels, image dimensions and the world joint reference. Origins are fractions of the image dimensions.',
        targets.rigSelection,
      ),
      step(
        'review',
        'Review and undo alignment',
        'Use **Reset sprite offset**, **Reset origin** or **Center sprite origin** in Selection details only when wanted. Undo and Redo revisit rig alignment edits; image replacements have their own artwork history.',
        targets.rigHistory,
      ),
    ],
  },
  {
    id: 'rig-creating-mesh',
    title: 'Creating a Mesh Attachment',
    description: 'Turn a sleeve sprite into editable geometry and save the complete character.',
    editor: 'rig',
    category: 'artwork',
    prerequisites: [
      ...validRig,
      {
        capability: 'rig-mesh-artwork',
        reason: 'Create a slot and whole-image sprite attachment first.',
        guideId: 'rig-slots-attachments',
      },
    ],
    steps: [
      step(
        'select',
        'Select the sleeve sprite',
        'After exiting this tour, choose **Mesh attachment slot** for your sleeve. Assign whole-image artwork through **Attachments & skins** first. Finish joint and artwork alignment in **Bind pose** before conversion.',
        targets.rigMeshSlot,
      ),
      step(
        'convert',
        'Convert to a mesh',
        'Choose **Convert to Mesh Attachment** explicitly. It makes four vertices and two triangles and retains your rigid source. Converting the default skin creates a separate **mesh skin**; keep its name for animation and scenes.',
        targets.rigMeshWorkflow,
      ),
      step(
        'subdivide',
        'Add elbow geometry',
        'Choose the diagonal in **Mesh edge**, then **Subdivide edge**. Repeat around the elbow where bending needs more detail. Existing vertex IDs and UVs survive. This tour never subdivides for you.',
        targets.rigMeshTools,
      ),
      step(
        'edit',
        'Shape the sleeve',
        'Use **Edit Mesh Geometry**, drag cyan vertex diamonds, or select **Mesh vertex** and enter **Vertex X/Y**. Invalid topology is rejected. Use **Undo/Redo** to compare. Next, follow **Painting Bone Weights** to blend upper arm and forearm influences.',
        targets.rigMeshTools,
      ),
      step(
        'save',
        'Keep the whole character',
        'Choose **Download character ZIP** to save geometry, weights, artwork, skins and animations together. Reload and choose the same mesh skin. **Download rig.json** alone omits images and separate skins. Guide navigation never saves or marks data clean.',
        targets.rigPackage,
      ),
    ],
  },
  {
    id: 'rig-mesh-geometry',
    title: 'Editing Mesh Geometry',
    description: 'Convert sprite attachments and edit textured vertices with safe topology tools.',
    editor: 'rig',
    category: 'artwork',
    prerequisites: [
      ...character,
      { capability: 'valid-rig', reason: 'Resolve rig validation errors before editing mesh geometry.' },
      {
        capability: 'rig-mesh-artwork',
        guideId: 'rig-slots-attachments',
        reason:
          'Create an artwork slot and a whole-image sprite attachment first. Use Importing Artwork and Slots and Attachments. Existing mesh attachments also support this guide.',
      },
    ],
    steps: [
      step(
        'slot',
        'Choose the artwork slot',
        'After exiting this tour, choose **Mesh attachment slot** or select the artwork slot in **Hierarchy**. It must have an assigned whole-image sprite or mesh. Use **Attachments & skins** to assign artwork to an empty slot. Bone sprites and atlas frames cannot be converted here.',
        targets.rigMeshSlot,
      ),
      step(
        'convert',
        'Convert while keeping the original',
        '**Convert to Mesh Attachment** creates a rectangle with four vertices and two triangles, preserving the image, placement and rigid source definition. Converting the **default skin** creates and selects a separate mesh skin variant; other skin assignments stay intact. A nondefault skin changes only its selected slot mapping. If the slot already selects a mesh, this control reads **Edit Mesh Geometry** instead.',
        targets.rigMeshWorkflow,
      ),
      step(
        'mode',
        'Recognize mesh handles',
        'Choose **Edit Mesh Geometry** in Edit or in the Mesh geometry inspector. **Cyan diamonds** mark vertices and lines show triangle edges. They differ from round bone joints, square slot markers, sprite origins, green contact markers and IK targets. Drag a diamond to edit the textured surface. Wheel zooms; middle drag pans.',
        targets.rigCanvas,
      ),
      step(
        'vertices',
        'Place vertices precisely',
        'With a mesh selected, choose **Mesh vertex** and edit **Vertex X/Y** in the Mesh geometry inspector. Values are attachment-local coordinates; moving a vertex retains its **UV** texture coordinates. Enter or blur commits; Escape in the field cancels its draft. Arrow keys nudge the selected diamond and Shift increases the step. Geometry belongs to the rig attachment and creates no animation keys.',
        targets.rigMeshTools,
      ),
      step(
        'subdivide',
        'Add a vertex by subdividing an edge',
        'Click an edge on the canvas or choose **Mesh edge**, then **Subdivide edge**. The new midpoint receives a stable vertex ID and averaged endpoint **UVs**. Every adjacent triangle splits consistently, including both sides of a shared edge. Existing UVs stay unchanged, so the texture is not remapped across the mesh.',
        targets.rigMeshTools,
      ),
      step(
        'topology',
        'Inspect and safely remove geometry',
        '**Triangle inspection** lists the vertex IDs for each triangle. **Delete vertex** retriangulates a supported connected triangle fan; a corner without a valid replacement is rejected. Invalid moves or topology edits leave the last valid geometry intact and show feedback here. **Show mesh diagnostics** overlays final triangles and vertices: yellow marks >3× edge stretch, red marks collapse or inversion. Warnings never repair geometry. Disable diagnostics to review the artwork. Meshes require **whole images** and WebGL; finish rest transforms before conversion because the saved bind configuration is protected. Edits and Undo/Redo cannot newly invalidate live deformation tracks: keep animated vertex IDs or explicitly remove incompatible tracks in Animation Editor first.',
        targets.rigMeshTools,
      ),
      step(
        'history',
        'Review, undo or cancel an edit',
        'One completed **vertex drag** is one rig **Undo** action. **Escape** during a drag, window blur or leaving the editor cancels it. Numeric commits, conversion, subdivision and deletion each use rig history. **Redo** restores the edit; the tour itself changes no artwork, skin selection or history.',
        targets.rigHistory,
      ),
      step(
        'save',
        'Keep and reload the mesh skin',
        '**Mesh skin** chooses the appearance being edited. Keep the new variant name: after exporting and reloading, select that skin again to see the mesh; the original default skin retains rigid artwork. **Download rig.json** keeps geometry, triangles and UVs. **Download character ZIP** also keeps images, skins and animations. Image binaries remain unchanged by geometry editing.',
        targets.rigMeshSkin,
      ),
    ],
  },
  {
    id: 'rig-weight-painting',
    title: 'Painting Bone Weights',
    description: 'Blend a mesh between bones with brushes, precise weights and a deformation preview.',
    editor: 'rig',
    category: 'artwork',
    prerequisites: [
      ...character,
      { capability: 'valid-rig', reason: 'Resolve rig validation errors before painting bone weights.' },
      {
        capability: 'tool:rig-weight-paint',
        guideId: 'rig-mesh-geometry',
        reason:
          'Select a mesh slot and choose Paint Bone Weights in Mesh geometry first. Use Editing Mesh Geometry to convert artwork and add subdivisions.',
      },
    ],
    steps: [
      step(
        'mesh',
        'Recognize the selected mesh',
        '**Paint Bone Weights** edits the mesh named below this button. Choose **Mesh attachment slot** and **Mesh skin** to work on another mesh. Finish the skeleton and artwork alignment before conversion; use **Edit Mesh Geometry** to add subdivisions around an elbow before painting. This tour only reveals controls; it does not paint or change your selection.',
        targets.rigWeightMode,
      ),
      step(
        'bone',
        'Choose an influence bone and read its weights',
        '**Influence bone** follows the rig hierarchy and leaves the mesh selected. Choose upper arm to paint the shoulder, then forearm to blend toward the cuff. Painting adds the chosen bone automatically. In the canvas, **gray** diamonds have zero selected-bone weight, **blue** is weak and **orange** is strong. A **gold outline** and percentage identify the selected vertex. The overlay is never exported as artwork.',
        targets.rigWeightBone,
      ),
      step(
        'brush',
        'Paint or erase with the brush',
        'After exiting the tour, use **Paint** to add influence or **Erase** to reduce it. **Brush radius** is measured in screen pixels; **Brush strength** is the maximum 0–1 weight change in one stroke, fading linearly toward the edge. Drag over existing vertices; painting creates no vertices. Repeated stationary events do not add strength: release and paint again to build influence. Wheel zooms and middle drag pans.',
        targets.rigWeightBrush,
      ),
      step(
        'numeric',
        'Enter precise vertex weights',
        'Choose **Weight vertex** or click a diamond, then edit **Selected bone weight** from 0 to 1. The list shows every influence as a percentage. **Enter** or blur commits the value; Escape in the field cancels its draft. Other bones share the remaining weight in their existing proportions. The same rules apply to the brush.',
        targets.rigWeightVertex,
      ),
      step(
        'limits',
        'Understand normalization and influence limits',
        '**Maximum influences per edited vertex** chooses one to four bones for future brush or numeric edits. Changing this limit preserves existing vertices. At the limit, keep the edited bone and the strongest others; equal weights use bone ID order. Feedback reports dropped influences. With a limit of **1**, any positive paint assigns that bone fully. Erasing the last influence uses the named **fallback bone**, so weights never total zero.',
        targets.rigWeightLimit,
      ),
      step(
        'normalize',
        'Normalize or reset deliberately',
        '**Normalize mesh weights** makes each vertex total 100% while preserving its influences. **Reset mesh weights** assigns every vertex of this mesh to its slot bone; Undo restores painted values. These commands affect the named mesh, including every slot or skin that shares that mesh definition. They do not change other mesh attachments.',
        targets.rigWeightActions,
      ),
      step(
        'preview',
        'Test the elbow bend without creating keys',
        'In **Preview deformation**, choose a **Test bone** and commit **Test bend (degrees)** to see the painted blend. **Preview test bend** toggles it. **Weight preview pose** and time sample an existing animation; the test bend adds rotation over that pose. The preview uses runtime FK/IK and skinning and creates **no animation keys** or authored rest changes. You can paint while posed and compare against the original rigid skin.',
        targets.rigWeightPreview,
      ),
      step(
        'history',
        'Undo a complete stroke or cancel it',
        'One brush stroke is one rig **Undo** transaction. **Redo** restores the complete stroke. Escape during a stroke, window blur or leaving the editor cancels it. Numeric edits, normalization and reset each have their own history entry. Brush settings and test poses are view state. Finishing or exiting this tour preserves your weights, settings, selection and history.',
        targets.rigHistory,
      ),
      step(
        'save',
        'Keep weights through topology edits and reload',
        'Return to **Edit Mesh Geometry** to subdivide edges: new vertices average endpoint weights and retain the strongest four, while existing weights stay painted. Deleting a vertex removes only its record. Bone removal reports mesh dependencies; use **Reassign mesh dependencies** in Hierarchy for explicit reassignment and rebind after resolving other references. Export **rig.json** or **Download character ZIP**, then reload and select the same **Mesh skin** to retain painted weights.',
        targets.rigMeshSkin,
      ),
    ],
  },
  {
    id: 'rig-slots-attachments',
    title: 'Slots and Attachments',
    description: 'Connect an image attachment to a bone through a slot and skin assignment.',
    editor: 'rig',
    category: 'artwork',
    prerequisites: character,
    steps: [
      step(
        'bone',
        'Choose the attachment location',
        'A slot is an attachment location on a bone. Select its parent bone in **Hierarchy**. If a slot is selected instead, a new slot uses that slot’s bone.',
        targets.rigHierarchy,
      ),
      step(
        'slot',
        'Create a slot',
        'Enter a unique **New slot ID** in **Build skeleton**, then choose **+ Add Slot**. The new empty slot becomes selected. A slot does not display an image until an attachment is assigned.',
        targets.rigAddSlot,
      ),
      step(
        'attachment',
        'Create a sprite attachment',
        'Import an image first if needed. Enter a unique **Attachment ID**, choose **Attachment artwork**, and choose **Create attachment**. Leave Frame empty for a whole image; atlas artwork can use a named or numeric frame.',
        targets.rigCreateAttachment,
      ),
      step(
        'assignment',
        'Assign artwork to the slot',
        'Choose **Attachment slot**, then choose **Assigned attachment** below it. The assignment belongs to **Active skin**. Clear assignment hides it in that skin; Remove override returns to inherited artwork.',
        targets.rigAttachmentSlot,
      ),
      step(
        'transform',
        'Position the slot or the artwork',
        'Use **Slot Transform Editing** to move the slot relative to its bone in **Bind pose**. Use **Artwork Offset Editing** to move the assigned sprite relative to the slot. Selection details provides numeric values for both.',
        targets.rigEditMode,
      ),
    ],
  },
  {
    id: 'rig-skins',
    title: 'Creating and Changing Skins',
    description: 'Create alternate appearances and map attachments to slots.',
    editor: 'rig',
    category: 'artwork',
    prerequisites: character,
    steps: [
      step(
        'active',
        'Choose an appearance',
        '**Active skin** chooses the appearance being previewed and edited. A skin maps slots to attachments; unmapped slots fall back to the **default skin**. It does not change bone or **joint positions**.',
        targets.rigActiveSkin,
      ),
      step(
        'create',
        'Create a skin',
        'Enter a unique **Skin name** and choose **Create skin** to add an empty appearance mapping and select it. **Rename skin** is available for embedded non-default skins; standalone and default skin names are protected.',
        targets.rigSkinAuthoring,
      ),
      step(
        'assign',
        'Set this skin’s artwork',
        'Choose **Attachment slot**, then **Assigned attachment** to override that slot in the active skin. Create a slot and attachment first if the character has none. **Clear assignment** explicitly hides the slot; Remove override restores fallback.',
        targets.rigAttachmentSlot,
      ),
      step(
        'compare',
        'Compare appearances',
        'Switch **Active skin** to compare appearances. Editing an attachment’s image or alignment affects every skin using that attachment. Use separate attachments for independent artwork.',
        targets.rigActiveSkin,
      ),
      step(
        'save',
        'Keep skin changes',
        '**Download skin JSON** saves the active skin separately. Embedded skins also belong to rig JSON; standalone skins need their own files. **Download character ZIP** keeps all skin files together with the character.',
        targets.rigSkinAuthoring,
      ),
    ],
  },
  {
    id: 'rig-ik-constraints',
    title: 'IK Constraints',
    description: 'Create connected chains, edit targets and bend direction, and understand solver feedback.',
    editor: 'rig',
    category: 'ik',
    prerequisites: [
      ...character,
      {
        capability: 'ik-constraints',
        reason: 'Create a chain of three connected bones, then use + Add IK Constraint in IK constraints first.',
      },
    ],
    steps: [
      step(
        'create',
        'Create a connected IK chain',
        'To add another constraint, choose **+ Add IK Constraint**. Choose three directly connected bones: **Start bone**, **Middle bone** and **End bone**. Enter a unique Constraint name, review the settings, then choose Create IK Constraint. Invalid settings show an error and leave the rig unchanged.',
        targets.rigAddIK,
      ),
      step(
        'select',
        'Select an existing constraint',
        'Choose a named constraint in **IK constraints** to see **Start**, **Middle** and **End** bone labels on the canvas. Constraint names are stable IDs shared with animations; dependency messages explain when chain edits and deletion are protected.',
        targets.rigIK,
      ),
      step(
        'preview',
        'Preview the solver',
        '**IK Preview**, also called **Live solver preview**, lets the solver pose the chain without adding history. **Enabled** is a saved constraint setting with Undo/Redo. **Influence** blends FK with IK from zero to one. Disabled constraints keep editable default targets.',
        targets.rigIKPreview,
      ),
      step(
        'bend',
        'Choose the bend direction',
        'After exiting the tour, select a constraint and set **Bend direction** to **Clockwise (+1)** or **Counterclockwise (−1)**. Follow the signed-turn arrow at the middle joint; **Facing** reflects it on the canvas. Creation can infer the sign once from the pose. Older constraints without a saved sign default to clockwise. Undo/Redo restores bend edits.',
        targets.rigIK,
      ),
      step(
        'target',
        'Drag the default rig target',
        'Drag a constraint crosshair on the canvas to change its **default rig target**. **Escape** cancels the drag. A runtime or animation owner may make the handle unavailable. This edits the rig default, not an animation **keyframe**.',
        targets.rigCanvas,
      ),
      step(
        'coordinates',
        'Refine target coordinates',
        'Select the constraint to enter **Target X** and **Target Y** in rig local coordinates. Commit a number with **Enter** or by leaving the field; **Escape** discards unfinished text. Dragging the end effector crosshair can create a missing default target.',
        targets.rigIK,
      ),
      step(
        'diagnostics',
        'Read the solver feedback',
        '**Unreachable target** means the pose clamps at its reach limit while your coordinates stay saved; move the target into reach. **Unsupported scale** needs equal absolute X/Y scales on the start bone. **Cannot solve** calls for nonzero, invertible transforms. **Inactive** means no active target or influence; **Disabled** and **Solver off** distinguish Enabled from preview. Status describes the evaluated target; a separate ownership message explains blocked dragging.',
        targets.rigIK,
      ),
      step(
        'history',
        'Review and keep the constraint',
        '**Undo** and **Redo** revisit rig constraint edits, including a completed target drag. **Download rig.json** or Download character ZIP keeps these default settings.',
        targets.rigHistory,
      ),
    ],
  },
  {
    id: 'rig-exporting',
    title: 'Exporting the Rig or Character',
    description: 'Check validation and download the rig or a complete character package.',
    editor: 'rig',
    category: 'rigging',
    prerequisites: character,
    steps: [
      step(
        'validation',
        'Review validation feedback',
        '**Validation** reports rig errors and warnings. Resolve errors before exporting. A root-only draft can still be valid; missing artwork or animations can appear as character readiness warnings.',
        targets.rigValidation,
      ),
      step(
        'tools',
        'Run a validation check',
        'After exiting the tour, open **File tools** and choose **Validate** to check the rig. **Copy rig JSON** copies the export to the clipboard. Reload actions replace the rig and may require an unsaved-work decision.',
        targets.rigFileTools,
      ),
      step(
        'rig',
        'Download the rig',
        '**Download rig.json** exports the rig document, including embedded skins and attachment definitions. It does not include image files, animations or standalone skins. Place the file in your character folder yourself.',
        targets.rigDownload,
      ),
      step(
        'package',
        'Download the complete character',
        '**Download character ZIP** validates and bundles the rig, animations, skins, manifest and image files. Resolve reported errors and retry. Save and extract the ZIP yourself; the download establishes a package checkpoint.',
        targets.rigPackage,
      ),
    ],
  },
  {
    id: 'rig-foot-contact-markers',
    title: 'Creating Foot Contact Markers',
    description: 'Author bone-local sole points and keep them with the rig.',
    editor: 'rig',
    category: 'rigging',
    prerequisites: validRig,
    steps: [
      step(
        'bone',
        'Select a foot bone',
        'After exiting this tour, select a foot in **Hierarchy** or choose **New contact bone**. Any bone can own a contact, including non-humanoid rigs.',
        targets.rigContactBone,
      ),
      step(
        'create',
        'Create a contact marker',
        'Choose **+ Add Contact Marker**. The generated ID stays stable; changing the display name preserves ID references. Repeat for the other foot.',
        targets.rigContactCreate,
      ),
      step(
        'position',
        'Position the sole point',
        'Drag its square crosshair on the canvas, or select the marker and enter **Local X/Y**. Coordinates belong to the bone, independent of sprite pixels. **Escape** cancels a drag; rig **Undo/Redo** restores edits.',
        targets.rigContactPosition,
      ),
      step(
        'ground',
        'Align with a ground reference',
        'Enable **Show ground guide** and adjust **Ground Y**. Visually position the marker at the sole against this reference. The guide never moves the rig. Replacing artwork or switching skins can require manual realignment when sole proportions change.',
        targets.rigGroundVisible,
      ),
      step(
        'save',
        'Save and reload the rig',
        '**Download rig.json** preserves marker definitions. **Download character ZIP** also includes artwork, skins and animations. **Reload Current Export** checks rig persistence. Marker edits belong to rig history, including in Rig Tweak; they never create animation tracks.',
        targets.rigDownload,
      ),
    ],
  },
];
