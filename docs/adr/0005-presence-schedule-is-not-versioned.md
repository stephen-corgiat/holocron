# Presence schedule is a single mutable record, not versioned

A Trackee's presence schedule (recurring residency rule + epoch + one-off windows) lives in a single mutable record per Trackee. Edits replace the record in place. We do not maintain historical revisions of the schedule, so retroactive reconciliation (per ADR-0003) always evaluates past dates against the *current* schedule — not against whatever was in effect on that historical date.

The trade-off accepted: editing the recurring rule or its `epoch_date` (e.g., swapping a custody pattern mid-year) rewrites history with the new rules. A reconciliation pass refunds/reapplies Miss effects across the affected range; if any reconciliation outcome is wrong, an Admin must correct it manually with ad-hoc balance adjustments and Restriction lifts.

We chose this over versioned schedules because schedule re-shapes are expected to be rare events for this household-scale app, and the cost of a wrong reconciliation in those rare cases (one parent action to fix) is cheaper than carrying a temporal data model. If schedule churn turns out to be more frequent than expected, this can be promoted to versioned without disturbing the cause-log model — add an `effective_from` to the schedule table and resolve "schedule in effect at date D" via the most recent revision before D.
