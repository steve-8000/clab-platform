import { Hono } from "hono";
import { EventBus } from "@clab/events";
import { createLogger } from "@clab/telemetry";
import { BrowserController } from "../services/browser-controller.js";

const logger = createLogger("browser-service");

export const bus = new EventBus();
export const controller = new BrowserController(bus);

let initialized = false;

async function ensureInit(): Promise<void> {
  if (initialized) return;

  try {
    await bus.connect();
    logger.info("EventBus connected");
  } catch (err) {
    logger.error("EventBus connection failed", { error: err instanceof Error ? err.message : String(err) });
    throw err;
  }

  initialized = true;
}

const browser = new Hono();

browser.post("/navigate", async (c) => {
  await ensureInit();
  const body = await c.req.json<{ paneId: string; url: string }>();

  if (!body.paneId || !body.url) {
    return c.json({ ok: false, error: "paneId and url are required" }, 400);
  }

  const result = await controller.navigate(body.paneId, body.url);
  return c.json({ ok: result.success, ...result }, result.success ? 200 : 500);
});

browser.post("/click", async (c) => {
  await ensureInit();
  const body = await c.req.json<{ paneId: string; selector: string }>();

  if (!body.paneId || !body.selector) {
    return c.json({ ok: false, error: "paneId and selector are required" }, 400);
  }

  const result = await controller.click(body.paneId, body.selector);
  return c.json({ ok: result.success, ...result }, result.success ? 200 : 500);
});

browser.post("/type", async (c) => {
  await ensureInit();
  const body = await c.req.json<{ paneId: string; selector: string; text: string }>();

  if (!body.paneId || !body.selector || body.text === undefined) {
    return c.json({ ok: false, error: "paneId, selector, and text are required" }, 400);
  }

  const result = await controller.type(body.paneId, body.selector, body.text);
  return c.json({ ok: result.success, ...result }, result.success ? 200 : 500);
});

browser.post("/fill", async (c) => {
  await ensureInit();
  const body = await c.req.json<{ paneId: string; selector: string; value: string }>();

  if (!body.paneId || !body.selector || body.value === undefined) {
    return c.json({ ok: false, error: "paneId, selector, and value are required" }, 400);
  }

  const result = await controller.fill(body.paneId, body.selector, body.value);
  return c.json({ ok: result.success, ...result }, result.success ? 200 : 500);
});

browser.post("/screenshot", async (c) => {
  await ensureInit();
  const body = await c.req.json<{ paneId: string; path?: string }>();

  if (!body.paneId) {
    return c.json({ ok: false, error: "paneId is required" }, 400);
  }

  const result = await controller.screenshot(body.paneId, body.path);
  return c.json({ ok: result.success, ...result }, result.success ? 200 : 500);
});

browser.post("/eval", async (c) => {
  await ensureInit();
  const body = await c.req.json<{ paneId: string; script: string }>();

  if (!body.paneId || !body.script) {
    return c.json({ ok: false, error: "paneId and script are required" }, 400);
  }

  const result = await controller.evaluate(body.paneId, body.script);
  return c.json({ ok: result.success, ...result }, result.success ? 200 : 500);
});

browser.post("/snapshot", async (c) => {
  await ensureInit();
  const body = await c.req.json<{ paneId: string }>();

  if (!body.paneId) {
    return c.json({ ok: false, error: "paneId is required" }, 400);
  }

  const result = await controller.snapshot(body.paneId);
  return c.json({ ok: result.success, ...result }, result.success ? 200 : 500);
});

browser.post("/get-text", async (c) => {
  await ensureInit();
  const body = await c.req.json<{ paneId: string; selector: string }>();

  if (!body.paneId || !body.selector) {
    return c.json({ ok: false, error: "paneId and selector are required" }, 400);
  }

  const result = await controller.getText(body.paneId, body.selector);
  return c.json({ ok: result.success, ...result }, result.success ? 200 : 500);
});

browser.post("/wait", async (c) => {
  await ensureInit();
  const body = await c.req.json<{
    paneId: string;
    condition: {
      type: "selector" | "timeout" | "navigation" | "network-idle";
      value: string;
      timeoutMs?: number;
    };
  }>();

  if (!body.paneId || !body.condition) {
    return c.json({ ok: false, error: "paneId and condition are required" }, 400);
  }

  if (!body.condition.type || !body.condition.value) {
    return c.json({ ok: false, error: "condition.type and condition.value are required" }, 400);
  }

  const result = await controller.wait(body.paneId, body.condition);
  return c.json({ ok: result.success, ...result }, result.success ? 200 : 500);
});

export { browser as browserRoutes };
