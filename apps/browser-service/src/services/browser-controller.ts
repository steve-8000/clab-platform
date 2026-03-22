import { existsSync } from "node:fs";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";
import { EventBus, createEvent } from "@clab/events";

const DEFAULT_TIMEOUT_MS = 30_000;

interface BrowserSession {
  browser: Browser;
  context: BrowserContext;
  page: Page;
}

interface WaitCondition {
  type: "selector" | "timeout" | "navigation" | "network-idle";
  value: string;
  timeoutMs?: number;
}

function outputFromPage(page: Page, extra?: Record<string, unknown>): string {
  return JSON.stringify({
    url: page.url(),
    ...extra,
  });
}

function successFromError(error: unknown): { success: false; output: string } {
  return { success: false, output: String(error) };
}

export class BrowserController {
  private sessions = new Map<string, BrowserSession>();

  constructor(private bus: EventBus) {}

  async navigate(sessionId: string, url: string): Promise<{ success: boolean; output: string }> {
    try {
      const session = await this.getSession(sessionId);
      await session.page.goto(url, { timeout: DEFAULT_TIMEOUT_MS, waitUntil: "networkidle" });
      await this.publish("browser.navigate", { sessionId, url });
      return { success: true, output: outputFromPage(session.page, { action: "navigate" }) };
    } catch (error) {
      return successFromError(error);
    }
  }

  async click(sessionId: string, selector: string): Promise<{ success: boolean; output: string }> {
    try {
      const session = await this.getSession(sessionId);
      await session.page.click(selector, { timeout: DEFAULT_TIMEOUT_MS });
      await this.publish("browser.click", { sessionId, selector });
      return { success: true, output: outputFromPage(session.page, { action: "click", selector }) };
    } catch (error) {
      return successFromError(error);
    }
  }

  async type(sessionId: string, selector: string, text: string): Promise<{ success: boolean; output: string }> {
    try {
      const session = await this.getSession(sessionId);
      await session.page.locator(selector).pressSequentially(text, { timeout: DEFAULT_TIMEOUT_MS });
      await this.publish("browser.type", { sessionId, selector, textLength: text.length });
      return { success: true, output: outputFromPage(session.page, { action: "type", selector }) };
    } catch (error) {
      return successFromError(error);
    }
  }

  async fill(sessionId: string, selector: string, value: string): Promise<{ success: boolean; output: string }> {
    try {
      const session = await this.getSession(sessionId);
      await session.page.fill(selector, value, { timeout: DEFAULT_TIMEOUT_MS });
      await this.publish("browser.fill", { sessionId, selector, valueLength: value.length });
      return { success: true, output: outputFromPage(session.page, { action: "fill", selector }) };
    } catch (error) {
      return successFromError(error);
    }
  }

  async screenshot(sessionId: string, path?: string): Promise<{ success: boolean; path: string; output: string }> {
    try {
      const session = await this.getSession(sessionId);
      const screenshotPath = path ?? `/tmp/clab-screenshot-${Date.now()}.png`;
      await session.page.screenshot({ path: screenshotPath, fullPage: true, timeout: DEFAULT_TIMEOUT_MS });
      await this.publish("browser.screenshot", { sessionId, path: screenshotPath });
      return {
        success: true,
        path: screenshotPath,
        output: outputFromPage(session.page, { action: "screenshot", path: screenshotPath }),
      };
    } catch (error) {
      return { success: false, path: path ?? "", output: String(error) };
    }
  }

  async evaluate(sessionId: string, script: string): Promise<{ success: boolean; result: string; output: string }> {
    try {
      const session = await this.getSession(sessionId);
      const result = await session.page.evaluate((source: string) => {
        // Intentionally mirrors the prior arbitrary-page-script interface.
        return globalThis.eval(source);
      }, script);
      const serialized = typeof result === "string" ? result : JSON.stringify(result);
      await this.publish("browser.eval", { sessionId, scriptLength: script.length });
      return { success: true, result: serialized, output: outputFromPage(session.page, { action: "evaluate" }) };
    } catch (error) {
      return { success: false, result: "", output: String(error) };
    }
  }

  async snapshot(sessionId: string): Promise<{ success: boolean; html: string; output: string }> {
    try {
      const session = await this.getSession(sessionId);
      const html = await session.page.content();
      await this.publish("browser.snapshot", { sessionId, htmlLength: html.length });
      return { success: true, html, output: outputFromPage(session.page, { action: "snapshot" }) };
    } catch (error) {
      return { success: false, html: "", output: String(error) };
    }
  }

  async getText(sessionId: string, selector: string): Promise<{ success: boolean; text: string; output: string }> {
    try {
      const session = await this.getSession(sessionId);
      const text = (await session.page.textContent(selector, { timeout: DEFAULT_TIMEOUT_MS })) ?? "";
      await this.publish("browser.get-text", { sessionId, selector });
      return { success: true, text, output: outputFromPage(session.page, { action: "get-text", selector }) };
    } catch (error) {
      return { success: false, text: "", output: String(error) };
    }
  }

  async wait(sessionId: string, condition: WaitCondition): Promise<{ success: boolean; output: string }> {
    try {
      const session = await this.getSession(sessionId);
      const timeout = condition.timeoutMs ?? DEFAULT_TIMEOUT_MS;

      if (condition.type === "selector") {
        await session.page.waitForSelector(condition.value, { timeout });
      } else if (condition.type === "timeout") {
        await session.page.waitForTimeout(Number.parseInt(condition.value, 10));
      } else if (condition.type === "navigation") {
        await session.page.waitForLoadState("load", { timeout });
      } else {
        await session.page.waitForLoadState("networkidle", { timeout });
      }

      await this.publish("browser.wait", { sessionId, conditionType: condition.type, value: condition.value });
      return { success: true, output: outputFromPage(session.page, { action: "wait", condition: condition.type }) };
    } catch (error) {
      return successFromError(error);
    }
  }

  async closeAll(): Promise<void> {
    const sessions = Array.from(this.sessions.values());
    this.sessions.clear();

    await Promise.all(sessions.map(async (session) => {
      await session.context.close();
      await session.browser.close();
    }));
  }

  private async getSession(sessionId: string): Promise<BrowserSession> {
    const existing = this.sessions.get(sessionId);
    if (existing) return existing;

    const browser = await chromium.launch({
      headless: process.env.BROWSER_HEADLESS !== "false",
      executablePath: resolveChromiumPath(),
    });
    const context = await browser.newContext();
    const page = await context.newPage();
    page.setDefaultTimeout(DEFAULT_TIMEOUT_MS);

    const session = { browser, context, page };
    this.sessions.set(sessionId, session);
    return session;
  }

  private async publish(type: string, payload: Record<string, unknown>): Promise<void> {
    await this.bus.publish(createEvent(type, payload));
  }
}

function resolveChromiumPath(): string {
  const configuredPath = process.env.CHROMIUM_PATH || process.env.PLAYWRIGHT_CHROMIUM_PATH;
  if (configuredPath) return configuredPath;
  if (existsSync("/usr/bin/chromium-browser")) return "/usr/bin/chromium-browser";
  if (existsSync("/usr/bin/chromium")) return "/usr/bin/chromium";
  return "/usr/bin/chromium-browser";
}
