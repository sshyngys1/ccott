# Контракты island-win

Единый источник правды для всех агентов. Типы в коде — `src/shared/types.ts` (TS) — **приоритетнее** этого текста при расхождении.
Владелец: Orchestrator. Нужна правка контракта → опиши её в отчёте, Orchestrator решит и обновит оба файла.

## 1. Общие соглашения IPC

- Команды Tauri: `snake_case`, префикс домена — `island_*`, `window_*`, `settings_*`, `updater_*`, `media_*`, `audio_*`, `clipboard_*`, `notes_*`.
- Аргументы с JS передаются в camelCase (`{ positionMs }`), в Rust параметр `position_ms` — Tauri конвертирует сам.
- Структуры Rust: `#[derive(Serialize, Deserialize, Clone)] #[serde(rename_all = "camelCase")]`. Enum-ы — `#[serde(rename_all = "camelCase")]` (→ `"playPause"`, `"acrylic"`).
- Ошибки команд: `Result<T, String>` (сообщение для лога/тоста; UI не парсит текст).
- События: `домен://событие`, payload — тип из `Events` в `types.ts`. Эмитятся через `app.emit(...)` (всем окнам).
- Время — epoch ms (`i64` в Rust, `number` в TS). Картинки в IPC — `data:` URL.
- Команды не блокируют UI-поток: тяжёлое — в `tauri::async_runtime::spawn_blocking` / отдельный поток.
- UI вызывает Rust **только** через `src/ipc` (типизированные `invoke<C>()` / `listen<E>()`); прямой `@tauri-apps/api/core` в модулях запрещён.

## 2. Окно острова (волна 1, R1)

- Одно окно, label **`island`**: без рамки, прозрачное, always-on-top, `skipTaskbar`, без тени, нересайзится. Размер фиксирован: `ISLAND_WINDOW = 800×520` CSS px. Позиция: по центру верхнего края выбранного монитора, `y = 0`.
- Win32-стили: `WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE` (не крадёт фокус, нет в Alt+Tab). Окно создаётся видимым (`visible: true`): у скрытого при создании окна WebView2 не регистрирует приём перетаскивания файлов на своих дочерних окнах, и drop в док не работает. Прозрачное окно до позиционирования невидимо.
- Видимая форма острова — React-элемент внутри окна. UI сообщает её через `island_set_shape({ shape })` при каждом изменении (во время анимации — не чаще 1 раза за кадр, rAF-троттлинг на стороне UI).
- Rust опрашивает курсор (`GetCursorPos`, ~60 Гц, только пока окно видимо), сравнивает с `IslandShape`:
  - курсор вне формы → `set_ignore_cursor_events(true)` (клики проходят сквозь);
  - внутри → `set_ignore_cursor_events(false)`;
  - при смене состояния эмитит `island://hover { inside }`.
- `island_set_mode({ mode })` — UI сообщает collapsed/expanded (Rust может использовать для частоты опроса и регионов).
- `window_set_vibrancy({ mode })` → `VibrancyResult`: пробует Acrylic/Mica (`window-vibrancy`), при ошибке возвращает `applied: "none"` и текст ошибки. Если blur применяется ко всему окну, R1 ограничивает его формой (`SetWindowRgn` по `IslandShape`) — результат и артефакты описать в отчёте.
- `window_list_monitors()` → `MonitorInfo[]`.

## 3. Команды и события (полный список)

| Команда | Аргументы | Результат | Владелец | Волна |
|---|---|---|---|---|
| `island_set_shape` | `{ shape: IslandShape }` | — | R1 | 1 |
| `island_set_mode` | `{ mode: "collapsed" \| "expanded" }` | — | R1 | 1 |
| `window_set_vibrancy` | `{ mode: VibrancyMode }` | `VibrancyResult` | R1 | 1 |
| `window_list_monitors` | — | `MonitorInfo[]` | R1 | 1 |
| `island_set_keyboard_focus` | `{ active }` | — | R1 | 2 |
| `settings_get` | — | `Settings` | R1 | 2 |
| `settings_set` | `{ patch: Partial<Settings> }` | `Settings` | R1 | 2 |
| `window_recent_fullscreen_apps` | — | `FullscreenApp[]` (новые сверху, ≤ 20) | R1 | 2.1 |
| `updater_check` | — | `UpdateInfo \| null` | R1 | 2.1 |
| `updater_install` | — | — | R1 | 2.1 |
| `media_get_state` | — | `MediaState` | R2 | 2 |
| `media_action` | `{ action: "playPause" \| "next" \| "previous" }` | — | R2 | 2 |
| `media_seek` | `{ positionMs }` | — | R2 | 2 |
| `audio_get_state` | — | `AudioState` | R2 | 2 |
| `audio_set_volume` | `{ volume: 0..100 }` | — | R2 | 2 |
| `audio_set_muted` | `{ muted }` | — | R2 | 2 |
| `audio_list_devices` | — | `AudioDevice[]` | R2 | 2 |
| `audio_set_device` | `{ id }` | — | R2 | 2 |
| `clipboard_list` | `{ query, limit }` | `ClipItem[]` (pinned сверху, затем по `createdAt` desc; `text` в списке обрезан до 10 000 символов — вставка берёт полный текст из БД; миниатюры картинок — JPEG) | R2 | 2 |
| `clipboard_paste` | `{ id, mode: "paste" \| "copy" }` | — | R2 | 2 |
| `clipboard_pin` | `{ id, pinned }` | — | R2 | 2 |
| `clipboard_delete` | `{ id }` | — | R2 | 2 |
| `clipboard_clear` | `{ keepPinned }` | — | R2 | 2 |
| `notes_list` | — | `Note[]` | R2 | 2 |
| `notes_save` | `{ note: { id \| null, folder, title, body } }` | `Note` | R2 | 2 |
| `notes_delete` | `{ id }` | — | R2 | 2 |

| Событие | Payload | Кто эмитит |
|---|---|---|
| `island://hover` | `HoverPayload` | R1 |
| `island://focus-changed` | `{ active }` | R1 (в т.ч. когда фокус ушёл сам — пользователь кликнул в другое окно) |
| `island://open-settings` | `null` | R1 (пункт трея «Настройки») |
| `island://summoned` | `null` | R1 (нажата горячая клавиша вызова; остров уже показан, UI переключает раскрытие) |
| `settings://changed` | `Settings` | R1 |
| `updater://available` | `UpdateInfo` | R1 (обнаружена новая версия при фоновой или ручной проверке) |
| `media://changed` | `MediaState` | R2 |
| `audio://changed` | `AudioState` | R2 |
| `clipboard://added` | `ClipItem` | R2 (UI показывает «Скопировано» в пилюле) |
| `clipboard://changed` | `null` | R2 (UI перезапрашивает список) |

Хранилище: SQLite-файл `%APPDATA%\dev.islandwin.app\island.db` (`app.path().app_data_dir()`), `rusqlite` (bundled). Настройки — `settings.json` там же.

## 3a. Клавиатурный фокус (волна 2, решение пользователя)

Окно `WS_EX_NOACTIVATE` не получает клавиш. Механизм:
- **F1 (глобально, модулям ничего делать не нужно):** document-level `focusin` на `input, textarea, [contenteditable="true"]` внутри раскрытой панели → `island_set_keyboard_focus({ active: true })`. При сворачивании панели или `Escape` → `blur()` активного элемента, `island_set_keyboard_focus({ active: false })` и остров сворачивается (один Escape; модуль, которому Escape нужен для себя — очистить поиск, — вызывает `e.preventDefault()`). На `island://focus-changed { active:false }` — только `blur()` и сброс флага, без повторного вызова команды (фокус уже ушёл к другому приложению). Пока фокус активен, остров не сворачивается по уходу курсора (сворачивается по Escape / клику вне — т.е. потере фокуса).
- **R1:** `active:true` → запомнить `GetForegroundWindow()` (если это не наше окно), временно снять `WS_EX_NOACTIVATE` (через тот же subclass-механизм), `SetForegroundWindow` на остров (с обходом foreground lock: `AttachThreadInput` / `AllowSetForegroundWindow` / ALT-trick — описать выбранное в отчёте). `active:false` → вернуть `NOACTIVATE`, `SetForegroundWindow(запомненное)` если окно ещё живо. `WM_ACTIVATE(WA_INACTIVE)` пока активен фокус → вернуть `NOACTIVATE` и эмитить `island://focus-changed { active:false }`.
- **R2 (`clipboard_paste` mode `paste`):** не зависит от R1 — сам отслеживает последнее foreground-окно **не нашего процесса** (`SetWinEventHook(EVENT_SYSTEM_FOREGROUND)`), перед `SendInput(Ctrl+V)` делает его foreground, если сейчас foreground — остров. UI перед вызовом paste сворачивает остров.

## 3b. Live-activities, настройки, DND

- Модуль задаёт `compact` (F2: трек — в `home`, таймер — в `notes`). F1 рендерит в пилюле активность с наибольшим `priority` среди `useIsActive()==true` (ширина — токен activity pill из design-spec), иначе часы.
- Состояние, нужное и вкладке и `compact` (медиа, таймер), F2 держит в своих Zustand-сторах в `src/lib/<area>/` или в модуле; F2 сам вызывает `src/ipc` из модулей.
- Настройки: UI — F1 (`src/shell/settings/**`), открывается иконкой-шестерёнкой в таб-баре и событием `island://open-settings`. `doNotDisturb=true` → F1 не показывает тосты в пилюле. `hideInFullscreen` и `monitor` исполняет R1 целиком на своей стороне.

## 4. Интерфейс UI-модуля

```ts
interface IslandModule {
  id: ModuleId;            // "home" | "clipboard" | "text" | "notes" | ...
  title: string;           // подпись вкладки (ru)
  icon: ComponentType<ModuleIconProps>;
  Tab: ComponentType;      // содержимое раскрытой панели
  compact?: { useIsActive(): boolean; priority: number; View: ComponentType }; // live-activity в пилюле
  order: number;
}
```

- Модуль живёт в `src/modules/<id>/index.ts(x)` и экспортирует `default` объект `IslandModule`.
- `src/modules/registry.ts` (F1) — массив модулей; добавление модуля = одна строка импорта + одна строка в массиве.
- Чистая логика модулей — `src/lib/<area>/*.ts` + `*.test.ts` рядом (vitest).

## 5. Мок-IPC

- `src/ipc/index.ts` экспортирует `invoke<C extends CommandName>(cmd, args): Promise<CommandResult<C>>` и `listen<E extends EventName>(event, cb): Promise<Unlisten>`.
- Если `window.__TAURI_INTERNALS__` нет (обычный браузер, `npm run dev`) — используется `src/ipc/mock.ts` с правдоподобными данными (играющий трек, 10 записей буфера, 3 заметки) и эмуляцией событий. `island://hover` в моке генерируется из `mouseenter/mouseleave` по элементу острова.
- Так UI и дизайн проверяются в браузере (`http://localhost:1420`) без Rust.

## 6. Дизайн-токены (волна 1, Designer)

Имена ниже **фиксированы** — Designer задаёт значения в `src/design/tokens.css` (может добавлять новые, но не переименовывать эти). Остальные агенты используют только `var(--ig-*)`, никаких «магических» цветов и размеров.

| Группа | Переменные |
|---|---|
| Поверхности | `--ig-surface` (основное стекло), `--ig-surface-strong` (пилюля в покое), `--ig-surface-raised` (плитки/контролы), `--ig-surface-hover`, `--ig-surface-pressed` |
| Обводки/блики | `--ig-stroke`, `--ig-stroke-strong`, `--ig-specular` (градиент кромки), `--ig-glow` |
| Текст | `--ig-text`, `--ig-text-secondary`, `--ig-text-tertiary`, `--ig-text-on-accent` |
| Акцент/статусы | `--ig-accent`, `--ig-success`, `--ig-warning`, `--ig-danger` |
| Геометрия | `--ig-pill-width`, `--ig-pill-height`, `--ig-pill-top`, `--ig-panel-width`, `--ig-panel-height`, `--ig-radius-pill`, `--ig-radius-panel`, `--ig-radius-lg`, `--ig-radius-md`, `--ig-radius-sm` |
| Отступы | `--ig-space-1` … `--ig-space-6` |
| Типографика | `--ig-font`, `--ig-font-mono`, `--ig-text-xs`, `--ig-text-sm`, `--ig-text-md`, `--ig-text-lg`, `--ig-text-xl` |
| Эффекты | `--ig-blur`, `--ig-shadow`, `--ig-noise-opacity` |

Классы из `src/design/glass.css`: `.ig-glass` (основная стеклянная поверхность), `.ig-glass-control` (кнопка/плитка), `.ig-glass-input`. Тема — атрибут `data-theme="light|dark"` на `<html>`.
Нативный blur — атрибут `data-vibrancy="acrylic|mica|none"` на `<html>`: F1 ставит его из `VibrancyResult.applied` (в браузере/моке — `none`). Designer обязан стилизовать оба случая: с нативным blur под окном (стекло прозрачнее) и без него (fallback — плотная тёмная/светлая подложка + CSS-стекло).
Блик за курсором: CSS-переменные `--ig-pointer-x`, `--ig-pointer-y` (px относительно элемента) — Designer использует их в `.ig-glass`, выставляет их хук из `src/design/` (подключает F1).
SVG-фильтры — компонент `<GlassFilters />` (монтируется один раз в `App.tsx`), id фильтров с префиксом `ig-` (например `url(#ig-refraction)`).
Пружины анимаций — `src/design/motion.ts`: `export const springs = { expand, collapse, tab, press }` (объекты transition для Motion).
Панель (`--ig-panel-width/height` + тень) обязана помещаться в `ISLAND_WINDOW` 800×520.

## 7. Shell bus (волна 2)

`src/shared/shellBus.ts`: модули (F2) просят оболочку (F1) без импорта её внутренностей — `requestShell({ type: "collapse" })` (свернуть сразу и отпустить клавиатурный фокус; вызывать перед `clipboard_paste` mode `paste`) и `requestShell({ type: "openTab", tab })` (раскрыть и открыть вкладку; клик по live-activity в пилюле) и `requestShell({ type: "toast", text })` (короткое сообщение в пилюле; при `doNotDisturb` не показывается). F1 подписывается один раз через `onShellRequest` в оболочке. `requestShell` возвращает `Promise<void>`, который резолвится, когда оболочка обработала запрос (для `collapse` — фокус уже отпущен): `await requestShell({type:"collapse"})` перед `clipboard_paste`.

## 8. Вызов горячей клавишей и полноэкранные приложения (v0.1)

- `Settings.summonHotkey` — глобальное сочетание (синтаксис акселератора Tauri, по умолчанию `"Ctrl+Alt+I"`, `""` = выкл). R1 регистрирует его (`tauri-plugin-global-shortcut`); `settings_set` с занятым/некорректным сочетанием возвращает ошибку и оставляет прежнее. По нажатию R1 показывает остров (даже если он скрыт полноэкранным приложением, временно, до сворачивания) и эмитит `island://summoned`; UI раскрывает остров, а если уже раскрыт — сворачивает. После `island_set_mode({mode:"collapsed"})` R1 возвращает скрытие, если полноэкранное приложение всё ещё на экране и оно не в списке.
- `Settings.fullscreenAllowlist` — exe (lower-case), поверх которых остров не скрывается. По умолчанию пусто → в полноэкранных приложениях остров скрыт (`hideInFullscreen=true`).
- `window_recent_fullscreen_apps` — R1 запоминает полноэкранные приложения, которые видел (exe, заголовок, время), хранит до 20 в `fullscreen_seen.json` рядом с `settings.json`. Настройки (F1) показывают этот список с переключателями «показывать остров» → `settings_set({ patch: { fullscreenAllowlist } })`.
- Эксклюзивный полноэкранный режим (D3D exclusive) окна не перекрываются в принципе — работает только для borderless/оконных полноэкранных режимов.

## 9. Автообновление (v0.1, R1 / F1)

- Эндпоинт: `https://github.com/sshyngys1/ccott/releases/latest/download/latest.json` (`tauri-plugin-updater`, публичный ключ minisign в `tauri.conf.json`, режим установки Windows — `passive`).
- Тип `UpdateInfo { version: string; notes: string; date: string | null }`.
- R1 проверяет обновления через ~30 с после старта и затем каждые 6 ч. При отсутствии сети или релиза (404 / `ReleaseNotFound`) — тихо, только `log::info`, без ошибки для UI.
- При обнаружении новой версии R1 кэширует пакет обновления и эмитит `updater://available` (`UpdateInfo`).
- `updater_check` (`{}` → `UpdateInfo | null`) — ручная проверка из настроек (при отсутствии сети или 404 также возвращает `null` без ошибки).
- `updater_install` (`{}` → `void`) — скачивает установщик, проверяет подпись minisign, запускает NSIS в режиме `passive` и перезапускает приложение.
- F1 показывает в настройках текущую версию, кнопку «Проверить обновления», при наличии новой версии — строку «Доступна версия X» с кнопкой «Установить и перезапустить», а также одноразовый тост в пилюле «Доступно обновление» (с учётом `doNotDisturb`).

## 10. Язык интерфейса (v0.2)

- `Settings.language: "auto" | "ru" | "en"`, по умолчанию `"auto"`. `"auto"` = язык интерфейса Windows: русский → `"ru"`, любой другой → `"en"`.
- UI: словари `src/i18n/{ru,en}.ts` (тип ключей выводится из `ru`, `en` обязан содержать все ключи — проверяет TypeScript), хук `useT()` и `t(key, params?)` без сторонних зависимостей; язык меняется на лету по `settings://changed`, без перезапуска. `<html lang>` следует за языком. Модулям (`src/modules/*`) — тот же `useT()`.
- Rust (R1): трей и прочие нативные строки локализуются по `Settings.language` (для `"auto"` — `GetUserDefaultUILanguage`), обновляются при `settings://changed`.
- Данные пользователя (заметки, буфер, имена устройств, треки) не переводятся. Текстовые утилиты RU⇄EN (раскладка, транслит) от языка UI не зависят.

## 11. Захват экрана и OCR (v0.2)

- `capture_start({ mode: "region" | "screen", action: "copy" | "save" | "ocr" })` → `CaptureResult | null`. `null` — пользователь отменил (Esc / правый клик). Ошибка — строка для пользователя (например, «нет языкового пакета OCR»).
- На время захвата остров скрывается (без анимации) и возвращается после. Курсор и сам остров в снимок не попадают.
- `region`: снимок всех мониторов замораживается, поверх — полноэкранный оверлей (затемнение, рамка выделения, размер в пикселях, лупа не обязательна). Тянуть мышью — выделить, отпустить — готово, Esc / правый клик — отмена. Корректно на нескольких мониторах с разным DPI (физические пиксели).
- `screen`: монитор под курсором целиком.
- `copy`: PNG в буфер обмена (CF_DIB/PNG), он же попадает в историю буфера обычным путём. `save`: PNG в `Pictures\Screenshots\CCOTT\CCOTT YYYY-MM-DD HH-MM-SS.png` + в буфер. `ocr`: `Windows.Media.Ocr` (офлайн), язык — из языков профиля пользователя (ru и en, если установлены); текст в буфер.
- UI после результата показывает тост в пилюле: «Скопировано» / «Сохранено» (клик — `capture_open_folder`) / «Текст скопирован» или «Текст не найден».
- `capture_open_folder` открывает папку снимков в Проводнике.

- v0.2.1: `Settings.ocrLanguage` — `"auto"` (как раньше, языки профиля Windows) или тег языка из `capture_ocr_languages` (`OcrLanguage { tag, name }`, установленные в Windows языки OCR). Выбранный язык используется для «Текст с экрана»; если он пропал из системы — откат на `"auto"` с записью в лог. В настройках — выпадающий список «Язык распознавания текста» и подсказка, как добавить язык (Параметры Windows → Время и язык → Язык → добавить язык с компонентом «Оптическое распознавание символов»).

## 12. Пипетка и QR (v0.2)

- `capture_pick_color({})` → `PickedColor { hex: "#RRGGBB", r, g, b } | null`. Тот же замороженный оверлей, что и у захвата, но с лупой (увеличение пикселей вокруг курсора, сетка, текущий HEX рядом). Клик — выбрать, Esc / правый клик — отмена. HEX копируется в буфер; UI показывает тост с образцом цвета и HEX.
- QR-распознавание: `capture_start({ mode: "region", action: "qr" })` — выделенная область декодируется (Rust), `CaptureResult.text` = содержимое QR ("" если не найден), содержимое в буфер. Если это ссылка http(s) — тост с кнопкой «Открыть» (открытие в браузере по умолчанию, только http/https).
- QR-создание — чисто во фронтенде: во вкладке «Текст» действие «QR-код» показывает QR для текущего текста (или выделения) с кнопкой «Копировать как картинку» (PNG в буфер через `navigator.clipboard` или существующий путь).

## 13. Док (v0.2)

- `DockItem { id, path, name, kind: "app" | "folder" | "file", icon }`; хранение — SQLite (R2), порядок = порядок отображения, максимум 12 элементов, дубликаты по пути игнорируются.
- `dock_list`, `dock_add({ paths })`, `dock_remove({ id })`, `dock_reorder({ ids })` возвращают новый список и эмитят `dock://changed`. `dock_open({ id })` — действие оболочки по умолчанию (ShellExecute), для пропавшего пути — ошибка для пользователя («Файл не найден»), элемент не удаляется сам.
- Имя: у `.lnk`/`.url` — имя ярлыка, у `.exe` — FileDescription из версии, иначе имя файла без расширения; у папки — её имя. Иконка — системная (как в Проводнике), 64×64 PNG data URL, кэшируется.
- Добавление: перетаскивание файлов/папок/ярлыков из Проводника, с рабочего стола или из меню «Пуск» на остров (в свёрнутом виде остров раскрывается на Главной) или кнопкой «+» (системный диалог выбора). Удаление — контекстное меню / кнопка при наведении. Перестановка — перетаскиванием внутри дока.

## 14. Автоскрытие над приложениями и Esc после вызова (v0.2)

- `Settings.autoHideApps: string[]` — exe в нижнем регистре. По умолчанию: `chrome.exe`, `msedge.exe`, `firefox.exe`, `browser.exe` (Яндекс), `opera.exe`, `brave.exe`, `vivaldi.exe`. Старый settings.json без поля получает этот список.
- Пилюля скрывается, пока активное окно принадлежит приложению из списка и развёрнуто (maximized) или его верхний край касается верха монитора острова. Не путать с полноэкранным режимом (§8): там своя логика.
- Показ: горячая клавиша вызова (как сейчас) или удержание курсора у верхнего края в зоне пилюли ~400 мс — пилюля выезжает и ведёт себя как обычно (hover раскрывает). После ухода курсора и сворачивания снова скрывается. Live-activities в это время не показываются.
- Настройки (F1): список как у полноэкранных приложений — недавно активные развёрнутые приложения с переключателями «Прятать остров» + добавить exe вручную + удалить; кнопка «Сбросить к браузерам».
- Esc после вызова горячей клавишей: пока остров раскрыт вызовом (`island://summoned`) и не получил клавиатурный фокус, R1 временно регистрирует глобальную клавишу Esc → сворачивание; снимает её при сворачивании. Фокус у активного окна не забирается (безопасно для игр). Когда остров имеет клавиатурный фокус — работает обычный Esc из §3a.
- `window_recent_maximized_apps` (`{}` → `FullscreenApp[]`) — недавно виденные развёрнутые активные приложения (R1 хранит до 20 в `maximized_seen.json`) для списка автоскрытия в настройках.
- Док (§13): `dock_start_drag({ id })` — нативное перетаскивание файла/папки элемента наружу (копирование, OLE CF_HDROP); ошибка «Файл не найден», если путя больше нет. UI вызывает его, когда указатель при перетаскивании ярлыка выходит за пределы дока.

## 15. Прогрев перед раскрытием и стартовая вкладка (v0.2.1)

- Событие `island://prewarm` (R1 → UI, без данных): курсор приближается к свёрнутой пилюле или нажата горячая клавиша вызова. UI делает один дешёвый невидимый кадр, чтобы «разбудить» композитор WebView2 до начала раскрытия. R1 троттлит событие (не чаще ~раза в 500 мс) и не шлёт его, пока курсор далеко, — в простое 0% CPU.
- Каждое раскрытие острова открывает вкладку «Главная». Исключения: «Настройки» из трея, перетаскивание файла (Главная с доком), действия тостов, ведущие в конкретное место.
