/** SMTC source ids may be executables, packaged AUMIDs or browser PWA profiles. */
export function sourceDisplayName(source: string): string {
  const value = source.trim();
  const known: readonly [RegExp, string][] = [
    [/^(?:chrome|google\.chrome)(?:[._!\s]|$)/i, "Chrome"],
    [/^(?:msedge|microsoft\.(?:msedge|microsoftedge)|microsoftedge)(?:[._!\s]|$)/i, "Edge"],
    [/^(?:firefox|mozilla\.firefox)(?:[._!\s]|$)/i, "Firefox"],
    [/^(?:spotify|spotifyab\.spotifymusic)(?:[._!\s]|$)/i, "Spotify"],
    [/^(?:yandexmusic|yandex[. -]music|яндекс[. -]музыка)(?:[._!\s]|$)/i, "Яндекс Музыка"],
    [/^(?:telegram|(?:telegramdesktop|telegrammessengerllp)\.telegramdesktop)(?:[._!\s]|$)/i, "Telegram"],
    [/^(?:vlc|videolan\.vlc)(?:[._!\s]|$)/i, "VLC"],
    [/^(?:microsoft\.zunemusic|microsoft\.mediaplayer|wmplayer)(?:[._!\s]|$)/i, "Media Player"],
  ];
  for (const [pattern, name] of known) if (pattern.test(value)) return name;
  const label = value.replace(/\.exe$/i, "");
  const display = /\.exe$/i.test(value) ? label.charAt(0).toLocaleUpperCase() + label.slice(1) : label;
  const chars = Array.from(display);
  return chars.length > 40 ? chars.slice(0, 39).join("") + "…" : display;
}
