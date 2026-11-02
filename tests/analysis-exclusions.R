# Run from the repository root: Rscript tests/analysis-exclusions.R
# Only synthetic records are used; never imports pilot/full-sample observations.
suppressPackageStartupMessages({ library(dplyr); library(readr); library(tibble) })
report_path <- normalizePath("writeup/replication-report.qmd", mustWork = TRUE)
report <- readLines(report_path, warn = FALSE)
start <- which(report == "#| label: analysis-functions")
stopifnot(length(start) == 1L)
end <- which(seq_along(report) > start & report == "```")[1]
expressions <- parse(text = report[seq.int(start + 1L, end - 1L)])
required <- c("as_bool", "score_attention_checks", "read_phase")
loaded <- character()
for (expression in expressions) {
  if (is.call(expression) && identical(expression[[1]], as.name("<-")) &&
      is.symbol(expression[[2]]) && as.character(expression[[2]]) %in% required) {
    eval(expression, envir = .GlobalEnv)
    loaded <- c(loaded, as.character(expression[[2]]))
  }
}
stopifnot(setequal(loaded, required))

checks <- function(id, responses) tibble(
  participant_id = id, task = "attention_check", letter = "a", response = responses)
synthetic <- bind_rows(
  checks("accuracy_boundary", c("A", rep("b", 9))),
  checks("accuracy_below", c("a", rep("b", 10))),
  checks("nonresponse_boundary", c("a", rep("null", 9))),
  checks("nonresponse_above", c("a", rep("null", 10))),
  checks("all_wrong", rep("b", 10)),
  checks("missing_encodings", c("a", NA_character_, "", "null", "NULL")),
  checks("space_is_a_response", c("a", " ")))
scores <- score_attention_checks(synthetic)
row <- function(id) filter(scores, participant_id == id)
stopifnot(
  row("accuracy_boundary")$attention_accuracy == 0.10,
  row("accuracy_below")$attention_accuracy < 0.10,
  row("nonresponse_boundary")$attention_nonresponse_rate == 0.90,
  row("nonresponse_above")$attention_nonresponse_rate > 0.90,
  row("all_wrong")$attention_accuracy == 0,
  row("all_wrong")$attention_nonresponse_rate == 0,
  row("missing_encodings")$n_attention_checks == 5L,
  row("missing_encodings")$n_attention_correct == 1L,
  row("missing_encodings")$n_attention_nonresponses == 4L,
  row("space_is_a_response")$n_attention_nonresponses == 0L,
  nrow(score_attention_checks(tibble(task = character()))) == 0L)
cat("PASS: descriptive attention accuracy and nonresponses, missing responses, case-insensitive scoring, zero checks\n")


test_import_and_retention <- function() {
  original_directory <- getwd()
  on.exit(setwd(original_directory), add = TRUE)
  # R owns this temporary directory and removes its session directory on exit.
  fixture <- tempfile("psych251-exclusion-test-")
  export_dir <- file.path(fixture, "data", "raw", "synthetic")
  dir.create(export_dir, recursive = TRUE)
  dir.create(file.path(fixture, "writeup"))
  ids <- c("accuracy_boundary", "accuracy_below", "nonresponse_boundary",
           "nonresponse_above", "zero_checks", "incomplete", "answered_repeats", "qa", "preview")
  participants <- tibble(participant_id = ids,
    completed = ids != "incomplete", practice_misses = if_else(ids == "answered_repeats", 3L, 0L),
    qa_run = ids == "qa", preview_run = ids == "preview")
  scientific_rows <- bind_rows(lapply(ids, function(id) bind_rows(
    tibble(participant_id = id, task = "preference_rating", category = c("a", "b"),
           rating = c(20, 80), rt = 1000),
    tibble(participant_id = id, task = "final_choice", pair_type = "unchosen",
           left_category = c("a", "b"), right_category = c("b", "a"),
           timed_out = FALSE, chose_paired_reward = c(TRUE, FALSE), rt = 1000))))
  attention_rows <- synthetic |> filter(participant_id %in% ids)
  write_csv(participants, file.path(export_dir, "participants.csv"), na = "")
  write_csv(bind_rows(scientific_rows, attention_rows), file.path(export_dir, "trials.csv"), na = "")
  setwd(file.path(fixture, "writeup"))
  phase <- read_phase("synthetic")
  # Missed practice choices answered on their repeat do not exclude (original Exp 1).
  expected <- c("accuracy_boundary", "accuracy_below", "nonresponse_boundary",
                "nonresponse_above", "zero_checks", "answered_repeats")
  stopifnot(setequal(phase$keep$participant_id, expected),
    setequal(unique(phase$retained$participant_id), expected),
    setequal(unique(as.character(phase$model_data$pid)), expected),
    nrow(phase$model_data) == 12L)
  low_attention <- phase$keep |> filter(attention_accuracy < 0.10 | attention_nonresponse_rate > 0.90)
  stopifnot(setequal(low_attention$participant_id, c("accuracy_below", "nonresponse_above")))
  zero <- filter(phase$participants, participant_id == "zero_checks")
  stopifnot(zero$n_attention_checks == 0L, is.na(zero$attention_accuracy),
    is.na(zero$attention_nonresponse_rate),
    !any(grepl("^(flag|exclude)_attention", names(phase$participants))))
  # No attention-check rows in an export, including no letter/response columns.
  write_csv(scientific_rows, file.path(export_dir, "trials.csv"), na = "")
  no_checks <- read_phase("synthetic")
  stopifnot(nrow(no_checks$keep) == 6L,
    all(no_checks$keep$n_attention_checks == 0L),
    all(is.na(no_checks$keep$attention_accuracy)))
  write_csv(mutate(participants, completed = FALSE),
            file.path(export_dir, "participants.csv"), na = "")
  all_excluded <- read_phase("synthetic")
  stopifnot(nrow(all_excluded$keep) == 0L, nrow(all_excluded$retained) == 0L,
            nrow(all_excluded$model_data) == 0L,
            is.null(read_phase("not-collected")))
  cat("PASS: low-attention participants retained; answered practice repeats retained; incompletion (including a missed repeat), QA and preview exclusions preserved; zero-check, empty and no-data exports\n")
}
test_import_and_retention()
