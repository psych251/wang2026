const { expect } = require("@playwright/test");
const path = require("node:path");

// Only accelerated QA sessions use this helper. Robot records are not pilot observations.
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
    const { kind, event, task } = await page.evaluate(() => {
      const node = document.querySelector("[data-screen]");
      return { kind: node ? node.dataset.screen : null, event: node ? node.dataset.event : null,
        task: window.__jsPsych.getCurrentTrial()?.data?.task };
    });
    if (options.screenshots && kind && !seen.has(kind)) {
      seen.add(kind);
      if (kind === "outcome" && options.normalTiming) await page.waitForTimeout(1100);
      await page.screenshot({ path: path.join(options.screenshots, kind + ".png") });
    }
    if (options.screenshots && ["choice_rationale", "demographics", "feedback_likert", "feedback_text"].includes(task) && !seen.has(task)) {
      seen.add(task);
      await page.screenshot({ path: path.join(options.screenshots, task + ".png") });
    }
    if (kind === "rating") {
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
    // Survey plugins share Continue controls. Route using the active trial task
    // rather than successive DOM checks that can straddle a screen transition.
    } else if (task === "choice_rationale" || task === "feedback_text") {
      await page.locator("textarea").fill("Automated QA test response; exclude from participant analyses.");
      await page.locator("#jspsych-survey-text-next").click();
    } else if (task === "feedback_likert") {
      await page.locator("#jspsych-survey-likert-next").click();
    } else if (task === "demographics") {
      await page.locator('[data-name="age"] input').fill("24");
      await page.getByRole("button", { name: "Continue", exact: true }).click();
    } else if (task === "instructions") {
      const viewport = page.viewportSize();
      for (const element of [page.locator(".instructions-screen"), page.getByRole("button", { name: "Continue", exact: true })]) {
        const bounds = await element.boundingBox();
        expect(bounds.x).toBeGreaterThanOrEqual(0);
        expect(bounds.y).toBeGreaterThanOrEqual(0);
        expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width);
        expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height);
      }
      if (options.screenshots) {
        const phase = await page.evaluate(() => window.__jsPsych.getCurrentTrial().data.phase || "instructions");
        await page.screenshot({ path: path.join(options.screenshots, "instructions-" + phase + ".png") });
      }
      await page.getByRole("button", { name: "Continue", exact: true }).click();
    } else {
      await page.waitForTimeout(15);
    }
  }
  throw new Error("Robot did not reach the final screen: " + (await page.locator("body").innerText()).slice(-700));
}
module.exports = { runThroughExperiment };
