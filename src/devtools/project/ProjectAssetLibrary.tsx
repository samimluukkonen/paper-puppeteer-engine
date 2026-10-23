import { Image as ImageIcon } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { mergeSkins } from '../../engine/mergeSkins.js';
import type { PackageFiles, PackageSnapshot } from '../shared/package/characterPackage.js';

function AssetGroup({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <details className="project-asset-group" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>
        {title} <span className="project-asset-count">{count}</span>
      </summary>
      {open && (count ? children : <p className="project-asset-empty">No {title.toLowerCase()} yet.</p>)}
    </details>
  );
}

function AssetImage({
  assetKey,
  snapshot,
  files,
}: {
  assetKey: string;
  snapshot: PackageSnapshot;
  files: PackageFiles;
}) {
  const replacement = snapshot.replacements.find((entry) => entry.assetKey === assetKey && !entry.reference);
  const path = snapshot.definition.textures[assetKey];
  const bytes = path ? files.get(path) : undefined;
  const blob = useMemo(() => replacement?.blob ?? (bytes ? new Blob([bytes]) : undefined), [replacement?.blob, bytes]);
  const [url, setUrl] = useState('');
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setFailed(false);
    if (!blob) {
      setUrl('');
      return;
    }
    const next = URL.createObjectURL(blob);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [blob]);
  return (
    <li className="project-image-item">
      <span className="project-image-preview" aria-hidden="true">
        {url && !failed ? (
          <img src={url} alt="" loading="lazy" onError={() => setFailed(true)} />
        ) : (
          <ImageIcon size={20} />
        )}
      </span>
      <div>
        <span className="project-asset-name">{assetKey}</span>
        {(!blob || failed) && <small>Preview unavailable</small>}
      </div>
    </li>
  );
}

/** Read-only inventory of the same committed snapshot used by project export. */
export function ProjectAssetLibrary({
  name,
  snapshot,
  files,
}: {
  name: string;
  snapshot: PackageSnapshot;
  files: PackageFiles;
}) {
  const [open, setOpen] = useState(false);
  const images = [
    ...new Set([...Object.keys(snapshot.definition.textures), ...snapshot.replacements.map((entry) => entry.assetKey)]),
  ];
  const skins = mergeSkins(snapshot.rig.skins ?? [], snapshot.skins);
  const attachments = snapshot.rig.attachments ?? [];
  const poses = snapshot.poses ?? snapshot.definition.poses;
  return (
    <details className="project-asset-library" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>{name} asset library</summary>
      {open && (
        <div className="project-asset-content">
          <div className="project-rig-summary">
            <strong>Rig</strong>
            <span>
              {snapshot.rig.bones.length} bones · {snapshot.rig.slots?.length ?? 0} slots ·{' '}
              {snapshot.rig.ik?.length ?? 0} IK constraints
            </span>
            <code>{snapshot.definition.rigPath}</code>
          </div>
          <AssetGroup title="Images" count={images.length}>
            <ul className="project-image-list">
              {images.map((assetKey) => (
                <AssetImage key={assetKey} assetKey={assetKey} snapshot={snapshot} files={files} />
              ))}
            </ul>
          </AssetGroup>
          <AssetGroup title="Animations" count={snapshot.animations.length}>
            <ul className="project-asset-list">
              {snapshot.animations.map((clip) => (
                <li key={clip.name}>
                  <span className="project-asset-name">{clip.name}</span>
                  <small>
                    {clip.duration / 1000} s · {clip.loop ? 'Looping' : 'Play once'}
                  </small>
                </li>
              ))}
            </ul>
          </AssetGroup>
          <AssetGroup title="Poses" count={poses.length}>
            <ul className="project-asset-list">
              {poses.map((pose) => (
                <li key={pose.library?.id ?? pose.name}>
                  <span className="project-asset-name">{pose.name}</span>
                  <small>{Object.keys(pose.bones).length} bones · FK local transforms</small>
                </li>
              ))}
            </ul>
          </AssetGroup>
          <AssetGroup title="Skins" count={skins.length}>
            <ul className="project-asset-list">
              {skins.map((skin) => (
                <li key={skin.name}>
                  <span className="project-asset-name">{skin.name}</span>
                  <small>
                    {skin.name === snapshot.definition.defaultSkin ? 'Default skin · ' : ''}
                    {Object.keys(skin.slots).length} slot assignments
                  </small>
                </li>
              ))}
            </ul>
          </AssetGroup>
          <AssetGroup title="Attachments" count={attachments.length}>
            <ul className="project-asset-list">
              {attachments.map((attachment) => (
                <li key={attachment.id}>
                  <span className="project-asset-name">{attachment.id}</span>
                  <small>Image: {attachment.texture}</small>
                </li>
              ))}
            </ul>
          </AssetGroup>
        </div>
      )}
    </details>
  );
}
