# Paper Puppeteer Engine — v0.6.2
## Schema & Compatibility Hardening

Continue developing Paper Puppeteer Engine.

**Current completed version: v0.6.1**

Stack: React, TypeScript (strict), Phaser, Vite, npm, ES modules.

Existing formats include:
- Rig definitions
- Animation definitions
- IK animation and baked constraint metadata
- Skin definitions
- Slots/attachments
- Character manifests
- Asset references

Do not redesign functioning formats.

## Goal

Implement **v0.6.2 — Schema & Compatibility Hardening**.

Ensure authored character data remains stable, validated and compatible with production runtime loading.

### 1. Format inventory

Inspect actual JSON schemas, TypeScript definitions and format-version fields.

Document:
- Current supported versions
- Required/optional fields
- Default behaviors
- References between files
- Existing migration/compatibility functions

Do not guess format versions.

Engine release version and data format version must remain conceptually separate.

### 2. Backward compatibility

Find actual older valid fixture files in the repository.

Verify they still load with current runtime and validators.

If an older supported format requires conversion, use the existing migration mechanism or add a minimal documented migration.

Do not invent fictional historical formats.

Preserve missing-field defaults where compatibility requires them.

### 3. Deterministic serialization

Verify stable export for:
- Rig data
- Animations
- IK metadata
- Skins
- Character manifests

Repeated export/import/export should produce equivalent authored data and stable canonical JSON.

Do not serialize transient React, Phaser or editor state.

### 4. Cross-file references

Validate:
- Bone references
- IK constraint references
- Slot/attachment references
- Skin overrides
- Animation identifiers
- Texture and frame references
- Character manifest paths

Errors should identify the document and problematic reference.

Do not silently remove unknown supported data.

### 5. Import safety

Treat imported JSON as unknown until validated.

Reject:
- Unsupported format versions
- Invalid numbers
- Broken references
- Invalid keyframes
- Duplicate identifiers
- Unsafe or unresolved package paths

Failed imports must preserve existing working documents.

### 6. Migration safety

If migrations exist:
- Make them deterministic
- Avoid mutating original imported input
- Preserve authored intent
- Test repeated migration behavior
- Do not auto-upgrade files without clear policy

Document any unavoidable incompatibilities.

### 7. Runtime equivalence

Test that an animation evaluated before serialization and after reloading produces equivalent poses at representative times.

Cover:
- Interpolation
- Events
- IK targets
- Baked IK
- Attachment/skin behavior

### 8. Fixtures and tests

Create a focused compatibility fixture suite using real supported formats.

Cover:
- Minimal character
- Complete character
- Older supported fixture
- IK animation
- Baked IK animation
- Multiple skins
- Invalid manifests
- Export/import stability

Keep fixtures readable and maintainable.

### 9. Documentation

Document supported format versions, compatibility policy, validation commands and migration behavior.

Explain how developers should handle older character assets.

### 10. Scope restrictions

Do not introduce:
- New animation authoring features
- New rig fields without an identified compatibility need
- Automatic retargeting
- Asset painting tools
- Scene choreography

### 11. Verification

Run:
- `npm run typecheck`
- `npm run test`
- `npm run build`

Fix failures.

## Definition of done

- Supported formats are documented
- Real older fixtures continue working
- Import validation is reliable
- Serialization is deterministic
- Cross-file references validate
- Failed imports are transactional
- Runtime behavior survives round trips
- Tests, typecheck and build pass

## Final report

Provide:
1. Supported schema versions
2. Compatibility changes
3. Migration behavior
4. Validation improvements
5. Round-trip results
6. Fixtures and tests
7. Files changed
8. Exact command results
9. Remaining v0.6.3 work

Do not claim completion unless required commands pass.
