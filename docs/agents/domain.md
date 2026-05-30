# Domain docs (for agents)

How to consume the project's domain documentation when working in this repo.

## Read before exploring

- **[GLOSSARY.md](../../GLOSSARY.md)** at the repo root — vocabulary.
- **[docs/adr/](../adr/)** — read ADRs that touch the area you're about to work in.
- **[docs/engines/](../engines/)** — mechanism reference for the runtime subsystem you're touching.

## Use the glossary's vocabulary

Output that names a domain concept (refactor proposals, hypotheses, test names, commit messages) must use the term as defined in [GLOSSARY.md](../../GLOSSARY.md). Do not drift to synonyms the glossary explicitly avoids.

Schema and API names use neutral role-language — `user`, `is_admin`, `is_restrictable`, `trackee`. **Never** `parent_*` / `child_*` / `kid_*`.

If the concept isn't in the glossary yet, either the language is invented (reconsider) or there's a real gap (add it to the glossary in the same change).

## Flag ADR conflicts

If output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR-0006 (per-scope enforcement dispatch) — but worth reopening because…_
