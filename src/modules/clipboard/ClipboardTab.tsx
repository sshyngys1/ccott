import { AnimatePresence, LayoutGroup, motion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { IconClipboard, IconPin, IconSearch, IconTrash } from "../../design/icons";
import { pressScale, springs } from "../../design/motion";
import { useScrollFade } from "../../design/useScrollFade";
import { invoke } from "../../ipc";
import { cursorAfterRemoval, cursorIndex, groupClips, moveCursor } from "../../lib/clipboard/format";
import { pasteErrorText } from "../../lib/clipboard/store";
import { safeListen } from "../../lib/ipcSync";
import "../../lib/ui.css";
import { useArmed } from "../../lib/useArmed";
import { useNow } from "../../lib/useNow";
import { requestShell } from "../../shared/shellBus";
import type { ClipItem, PasteMode } from "../../shared/types";
import { ClipRow } from "./ClipRow";
import "./clipboard.css";

const SEARCH_DEBOUNCE_MS = 120;
const LIST_LIMIT = 100;
const tap = { whileTap: { scale: pressScale }, transition: springs.press } as const;

export function ClipboardTab() {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [items, setItems] = useState<ClipItem[] | null>(null);
  const [cursorId, setCursorId] = useState<number | null>(null);
  const now = useNow();
  const searchRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const requestSeq = useRef(0);
  const keyboardMove = useRef(false);
  const clear = useArmed();
  useScrollFade(scrollRef);

  // ── data ──
  const reload = useCallback(() => {
    const seq = ++requestSeq.current;
    invoke("clipboard_list", { query: debounced, limit: LIST_LIMIT })
      .then((list) => {
        if (seq === requestSeq.current) setItems(list);
      })
      .catch((err: unknown) => {
        console.warn("[island] clipboard_list failed", err);
        if (seq === requestSeq.current) setItems((prev) => prev ?? []);
      });
  }, [debounced]);

  useEffect(reload, [reload]);

  const reloadRef = useRef(reload);
  reloadRef.current = reload;
  useEffect(() => safeListen("clipboard://changed", () => reloadRef.current()), []);

  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(query.trim()), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(id);
  }, [query]);

  const { pinned, recent, ordered } = useMemo(() => groupClips(items ?? []), [items]);
  const idx = cursorIndex(ordered, cursorId);
  const cursorItem = idx >= 0 ? ordered[idx] : undefined;

  // Keep the keyboard cursor in view (only after keyboard moves, so mouse hover never scrolls the list).
  useEffect(() => {
    if (!keyboardMove.current || !cursorItem) return;
    keyboardMove.current = false;
    const row = document.getElementById(`cb-row-${cursorItem.id}`);
    if (document.activeElement?.getAttribute("role") === "option") row?.focus();
    row?.scrollIntoView?.({ block: "nearest" });
  }, [cursorItem]);

  // ── actions ──
  const activate = useCallback(async (item: ClipItem, mode: PasteMode) => {
    try {
      if (mode === "paste") await requestShell({ type: "collapse" });
      await invoke("clipboard_paste", { id: item.id, mode });
      if (mode === "copy") await requestShell({ type: "toast", text: "Скопировано" });
    } catch (err) {
      console.warn("[island] clipboard_paste failed", err);
      await requestShell({ type: "toast", text: mode === "paste" ? pasteErrorText(err) : "Не удалось скопировать" });
    }
  }, []);

  const togglePin = useCallback(
    (item: ClipItem) => {
      setItems((prev) => prev && prev.map((c) => (c.id === item.id ? { ...c, pinned: !c.pinned } : c)));
      invoke("clipboard_pin", { id: item.id, pinned: !item.pinned })
        .then(reload)
        .catch((err: unknown) => {
          console.warn("[island] clipboard_pin failed", err);
          reload();
        });
    },
    [reload],
  );

  const remove = useCallback(
    (item: ClipItem) => {
      setCursorId((cur) => (cur === null || cur === item.id ? cursorAfterRemoval(ordered, item.id) : cur));
      setItems((prev) => prev && prev.filter((c) => c.id !== item.id));
      invoke("clipboard_delete", { id: item.id }).then(() => requestShell({ type: "toast", text: "Запись удалена" })).catch((err: unknown) => {
        console.warn("[island] clipboard_delete failed", err);
        reload();
      });
    },
    [ordered, reload],
  );

  const clearAll = () => {
    if (!clear.armed) return clear.arm();
    clear.disarm();
    invoke("clipboard_clear", { keepPinned: true })
      .then(reload)
      .catch((err: unknown) => {
        console.warn("[island] clipboard_clear failed", err);
        reload();
      });
  };

  // Ctrl+F focuses the search from anywhere inside the panel (the window only receives keys while it has focus).
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.ctrlKey && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "f") {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    const inSearch = target === searchRef.current;
    const onButton = !!target.closest("button");
    switch (e.key) {
      case "ArrowDown":
      case "ArrowUp": {
        if (ordered.length === 0) return;
        e.preventDefault();
        keyboardMove.current = true;
        setCursorId(moveCursor(ordered, cursorItem?.id ?? null, e.key === "ArrowDown" ? 1 : -1));
        return;
      }
      case "Enter": {
        if (onButton || !cursorItem) return;
        e.preventDefault();
        activate(cursorItem, e.shiftKey ? "copy" : "paste");
        return;
      }
      case "Delete": {
        if (!cursorItem || cursorItem.pinned || onButton || (inSearch && query !== "")) return;
        e.preventDefault();
        remove(cursorItem);
        return;
      }
      case "p":
      case "P": {
        if (e.ctrlKey && cursorItem) {
          e.preventDefault();
          togglePin(cursorItem);
        }
        return;
      }
      case "Escape": {
        // Esc undoes the nearest thing first; only a bare Esc reaches the shell (which collapses the island).
        // The shell collapses on Escape unless the event is default-prevented.
        if (clear.armed) {
          e.preventDefault();
          e.stopPropagation();
          clear.disarm();
        } else if (query !== "") {
          e.preventDefault();
          e.stopPropagation();
          setQuery("");
          setDebounced("");
        }
        return;
      }
    }
  };

  const loading = items === null;
  const searching = debounced !== "";
  const historyEmpty = !loading && ordered.length === 0 && !searching;
  const noResults = !loading && ordered.length === 0 && searching;

  const renderRow = (c: ClipItem) => (
    <ClipRow
      key={c.id}
      item={c}
      now={now}
      cursor={cursorItem?.id === c.id}
      onCursor={() => setCursorId(c.id)}
      onActivate={(mode) => activate(c, mode)}
      onPin={() => togglePin(c)}
      onDelete={() => remove(c)}
    />
  );

  return (
    <div className="cb-root" onKeyDown={onKeyDown}>
      <h2 className="mod-sr-only">Буфер обмена</h2>
      <div className="cb-head">
        <label className="ig-search mod-grow">
          <IconSearch size={16} />
          <input
            ref={searchRef}
            className="ig-glass-input"
            placeholder="Поиск в истории буфера"
            aria-label="Поиск в истории буфера"
            value={query}
            spellCheck={false}
            autoComplete="off"
            onChange={(e) => setQuery(e.target.value)}
          />
          <kbd className="ig-kbd">Ctrl F</kbd>
        </label>
        <motion.button
          type="button"
          className="ig-glass-control ig-glass-control--danger"
          {...tap}
          data-selected={clear.armed ? true : undefined}
          disabled={loading || (items?.length ?? 0) === 0}
          title="Закреплённые записи останутся"
          aria-live="polite"
          onClick={clearAll}
        >
          <IconTrash size={16} />
          {clear.armed ? "Подтвердить" : "Очистить"}
        </motion.button>
      </div>

      <div className="ig-glass-card cb-card">
        {historyEmpty && (
          <div className="ig-empty">
            <span className="ig-empty__icon">
              <IconClipboard size={22} />
            </span>
            <span className="ig-empty__title">История буфера пуста</span>
            <span className="ig-empty__text">Скопируйте текст, ссылку, картинку или файлы — запись появится здесь. Закреплённые записи не удаляются при очистке.</span>
          </div>
        )}
        {noResults && (
          <div className="ig-empty">
            <span className="ig-empty__icon">
              <IconSearch size={22} />
            </span>
            <span className="ig-empty__title">Ничего не найдено</span>
            <span className="ig-empty__text">По запросу «{debounced}» записей нет. Поиск идёт по тексту, ссылкам и именам файлов.</span>
            <button
              type="button"
              className="ig-glass-control ig-glass-control--sm cb-empty-action"
              onClick={() => {
                setQuery("");
                setDebounced("");
                searchRef.current?.focus();
              }}
            >
              Сбросить поиск
            </button>
          </div>
        )}
        {ordered.length > 0 && (
          <div ref={scrollRef} className="ig-scroll ig-scroll-fade mod-fill">
            <div>
              <LayoutGroup>
                {pinned.length > 0 && (
                  <>
                    <h4 className="ig-section-label cb-label-first">
                      <IconPin size={12} />
                      Закреплённые
                    </h4>
                    <ul className="ig-list" role="listbox" aria-label="Закреплённые" aria-activedescendant={cursorItem?.pinned ? `cb-row-${cursorItem.id}` : undefined}>
                      <AnimatePresence initial={false}>{pinned.map(renderRow)}</AnimatePresence>
                    </ul>
                  </>
                )}
                {recent.length > 0 && (
                  <>
                    <h4 className={pinned.length > 0 ? "ig-section-label" : "ig-section-label cb-label-first"}>Недавние</h4>
                    <ul className="ig-list" role="listbox" aria-label="Недавние" aria-activedescendant={cursorItem && !cursorItem.pinned ? `cb-row-${cursorItem.id}` : undefined}>
                      <AnimatePresence initial={false}>{recent.map(renderRow)}</AnimatePresence>
                    </ul>
                  </>
                )}
              </LayoutGroup>
            </div>
          </div>
        )}
      </div>

        <footer className="cb-hints" aria-label="Подсказки">
          <span>
            <kbd className="ig-kbd">↑</kbd>
            <kbd className="ig-kbd">↓</kbd> выбрать
          </span>
          <span>
            <kbd className="ig-kbd">Enter</kbd> вставить
          </span>
          <span>
            <kbd className="ig-kbd">Shift</kbd>+клик — только скопировать
          </span>
          <span>
            <kbd className="ig-kbd">Del</kbd> удалить
          </span>
        </footer>
    </div>
  );
}
