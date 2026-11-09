import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockInvoke, mockListen, resetMock } from "./mock";
import type { Reminder } from "../shared/types";

beforeEach(() => { resetMock(); vi.useFakeTimers(); vi.setSystemTime(100_000); });
afterEach(() => { resetMock(); vi.useRealTimers(); });
describe("reminder mock", () => {
  it("stores CRUD, validates and emits each mutation without exposing mutable state", async () => {
    const changes: Reminder[][] = [];
    const stop = mockListen("reminders://changed", items => changes.push(items));
    try {
      const a = await mockInvoke("reminders_add", { text: "call", dueAt: 200_000 });
      const b = await mockInvoke("reminders_add", { text: "meet", dueAt: 150_000 });
      a.text = "mutated";
      expect((await mockInvoke("reminders_list"))[1].text).toBe("call");
      expect(await mockInvoke("reminders_update", { id: b.id, patch: { done: true, text: "changed", dueAt: 300_000 } })).toMatchObject({ done: true, text: "changed", dueAt: 300_000, createdAt: 100_000 });
      await mockInvoke("reminders_delete", { id: a.id });
      expect(changes).toHaveLength(4);
      expect(await mockInvoke("reminders_list")).toHaveLength(1);
      for (const text of ["", " \n", "x".repeat(501)]) await expect(mockInvoke("reminders_add", { text, dueAt: 1 })).rejects.toThrow();
      await expect(mockInvoke("reminders_add", { text: "x", dueAt: Infinity })).rejects.toThrow();
      await expect(mockInvoke("reminders_update", { id: "missing", patch: {} })).rejects.toThrow();
      await expect(mockInvoke("reminders_delete", { id: "missing" })).rejects.toThrow();
    } finally { stop(); }
  });
  it("arms only the nearest deadline, recomputes changes and does not auto-complete", async () => {
    const due: Reminder[] = [];
    const stop = mockListen("reminders://due", r => due.push(r));
    try {
      const a = await mockInvoke("reminders_add", { text: "later", dueAt: 200_000 });
      const b = await mockInvoke("reminders_add", { text: "earlier", dueAt: 150_000 });
      expect(vi.getTimerCount()).toBe(1);
      await mockInvoke("reminders_update", { id: a.id, patch: { dueAt: 125_000 } });
      await vi.advanceTimersByTimeAsync(25_000);
      expect(due.map(r => r.id)).toEqual([a.id]);
      expect((await mockInvoke("reminders_list")).every(r => !r.done)).toBe(true);
      await mockInvoke("reminders_delete", { id: b.id });
      expect(vi.getTimerCount()).toBe(0);
      await vi.advanceTimersByTimeAsync(200_000);
      expect(due).toHaveLength(1);
      await mockInvoke("reminders_update", { id: a.id, patch: { dueAt: Date.now() + 600_000 } });
      await vi.advanceTimersByTimeAsync(600_000);
      expect(due).toHaveLength(2);
    } finally { stop(); }
  });
  it("delivers startup/disabled backlog once each at ten second intervals, after listener installation", async () => {
    const settings = await mockInvoke("settings_get");
    await mockInvoke("settings_set", { patch: { disabledFeatures: ["notes"] } });
    const a = await mockInvoke("reminders_add", { text: "old", dueAt: 1 });
    const b = await mockInvoke("reminders_add", { text: "older", dueAt: 2 });
    const due: Reminder[] = [];
    const stop = mockListen("reminders://due", r => due.push(r));
    try {
      expect(vi.getTimerCount()).toBe(0);
      await mockInvoke("settings_set", { patch: { disabledFeatures: settings.disabledFeatures } });
      await vi.advanceTimersByTimeAsync(0);
      expect(due.map(r => r.id)).toEqual([a.id]);
      await vi.advanceTimersByTimeAsync(9999); expect(due).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(1); expect(due.map(r => r.id)).toEqual([a.id, b.id]);
      await mockInvoke("settings_set", { patch: { disabledFeatures: ["notes"] } });
      await mockInvoke("settings_set", { patch: { disabledFeatures: [] } });
      await vi.advanceTimersByTimeAsync(600_000); expect(due).toHaveLength(2);
    } finally { stop(); }
  });
  it("does not delay an armed future reminder behind paced startup backlog", async () => {
    const due: string[] = [];
    const stop = mockListen("reminders://due", r => due.push(r.text));
    try {
      await mockInvoke("reminders_add", { text: "old", dueAt: 1 });
      await mockInvoke("reminders_add", { text: "older", dueAt: 2 });
      await mockInvoke("reminders_add", { text: "soon", dueAt: 105_000 });
      await vi.advanceTimersByTimeAsync(0); expect(due).toEqual(["old"]);
      await vi.advanceTimersByTimeAsync(5000); expect(due).toEqual(["old", "soon"]);
      await vi.advanceTimersByTimeAsync(9999); expect(due).toHaveLength(2);
      await vi.advanceTimersByTimeAsync(1); expect(due).toEqual(["old", "soon", "older"]);
    } finally { stop(); }
  });
});
