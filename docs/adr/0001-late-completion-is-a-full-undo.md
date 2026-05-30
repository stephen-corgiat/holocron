# Late completion is a full undo; other remediations only lift the restriction

A Miss fires at `due_time` and posts four effects: a point deduction, a ladder advance, an optional restriction activation, and a streak break. We treat **Late completion** (completing within the task's late window) as a *full undo* of all four: the points are refunded, the ladder advance is retracted, the restriction is lifted, and the streak is preserved. Every other Remediation path (goal-completion, wait-out, admin lift) lifts only the restriction; the point deduction, ladder advance, and streak break persist.

The reasoning: Late completion is "the task got done, just late," not a substitute act. Goal-completion and wait-out are remediations for the *access blockage*, not for the missed task itself — restoring points for "I played Lego instead of cleaning my room" would reward substitution, which isn't the household model we want. Admins who want to be more generous than a wait-out can use the ad-hoc balance-adjustment feature rather than overloading the override path.

The trade-off accepted: a Trackee who late-completes loses only the brief restriction window. The disincentive is the temporary loss of access, not a permanent point cost. Households that want late completion to bite harder would need to disable `allow_late_completion` on the task instead.
