import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CommandBar, calcCmdBarHeight } from "./CommandBar";
import { clearRatesCache, setCachedRates } from "../../lib/cmd/currency";

describe("CommandBar component", () => {
  it.each(["777баксов в", "777 баксов в "])("renders a currency answer for '%s' instead of no results", async (query) => {
    clearRatesCache();
    setCachedRates("USD", { base: "USD", rates: { RUB: 100 }, stale: false, updatedAt: Date.now() });
    try {
      render(<CommandBar onClose={vi.fn()} />);
      fireEvent.change(screen.getByRole("combobox"), { target: { value: query } });
      expect(await screen.findByText("= 77 700 ₽")).toBeInTheDocument();
      expect(screen.queryByText("Ничего не найдено")).toBeNull();
    } finally {
      clearRatesCache();
    }
  });

  it("keeps the math hero mounted while its value transitions, then clears with the original Esc behaviour", async () => {
    const { container } = render(<CommandBar onClose={() => {}} />);
    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "12*4" } });
    await screen.findByText("= 48");
    const hero = container.querySelector(".ig-cmd-hero");
    fireEvent.change(input, { target: { value: "12*5" } });
    expect(container.querySelector(".ig-cmd-hero")).toBe(hero);
    await screen.findByText("= 60");
    await waitFor(() => expect(screen.queryByText("= 48")).toBeNull());
    fireEvent.keyDown(input, { key: "Escape" });
    expect(container.querySelector(".ig-cmd-hero")).toBeNull();
  });

  it("moves one selection plate between result rows instead of adding layout identities", async () => {
    // jsdom does not implement browser scrolling or offsets.
    const scroll = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollIntoView");
    const offset = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetTop");
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: vi.fn() });
    Object.defineProperty(HTMLElement.prototype, "offsetTop", { configurable: true, get() {
      return this.getAttribute("role") === "option" ? [...this.parentElement.children].indexOf(this) * 48 : 0;
    } });
    try {
      const { container } = render(<CommandBar onClose={() => {}} />);
      const input = screen.getByRole("combobox");
      fireEvent.change(input, { target: { value: "exe" } });
      const rows = await screen.findAllByRole("option");
      expect(rows.length).toBeGreaterThan(1);
      const plate = container.querySelector(".ig-cmd-highlight");
      expect(plate).toBeInTheDocument();
      const previous = rows.find(row => row.getAttribute("aria-selected") === "true");
      fireEvent.keyDown(input, { key: "ArrowDown" });
      expect(previous).toHaveAttribute("aria-selected", "false");
      expect(container.querySelector(".ig-cmd-highlight")).toBe(plate);
      expect(container.querySelectorAll(".ig-cmd-highlight")).toHaveLength(1);
      await waitFor(() => expect((plate as HTMLElement).style.transform).toContain("96px"));
    } finally {
      if (scroll) Object.defineProperty(HTMLElement.prototype, "scrollIntoView", scroll);
      else Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
      if (offset) Object.defineProperty(HTMLElement.prototype, "offsetTop", offset);
      else Reflect.deleteProperty(HTMLElement.prototype, "offsetTop");
    }
  });

  it("calculates height according to the spec formula", () => {
    // Empty state: 368px
    expect(
      calcCmdBarHeight({ query: "", itemsCount: 0, groupsCount: 0, hasHero: false, hasBanner: false }),
    ).toBe(368);

    // Not found: header + footer + wrapped message + list padding = 280px.
    expect(
      calcCmdBarHeight({ query: "xyz", itemsCount: 0, groupsCount: 0, hasHero: false, hasBanner: false }),
    ).toBe(52 + 36 + 176 + 16);

    // Instant answer without items: 178px
    expect(
      calcCmdBarHeight({ query: "12*7", itemsCount: 0, groupsCount: 0, hasHero: true, hasBanner: false }),
    ).toBe(178);

    // Instant answer with banner: 222px
    expect(
      calcCmdBarHeight({ query: "100 gbp in kzt", itemsCount: 0, groupsCount: 0, hasHero: true, hasBanner: true }),
    ).toBe(222);

    // Multi-row clamped
    expect(
      calcCmdBarHeight({ query: "test", itemsCount: 2, groupsCount: 1, hasHero: false, hasBanner: false }),
    ).toBe(52 + 36 + 24 + 2 * 48 + 16);
  });

  it("renders empty state with 5 quick hints", () => {
    const onClose = vi.fn();
    render(<CommandBar onClose={onClose} />);

    expect(screen.getByRole("combobox")).toBeInTheDocument();
    // 5 hints
    const options = screen.getAllByRole("button");
    expect(options.length).toBeGreaterThanOrEqual(5);
  });

  it("renders instant hero answer for math expressions", async () => {
    const onClose = vi.fn();
    render(<CommandBar onClose={onClose} />);

    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "12*7+3" } });

    await waitFor(() => {
      expect(screen.getByText("= 87")).toBeInTheDocument();
    });
  });

  it("handles keyboard navigation and Esc clear/close", () => {
    const onClose = vi.fn();
    render(<CommandBar onClose={onClose} />);

    const input = screen.getByRole("combobox") as HTMLInputElement;

    // Esc on empty closes
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();

    // Type text
    fireEvent.change(input, { target: { value: "hello" } });
    expect(input.value).toBe("hello");

    // Esc clears text first
    fireEvent.keyDown(input, { key: "Escape" });
    expect(input.value).toBe("");
    expect(onClose).toHaveBeenCalledOnce(); // not called a second time
  });

  it("copies exact displayed number on Enter and full formula on Shift+Enter", async () => {
    const writeTextSpy = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: {
        writeText: writeTextSpy,
      },
    });
    const onClose = vi.fn();
    render(<CommandBar onClose={onClose} />);

    const input = screen.getByRole("combobox") as HTMLInputElement;

    // Calculator: (12+3)*4 - 15%
    fireEvent.change(input, { target: { value: "(12+3)*4 - 15%" } });

    await waitFor(() => {
      expect(screen.getByText("= 51")).toBeInTheDocument();
    });

    // Enter copies plain number "51"
    fireEvent.keyDown(input, { key: "Enter" });
    expect(writeTextSpy).toHaveBeenLastCalledWith("51");
    expect(onClose).toHaveBeenCalled();

    // Shift+Enter copies with formula
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    expect(writeTextSpy).toHaveBeenLastCalledWith("(12 + 3) × 4 − 15% = 51");
  });
});
