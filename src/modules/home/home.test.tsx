import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as ipc from "../../ipc";
import { mockEmit, mockListenerCount, resetMock } from "../../ipc/mock";
import { resetAudioStore, useAudioStore } from "../../lib/audio/store";
import { EMPTY_MEDIA } from "../../lib/media/progress";
import { resetMediaStore, useMediaStore } from "../../lib/media/store";
import { onShellRequest, type ShellRequest } from "../../shared/shellBus";
import type { AudioDevice } from "../../shared/types";
import home from "./index";
import { HomeTab as RawHomeTab, SHOW_UPCOMING_TOOLS } from "./HomeTab";
import { MediaPill } from "./MediaPill";

const HomeTab = home.Tab;

beforeEach(() => {
  resetMock();
  resetMediaStore();
  resetAudioStore();
});
afterEach(() => {
  cleanup();
  resetMediaStore();
  resetAudioStore();
  vi.restoreAllMocks();
});

async function mountHome() {
  render(<HomeTab />);
  await screen.findByText("Полночный маршрут");
  await waitFor(() => expect(screen.getByRole("slider", { name: "Громкость" })).toHaveValue("64"));
}

describe("module definition", () => {
  it("has a compact activity below the timer's priority", () => {
    expect(home.id).toBe("home");
    expect(home.compact?.priority).toBe(10);
  });
});

describe("Home tab: player", () => {
  it("shows a readable, truncatable PWA source instead of the SMTC profile id", async () => {
    await mountHome();
    act(() => mockEmit("media://changed", { ...EMPTY_MEDIA, hasSession: true, sourceApp: "Chrome._crx_cinhiknlkffjgod.UserData.Profile1", title: "Track" }));
    expect(screen.getByText("Сейчас играет · Chrome")).toHaveClass("ig-truncate", "hm-source");
    expect(screen.queryByText(/UserData/)).toBeNull();
  });
  it("shows the current track from the mock", async () => {
    await mountHome();
    expect(screen.getByText("Северные огни")).toBeInTheDocument();
    expect(screen.getByText(/Сейчас играет · Spotify/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Пауза" })).toBeEnabled();
    expect(screen.getByRole("heading", { name: "Главная" })).toBeInTheDocument();
  });

  it("play/pause calls the backend and the button flips", async () => {
    await mountHome();
    fireEvent.click(screen.getByRole("button", { name: "Пауза" }));
    expect(await screen.findByRole("button", { name: "Воспроизвести" })).toBeInTheDocument();
    expect((await ipc.invoke("media_get_state")).status).toBe("paused");
  });

  it("next switches the track (media://changed)", async () => {
    await mountHome();
    await waitFor(() => expect(mockListenerCount("media://changed")).toBe(1));
    fireEvent.click(screen.getByRole("button", { name: "Следующий трек" }));
    expect(await screen.findByText("Стекло и дождь")).toBeInTheDocument();
  });

  it("buttons follow the can* flags", async () => {
    await mountHome();
    await waitFor(() => expect(mockListenerCount("media://changed")).toBe(1));
    act(() => mockEmit("media://changed", { ...useMediaStore.getState().media, canNext: false, canPrevious: false, canSeek: false }));
    expect(screen.getByRole("button", { name: "Следующий трек" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Предыдущий трек" })).toBeDisabled();
    expect(screen.getByRole("slider", { name: "Позиция трека" })).toBeDisabled();
  });

  it("the progress is extrapolated while playing", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    try {
      useMediaStore.getState().applyState({ ...EMPTY_MEDIA, hasSession: true, title: "T", artist: "A", status: "playing", positionMs: 60_000, durationMs: 200_000, positionSampledAt: Date.now(), canSeek: true, canPlayPause: true });
      render(<HomeTab />);
      expect(screen.getByText("1:00")).toBeInTheDocument();
      act(() => {
        vi.advanceTimersByTime(5000);
      });
      expect(screen.getByText("1:05")).toBeInTheDocument();
      expect(screen.getByText("3:20")).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("dragging the progress slider seeks once on release", async () => {
    await mountHome();
    const spy = vi.spyOn(ipc, "invoke");
    const slider = screen.getByRole("slider", { name: "Позиция трека" });
    fireEvent.change(slider, { target: { value: "100000" } });
    fireEvent.change(slider, { target: { value: "120000" } });
    expect(spy.mock.calls.filter((c) => c[0] === "media_seek")).toHaveLength(0);
    fireEvent.pointerUp(slider);
    await waitFor(() => expect(spy).toHaveBeenCalledWith("media_seek", { positionMs: 120000 }));
    expect(spy.mock.calls.filter((c) => c[0] === "media_seek")).toHaveLength(1);
  });

  it("empty state without a media session", async () => {
    render(<HomeTab />);
    await waitFor(() => expect(mockListenerCount("media://changed")).toBe(1));
    act(() => mockEmit("media://changed", EMPTY_MEDIA));
    expect(screen.getByText("Ничего не играет")).toBeInTheDocument();
    expect(screen.getByText("Запустите любой плеер")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Воспроизвести" })).toBeDisabled();
    expect(screen.getByRole("slider", { name: "Позиция трека" })).toBeDisabled();
    expect(screen.getAllByText("–:––")).toHaveLength(2);
  });
});

describe("Home tab: volume", () => {
  it.each([1, 3])("keeps names and titles for %i long-named devices with one roving option", async (count) => {
    await mountHome();
    const devices: AudioDevice[] = [
      { id: "dev-speakers", name: "Динамики (Realtek(R) Audio — очень длинное название устройства вывода)", isDefault: true },
      { id: "dev-headphones", name: "Наушники Bluetooth — длинное название аудиоустройства для конференций", isDefault: false },
      { id: "dev-monitor", name: "Монитор HDMI — ещё одно очень длинное название устройства вывода", isDefault: false },
    ].slice(0, count);
    const original = ipc.invoke;
    vi.spyOn(ipc, "invoke").mockImplementation(((...args: Parameters<typeof ipc.invoke>) => args[0] === "audio_list_devices" ? Promise.resolve(devices) : original(...args)) as typeof ipc.invoke);
    act(() => useAudioStore.getState().applyState({ volume: 64, muted: false, device: devices[0] }));
    const trigger = screen.getByRole("button", { name: devices[0].name });
    expect(trigger).toHaveAttribute("title", devices[0].name);
    expect(trigger.querySelector("span")?.textContent).toBe(devices[0].name);
    fireEvent.click(trigger);
    const first = await screen.findByRole("option", { name: devices[0].name });
    await waitFor(() => expect(first).toHaveFocus());
    expect(first).toHaveAttribute("aria-selected", "true");
    expect(screen.getAllByRole("option")).toHaveLength(count);
    for (const [index, option] of screen.getAllByRole("option").entries()) expect(option).toHaveAttribute("title", devices[index].name);
    fireEvent.keyDown(first, { key: "End" });
    const last = screen.getByRole("option", { name: devices[count - 1].name });
    expect(last).toHaveFocus();
    expect(screen.getAllByRole("option").filter((el) => el.tabIndex === 0)).toEqual([last]);
    fireEvent.keyDown(last, { key: "ArrowDown" });
    expect(first).toHaveFocus();
    fireEvent.keyDown(first, { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(trigger).toHaveFocus();
  });
  it("moving the slider sets the volume", async () => {
    await mountHome();
    fireEvent.change(screen.getByRole("slider", { name: "Громкость" }), { target: { value: "30" } });
    expect(screen.getByText("30%")).toBeInTheDocument();
    await waitFor(async () => expect((await ipc.invoke("audio_get_state")).volume).toBe(30));
  });

  it("mute toggles, shows «Без звука», and moving the slider un-mutes", async () => {
    await mountHome();
    const mute = screen.getByRole("button", { name: "Выключить звук" });
    fireEvent.click(mute);
    expect(await screen.findByText("Без звука")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Включить звук" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("slider", { name: "Громкость" })).toHaveAttribute("data-muted", "true");
    fireEvent.change(screen.getByRole("slider", { name: "Громкость" }), { target: { value: "50" } });
    await waitFor(() => expect(screen.queryByText("Без звука")).toBeNull());
    await waitFor(async () => expect((await ipc.invoke("audio_get_state")).muted).toBe(false));
  });

  it("the device chip lists devices and switches", async () => {
    await mountHome();
    fireEvent.click(screen.getByRole("button", { name: /Динамики/ }));
    fireEvent.click(await screen.findByRole("option", { name: "Наушники (Bluetooth)" }));
    await waitFor(() => expect(screen.getByRole("button", { name: /Наушники/ })).toBeInTheDocument());
    expect(screen.queryByRole("listbox", { name: "Устройство вывода" })).toBeNull();
  });
  it("device options have no nested controls and support keyboard selection", async () => {
    await mountHome();
    fireEvent.click(screen.getByRole("button", { name: /Динамики/ }));
    const first = await screen.findByRole("option", { name: "Динамики" });
    await waitFor(() => expect(first).toHaveFocus());
    for (const option of screen.getAllByRole("option")) expect(option.querySelector("button, input, select")).toBeNull();
    fireEvent.keyDown(first, { key: "ArrowDown" });
    const next = screen.getByRole("option", { name: "Наушники (Bluetooth)" });
    expect(next).toHaveFocus();
    fireEvent.keyDown(next, { key: "Enter" });
    await waitFor(async () => expect((await ipc.invoke("audio_get_state")).device?.id).toBe("dev-headphones"));
  });

  it("wheel on the volume card adjusts volume by ±2% per step, accumulates small touchpad deltas, un-mutes on increase and prevents default scroll", async () => {
    await mountHome();
    const card = screen.getByRole("region", { name: "Громкость" });

    // Single mouse-wheel notch up (-100) → +2% (64 → 66) and preventDefault().
    const upEvent = new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: -100 });
    act(() => {
      card.dispatchEvent(upEvent);
    });
    expect(upEvent.defaultPrevented).toBe(true);
    expect(screen.getByText("66%")).toBeInTheDocument();

    // Single mouse-wheel notch down (+100) → -2% (66 → 64).
    fireEvent.wheel(card, { deltaY: 100 });
    expect(screen.getByText("64%")).toBeInTheDocument();

    // Small touchpad deltas accumulate before stepping.
    fireEvent.wheel(card, { deltaY: -15 });
    fireEvent.wheel(card, { deltaY: -15 });
    expect(screen.getByText("64%")).toBeInTheDocument();
    fireEvent.wheel(card, { deltaY: -15 });
    expect(screen.getByText("66%")).toBeInTheDocument();

    // Mute: wheel down keeps muted, wheel up un-mutes.
    fireEvent.click(screen.getByRole("button", { name: "Выключить звук" }));
    expect(await screen.findByText("Без звука")).toBeInTheDocument();
    fireEvent.wheel(card, { deltaY: 100 });
    expect(screen.getByText("Без звука")).toBeInTheDocument();
    expect(useAudioStore.getState().audio.volume).toBe(64);

    fireEvent.wheel(card, { deltaY: -100 });
    await waitFor(() => expect(screen.queryByText("Без звука")).toBeNull());
    expect(screen.getByText("66%")).toBeInTheDocument();
    await waitFor(async () => {
      const state = await ipc.invoke("audio_get_state");
      expect(state.muted).toBe(false);
      expect(state.volume).toBe(66);
    });
  });
});

describe("Home tab: placeholders", () => {
  it("hides upcoming tool tiles and dock by default in v0.1", async () => {
    expect(SHOW_UPCOMING_TOOLS).toBe(false);
    await mountHome();
    expect(screen.queryByRole("region", { name: "Быстрые инструменты" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Док" })).toBeNull();
    expect(screen.queryByRole("button", { name: /QR-код/ })).toBeNull();
    expect(screen.queryByText("Перетащите сюда приложение или папку")).toBeNull();
    expect(screen.getByRole("region", { name: "Мини-плеер" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Громкость" })).toBeInTheDocument();
  });

  it("tool tiles and dock remain available behind showUpcomingTools and say «Скоро»", async () => {
    render(<RawHomeTab showUpcomingTools />);
    await screen.findByText("Полночный маршрут");
    const tile = screen.getByRole("button", { name: /QR-код/ });
    expect(tile).toHaveAttribute("title", "Скоро");
    expect(tile).toHaveAttribute("aria-disabled", "true");
    expect(document.querySelectorAll('.hm-tools [aria-disabled="true"], .hm-dock-app[aria-disabled="true"]')).toHaveLength(14);
    expect(() => fireEvent.click(tile)).not.toThrow();
    expect(screen.getByText("Перетащите сюда приложение или папку")).toBeInTheDocument();
  });
});

describe("media pill (compact)", () => {
  it("shows the track and opens the Home tab on click", async () => {
    const requests: ShellRequest[] = [];
    const off = onShellRequest((r) => { requests.push(r); });
    try {
      useMediaStore.getState().applyState({ ...EMPTY_MEDIA, hasSession: true, title: "Трек", artist: "Артист", status: "playing", canPlayPause: true });
      render(<MediaPill />);
      expect(screen.getByText("Трек")).toBeInTheDocument();
      expect(screen.getByText(/Артист/)).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button"));
      expect(requests).toEqual([{ type: "openTab", tab: "home" }]);
    } finally {
      off();
    }
  });

  it("paused: static equalizer and paused state", () => {
    useMediaStore.getState().applyState({ ...EMPTY_MEDIA, hasSession: true, title: "Трек", status: "paused" });
    const { container } = render(<MediaPill />);
    expect(container.querySelector(".ig-eq")).toHaveAttribute("data-playing", "false");
    expect(screen.getByRole("button")).toHaveAttribute("data-state", "paused");
  });

  it("useIsActive is wired to the media store", async () => {
    const { result } = renderHook(() => home.compact!.useIsActive());
    expect(result.current).toBe(false);
    await waitFor(() => expect(result.current).toBe(true)); // the mock plays a track
  });
});
