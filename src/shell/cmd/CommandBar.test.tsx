import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { CommandBar, calcCmdBarHeight } from "./CommandBar";
import { clearRatesCache, setCachedRates, type CurrencyRates } from "../../lib/cmd/currency";
import { resetIslandStore, useIslandStore } from "../../store";
import { setLanguage, t } from "../../i18n";
import * as ipc from "../../ipc";

const glassCss = readFileSync("src/design/glass.css", "utf8");
const motionCss = readFileSync("src/shell/cmd/commandMotion.css", "utf8");

beforeEach(() => { clearRatesCache(); resetIslandStore(); });
afterEach(() => { cleanup(); clearRatesCache(); resetIslandStore(); vi.restoreAllMocks(); });

it.each([
  ["100 usd to "],
  ["100 us", "100 usd"],
])("shares one delayed USD request while typing %j", async (...queries) => {
  const rates = { base: "USD", rates: { USD: 1, KZT: 500, EUR: 0.9 }, stale: false, updatedAt: Date.now() };
  let resolve!: (rates: CurrencyRates) => void;
  const pending = new Promise<CurrencyRates>(done => { resolve = done; });
  const original = ipc.invoke;
  const spy = vi.spyOn(ipc, "invoke").mockImplementation((...args: Parameters<typeof ipc.invoke>) =>
    args[0] === "cmd_currency_rates" ? pending : original(...args));
  useIslandStore.setState(state => ({ settings: { ...state.settings, defaultCurrency: "KZT" } }));
  render(<CommandBar onClose={vi.fn()} />);
  const input = screen.getByRole("combobox");
  for (const query of queries) fireEvent.change(input, { target: { value: query } });
  const currencyCalls = () => spy.mock.calls.filter(([command]) => command === "cmd_currency_rates");
  try {
    expect(currencyCalls()).toEqual([["cmd_currency_rates", { base: "USD" }]]);
  } finally {
    await act(async () => { resolve(rates); await pending; });
  }
  expect(await screen.findByText("100 USD = 50 000 KZT")).toBeInTheDocument();
  if (queries.length === 1) expect(screen.getByRole("listbox", { name: t("cmdCurrencies") })).toBeInTheDocument();
  expect(currencyCalls()).toHaveLength(1);
});

it("skips currency IPC for unrelated search on a cold cache and still completes a USD prefix", async () => {
  const spy = vi.spyOn(ipc, "invoke");
  render(<CommandBar onClose={vi.fn()} />);
  const input = screen.getByRole("combobox");
  fireEvent.change(input, { target: { value: "7 zip" } });
  await waitFor(() => expect(spy).toHaveBeenCalledWith("cmd_search", expect.objectContaining({ query: "7 zip" })));
  expect(spy.mock.calls.filter(([command]) => command === "cmd_currency_rates")).toHaveLength(0);
  fireEvent.change(input, { target: { value: "100 us" } });
  expect(await screen.findByRole("option", { name: /USD/ })).toBeInTheDocument();
  expect(spy.mock.calls.filter(([command]) => command === "cmd_currency_rates")).toEqual([["cmd_currency_rates", { base: "USD" }]]);
});

it.each(["100 usd", "100доллар", "$100"])("converts %s to the configured KZT and follows a changed setting", async query => {
  setCachedRates("USD", { base: "USD", rates: { KZT: 500, EUR: 0.9, RUB: 100 }, stale: false, updatedAt: Date.now() });
  useIslandStore.setState(state => ({ settings: { ...state.settings, defaultCurrency: "KZT" } }));
  render(<CommandBar onClose={vi.fn()} />);
  fireEvent.change(screen.getByRole("combobox"), { target: { value: query } });
  expect(await screen.findByText("100 USD = 50 000 KZT")).toBeInTheDocument();
  act(() => useIslandStore.setState(state => ({ settings: { ...state.settings, defaultCurrency: "EUR" } })));
  expect(await screen.findByText("100 USD = 90 EUR")).toBeInTheDocument();
});

it.each(["ru", "en"] as const)("%s completes provider currencies with arrows/Tab/Enter, then copies as before", async language => {
  setLanguage(language);
  setCachedRates("USD", { base: "USD", rates: { USD: 1, KZT: 500, EUR: 0.9, NZD: 1.6 }, stale: true, updatedAt: Date.now() });
  const write = vi.fn().mockResolvedValue(undefined);
  Object.assign(navigator, { clipboard: { writeText: write } });
  const close = vi.fn();
  render(<CommandBar onClose={close} />);
  const input = screen.getByRole("combobox");
  fireEvent.change(input, { target: { value: "100 usd to " } });
  const list = await screen.findByRole("listbox", { name: t("cmdCurrencies") });
  const options = within(list).getAllByRole("option");
  expect(options.map(option => option.id)).toEqual(["cmd-currency-EUR", "cmd-currency-KZT", "cmd-currency-NZD", "cmd-currency-USD"]);
  expect(options[0]).toHaveAttribute("aria-selected", "true");
  expect(input).toHaveAttribute("aria-activedescendant", options[0].id);
  fireEvent.keyDown(input, { key: "ArrowUp" });
  expect(options[3]).toHaveAttribute("aria-selected", "true");
  fireEvent.keyDown(input, { key: "ArrowDown" });
  fireEvent.keyDown(input, { key: "ArrowDown" });
  fireEvent.keyDown(input, { key: "Tab" });
  expect(input).toHaveValue("100 usd to KZT");
  expect(write).not.toHaveBeenCalled();
  expect(close).not.toHaveBeenCalled();
  expect(screen.queryByRole("listbox", { name: t("cmdCurrencies") })).toBeNull();
  expect(await screen.findByText("100 USD = 50 000 KZT")).toBeInTheDocument();
  fireEvent.keyDown(input, { key: "Enter" });
  expect(write).toHaveBeenLastCalledWith("50 000");
  fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
  expect(write).toHaveBeenLastCalledWith("100 USD = 50 000 KZT");
  fireEvent.change(input, { target: { value: `100 usd to ${language === "ru" ? "тен" : "teng"}` } });
  expect(within(screen.getByRole("listbox", { name: t("cmdCurrencies") })).getAllByRole("option")).toHaveLength(1);
  fireEvent.keyDown(input, { key: "Enter" });
  expect(input).toHaveValue("100 usd to KZT");
  fireEvent.change(input, { target: { value: "100 usd to nz" } });
  expect(screen.getByRole("option")).toHaveAttribute("aria-selected", "true");
  fireEvent.keyDown(input, { key: "Enter" });
  expect(input).toHaveValue("100 usd to NZD");
  expect(await screen.findByText("100 USD = 160 NZD")).toBeInTheDocument();
  fireEvent.change(input, { target: { value: "100 us" } });
  expect(screen.getByRole("option")).toHaveTextContent("USD");
  fireEvent.keyDown(input, { key: "Tab" });
  expect(input).toHaveValue("100 USD");
  fireEvent.change(input, { target: { value: "100 usd в " } });
  fireEvent.keyDown(input, { key: "Escape" });
  expect(input).toHaveValue("");
});

it("offers a cached catalog from another base when the current base cannot be fetched offline", async () => {
  setCachedRates("EUR", { base: "EUR", rates: { KZT: 550, NZD: 1.8 }, stale: true, updatedAt: 1 });
  const original = ipc.invoke;
  const spy = vi.spyOn(ipc, "invoke");
  spy.mockImplementation((...args: Parameters<typeof ipc.invoke>) => args[0] === "cmd_currency_rates" ? Promise.reject(new Error("offline")) : original(...args));
  render(<CommandBar onClose={vi.fn()} />);
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "100 usd to nz" } });
  expect(await screen.findByRole("option")).toHaveTextContent("NZD");
  await waitFor(() => expect(spy).toHaveBeenCalledWith("cmd_currency_rates", { base: "USD" }));
});

it("reparses a pasted provider code after loading a catalog without a platform name for that code", async () => {
  vi.spyOn(ipc, "invoke").mockResolvedValueOnce({ base: "USD", rates: { USD: 1, ZZZ: 2 }, stale: false, updatedAt: Date.now() });
  render(<CommandBar onClose={vi.fn()} />);
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "100 usd to ZZZ" } });
  expect(await screen.findByText("100 USD = 200 ZZZ")).toBeInTheDocument();
});

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

  it.each(["1 bad", "2 std", "100 xxx"])("does not invoke cmd_currency_rates for %s", async query => {
    const spy = vi.spyOn(ipc, "invoke");
    render(<CommandBar onClose={vi.fn()} />);
    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: query } });
    await waitFor(() => expect(spy).toHaveBeenCalledWith("cmd_search", expect.objectContaining({ query })));
    expect(spy.mock.calls.filter(([command]) => command === "cmd_currency_rates")).toHaveLength(0);
  });

  it.each([
    ["100 usd to arm", /AMD/],
    ["100 usd to pes", /MXN/],
    ["100 usd to kro", /DKK/],
  ])("shows currency completion hints for %s", async (query, expectedPattern) => {
    setCachedRates("USD", {
      base: "USD",
      rates: { USD: 1, AMD: 388, MXN: 17, DKK: 6.9, EUR: 0.9, KZT: 500 },
      stale: false,
      updatedAt: Date.now(),
    });
    render(<CommandBar onClose={vi.fn()} />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: query } });
    expect(await screen.findByRole("option", { name: expectedPattern })).toBeInTheDocument();
  });

  it("highlights the active currency option with --ig-row-selected background", async () => {
    const style = document.createElement("style");
    style.textContent = `${glassCss}\n${motionCss}`;
    document.head.append(style);
    try {
      setCachedRates("USD", {
        base: "USD",
        rates: { USD: 1, KZT: 500, EUR: 0.9 },
        stale: false,
        updatedAt: Date.now(),
      });
      render(<CommandBar onClose={vi.fn()} />);
      fireEvent.change(screen.getByRole("combobox"), { target: { value: "100 usd to k" } });
      const option = await screen.findByRole("option", { name: /KZT/ });
      expect(option).toHaveAttribute("aria-selected", "true");
      expect(option).toHaveAttribute("data-currency-selected", "true");
      const computed = getComputedStyle(option);
      expect(computed.backgroundColor || computed.background).toBe("var(--ig-row-selected)");
    } finally {
      style.remove();
    }
  });
});
