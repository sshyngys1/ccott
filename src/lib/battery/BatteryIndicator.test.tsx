import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { BatteryIndicator, BatteryIndicatorView } from "./BatteryIndicator";
import { useBatteryStore } from "./batteryStore";

describe("BatteryIndicator", () => {
  it("renders nothing when hasBattery is false or null", () => {
    useBatteryStore.getState().setBattery({
      hasBattery: false,
      percent: null,
      charging: null,
      acConnected: true,
      saver: false,
      remainingSeconds: null,
    });
    const { container: c1 } = render(<BatteryIndicator variant="head" />);
    expect(c1.firstChild).toBeNull();

    useBatteryStore.getState().setBattery({
      hasBattery: null,
      percent: null,
      charging: null,
      acConnected: null,
      saver: null,
      remainingSeconds: null,
    });
    const { container: c2 } = render(<BatteryIndicator variant="pill" />);
    expect(c2.firstChild).toBeNull();
  });

  it("renders percentage and accessible label for charging battery", () => {
    useBatteryStore.getState().setBattery({
      hasBattery: true,
      percent: 64,
      charging: true,
      acConnected: true,
      saver: false,
      remainingSeconds: null,
    });
    render(<BatteryIndicator variant="head" />);
    const el = screen.getByRole("status");
    expect(el).toBeInTheDocument();
    expect(el.textContent).toBe("64%");
    expect(el.getAttribute("aria-label")).toContain("64%");
    expect(el.getAttribute("aria-label")).toContain("Заряжается");
  });

  it("renders honest dash for known battery with unknown percentage", () => {
    useBatteryStore.getState().setBattery({
      hasBattery: true,
      percent: null,
      charging: false,
      acConnected: false,
      saver: false,
      remainingSeconds: null,
    });
    render(<BatteryIndicator variant="pill" />);
    const el = screen.getByRole("status");
    expect(el).toBeInTheDocument();
    expect(el.textContent).toBe("—");
    expect(el.getAttribute("aria-label")).toContain("неизвестен");
  });

  it("renders 50% partial fill and centered text", () => {
    useBatteryStore.getState().setBattery({
      hasBattery: true,
      percent: 50,
      charging: false,
      acConnected: false,
      saver: false,
      remainingSeconds: 3600,
    });
    const { container } = render(<BatteryIndicator variant="pill" />);
    const el = screen.getByRole("status");
    expect(el.textContent).toBe("50");
    const svg = container.querySelector("svg.ig-battery-symbol");
    expect(svg).toHaveAttribute("data-tone", "normal");
    const clip = container.querySelector("clipPath");
    expect(clip).toBeInTheDocument();
    const fillRect = container.querySelector(".ig-battery-fill");
    expect(fillRect).toHaveStyle({ transform: "translateX(-18px)" });
    expect(fillRect?.querySelector("rect")).toHaveAttribute("width", "36");
  });

  it("renders 0% battery with a translated-away fill and critical tone", () => {
    useBatteryStore.getState().setBattery({
      hasBattery: true,
      percent: 0,
      charging: false,
      acConnected: false,
      saver: true,
      remainingSeconds: 0,
    });
    const { container } = render(<BatteryIndicator variant="pill" />);
    const el = screen.getByRole("status");
    expect(el.textContent).toBe("0");
    const svg = container.querySelector("svg.ig-battery-symbol");
    expect(svg).toHaveAttribute("data-tone", "critical");
    const fillRect = container.querySelector(".ig-battery-fill");
    expect(fillRect).toHaveStyle({ transform: "translateX(-36px)" });
  });

  it("renders 100% battery with full 36px fill", () => {
    useBatteryStore.getState().setBattery({
      hasBattery: true,
      percent: 100,
      charging: false,
      acConnected: false,
      saver: false,
      remainingSeconds: 7200,
    });
    const { container } = render(<BatteryIndicator variant="pill" />);
    const el = screen.getByRole("status");
    expect(el.textContent).toBe("100");
    const fillRect = container.querySelector(".ig-battery-fill");
    expect(fillRect).toHaveStyle({ transform: "translateX(0px)" });
    expect(fillRect?.querySelector("rect")).toHaveAttribute("width", "36");
  });

  it("renders charging 50% with a translated fill and centered bolt path", () => {
    useBatteryStore.getState().setBattery({
      hasBattery: true,
      percent: 50,
      charging: true,
      acConnected: true,
      saver: false,
      remainingSeconds: 1800,
    });
    const { container } = render(<BatteryIndicator variant="pill" />);
    const svg = container.querySelector("svg.ig-battery-symbol");
    expect(svg).toHaveAttribute("data-charging", "true");
    const fillRect = container.querySelector(".ig-battery-fill");
    expect(fillRect).toHaveStyle({ transform: "translateX(-18px)" });
    expect(fillRect?.querySelector("rect")).toHaveAttribute("width", "36");
    const bolt = container.querySelector("path.ig-battery-ink");
    expect(bolt).toBeInTheDocument();
    expect(bolt).toHaveAttribute("d", "M19.5 4 11.5 13h6l-2 7 9-11h-6Z");
  });

  it("renders charging with unknown percentage honestly without false fill", () => {
    useBatteryStore.getState().setBattery({
      hasBattery: true,
      percent: null,
      charging: true,
      acConnected: true,
      saver: false,
      remainingSeconds: null,
    });
    const { container } = render(<BatteryIndicator variant="pill" />);
    const svg = container.querySelector("svg.ig-battery-symbol");
    expect(svg).toHaveAttribute("data-charging", "true");
    const fillRect = container.querySelector(".ig-battery-fill");
    expect(fillRect).toHaveStyle({ transform: "translateX(-36px)" });
    const bolt = container.querySelector("path.ig-battery-ink");
    expect(bolt).toBeInTheDocument();
  });

  it("generates unique clip and gradient IDs across multiple instances", () => {
    useBatteryStore.getState().setBattery({
      hasBattery: true,
      percent: 50,
      charging: false,
      acConnected: false,
      saver: false,
      remainingSeconds: null,
    });
    const { container } = render(
      <>
        <BatteryIndicator variant="pill" />
        <BatteryIndicator variant="pill" />
      </>,
    );
    const clipPaths = container.querySelectorAll("clipPath");
    expect(clipPaths).toHaveLength(2);
    expect(clipPaths[0].id).not.toBe(clipPaths[1].id);
    const gradients = container.querySelectorAll("linearGradient");
    expect(gradients).toHaveLength(2);
    expect(gradients[0].id).not.toBe(gradients[1].id);
  });
});

it.each(["pill", "head"] as const)("%s strikes on a plug edge, never on mount or percent-only updates, and fades on unplug", (variant) => {
  vi.useFakeTimers();
  try {
    const battery = { hasBattery: true, percent: 78, charging: true, acConnected: true, saver: false, remainingSeconds: null };
    const { container, rerender } = render(<BatteryIndicatorView variant={variant} battery={battery} />);
    const indicator = container.querySelector(`[data-charge-transition], .ig-${variant}-battery`);
    expect(indicator).not.toHaveAttribute("data-charge-transition");
    rerender(<BatteryIndicatorView variant={variant} battery={{ ...battery, charging: false }} />);
    expect(indicator).toHaveAttribute("data-charge-transition", "unplug");
    rerender(<BatteryIndicatorView variant={variant} battery={battery} />);
    expect(indicator).toHaveAttribute("data-charge-transition", "plug");
    rerender(<BatteryIndicatorView variant={variant} battery={{ ...battery, percent: 79 }} />);
    act(() => vi.advanceTimersByTime(780));
    expect(indicator).not.toHaveAttribute("data-charge-transition");
    expect(container.querySelector(".ig-battery-fill")).toHaveStyle({ transform: `translateX(${(0.79 - 1) * 36}px)` });
  } finally { vi.useRealTimers(); }
});
