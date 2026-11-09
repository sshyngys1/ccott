// Owner: F2 (Frontend-Modules). What's New catalog & acknowledgment storage.
import { compareSemver, normalizeSemver } from "./semver";
import type { TranslationKey } from "../../i18n";

export interface WhatsNewItem {
  id: string;
  icon: "player" | "spectrum" | "battery" | "changelog" | "command" | "shelf" | "downloads" | "tiles" | "lite" | "motion";
  titleKey: TranslationKey;
  descKey: TranslationKey;
  stepKeys?: TranslationKey[];
}

export const WHATS_NEW_CATALOG: Record<string, WhatsNewItem[]> = {
  "0.2.2": [
    {
      id: "player",
      icon: "player",
      titleKey: "whatsNew.v022.player.title",
      descKey: "whatsNew.v022.player.desc",
    },
    {
      id: "spectrum",
      icon: "spectrum",
      titleKey: "whatsNew.v022.visualizer.title",
      descKey: "whatsNew.v022.visualizer.desc",
    },
    {
      id: "battery",
      icon: "battery",
      titleKey: "whatsNew.v022.battery.title",
      descKey: "whatsNew.v022.battery.desc",
    },
    {
      id: "changelog",
      icon: "changelog",
      titleKey: "whatsNew.v022.changelog.title",
      descKey: "whatsNew.v022.changelog.desc",
    },
  ],
  "0.2.3": [
    { id: "lighter", icon: "battery", titleKey: "whatsNew.v023.lighter.title", descKey: "whatsNew.v023.lighter.desc" },
    { id: "smoother", icon: "changelog", titleKey: "whatsNew.v023.smoother.title", descKey: "whatsNew.v023.smoother.desc" },
    { id: "cover", icon: "player", titleKey: "whatsNew.v023.cover.title", descKey: "whatsNew.v023.cover.desc" },
    { id: "equalizer", icon: "spectrum", titleKey: "whatsNew.v023.equalizer.title", descKey: "whatsNew.v023.equalizer.desc" },
    { id: "dock", icon: "changelog", titleKey: "whatsNew.v023.dock.title", descKey: "whatsNew.v023.dock.desc" },
  ],
  "0.3.0": [
    {
      id: "command", icon: "command",
      titleKey: "whatsNew.v030.command.title", descKey: "whatsNew.v030.command.desc",
      stepKeys: ["whatsNew.v030.command.step1", "whatsNew.v030.command.step2", "whatsNew.v030.command.step3", "whatsNew.v030.command.step4"],
    },
    {
      id: "shelf", icon: "shelf",
      titleKey: "whatsNew.v030.shelf.title", descKey: "whatsNew.v030.shelf.desc",
      stepKeys: ["whatsNew.v030.shelf.step1", "whatsNew.v030.shelf.step2", "whatsNew.v030.shelf.step3", "whatsNew.v030.shelf.step4"],
    },
    {
      id: "downloads", icon: "downloads",
      titleKey: "whatsNew.v030.downloads.title", descKey: "whatsNew.v030.downloads.desc",
      stepKeys: ["whatsNew.v030.downloads.step1", "whatsNew.v030.downloads.step2", "whatsNew.v030.downloads.step3"],
    },
    {
      id: "tiles", icon: "tiles",
      titleKey: "whatsNew.v030.tiles.title", descKey: "whatsNew.v030.tiles.desc",
      stepKeys: ["whatsNew.v030.tiles.step1", "whatsNew.v030.tiles.step2", "whatsNew.v030.tiles.step3", "whatsNew.v030.tiles.step4"],
    },
    {
      id: "lite", icon: "lite",
      titleKey: "whatsNew.v030.lite.title", descKey: "whatsNew.v030.lite.desc",
      stepKeys: ["whatsNew.v030.lite.step1"],
    },
    {
      id: "motion", icon: "motion",
      titleKey: "whatsNew.v030.motion.title", descKey: "whatsNew.v030.motion.desc",
    },
  ],
  "0.4.0": [
    {
      id: "lyrics", icon: "player",
      titleKey: "whatsNew.v040.lyrics.title", descKey: "whatsNew.v040.lyrics.desc",
      stepKeys: ["whatsNew.v040.lyrics.step1"],
    },
    {
      id: "control", icon: "tiles",
      titleKey: "whatsNew.v040.control.title", descKey: "whatsNew.v040.control.desc",
    },
    {
      id: "weather", icon: "changelog",
      titleKey: "whatsNew.v040.weather.title", descKey: "whatsNew.v040.weather.desc",
    },
    {
      id: "reminders", icon: "changelog",
      titleKey: "whatsNew.v040.reminders.title", descKey: "whatsNew.v040.reminders.desc",
      stepKeys: ["whatsNew.v040.reminders.step1"],
    },
    {
      id: "agents", icon: "command",
      titleKey: "whatsNew.v040.agents.title", descKey: "whatsNew.v040.agents.desc",
      stepKeys: ["whatsNew.v040.agents.step1"],
    },
    {
      id: "settings", icon: "tiles",
      titleKey: "whatsNew.v040.settings.title", descKey: "whatsNew.v040.settings.desc",
      stepKeys: ["whatsNew.v040.settings.step1"],
    },
    {
      id: "files", icon: "shelf",
      titleKey: "whatsNew.v040.files.title", descKey: "whatsNew.v040.files.desc",
    },
    {
      id: "currency", icon: "command",
      titleKey: "whatsNew.v040.currency.title", descKey: "whatsNew.v040.currency.desc",
    },
  ],
};

export const WHATS_NEW_STORAGE_KEY = "ccott:whats-new:last-acknowledged";

/**
 * Returns catalog items for a version, or null if no catalog exists for that version.
 */
export function getWhatsNewForVersion(version: string): WhatsNewItem[] | null {
  if (!version) return null;
  const cleaned = normalizeSemver(version);
  return cleaned && Object.prototype.hasOwnProperty.call(WHATS_NEW_CATALOG, cleaned) ? WHATS_NEW_CATALOG[cleaned] : null;
}

/**
 * Safe read from localStorage for the last acknowledged version.
 */
export function getLastAcknowledgedVersion(): string | null {
  try {
    const stored = window.localStorage.getItem(WHATS_NEW_STORAGE_KEY);
    return stored === null ? null : normalizeSemver(stored);
  } catch {
    return null;
  }
}

/**
 * Safe write to localStorage marking a version as acknowledged.
 */
export function acknowledgeWhatsNew(version: string): void {
  try {
    const cleaned = normalizeSemver(version);
    if (!cleaned) return;
    const stored = window.localStorage.getItem(WHATS_NEW_STORAGE_KEY);
    const previous = stored === null ? null : normalizeSemver(stored);
    if (previous && compareSemver(cleaned, previous) <= 0) return;
    window.localStorage.setItem(WHATS_NEW_STORAGE_KEY, cleaned);
  } catch {
    // Gracefully ignore storage failures
  }
}

/**
 * Determines whether What's New should auto-show for the current app version.
 * Rules per §17:
 * - Version must exist in WHATS_NEW_CATALOG (unknown version never creates a blank panel).
 * - Fresh install (no marker): shows once.
 * - Upgrade (current > lastAcknowledged): shows once.
 * - Same version (current == lastAcknowledged): does NOT show.
 * - Downgrade (current < lastAcknowledged): does NOT show.
 */
export function shouldAutoShowWhatsNew(
  currentVersion: string,
  lastAckVersion: string | null = getLastAcknowledgedVersion(),
): boolean {
  const catalog = getWhatsNewForVersion(currentVersion);
  if (!catalog || catalog.length === 0) {
    return false;
  }

  if (lastAckVersion === null) {
    // Fresh install or first time seeing version with catalog
    return true;
  }

  // Compare versions semantically (not lexicographical)
  return compareSemver(currentVersion, lastAckVersion) > 0;
}
