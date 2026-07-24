# Spec-driven AI development process

## 1. Purpose

This process combines docs-as-code, test-first development, architecture decision records, small vertical slices, and evidence-based AI assistance.

AI may accelerate analysis and implementation. It does not waive requirements, review, or verification.

## 2. Work hierarchy

```text
Product outcome
  -> Requirement
    -> Epic
      -> Backlog item
        -> Change specification
          -> Tests
            -> Implementation
              -> Verification evidence
```

## 3. Definition of Ready

A backlog item is Ready only when:

- requirement IDs are identified;
- scope and non-goals are explicit;
- acceptance criteria are executable;
- dependencies and blocking decisions are resolved;
- security and privacy effects are assessed;
- test levels and fixtures are identified;
- rollout and rollback are defined where relevant;
- no unresolved ambiguity can materially change the implementation.

## 4. Delivery workflow

### Step 1: Specify

- Create a change specification.
- Link requirements and backlog IDs.
- Record confirmed facts, assumptions, risks, and open decisions.
- Define acceptance criteria and failure cases.

### Step 2: Decide

- Create or update an ADR for a material architecture choice.
- Compare realistic alternatives, including the simpler baseline.
- Do not implement a proposed ADR as if it were accepted.

### Step 3: Design tests

- Add requirement-to-test rows before production code.
- Write failing acceptance and unit tests.
- Define property, mutation, integration, E2E, and real-device coverage.

### Step 4: Implement a vertical slice

- Keep the change small enough for complete review.
- Separate pure logic from platform and provider adapters.
- Preserve old behavior unless the change specification explicitly replaces it.

### Step 5: Verify

- Run the full applicable quality gate.
- Capture evidence.
- Check coverage and mutation results, not only test counts.
- Validate negative paths and rollback.

### Step 6: Review

- Review requirements, architecture, security, tests, implementation, and evidence.
- AI-generated code receives the same review standard as human-written code.
- Resolve all P0/P1 review findings before merge.

### Step 7: Integrate

- Update traceability and backlog state.
- Merge only when Definition of Done is satisfied.
- Tag release candidates only from a green protected branch.

## 5. Definition of Done

A production backlog item is Done only when:

- acceptance criteria pass;
- all planned automated tests exist and pass;
- structural coverage gates pass;
- mutation gates pass;
- no accepted requirement is left without evidence;
- security/privacy review is complete;
- observability and failure behavior are covered;
- documentation and ADRs match implementation;
- rollback is tested or proven unnecessary with rationale;
- no unresolved P0/P1 defect remains;
- the change is merged through the agreed review path.

Writing code, opening a PR, or reaching 100% line coverage is not Done.

## 6. AI agent operating rules

- Start from repository instructions and canonical documents.
- Do not invent requirements, platform behavior, benchmark results, or test evidence.
- Use primary documentation for platform and provider APIs.
- Prefer focused changes and explicit assumptions.
- Never weaken tests to make an implementation pass.
- Never replace an assertion with a snapshot solely to increase coverage.
- When a test reveals an architecture problem, fix the boundary rather than mock away the behavior.
- Report gaps and failed experiments as evidence.

## 7. Branch and change convention

Suggested branch names:

```text
docs/DOC-001-engineering-baseline
spike/SPIKE-AUDIO-001-electron-capture
feat/MEET-001-session-controller
fix/BUG-001-stop-race
```

Suggested commit format:

```text
<type>(<backlog-id>): <imperative summary>
```

## 8. Reviews and release cadence

- Documentation and spikes may merge independently.
- Runtime changes use small vertical slices.
- A release candidate is cut only after the phase gate passes.
- Daily-use installation uses a stable signed identity to preserve macOS permissions.
- Release notes list accepted behavior, limitations, migrations, and evidence.

## 9. Process health metrics

Use metrics as signals, not targets to game:

- accepted requirement automation rate;
- escaped defects by severity;
- mutation score;
- flaky-test rate;
- median change lead time;
- rollback count;
- p95 capture start/stop latency;
- p95 transcript and suggestion latency;
- real-device matrix pass rate.

