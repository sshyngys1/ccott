import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockCopy, resetMock } from "../../ipc/mock";
import { onShellRequest, type ShellRequest } from "../../shared/shellBus";
import { resetTextStore, useTextStore } from "../../lib/text/store";
import text from "./index";

const TextTab = text.Tab;

beforeEach(() => {
  resetMock();
  resetTextStore();
  // The prefill is a feature of its own (tested below); other tests start from an empty field.
  useTextStore.getState().markPrefilled();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const area = () => screen.getByRole("textbox", { name: "Текст для преобразования" }) as HTMLTextAreaElement;
const type = (value: string) => fireEvent.change(area(), { target: { value } });
const press = (name: string | RegExp) => fireEvent.click(screen.getByRole("button", { name }));

describe("Text tab", () => {
  it("starts empty: all transforms and «Копировать» are disabled, stats are zero", () => {
    render(<TextTab />);
    expect(screen.getByRole("heading", { name: "Текст" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ВЕРХНИЙ" })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Копировать/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Отменить/ })).toBeDisabled();
    expect(screen.getByText("0 символов · 0 слов · 0 строк")).toBeInTheDocument();
  });

  it("live statistics with Russian plurals", () => {
    render(<TextTab />);
    type("раз два\nтри");
    expect(screen.getByText("11 символов · 3 слова · 2 строки")).toBeInTheDocument();
  });

  it("applies a transform in place and marks it as the last applied", () => {
    render(<TextTab />);
    type("привет мир");
    press("ВЕРХНИЙ");
    expect(area()).toHaveValue("ПРИВЕТ МИР");
    expect(screen.getByRole("button", { name: "ВЕРХНИЙ" })).toHaveAttribute("data-selected", "true");
    type("ПРИВЕТ МИР!");
    expect(screen.getByRole("button", { name: "ВЕРХНИЙ" })).not.toHaveAttribute("data-selected");
  });

  it("layout fix and transliteration", () => {
    render(<TextTab />);
    type("Ghbdtn");
    press(/RU ⇄ EN/);
    expect(area()).toHaveValue("Привет");
    press("Транслит");
    expect(area()).toHaveValue("Privet");
  });

  it("transforms only the selection when there is one", () => {
    render(<TextTab />);
    type("abc def ghi");
    area().setSelectionRange(4, 7);
    press("ВЕРХНИЙ");
    expect(area()).toHaveValue("abc DEF ghi");
  });

  it("invalid JSON: text unchanged, red field, alert with line and column; editing clears it", () => {
    render(<TextTab />);
    type('{\n  "a": 1,\n  "b": 2\n  "c": 3\n}');
    press(/JSON красиво/);
    expect(area()).toHaveValue('{\n  "a": 1,\n  "b": 2\n  "c": 3\n}');
    expect(screen.getByRole("alert")).toHaveTextContent("Неверный JSON: строка 4, символ 3 — ожидалась «,» или «}»");
    expect(area()).toHaveAttribute("aria-invalid", "true");
    expect(area().closest(".ig-field")).toHaveAttribute("data-invalid", "true");
    type('{"a":1}');
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("valid JSON is pretty-printed and minified", () => {
    render(<TextTab />);
    type('{"a":[1,2]}');
    press(/JSON красиво/);
    expect(area().value).toBe('{\n  "a": [\n    1,\n    2\n  ]\n}');
    press("JSON в строку");
    expect(area().value).toBe('{"a":[1,2]}');
  });

  it("Base64 round trip with emoji and an error for garbage", () => {
    render(<TextTab />);
    type("Привет 😀");
    press("В Base64");
    expect(area().value).toBe("0J/RgNC40LLQtdGCIPCfmIA=");
    press("Из Base64");
    expect(area().value).toBe("Привет 😀");
    type("***");
    press("Из Base64");
    expect(screen.getByRole("alert")).toHaveTextContent("Это не Base64");
    expect(area().value).toBe("***");
  });

  it("undo walks back through the history", () => {
    render(<TextTab />);
    type("Ab");
    press("ВЕРХНИЙ");
    press("нижний");
    expect(area().value).toBe("ab");
    press(/Отменить/);
    expect(area().value).toBe("AB");
    press(/Отменить/);
    expect(area().value).toBe("Ab");
    expect(screen.getByRole("button", { name: /Отменить/ })).toBeDisabled();
  });

  it("keeps its text when the tab is closed and reopened", () => {
    const { unmount } = render(<TextTab />);
    type("не потеряется");
    unmount();
    render(<TextTab />);
    expect(area()).toHaveValue("не потеряется");
  });

  it("copies the result and confirms it", async () => {
    const requests: ShellRequest[] = [];
    const off = onShellRequest((req) => { requests.push(req); });
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<TextTab />);
    type("готово");
    press(/Копировать/);
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("готово"));
    expect(await screen.findByRole("button", { name: /Скопировано/ })).toBeInTheDocument();
    expect(requests).toContainEqual({ type: "toast", text: "Скопировано" });
    off();
  });

  it("offers fresh clipboard text once", async () => {
    mockCopy({ kind: "text", text: "свежий безопасный текст" });
    useTextStore.setState({ prefilled: false });
    render(<TextTab />);
    await waitFor(() => expect(area().value).toBe("свежий безопасный текст"));
    cleanup();
    useTextStore.getState().edit("");
    render(<TextTab />);
    await new Promise((r) => setTimeout(r, 30));
    expect(area()).toHaveValue(""); // not offered a second time
  });
});
