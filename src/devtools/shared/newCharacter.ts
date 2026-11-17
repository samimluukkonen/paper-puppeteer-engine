import { z } from 'zod';
import { characterCatalog } from '../../shared/characterCatalog.js';

/** Identity rules for new characters; editor documents are built by `animation-editor/characterDocuments.ts`. */
export const newCharacterSchema = z.strictObject({
  name: z
    .string()
    .trim()
    .min(1, 'Enter a character name.')
    .max(100)
    .refine(
      (value) => value.split('').every((char) => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127),
      'Names cannot contain control characters.',
    ),
  id: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use lowercase letters, numbers, and single hyphens between words.'),
});
export type NewCharacterOptions = z.infer<typeof newCharacterSchema>;

export function assertCharacterIdAvailable(id: string, existingIds: readonly string[] = []): void {
  if ([...characterCatalog.map((entry) => entry.id), ...existingIds].some((existing) => existing.toLowerCase() === id))
    throw new Error(`Character ID "${id}" already exists.`);
}

export function suggestCharacterId(name: string, existingIds: readonly string[] = []): string {
  const stem =
    name
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 56)
      .replace(/-$/, '') || 'character';
  const used = new Set(existingIds.map((id) => id.toLowerCase()));
  let id = stem;
  let suffix = 1;
  while (used.has(id)) id = `${stem}-${++suffix}`;
  return id;
}
