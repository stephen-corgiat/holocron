# Restrictions have orthogonal lift mechanisms, not a single policy enum

The original design framed Restriction remediability as a three-state policy enum: `auto_expires | child_remediable | parent_only`, mutually exclusive. In practice we want a single Restriction to support multiple lift paths at once — most commonly "child can complete a remediation goal to lift early, OR wait it out as punishment." That doesn't fit a three-way enum.

We model lift mechanisms as **two orthogonal dimensions** carried by each Cause:

- **Auto-expiry**: a contributed duration (or "none — parent-only on this dimension").
- **Remediation goals**: a contributed list of GoalIds (or "none — parent-only on this dimension").

A Restriction's effective auto-expiry is the **MAX** across its Causes — or absent if any Cause specifies parent-only-on-expiry. Its effective remediation options are the **UNION** of Cause-contributed goal lists — or empty if any Cause specifies parent-only-on-remediation. This is "most-restrictive wins, per dimension, independently" — a strict generalization of D8's "longer-duration absorbs shorter."

A Restriction with no effective auto-expiry *and* no effective remediation options is "parent-only" in effect; that's now an emergent state, not a stored enum value. AdminCauses (from "Block now") always contribute parent-only-on-both-dimensions, which is what gives the admin override its bite. The bonus: Late completion of a single causing Miss removes just *that* Cause and recomputes — preserving the other Causes' protection.
