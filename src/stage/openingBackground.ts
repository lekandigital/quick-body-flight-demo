/** Random opening from the current catalog; avoid an immediate repeat when
 * the browser remembers the preceding opening. No scene-switching timer. */
export function chooseOpeningBackground(ids: readonly string[], previous: string | null, random = Math.random): string {
  if (!ids.length) throw new Error('No backgrounds available for the opening');
  const alternatives = ids.filter((id) => id !== previous);
  const choices = alternatives.length ? alternatives : ids;
  return choices[Math.floor(random() * choices.length)];
}
