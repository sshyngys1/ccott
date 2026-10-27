import { afterEach, describe, expect, it, vi } from "vitest";
import { CHIME_NOTES, playChime, primeAudio, resetChime } from "./chime";

function fakeContext() {
  const oscillators: Array<{ frequency: { value: number }; start: ReturnType<typeof vi.fn> }> = [];
  class FakeAudioContext {
    state = "suspended";
    currentTime = 10;
    destination = {};
    resume = vi.fn(async () => {
      this.state = "running";
    });
    createOscillator() {
      const osc = { type: "sine", frequency: { value: 0 }, connect: (n: unknown) => n, start: vi.fn(), stop: vi.fn() };
      oscillators.push(osc);
      return osc;
    }
    createGain() {
      return { gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() }, connect: (n: unknown) => n };
    }
  }
  return { Ctor: FakeAudioContext, oscillators };
}

afterEach(() => {
  resetChime();
  vi.unstubAllGlobals();
});

describe("chime", () => {
  it("does nothing (and does not throw) without Web Audio", () => {
    vi.stubGlobal("AudioContext", undefined);
    expect(() => primeAudio()).not.toThrow();
    expect(playChime()).toBe(false);
  });

  it("schedules one soft sine per note, starting in the future", () => {
    const { Ctor, oscillators } = fakeContext();
    vi.stubGlobal("AudioContext", Ctor);
    expect(playChime()).toBe(true);
    expect(oscillators.map((o) => o.frequency.value)).toEqual([...CHIME_NOTES]);
    const starts = oscillators.map((o) => o.start.mock.calls[0][0] as number);
    expect(starts[0]).toBeGreaterThan(10);
    expect(starts[1]).toBeGreaterThan(starts[0]);
  });

  it("primeAudio resumes a suspended context once and playChime reuses it", () => {
    const { Ctor } = fakeContext();
    const ctorSpy = vi.fn(function () {
      return new Ctor();
    });
    vi.stubGlobal("AudioContext", ctorSpy);
    primeAudio();
    playChime();
    expect(ctorSpy).toHaveBeenCalledTimes(1);
  });

  it("a throwing AudioContext is survived", () => {
    vi.stubGlobal(
      "AudioContext",
      class {
        constructor() {
          throw new Error("denied");
        }
      },
    );
    expect(playChime()).toBe(false);
  });
});
