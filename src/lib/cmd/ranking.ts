// Owner: F2 (Frontend-Modules). Search evaluation, item unification, and ranking (spec §6.10, contracts §20).
import { getLanguage, t, type Language } from "../../i18n";
import { invoke } from "../../ipc";
import type { CmdItem } from "../../shared/types";
import { evaluateMath, type MathResult } from "./calculator";
import { evaluateCommands, type CommandItem } from "./commands";
import {
  parseCurrencyQuery,
  type CurrencyQuery,
} from "./currency";
import { evaluateUnits, type UnitResult } from "./units";

export type UnifiedItemKind = "app" | "file" | "folder" | "command" | "calc" | "convert";

export interface UnifiedCmdItem {
  id: string;
  kind: UnifiedItemKind;
  group: "apps" | "files" | "calc" | "convert" | "commands";
  title: string;
  subtitle: string;
  icon: string | null;
  actionHint: string;
  secondaryHint?: string;
  onExecute: (options?: { ctrlKey?: boolean; shiftKey?: boolean; metaKey?: boolean }) => void | Promise<void>;
}

export interface HeroCardData {
  kind: "calc" | "convert";
  value: string;
  formula: string;
  meta: string;
  stale?: boolean;
  isLoading?: boolean;
  plainValueToCopy: string;
  fullFormulaToCopy: string;
}

export interface GroupedResults {
  group: "apps" | "files" | "calc" | "convert" | "commands";
  label: string;
  items: UnifiedCmdItem[];
}

export interface QuickHint {
  query: string;
  label: string;
  desc: string;
  kind: "calc" | "percent" | "convert" | "ruler" | "timer";
}

export function getQuickHints(): QuickHint[] {
  return [
    { query: t("cmdHint1Query"), label: t("cmdHint1Query"), desc: t("cmdHint1Desc"), kind: "calc" },
    { query: t("cmdHint2Query"), label: t("cmdHint2Query"), desc: t("cmdHint2Desc"), kind: "percent" },
    { query: t("cmdHint3Query"), label: t("cmdHint3Query"), desc: t("cmdHint3Desc"), kind: "convert" },
    { query: t("cmdHint4Query"), label: t("cmdHint4Query"), desc: t("cmdHint4Desc"), kind: "ruler" },
    { query: t("cmdHint5Query"), label: t("cmdHint5Query"), desc: t("cmdHint5Desc"), kind: "timer" },
  ];
}

/**
 * Maps raw backend CmdItem into a UnifiedCmdItem.
 */
export function mapBackendItem(
  item: CmdItem,
  onAfterLaunch: () => void,
): UnifiedCmdItem {
  const isApp = item.kind === "app";
  const group = isApp ? "apps" : "files";

  return {
    id: item.id,
    kind: item.kind,
    group,
    title: item.title,
    subtitle: item.subtitle,
    icon: item.icon,
    actionHint: t("cmdActionOpen"),
    secondaryHint: isApp ? t("cmdActionRunAdmin") : t("cmdActionReveal"),
    onExecute: async (options) => {
      const mode = options?.ctrlKey || options?.metaKey
        ? isApp
          ? "admin"
          : "reveal"
        : "open";
      await invoke("cmd_launch", { id: item.id, mode });
      onAfterLaunch();
    },
  };
}

/**
 * Synchronously checks instant local features: Calculator, Units, Currency (query parse), Commands.
 */
export function evaluateLocalFeatures(query: string, lang: Language = getLanguage(), defaultCurrency = ""): {
  math: MathResult | null;
  units: UnitResult | null;
  currencyQuery: CurrencyQuery | null;
  commands: CommandItem[];
} {
  const math = evaluateMath(query, lang);
  const units = evaluateUnits(query, lang);
  const currencyQuery = parseCurrencyQuery(query, undefined, defaultCurrency);
  const commands = evaluateCommands(query, lang);

  return {
    math,
    units,
    currencyQuery,
    commands,
  };
}
