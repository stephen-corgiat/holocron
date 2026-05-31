# Docs

Architecture and engine reference for Holocron. Vocabulary lives in [../GLOSSARY.md](../GLOSSARY.md); decisions live in [adr/](adr/); these docs cover **how the runtime actually works**.

## Where to start

| Question | Read |
| --- | --- |
| How is the codebase laid out? | [architecture/overview.md](architecture/overview.md) |
| What entities exist and how are they related? | [architecture/data-model.md](architecture/data-model.md) |
| How do tablets get realtime updates? | [architecture/realtime.md](architecture/realtime.md) |
| What runs on a schedule? When? | [architecture/scheduling.md](architecture/scheduling.md) |
| When does a Miss fire? | [engines/miss-detection.md](engines/miss-detection.md) |
| How are task occurrences generated? | [engines/recurrence.md](engines/recurrence.md) |
| How is the points ledger kept consistent? | [engines/ledger.md](engines/ledger.md) |
| What happens on pending-review approve/reject? | [engines/pending-review.md](engines/pending-review.md) |
| How are streaks computed? | [engines/streaks.md](engines/streaks.md) |
| How does presence suppression / reconciliation work? | [engines/presence.md](engines/presence.md) |
| How do multiple Restriction causes merge? Which backend enforces which scope? | [engines/restrictions.md](engines/restrictions.md) |
| How do I self-host it? | [deployment.md](deployment.md) |
| How do I run the stack locally? | [development.md](development.md) |
| How are tests structured? | [testing.md](testing.md) |
| How does this thing scale? Where does it stop scaling? | [scaling.md](scaling.md) |
| How is auth wired? | [auth-and-sessions.md](auth-and-sessions.md) |
| How do I configure the Home Assistant + camera home surface? | [home-surface.md](home-surface.md) |

## Layout

```
docs/
├── README.md            this file
├── adr/                 architectural decisions (canonical "why")
├── agents/              conventions for coding agents
├── auth-and-sessions.md JWT + tablet enrollment design
├── architecture/        system-level reference
└── engines/             per-subsystem mechanism reference
```

## Conventions

- Diagrams are Mermaid (rendered inline on GitHub). A small number of ASCII sketches appear where Mermaid is overkill.
- Domain terms use the exact spelling from [../GLOSSARY.md](../GLOSSARY.md) (Trackee, Miss, Cause, Restriction, etc.). Never `parent_*` / `child_*`.
- Code references are `path/to/file.ts:line` so they jump in editors and on GitHub.
- These docs describe HOW; ADRs describe WHY. If an ADR conflicts with a doc here, the ADR wins and the doc must be updated.
