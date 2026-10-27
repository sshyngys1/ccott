// Owner: Designer. Mock data for the design preview only (not the app's mock IPC — that is src/ipc/mock.ts, F1).
import type { ClipItem, Note } from "../../shared/types";

const MIN = 60_000;
const now = Date.now();

/** ClipItem + the strings the row shows (F2 derives them: app name from sourceApp, relative time from createdAt). */
export interface MockClip extends ClipItem {
  app: string;
  ago: string;
  /** Extra meta for images/files («1280×720», «2 файла»). */
  extra?: string;
}

export const CLIPS: MockClip[] = [
  { id: 11, kind: "text", text: "", preview: "Реквизиты: ИИК KZ00 0000 0000 0000 0000, БИК XXXXKZKA", sourceApp: "Telegram.exe", app: "Telegram", createdAt: now - 3 * 24 * 60 * MIN, ago: "3 дня назад", pinned: true },
  { id: 10, kind: "link", text: "", preview: "https://github.com/island-win/island-win/pull/12", sourceApp: "msedge.exe", app: "Edge", createdAt: now - 26 * 60 * MIN, ago: "вчера", pinned: true },
  { id: 9, kind: "text", text: "", preview: "npm run tauri dev -- --features devtools", sourceApp: "WindowsTerminal.exe", app: "Терминал", createdAt: now - 2 * MIN, ago: "2 мин назад", pinned: false },
  { id: 8, kind: "image", text: "", preview: "", sourceApp: "SnippingTool.exe", app: "Ножницы", createdAt: now - 9 * MIN, ago: "9 мин назад", pinned: false, extra: "Изображение 1280×720" },
  { id: 7, kind: "link", text: "", preview: "https://learn.microsoft.com/windows/win32/dwm/dwm-overview", sourceApp: "msedge.exe", app: "Edge", createdAt: now - 14 * MIN, ago: "14 мин назад", pinned: false },
  { id: 6, kind: "files", text: "", preview: "отчёт-q3.xlsx, смета-ремонт.pdf", sourceApp: "explorer.exe", app: "Проводник", createdAt: now - 40 * MIN, ago: "40 мин назад", pinned: false, extra: "2 файла" },
  { id: 5, kind: "text", text: "", preview: "Встреча перенесена на четверг, 15:30. Ссылку пришлю отдельно.", sourceApp: "Outlook.exe", app: "Outlook", createdAt: now - 65 * MIN, ago: "1 ч назад", pinned: false },
  { id: 4, kind: "text", text: "", preview: "#3dd6c6", sourceApp: "Code.exe", app: "VS Code", createdAt: now - 2 * 60 * MIN, ago: "2 ч назад", pinned: false },
];

export const FOLDERS = [
  { name: "Все", count: 7 },
  { name: "Заметка", count: 3 },
  { name: "Работа", count: 2 },
  { name: "Идеи", count: 2 },
] as const;

export interface MockNote extends Note {
  when: string;
}

export const NOTES: MockNote[] = [
  {
    id: 3,
    folder: "Работа",
    title: "Релиз 0.2",
    when: "14:32",
    updatedAt: now - 5 * MIN,
    body:
      "<h3>Релиз 0.2</h3><p>Собрать установщик и проверить на <b>Windows 10</b> и 11.</p>" +
      '<ul data-type="checklist"><li data-checked="true">Буфер обмена: поиск и закрепление</li><li data-checked="true">Вкладка «Текст»</li><li data-checked="false">Таймер в пилюле</li><li data-checked="false">Настройки: монитор и задержки</li></ul>' +
      "<p><i>После релиза</i> — собрать отзывы.</p>",
  },
  { id: 2, folder: "Заметка", title: "Купить", when: "вчера", updatedAt: now - 26 * 60 * MIN, body: "<ul><li>Кофе</li><li>Батарейки AA</li></ul>" },
  { id: 1, folder: "Идеи", title: "Капля-уведомление при зарядке", when: "пн", updatedAt: now - 4 * 24 * 60 * MIN, body: "<p>Пилюля «отпускает» каплю с процентом заряда.</p>" },
  { id: 0, folder: "Работа", title: "Созвон с дизайнером", when: "12 окт", updatedAt: now - 15 * 24 * 60 * MIN, body: "<p>Обсудить фокус-кольца и светлую тему.</p>" },
];

export const TEXT_SAMPLE = "Ghbdtn! Rfr ltkf? Pfdnhf dcnhtxf d 15:30.\n  лишние   пробелы   в   строке  ";
export const JSON_BROKEN = '{\n  "name": "island-win",\n  "version": "0.2.0"\n  "private": true\n}';

export const TIMER_PRESETS = [1, 3, 5, 10, 25] as const;

export const MONITORS = [
  { id: "primary", name: "Основной · 2560×1600" },
  { id: "\\\\.\\DISPLAY2", name: "DELL U2720Q · 3840×2160" },
] as const;
