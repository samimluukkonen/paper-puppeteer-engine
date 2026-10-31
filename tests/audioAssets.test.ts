import { readFileSync } from 'node:fs';
import { afterEach, expect, test, vi } from 'vitest';
import { parseProjectDefinition } from '../src/devtools/project/ProjectDefinition.js';
import { ProjectInspector } from '../src/devtools/project/projectInspection.js';
import { buildProjectPackage, importProjectPackage } from '../src/devtools/project/projectPackage.js';
import { ProjectWorkspace } from '../src/devtools/project/ProjectWorkspace.js';
import { LocalAutosave } from '../src/devtools/shared/autosave/LocalAutosave.js';
import type { DraftStorage } from '../src/devtools/shared/autosave/LocalDraftStore.js';
import type { PackageFiles } from '../src/devtools/shared/package/characterPackage.js';
import { inspectAudioData, type AudioAssetDefinition } from '../src/engine/AudioAsset.js';
import {
  AUDIO_MAX_DECODED_BYTES,
  AudioAssetLoader,
  type AudioBackend,
  type DecodedAudioResource,
} from '../src/engine/AudioAssetLoader.js';
import { decodePackageZip, encodePackageZip } from '../src/engine/packageZip.js';

const audio = (format = 'wav') =>
  new Uint8Array(readFileSync(new URL(`./fixtures/audio/tone.${format}`, import.meta.url)));
const definition = (id = 'tone'): AudioAssetDefinition => ({
  id,
  name: 'Tone',
  path: `audio/${id}.wav`,
  category: 'music',
});
const loaders: AudioAssetLoader[] = [];
afterEach(() => {
  loaders.splice(0).forEach((loader) => loader.dispose());
  vi.useRealTimers();
  vi.restoreAllMocks();
});
function backend() {
  const stop = vi.fn();
  const setVolume = vi.fn();
  const play = vi.fn((_volume: number, _ended: () => void) => ({ stop, setVolume }));
  const disposeResource = vi.fn();
  const resource: DecodedAudioResource = { durationSeconds: 2, byteLength: 64000, play, dispose: disposeResource };
  const value = {
    decode: vi.fn((_bytes: Uint8Array<ArrayBuffer>) => Promise.resolve(resource)),
    resume: vi.fn(() => Promise.resolve()),
    dispose: vi.fn(),
  };
  return { value, resource, play, stop, setVolume, disposeResource };
}
function loaderFor(project: ProjectWorkspace, value: AudioBackend) {
  const loader = new AudioAssetLoader((id) => project.audioSource(id), value);
  loaders.push(loader);
  return loader;
}

test.each(['wav', 'mp3', 'ogg'])(
  '%s import checks content, decodes, registers stable metadata and reuses audition resources',
  async (format) => {
    const project = new ProjectWorkspace('Audio', 'film');
    const f = backend();
    const loader = loaderFor(project, f.value);
    const bytes = audio(format);
    const id = await project.importAudio(new File([bytes], `tone.${format}`), 'voice', loader);
    const entry = project.definition.audio![0]!;
    expect(entry).toEqual({ id, name: 'tone', path: `audio/tone.${format}`, category: 'voice', durationSeconds: 2 });
    expect(project.audioSource(id)!.bytes).toEqual(bytes);
    expect(f.play).not.toHaveBeenCalled();
    expect(f.value.resume).not.toHaveBeenCalled();
    await loader.play(id);
    await loader.play(id);
    expect(f.value.decode).toHaveBeenCalledTimes(1);
    expect(f.stop).toHaveBeenCalledTimes(1);
    expect(project.inspect('export').counts.error).toBe(0);
  },
);

test('collision-safe import uses content format and preserves IDs and binary ownership across rename and Undo', async () => {
  const project = new ProjectWorkspace('Audio');
  const loader = loaderFor(project, backend().value);
  const bytes = audio();
  const first = await project.importAudio(new File([bytes], 'tone.mp3'), 'music', loader);
  const second = await project.importAudio(new File([bytes], 'TONE.wav'), 'sfx', loader);
  expect(project.definition.audio!.map((entry) => entry.path)).toEqual(['audio/tone.wav', 'audio/TONE-2.wav']);
  expect(first).not.toBe(second);
  project.updateAudio(first, { name: 'Renamed', category: 'ambience' });
  expect(project.audioSource(first)!.definition).toMatchObject({
    id: first,
    name: 'Renamed',
    category: 'ambience',
    path: 'audio/tone.wav',
  });
  const external = project.audioSource(first)!.bytes;
  external.fill(0);
  expect(project.audioSource(first)!.bytes).toEqual(bytes);
  project.removeAudio(first);
  expect(project.audioSource(first)).toBeUndefined();
  project.undo();
  expect(project.audioSource(first)!.bytes).toEqual(bytes);
  project.undo();
  expect(project.audioSource(first)!.definition.name).toBe('tone');
  project.redo();
  expect(project.audioSource(first)!.definition.name).toBe('Renamed');
});

test('missing, empty, oversized, unsupported and undecodable imports leave the project unchanged', async () => {
  const project = new ProjectWorkspace('Audio');
  const f = backend();
  const loader = loaderFor(project, f.value);
  const before = project.autosaveRevision;
  for (const file of [
    new File([], 'empty.wav'),
    new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'large.wav'),
    new File(['not sound'], 'fake.mp3'),
  ]) {
    await expect(project.importAudio(file, 'music', loader)).rejects.toThrow(/Audio must|Unrecognized/);
  }
  f.value.decode.mockRejectedValueOnce(new Error('Invalid bitstream'));
  await expect(project.importAudio(new File([audio()], 'broken.wav'), 'music', loader)).rejects.toThrow(
    /could not decode.*Invalid bitstream/,
  );
  expect(project.autosaveRevision).toBe(before);
  expect(project.definition.audio).toBeUndefined();
  expect(project.history.canUndo).toBe(false);
  await project.importAudio(new File([audio()], 'valid.wav'), 'sfx', loader);
  expect(project.definition.audio).toHaveLength(1); // Decode failures never poison retries.
});

test('metadata rejects duplicate IDs/paths, unsafe paths and unsupported categories without mutating resources', () => {
  const project = new ProjectWorkspace('Audio');
  project.addAudio(definition(), audio());
  expect(() => project.addAudio({ ...definition('TONE'), path: 'audio/other.wav' }, audio())).toThrow(/Duplicate/);
  expect(() => project.addAudio({ ...definition('other'), path: 'audio/TONE.wav' }, audio())).toThrow(/Duplicate/);
  for (const patch of [
    { path: '../tone.wav' },
    { path: 'blob:temporary' },
    { category: 'dialogue' },
    { durationSeconds: -2 },
    { durationSeconds: Infinity },
  ]) {
    expect(() => parseProjectDefinition({ ...project.definition, audio: [{ ...definition(), ...patch }] })).toThrow();
  }
  expect(() => project.addAudio({ ...definition('wrong'), path: 'audio/wrong.mp3' }, audio())).toThrow(
    /format does not match/,
  );
  project.removeAudio('tone');
  expect(() => project.addAudio(definition(), audio())).toThrow(/retained/);
  project.undo();
  expect(project.audioSource('tone')!.bytes).toEqual(audio());
});

test('validator reports missing audio and broken binary/path references with project dependency edges', () => {
  const inspector = new ProjectInspector();
  const project = new ProjectWorkspace('Audio', 'film');
  project.addAudio(definition(), audio());
  const inspect = (files: ReadonlyMap<string, Uint8Array>) =>
    inspector.inspect(
      { definition: project.definition, characters: new Map(), scenes: new Map(), audio: files },
      'export',
    );
  expect(inspect(new Map()).issues[0]).toMatchObject({
    asset: { kind: 'audio', id: 'tone' },
  });
  expect(inspect(new Map()).issues[0]!.message).toContain('Missing audio binary');
  expect(inspect(new Map([['tone', new Uint8Array([1, 2, 3])]])).counts.error).toBe(1);
  expect(inspect(new Map([['tone', audio('mp3')]])).issues[0]!.message).toContain('format does not match');
  expect(project.dependents({ kind: 'audio', owner: 'film', id: 'tone' })).toHaveLength(1);
});

test('registered-ID loading errors, identical-content deduplication, volume, natural ending and disposal', async () => {
  const project = new ProjectWorkspace('Audio');
  project.addAudio(definition('one'), audio());
  project.addAudio(definition('two'), audio());
  const f = backend();
  const loader = loaderFor(project, f.value);
  await expect(loader.load('missing')).rejects.toThrow(/not registered/);
  await Promise.all([loader.load('one'), loader.load('two')]);
  expect(f.value.decode).toHaveBeenCalledTimes(1);
  loader.setVolume(0.25);
  const ended = vi.fn();
  await loader.play('one', ended);
  expect(f.play).toHaveBeenCalledWith(0.25, expect.any(Function));
  loader.setVolume(0.5);
  expect(f.setVolume).toHaveBeenCalledWith(0.5);
  f.play.mock.calls[0]![1]();
  expect(ended).toHaveBeenCalledTimes(1);
  expect(() => loader.setVolume(NaN)).toThrow(/volume/);
  loader.dispose();
  loader.dispose();
  expect(f.disposeResource).toHaveBeenCalledTimes(1);
  expect(f.value.dispose).toHaveBeenCalledTimes(1);
  await expect(loader.load('one')).rejects.toThrow();
});

test('Stop and disposal during asynchronous decoding never start a late voice and release late resources', async () => {
  const project = new ProjectWorkspace('Audio');
  project.addAudio(definition(), audio());
  const f = backend();
  let resolve = (_resource: DecodedAudioResource) => {};
  f.value.decode.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const loader = loaderFor(project, f.value);
  const playing = loader.play('tone');
  await vi.waitFor(() => expect(f.value.decode).toHaveBeenCalledTimes(1));
  loader.stop();
  resolve(f.resource);
  expect(await playing).toBe(false);
  expect(f.play).not.toHaveBeenCalled();
  loader.clear();
  const loading = loader.load('tone');
  const rejected = expect(loading).rejects.toThrow();
  await vi.waitFor(() => expect(f.value.decode).toHaveBeenCalledTimes(2));
  loader.dispose();
  await rejected;
  resolve(f.resource);
  await vi.waitFor(() => expect(f.disposeResource).toHaveBeenCalledTimes(2));
});

test.each(['clear', 'dispose'] as const)(
  '%s releases all decoded resources even when adapter cleanup fails',
  async (command) => {
    const project = new ProjectWorkspace('Cleanup');
    project.addAudio(definition(), audio());
    const f = backend();
    const second = { ...f.resource, dispose: vi.fn() };
    f.value.decode.mockResolvedValueOnce(f.resource).mockResolvedValueOnce(second);
    const loader = loaderFor(project, f.value);
    await loader.prepare(audio('mp3'));
    await loader.play('tone');
    f.stop.mockImplementationOnce(() => {
      throw new Error('Stop failed');
    });
    f.disposeResource.mockImplementationOnce(() => {
      throw new Error('Buffer release failed');
    });
    expect(() => loader[command]()).toThrow('Audio resource cleanup failed');
    expect(f.stop).toHaveBeenCalledOnce();
    expect(f.disposeResource).toHaveBeenCalledOnce();
    expect(second.dispose).toHaveBeenCalledOnce();
    expect(f.value.dispose).toHaveBeenCalledTimes(command === 'dispose' ? 1 : 0);
    if (command === 'clear') {
      await loader.load('tone');
      expect(f.value.decode).toHaveBeenCalledTimes(3);
    }
    loader.dispose();
    loader.dispose();
    expect(f.value.dispose).toHaveBeenCalledOnce();
  },
);

test('backend permission/decode failures and decoded budgets are actionable and retryable', async () => {
  const project = new ProjectWorkspace('Audio');
  project.addAudio(definition(), audio());
  const f = backend();
  const loader = loaderFor(project, f.value);
  f.value.resume.mockRejectedValueOnce(new Error('Sound permission denied; click Play again'));
  await expect(loader.play('tone')).rejects.toThrow(/permission denied/);
  loader.clear();
  f.value.decode.mockResolvedValueOnce({ ...f.resource, byteLength: AUDIO_MAX_DECODED_BYTES + 1 });
  await expect(loader.load('tone')).rejects.toThrow(/128 MiB/);
  await loader.play('tone');
  expect(f.play).toHaveBeenCalledTimes(1);
});

test('project ZIP round trips all categories and binaries, validates missing/corrupt data, and remains backward compatible', async () => {
  const project = new ProjectWorkspace('Audio', 'film');
  for (const category of ['music', 'ambience', 'sfx', 'voice'] as const)
    project.addAudio({ ...definition(category), category }, audio());
  const captured = await buildProjectPackage(project);
  const files = decodePackageZip(encodePackageZip(captured.files));
  const decoder = backend();
  const restored = await importProjectPackage(files, { audioBackend: decoder.value });
  expect(decoder.value.decode).toHaveBeenCalledTimes(1); // Identical content needs only one compatibility decode.
  expect(restored.definition.audio).toHaveLength(4);
  expect(restored.audioSource('voice')!.bytes).toEqual(audio());
  expect(new TextDecoder().decode(files.get('project.json'))).not.toMatch(/blob:|AudioBuffer/);
  const missing = new Map(files);
  missing.delete('audio/voice.wav');
  await expect(importProjectPackage(missing)).rejects.toThrow(/Missing audio binary/);
  const corrupt = new Map(files);
  corrupt.set('audio/voice.wav', new TextEncoder().encode('corrupt'));
  await expect(importProjectPackage(corrupt)).rejects.toThrow(/Unrecognized audio data/);
  const f = backend();
  f.value.decode.mockRejectedValueOnce(new Error('bad codec'));
  await expect(importProjectPackage(files, { audioBackend: f.value })).rejects.toThrow(/bad codec/);
  expect(f.value.dispose).toHaveBeenCalledOnce();
  const old = new ProjectWorkspace('Old project');
  const oldRestored = await importProjectPackage((await buildProjectPackage(old)).files);
  expect(oldRestored.definition.audio).toBeUndefined();
  expect(oldRestored.hasUnsavedChanges).toBe(false);
});

test('autosave captures audio edits and restores detached binary packages through the existing recovery path', async () => {
  const project = new ProjectWorkspace('Audio', 'film');
  const saved: PackageFiles[] = [];
  const storage: DraftStorage = {
    claim: () => Promise.resolve(),
    release: () => Promise.resolve(),
    discard: () => Promise.resolve(),
    save: (_key, _owner, _name, _revision, files) => {
      saved.push(files);
      return Promise.resolve();
    },
  };
  const autosave = new LocalAutosave('project:film', storage, () => ({
    revision: project.autosaveRevision!,
    name: 'Audio',
    dirty: project.hasUnsavedChanges,
    build: async (signal) => (await buildProjectPackage(project, signal)).files,
  }));
  try {
    autosave.start();
    project.addAudio(definition(), audio());
    await autosave.flush();
    project.updateAudio('tone', { category: 'voice', name: 'Hello' });
    autosave.update();
    await autosave.flush();
    expect(saved).toHaveLength(2);
    const restored = await importProjectPackage(saved[1]!);
    expect(restored.audioSource('tone')).toMatchObject({
      definition: { category: 'voice', name: 'Hello' },
      bytes: audio(),
    });
    expect(project.audioSource('tone')!.bytes).not.toBe(restored.audioSource('tone')!.bytes);
  } finally {
    autosave.dispose();
  }
});

test('signature checks reject arbitrary extension-only claims', () => {
  expect(inspectAudioData(audio())).toBe('wav');
  expect(inspectAudioData(audio('mp3'))).toBe('mp3');
  expect(inspectAudioData(audio('ogg'))).toBe('ogg');
  expect(() => inspectAudioData(new Uint8Array([0xff, 0xe1, 0, 0]))).toThrow(/Unrecognized/);
});

test('audio removal respects non-project dependents reported by the shared graph', () => {
  const project = new ProjectWorkspace('Audio', 'film');
  project.addAudio(definition(), audio());
  vi.spyOn(project, 'dependents').mockReturnValue([
    {
      from: { kind: 'scene', owner: 'opening', id: 'opening' },
      to: { kind: 'audio', owner: 'film', id: 'tone' },
      label: 'Opening scene',
    },
  ]);
  expect(() => project.removeAudio('tone')).toThrow(/Opening scene.*Remove its references/);
  expect(project.definition.audio).toHaveLength(1);
});

test('stalled decodes time out, permit retries and dispose a late backend result', async () => {
  const project = new ProjectWorkspace('Audio');
  project.addAudio(definition(), audio());
  const f = backend();
  let resolve = (_resource: DecodedAudioResource) => {};
  f.value.decode.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const deadline = new AbortController();
  vi.spyOn(AbortSignal, 'timeout').mockReturnValueOnce(deadline.signal);
  const loader = loaderFor(project, f.value);
  const loading = loader.load('tone');
  const rejected = expect(loading).rejects.toThrow(/could not decode.*timed out/);
  await vi.waitFor(() => expect(f.value.decode).toHaveBeenCalledOnce());
  deadline.abort(new DOMException('Audio loading timed out.', 'TimeoutError'));
  await rejected;
  const retry = loader.load('tone');
  // Timing out stops waiting, but cannot cancel the backend's allocation.
  await new Promise((done) => setTimeout(done, 20));
  expect(f.value.decode).toHaveBeenCalledOnce();
  resolve({ ...f.resource, dispose: f.disposeResource });
  await retry;
  expect(f.value.decode).toHaveBeenCalledTimes(2);
  await vi.waitFor(() => expect(f.disposeResource).toHaveBeenCalledOnce());
});

test('runtime loading validates metadata and the requested stable ID before decoding', async () => {
  const f = backend();
  const loader = new AudioAssetLoader(() => ({ definition: definition('other'), bytes: audio() }), f.value);
  loaders.push(loader);
  await expect(loader.load('tone')).rejects.toThrow(/different registered ID/);
  const unsafe = new AudioAssetLoader(
    () => ({ definition: { ...definition(), path: '../tone.wav' }, bytes: audio() }),
    f.value,
  );
  loaders.push(unsafe);
  await expect(unsafe.load('tone')).rejects.toThrow(/Invalid package path/);
  expect(f.value.decode).not.toHaveBeenCalled();
});
