import { describe, expect, it } from "vitest";
import { sanitizeNoteHtml } from "./sanitize";

describe("sanitizeNoteHtml", () => {
  it("keeps the allowed formatting", () => {
    const html = "<h3>Заголовок</h3><p>Обычный <b>жирный</b> <strong>strong</strong> <i>курсив</i> <em>em</em></p><ul><li>раз</li><li>два</li></ul><ol><li>1</li></ol><p>a<br>b</p>";
    expect(sanitizeNoteHtml(html)).toBe(html);
  });

  it("keeps the checklist markup", () => {
    const html = '<ul data-type="checklist"><li data-checked="true">сделано</li><li>ещё нет</li></ul>';
    expect(sanitizeNoteHtml(html)).toBe(html);
  });

  it("strips script tags with their content-free shell", () => {
    expect(sanitizeNoteHtml("<p>a</p><script>alert(1)</script><p>b</p>")).toBe("<p>a</p><p>b</p>");
  });

  it("strips event handler attributes", () => {
    const out = sanitizeNoteHtml('<p onclick="x()" onmouseover="y()">hi</p><img src=x onerror=alert(1)>');
    expect(out).toBe("<p>hi</p>");
  });

  it("removes javascript:, data: and vbscript: links but keeps the text", () => {
    for (const bad of ["javascript:alert(1)", "JaVaScRiPt:alert(1)", " javascript:alert(1)", "data:text/html,<script>alert(1)</script>", "vbscript:msgbox(1)", "file:///C:/Windows"]) {
      const out = sanitizeNoteHtml(`<a href="${bad}">click</a>`);
      expect(out).not.toMatch(/href/i);
      expect(out).toContain("click");
    }
  });

  it("keeps http(s)/mailto links and adds rel", () => {
    const out = sanitizeNoteHtml('<a href="https://example.com/a?b=1" target="_blank" style="x">ссылка</a>');
    expect(out).toContain('href="https://example.com/a?b=1"');
    expect(out).toContain('rel="noopener noreferrer"');
    expect(out).not.toContain("target");
    expect(out).not.toContain("style");
    expect(sanitizeNoteHtml('<a href="mailto:a@b.c">m</a>')).toContain('href="mailto:a@b.c"');
  });

  it("removes style, class, id and unknown data-* attributes", () => {
    const out = sanitizeNoteHtml('<p style="color:red" class="x" id="y" data-evil="1" contenteditable="true">t</p>');
    expect(out).toBe("<p>t</p>");
  });

  it("drops dangerous elements entirely: iframe, object, embed, svg, style, form, input, img, video", () => {
    const html =
      '<iframe src="https://evil"></iframe><object data="x"></object><embed src="x"><svg onload="x()"><circle/></svg><style>p{}</style><form><input value=1></form><img src=x><video src=x></video><p>ok</p>';
    expect(sanitizeNoteHtml(html)).toBe("<p>ok</p>");
  });

  it("neutralises mXSS-style payloads", () => {
    const out = sanitizeNoteHtml('<p><svg><style><img src=x onerror=alert(1)></style></svg></p><noscript><p title="</noscript><img src=x onerror=alert(1)>">');
    expect(out).not.toMatch(/onerror|<img|<svg|<script/i);
  });

  it("data-type / data-checked are only honoured where they belong", () => {
    expect(sanitizeNoteHtml('<ul data-type="evil"><li>a</li></ul>')).toBe("<ul><li>a</li></ul>");
    expect(sanitizeNoteHtml('<p data-type="checklist" data-checked="true">a</p>')).toBe("<p>a</p>");
    expect(sanitizeNoteHtml('<ul data-type="checklist"><li data-checked="whatever">a</li></ul>')).toBe(
      '<ul data-type="checklist"><li data-checked="true">a</li></ul>',
    );
  });

  it("turns divs (Enter in Chromium) into paragraphs", () => {
    expect(sanitizeNoteHtml("<div>one</div><div>two<br></div>")).toBe("<p>one</p><p>two<br></p>");
    expect(sanitizeNoteHtml("<div><b>x</b></div>")).toBe("<p><b>x</b></p>");
  });

  it("unwraps unknown tags but keeps their text", () => {
    expect(sanitizeNoteHtml("<section><span>text</span></section>")).toBe("text");
    expect(sanitizeNoteHtml("<font color=red>t</font>")).toBe("t");
  });

  it("escapes plain text containing angle brackets", () => {
    expect(sanitizeNoteHtml("1 &lt; 2 &amp;&amp; 3 &gt; 2")).toBe("1 &lt; 2 &amp;&amp; 3 &gt; 2");
  });

  it("is idempotent", () => {
    const once = sanitizeNoteHtml('<div>x<script>1</script><a href="javascript:1">l</a><ul data-type="checklist"><li data-checked>a</li></ul></div>');
    expect(sanitizeNoteHtml(once)).toBe(once);
  });

  it("empty input", () => {
    expect(sanitizeNoteHtml("")).toBe("");
    expect(sanitizeNoteHtml("   ")).toBe("   ");
  });
});
