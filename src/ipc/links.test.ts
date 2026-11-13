import { expect, it } from "vitest";
import { httpUrl } from "./links";
it.each(["https://example.com/a", "http://localhost:1234/a", " HTTPS://example.com "])("accepts HTTP(S) %s", text => expect(httpUrl(text)).not.toBeNull());
it.each(["javascript:alert(1)","data:text/html,test","file:///C:/test.exe","mailto:a@b.com","tel:123","ms-settings:","not a URL","//example.com",""])("rejects non-HTTP(S) %s",text=>expect(httpUrl(text)).toBeNull());
