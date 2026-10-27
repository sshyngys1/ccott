// Note bodies are HTML written by a contenteditable and stored as-is. Everything that goes into the editor
// (`innerHTML = …`) or into storage passes through `sanitizeNoteHtml` first (spec §6.6).
import DOMPurify from "dompurify";

/** The only tags a note may contain. `div` is normalised to `p` before sanitising (Chromium's default Enter behaviour). */
export const ALLOWED_TAGS = ["p", "h3", "b", "strong", "i", "em", "ul", "ol", "li", "br", "a"] as const;
/** The only attributes: link target, checklist markers. */
export const ALLOWED_ATTR = ["href", "data-checked", "data-type"] as const;
/** Only these URL schemes are kept in `href` (no javascript:, data:, vbscript:, file:…). */
export const ALLOWED_URI_REGEXP = /^(?:https?:|mailto:|tel:)/i;

let hooksInstalled = false;

function installHooks(): void {
  if (hooksInstalled) return;
  hooksInstalled = true;
  DOMPurify.addHook("afterSanitizeAttributes", (node) => {
    const tag = node.nodeName.toLowerCase();
    if (tag === "ul") {
      if (node.getAttribute("data-type") !== "checklist") node.removeAttribute("data-type");
    } else {
      node.removeAttribute("data-type");
    }
    if (tag === "li") {
      if (node.hasAttribute("data-checked")) node.setAttribute("data-checked", "true");
    } else {
      node.removeAttribute("data-checked");
    }
    if (tag === "a") {
      // Links are never followed from the editor; rel is belt and braces for anything that renders the HTML elsewhere.
      node.setAttribute("rel", "noopener noreferrer");
      if (!node.getAttribute("href")) node.removeAttribute("href");
    }
  });
}

/** `<div>` → `<p>`: an Enter in a contenteditable creates divs in Chromium. Done on a detached template, so nothing executes. */
function normalizeBlocks(html: string): string {
  if (!/<div[\s>]/i.test(html)) return html;
  const tpl = document.createElement("template");
  tpl.innerHTML = html;
  for (const div of Array.from(tpl.content.querySelectorAll("div"))) {
    const p = document.createElement("p");
    while (div.firstChild) p.appendChild(div.firstChild);
    div.replaceWith(p);
  }
  return tpl.innerHTML;
}

/** Returns safe HTML limited to the allowed tags/attributes. Never throws. */
export function sanitizeNoteHtml(html: string): string {
  if (!html) return "";
  installHooks();
  try {
    return DOMPurify.sanitize(normalizeBlocks(html), {
      ALLOWED_TAGS: [...ALLOWED_TAGS],
      ALLOWED_ATTR: [...ALLOWED_ATTR],
      ALLOW_DATA_ATTR: false,
      ALLOWED_URI_REGEXP,
      // The URI regexp is applied to every attribute value that is not "URI safe"; the markers are not URLs.
      ADD_URI_SAFE_ATTR: ["data-checked", "data-type"],
      KEEP_CONTENT: true,
      RETURN_TRUSTED_TYPE: false,
    }) as string;
  } catch {
    return "";
  }
}
