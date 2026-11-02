import type { ComponentType } from "react";
import type { TranslationKey } from "../../i18n";
import {
  IconPipette,
  IconQr,
  IconRegion,
  IconScanText,
  IconScreen,
  IconFolder,
  IconClipboard,
  IconNote,
  IconTimer,
  IconCommand,
  type IconProps,
} from "../../design/icons";
import { runCapture, runPickColor } from "../capture/store";
import { captureOpenFolder } from "../../ipc/capture";
import { useIslandStore } from "../../store";
import type { TileId, TileSize } from "../../shared/types";
import { requestShell } from "../../shared/shellBus";

export interface TileDefinition {
  id: TileId;
  titleKey: TranslationKey;
  hintKey?: TranslationKey;
  icon: ComponentType<IconProps>;
  allowedSizes: readonly TileSize[];
  action: (event: { shiftKey?: boolean }) => void | Promise<void>;
}

export const TILE_IDS: readonly TileId[] = ["region", "screen", "ocr", "qr", "color", "screenshots", "clipboard", "note", "timer", "command"];

export const TILE_REGISTRY: Record<TileId, TileDefinition> = {
  command: {
    id: "command",
    titleKey: "tiles.command",
    icon: IconCommand,
    allowedSizes: ["1x1", "2x1"],
    action: () => requestShell({ type: "openCommand" }),
  },
  region: {
    id: "region",
    titleKey: "region",
    hintKey: "capture.copyHint",
    icon: IconRegion,
    allowedSizes: ["1x1", "2x1"],
    action: (event) => runCapture("region", event.shiftKey ? "save" : "copy"),
  },
  screen: {
    id: "screen",
    titleKey: "fullScreen",
    hintKey: "capture.copyHint",
    icon: IconScreen,
    allowedSizes: ["1x1", "2x1"],
    action: (event) => runCapture("screen", event.shiftKey ? "save" : "copy"),
  },
  ocr: {
    id: "ocr",
    titleKey: "textFromScreen",
    icon: IconScanText,
    allowedSizes: ["1x1", "2x1"],
    action: () => runCapture("region", "ocr"),
  },
  qr: {
    id: "qr",
    titleKey: "qrCode",
    icon: IconQr,
    allowedSizes: ["1x1", "2x1"],
    action: () => runCapture("region", "qr"),
  },
  color: {
    id: "color",
    titleKey: "colorPicker",
    icon: IconPipette,
    allowedSizes: ["1x1", "2x1"],
    action: () => runPickColor(),
  },
  screenshots: {
    id: "screenshots",
    titleKey: "tiles.screenshots",
    hintKey: "capture.openFolder",
    icon: IconFolder,
    allowedSizes: ["1x1", "2x1"],
    action: () => captureOpenFolder().catch((error: unknown) => console.warn("[island] capture_open_folder failed", error)),
  },
  clipboard: {
    id: "clipboard",
    titleKey: "clipboard",
    icon: IconClipboard,
    allowedSizes: ["1x1", "2x1"],
    action: () => useIslandStore.getState().setActiveTab("clipboard"),
  },
  note: {
    id: "note",
    titleKey: "newNote",
    icon: IconNote,
    allowedSizes: ["1x1", "2x1"],
    action: async () => {
      const { useNotesStore } = await import("../notes/store");
      useNotesStore.getState().newNote(true);
      useIslandStore.getState().setActiveTab("notes");
    },
  },
  timer: {
    id: "timer",
    titleKey: "timer",
    icon: IconTimer,
    allowedSizes: ["1x1", "2x1"],
    action: async () => {
      const { useNotesStore } = await import("../notes/store");
      useNotesStore.getState().requestTimerFocus();
      useIslandStore.getState().setActiveTab("notes");
    },
  },
};

export function isKnownTileId(id: string): id is TileId {
  return Object.prototype.hasOwnProperty.call(TILE_REGISTRY, id);
}

export function getTileDefinition(id: string): TileDefinition | undefined {
  if (isKnownTileId(id)) {
    return TILE_REGISTRY[id];
  }
  return undefined;
}
