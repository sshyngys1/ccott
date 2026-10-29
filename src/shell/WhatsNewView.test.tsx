import { render, screen, fireEvent } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WhatsNewView } from "./WhatsNewView";
import { getLastAcknowledgedVersion } from "../lib/whatsNew/catalog";
import { setLanguage } from "../i18n";

describe("WhatsNewView component", () => {
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
