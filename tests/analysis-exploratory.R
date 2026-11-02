# Run from repository root: Rscript tests/analysis-exploratory.R
# Synthetic fixtures verify scoring and randomization; real-data fits are
# checked by rendering the report, not rerun in these unit checks.
suppressPackageStartupMessages(library(tidyverse))
report <- readLines("writeup/replication-report.qmd", warn = FALSE)
load_functions <- function(label, required) {
  start <- which(report == paste0("#| label: ", label))
  stopifnot(length(start) == 1L)
  end <- which(seq_along(report) > start & report == "```")[1]
  loaded <- character()
  for (expression in parse(text = report[seq.int(start + 1L, end - 1L)])) {
    if (is.call(expression) && identical(expression[[1]], as.name("<-")) &&
        is.symbol(expression[[2]]) && as.character(expression[[2]]) %in% required) {
      eval(expression, envir = .GlobalEnv)
      loaded <- c(loaded, as.character(expression[[2]]))
    }
  }
  stopifnot(setequal(loaded, required))
}
load_functions("analysis-functions", "as_bool")
load_functions("exploratory-rt", c("prepare_exploratory_choices", "score_exploratory_memory",
  "safe_spearman", "spearman_permutation", "memory_correlation_difference"))

old <- tibble(participant_id = "synthetic", task = "item_memory",
  memory_id = paste0("old", 1:4), is_old = "true",
  responded_old = c("true", "true", "true", "false"))
foils <- tibble(participant_id = "synthetic", task = "item_memory",
  memory_id = paste0("foil", 1:4), is_old = "false",
  responded_old = c("true", "false", "false", "false"))
association <- tibble(participant_id = "synthetic", task = "associative_memory",
  memory_id = paste0("old", 1:3), response = c("1", "2", "3"),
  option_roles = '["target","same_category_lure","novel_category_lure","novel_category_lure"]')
fixture <- bind_rows(old, foils, association)
score <- score_exploratory_memory(list(retained = fixture))
# Correct target = 3, same-category lure = 2, unrelated lure = 1, missed cue = 0.
# Mean 0–3 score / 3 = 6/12; one false alarm / four foils = 1/4.
stopifnot(nrow(score) == 1L, score$old_trials == 4L, score$foil_trials == 4L,
          score$raw_memory == 0.5, score$false_alarm_rate == 0.25,
          score$corrected_memory == 0.25)
set.seed(51)
shuffled <- score_exploratory_memory(list(retained = fixture[sample(nrow(fixture)), ]))
stopifnot(identical(score, shuffled)) # Explicit IDs, independent of row adjacency.
timeout <- fixture
timeout$response[timeout$task == "associative_memory" & timeout$memory_id == "old1"] <- "null"
stopifnot(isTRUE(all.equal(score_exploratory_memory(list(retained = timeout))$raw_memory, 4/12)))
missing_association <- fixture |> filter(!(task == "associative_memory" & memory_id == "old1"))
stopifnot(inherits(try(score_exploratory_memory(list(retained = missing_association)), silent = TRUE),
                    "try-error"))
missing_foil <- fixture |> filter(memory_id != "foil4")
stopifnot(is.na(score_exploratory_memory(list(retained = missing_foil))$corrected_memory))
duplicates <- bind_rows(fixture, fixture[1, ])
stopifnot(inherits(try(score_exploratory_memory(list(retained = duplicates)), silent = TRUE),
                    "try-error"))
empty <- score_exploratory_memory(list(retained = fixture[0, ]))
stopifnot(nrow(empty) == 0L, "corrected_memory" %in% names(empty))
cat("PASS: 0–3 memory scoring, category partial credit, false alarms, timeouts, ID joins, missing/duplicate records\n")

choices <- tibble(participant_id = rep(c("first", "second", "constant"), each = 4),
  pair_type = rep(c("chosen", "chosen", "unchosen", "unchosen"), 3),
  timed_out = FALSE, p_ns = rep(c(0L, 1L, 0L, 1L), 3),
  z_score_norm_drate_by_outcome = 0.5,
  rt = c(100, 200, 300, 400, 1100, 1200, 1300, 1400, rep(500, 4)))
prepared <- prepare_exploratory_choices(list(choices = choices, model_data = choices))
stopifnot(identical(prepared$adaptive, rep(c(0L, 1L, 1L, 0L), 3)),
  isTRUE(all.equal(prepared$z_rt[1:4], prepared$z_rt[5:8])),
  all(is.na(prepared$z_rt[9:12])))
invalid <- choices[rep(1, 5), ]
invalid$rt <- c(0, -1, Inf, NA_real_, 100)
invalid$timed_out[5] <- TRUE
stopifnot(nrow(prepare_exploratory_choices(list(model_data = bind_rows(choices, invalid)))) == 12L)
# Raw choices may retain rows that the preference filter removed. They must
# not re-enter RT models or the memory-choice aggregation built from them.
unusable_preference <- choices[1, ]
unusable_preference$rt <- 99999
unusable_preference$z_score_norm_drate_by_outcome <- NA_real_
phase <- list(choices = bind_rows(choices, unusable_preference), model_data = choices)
stopifnot(identical(prepare_exploratory_choices(phase), prepared))
phase$model_data <- choices[0, ]
stopifnot(nrow(prepare_exploratory_choices(phase)) == 0L)
cat("PASS: exploratory analyses use preference-filtered model rows; missing-preference choices stay excluded; adaptive scoring, within-person RT standardization and invalid/constant RT handling\n")

x <- 1:6
y <- c(1, 1, 2, 2, 3, 3)
positive <- spearman_permutation(x, y, B = 499L)
again <- spearman_permutation(x, y, B = 499L)
# Independent package call from the authors' script, under the same seed.
set.seed(123)
reference <- coin::spearman_test(x ~ y, distribution = coin::approximate(nresample = 499L))
stopifnot(identical(positive, again), positive$N == 6L, positive$rho > 0.95,
  identical(positive$`Permutation p (two-sided)`, as.numeric(coin::pvalue(reference))),
  positive$`Permutation p (two-sided)` <= 0.1,
  is.na(spearman_permutation(rep(1, 6), 1:6)$rho),
  is.na(spearman_permutation(1, 1)$rho),
  spearman_permutation(c(1:6, NA), c(1:6, 0), B = 99L)$N == 6L)
memory_choice <- tibble(participant_id = rep(paste0("p", 1:6), 2),
  corrected_memory = rep(1:6 / 6, 2),
  pair_type = rep(c("chosen", "unchosen"), each = 6),
  adaptive_proportion = rep(1:6 / 6, 2))
equal <- memory_correlation_difference(memory_choice, B = 499L)
stopifnot(equal$N == 6L, equal$`rho chosen minus unchosen` == 0,
  equal$`Permutation p (two-sided)` == 1,
  identical(equal, memory_correlation_difference(memory_choice, B = 499L)))
memory_choice$adaptive_proportion[7:12] <- 6:1 / 6
opposite <- memory_correlation_difference(memory_choice, B = 499L)
p <- opposite$`Permutation p (two-sided)`
stopifnot(opposite$`rho chosen minus unchosen` == 2, p >= 0, p < 0.1,
  abs(p * 499 - round(p * 499)) < 1e-10) # Raw tail proportion, without added counts.
# The source pools available rows; it does not require paired complete cases.
unpaired <- memory_choice[-1, ]
unpaired_result <- memory_correlation_difference(unpaired, B = 499L)
stopifnot(unpaired_result$N == 6L, unpaired_result$`N chosen` == 5L,
          unpaired_result$`N unchosen` == 6L)
# Some shuffled groups have constant memory: preserve the source's NA p-value.
undefined <- tibble(participant_id = rep(paste0("p", 1:3), 2),
  corrected_memory = rep(c(0, 0, 1), 2), pair_type = rep(c("chosen", "unchosen"), each = 3),
  adaptive_proportion = c(0, 0, 1, 1, 1, 0))
undefined_result <- memory_correlation_difference(undefined, B = 499L)
stopifnot(is.na(undefined_result$`Permutation p (two-sided)`),
  undefined_result$`Valid permutations` < 499L,
  is.na(memory_correlation_difference(memory_choice[0, ])$`rho chosen minus unchosen`),
  is.na(memory_correlation_difference(filter(memory_choice, pair_type == "chosen"))$
          `rho chosen minus unchosen`))
cat("PASS: exact coin call, tied ranks, seeded reproducibility, raw permutation tail proportion, all available rows, undefined-null p-values and empty/one-type data\n")
