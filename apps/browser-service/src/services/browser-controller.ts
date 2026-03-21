import type { CmuxAdapter } from "@clab/cmux-adapter";
import { EventBus, createEvent } from "@clab/events";

const DEFAULT_TIMEOUT_MS = 30_000; // 30 seconds per browser action
const POLL_INTERVAL_MS = 500;
const STABILITY_CHECKS = 3;

/**
 * BrowserController delegates browser automation operations to cmux.
 * Each operation sends commands to a browser pane managed by cmux
 * and reads back results from the pane output.
 */
export class BrowserController {
  constructor(
    private cmux: CmuxAdapter,
    private bus: EventBus,
  ) {}

  /**
   * Navigate to a URL in the browser pane.
   */
  async navigate(paneId: string, url: string): Promise<{ success: boolean; output: string }> {
    const command = `page.goto('${this.escapeJs(url)}')`;
    await this.cmux.sendText(paneId, `${command}\n`);

    const output = await this.waitForStable(paneId, DEFAULT_TIMEOUT_MS);

    await this.bus.publish(
      createEvent("browser.navigate", { paneId, url, outputLength: output.length }),
    );

    return { success: !output.includes("Error"), output };
  }

  /**
   * Click an element identified by a selector.
   */
  async click(paneId: string, selector: string): Promise<{ success: boolean; output: string }> {
    const command = `page.click('${this.escapeJs(selector)}')`;
    await this.cmux.sendText(paneId, `${command}\n`);

    const output = await this.waitForStable(paneId, DEFAULT_TIMEOUT_MS);

    await this.bus.publish(
      createEvent("browser.click", { paneId, selector, outputLength: output.length }),
    );

    return { success: !output.includes("Error"), output };
  }

  /**
   * Type text into the currently focused element.
   */
  async type(paneId: string, selector: string, text: string): Promise<{ success: boolean; output: string }> {
    const command = `page.type('${this.escapeJs(selector)}', '${this.escapeJs(text)}')`;
    await this.cmux.sendText(paneId, `${command}\n`);

    const output = await this.waitForStable(paneId, DEFAULT_TIMEOUT_MS);

    await this.bus.publish(
      createEvent("browser.type", { paneId, selector, textLength: text.length }),
    );

    return { success: !output.includes("Error"), output };
  }

  /**
   * Fill an input field (clears first, then types).
   */
  async fill(paneId: string, selector: string, value: string): Promise<{ success: boolean; output: string }> {
    const command = `page.fill('${this.escapeJs(selector)}', '${this.escapeJs(value)}')`;
    await this.cmux.sendText(paneId, `${command}\n`);

    const output = await this.waitForStable(paneId, DEFAULT_TIMEOUT_MS);

    await this.bus.publish(
      createEvent("browser.fill", { paneId, selector, valueLength: value.length }),
    );

    return { success: !output.includes("Error"), output };
  }

  /**
   * Capture a screenshot of the current page.
   * Returns the path to the saved screenshot file.
   */
  async screenshot(paneId: string, path?: string): Promise<{ success: boolean; path: string; output: string }> {
    const screenshotPath = path ?? `/tmp/clab-screenshot-${Date.now()}.png`;
    const command = `page.screenshot({ path: '${this.escapeJs(screenshotPath)}', fullPage: true })`;
    await this.cmux.sendText(paneId, `${command}\n`);

    const output = await this.waitForStable(paneId, DEFAULT_TIMEOUT_MS);

    await this.bus.publish(
      createEvent("browser.screenshot", { paneId, path: screenshotPath }),
    );

    return { success: !output.includes("Error"), path: screenshotPath, output };
  }

  /**
   * Evaluate JavaScript in the browser page context.
   */
  async evaluate(paneId: string, script: string): Promise<{ success: boolean; result: string; output: string }> {
    const command = `page.evaluate(() => { ${script} })`;
    await this.cmux.sendText(paneId, `${command}\n`);

    const output = await this.waitForStable(paneId, DEFAULT_TIMEOUT_MS);

    await this.bus.publish(
      createEvent("browser.eval", { paneId, scriptLength: script.length }),
    );

    return { success: !output.includes("Error"), result: output, output };
  }

  /**
   * Get a DOM snapshot of the current page (simplified HTML structure).
   */
  async snapshot(paneId: string): Promise<{ success: boolean; html: string; output: string }> {
    const command = `page.content()`;
    await this.cmux.sendText(paneId, `${command}\n`);

    const output = await this.waitForStable(paneId, DEFAULT_TIMEOUT_MS);

    await this.bus.publish(
      createEvent("browser.snapshot", { paneId, outputLength: output.length }),
    );

    return { success: !output.includes("Error"), html: output, output };
  }

  /**
   * Get text content of an element.
   */
  async getText(paneId: string, selector: string): Promise<{ success: boolean; text: string; output: string }> {
    const command = `page.textContent('${this.escapeJs(selector)}')`;
    await this.cmux.sendText(paneId, `${command}\n`);

    const output = await this.waitForStable(paneId, DEFAULT_TIMEOUT_MS);

    await this.bus.publish(
      createEvent("browser.get-text", { paneId, selector }),
    );

    return { success: !output.includes("Error"), text: output.trim(), output };
  }

  /**
   * Wait for a condition to be met (selector visible, network idle, etc.).
   */
  async wait(paneId: string, condition: {
    type: "selector" | "timeout" | "navigation" | "network-idle";
    value: string;
    timeoutMs?: number;
  }): Promise<{ success: boolean; output: string }> {
    const timeout = condition.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    let command: string;

    switch (condition.type) {
      case "selector":
        command = `page.waitForSelector('${this.escapeJs(condition.value)}', { timeout: ${timeout} })`;
        break;
      case "timeout":
        command = `page.waitForTimeout(${parseInt(condition.value, 10)})`;
        break;
      case "navigation":
        command = `page.waitForNavigation({ timeout: ${timeout} })`;
        break;
      case "network-idle":
        command = `page.waitForLoadState('networkidle', { timeout: ${timeout} })`;
        break;
      default:
        return { success: false, output: `Unknown wait condition type: ${condition.type}` };
    }

    await this.cmux.sendText(paneId, `${command}\n`);
    const output = await this.waitForStable(paneId, timeout + 5000);

    await this.bus.publish(
      createEvent("browser.wait", { paneId, conditionType: condition.type, value: condition.value }),
    );

    return { success: !output.includes("Error"), output };
  }

  /**
   * Wait for pane output to stabilize (stop changing).
   */
  private async waitForStable(paneId: string, timeoutMs: number): Promise<string> {
    const deadline = Date.now() + timeoutMs;
    let lastOutput = "";
    let stableCount = 0;

    // Small initial delay to let command start executing
    await this.sleep(300);

    while (Date.now() < deadline) {
      const output = await this.cmux.readText(paneId);

      if (output === lastOutput && output.length > 0) {
        stableCount++;
        if (stableCount >= STABILITY_CHECKS) {
          return output;
        }
      } else {
        stableCount = 0;
        lastOutput = output;
      }

      await this.sleep(POLL_INTERVAL_MS);
    }

    // Return whatever we have on timeout
    return await this.cmux.readText(paneId);
  }

  /**
   * Escape a string for use in JavaScript string literals.
   */
  private escapeJs(str: string): string {
    return str
      .replace(/\\/g, "\\\\")
      .replace(/'/g, "\\'")
      .replace(/\n/g, "\\n")
      .replace(/\r/g, "\\r")
      .replace(/\t/g, "\\t");
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
