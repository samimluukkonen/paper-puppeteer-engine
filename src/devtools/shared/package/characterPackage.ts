import type { AnimationClip } from '../../../engine/AnimationClip.js';
import type { CharacterDefinition, CharacterManifest } from '../../../engine/CharacterDefinition.js';
import { CharacterLoader } from '../../../engine/CharacterLoader.js';
import type { RigJsonDefinition } from '../../../engine/externalData.js';
import { assertJsonInputSize } from '../../../engine/jsonInput.js';
import type { DeepReadonly } from '../../../engine/readonlyData.js';
import type { SkinDefinition, SpriteDefinition, SpriteAttachmentDefinition } from '../../../engine/types.js';
import type { ArtworkController } from '../artwork/ArtworkController.js';
import { importSprite, inspectSpriteHeader } from '../artwork/spriteImport.js';
import { PACKAGE_MAX_FILE_BYTES, packagePath } from './packageZip.js';

export interface PackageSnapshot {
  readonly definition: CharacterDefinition;
  readonly rig: RigJsonDefinition;
  readonly skins: readonly SkinDefinition[];
  readonly animations: readonly AnimationClip[];
  readonly replacements: ReturnType<ArtworkController['exportReplacements']>;
}
export type PackageFiles = ReadonlyMap<string, Uint8Array<ArrayBuffer>>;
const packageBase = 'https://character-package.invalid/';
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const safeName = (id: string): string => id.replace(/[^a-zA-Z0-9_-]/g, '_') || 'asset';

/** Capture once before any asynchronous I/O. Blobs and loaded definitions are immutable. */
export function capturePackage(snapshot: PackageSnapshot): PackageSnapshot {
  return {
    definition: snapshot.definition,
    rig: structuredClone(snapshot.rig),
    skins: structuredClone(snapshot.skins),
    animations: structuredClone(snapshot.animations),
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
  for (const path of files.keys()) packagePath(path);
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
  let imageBytes = 0,
    pixels = 0;
  for (const [key, path] of Object.entries(manifest.textures)) {
    if (folded.includes(path.toLowerCase())) throw new Error(`Image "${key}" collides with metadata at "${path}".`);
    const bytes = files.get(path);
    if (!bytes) throw new Error(`Missing image "${path}" for texture "${key}".`);
    if (bytes.length > PACKAGE_MAX_FILE_BYTES) throw new Error(`Image "${path}" exceeds 10 MiB.`);
    const header = inspectSpriteHeader(bytes.subarray(0, 30));
    images.set(path, { bytes, format: header.format });
    imageBytes += bytes.length;
    pixels += header.width * header.height;
    if (imageBytes > 50 * 1024 * 1024 || pixels > 64 * 1024 * 1024)
      throw new Error('Package images exceed 50 MiB or 64 megapixels.');
  }
  for (const reference of [
    ...definition.rig.bones.flatMap((bone) => (bone.sprite ? [bone.sprite] : [])),
    ...definition.rig.attachments,
  ]) {
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
  const response = await fetcher(url, { signal, cache: 'no-store' });
  if (!response.ok) throw new Error(`Could not include image "${url}" (${response.status}).`);
  const reader = response.body?.getReader();
  if (!reader) throw new Error(`Empty image "${url}".`);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > PACKAGE_MAX_FILE_BYTES) throw new Error(`Image "${url}" exceeds 10 MiB.`);
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

/** Convert session origin multipliers to the existing normalized-origin/offset format, even outside 0..1. */
function migrateOrigin(
  sprite: SpriteDefinition | SpriteAttachmentDefinition,
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

/** Construct, validate and return a complete proposal. Working editor definitions are never installed or marked saved. */
export async function buildCharacterPackage(
  input: PackageSnapshot,
  fetcher: typeof fetch = fetch,
  signal: AbortSignal = new AbortController().signal,
): Promise<PackageFiles> {
  const snapshot = capturePackage(input);
  const { definition, rig } = snapshot;
  if (!definition.manifest) throw new Error('Character has no source manifest.');
  const manifest = structuredClone(definition.manifest) as CharacterManifest;
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
  const json = (path: string, data: unknown): void => {
    const text = `${JSON.stringify(data, null, 2)}\n`;
    assertJsonInputSize(text);
    add(path, encoder.encode(text));
  };
  const assigned = new Map<string, PackageSnapshot['replacements'][number] & { sourceKey: string }>();
  const textures = new Map<string, Uint8Array<ArrayBuffer>>();
  let serial = 0;
  for (const replacement of snapshot.replacements) {
    if (!Object.hasOwn(manifest.textures, replacement.assetKey))
      throw new Error(`Replacement references unknown texture "${replacement.assetKey}".`);
    let key = replacement.assetKey;
    const extension = replacement.format === 'image/png' ? '.png' : '.webp';
    if (replacement.reference) {
      do {
        key = `${replacement.assetKey}_replacement_${++serial}`;
      } while (Object.hasOwn(manifest.textures, key));
      manifest.textures[key] = allocatePath('images', key, extension);
    } else if (!manifest.textures[key]!.toLowerCase().endsWith(extension)) {
      manifest.textures[key] = allocatePath('images', `${key}_replacement`, extension);
    }
    textures.set(key, new Uint8Array(await replacement.blob.arrayBuffer()));
    const scope = replacement.reference ?? `texture:${replacement.assetKey}`;
    if (assigned.has(scope)) throw new Error(`Duplicate artwork replacement scope "${scope}".`);
    assigned.set(scope, { ...replacement, sourceKey: replacement.assetKey, assetKey: key });
  }
  const migrate = (sprite: SpriteDefinition | SpriteAttachmentDefinition, reference: string): void => {
    const replacement = assigned.get(reference) ?? assigned.get(`texture:${sprite.texture}`);
    if (!replacement) return;
    if (replacement.sourceKey !== sprite.texture)
      throw new Error(`Replacement target "${reference}" now uses another texture. Revert that artwork replacement.`);
    if (sprite.frame !== undefined && sprite.frame !== '__BASE')
      throw new Error(`Cannot replace frame "${sprite.frame}" in ${reference}. Resolve it before export.`);
    const header = inspectSpriteHeader(textures.get(replacement.assetKey)!.subarray(0, 30));
    migrateOrigin(sprite, replacement, header.width, header.height);
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
    json(path, { ...clip, version: 1 });
    return path;
  });
  for (const [index, path] of (manifest.poses ?? []).entries()) json(path, definition.poses[index]);
  // Sequential fetching bounds memory and gives every failure a precise resource name.
  let includedImageBytes = 0;
  for (const [key, path] of Object.entries(manifest.textures)) {
    signal.throwIfAborted();
    const bytes = textures.get(key) ?? (await readImage(definition.textureUrl(key), fetcher, signal));
    includedImageBytes += bytes.length;
    if (includedImageBytes > 50 * 1024 * 1024) throw new Error('Package images exceed 50 MiB.');
    const existing = files.get(path);
    if (existing && existing.length === bytes.length && existing.every((byte, index) => byte === bytes[index]))
      continue;
    add(path, bytes);
  }
  json('character.json', manifest);
  await validatePackage(files, signal);
  return files;
}

/** Only runtime copies receive object URLs. Every URL is owned by this disposable preview lease. */
export async function openPackageRuntime(
  files: PackageFiles,
  signal: AbortSignal,
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
    for (const [key, path] of Object.entries(manifest.textures)) {
      const bytes = files.get(path)!;
      const { format } = inspectSpriteHeader(bytes.subarray(0, 30));
      const url = URL.createObjectURL(new Blob([bytes], { type: format }));
      urls.push(url);
      manifest.textures[key] = url;
    }
    const runtimeFiles = new Map(files);
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
