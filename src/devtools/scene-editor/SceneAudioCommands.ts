import type { AudioAssetDefinition, AudioCategory, SceneAudioClip } from '../../engine/data.js';
import type { SceneEditorDocument } from './SceneEditorDocument.js';
import type { SceneGestureKind } from './SceneEditorGestures.js';

type State = Pick<
  SceneEditorDocument,
  'workingScene' | 'replaceScene' | 'selectAudioClip' | 'audioAssets' | 'reportError'
>;
/** The audio edits a scene document exposes as `document.audio`. */
export type SceneAudioEditing = Pick<SceneAudioCommands, keyof SceneAudioCommands>;

/** Proposals share the document's validation, immutable snapshots and history owner. */
export class SceneAudioCommands {
  constructor(
    private readonly state: State,
    /** Commit the active gesture, unless it is a drag of `unlessDragging`. */
    private readonly finishGestures: (unlessDragging?: SceneGestureKind) => void,
  ) {}

  addTrack(category: AudioCategory): boolean {
    this.finishGestures();
    const scene = this.state.workingScene;
    if (!scene) return false;
    let index = 1;
    while (scene.audioTracks?.some((track) => track.id === `${category}-${index}`)) index++;
    const names = { music: 'Music', ambience: 'Ambience', sfx: 'Sound Effects', voice: 'Voice' };
    return this.state.replaceScene({
      ...scene,
      audioTracks: [
        ...(scene.audioTracks ?? []),
        {
          id: `${category}-${index}`,
          name: `${names[category]} ${index}`,
          category,
        },
      ],
    });
  }
  addClip(input: Omit<SceneAudioClip, 'id'>): boolean {
    this.finishGestures();
    const scene = this.state.workingScene;
    const asset = this.state.audioAssets.find((asset) => asset.id === input.assetId);
    if (!scene || !asset) return this.state.reportError(new Error('Choose an available audio asset.'));
    let index = 1;
    while (scene.audioClips?.some((clip) => clip.id === `audio-${index}`)) index++;
    const id = `audio-${index}`;
    const assets: readonly AudioAssetDefinition[] = scene.audioAssets ?? [];
    if (
      !this.state.replaceScene({
        ...scene,
        audioAssets: assets.some((entry) => entry.id === asset.id) ? assets : [...assets, asset],
        audioClips: [...(scene.audioClips ?? []), { ...input, id }],
      })
    )
      return false;
    this.state.selectAudioClip(id);
    return true;
  }
  removeTrack(id: string, options: { removeClips?: boolean } = {}): boolean {
    this.finishGestures();
    const scene = this.state.workingScene;
    if (!scene?.audioTracks?.some((track) => track.id === id)) return false;
    const clips = scene.audioClips ?? [];
    if (clips.some((clip) => clip.trackId === id) && !options.removeClips)
      return this.state.reportError(
        new Error(
          'This audio track contains clips. Move or remove them first, or confirm removing the track and its clips.',
        ),
      );
    return this.state.replaceScene({
      ...scene,
      audioTracks: scene.audioTracks.filter((track) => track.id !== id),
      ...(scene.audioClips ? { audioClips: clips.filter((clip) => clip.trackId !== id) } : {}),
    });
  }
  updateClip(id: string, patch: Partial<Omit<SceneAudioClip, 'id'>>): boolean {
    this.finishGestures('audio');
    const scene = this.state.workingScene;
    if (!scene?.audioClips?.some((clip) => clip.id === id)) return false;
    const asset = patch.assetId && this.state.audioAssets.find((asset) => asset.id === patch.assetId);
    const assets = scene.audioAssets ?? [];
    return this.state.replaceScene({
      ...scene,
      audioAssets: asset && !assets.some((entry) => entry.id === asset.id) ? [...assets, asset] : assets,
      audioClips: scene.audioClips.map((clip) => (clip.id === id ? { ...clip, ...patch, id } : clip)),
    });
  }
  duplicateClip(id: string): boolean {
    const clip = this.state.workingScene?.audioClips?.find((clip) => clip.id === id);
    return clip ? this.addClip({ ...clip }) : false;
  }
  removeClip(id: string): boolean {
    this.finishGestures();
    const scene = this.state.workingScene;
    if (!scene?.audioClips?.some((clip) => clip.id === id)) return false;
    const clips = scene.audioClips.filter((clip) => clip.id !== id);
    return this.state.replaceScene({ ...scene, audioClips: clips });
  }
}
