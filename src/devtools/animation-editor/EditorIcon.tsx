import { ChevronFirst, ChevronLast, Minus, Pause, Play, Plus, Redo2, Repeat, SkipBack, Undo2 } from 'lucide-react';

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
