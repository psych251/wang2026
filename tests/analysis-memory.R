# Synthetic checks for recognition sensitivity; does not fit Bayesian models.
suppressPackageStartupMessages(library(tidyverse))
report <- readLines("writeup/replication-report.qmd", warn = FALSE)
load_functions <- function(label, required) {
  start <- which(report == paste0("#| label: ", label))
  stopifnot(length(start) == 1L)
  end <- which(seq_along(report) > start & report == "```")[1]
  loaded <- character()
  for (e in parse(text = report[seq.int(start + 1L, end - 1L)])) {
    if (is.call(e) && identical(e[[1]], as.name("<-")) && is.symbol(e[[2]]) &&
        as.character(e[[2]]) %in% required) {
      eval(e, envir = .GlobalEnv)
      loaded <- c(loaded, as.character(e[[2]]))
    }
  }
  stopifnot(setequal(loaded, required))
}
load_functions("analysis-functions", "as_bool")
load_functions("memory-performance", c("score_memory_dprime", "summarize_memory_dprime"))
fixture <- function(hits, false_alarms, id = "synthetic") {
  recognized <- c(rep(TRUE, hits), rep(FALSE, 4L - hits),
                  rep(TRUE, false_alarms), rep(FALSE, 4L - false_alarms))
  tibble(participant_id = id, task = "item_memory", memory_id = paste0("m", 1:8),
    is_old = rep(c(TRUE, FALSE), each = 4L), responded_old = recognized,
    response = if_else(recognized, "1", "0"), timed_out = FALSE)
}
score <- function(x) score_memory_dprime(list(retained = x))
perfect <- score(fixture(4L, 0L))
stopifnot(perfect$hits == 4L, perfect$false_alarms == 0L,
  perfect$hit_rate_corrected == 0.875, perfect$false_alarm_rate_corrected == 0.125,
  isTRUE(all.equal(perfect$d_prime, qnorm(0.875) - qnorm(0.125))))
stopifnot(score(fixture(2L, 2L))$d_prime == 0,
          score(fixture(4L, 4L))$d_prime == 0,
          score(fixture(0L, 0L))$d_prime == 0,
          score(fixture(0L, 4L))$d_prime < 0)
# Original source uses correctness with swapped old/new labels. Verify its
# recoding is algebraically equivalent to standard hit/false-alarm coding.
correct_rate <- function(x) ifelse(x == 0, 0.125, ifelse(x == 1, 0.875, x))
for (h in 0:4) for (f in 0:4) {
  original <- qnorm(correct_rate((4 - f) / 4)) - qnorm(correct_rate((4 - h) / 4))
  stopifnot(isTRUE(all.equal(score(fixture(h, f))$d_prime, original)))
}
missing <- fixture(4L, 0L)
missing$response[1] <- NA_character_; missing$timed_out[1] <- TRUE
partial <- score(missing)
stopifnot(partial$old_answered == 3L, partial$new_answered == 4L,
          partial$unanswered == 1L, partial$hits == 3L)
missing$response[5:8] <- "null"; missing$timed_out[5:8] <- TRUE
stopifnot(is.na(score(missing)$d_prime))
stopifnot(nrow(score(fixture(4L, 0L)[0, ])) == 0L)
duplicated <- bind_rows(fixture(4L, 0L), fixture(4L, 0L)[1, ])
stopifnot(inherits(try(score(duplicated), silent = TRUE), "try-error"))
set.seed(4)
f <- fixture(3L, 1L)
stopifnot(identical(score(f), score(f[sample(nrow(f)), ])))
x <- c(0.3, 0.8, 1.1, 1.7)
summary <- summarize_memory_dprime(tibble(d_prime = x))
reference <- t.test(x, mu = 0)
stopifnot(summary$N == 4L, summary$df == 3,
  isTRUE(all.equal(summary$t, unname(reference$statistic))),
  isTRUE(all.equal(summary$p, reference$p.value)),
  isTRUE(all.equal(summary$`95% CI lower`, reference$conf.int[1])),
  isTRUE(all.equal(summary$`95% CI upper`, reference$conf.int[2])),
  is.na(summarize_memory_dprime(tibble(d_prime = 1))$p),
  is.na(summarize_memory_dprime(tibble(d_prime = rep(1, 4)))$p),
  summarize_memory_dprime(tibble(d_prime = numeric()))$N == 0L)
cat("PASS: d-prime sign, extreme-rate corrections, all 25 original-code mappings, unanswered and missing trials, duplicate detection, t-test and confidence intervals, empty/constant samples\n")

# Match the source's per-participant denominator even when fewer than four
# pairing questions were presented after the recognition gate.
load_functions("exploratory-rt", "score_associative_accuracy")
associations <- function(id, correct) tibble(participant_id = id,
  task = "associative_memory", memory_id = paste0(id,"-",seq_along(correct)),
  correct = correct)
pair_records <- bind_rows(
  associations("three_presented", c("true", "true", "false")),
  associations("four_correct", rep("true", 4)),
  associations("timeout", "false"), associations("missing", NA_character_))
no_pair <- tibble(participant_id = "no_pairing_records", task = "item_memory",
                 memory_id = "old1", correct = "false")
assoc <- score_associative_accuracy(list(retained = bind_rows(pair_records, no_pair)))
row <- function(id) filter(assoc, participant_id == id)
stopifnot(row("three_presented")$pairing_trials == 3L,
  row("three_presented")$correct_pairings == 2L,
  row("three_presented")$association_accuracy == 0.5,
  row("four_correct")$association_accuracy == 1,
  row("timeout")$association_accuracy == 0,
  row("missing")$association_accuracy == 0,
  !"no_pairing_records" %in% assoc$participant_id)
# Each participant has equal weight in the mean, as in the original summary.
selected <- assoc |> filter(participant_id %in% c("three_presented","four_correct"))
stopifnot(mean(selected$association_accuracy) == 0.75,
  isTRUE(all.equal(sd(selected$association_accuracy), sqrt(0.125))),
  nrow(score_associative_accuracy(list(retained = pair_records[0, ]))) == 0L)
set.seed(8)
stopifnot(identical(assoc,
  score_associative_accuracy(list(retained = bind_rows(pair_records, no_pair)[sample(seq_len(nrow(pair_records) + 1L)), ]))))
cat("PASS: associative accuracy uses four-cue denominator, equal participant weights, source handling of no pairing records, incorrect/missing responses and empty data\n")
