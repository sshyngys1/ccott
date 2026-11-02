import { act, render, screen, fireEvent, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WhatsNewView } from "./WhatsNewView";
import { getLastAcknowledgedVersion, getWhatsNewForVersion } from "../lib/whatsNew/catalog";
import { setLanguage, t } from "../i18n";
import * as i18n from "../i18n";

describe("WhatsNewView component", () => {
  it.each(["ru", "en"] as const)("renders every 0.3.0 step and keyboard hint in %s", language => {
    setLanguage(language);
    const { container } = render(<WhatsNewView version="0.3.0" />);
    const cards = container.querySelectorAll(".ig-whats-new-card");
    const items = getWhatsNewForVersion("0.3.0")!;
    expect(cards).toHaveLength(6);
    items.forEach((item, index) => {
      expect(within(cards[index] as HTMLElement).getByRole("heading")).toHaveTextContent(t(item.titleKey));
      expect(cards[index].querySelector(".ig-whats-new-item-desc")).toHaveTextContent(t(item.descKey));
      const steps = cards[index].querySelectorAll("li");
      expect(steps).toHaveLength(item.stepKeys?.length ?? 0);
      item.stepKeys?.forEach((key, step) => {
        expect(steps[step].textContent).toBe(t(key).replace(/\{kbd:([^{}]+)\}/g, "$1"));
      });
    });
    const hints = [...container.querySelectorAll("kbd.ig-kbd")];
    expect(hints.map(hint => hint.textContent)).toEqual(["Ctrl+Alt+Space", "Esc", "Enter", "Ctrl+Enter", "Ctrl", "Shift"]);
    expect(container.textContent).not.toContain("{kbd:");
    expect(getLastAcknowledgedVersion()).toBeNull();
  });

  it("keeps the header and acknowledgment outside the scrolling list", () => {
    const { container } = render(<WhatsNewView version="0.3.0" />);
    const list = container.querySelector(".ig-whats-new-list")!;
    expect(list).toHaveClass("ig-scroll");
    expect(list.querySelectorAll(".ig-whats-new-card")).toHaveLength(6);
    expect(list).not.toContainElement(screen.getByText(t("whatsNew.version", { version: "0.3.0" })));
    expect(list).not.toContainElement(screen.getByRole("button", { name: t("whatsNew.gotIt") }));
  });

  it.each(["0.2.2", "0.2.3"])("keeps %s cards free of steps and keyboard hints", version => {
    const { container } = render(<WhatsNewView version={version} />);
    expect(container.querySelectorAll(".ig-whats-new-card")).toHaveLength(version === "0.2.2" ? 4 : 5);
    expect(screen.queryByRole("list")).toBeNull();
    expect(container.querySelector("kbd")).toBeNull();
  });

  it("updates mounted 0.3.0 instructions when the language changes", () => {
    const { container } = render(<WhatsNewView version="0.3.0" />);
    act(() => setLanguage("en"));
    expect(screen.getByRole("heading", { name: "Command bar" })).toBeInTheDocument();
    expect(container.querySelector("li")?.textContent).toBe(t("whatsNew.v030.command.step1").replace(/\{kbd:([^{}]+)\}/g, "$1"));
    expect(container.querySelectorAll("kbd")).toHaveLength(6);
  });

  it("escapes HTML and leaves unsupported or malformed markers as text", () => {
    const text = '<img src=x onerror=alert(1)> {kbd:Ctrl} {html:test} {kbd:{nested}} {kbd:}';
    const spy = vi.spyOn(i18n, "useT").mockReturnValue((key, params) => key === "whatsNew.v030.lite.step1" ? text : t(key, params));
    try {
      const { container } = render(<WhatsNewView version="0.3.0" />);
      const steps = container.querySelectorAll(".ig-whats-new-steps");
      const liteStep = steps[steps.length - 1];
      expect(liteStep.textContent).toBe(text.replace("{kbd:Ctrl}", "Ctrl"));
      expect(liteStep.querySelectorAll("kbd")).toHaveLength(1);
      expect(liteStep.querySelector("img")).toBeNull();
    } finally {
      spy.mockRestore();
    }
  });

  it("does not display future notes or acknowledge a version without a catalog", () => {
    const { container } = render(<WhatsNewView version="0.2.1" />);
    expect(container).toBeEmptyDOMElement();
    expect(getLastAcknowledgedVersion()).toBeNull();
  });
  it("avoids a duplicate visible title when embedded in the shell header", () => {
    render(<WhatsNewView version="0.2.2" showTitle={false} />);
    expect(screen.queryByRole("heading", { name: "Что нового в CCOTT" })).toBeNull();
    expect(screen.getByText("Версия 0.2.2")).toBeInTheDocument();
  });
  beforeEach(() => {
    window.localStorage.clear();
    setLanguage("ru");
  });

  it("renders 0.2.2 catalog features", () => {
    render(<WhatsNewView version="0.2.2" />);
    expect(screen.getByRole("region")).toBeInTheDocument();
    expect(screen.getByText("Что нового в CCOTT")).toBeInTheDocument();
    expect(screen.getByText("Версия 0.2.2")).toBeInTheDocument();

    // 4 feature titles
    expect(screen.getByText("Управление плеером")).toBeInTheDocument();
    expect(screen.getByText("Настоящий аудиоспектр")).toBeInTheDocument();
    expect(screen.getByText("Батарея ноутбука")).toBeInTheDocument();
    expect(screen.getByText("Экран «Что нового»")).toBeInTheDocument();

    expect(screen.getByRole("button", { name: "Понятно" })).toBeInTheDocument();
  });

  it("acknowledges version and calls onClose when clicking Got It", () => {
    const onClose = vi.fn();
    render(<WhatsNewView version="0.2.2" onClose={onClose} />);

    const button = screen.getByRole("button", { name: "Понятно" });
    fireEvent.click(button);

    expect(getLastAcknowledgedVersion()).toBe("0.2.2");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("renders in English when language is en", () => {
    setLanguage("en");
    render(<WhatsNewView version="0.2.2" />);
    expect(screen.getByText("What's New in CCOTT")).toBeInTheDocument();
    expect(screen.getByText("Version 0.2.2")).toBeInTheDocument();
    expect(screen.getByText("Playback controls")).toBeInTheDocument();
    expect(screen.getByText("Real audio visualizer")).toBeInTheDocument();
    expect(screen.getByText("Laptop battery")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Got it" })).toBeInTheDocument();
  });
});
