# cue engineering documentation

This directory is the canonical engineering baseline for the personalized macOS version of cue.

## Document map

| Area | Document | Purpose |
|---|---|---|
| Product | [PRD](product/PRD.md) | Product goals, scope, users, outcomes, and release boundaries |
| Requirements | [Requirements](product/REQUIREMENTS.md) | Identified functional and non-functional requirements |
| Architecture | [Architecture](architecture/ARCHITECTURE.md) | Target boundaries, components, data flows, and failure model |
| Decisions | [ADR index](architecture/decisions/README.md) | Accepted and pending architecture decisions |
| Quality | [Quality strategy](quality/QUALITY_STRATEGY.md) | Test model, coverage policy, mutation testing, and release gates |
| Process | [Development process](process/DEVELOPMENT_PROCESS.md) | Spec-driven AI development workflow and Definition of Done |
| Roadmap | [Roadmap](planning/ROADMAP.md) | Delivery phases and evidence gates |
| Backlog | [Backlog](planning/BACKLOG.md) | Initial epics and ordered work items |
| Traceability | [Traceability](planning/TRACEABILITY.md) | Requirement, task, test, and evidence mapping |
| Templates | [Change specification](templates/CHANGE_SPEC.md) | Required implementation change record |

## Status vocabulary

- `proposed` - candidate requirement or decision awaiting explicit acceptance.
- `accepted` - approved and binding.
- `in_progress` - currently being implemented.
- `verified` - acceptance evidence exists and quality gates pass.
- `deferred` - intentionally postponed with a reason.
- `rejected` - considered and not selected.

## Baseline rule

No production implementation begins until the corresponding requirement and acceptance criteria are `accepted`, blocking decisions are resolved, and the backlog item satisfies Definition of Ready.

