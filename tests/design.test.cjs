const { test } = require("node:test");
const assert = require("node:assert/strict");
const manifest = require("../stimuli/manifest.json");
const D = require("../src/design.js");

test("random designs preserve phase separation, exact reward balance, and counterfactual labels", () => {
  for (let seed = 0; seed < 500; seed++) {
    const d = D.create(manifest, seed);
    assert.equal(d.ratings.length, 24);
    assert.equal(new Set(d.pairs.flatMap(p => [p.a.id, p.b.id])).size, 8);
    for (const c of d.categories) {
      const images = [c.anchor, ...c.ratings, ...c.novel, ...c.memory];
      assert.equal(new Set(images).size, images.length, "same image crosses phases");
      assert.equal(c.novel.length, 6);
    }
    d.pairs.forEach((p, i) => {
      p.chosen = i % 2 ? p.a : p.b;
      p.unchosen = p.chosen === p.a ? p.b : p.a;
    });
    D.assignRewards(d);
    assert.equal(d.pairs.filter(p => p.reward === 1).length, 2);
    const choices = D.finalChoices(d);
    assert.equal(choices.length, 48);
    assert.equal(choices.filter(t => t.pair_type === "unchosen").length, 24);
    const exposure = new Map();
    const categoryPairs = new Map();
    for (const t of choices) {
      const key = t.pair_type + "|" + [t.left.category, t.right.category].sort().join("|");
      categoryPairs.set(key, (categoryPairs.get(key) || 0) + 1);
      assert.notEqual(t.left.reward, t.right.reward);
      assert.notEqual(t.left.category, t.right.category);
      for (const side of [t.left, t.right]) {
        exposure.set(side.image, (exposure.get(side.image) || 0) + 1);
        const source = d.pairs.find(p => p.id === side.pair_id);
        assert.equal(side.reward, source.reward);
        assert.equal(side.category, source[t.pair_type].id);
      }
    }
    assert.equal(exposure.size, 48);
    assert.equal(categoryPairs.size, 8);
    assert.ok([...categoryPairs.values()].every(n => n === 6));
    assert.ok([...exposure.values()].every(n => n === 2));
    assert.equal(new Set(choices.map(t => [t.left.image, t.right.image].sort().join("|"))).size, 48);
    const memory = D.memoryTrials(d, manifest);
    assert.equal(memory.length, 8);
    assert.equal(memory.filter(t => t.is_old).length, 4);
    for (const t of memory.filter(t => t.is_old)) {
      assert.equal(t.options.length, 4);
      assert.equal(t.options[t.correct_option - 1].role, "target");
      assert.equal(new Set(t.options.map(o => o.image)).size, 4);
    }
    for (const t of memory.filter(t => !t.is_old)) {
      assert.ok(!d.ratings.some(r => r.image === t.image));
      assert.ok(!exposure.has(t.image));
      assert.ok(!d.categories.some(c => c.anchor === t.image));
    }
  }
});

test("student-approved shrimp correction is applied and all image bytes match manifest hashes", () => {
  const fs = require("node:fs");
  const crypto = require("node:crypto");
  const path = require("node:path");
  const sea = manifest.categories.find(c => c.id === "sea");
  assert.ok(sea.files.includes("shrimp_exemplar1.jpg"));
  assert.ok(!sea.files.includes("cinnamon_bun_exemplar1.jpg"));
  for (const [filename, hash] of Object.entries(manifest.sha256)) {
    const bytes = fs.readFileSync(path.join(__dirname, "..", "stimuli", filename));
    assert.equal(crypto.createHash("sha256").update(bytes).digest("hex"), hash);
  }
});
