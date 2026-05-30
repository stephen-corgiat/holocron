# Pending review defers the Miss; rejection fires it at rejection time

When a Trackee marks a verifiable task done before its deadline, the task enters Pending review and points credit optimistically. While Pending review the task is considered complete for deadline purposes — no Miss can fire, even past `due_time`. If the Admin (or the household-level pending-review timeout) rejects, **the Miss fires at rejection time** with all four effects (Penalty deduction, ladder advance, Restriction activation, streak break), and the optimistic credit is clawed back in the same transaction.

This couples the optimistic-credit and Miss models cleanly: the Trackee is given the benefit of the doubt at mark-done time, and a single rejection event reverses both the credit and any deferred consequences. Timeout-auto-rejection is identical to admin-rejection in effects.

The visible trade-off: a Restriction may activate hours after the original deadline (whenever the rejection lands). We accept that — rejection-time enforcement is less surprising than letting a proven-dishonest mark-done keep access, and the 48h timeout caps how long the deferral can last.
