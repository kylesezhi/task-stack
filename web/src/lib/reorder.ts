/**
 * Pure drop math for the list sheet's drag-to-reorder (T19; sources:
 * TASKS.md T19, DESIGN.md §5.3).
 *
 * Semantics — "insert at the target's slot": the dragged id is removed and
 * re-inserted at the target id's PRE-removal index, so dragging the last row
 * onto the first moves it to the top and the first onto the last moves it to
 * the bottom. Dropping on itself (or any id not present, defensively) is a
 * no-op that still returns a fresh array — call sites own no falsy handling.
 *
 * Framework-free and DOM-free (plain ids, like view-state.ts) so it loads in
 * Node under vitest and the Svelte/DOM glue stays in ListView.svelte. Pure:
 * the input array is never mutated (the snapshot arrays must not be sorted
 * or spliced in place anywhere in this app).
 */
export function reorderNoteIds(
  ids: readonly string[],
  draggedId: string,
  targetId: string,
): string[] {
  const draggedIndex = ids.indexOf(draggedId);
  const targetIndex = ids.indexOf(targetId);
  if (draggedIndex === -1 || targetIndex === -1 || draggedId === targetId) {
    return [...ids];
  }
  // Pre-removal target slot; indexOf of the remaining items shifts only for
  // indexes AFTER the dragged one, and inserting before that shifted slot
  // still lands on the target row.
  const next = [...ids];
  next.splice(draggedIndex, 1);
  next.splice(targetIndex, 0, draggedId);
  return next;
}
