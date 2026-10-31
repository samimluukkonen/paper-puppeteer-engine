import Music from 'lucide-react/icons/music';
import Play from 'lucide-react/icons/play';
import Square from 'lucide-react/icons/square';
import Trash2 from 'lucide-react/icons/trash-2';
import Upload from 'lucide-react/icons/upload';
import { useEffect, useRef, useState } from 'react';
import { AUDIO_CATEGORIES, type AudioAssetDefinition, type AudioCategory } from '../../engine/AudioAsset.js';
import { AudioAssetLoader } from '../../engine/AudioAssetLoader.js';
import { GUIDE_TARGETS } from '../shared/guides/anchors.js';
import type { ProjectWorkspace } from './ProjectWorkspace.js';

const labels: Record<AudioCategory, string> = {
  music: 'Music',
  ambience: 'Ambience',
  sfx: 'Sound effects',
  voice: 'Voice',
};
interface Props {
  workspace: ProjectWorkspace;
  busy: boolean;
  active: boolean;
  run: (task: () => Promise<void>) => void;
  onStatus: (message: string) => void;
}

export function ProjectAudioLibrary(props: Props) {
  const [open, setOpen] = useState(false);
  return (
    <details className="project-panel project-audio" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary data-guide-id={GUIDE_TARGETS.projectAudio}>
        <Music size={16} aria-hidden="true" /> Audio{' '}
        <span className="project-asset-count">{props.workspace.definition.audio?.length ?? 0}</span>
      </summary>
      {open && <AudioControls {...props} />}
    </details>
  );
}

function AudioControls({ workspace, busy, active, run, onStatus }: Props) {
  const [loader] = useState(() => new AudioAssetLoader((id) => workspace.audioSource(id)));
  const fileInput = useRef<HTMLInputElement>(null);
  const [category, setCategory] = useState<AudioCategory>('music');
  const [playing, setPlaying] = useState<string>();
  const [loading, setLoading] = useState<string>();
  const [volume, setVolume] = useState(0.7);
  const request = useRef(0);
  const lifetime = useRef(new AbortController());
  const stop = () => {
    request.current++;
    loader.stop();
    setPlaying(undefined);
    setLoading(undefined);
  };
  useEffect(
    () => () => {
      request.current++;
      lifetime.current.abort();
      loader.dispose();
    },
    [loader],
  );
  useEffect(() => {
    if (!active) {
      request.current++;
      loader.stop();
      setPlaying(undefined);
      setLoading(undefined);
    }
  }, [active, loader]);
  // Membership Undo/Redo can remove the currently auditioned asset too.
  const assets = workspace.definition.audio ?? [];
  const auditionId = playing ?? loading;
  const auditionExists = assets.some((entry) => entry.id === auditionId);
  useEffect(() => {
    if (auditionId && !auditionExists) {
      request.current++;
      loader.stop();
      setPlaying(undefined);
      setLoading(undefined);
    }
  }, [auditionId, auditionExists, loader]);
  const attempt = (task: () => void) => {
    try {
      task();
    } catch (error) {
      onStatus(error instanceof Error ? error.message : String(error));
    }
  };
  const play = (id: string) => {
    stop();
    const token = request.current;
    setLoading(id);
    let finished = false;
    void loader
      .play(id, () => {
        finished = true;
        if (token === request.current) setPlaying(undefined);
      })
      .then((started) => {
        if (token !== request.current) return;
        setLoading(undefined);
        if (started && !finished) setPlaying(id);
      })
      .catch((error: unknown) => {
        if (token !== request.current) return;
        setLoading(undefined);
        onStatus(error instanceof Error ? error.message : String(error));
      });
  };
  return (
    <div className="project-audio-content">
      <p className="workspace-caption">
        Import WAV, MP3 or OGG (up to 10 MiB each). Codec support depends on this browser. Preview plays only this
        asset.
      </p>
      <div className="project-actions">
        <label>
          Import category{' '}
          <select
            aria-label="Audio import category"
            value={category}
            disabled={busy}
            onChange={(event) => setCategory(event.target.value as AudioCategory)}
          >
            {AUDIO_CATEGORIES.map((value) => (
              <option key={value} value={value}>
                {labels[value]}
              </option>
            ))}
          </select>
        </label>
        <button
          data-guide-id={GUIDE_TARGETS.projectAudioImport}
          className="workspace-primary workspace-button-with-icon"
          disabled={busy}
          onClick={() => fileInput.current?.click()}
        >
          <Upload size={16} aria-hidden="true" />
          Import Audio
        </button>
        <input
          ref={fileInput}
          type="file"
          accept=".wav,.mp3,.ogg,audio/wav,audio/mpeg,audio/ogg"
          aria-label="Import Audio"
          hidden
          disabled={busy}
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = '';
            if (file)
              run(async () => {
                await workspace.importAudio(file, category, loader, lifetime.current.signal);
                onStatus('Audio imported. Click Play to audition it.');
              });
          }}
        />
        <button className="workspace-button-with-icon" disabled={!playing && !loading} onClick={stop}>
          <Square size={16} fill="currentColor" aria-hidden="true" />
          Stop preview
        </button>
        <label className="project-audio-volume" data-guide-id={GUIDE_TARGETS.projectAudioPreview}>
          Preview volume
          <input
            type="range"
            aria-label="Audio preview volume"
            min={0}
            max={1}
            step={0.01}
            value={volume}
            aria-valuetext={`${Math.round(volume * 100)}%`}
            onChange={(event) => {
              const value = Number(event.currentTarget.value);
              setVolume(value);
              loader.setVolume(value);
            }}
          />
          <span className="project-audio-volume-value" aria-hidden="true">
            {Math.round(volume * 100)}%
          </span>
        </label>
      </div>
      <div aria-live="polite" className="workspace-caption">
        {loading
          ? 'Loading audio…'
          : playing
            ? `Playing ${assets.find((entry) => entry.id === playing)?.name ?? 'audio'}`
            : 'Preview stopped.'}
      </div>
      <div data-guide-id={GUIDE_TARGETS.projectAudioCategories}>
        {AUDIO_CATEGORIES.map((value) => {
          const entries = assets.filter((entry) => entry.category === value);
          return (
            <details
              key={value}
              className="project-asset-group"
              onToggle={(event) => {
                if (!event.currentTarget.open && entries.some((entry) => entry.id === auditionId)) stop();
              }}
            >
              <summary>
                {labels[value]} <span className="project-asset-count">{entries.length}</span>
              </summary>
              {!entries.length && <p className="project-asset-empty">No {labels[value].toLowerCase()} yet.</p>}
              <ul className="project-audio-list">
                {entries.map((asset) => (
                  <AudioRow
                    key={asset.id}
                    asset={asset}
                    busy={busy}
                    playing={asset.id === playing}
                    loading={asset.id === loading}
                    play={() => play(asset.id)}
                    stop={stop}
                    rename={(name) => attempt(() => workspace.updateAudio(asset.id, { name }))}
                    categorize={(category) =>
                      attempt(() => {
                        stop();
                        workspace.updateAudio(asset.id, { category });
                      })
                    }
                    remove={() =>
                      attempt(() => {
                        stop();
                        workspace.removeAudio(asset.id);
                        onStatus('Audio removed. Undo Project restores it.');
                      })
                    }
                  />
                ))}
              </ul>
            </details>
          );
        })}
      </div>
    </div>
  );
}

function AudioRow({
  asset,
  busy,
  playing,
  loading,
  play,
  stop,
  rename,
  categorize,
  remove,
}: {
  asset: AudioAssetDefinition;
  busy: boolean;
  playing: boolean;
  loading: boolean;
  play: () => void;
  stop: () => void;
  rename: (name: string) => void;
  categorize: (category: AudioCategory) => void;
  remove: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(asset.name);
  useEffect(() => setName(asset.name), [asset.name]);
  return (
    <li>
      <div className="project-audio-identity">
        <span className="project-audio-name">{asset.name}</span>
        <small>
          {asset.path} ·{' '}
          {asset.durationSeconds === undefined ? 'Duration unknown' : `${asset.durationSeconds.toFixed(2)} s`}
        </small>
      </div>
      <div className="project-actions">
        <button
          className="workspace-button-with-icon"
          disabled={busy && !playing && !loading}
          title={loading ? `Cancel loading ${asset.name}` : playing ? `Stop ${asset.name}` : `Play ${asset.name}`}
          onClick={playing || loading ? stop : play}
        >
          {playing || loading ? (
            <Square size={16} fill="currentColor" aria-hidden="true" />
          ) : (
            <Play size={16} fill="currentColor" aria-hidden="true" />
          )}
          <span>{playing || loading ? 'Stop' : 'Play'}</span>
        </button>
        <label>
          Category{' '}
          <select
            aria-label={`Category for ${asset.name}`}
            disabled={busy}
            value={asset.category}
            onChange={(event) => categorize(event.target.value as AudioCategory)}
          >
            {AUDIO_CATEGORIES.map((value) => (
              <option key={value} value={value}>
                {labels[value]}
              </option>
            ))}
          </select>
        </label>
        <button disabled={busy} onClick={() => setEditing((value) => !value)}>
          Rename
        </button>
        <button className="workspace-danger workspace-button-with-icon" disabled={busy} onClick={remove}>
          <Trash2 size={16} aria-hidden="true" />
          Remove
        </button>
      </div>
      {editing && (
        <form
          className="project-actions"
          onSubmit={(event) => {
            event.preventDefault();
            rename(name);
          }}
        >
          <label>
            Audio name{' '}
            <input
              aria-label={`Name for ${asset.name}`}
              required
              maxLength={200}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <button disabled={busy}>Apply name</button>
          <button type="button" onClick={() => setEditing(false)}>
            Done
          </button>
        </form>
      )}
    </li>
  );
}
