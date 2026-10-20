import { useEffect, useRef, useState } from 'react';

export function InspectorNumberField({
  label,
  value,
  min,
  max,
  onCommit,
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  onCommit: (value: number) => void;
}) {
  const [text, setText] = useState(String(value));
  const cancelled = useRef(false);
  useEffect(() => setText(String(value)), [value]);
  const valid =
    text.trim() !== '' &&
    Number.isFinite(Number(text)) &&
    (min === undefined || Number(text) >= min) &&
    (max === undefined || Number(text) <= max);
  return (
    <label>
      {label}
      <input
        aria-label={label}
        type="number"
        step="any"
        min={min}
        max={max}
        value={text}
        aria-invalid={!valid}
        onChange={(event) => setText(event.target.value)}
        onBlur={() => {
          if (cancelled.current) {
            cancelled.current = false;
            setText(String(value));
            return;
          }
          if (valid && Number(text) !== value) onCommit(Number(text));
          else setText(String(value));
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            event.currentTarget.blur();
          }
          if (event.key === 'Escape') {
            cancelled.current = true;
            setText(String(value));
            event.currentTarget.blur();
          }
        }}
      />
    </label>
  );
}
