import { describe, expect, it } from "vitest";
import { sourceDisplayName } from "./sourceDisplayName";

describe("sourceDisplayName", () => {
  it.each([
    ["Chrome._crx_cinhiknlkffjgod.UserData.Profile1", "Chrome"],
    ["chrome.EXE", "Chrome"],
    ["MSEdge._crx_verylongid.UserData.Default", "Edge"],
    ["Microsoft.MSEdge_8wekyb3d8bbwe!App", "Edge"],
    ["Microsoft.MicrosoftEdge_8wekyb3d8bbwe!MicrosoftEdge", "Edge"],
    ["firefox.exe", "Firefox"],
    ["SpotifyAB.SpotifyMusic_zpdnekdrzrea0!Spotify", "Spotify"],
    ["YandexMusic.exe", "Яндекс Музыка"],
    ["Яндекс Музыка", "Яндекс Музыка"],
    ["TelegramDesktop.TelegramDesktop_t4vj0pshhgkwm!Telegram", "Telegram"],
    ["TelegramMessengerLLP.TelegramDesktop_t4vj0pshhgkwm!Telegram", "Telegram"],
    ["vlc.exe", "VLC"],
    ["VideoLAN.VLC_paz6r1rewnh0a!App", "VLC"],
    ["Microsoft.ZuneMusic_8wekyb3d8bbwe!Microsoft.ZuneMusic", "Media Player"],
    ["wmplayer.exe", "Media Player"],
    [" customPlayer.exe ", "CustomPlayer"],
    ["Unknown.Application!Player", "Unknown.Application!Player"],
    ["ChromeImpersonator.exe", "ChromeImpersonator"],
    ["", ""],
  ])("%s → %s", (input, expected) => expect(sourceDisplayName(input)).toBe(expected));

  it("caps unknown names by Unicode characters without breaking surrogate pairs", () => {
    const name = sourceDisplayName("🎵".repeat(60));
    expect(Array.from(name)).toHaveLength(40);
    expect(name).toBe("🎵".repeat(39) + "…");
  });
});
