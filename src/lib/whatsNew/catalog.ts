// Owner: F2 (Frontend-Modules). What's New catalog & acknowledgment storage.
import { compareSemver, normalizeSemver } from "./semver";
import type { TranslationKey } from "../../i18n";

export interface WhatsNewItem {
  id: string;
  icon: "player" | "spectrum" | "battery" | "changelog";
  titleKey: TranslationKey;
  descKey: TranslationKey;
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
