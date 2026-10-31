import ChevronFirst from 'lucide-react/icons/chevron-first';
import ChevronLast from 'lucide-react/icons/chevron-last';
import Minus from 'lucide-react/icons/minus';
import Pause from 'lucide-react/icons/pause';
import Play from 'lucide-react/icons/play';
import Plus from 'lucide-react/icons/plus';
import Redo2 from 'lucide-react/icons/redo-2';
import Repeat from 'lucide-react/icons/repeat';
import SkipBack from 'lucide-react/icons/skip-back';
import Undo2 from 'lucide-react/icons/undo-2';

const icons = {
  undo: Undo2,
  redo: Redo2,
  play: Play,
  pause: Pause,
  restart: SkipBack,
  loop: Repeat,
  previousKey: ChevronFirst,
  nextKey: ChevronLast,
  minus: Minus,
  plus: Plus,
} as const;

/** A small, consistent SVG vocabulary for familiar editor commands. */
export function EditorIcon({ name }: { name: keyof typeof icons }) {
  const Icon = icons[name];
  return (
    <Icon
      className={`editor-icon editor-icon-${name}`}
      size={18}
      strokeWidth={1.8}
      aria-hidden="true"
      focusable="false"
    />
  );
}
