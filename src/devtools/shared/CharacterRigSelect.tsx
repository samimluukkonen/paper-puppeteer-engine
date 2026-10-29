/** Shared stable-character rig picker for project comparison and animation browsing. */
export function CharacterRigSelect({
  label,
  value,
  choices,
  emptyLabel,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  choices: readonly { readonly id: string; readonly name: string }[];
  emptyLabel: string;
  disabled?: boolean | undefined;
  onChange(this: void, id: string): void;
}) {
  return (
    <label>
      {label}
      <select aria-label={label} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}>
        <option value="">{emptyLabel}</option>
        {choices.map((entry) => (
          <option key={entry.id} value={entry.id}>
            {entry.name} ({entry.id})
          </option>
        ))}
      </select>
    </label>
  );
}
