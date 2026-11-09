// Owner: F2. Synced lyrics (§30): one store + one controller. The controller only exists while the `lyrics` feature is on:
// switching it off removes every subscription and timer. Track change → 300 ms debounce → `lyrics_get`; the cover → palette.
import { useEffect } from "react";
import { create } from "zustand";
import { LYRICS_FALLBACK, paletteFromImage, type LyricsPalette } from "../../design/lyrics";
import { invoke } from "../../ipc";
import type { LyricsLine, LyricsResult, MediaState } from "../../shared/types";
import { useIslandStore } from "../../store";
import { isFeatureEnabled } from "../features";
import { useMediaStore } from "../media/store";
import { trackKey, withInterludes } from "./lines";

export type LyricsStatus = "idle" | "off" | "loading" | "synced" | "plain" | "instrumental" | "notFound" | "error";

export const LYRICS_DEBOUNCE_MS = 300;
const CLIENT_CACHE_SIZE = 24;

export interface LyricsStore {
  /** Track the data below belongs to (`trackKey`); "" = no track. */
  key: string;
  status: LyricsStatus;
  /** Synced lines with interludes (status "synced"). */
  lines: LyricsLine[];
  /** Plain text (status "plain"). */
  text: string;
  source: "lrclib" | "cache" | null;
  palette: LyricsPalette;
  /** Asks the backend again (the "Retry" button). */
  retry: () => void;
}

const EMPTY = { key: "", status: "idle" as LyricsStatus, lines: [] as LyricsLine[], text: "", source: null as "lrclib" | "cache" | null };

export const useLyricsStore = create<LyricsStore>()(() => ({
  ...EMPTY,
  palette: LYRICS_FALLBACK,
  retry: () => controller?.retry(),
}));

type Settled = Exclude<LyricsResult, { status: "error" }>;

function fromResult(result: LyricsResult): Pick<LyricsStore, "status" | "lines" | "text" | "source"> {
  switch (result.status) {
    case "synced":
      return { status: "synced", lines: withInterludes([...result.lines].sort((a, b) => a.timeMs - b.timeMs)), text: "", source: result.source };
    case "plain":
      return { status: "plain", lines: [], text: result.text, source: result.source };
    case "instrumental":
      return { status: "instrumental", lines: [], text: "", source: null };
    case "notFound":
      return { status: "notFound", lines: [], text: "", source: null };
    case "error":
      return { status: "error", lines: [], text: "", source: null };
  }
}

interface Controller {
  retry: () => void;
  stop: () => void;
}
let controller: Controller | null = null;
let subscribers = 0;

function currentTrack(m: MediaState) {
  const key = trackKey(m);
  return key ? { key, title: m.title, artist: m.artist, album: m.album, durationMs: m.durationMs } : null;
}

function createController(): Controller {
  const cache = new Map<string, Settled>();
  const palettes = new Map<string, LyricsPalette>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let requestSeq = 0;
  let paletteSeq = 0;
  let paletteSource = "";
  let stopped = false;

  const searchOn = () => useIslandStore.getState().settings.lyrics.enabled;

  const request = (track: NonNullable<ReturnType<typeof currentTrack>>, force: boolean) => {
    const seq = ++requestSeq;
    useLyricsStore.setState({ ...EMPTY, key: track.key, status: "loading" });
    invoke("lyrics_get", { title: track.title, artist: track.artist, album: track.album, durationMs: track.durationMs, force }).then(
      (result) => settle(seq, track.key, result),
      (err: unknown) => settle(seq, track.key, { status: "error", message: err instanceof Error ? err.message : String(err) }),
    );
  };

  const settle = (seq: number, key: string, result: LyricsResult) => {
    // A late answer for a track that is no longer current (or a stopped controller) is dropped.
    if (stopped || seq !== requestSeq || useLyricsStore.getState().key !== key) return;
    if (result.status !== "error") {
      cache.delete(key);
      cache.set(key, result);
      if (cache.size > CLIENT_CACHE_SIZE) cache.delete(cache.keys().next().value as string);
    }
    useLyricsStore.setState({ key, ...fromResult(result) });
  };

  /** Brings the lyrics state in line with the current track: cache hit → instant, otherwise debounce + request. */
  const sync = (force = false) => {
    clearTimeout(timer);
    timer = undefined;
    const track = currentTrack(useMediaStore.getState().media);
    const state = useLyricsStore.getState();
    if (!track) {
      requestSeq++;
      if (state.key !== "") useLyricsStore.setState({ ...EMPTY });
      return;
    }
    if (!searchOn()) {
      requestSeq++;
      useLyricsStore.setState({ ...EMPTY, key: track.key, status: "off" });
      return;
    }
    if (!force && state.key === track.key && state.status !== "off") return;
    const hit = force ? undefined : cache.get(track.key);
    if (hit) {
      requestSeq++;
      useLyricsStore.setState({ key: track.key, ...fromResult(hit) });
      return;
    }
    requestSeq++;
    useLyricsStore.setState({ ...EMPTY, key: track.key, status: "loading" });
    timer = setTimeout(() => {
      timer = undefined;
      const now = currentTrack(useMediaStore.getState().media);
      if (!stopped && now && now.key === track.key && searchOn()) request(now, force);
    }, LYRICS_DEBOUNCE_MS);
  };

  /** Cover → palette, once per (cover, theme). Without a decoded cover the fallback teal is used. */
  const syncPalette = () => {
    const artwork = useMediaStore.getState().media.artwork;
    const theme = useIslandStore.getState().theme;
    const source = `${theme}:${artwork ?? ""}`;
    if (source === paletteSource) return;
    paletteSource = source;
    const seq = ++paletteSeq;
    if (!artwork) {
      useLyricsStore.setState({ palette: LYRICS_FALLBACK });
      return;
    }
    const cached = palettes.get(source);
    if (cached) {
      useLyricsStore.setState({ palette: cached });
      return;
    }
    const img = new Image();
    const done = (palette: LyricsPalette) => {
      if (stopped || seq !== paletteSeq) return;
      palettes.set(source, palette);
      if (palettes.size > CLIENT_CACHE_SIZE) palettes.delete(palettes.keys().next().value as string);
      useLyricsStore.setState({ palette });
    };
    img.onload = () => done(paletteFromImage(img, theme));
    img.onerror = () => done(LYRICS_FALLBACK);
    img.src = artwork;
  };

  const offMedia = useMediaStore.subscribe((s, prev) => {
    if (s.media === prev.media) return;
    sync();
    syncPalette();
  });
  const offIsland = useIslandStore.subscribe((s, prev) => {
    if (s.settings.lyrics.enabled !== prev.settings.lyrics.enabled) sync(true);
    if (s.theme !== prev.theme) syncPalette();
  });
  sync();
  syncPalette();

  return {
    retry: () => sync(true),
    stop: () => {
      stopped = true;
      clearTimeout(timer);
      requestSeq++;
      paletteSeq++;
      offMedia();
      offIsland();
      useLyricsStore.setState({ ...EMPTY, palette: LYRICS_FALLBACK });
    },
  };
}

/**
 * Mounted once by the shell. While the `lyrics` feature is switched off nothing is subscribed, no timer runs and the
 * store stays empty (design-spec §6.11 / contracts §23).
 */
export function useLyricsController(): void {
  const featureOn = useIslandStore((s) => isFeatureEnabled("lyrics", s.settings.disabledFeatures));
  useEffect(() => {
    if (!featureOn) return;
    if (subscribers++ === 0) controller = createController();
    return () => {
      if (--subscribers === 0) {
        controller?.stop();
        controller = null;
      }
    };
  }, [featureOn]);
}

/** Tests: stop the controller and clear the store. */
export function resetLyricsStore(): void {
  controller?.stop();
  controller = null;
  subscribers = 0;
  useLyricsStore.setState({ ...EMPTY, palette: LYRICS_FALLBACK });
}

/** Lyrics of the track that is playing right now (never of the previous one). */
export function useCurrentLyrics(): LyricsStore {
  const lyrics = useLyricsStore();
  const key = useMediaStore((s) => trackKey(s.media));
  return lyrics.key === key ? lyrics : { ...lyrics, ...EMPTY, status: key ? "loading" : "idle" };
}
