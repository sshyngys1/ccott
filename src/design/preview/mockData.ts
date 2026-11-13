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
];

// ═════════════════════════════════ Command Bar Mock Data (v0.3) ═════════════════════════════════

export type CmdKind = "app" | "file" | "calc" | "convert" | "command";

export interface MockCmdItem {
  id: string;
  kind: CmdKind;
  title: string;
  meta: string;
  actionHint?: string;
  secondaryAction?: string;
  value?: string;
  formula?: string;
  submeta?: string;
  group: "apps" | "files" | "calc" | "convert" | "commands" | "recent";
}

export const MOCK_CMD_ITEMS: MockCmdItem[] = [
  // Apps
  {
    id: "app-1",
    kind: "app",
    group: "apps",
    title: "Telegram",
    meta: "Telegram Desktop · Мессенджер",
    actionHint: "Открыть",
    secondaryAction: "От имени администратора",
  },
  {
    id: "app-2",
    kind: "app",
    group: "apps",
    title: "Visual Studio Code",
    meta: "Code.exe · Редактор кода",
    actionHint: "Открыть",
    secondaryAction: "В терминале",
  },
  {
    id: "app-3",
    kind: "app",
    group: "apps",
    title: "YouTube Music",
    meta: "th-ch/youtube-music · Музыкальный плеер",
    actionHint: "Открыть",
  },
  {
    id: "app-4",
    kind: "app",
    group: "apps",
    title: "Google Chrome",
    meta: "Chrome.exe · Браузер",
    actionHint: "Открыть",
    secondaryAction: "Новое окно инкогнито",
  },
  {
    id: "app-5",
    kind: "app",
    group: "apps",
    title: "Терминал Windows",
    meta: "WindowsTerminal.exe · PowerShell 7",
    actionHint: "Открыть",
    secondaryAction: "От имени администратора",
  },

  // Files
  {
    id: "file-1",
    kind: "file",
    group: "files",
    title: "design-spec.md",
    meta: "Documents\\Projects\\design-spec.md · 28 КБ",
    actionHint: "Открыть",
    secondaryAction: "Показать в папке",
  },
  {
    id: "file-2",
    kind: "file",
    group: "files",
    title: "quarterly-report-2026.xlsx",
    meta: "C:\\Users\\User\\Documents\\Work · 240 КБ",
    actionHint: "Открыть в Excel",
    secondaryAction: "Показать в папке",
  },
  {
    id: "file-3",
    kind: "file",
    group: "files",
    title: "architecture-v03.png",
    meta: "C:\\Users\\User\\Pictures\\Screenshots · 1.2 МБ",
    actionHint: "Просмотр",
    secondaryAction: "Копировать файл",
  },

  // Commands
  {
    id: "cmd-timer-10",
    kind: "command",
    group: "commands",
    title: "Таймер 10 мин",
    meta: "Запустить быстрый таймер в пилюле острова",
    actionHint: "Запустить",
  },
  {
    id: "cmd-timer-25",
    kind: "command",
    group: "commands",
    title: "Таймер Помодоро (25 мин)",
    meta: "Фокус-сессия 25 минут с уведомлением в конце",
    actionHint: "Запустить",
  },
  {
    id: "cmd-clear-clips",
    kind: "command",
    group: "commands",
    title: "Очистить историю буфера",
    meta: "Удалить все незакреплённые записи буфера обмена",
    actionHint: "Выполнить",
  },
  {
    id: "cmd-screenshot-region",
    kind: "command",
    group: "commands",
    title: "Сделать снимок области",
    meta: "Выбрать область экрана и сохранить в буфер",
    actionHint: "Запустить",
  },
];

export interface MockHeroAnswer {
  kind: "calc" | "convert";
  value: string;
  formula: string;
  meta: string;
  isOffline?: boolean;
}

export const MOCK_HERO_ANSWERS: Record<string, MockHeroAnswer> = {
  calc: {
    kind: "calc",
    value: "= 87",
    formula: "12 × 7 + 3",
    meta: "Калькулятор · Точный результат",
  },
  percent: {
    kind: "calc",
    value: "= 360",
    formula: "15% от 2 400 = 0.15 × 2400",
    meta: "Калькулятор · Проценты",
  },
  currency: {
    kind: "convert",
    value: "= 49 500 ₸",
    formula: "100 USD = 49 500 KZT",
    meta: "1 USD = 495.00 KZT · Онлайн (ЦБ) · Обновлено 2 мин назад",
  },
  currencyOffline: {
    kind: "convert",
    value: "= 63 540 ₸",
    formula: "100 GBP = 63 540 KZT",
    meta: "1 GBP = 635.40 KZT · Офлайн-кэш от 01.11.2026 (2 ч назад)",
    isOffline: true,
  },
  currencyLoading: {
    kind: "convert",
    value: "≈ 108.50 $",
    formula: "100 EUR → USD",
    meta: "Загрузка актуального курса ЕЦБ...",
  },
  units: {
    kind: "convert",
    value: "= 3.107 мили",
    formula: "5 км = 3.10686 мили",
    meta: "1 км = 0.621371 мили · Метрическая система",
  },
};

export interface MockCmdHint {
  query: string;
  label: string;
  desc: string;
  kind: "calc" | "percent" | "convert" | "ruler" | "timer" | "file";
}

export const MOCK_CMD_HINTS: MockCmdHint[] = [
  { query: "12*7+3", label: "12*7+3", desc: "Мгновенный калькулятор", kind: "calc" },
  { query: "15% от 2400", label: "15% от 2400", desc: "Расчёт процентов", kind: "percent" },
  { query: "100 usd в kzt", label: "100 usd в kzt", desc: "Конвертер валют по курсу", kind: "convert" },
  { query: "5 км в мили", label: "5 км в мили", desc: "Перевод единиц длины", kind: "ruler" },
  { query: "таймер 10 мин", label: "таймер 10 мин", desc: "Быстрый запуск таймера", kind: "timer" },
  { query: "design-spec", label: "design-spec", desc: "Быстрый поиск файла", kind: "file" },
];

