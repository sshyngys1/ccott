import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setLanguage, t } from "../../i18n";
import * as captureStore from "../../lib/capture/store";
import { useTilesEditStore } from "../../lib/tiles/store";
import { DEFAULT_QUICK_TILES } from "../../shared/types";
import { resetIslandStore, useIslandStore } from "../../store";
import { HomeTab } from "./HomeTab";

// Mock Dock to isolate HomeTab tests
vi.mock("./Dock", () => ({
  Dock: () => <div data-testid="dock-mock" />,
}));

vi.mock("./PlayerCard", () => ({
  PlayerCard: () => <div data-testid="player-mock" />,
}));

vi.mock("./VolumeCard", () => ({
  VolumeCard: () => <div data-testid="volume-mock" />,
}));

describe("HomeTab tiles and edit mode", () => {
  it.each([["ru", "Командная строка", "Добавить плитку"], ["en", "Command bar", "Add tile"]] as const)("%s offers the command tile in Add tile", async (language, title, add) => {
    setLanguage(language);
    useTilesEditStore.setState({ editing: true });
    render(<HomeTab />);
    fireEvent.click(screen.getByRole("button", { name: add }));
    expect(screen.getByRole("menuitem", { name: title })).toBeInTheDocument();
  });
  it("keeps + available at six and seven cells, grows to four rows, and disables expansion at eight", async () => {
    useTilesEditStore.setState({ editing: true });
    const { container } = render(<HomeTab />);
    expect(container.querySelector(".hm-tools")).toHaveAttribute("data-rows", "3");
    fireEvent.click(screen.getByRole("button", { name: "Добавить плитку" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Новая заметка" }));
    await waitFor(() => expect(container.querySelector(".hm-tools")).toHaveAttribute("data-rows", "4"));
    expect(container.querySelector(".hm-home")).toHaveAttribute("data-tall", "true");
    expect(screen.getAllByRole("button", { name: "Сделать 2×1" })[0]).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Добавить плитку" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Таймер" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Добавить плитку" })).toBeNull());
    for (const button of screen.getAllByRole("button", { name: "Сделать 2×1" })) expect(button).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Убрать Новая заметка" }));
    fireEvent.click(screen.getByRole("button", { name: "Убрать Таймер" }));
    await waitFor(() => expect(container.querySelector(".hm-tools")).toHaveAttribute("data-rows", "3"));
    expect(container.querySelector(".hm-home")).toHaveAttribute("data-tall", "false");
  });
  beforeEach(() => {
    resetIslandStore();
    useIslandStore.getState().setMode("expanded");
    useTilesEditStore.setState({ editing: false });
    vi.restoreAllMocks();
  });

  it("renders default tiles in idle mode and runs tools on click", () => {
    const runCaptureSpy = vi.spyOn(captureStore, "runCapture").mockResolvedValue(undefined as any);
    const runPickColorSpy = vi.spyOn(captureStore, "runPickColor").mockResolvedValue(undefined as any);

    const { container } = render(<HomeTab />);

    // Default 5 tiles
    expect(container.querySelector(".hm-home")).toHaveClass("hm-home--with-tools");
    expect(container.querySelector(".hm-tools")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Область" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Весь экран" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Текст с экрана" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "QR-код" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Пипетка" })).toBeInTheDocument();

    // Normal click runs copy
    fireEvent.click(screen.getByRole("button", { name: "Область" }));
    expect(runCaptureSpy).toHaveBeenCalledWith("region", "copy");

    // Shift click on copy tile runs save
    fireEvent.click(screen.getByRole("button", { name: "Область" }), { shiftKey: true });
    expect(runCaptureSpy).toHaveBeenCalledWith("region", "save");

    // Color picker
    fireEvent.click(screen.getByRole("button", { name: "Пипетка" }));
    expect(runPickColorSpy).toHaveBeenCalled();
  });

  it("opens context menu on right click and enters edit mode", () => {
    render(<HomeTab />);

    const toolsArea = screen.getByLabelText("Быстрые инструменты");
    fireEvent.contextMenu(toolsArea);

    const customizeOption = screen.getByRole("menuitem", { name: "Настроить плитки" });
    expect(customizeOption).toBeInTheDocument();

    fireEvent.click(customizeOption);
    expect(useTilesEditStore.getState().editing).toBe(true);

    // In edit mode: "Готово" and "Сбросить" are present
    expect(screen.getByRole("button", { name: "Готово" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Сбросить" })).toBeInTheDocument();
  });

  it("in edit mode, tile clicks do not run tools", () => {
    const runCaptureSpy = vi.spyOn(captureStore, "runCapture");
    useTilesEditStore.setState({ editing: true });

    render(<HomeTab />);

    // In edit mode, tiles are inside .hm-tile-entry
    const regionEntry = screen.getByText("Область").closest(".hm-tile-entry");
    expect(regionEntry).toBeInTheDocument();

    if (regionEntry) {
      fireEvent.click(regionEntry);
    }
    expect(runCaptureSpy).not.toHaveBeenCalled();
  });

  it("in edit mode, removes a tile when clicking 'x'", () => {
    useTilesEditStore.setState({ editing: true });
    render(<HomeTab />);

    const removeRegionBtn = screen.getByRole("button", { name: "Убрать Область" });
    fireEvent.click(removeRegionBtn);

    const currentTiles = useIslandStore.getState().settings.quickTiles;
    expect(currentTiles.some((t) => t.id === "region")).toBe(false);
  });

  it("in edit mode, toggles tile size", () => {
    // Start with 2 tiles: region (1x1), screen (1x1)
    useIslandStore.getState().applySettings({
      ...useIslandStore.getState().settings,
      quickTiles: [
        { id: "region", size: "1x1" },
        { id: "screen", size: "1x1" },
      ],
    });
    useTilesEditStore.setState({ editing: true });

    render(<HomeTab />);

    const expandBtns = screen.getAllByRole("button", { name: "Сделать 2×1" });
    expect(expandBtns[0]).toBeEnabled();

    fireEvent.click(expandBtns[0]);

    const currentTiles = useIslandStore.getState().settings.quickTiles;
    const regionTile = currentTiles.find((t) => t.id === "region");
    expect(regionTile?.size).toBe("2x1");
  });

  it("in edit mode, adds a hidden tile via '+' button", () => {
    // Only 2 tiles present, 4 cells free
    useIslandStore.getState().applySettings({
      ...useIslandStore.getState().settings,
      quickTiles: [
        { id: "region", size: "1x1" },
        { id: "screen", size: "1x1" },
      ],
    });
    useTilesEditStore.setState({ editing: true });

    render(<HomeTab />);

    const addBtn = screen.getByRole("button", { name: "Добавить плитку" });
    expect(addBtn).toBeInTheDocument();

    fireEvent.click(addBtn);

    // Menu with hidden tiles opens: "Текст с экрана", "QR-код", "Пипетка"
    const ocrMenuItem = screen.getByRole("menuitem", { name: "Текст с экрана" });
    expect(ocrMenuItem).toBeInTheDocument();

    fireEvent.click(ocrMenuItem);

    const currentTiles = useIslandStore.getState().settings.quickTiles;
    expect(currentTiles.some((t) => t.id === "ocr")).toBe(true);
  });

  it("resets tiles to default when clicking 'Сбросить'", () => {
    useIslandStore.getState().applySettings({
      ...useIslandStore.getState().settings,
      quickTiles: [{ id: "region", size: "1x1" }],
    });
    useTilesEditStore.setState({ editing: true });

    render(<HomeTab />);

    const resetBtn = screen.getByRole("button", { name: "Сбросить" });
    fireEvent.click(resetBtn);

    expect(useIslandStore.getState().settings.quickTiles).toEqual(DEFAULT_QUICK_TILES);
  });

  it("exits edit mode when clicking 'Готово'", () => {
    useTilesEditStore.setState({ editing: true });
    render(<HomeTab />);

    const doneBtn = screen.getByRole("button", { name: "Готово" });
    fireEvent.click(doneBtn);

    expect(useTilesEditStore.getState().editing).toBe(false);
  });

  it("exits edit mode on Escape key", () => {
    useTilesEditStore.setState({ editing: true });
    render(<HomeTab />);

    fireEvent.keyDown(window, { key: "Escape" });
    expect(useTilesEditStore.getState().editing).toBe(false);
  });

  it("exits edit mode when island mode collapses", () => {
    useTilesEditStore.setState({ editing: true });
    useIslandStore.getState().setMode("expanded");

    render(<HomeTab />);
    expect(useTilesEditStore.getState().editing).toBe(true);

    act(() => {
      useIslandStore.getState().setMode("collapsed");
    });
    expect(useTilesEditStore.getState().editing).toBe(false);
  });

  it.each(["ru", "en"] as const)("hides empty tools and opens customization from player or volume (%s)", (language) => {
    setLanguage(language);
    useIslandStore.getState().applySettings({
      ...useIslandStore.getState().settings,
      quickTiles: [],
    });

    const { container } = render(<HomeTab />);
    const home = container.querySelector(".hm-home");
    expect(home).not.toHaveClass("hm-home--with-tools");
    expect(home).toHaveAttribute("data-tall", "false");
    expect(container.querySelector(".hm-tools-wrap")).toBeNull();
    expect(container.querySelector(".hm-tools")).toBeNull();
    expect(screen.queryByRole("button", { name: t("tiles.empty") })).toBeNull();
    expect(screen.getByTestId("dock-mock")).toBeInTheDocument();

    for (const card of ["player-mock", "volume-mock"]) {
      fireEvent.contextMenu(screen.getByTestId(card));
      expect(screen.getByRole("menuitem", { name: t("tiles.customizeAction") })).toBeInTheDocument();
      fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
      expect(screen.queryByRole("menu")).toBeNull();
      expect(useTilesEditStore.getState().editing).toBe(false);
    }

    fireEvent.contextMenu(screen.getByTestId("player-mock"));
    fireEvent.click(screen.getByRole("menuitem", { name: t("tiles.customizeAction") }));
    expect(home).toHaveClass("hm-home--with-tools");
    expect(container.querySelector(".hm-tools")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: t("tiles.add") }));
    fireEvent.click(screen.getByRole("menuitem", { name: t("region") }));
    expect(useIslandStore.getState().settings.quickTiles).toEqual([{ id: "region", size: "1x1" }]);
    fireEvent.click(screen.getByRole("button", { name: t("done") }));
    expect(home).toHaveClass("hm-home--with-tools");
    expect(container.querySelector(".hm-tools")).toBeInTheDocument();
  });

  it("keeps the empty edit grid until Done, then returns to wide mode and can reset", async () => {
    useIslandStore.getState().applySettings({
      ...useIslandStore.getState().settings,
      quickTiles: [{ id: "region", size: "1x1" }],
    });
    useTilesEditStore.setState({ editing: true });
    const { container } = render(<HomeTab />);
    fireEvent.click(screen.getByRole("button", { name: "Убрать Область" }));
    await waitFor(() => expect(useIslandStore.getState().settings.quickTiles).toEqual([]));
    expect(container.querySelector(".hm-tools")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Добавить плитку" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Готово" }));
    expect(container.querySelector(".hm-tools")).toBeNull();
    expect(container.querySelector(".hm-home")).not.toHaveClass("hm-home--with-tools");

    fireEvent.contextMenu(screen.getByTestId("volume-mock"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Настроить плитки" }));
    fireEvent.click(screen.getByRole("button", { name: "Сбросить" }));
    await waitFor(() => expect(useIslandStore.getState().settings.quickTiles).toEqual(DEFAULT_QUICK_TILES));
    fireEvent.click(screen.getByRole("button", { name: "Готово" }));
    expect(container.querySelector(".hm-home")).toHaveClass("hm-home--with-tools");
    expect(screen.getByRole("button", { name: "Область" })).toBeInTheDocument();
  });
});
