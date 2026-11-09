// Every IPC command must be allowed for the window that calls it, or Tauri rejects it in the real app while the browser
// mock (which has no ACL) keeps every test green. v0.4 shipped the agent monitor without its permissions this way.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(__dirname, "../..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

function allowed(identifier: string): Set<string> {
  const toml = read("src-tauri/permissions/windows.toml");
  const block = toml.slice(toml.indexOf(`identifier = "${identifier}"`));
  const list = block.slice(block.indexOf("commands.allow"), block.indexOf("]") + 1);
  return new Set([...list.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]));
}

function contractCommands(): string[] {
  const types = read("src/shared/types.ts");
  const body = types.slice(types.indexOf("export interface Commands {"));
  return [...body.slice(0, body.indexOf("\n}\n")).matchAll(/^\s+([a-z_]+): \[/gm)].map((m) => m[1]);
}

function sources(dir: string): string[] {
  return readdirSync(join(root, dir)).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(join(root, path)).isDirectory()) return sources(path);
    return /\.tsx?$/.test(name) && !/\.test\./.test(name) ? [path] : [];
  });
}

describe("Tauri command permissions", () => {
  it("lets the island call every contract command", () => {
    const island = allowed("island-commands");
    expect(contractCommands().filter((command) => !island.has(command))).toEqual([]);
  });

  it("lets the settings window call every command its sections invoke", () => {
    const settings = allowed("settings-commands");
    const files = [...sources("src/shell/settings"), "src/modules/agents/AgentsSettings.tsx"].filter((f) => !f.endsWith("openWindow.ts"));
    const invoked = new Set(files.flatMap((f) => [...read(f).matchAll(/invoke\(\s*"([a-z_]+)"/g)].map((m) => m[1])));
    expect([...invoked].filter((command) => !settings.has(command))).toEqual([]);
  });
});
