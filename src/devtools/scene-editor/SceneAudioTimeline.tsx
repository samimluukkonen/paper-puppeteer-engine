import Trash2 from 'lucide-react/icons/trash-2';
import { useState } from 'react';
import { AUDIO_CATEGORIES, type AudioCategory } from '../../engine/core.js';
import type { SceneAudioClip } from '../../engine/data.js';
import { GUIDE_TARGETS } from '../shared/guides/anchors.js';
import type { ReadonlyScene, SceneEditorDocument } from './SceneEditorDocument.js';
import type { SceneEditorPlayback } from './SceneEditorPlayback.js';
import { layoutAudioClips } from './timelineActions.js';

export const AUDIO_TRACK_NAMES = { music: 'Music', ambience: 'Ambience', sfx: 'Sound Effects', voice: 'Voice' };

export function SceneAudioControls({
  document,
  playback,
}: {
  document: SceneEditorDocument;
  playback: SceneEditorPlayback;
}) {
  const [assetId, setAssetId] = useState('');
  const [trackId, setTrackId] = useState('');
  const [category, setCategory] = useState<AudioCategory>('music');
  const assets = document.audioAssets;
  const tracks = document.workingScene?.audioTracks ?? [];
  const selectedAsset = assets.find((asset) => asset.id === assetId) ?? assets[0];
  const selectedTrack = tracks.find((track) => track.id === trackId) ?? tracks[0];
  return (
    <div className="scene-audio-toolbar" aria-label="Audio timeline controls">
      <label>
        Track category
        <select value={category} onChange={(event) => setCategory(event.target.value as AudioCategory)}>
          {AUDIO_CATEGORIES.map((category) => (
            <option key={category} value={category}>
              {AUDIO_TRACK_NAMES[category]}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        className="workspace-primary"
        disabled={document.hasActiveGesture}
        data-guide-id={GUIDE_TARGETS.sceneAudioAddTrack}
        onClick={() => document.addAudioTrack(category)}
      >
        Add audio track
      </button>
      <label>
        Audio asset
        <select
          data-guide-id={GUIDE_TARGETS.sceneAudioAsset}
          aria-label="Audio asset"
          value={selectedAsset?.id ?? ''}
          onChange={(event) => setAssetId(event.target.value)}
        >
          {!assets.length && <option value="">Import audio in Project Workspace</option>}
          {assets.map((asset) => (
            <option key={asset.id} value={asset.id}>
              {asset.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Audio track
        <select
          aria-label="Audio track"
          value={selectedTrack?.id ?? ''}
          onChange={(event) => setTrackId(event.target.value)}
        >
          {!tracks.length && <option value="">Add an audio track first</option>}
          {tracks.map((track) => (
            <option key={track.id} value={track.id}>
              {track.name}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        className="workspace-primary"
        data-guide-id={GUIDE_TARGETS.sceneAudioAddClip}
        disabled={
          !selectedAsset ||
          !selectedTrack ||
          document.hasActiveGesture ||
          playback.time >= (document.workingScene?.duration ?? 0)
        }
        onClick={() => {
          if (!selectedAsset || !selectedTrack || !document.workingScene) return;
          playback.pause();
          document.addAudioClip({
            assetId: selectedAsset.id,
            trackId: selectedTrack.id,
            time: playback.time,
            duration: Math.min(
              selectedAsset.durationSeconds === undefined ? 1000 : selectedAsset.durationSeconds * 1000,
              document.workingScene.duration - playback.time,
            ),
            sourceOffset: 0,
            volume: 1,
            loop: false,
          });
        }}
      >
        Add Audio Clip
      </button>
      <span className="workspace-caption">Play follows scene timing. Passive scrubbing is silent.</span>
    </div>
  );
}

export function SceneAudioTracks({
  scene,
  document,
  width,
  x,
  beginDrag,
}: {
  scene: ReadonlyScene;
  document: SceneEditorDocument;
  width: number;
  x: (time: number) => number;
  beginDrag: (event: React.PointerEvent<HTMLButtonElement>, clip: SceneAudioClip) => void;
}) {
  return (
    <div data-guide-id={GUIDE_TARGETS.sceneAudioTracks}>
      <div className="scene-track-row scene-camera-group">
        <span className="scene-track-label">Audio</span>
        {!scene.audioTracks?.length && (
          <span className="workspace-caption">Add an audio track, choose an asset and Add Audio Clip.</span>
        )}
      </div>
      {(scene.audioTracks ?? []).map((track) => {
        const clips = (scene.audioClips ?? []).filter((clip) => clip.trackId === track.id);
        const layout = layoutAudioClips(clips, scene.duration, width);
        return (
          <div
            className="scene-track-row"
            key={track.id}
            style={{ height: Math.max(1, ...layout.map(({ lane }) => lane + 1)) * 26 + 8 }}
          >
            <span className="scene-track-label scene-audio-track-label" title={AUDIO_TRACK_NAMES[track.category]}>
              <span className="scene-audio-track-name" title={track.name}>
                {track.name}
              </span>
              <button
                type="button"
                className="workspace-danger scene-audio-track-remove"
                aria-label={`Remove audio track ${track.name}`}
                title={`Remove audio track ${track.name}`}
                disabled={document.hasActiveGesture}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation();
                  if (
                    clips.length &&
                    !window.confirm(
                      `Remove audio track "${track.name}" and its ${clips.length} ${clips.length === 1 ? 'clip' : 'clips'}? This can be undone.`,
                    )
                  )
                    return;
                  document.removeAudioTrack(track.id, { removeClips: true });
                }}
              >
                <Trash2 size={16} aria-hidden="true" />
              </button>
            </span>
            <div className="scene-track-lane" style={{ width }} aria-label={`${track.name} audio clips`}>
              {layout.map(({ clip, lane }) => {
                const asset = document.audioAssets.find((asset) => asset.id === clip.assetId);
                return (
                  <button
                    type="button"
                    key={clip.id}
                    className="scene-action clip scene-audio-clip"
                    aria-label={`Audio clip ${asset?.name ?? clip.assetId} ${clip.id}`}
                    aria-pressed={document.selectedAudioClip?.id === clip.id}
                    title={`${asset?.name ?? clip.assetId} · ${clip.time / 1000} s · ${clip.duration / 1000} s${clip.playback === 'dialogue-hold' ? ' · Hold only' : ''}${clip.loop ? ' · Loop' : ''}`}
                    style={{ left: x(clip.time), width: Math.max(12, x(clip.duration)), top: lane * 26 + 4 }}
                    onClick={() => document.selectAudioClip(clip.id)}
                    onPointerDown={(event) => beginDrag(event, clip)}
                  >
                    <span
                      className="scene-action-resize scene-audio-trim-start"
                      data-audio-edge="start"
                      aria-hidden="true"
                    >
                      ⋮
                    </span>
                    {asset?.name ?? clip.assetId}
                    {clip.playback === 'dialogue-hold' ? ' · Hold only' : ''}
                    {clip.loop ? ' ↻' : ''}
                    <span className="scene-action-resize" data-audio-edge="end" aria-hidden="true">
                      ⋮
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
