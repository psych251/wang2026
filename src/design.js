/* Experiment 1 design generation. Pure functions also run under Node for invariant tests. */
(function (root) {
  "use strict";
  function rng(seed) {
    let state = seed >>> 0;
    return () => {
      state += 0x6D2B79F5;
      let t = Math.imul(state ^ (state >>> 15), 1 | state);
      t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function shuffle(values, random) {
    const out = values.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }
  function create(manifest, seed) {
    const random = rng(seed);
    const categories = manifest.categories.map(category => {
      if (category.files.length < 14) throw new Error("Not enough independent stimuli: " + category.id);
      const files = shuffle(category.files, random);
      return { id: category.id, anchor: files[0], novel: files.slice(1, 7),
        ratings: files.slice(7, 10), memory: files.slice(10), chosen: null, reward: null };
    });
    const paired = shuffle(categories, random);
    const pairs = Array.from({ length: 4 }, (_, i) => ({
      id: "pair-" + (i + 1), a: paired[2 * i], b: paired[2 * i + 1],
      chosen: null, unchosen: null, reward: null,
    }));
    const ratings = shuffle(categories.flatMap(c => c.ratings.map(image => ({ image, category: c.id }))), random);
    return { seed, random, manifest_version: manifest.version, categories, pairs, ratings,
      practice_misses: 0, terminated: false, final_choices: [], memory_trials: [] };
  }
  function assignRewards(design) {
    const rewards = shuffle([1, 1, 0, 0], design.random);
    design.pairs.forEach((p, i) => {
      if (!p.chosen || !p.unchosen) throw new Error("Final deliberation choice missing: " + p.id);
      p.reward = rewards[i];
      p.chosen.chosen = true;
      p.unchosen.chosen = false;
      p.chosen.reward = p.unchosen.reward = p.reward;
      p.chosen.pair_id = p.unchosen.pair_id = p.id;
    });
  }
  function finalChoices(design) {
    const trials = [];
    for (const kind of ["chosen", "unchosen"]) {
      const members = design.pairs.map(p => p[kind]);
      const rewarded = members.filter(c => c.reward === 1);
      const neutral = members.filter(c => c.reward === 0);
      // Original Exp 1 records: all 2 x 2 category combinations, six trials each.
      // Each novel image therefore appears twice, once against each opposing category.
      rewarded.forEach((rewardCategory, a) => neutral.forEach((neutralCategory, b) => {
        const rImages = shuffle(rewardCategory.novel, design.random);
        const nImages = shuffle(neutralCategory.novel, design.random);
        for (let i = 0; i < 6; i++) {
          const r = { image: rImages[i], category: rewardCategory.id, pair_id: rewardCategory.pair_id, reward: 1 };
          const n = { image: nImages[i], category: neutralCategory.id, pair_id: neutralCategory.pair_id, reward: 0 };
          const [left, right] = design.random() < 0.5 ? [r, n] : [n, r];
          trials.push({ id: kind + "-" + a + "-" + b + "-" + i, pair_type: kind,
            stimulus_type: kind === "chosen" ? "10" : "11", repetition: b + 1, left, right });
        }
      }));
    }
    return design.final_choices = shuffle(trials, design.random);
  }
  function memoryTrials(design, manifest) {
    const trials = [];
    const groups = shuffle(manifest.memory_distractor_categories, design.random);
    design.pairs.forEach((p, i) => {
      const outside1 = groups[i].files[0];
      const outside2 = groups[i].files[1];
      const options = shuffle([
        { image: p.unchosen.anchor, role: "target", category: p.unchosen.id },
        { image: p.unchosen.memory[0], role: "same_category_lure", category: p.unchosen.id },
        { image: outside1, role: "novel_category_lure", category: groups[i].id },
        { image: outside2, role: "novel_category_lure", category: groups[i].id },
      ], design.random);
      // Archived Experiment 1 responses show two distractors from one novel category.
      // Paper says two novel categories; this implementation follows archived distractor pairs.
      trials.push({ id: p.id + "-old", image: p.chosen.anchor, category: p.chosen.id,
        is_old: true, pair_id: p.id, chosen_reward: p.reward, options,
        correct_option: options.findIndex(o => o.role === "target") + 1 });
      trials.push({ id: p.id + "-new", image: p.chosen.memory[0], category: p.chosen.id,
        is_old: false, pair_id: p.id, chosen_reward: p.reward, options: [], correct_option: null });
    });
    return design.memory_trials = shuffle(trials, design.random);
  }
  const api = { rng, shuffle, create, assignRewards, finalChoices, memoryTrials };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.WangDesign = api;
})(typeof window !== "undefined" ? window : globalThis);
