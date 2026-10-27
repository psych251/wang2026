const { test, expect, devices } = require("@playwright/test");
const { runThroughExperiment } = require("./robot");
const EMULATOR = process.env.EMULATOR === "1" || !!process.env.FIRESTORE_EMULATOR_HOST;
const ID = "wang2026-exp1-qa";
const FS = "http://localhost:8080/v1/projects/demo-psych251/databases/(default)/documents";
const query = () => EMULATOR ? "/?emulator=1&qa=1&seed=314159" : "/?preview=1&qa=1&seed=314159";

function decode(v) {
  if (v === null || v === undefined) return null;
  for (const key of ["stringValue", "booleanValue", "timestampValue"]) if (key in v) return v[key];
  for (const key of ["integerValue", "doubleValue"]) if (key in v) return Number(v[key]);
  if ("nullValue" in v) return null;
  if ("arrayValue" in v) return (v.arrayValue.values || []).map(decode);
  if ("mapValue" in v) return fields(v.mapValue.fields || {});
  return v;
}
function fields(f) { return Object.fromEntries(Object.entries(f).map(([k, v]) => [k, decode(v)])); }
async function getDoc(path) {
  const response = await fetch(`${FS}/${path}`, { headers: { Authorization: "Bearer owner" } });
  expect(response.status).toBe(200);
  return fields((await response.json()).fields);
}
async function readTrials(docId) {
  const response = await fetch(`${FS}/experiments/${ID}/participants/${docId}/trials?pageSize=500`, { headers: { Authorization: "Bearer owner" } });
  expect(response.status).toBe(200);
  return (await response.json()).documents.flatMap(d => fields(d.fields).trials);
}

test("complete experiment saves every required measure and exercises timeout and incorrect answers", async ({ page }, info) => {
  const errors = [];
  const failedImages = [];
  page.on("pageerror", error => errors.push(String(error)));
  page.on("response", response => { if (/\/(stimuli|instructions)\//.test(response.url()) && response.status() !== 200) failedImages.push(response.url()); });
  await page.goto(query() + "&PROLIFIC_PID=QA-robot&STUDY_ID=QA-study&SESSION_ID=QA-session");
  await page.waitForFunction(() => window.__saver && window.__saver.docId);
  await page.screenshot({ path: info.outputPath("consent.png") });
  await runThroughExperiment(page, { exerciseErrors: true, screenshots: info.outputDir });
  expect(errors).toEqual([]);
  expect(failedImages).toEqual([]);
  const trials = await page.evaluate(() => window.__jsPsych.data.get().values());
  await info.attach("qa-trials", { body: JSON.stringify(trials, null, 2), contentType: "application/json" });
  const select = task => trials.filter(t => t.task === task);
  expect(select("instructions").filter(t => t.instruction_asset).map(t => t.instruction_asset)).toEqual([
    "instructions/overallintro.svg", "instructions/rating2.svg", "instructions/delintro2.svg",
    "instructions/delintro3.svg", "instructions/learning2.svg", "instructions/memory2.svg",
  ]);
  expect(select("instructions").filter(t => t.instruction_presentation === "original_svg").every(t => t.response === " ")).toBe(true);
  const outcomeInstructions = select("instructions").find(t => t.phase === "outcomes");
  expect(outcomeInstructions.instruction_presentation).toBe("exp1_adapted_text");
  expect(outcomeInstructions.stimulus).toContain("decision round of the deliberation phase");
  expect(outcomeInstructions.stimulus).not.toContain("first round");
  expect(trials[0].task).toBe("consent");
  expect(trials.at(-1).task).toBe("debrief");
  expect(select("preference_rating")).toHaveLength(24);
  expect(select("preference_rating").every(t => Number.isFinite(t.rating))).toBe(true);
  expect(select("deliberation")).toHaveLength(8);
  expect(select("choice_rationale")).toHaveLength(4);
  expect(select("final_deliberation")).toHaveLength(4);
  expect(select("outcome_learning")).toHaveLength(4);
  expect(select("outcome_learning").filter(t => t.chosen_reward === 1)).toHaveLength(2);
  expect(select("final_choice")).toHaveLength(48);
  expect(select("final_choice").filter(t => t.pair_type === "unchosen")).toHaveLength(24);
  expect(select("final_choice").filter(t => t.timed_out)).toHaveLength(1);
  expect(select("final_choice").filter(t => t.timed_out)[0].adaptive_choice).toBeNull();
  for (const t of select("final_choice").filter(t => !t.timed_out)) {
    const pickedReward = t.choice === "left" ? t.left_paired_reward : t.right_paired_reward;
    expect(t.chose_paired_reward).toBe(pickedReward === 1);
    expect(t.adaptive_choice).toBe(t.pair_type === "chosen" ? pickedReward === 1 : pickedReward === 0);
  }
  expect(select("item_memory")).toHaveLength(8);
  expect(select("item_memory").filter(t => t.false_alarm)).toHaveLength(1);
  expect(select("associative_memory")).toHaveLength(4);
  expect(select("associative_memory").filter(t => !t.correct)).toHaveLength(1);
  expect(select("attention_check").some(t => !t.correct)).toBe(true);
  expect(select("reward_judgment")).toHaveLength(0);
  expect(select("recognition_trial")).toHaveLength(0);
  const docId = await page.evaluate(() => window.__saver.docId);
  expect([...new Set(trials.map(t => t.participant_id))]).toEqual([docId]);
  expect(trials.every(t => t.qa_run)).toBe(true);
  if (EMULATOR) {
    const participant = await getDoc(`experiments/${ID}/participants/${docId}`);
    expect(participant.completed).toBe(true);
    expect(participant.design).toBe("within-subjects");
    expect(participant.prolific_pid).toBe("QA-robot");
    const saved = await readTrials(docId);
    expect(saved.length).toBe(trials.length);
    expect(saved.filter(t => t.task === "final_choice")).toHaveLength(48);
    expect(await page.evaluate(() => window.__saver.stats.writes_failed)).toBe(0);
  } else {
    await expect(page.locator("#data-saver-fallback")).toBeVisible();
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download data (JSON)" }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.json$/);
  }
});

test("chunked emulator writes retain all trial indices", async ({ page }) => {
  test.skip(!EMULATOR, "requires local Firestore/Auth emulator");
  await page.goto(query() + "&chunk_size=7");
  await runThroughExperiment(page);
  const docId = await page.evaluate(() => window.__saver.docId);
  const p = await getDoc(`experiments/${ID}/participants/${docId}`);
  const rows = await readTrials(docId);
  expect(rows.length).toBe(p.n_trials);
  // Conditional jsPsych timelines may skip indices; compare actual browser rows, not a
  // synthetic contiguous sequence, so this checks that saving loses/duplicates no trials.
  const expected = await page.evaluate(() => window.__jsPsych.data.get().values().map(t => t.trial_index));
  expect(rows.map(t => t.trial_index).sort((a, b) => a - b)).toEqual(expected.sort((a, b) => a - b));
  expect(new Set(rows.map(t => t.trial_index)).size).toBe(rows.length);
});

test("declining consent records no task responses and does not complete the study", async ({ page }) => {
  await page.goto(query());
  await page.getByRole("button", { name: "I do not agree" }).click();
  await expect(page.getByText("You chose not to participate")).toBeVisible();
  const rows = await page.evaluate(() => window.__jsPsych.data.get().values());
  expect(rows).toHaveLength(1);
  expect(rows[0].consented).toBe(false);
  if (EMULATOR) {
    const docId = await page.evaluate(() => window.__saver.docId);
    expect((await getDoc(`experiments/${ID}/participants/${docId}`)).completed).toBe(false);
  }
});

test("three practice timeouts end the session and mark it incomplete", async ({ page }) => {
  await page.goto(query());
  await page.getByRole("button", { name: "I agree to participate" }).click();
  while (!(await page.locator('[data-screen="deliberation"]').isVisible())) {
    const artwork = page.locator(".instruction-image");
    if (await artwork.count()) {
      await artwork.evaluate(e => e.decode());
      const source = await artwork.getAttribute("src");
      await page.keyboard.press("Space");
      await expect(page.locator(`.instruction-image[src="${source}"]`)).toHaveCount(0);
      continue;
    }
    if (await page.locator('input[type="range"]').isVisible()) {
      await page.locator('input[type="range"]').focus();
      await page.keyboard.press("ArrowRight");
    }
    const next = page.getByRole("button", { name: "Continue", exact: true });
    if (await next.isVisible() && await next.isEnabled()) {
      await page.getByRole("button", { name: "Continue", exact: true }).click();
    } else await page.waitForTimeout(20);
  }
  await expect(page.getByText("Task ended", { exact: true })).toBeVisible({ timeout: 12000 });
  const rows = await page.evaluate(() => window.__jsPsych.data.get().values());
  expect(rows.filter(t => t.task === "deliberation" && t.timed_out)).toHaveLength(3);
  expect(rows.filter(t => t.task === "outcome_learning")).toHaveLength(0);
  if (EMULATOR) {
    const docId = await page.evaluate(() => window.__saver.docId);
    const p = await getDoc(`experiments/${ID}/participants/${docId}`);
    expect(p.completed).toBe(false);
    expect(p.termination_reason).toBe("three_missed_practice_responses");
  }
});

for (const asset of ["stimuli/shrimp_exemplar1.jpg", "instructions/memory2.svg"]) {
test(`missing image prevents entry into the task: ${asset}`, async ({ page }) => {
  await page.route("**/" + asset, route => route.fulfill({ status: 404, body: "missing" }));
  await page.goto(query());
  await page.getByRole("button", { name: "I agree to participate" }).click();
  await expect(page.getByText("Images could not be loaded")).toBeVisible();
  await expect(page.locator('[data-screen="rating"]')).toHaveCount(0);
});
}

test("production settings retain original response windows and outcome delay", async ({ page }) => {
  // No qa=1: verify normal experiment parameters, while forcing database offline.
  await page.goto("/?preview=1");
  await page.getByRole("button", { name: "I agree to participate" }).click();
  await page.waitForFunction(() => window.__jsPsych && window.__design);
  const data = await page.evaluate(() => {
    const timeline = window.__jsPsych.getTimeline();
    const flattened = [];
    function walk(nodes) { for (const n of nodes) { if (n.timeline) walk(n.timeline); else flattened.push(n); } }
    walk(timeline);
    return flattened.filter(t => ["deliberation", "final_deliberation", "final_choice", "outcome_learning"].includes(t.data && t.data.task))
      .map(t => ({ task: t.data.task, duration: t.trial_duration }));
  });
  expect(data.filter(t => t.task === "deliberation").every(t => t.duration === 5000)).toBe(true);
  expect(data.filter(t => t.task === "final_deliberation").every(t => t.duration === null)).toBe(true);
  expect(data.filter(t => t.task === "final_choice").every(t => t.duration === 7000)).toBe(true);
  expect(data.filter(t => t.task === "outcome_learning").every(t => t.duration === 3000)).toBe(true);
});

test("a second run is assigned a distinct participant record", async ({ page }) => {
  await page.goto(query());
  await page.waitForFunction(() => window.__saver && window.__saver.docId);
  const first = await page.evaluate(() => window.__saver.docId);
  await page.reload();
  await page.waitForFunction(() => window.__saver && window.__saver.docId);
  expect(await page.evaluate(() => window.__saver.docId)).not.toBe(first);
});

test("completion-code parameter cannot redirect an automated test to Prolific", async ({ page }) => {
  await page.goto(query() + "&cc=QA-COMPLETION");
  await runThroughExperiment(page);
  expect(page.url()).toContain("localhost");
  if (EMULATOR) await expect(page.getByText("QA-COMPLETION")).toBeVisible();
});

test("mobile devices stop before consent; desktop devices can consent", async ({ browser, page }) => {
  await page.goto(query());
  await expect(page.getByRole("button", { name: "I agree to participate" })).toBeVisible();
  const context = await browser.newContext({ ...devices["iPhone 13"] });
  const mobile = await context.newPage();
  await mobile.goto("http://localhost:8017" + query());
  await expect(mobile.locator("#device-unsupported")).toBeVisible();
  await expect(mobile.getByRole("button", { name: "I agree to participate" })).toHaveCount(0);
  await context.close();
});

test("download fallback gives participants the researcher contact", async ({ page }) => {
  await page.goto(query());
  await page.waitForFunction(() => window.__saver && window.__saver.docId);
  await page.evaluate(() => window.__saver._offerDownload(null, "[]"));
  await expect(page.locator("#data-saver-fallback")).toContainText("yifangsl@stanford.edu");
  await expect(page.locator("#data-saver-fallback").getByRole("link")).toHaveAttribute("href", /^mailto:/);
});

test("security rules reject reads and writes to someone else's records", async ({ page }) => {
  test.skip(!EMULATOR, "requires local Firestore/Auth emulator");
  await page.goto(query());
  await page.waitForFunction(() => window.__saver && window.__saver.mode === "emulator");
  const results = await page.evaluate(async () => {
    const s = window.__saver, fb = s.fb, out = {};
    const attempt = async (name, fn) => { try { await fn(); out[name] = "allowed"; } catch (error) { out[name] = error.code; } };
    await attempt("read_own", () => fb.getDoc(fb.doc(s.db, "experiments", s.opts.experiment_id, "participants", s.docId)));
    await attempt("write_other", () => fb.setDoc(fb.doc(s.db, "experiments", s.opts.experiment_id, "participants", "someone-else-abcd"), { hacked: true }));
    await attempt("write_other_trial", () => fb.setDoc(fb.doc(s.db, "experiments", s.opts.experiment_id, "participants", "someone-else-abcd", "trials", "c0"), { trials: [] }));
    await attempt("unrelated", () => fb.setDoc(fb.doc(s.db, "unrelated", "doc"), { hacked: true }));
    await attempt("own_trial", () => fb.setDoc(fb.doc(s.db, "experiments", s.opts.experiment_id, "participants", s.docId, "trials", "rules-test"), { trials: [{ a: 1 }] }));
    return out;
  });
  expect(results).toEqual({ read_own: "permission-denied", write_other: "permission-denied", write_other_trial: "permission-denied", unrelated: "permission-denied", own_trial: "allowed" });
});

test("uncaught client errors reach the emulator error collection", async ({ page }) => {
  test.skip(!EMULATOR, "requires local Firestore/Auth emulator");
  await page.goto(query());
  await page.waitForFunction(() => window.__saver && window.__saver.mode === "emulator");
  await page.evaluate(() => { setTimeout(() => { throw new Error("QA simulated error"); }, 0); });
  await page.waitForFunction(() => window.__saver.stats.errors_logged >= 1);
  const uid = await page.evaluate(() => window.__saver.uid);
  await expect.poll(async () => {
    const response = await fetch(`${FS}/experiments/${ID}/errors?pageSize=100`, { headers: { Authorization: "Bearer owner" } });
    const body = await response.json();
    return (body.documents || []).some(d => {
      const record = fields(d.fields);
      return record.uid === uid && record.message.includes("QA simulated error");
    });
  }).toBe(true);
});

test("connection loss at completion offers data rescue", async ({ page, context }) => {
  test.skip(!EMULATOR, "requires local Firestore/Auth emulator");
  await page.goto(query());
  await runThroughExperiment(page, { beforeFinish: () => context.setOffline(true) });
  await expect(page.locator("#data-saver-fallback")).toBeVisible();
  await expect(page.getByText("Your responses were saved")).toHaveCount(0);
  await context.setOffline(false);
});
