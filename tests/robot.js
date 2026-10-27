const { expect } = require("@playwright/test");
const path = require("node:path");

// Only accelerated QA sessions use this helper. No robot records are Pilot A observations.
async function runThroughExperiment(page, options = {}) {
  const seen = new Set();
  let timedOut = false;
  let wrongAttention = false;
  let wrongAssociation = false;
  let falseAlarm = false;
  await page.getByRole("button", { name: "I agree to participate" }).click();
  const deadline = Date.now() + (options.timeoutMs || 100000);
  while (Date.now() < deadline) {
    const startupError = await page.evaluate(() => window.__startupError || null);
    if (startupError) throw new Error(startupError);
    if (await page.getByRole("button", { name: "Finish", exact: true }).isVisible()) {
      if (options.beforeFinish) await options.beforeFinish();
      await page.getByRole("button", { name: "Finish", exact: true }).click();
      await expect(page.getByText("All done", { exact: true })).toBeVisible({ timeout: 35000 });
      return;
    }
    const screen = page.locator("[data-screen]");
    const { kind, event } = await page.evaluate(() => {
      const node = document.querySelector("[data-screen]");
      return { kind: node ? node.dataset.screen : null, event: node ? node.dataset.event : null };
    });
    if (options.screenshots && kind && !seen.has(kind)) {
      seen.add(kind);
      if (kind === "outcome" && options.normalTiming) await page.waitForTimeout(1100);
      await page.screenshot({ path: path.join(options.screenshots, kind + ".png") });
    }
    if (await page.locator(".original-instructions").isVisible()) {
      const artwork = page.locator(".instruction-image");
      await artwork.evaluate(e => e.decode());
      const source = await artwork.getAttribute("src");
      const bounds = await artwork.boundingBox();
      const viewport = page.viewportSize();
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.y).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width);
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height);
      if (options.screenshots) {
        const filename = source.split("/").pop();
        await page.screenshot({ path: path.join(options.screenshots, filename + ".png") });
      }
      await page.keyboard.press("Space");
      await expect(page.locator(`.instruction-image[src="${source}"]`)).toHaveCount(0);
    } else if (kind === "rating") {
      const slider = page.locator('input[type="range"]');
      await slider.focus();
      await page.keyboard.press("ArrowRight");
      await page.getByRole("button", { name: "Continue", exact: true }).click();
    } else if (kind === "deliberation" || kind === "final-choice") {
      if (options.exerciseErrors && kind === "final-choice" && !timedOut) {
        timedOut = true;
        await page.waitForFunction(e => !document.querySelector(`[data-event="${e}"]`), event);
      } else {
        await page.keyboard.press(kind === "deliberation" ? "j" : "k");
        await page.waitForFunction(e => !document.querySelector(`[data-event="${e}"]`), event);
      }
    } else if (kind === "attention") {
      const letter = (await screen.textContent()).trim().toLowerCase();
      const key = options.exerciseErrors && !wrongAttention ? (letter === "a" ? "b" : "a") : letter;
      wrongAttention ||= key !== letter;
      await page.keyboard.press(key);
      await page.waitForFunction(e => !document.querySelector(`[data-event="${e}"]`), event);
    } else if (kind === "item-memory") {
      const index = Number(event.split("-").pop());
      const old = await page.evaluate(i => window.__design.memory_trials[i].is_old, index);
      const mistakenNew = options.exerciseErrors && !old && !falseAlarm;
      if (mistakenNew) falseAlarm = true;
      await page.keyboard.press(old || mistakenNew ? "1" : "0");
      await page.waitForFunction(e => !document.querySelector(`[data-event="${e}"]`), event);
    } else if (kind === "association-memory") {
      const index = Number(event.split("-").pop());
      const answer = await page.evaluate(i => window.__design.memory_trials[i].correct_option, index);
      const key = options.exerciseErrors && !wrongAssociation ? answer % 4 + 1 : answer;
      wrongAssociation ||= key !== answer;
      await page.keyboard.press(String(key));
      await page.waitForFunction(e => !document.querySelector(`[data-event="${e}"]`), event);
    } else if (await page.locator("#jspsych-survey-text-next").isVisible()) {
      await page.locator("textarea").fill("Automated QA test response; exclude from participant analyses.");
      await page.locator("#jspsych-survey-text-next").click();
    } else if (await page.locator("#jspsych-survey-likert-next").isVisible()) {
      await page.locator("#jspsych-survey-likert-next").click();
    } else if (await page.locator('input[value="Continue"]').isVisible()) {
      await page.locator('input[type="number"]').fill("24");
      await page.locator('input[value="Continue"]').click();
    } else if (await page.getByRole("button", { name: "Continue", exact: true }).isVisible()) {
      if (options.screenshots) {
        const phase = await page.evaluate(() => window.__jsPsych.getCurrentTrial().data.phase || "instructions");
        await page.screenshot({ path: path.join(options.screenshots, phase + ".png") });
      }
      await page.getByRole("button", { name: "Continue", exact: true }).click();
    } else {
      await page.waitForTimeout(15);
    }
  }
  throw new Error("Robot did not reach the final screen: " + (await page.locator("body").innerText()).slice(-700));
}
module.exports = { runThroughExperiment };
