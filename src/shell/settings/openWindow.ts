import { invoke } from "../../ipc";
import { localizeMessage, t } from "../../i18n";
import { showToast } from "../toast";

export async function openSettingsWindow(): Promise<void> {
  try { await invoke("settings_window_open"); }
  catch (error) {
    showToast({ label: t("settings.openFailed"), preview: localizeMessage(String(error)) });
  }
}
