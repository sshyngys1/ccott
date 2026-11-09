// Browser mock of `lyrics_get` (§30). Every line below is INVENTED for the mock: no real song text belongs in the repository.
import type { LyricsLine, LyricsResult } from "../shared/types";

const PHRASES = [
  "Lanterns drift across the quiet harbor",
  "Somebody left the signal light on",
  "We count the tides in paper boats",
  "Salt on the window, slow and bright",
  "Nobody knows the name of this street",
  "Hold the compass, I will hold the map",
  "A thousand windows learning how to glow",
  "The morning rehearses its pale gold",
  "Echoes fold themselves into the fog",
  "Keep the porch lamp burning till we're home",
  "Small clocks argue in the empty hall",
  "Every wave erases what it wrote",
  "Read the weather in the lighthouse glass",
  "A long way down to where the river starts",
  // Long lines exercise the adaptive pill width and the slow scroll of lines wider than the widest pill.
  "Every paper lantern on the harbor wall remembers a different borrowed name",
  "Nobody in the whole sleeping city could ever count how many invented windows were lit along the long grey river that night",
];

/** ~28 synced lines, one explicit interlude (an empty line), then a long pause that the UI turns into the dots. */
function syncedLines(): LyricsLine[] {
  const lines: LyricsLine[] = [];
  for (let i = 0; i < 28; i++) {
    lines.push({ timeMs: 4000 + i * 6500 + (i > 9 ? 9000 : 0), text: PHRASES[i % PHRASES.length] });
  }
  lines.splice(9, 0, { timeMs: 4000 + 8 * 6500 + 4200, text: "" });
  return lines;
}

const PLAIN = PHRASES.slice(0, 8).join("\n") + "\n\n" + PHRASES.slice(8).join("\n");

export const lyricsMockConfig = {
  /** Artificial network latency so the loading state is visible. */
  delayMs: 200,
  /** Next call(s) fail with `{ status: "error" }`. */
  fail: false,
};

/** Track 0 → synced, 1 → plain text, 2 → instrumental, anything else → not found. */
export function mockLyricsResult(trackIndex: number): LyricsResult {
  if (trackIndex === 0) return { status: "synced", lines: syncedLines(), source: "lrclib" };
  if (trackIndex === 1) return { status: "plain", text: PLAIN, source: "lrclib" };
  if (trackIndex === 2) return { status: "instrumental" };
  return { status: "notFound" };
}

export async function mockLyricsGet(trackIndex: number, allowed: boolean): Promise<LyricsResult> {
  // Same contract as Rust: setting off / feature off → notFound without any "network".
  if (!allowed) return { status: "notFound" };
  await new Promise((resolve) => setTimeout(resolve, lyricsMockConfig.delayMs));
  if (lyricsMockConfig.fail) return { status: "error", message: "mock offline" };
  return mockLyricsResult(trackIndex);
}
