// Clipboard action feedback goes through the shell bus and survives the panel collapsing.
/** Human text for a failed paste. The backend message is only used to tell «nowhere to paste» from other failures. */
export function pasteErrorText(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return /no window/i.test(msg) ? "Нет окна для вставки" : "Не удалось вставить";
}
