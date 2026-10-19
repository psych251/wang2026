/*
 * Experiment 1 of Wang, Li & Bakkour (2026), reconstructed from the paper,
 * original Experiment 1 records, and supplied Experiment 2 source code.
 * IVs: within-participant chosen/unchosen pair type and paired chosen-item outcome.
 * DVs: rating; response/choice/rt; chose_paired_reward/chose_inferred_high; memory correct.
 * Trials: 24 ratings; 8 timed practice + 4 untimed decisions; 4 outcomes; 48 choices; 8 memory.
 * Randomization: seeded items, pairs, sides, order; exactly two rewarded chosen anchors.
 * Exclusion flag: three practice nonresponses; no invented attention accuracy cutoff.
 */
(function () {
  "use strict";
  const D = window.WangDesign;
  const image = (filename, cls = "", extra = "") =>
    `<img class="object-image ${cls}" src="stimuli/${filename}" alt="Object" ${extra}>`;
  const sideBySide = (left, right, selected = null) =>
    `<div class="object-pair">${image(left, selected === "left" ? "selected" : "")}${image(right, selected === "right" ? "selected" : "")}</div>`;
  const keys = '<p class="key-hint"><kbd>J</kbd> Left <span class="key-gap"></span> Right <kbd>K</kbd></p>';

  function build(jsPsych, saver, config, params) {
    const local = ["localhost", "127.0.0.1"].includes(location.hostname);
    const qa = params.get("qa") === "1" && (local || params.get("emulator") === "1");
    const preview = params.get("preview") === "1";
    const seed = (local && params.has("seed")) ? Number(params.get("seed")) >>> 0 : crypto.getRandomValues(new Uint32Array(1))[0];
    const design = D.create(window.STIMULUS_MANIFEST, seed);
    const duration = ms => qa ? Math.min(ms, 20) : ms;
    const responseWindow = ms => qa ? 1500 : ms;
    window.__design = design;
    window.__jsPsych = jsPsych;
    const metadata = {
      design: "within-subjects", paradigm: "wang2026-experiment1", paradigm_version: "1.0.0-draft",
      random_seed: seed, stimulus_manifest: design.manifest_version, qa_run: qa, preview_run: preview,
      practice_miss_limit: 3, source_protocol: "paper-exp1-and-archived-exp1-records",
    };
    jsPsych.data.addProperties(metadata);
    saver.updateParticipant(metadata);

    if (preview || qa) {
      const badge = document.createElement("div");
      badge.id = "preview-badge";
      badge.textContent = qa ? "AUTOMATED TEST: accelerated timing; exclude these data" : "PREVIEW: data download only; no live database writes";
      document.body.appendChild(badge);
    }
    const intro = (title, body, name) => ({
      type: jsPsychHtmlButtonResponse,
      stimulus: `<section class="instructions-screen"><h2>${title}</h2>${body}</section>`,
      choices: ["Continue"], data: { task: "instructions", phase: name },
    });
    const fixation = () => ({ type: jsPsychHtmlKeyboardResponse,
      stimulus: '<div class="fixation">+</div>', choices: "NO_KEYS", trial_duration: duration(750),
      data: { task: "fixation" } });
    const timeline = [{
      type: jsPsychPreload,
      images: [...new Set(window.STIMULUS_MANIFEST.categories.concat(window.STIMULUS_MANIFEST.memory_distractor_categories).flatMap(c => c.files))].map(f => "stimuli/" + f),
      message: "<h2>Loading study images</h2><p>Please keep this window open.</p>",
      max_load_time: 60000, continue_after_error: false,
      error_message: "<h2>Images could not be loaded</h2><p>Please check your connection and contact the researcher. Do not continue with missing images.</p>",
      data: { task: "preload" },
    }, intro("Build a stamp portfolio", `
      <p>Your job is to choose images that will be placed on stamps. Some stamps have a high value and others have no value.
      Try to build a portfolio with the most valuable stamps, using the information you learn during the task.</p>
      <p>First, you will rate some pictures. You will then make choices, see stamp values, and make further choices.
      Detailed instructions will appear before each part.</p>
      <p>Use a computer keyboard and complete the study in one sitting in a quiet place.</p>`, "welcome"),
    intro("Picture preferences", `<p>You will see 24 pictures, one at a time. Rate how much you personally like each one.</p>
      <p>Move the slider from <strong>Strongly dislike</strong> to <strong>Strongly like</strong>, then select Continue.
      There are no right or wrong answers. These are personal-preference ratings, not stamp-value judgments.</p>`, "ratings")];

    for (const [i, item] of design.ratings.entries()) {
      timeline.push({ type: jsPsychHtmlSliderResponse,
        stimulus: `<div data-screen="rating" data-event="rating-${i}"><p class="phase-label">Picture preferences</p>${image(item.image)}</div>`,
        prompt: "<p>How much do you personally like this picture?</p>",
        labels: ["Strongly dislike", "Neutral", "Strongly like"], min: 0, max: 100, slider_start: 50,
        slider_width: 540, require_movement: true, button_label: "Continue",
        save_trial_parameters: { stimulus: false },
        data: { task: "preference_rating", trial_id: "initial_preference", category: item.category, image: item.image, rating_number: i + 1 },
        on_finish: data => { data.rating = data.response; },
      });
    }
    timeline.push(intro("Choosing pictures", `<p>On each trial, choose the picture you think will be placed on the more valuable stamp.</p>
      <p>Press <kbd>J</kbd> for the left picture or <kbd>K</kbd> for the right picture. Your choice will briefly have a green border.</p>
      <p>You will see the same four pairs in two practice rounds and one decision round. During practice, respond within <strong>5 seconds</strong>.
      The task will end if you miss three practice responses.</p>
      <p>During the second practice round, explain each choice in a text box. Only your choices in the final decision round will determine
      which pictures enter your portfolio. Consider your reasons carefully: your explanations can affect the value of the stamps.</p>`, "deliberation"));

    function deliberation(pair, round, order) {
      // jsPsych evaluates stimulus functions before on_start; initialize display state now.
      let [left, right] = D.shuffle([pair.a, pair.b], design.random);
      let selected = null, missed = false;
      const task = round === 3 ? "final_deliberation" : "deliberation";
      const choice = {
        type: jsPsychHtmlKeyboardResponse, choices: ["j", "k"],
        trial_duration: round === 3 ? null : responseWindow(5000),
        stimulus: () => `<div data-screen="deliberation" data-event="delib-${round}-${order}"><p class="phase-label">${round === 3 ? "Decision round" : "Practice round " + round}</p>${sideBySide(left.anchor, right.anchor)}<p>Which picture will be on the more valuable stamp?</p>${keys}</div>`,
        save_trial_parameters: { stimulus: false }, data: { task, trial_id: task, round, pair_id: pair.id },
        on_start: trial => {
          trial.data = { ...trial.data, left_image: left.anchor, right_image: right.anchor,
            left_category: left.id, right_category: right.id, stimulus_type: pair.id };
        },
        on_finish: data => {
          Object.assign(data, { left_image: left.anchor, right_image: right.anchor,
            left_category: left.id, right_category: right.id, stimulus_type: pair.id });
          missed = data.response === null;
          data.timed_out = missed;
          data.choice = missed ? null : data.response.toLowerCase() === "j" ? "left" : "right";
          selected = data.choice;
          const chosen = selected === "left" ? left : selected === "right" ? right : null;
          data.chosen_image = chosen ? chosen.anchor : null;
          data.chosen_category = chosen ? chosen.id : null;
          data.unchosen_image = chosen ? (chosen === left ? right : left).anchor : null;
          data.unchosen_category = chosen ? (chosen === left ? right : left).id : null;
          if (round === 3 && chosen) {
            pair.chosen = chosen;
            pair.unchosen = chosen === pair.a ? pair.b : pair.a;
          }
          if (round < 3 && missed) design.practice_misses++;
          data.cumulative_practice_misses = design.practice_misses;
          if (design.practice_misses >= 3) {
            design.terminated = true;
            jsPsych.abortExperiment();
          }
        },
      };
      const feedback = { type: jsPsychHtmlKeyboardResponse, choices: "NO_KEYS", trial_duration: duration(500),
        stimulus: () => `<div data-screen="selection">${sideBySide(left.anchor, right.anchor, selected)}${keys}</div>`,
        save_trial_parameters: { stimulus: false }, data: { task: "selection_feedback", phase: task, pair_id: pair.id } };
      const warning = { type: jsPsychHtmlKeyboardResponse, choices: "NO_KEYS", trial_duration: duration(3000),
        stimulus: "<p>You did not respond. Please make a choice within 5 seconds on the next practice trial.</p>",
        data: { task: "missed_response_warning", pair_id: pair.id } };
      const children = [choice, { timeline: [feedback], conditional_function: () => !missed },
        { timeline: [warning], conditional_function: () => missed }];
      if (round === 2) children.push({
        timeline: [{ type: jsPsychSurveyText,
          questions: [{ prompt: "Why did you choose that picture?", name: "reason", rows: 3, required: true }],
          data: { task: "choice_rationale", trial_id: "reasons", pair_id: pair.id },
          on_finish: data => { data.chosen_image = selected === "left" ? left.anchor : right.anchor; },
        }], conditional_function: () => !missed,
      });
      children.push(fixation());
      return { timeline: children };
    }
    for (let round = 1; round <= 3; round++) {
      if (round === 2) timeline.push(intro("Practice round 2", "<p>Choose again, then explain each choice. Respond to the picture pair within 5 seconds; take the time you need to type your reason.</p>", "practice2"));
      if (round === 3) timeline.push(intro("Decision round", "<p>Now make your final choice for each pair. These choices determine which pictures go on your stamps. There is no time limit for this round.</p>", "decision_round"));
      D.shuffle(design.pairs, design.random).forEach((p, i) => timeline.push(deliberation(p, round, i)));
    }

    timeline.push({
      timeline: [intro("Stamp values", "<p>You will now see each picture you chose, followed by whether its stamp has a reward or no reward. Watch carefully and remember what you learn.</p>", "outcomes")],
      on_timeline_start: () => {
        D.assignRewards(design);
        const assignments = design.pairs.map(p => ({ pair_id: p.id,
          chosen_image: p.chosen.anchor, chosen_category: p.chosen.id,
          unchosen_image: p.unchosen.anchor, unchosen_category: p.unchosen.id, chosen_reward: p.reward }));
        saver.updateParticipant({ assignments, practice_misses: design.practice_misses });
      },
    });
    for (const pair of D.shuffle(design.pairs, design.random)) {
      timeline.push({ type: jsPsychHtmlKeyboardResponse, choices: "NO_KEYS", trial_duration: duration(3000),
        stimulus: () => `<div data-screen="outcome" class="outcome-screen"><p class="phase-label">Stamp values</p><div class="object-pair">${image(pair.chosen.anchor)}<div id="reward-reveal" class="reward-panel" style="visibility:hidden"><span class="reward-symbol ${pair.reward ? "rewarded" : "neutral"}">${pair.reward ? "+" : "×"}</span><p>${pair.reward ? "Reward" : "No reward"}</p></div></div></div>`,
        on_load: () => jsPsych.pluginAPI.setTimeout(() => {
          const panel = document.getElementById("reward-reveal");
          if (panel) panel.style.visibility = "visible";
        }, duration(1000)),
        save_trial_parameters: { stimulus: false }, data: { task: "outcome_learning", trial_id: "reward_learning", pair_id: pair.id },
        on_finish: data => Object.assign(data, { chosen_image: pair.chosen.anchor, chosen_category: pair.chosen.id,
          unchosen_image: pair.unchosen.anchor, unchosen_category: pair.unchosen.id,
          chosen_reward: pair.reward, stimulus_type: String(pair.reward), image_only_ms: 1000, outcome_visible_ms: 2000 }),
      }, fixation());
    }

    timeline.push({
      timeline: [intro("Build your portfolio", `<p>You will now choose between new pictures. Choose the one you think will be placed on the more valuable stamp, using what you have learned.</p>
        <p>Press <kbd>J</kbd> for left or <kbd>K</kbd> for right. Respond within <strong>7 seconds</strong>.</p>
        <p>Occasionally, a letter will appear. When it does, press that letter on your keyboard.</p>`, "final_choices")],
      on_timeline_start: () => D.finalChoices(design),
    });
    for (let i = 0; i < 48; i++) {
      let item, selected, hasAttention = false, letter;
      timeline.push({ type: jsPsychHtmlKeyboardResponse, choices: ["j", "k"], trial_duration: responseWindow(7000),
        stimulus: () => {
          item = design.final_choices[i];
          return `<div data-screen="final-choice" data-event="final-${i}"><p class="phase-label">Build your portfolio</p>${sideBySide(item.left.image, item.right.image)}<p>Which picture will be on the more valuable stamp?</p>${keys}</div>`;
        },
        save_trial_parameters: { stimulus: false }, data: { task: "final_choice", trial_id: "value_judgement", choice_number: i + 1 },
        on_start: trial => {
          item = design.final_choices[i];
          trial.data = { ...trial.data, choice_id: item.id, pair_type: item.pair_type, stimulus_type: item.stimulus_type,
            repetition: item.repetition, left_image: item.left.image, right_image: item.right.image,
            left_category: item.left.category, right_category: item.right.category,
            left_paired_reward: item.left.reward, right_paired_reward: item.right.reward,
            left_reward_status: item.left.reward ? "reward" : "unreward",
            right_reward_status: item.right.reward ? "reward" : "unreward",
            left_source_pair: item.left.pair_id, right_source_pair: item.right.pair_id };
        },
        on_finish: data => {
          Object.assign(data, { choice_id: item.id, pair_type: item.pair_type, stimulus_type: item.stimulus_type,
            repetition: item.repetition, left_image: item.left.image, right_image: item.right.image,
            left_category: item.left.category, right_category: item.right.category,
            left_paired_reward: item.left.reward, right_paired_reward: item.right.reward,
            left_reward_status: item.left.reward ? "reward" : "unreward",
            right_reward_status: item.right.reward ? "reward" : "unreward",
            left_source_pair: item.left.pair_id, right_source_pair: item.right.pair_id });
          data.timed_out = data.response === null;
          selected = data.timed_out ? null : data.response.toLowerCase() === "j" ? "left" : "right";
          const picked = selected ? item[selected] : null;
          data.choice = selected;
          data.selected_image = picked ? picked.image : null;
          data.selected_category = picked ? picked.category : null;
          // Reward here ALWAYS means the outcome of the originally CHOSEN counterpart.
          // Unchosen images never receive direct feedback; avoid reversing these labels.
          data.chose_paired_reward = picked ? picked.reward === 1 : null;
          data.chose_inferred_high = picked && item.pair_type === "unchosen" ? picked.reward === 0 : null;
          data.adaptive_choice = picked ? (item.pair_type === "chosen" ? picked.reward === 1 : picked.reward === 0) : null;
          hasAttention = i >= 4 && picked !== null && design.random() < 3 / 17;
          letter = String.fromCharCode(97 + Math.floor(design.random() * 26));
        },
      }, { type: jsPsychHtmlKeyboardResponse, choices: "NO_KEYS", trial_duration: duration(500),
        stimulus: () => sideBySide(item.left.image, item.right.image, selected),
        save_trial_parameters: { stimulus: false }, data: { task: "selection_feedback", phase: "final_choice" },
      }, {
        timeline: [{ type: jsPsychHtmlKeyboardResponse, choices: "ALL_KEYS",
          stimulus: () => `<div data-screen="attention" data-event="attention-${i}" class="attention-letter">${letter.toUpperCase()}</div>`,
          save_trial_parameters: { stimulus: false }, data: { task: "attention_check", trial_id: "attention_checker", after_choice: i + 1 },
          on_finish: data => { data.letter = letter; data.correct = data.response !== null && data.response.toLowerCase() === letter; },
        }, { type: jsPsychHtmlKeyboardResponse, choices: "NO_KEYS", trial_duration: duration(300),
          stimulus: () => `<div class="fixation ${jsPsych.data.get().last(1).values()[0].correct ? "correct-feedback" : "incorrect-feedback"}">+</div>`,
          data: { task: "attention_feedback" },
        }], conditional_function: () => hasAttention,
      }, fixation());
    }

    timeline.push({
      timeline: [intro("Memory task", `<p>There is one more task. You will see pictures one at a time.</p>
        <p>Was the picture one you chose in the <strong>decision round</strong> of the earlier choosing task?</p>
        <p>Press <kbd>1</kbd> for Yes (old) or <kbd>0</kbd> for No (new). If you recognize a picture, you may then be asked to choose the picture it was paired with.</p>`, "memory")],
      on_timeline_start: () => D.memoryTrials(design, window.STIMULUS_MANIFEST),
    });
    for (let i = 0; i < 8; i++) {
      let item, oldResponse = false;
      timeline.push({ type: jsPsychHtmlKeyboardResponse, choices: ["1", "0"], trial_duration: qa ? 1500 : 90000,
        stimulus: () => {
          item = design.memory_trials[i];
          return `<div data-screen="item-memory" data-event="memory-${i}"><p class="phase-label">Memory task</p>${image(item.image)}<p>Did you choose this picture in the earlier decision round?</p><p class="key-hint"><kbd>1</kbd> Yes (old) <span class="key-gap"></span><kbd>0</kbd> No (new)</p></div>`;
        },
        save_trial_parameters: { stimulus: false }, data: { task: "item_memory", trial_id: "memory_test" },
        on_start: trial => {
          item = design.memory_trials[i];
          trial.data = { ...trial.data, memory_id: item.id, image: item.image, category: item.category,
            pair_id: item.pair_id, is_old: item.is_old, answer: item.is_old ? "1" : "0",
            chosen_reward: item.chosen_reward, stimulus_type: item.is_old ? "100" : "101" };
        },
        on_finish: data => {
          Object.assign(data, { memory_id: item.id, image: item.image, category: item.category,
            pair_id: item.pair_id, is_old: item.is_old, answer: item.is_old ? "1" : "0",
            chosen_reward: item.chosen_reward, stimulus_type: item.is_old ? "100" : "101" });
          oldResponse = data.response === "1";
          data.responded_old = oldResponse;
          data.timed_out = data.response === null;
          data.correct = !data.timed_out && oldResponse === item.is_old;
          data.hit = item.is_old && oldResponse;
          data.false_alarm = !item.is_old && oldResponse;
        },
      }, {
        timeline: [{ type: jsPsychHtmlKeyboardResponse, choices: ["1", "2", "3", "4"], trial_duration: qa ? 1500 : 90000,
          stimulus: () => `<div data-screen="association-memory" data-event="association-${i}"><p class="phase-label">Memory task</p><p>Which picture was paired with the picture you just recognized?</p><div class="memory-options">${item.options.map((o, j) => `<figure>${image(o.image)}<figcaption><kbd>${j + 1}</kbd></figcaption></figure>`).join("")}</div><p>Press the number below your choice.</p></div>`,
          save_trial_parameters: { stimulus: false }, data: { task: "associative_memory", trial_id: "pick_pair" },
          on_start: trial => {
            trial.data = { ...trial.data, memory_id: item.id, pair_id: item.pair_id, cue_image: item.image,
              cue_category: item.category, chosen_reward: item.chosen_reward,
              option_images: item.options.map(o => o.image), option_roles: item.options.map(o => o.role),
              correct_option: item.correct_option };
          },
          on_finish: data => {
            Object.assign(data, { memory_id: item.id, pair_id: item.pair_id, cue_image: item.image,
              cue_category: item.category, chosen_reward: item.chosen_reward,
              option_images: item.options.map(o => o.image), option_roles: item.options.map(o => o.role),
              correct_option: item.correct_option });
            data.timed_out = data.response === null;
            data.correct = !data.timed_out && Number(data.response) === item.correct_option;
          },
        }], conditional_function: () => item.is_old && oldResponse,
      }, fixation());
    }
    // Optional course-template questions stay after all scientific measures.
    timeline.push({ type: jsPsychSurvey,
      survey_json: { showQuestionNumbers: "off", completeText: "Continue", pages: [{ elements: [
        { type: "text", name: "age", title: "How old are you? (optional)", inputType: "number", min: 18, max: 120 },
        { type: "radiogroup", name: "gender", title: "What is your gender? (optional)", choices: ["Woman", "Man", "Non-binary", "Prefer not to say"], showOtherItem: true },
        { type: "boolean", name: "native_english", title: "Is English your first language? (optional)", labelTrue: "Yes", labelFalse: "No" },
      ] }] }, data: { task: "demographics" },
    }, { type: jsPsychSurveyLikert,
      questions: [{ prompt: "How clear were the instructions? (optional)", name: "clarity", required: false,
        labels: ["Very unclear", "Unclear", "Neutral", "Clear", "Very clear"] }], data: { task: "feedback_likert" },
    }, { type: jsPsychSurveyText,
      questions: [{ prompt: "Any comments about the study? Please do not include your name or contact details. (optional)", name: "comments", rows: 3 }], data: { task: "feedback_text" },
    }, { type: jsPsychHtmlButtonResponse, choices: ["Finish"],
      stimulus: `<h2>Debrief</h2><p>Thank you for participating. This study investigates how learning an outcome for something we choose
        affects later choices about related pictures, including pictures related to options we did not choose.</p>
        <p>Two of your four chosen pictures were randomly assigned a reward and two no reward. The written explanations did not determine these assignments.
        That instruction encouraged careful consideration of the picture pairs. Pictures you did not choose were never assigned an experienced outcome.</p>
        <p>The final memory task helps examine how memory for earlier pictures and their pairings relates to later choices.</p>
        <p>Questions: <a href="mailto:${config.contact_email}">${config.contact_email}</a>. Select Finish to save your responses.</p>`,
      data: { task: "debrief" },
    });
    return { timeline, design, qa, preview };
  }
  window.WangTask = { build };
})();
