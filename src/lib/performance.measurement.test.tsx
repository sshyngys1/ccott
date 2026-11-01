import { Profiler } from "react";
import { act, cleanup, render, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { mockEmit, mockListenerCount, resetMock } from "../ipc/mock";
import { Eq } from "../modules/home/Eq";
import { PlayerCard } from "../modules/home/PlayerCard";
import { resetAudioStore } from "./audio/store";
import { visualizerManager } from "./audio/visualizerStore";
import { EMPTY_MEDIA } from "./media/progress";
import { resetMediaStore, useMediaPosition, useMediaStore } from "./media/store";
import { useNow } from "./useNow";

const counters = vi.hoisted(() => ({ transportRenders: 0 }));
// Allows the same probe to run against an exported 609e7a6 tree, without changing its app code.
const baseline = process.env.CCOTT_PERF_BASELINE === "1";
vi.mock("../design/icons", async importOriginal => {
  const icons = await importOriginal<typeof import("../design/icons")>();
  return { ...icons, IconPause: (props: Parameters<typeof icons.IconPause>[0]) => {
    counters.transportRenders++;
    return icons.IconPause(props);
  } };
});

afterEach(() => {
  cleanup();
  visualizerManager.resetForTests();
  resetAudioStore();
  resetMediaStore();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it("measures React commits for 200 distinct spectrum frames at 20 Hz", async () => {
  resetMock();
  let commits = 0;
  const view = render(<Profiler id="eq" onRender={() => { commits++; }}><Eq playing /></Profiler>);
  await waitFor(() => expect(mockListenerCount("audio://spectrum")).toBe(1));
  await visualizerManager.settled();
  vi.useFakeTimers({ toFake: ["Date", "performance", "setTimeout", "clearTimeout"] });
  commits = 0;
  for (let frame = 0; frame < 200; frame++) {
    act(() => {
      vi.advanceTimersByTime(50);
      mockEmit("audio://spectrum", { available: true, bands: [frame % 2, 0.25, 0.75, 1], sampledAt: Date.now() });
    });
  }
  console.info("PERF_SPECTRUM", JSON.stringify({ frames: 200, simulatedMs: 10_000, commits }));
  expect(commits).toBe(baseline ? 200 : 0);
  act(() => vi.advanceTimersByTime(75));
  expect(view.container.querySelector("i")?.style.transform).toBe("scaleY(1)");
});

it("measures UI clock work over 30s after the document becomes hidden", () => {
  vi.useFakeTimers();
  let hidden = false;
  vi.spyOn(document, "hidden", "get").mockImplementation(() => hidden);
  vi.spyOn(document, "visibilityState", "get").mockImplementation(() => hidden ? "hidden" : "visible");
  useMediaStore.getState().applyState({ ...EMPTY_MEDIA, hasSession: true, status: "playing", durationMs: 600_000, positionSampledAt: Date.now() });
  let renders = 0;
  renderHook(() => { useMediaPosition(); useNow(1000); renders++; });
  act(() => { hidden = true; document.dispatchEvent(new Event("visibilitychange")); });
  renders = 0;
  for (let tick = 0; tick < 120; tick++) act(() => vi.advanceTimersByTime(250));
  console.info("PERF_HIDDEN_CLOCKS", JSON.stringify({ simulatedMs: 30_000, renders }));
  expect(renders).toBe(baseline ? 120 : 0);
});

it("measures transport renders during 10s of timeline updates", async () => {
  resetMock();
  render(<PlayerCard />);
  await waitFor(() => expect(useMediaStore.getState().media.hasSession).toBe(true));
  vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
  // Recreate the position interval under the fake clock.
  act(() => useMediaStore.getState().applyState({ ...useMediaStore.getState().media }));
  counters.transportRenders = 0;
  for (let tick = 0; tick < 40; tick++) act(() => vi.advanceTimersByTime(250));
  console.info("PERF_PLAYER_TRANSPORT", JSON.stringify({ simulatedMs: 10_000, renders: counters.transportRenders }));
  expect(counters.transportRenders).toBe(baseline ? 40 : 0);
});
