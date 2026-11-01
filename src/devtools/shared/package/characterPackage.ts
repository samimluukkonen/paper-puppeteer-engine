import type { AnimationClip } from '../../../engine/AnimationClip.js';
import { canonicalJson } from '../../../engine/authoredSerialization.js';
import { CharacterDefinition, type CharacterManifest } from '../../../engine/CharacterDefinition.js';
import { CharacterLoader } from '../../../engine/CharacterLoader.js';
import { CharacterTextureBudget, DEFAULT_CHARACTER_TEXTURE_LIMITS } from '../../../engine/characterTextureLimits.js';
import type { RigJsonDefinition } from '../../../engine/externalData.js';
import { IMAGE_HEADER_BYTES } from '../../../engine/imageHeader.js';
import { assertJsonInputSize } from '../../../engine/jsonInput.js';
import { assertMeshImageSize } from '../../../engine/meshGeometry.js';
import type { PoseDefinition } from '../../../engine/Pose.js';
import { isFullyFrozen, type DeepReadonly } from '../../../engine/readonlyData.js';
import { readResponseBytes, withResourceResponse } from '../../../engine/resourceInput.js';
import { identifierSchema } from '../../../engine/schemas.js';
import type { SkinDefinition, SpriteDefinition, AttachmentDefinition } from '../../../engine/types.js';
import type { ArtworkController } from '../artwork/ArtworkController.js';
import { importSprite, inspectSpriteHeader } from '../artwork/spriteImport.js';
import { safeFilename } from '../assetFilename.js';
import { PackageFingerprints } from './PackageFingerprints.js';
import { PACKAGE_MAX_FILE_BYTES, packagePath, validatePackageFiles } from './packageZip.js';

export interface PackageSnapshot {
  readonly definition: CharacterDefinition;
  /** Project variants borrow source data; portable packages receive their own identity and appearance. */
  readonly identity?: Readonly<Pick<CharacterManifest, 'id' | 'defaultSkin'>>;
  readonly rig: RigJsonDefinition;
  readonly skins: readonly SkinDefinition[];
  readonly animations: readonly AnimationClip[];
  readonly poses?: readonly DeepReadonly<PoseDefinition>[];
  readonly replacements: ReturnType<ArtworkController['exportReplacements']>;
  readonly pendingArtwork?: boolean;
}
export type PackageFiles = ReadonlyMap<string, Uint8Array<ArrayBuffer>>;
const packageBase = 'https://character-package.invalid/';
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const safeName = (id: string): string => safeFilename(id.replace(/[^a-zA-Z0-9_-]/g, '_') || 'asset');

/** Capture once before any asynchronous I/O. Blobs and loaded definitions are immutable. */
export function capturePackage(snapshot: PackageSnapshot): PackageSnapshot {
  if (snapshot.pendingArtwork) throw new Error('Apply or cancel the artwork proposal before exporting a package.');
  return {
    definition: snapshot.definition,
    ...(snapshot.identity ? { identity: { ...snapshot.identity } } : {}),
    rig: structuredClone(snapshot.rig),
    skins: structuredClone(snapshot.skins),
    animations: structuredClone(snapshot.animations),
    poses: structuredClone(snapshot.poses ?? snapshot.definition.poses),
    replacements: snapshot.replacements.map((entry) => ({ ...entry })),
  };
}

function manifestPaths(manifest: DeepReadonly<CharacterManifest>): string[] {
  return [
    manifest.rig,
    ...Object.values(manifest.skins),
    ...manifest.animations,
    ...(manifest.poses ?? []),
    ...Object.values(manifest.textures),
  ];
}

/** The production loader reads an isolated in-memory filesystem; all URLs stay within this package. */
export function loadPackageDefinition(files: PackageFiles, signal?: AbortSignal): Promise<CharacterDefinition> {
  return CharacterLoader.load(
    `${packageBase}character.json`,
    (input) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
      const path = decodeURIComponent(url.pathname.slice(1));
      const bytes = files.get(path);
      return Promise.resolve(bytes ? new Response(bytes) : new Response(null, { status: 404 }));
    },
    {
      ...(signal ? { signal } : {}),
      pathPolicy: (path) => {
        packagePath(path);
      },
      urlPolicy: (url) =>
        url.origin === new URL(packageBase).origin &&
        !url.search &&
        !url.hash &&
        files.has(decodeURIComponent(url.pathname.slice(1))),
    },
  );
}

/** Metadata, static frame references, image headers and aggregate budgets are checked before download/import. */
export async function validatePackage(files: PackageFiles, signal?: AbortSignal): Promise<CharacterDefinition> {
  signal?.throwIfAborted();
  validatePackageFiles(files);
  const definition = await loadPackageDefinition(files, signal);
  const manifest = definition.manifest!;
  const metadata = [
    'character.json',
    manifest.rig,
    ...Object.values(manifest.skins),
    ...manifest.animations,
    ...(manifest.poses ?? []),
  ];
  const folded = metadata.map((path) => packagePath(path).toLowerCase());
  if (new Set(folded).size !== folded.length) throw new Error('Metadata files must have distinct package paths.');
  for (const path of manifestPaths(manifest)) packagePath(path);
  const images = new Map<string, { bytes: Uint8Array<ArrayBuffer>; format: string }>();
  const budget = new CharacterTextureBudget({ allowWebp: true });
  for (const [key, path] of Object.entries(manifest.textures)) {
    if (folded.includes(path.toLowerCase())) throw new Error(`Image "${key}" collides with metadata at "${path}".`);
    const bytes = files.get(path);
    if (!bytes) throw new Error(`Missing image "${path}" for texture "${key}".`);
    const header = inspectSpriteHeader(bytes.subarray(0, IMAGE_HEADER_BYTES));
    // A ZIP stores aliases once, but Phaser loads/allocates each distinct texture key.
    budget.checkImage(key, bytes);
    if (images.has(path)) continue;
    images.set(path, { bytes, format: header.format });
  }
  for (const reference of [
    ...definition.rig.bones.flatMap((bone) => (bone.sprite ? [bone.sprite] : [])),
    ...definition.rig.attachments,
  ]) {
    if ('type' in reference && reference.type === 'mesh') {
      const bytes = files.get(manifest.textures[reference.texture]!)!;
      assertMeshImageSize(reference, inspectSpriteHeader(bytes.subarray(0, IMAGE_HEADER_BYTES)));
    }
    if (reference.frame !== undefined && reference.frame !== '__BASE')
      throw new Error(
        `Texture "${reference.texture}" references frame "${reference.frame}". Package images are static; resolve atlas frames before export.`,
      );
  }
  // Browsers decode before producing a download. Node tooling still gets full metadata/header validation.
  if (typeof Image !== 'undefined') {
    for (const [path, image] of images) {
      let sprite: Awaited<ReturnType<typeof importSprite>>;
      try {
        sprite = await importSprite(
          new File([image.bytes], image.format === 'image/png' ? 'package.png' : 'package.webp', {
            type: image.format,
          }),
          signal ?? new AbortController().signal,
        );
      } catch (error) {
        throw new Error(`Image "${path}" could not be decoded: ${String(error)}`, { cause: error });
      }
      sprite.dispose();
    }
  }
  signal?.throwIfAborted();
  return definition;
}

async function readImage(url: string, fetcher: typeof fetch, signal: AbortSignal): Promise<Uint8Array<ArrayBuffer>> {
  return withResourceResponse(
    url,
    fetcher,
    {
      signal,
      timeoutMs: 30_000,
      timeoutMessage: `Image request timed out: ${url}`,
      init: { cache: 'no-store' },
    },
    (response, requestSignal) =>
      readResponseBytes(response, {
        maxBytes: PACKAGE_MAX_FILE_BYTES,
        signal: requestSignal,
        limitError: () => new Error(`Image "${url}" exceeds 10 MiB.`),
        emptyError: () => new Error(`Empty image "${url}".`),
        validateResponse: (value) => {
          if (!value.ok) throw new Error(`Could not include image "${url}" (${value.status}).`);
        },
      }),
  );
}

/** Convert session origin multipliers to the existing normalized-origin/offset format, even outside 0..1. */
function migrateOrigin(
  sprite: SpriteDefinition | AttachmentDefinition,
  replacement: PackageSnapshot['replacements'][number],
  width: number,
  height: number,
): void {
  const ox = (sprite.originX ?? 0.5) * replacement.originScaleX;
  const oy = (sprite.originY ?? 0.5) * replacement.originScaleY;
  const nx = Math.max(0, Math.min(1, ox)),
    ny = Math.max(0, Math.min(1, oy));
  const dx = (nx - ox) * width * (sprite.scaleX ?? 1);
  const dy = (ny - oy) * height * (sprite.scaleY ?? 1);
  const rotation = 'rotation' in sprite ? (sprite.rotation ?? 0) : 0;
  sprite.x = (sprite.x ?? 0) + Math.cos(rotation) * dx - Math.sin(rotation) * dy;
  sprite.y = (sprite.y ?? 0) + Math.sin(rotation) * dx + Math.cos(rotation) * dy;
  sprite.originX = nx;
  sprite.originY = ny;
}

/** Full export preparation remains independent of the local draft caches. */
export async function buildCharacterPackage(
  input: PackageSnapshot,
  fetcher: typeof fetch = fetch,
  signal: AbortSignal = new AbortController().signal,
): Promise<PackageFiles> {
  signal.throwIfAborted();
  const files = await serializeCharacterFiles(capturePackage(input), fetcher, signal);
  await validatePackage(files, signal);
  return files;
}

/** One editor/character owns this cache; only completed revisions and immutable binaries are retained. */
export class CharacterDraftSerializer {
  private readonly fingerprints = new PackageFingerprints();
  private definition: CharacterDefinition | undefined;
  private previous: { revision: string; files: PackageFiles } | undefined;
  private readonly sources = new WeakMap<CharacterDefinition, Map<string, Uint8Array<ArrayBuffer>>>();
  private readonly replacements = new WeakMap<Blob, Uint8Array<ArrayBuffer>>();
  private readonly documents = new WeakMap<object, Uint8Array<ArrayBuffer>>();

  /** Project registration already validated and detached these source binaries. */
  constructor(source?: { definition: CharacterDefinition; files: PackageFiles }) {
    if (source) {
      const textures = new Map<string, Uint8Array<ArrayBuffer>>();
      for (const [key, path] of Object.entries(source.definition.manifest!.textures))
        textures.set(source.definition.textureUrl(key), source.files.get(path)!);
      this.sources.set(source.definition, textures);
    }
  }

  async build(
    input: PackageSnapshot,
    fetcher: typeof fetch = fetch,
    signal: AbortSignal = new AbortController().signal,
    options: { metadataValidated?: boolean } = {},
  ): Promise<PackageFiles> {
    signal.throwIfAborted();
    if (input.pendingArtwork) throw new Error('Apply or cancel the artwork proposal before saving a draft.');
    const revision = canonicalJson(this.fingerprints.compute(input));
    if (this.definition === input.definition && this.previous?.revision === revision) return this.previous.files;
    // Artwork migration needs an owned rig. Other frozen branches can be borrowed;
    // mutable callers are detached now, before any asynchronous asset reads.
    const own = <T extends object>(value: T): T => (isFullyFrozen(value) ? value : structuredClone(value));
    const snapshot: PackageSnapshot = {
      definition: input.definition,
      ...(input.identity ? { identity: { ...input.identity } } : {}),
      rig: input.replacements.length ? structuredClone(input.rig) : own(input.rig),
      skins: input.skins.map(own),
      animations: input.animations.map(own),
      poses: (input.poses ?? input.definition.poses).map(own),
      replacements: input.replacements.map((entry) => ({ ...entry })),
    };
    const files = await serializeCharacterFiles(snapshot, fetcher, signal, this, options.metadataValidated);
    signal.throwIfAborted();
    this.definition = input.definition;
    this.previous = { revision, files };
    return files;
  }

  json(data: object, value: () => unknown = () => data): Uint8Array<ArrayBuffer> {
    const reusable = isFullyFrozen(data);
    const previous = reusable && this.documents.get(data);
    if (previous) return previous;
    const text = canonicalJson(value());
    assertJsonInputSize(text);
    const bytes = encoder.encode(text);
    if (reusable) this.documents.set(data, bytes);
    return bytes;
  }

  private async validateAsset(bytes: Uint8Array<ArrayBuffer>, signal: AbortSignal): Promise<void> {
    const header = inspectSpriteHeader(bytes.subarray(0, IMAGE_HEADER_BYTES));
    new CharacterTextureBudget({ allowWebp: true }).checkImage('draft', bytes);
    if (typeof Image !== 'undefined') {
      const sprite = await importSprite(
        new File([bytes], header.format === 'image/png' ? 'draft.png' : 'draft.webp', { type: header.format }),
        signal,
      );
      sprite.dispose();
    }
    signal.throwIfAborted();
  }

  async replacement(blob: Blob, signal: AbortSignal): Promise<Uint8Array<ArrayBuffer>> {
    const previous = this.replacements.get(blob);
    if (previous) return previous;
    const bytes = new Uint8Array(await blob.arrayBuffer());
    await this.validateAsset(bytes, signal);
    this.replacements.set(blob, bytes);
    return bytes;
  }

  async texture(
    definition: CharacterDefinition,
    key: string,
    fetcher: typeof fetch,
    signal: AbortSignal,
  ): Promise<Uint8Array<ArrayBuffer>> {
    const sources = this.sources.get(definition) ?? new Map<string, Uint8Array<ArrayBuffer>>();
    this.sources.set(definition, sources);
    const url = definition.textureUrl(key);
    const previous = sources.get(url);
    if (previous) return previous;
    const bytes = await readImage(url, fetcher, signal);
    await this.validateAsset(bytes, signal);
    sources.set(url, bytes);
    return bytes;
  }
}

/** Shared portable layout/artwork migration; complete package preparation stays at export boundaries. */
async function serializeCharacterFiles(
  snapshot: PackageSnapshot,
  fetcher: typeof fetch,
  signal: AbortSignal,
  draft?: CharacterDraftSerializer,
  metadataValidated = false,
): Promise<PackageFiles> {
  const { definition, rig } = snapshot;
  if (!definition.manifest) throw new Error('Character has no source manifest.');
  const skinNames = snapshot.skins.map((skin) => skin.name);
  if (new Set(skinNames).size !== skinNames.length)
    throw new Error('Duplicate standalone skin names. Rename the duplicate skin before export.');
  const manifest = structuredClone(definition.manifest) as CharacterManifest;
  Object.assign(manifest, snapshot.identity);
  for (const path of manifestPaths(manifest)) packagePath(path);
  // Reserve source paths before generating any names, even when their files are added later.
  const reservedPaths = new Set(['character.json', ...manifestPaths(manifest)].map((path) => path.toLowerCase()));
  const allocatePath = (directory: string, id: string, extension: string): string => {
    const stem = safeName(id).slice(0, 200);
    let path = `${directory}/${stem}${extension}`;
    let suffix = 1;
    while (reservedPaths.has(path.toLowerCase())) path = `${directory}/${stem}_${++suffix}${extension}`;
    reservedPaths.add(path.toLowerCase());
    return path;
  };
  const files = new Map<string, Uint8Array<ArrayBuffer>>();
  const add = (path: string, bytes: Uint8Array<ArrayBuffer>): void => {
    packagePath(path);
    if ([...files.keys()].some((key) => key.toLowerCase() === path.toLowerCase()))
      throw new Error(`Conflicting package path "${path}". Assign distinct manifest paths.`);
    files.set(path, bytes);
  };
  const json = (path: string, data: object, value: () => unknown = () => data): void => {
    if (draft) add(path, draft.json(data, value));
    else {
      const text = canonicalJson(value());
      assertJsonInputSize(text);
      add(path, encoder.encode(text));
    }
  };
  const assigned = new Map<string, PackageSnapshot['replacements'][number] & { sourceKey: string }>();
  const textures = new Map<string, Uint8Array<ArrayBuffer>>();
  let serial = 0;
  for (const replacement of snapshot.replacements) {
    let key = identifierSchema.parse(replacement.assetKey);
    const extension = replacement.format === 'image/png' ? '.png' : '.webp';
    if (!Object.hasOwn(manifest.textures, key)) {
      if (!replacement.newAsset || replacement.reference)
        throw new Error(`Replacement references unknown texture "${key}".`);
      manifest.textures[key] = allocatePath('images', key, extension);
    }
    if (replacement.reference) {
      do {
        key = `${replacement.assetKey}_replacement_${++serial}`;
      } while (Object.hasOwn(manifest.textures, key));
      manifest.textures[key] = allocatePath('images', key, extension);
    } else if (
      !manifest.textures[key]!.toLowerCase().endsWith(extension) ||
      Object.entries(manifest.textures).some(
        ([otherKey, path]) => otherKey !== key && path.toLowerCase() === manifest.textures[key]!.toLowerCase(),
      )
    ) {
      // Texture keys can alias one source file. Replacing one key must not
      // overwrite artwork still referenced by another key in the package.
      manifest.textures[key] = allocatePath('images', `${key}_replacement`, extension);
    }
    textures.set(
      key,
      draft ? await draft.replacement(replacement.blob, signal) : new Uint8Array(await replacement.blob.arrayBuffer()),
    );
    const scope = replacement.reference ?? `texture:${replacement.assetKey}`;
    if (assigned.has(scope)) throw new Error(`Duplicate artwork replacement scope "${scope}".`);
    assigned.set(scope, { ...replacement, sourceKey: replacement.assetKey, assetKey: key });
  }
  const migrate = (sprite: SpriteDefinition | AttachmentDefinition, reference: string): void => {
    const replacement = assigned.get(reference) ?? assigned.get(`texture:${sprite.texture}`);
    if (!replacement) return;
    if (replacement.sourceKey !== sprite.texture)
      throw new Error(`Replacement target "${reference}" now uses another texture. Revert that artwork replacement.`);
    if (sprite.frame !== undefined && sprite.frame !== '__BASE')
      throw new Error(`Cannot replace frame "${sprite.frame}" in ${reference}. Resolve it before export.`);
    const header = inspectSpriteHeader(textures.get(replacement.assetKey)!.subarray(0, IMAGE_HEADER_BYTES));
    if ('type' in sprite && sprite.type === 'mesh') {
      if (
        header.width !== sprite.imageSize.width ||
        header.height !== sprite.imageSize.height ||
        replacement.originScaleX !== 1 ||
        replacement.originScaleY !== 1
      )
        throw new Error(
          `Mesh artwork "${reference}" requires the original dimensions and pivot. Recreate the mesh before resizing artwork.`,
        );
    } else migrateOrigin(sprite, replacement, header.width, header.height);
    sprite.texture = replacement.assetKey;
    delete sprite.frame;
    assigned.delete(reference);
  };
  for (const bone of rig.bones) if (bone.sprite) migrate(bone.sprite, `bone:${bone.id}`);
  for (const attachment of rig.attachments ?? []) migrate(attachment, `attachment:${attachment.id}`);
  for (const reference of assigned.keys())
    if (!reference.startsWith('texture:'))
      throw new Error(`Replacement target "${reference}" no longer exists. Revert that artwork replacement.`);
  json(manifest.rig, rig);
  manifest.skins = Object.fromEntries(
    snapshot.skins.map((skin) => {
      const path = Object.hasOwn(manifest.skins, skin.name)
        ? manifest.skins[skin.name]!
        : allocatePath('skins', skin.name, '.json');
      json(path, skin);
      return [skin.name, path];
    }),
  );
  manifest.animations = snapshot.animations.map((clip) => {
    const path = Object.hasOwn(definition.animationPaths, clip.name)
      ? definition.animationPaths[clip.name]!
      : allocatePath('animations', clip.name, '.json');
    json(path, clip, () => ({ ...clip, version: 1 }));
    return path;
  });
  const sourcePosePaths = new Map(
    definition.poses.map((pose, index) => [
      pose.library?.id ?? `legacy:${pose.name}`,
      definition.manifest!.poses?.[index],
    ]),
  );
  const posePaths = (snapshot.poses ?? definition.poses).map((pose) => {
    const sourceIndex = definition.poses.findIndex((source) => source.name === pose.name);
    const path =
      (pose.library ? sourcePosePaths.get(pose.library.id) : definition.manifest!.poses?.[sourceIndex]) ??
      allocatePath('poses', pose.library?.id ?? pose.name, '.json');
    json(path, pose);
    return path;
  });
  if (posePaths.length || manifest.poses) manifest.poses = posePaths;
  json('character.json', manifest);
  // Reject authored reference errors before fetching any source artwork. Use the same
  // cross-file validator as CharacterLoader, with the actual generated paths/documents.
  if (!metadataValidated)
    CharacterDefinition.fromData({
      manifest,
      rig: packageJson(files, manifest.rig),
      skins: Object.fromEntries(Object.values(manifest.skins).map((path) => [path, packageJson(files, path)])),
      animations: Object.fromEntries(manifest.animations.map((path) => [path, packageJson(files, path)])),
      poses: Object.fromEntries((manifest.poses ?? []).map((path) => [path, packageJson(files, path)])),
    });
  // Sequential fetching bounds memory and gives every failure a precise resource name.
  let includedImageBytes = 0;
  const budget = draft && new CharacterTextureBudget({ allowWebp: true });
  for (const [key, path] of Object.entries(manifest.textures)) {
    signal.throwIfAborted();
    const bytes =
      textures.get(key) ??
      files.get(path) ??
      (draft
        ? await draft.texture(definition, key, fetcher, signal)
        : await readImage(definition.textureUrl(key), fetcher, signal));
    if (budget) budget.checkImage(key, bytes);
    const existing = files.get(path);
    if (
      existing === bytes ||
      (existing && existing.length === bytes.length && existing.every((byte, index) => byte === bytes[index]))
    )
      continue;
    includedImageBytes += bytes.length;
    if (includedImageBytes > DEFAULT_CHARACTER_TEXTURE_LIMITS.maxTotalImageBytes)
      throw new Error('Package images exceed 50 MiB.');
    add(path, bytes);
  }
  if (draft) {
    for (const sprite of [
      ...rig.bones.flatMap((bone) => (bone.sprite ? [bone.sprite] : [])),
      ...(rig.attachments ?? []),
    ]) {
      if ('type' in sprite && sprite.type === 'mesh')
        assertMeshImageSize(sprite, inspectSpriteHeader(files.get(manifest.textures[sprite.texture]!)!));
      if (sprite.frame !== undefined && sprite.frame !== '__BASE')
        throw new Error(
          `Texture "${sprite.texture}" references frame "${sprite.frame}". Package images are static; resolve atlas frames before export.`,
        );
    }
  }
  signal.throwIfAborted();
  return files;
}

/** Only runtime copies receive object URLs. Every URL is owned by this disposable preview lease. */
export async function openPackageRuntime(
  files: PackageFiles,
  signal: AbortSignal,
  namespace?: string,
): Promise<{
  definition: CharacterDefinition;
  dispose: () => void;
}> {
  const source = await validatePackage(files, signal);
  const urls: string[] = [];
  const dispose = (): void => {
    for (const url of urls.splice(0)) URL.revokeObjectURL(url);
  };
  try {
    const manifest = structuredClone(source.manifest!) as CharacterManifest;
    const keys = new Map<string, string>();
    const runtimeTextures: Record<string, string> = {};
    for (const [key, path] of Object.entries(manifest.textures)) {
      const bytes = files.get(path)!;
      const { format } = inspectSpriteHeader(bytes.subarray(0, IMAGE_HEADER_BYTES));
      const url = URL.createObjectURL(new Blob([bytes], { type: format }));
      urls.push(url);
      const runtimeKey = namespace ? `${namespace}_${keys.size}` : key;
      keys.set(key, runtimeKey);
      runtimeTextures[runtimeKey] = url;
    }
    manifest.textures = runtimeTextures;
    const runtimeFiles = new Map(files);
    if (namespace) {
      const rig = structuredClone(source.rigFile!) as RigJsonDefinition;
      for (const sprite of [
        ...rig.bones.flatMap((bone) => (bone.sprite ? [bone.sprite] : [])),
        ...(rig.attachments ?? []),
      ])
        sprite.texture = keys.get(sprite.texture)!;
      runtimeFiles.set(manifest.rig, encoder.encode(JSON.stringify(rig)));
    }
    runtimeFiles.set('character.json', encoder.encode(JSON.stringify(manifest)));
    const definition = await CharacterLoader.load(
      `${packageBase}character.json`,
      (input) => {
        const bytes = runtimeFiles.get(
          decodeURIComponent(
            new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url).pathname.slice(
              1,
            ),
          ),
        );
        return Promise.resolve(bytes ? new Response(bytes) : new Response(null, { status: 404 }));
      },
      { signal },
    );
    signal.throwIfAborted();
    return { definition, dispose };
  } catch (error) {
    dispose();
    throw error;
  }
}

export function packageJson(files: PackageFiles, path: string): unknown {
  const bytes = files.get(path);
  if (!bytes) throw new Error(`Missing package file "${path}".`);
  return JSON.parse(decoder.decode(bytes)) as unknown;
}
