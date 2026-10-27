// Minimal CDP client for the WebView2 page: prints console output and evaluates an expression.
// Usage: node cdp.mjs <port> "<js expression>" [listenMs]
const [port = "9333", expr = "1", listenMs = "1500"] = process.argv.slice(2);

const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const page = targets.find((t) => t.type === "page");
if (!page) throw new Error("no page target: " + JSON.stringify(targets));

const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const send = (method, params = {}) =>
  new Promise((resolve) => {
    const msgId = ++id;
    pending.set(msgId, resolve);
    ws.send(JSON.stringify({ id: msgId, method, params }));
  });

ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg.result ?? msg.error);
    pending.delete(msg.id);
  } else if (msg.method === "Runtime.consoleAPICalled") {
    const args = msg.params.args.map((a) => a.value ?? a.description ?? a.type).join(" ");
    console.log(`[console.${msg.params.type}] ${args}`);
  } else if (msg.method === "Runtime.exceptionThrown") {
    console.log(`[exception] ${msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text}`);
  } else if (msg.method === "Log.entryAdded") {
    console.log(`[log.${msg.params.entry.level}] ${msg.params.entry.text}`);
  }
};

await new Promise((r) => (ws.onopen = r));
await send("Runtime.enable");
await send("Log.enable");
const res = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
console.log("[eval]", JSON.stringify(res.result?.value ?? res.exceptionDetails ?? res));
await new Promise((r) => setTimeout(r, Number(listenMs)));
ws.close();
