# Independent numerical check of the report's pwr::pwr.t.test calculation.
# Run from the repository root: source("scripts/check-power.R")
# Uses base R's stats::power.t.test, not the report's power function.
original <- jsonlite::fromJSON("writeup/original-exp1-summary.json")
d <- abs((original$unchosen_subject_mean - 0.5) / original$unchosen_subject_sd)
stopifnot(isTRUE(all.equal(d, abs(original$unchosen_cohens_d), tolerance = 1e-10)))
cat("Original participants:", original$unchosen_subject_n, "\n")
cat("Mean participant unchosen NS+ proportion:", original$unchosen_subject_mean, "\n")
cat("SD across participants:", original$unchosen_subject_sd, "\n")
cat("Absolute Cohen d = abs((mean - 0.5) / SD):", d, "\n\n")

checks <- do.call(rbind, lapply(c(0.80, 0.90, 0.95), function(target) {
  base_result <- stats::power.t.test(delta = d, sd = 1, sig.level = 0.05,
    power = target, type = "one.sample", alternative = "two.sided")
  data.frame(power = target, unrounded_N = base_result$n,
             usable_N_rounded_up = ceiling(base_result$n))
}))
print(checks, row.names = FALSE)
stopifnot(identical(as.integer(checks$usable_N_rounded_up), c(118L, 157L, 194L)))
cat("\nBase R independently matches the report's rounded sample sizes.\n")
cat("Planning approximation: one-sample t-test, not direct Bayesian-model power.\n")
