import { describe, expect, it } from 'vitest';

import {
  acceptedRequirementIds,
  markdownSection,
  parseMarkdownTableRows,
  traceabilityEntries,
  validateTraceability,
} from '../tools/traceability.mjs';

const requirements = `
## Functional requirements

| ID | Priority | Status | Requirement |
| --- | --- | --- | --- |
| FR-AUDIO-001 | P0 | accepted | Capture microphone |
| FR-AUDIO-002 | P1 | accepted | Capture system audio |
| FR-AUDIO-003 | P2 | accepted | Optional behavior |
| FR-AUDIO-004 | P0 | proposed | Not accepted yet |
| XFR-AUDIO-005 | P0 | accepted | Invalid prefix |
| FR-AUDIO-006X | P0 | accepted | Invalid suffix |
`;

const traceability = `
## Initial matrix

| Requirement | Backlog | Planned automated evidence | Status |
| --- | --- | --- | --- |
| FR-AUDIO-001 | AUDIO-001 | CT-AUDIO-001 | planned |
| FR-AUDIO-002 | AUDIO-002 | CT-AUDIO-002 | verified |
| FR-AUDIO-003 | AUDIO-003 | CT-AUDIO-003 | planned |

## Implemented quality controls

| Requirement | Change | Executable evidence | Status |
| --- | --- | --- | --- |
| NFR-TEST-001 | TOOL-001 | npm test | verified |
`;

describe('traceability policy', () => {
  it('parses trimmed table rows with or without a trailing delimiter and ignores prose', () => {
    expect(
      parseMarkdownTableRows(`
not a table
  | A | B |
X| C | D |
| E | F`),
    ).toEqual([
      ['A', 'B'],
      ['E', 'F'],
    ]);
  });

  it('extracts an exact named section', () => {
    const markdown = `
## Earlier
earlier
## Initial matrix
matrix
## Later
later`;

    expect(markdownSection(markdown, 'Initial matrix')).toBe('\nmatrix');
    expect(markdownSection(markdown, 'Absent')).toBe('');
  });

  it('selects only accepted P0 and P1 requirements', () => {
    const reordered = requirements.replace('FR-AUDIO-001', 'FR-AUDIO-009');
    expect(acceptedRequirementIds(reordered)).toEqual(['FR-AUDIO-002', 'FR-AUDIO-009']);
  });

  it('reads only the initial traceability matrix', () => {
    expect(traceabilityEntries(traceability)).toEqual([
      {
        id: 'FR-AUDIO-001',
        backlog: 'AUDIO-001',
        evidence: 'CT-AUDIO-001',
        status: 'planned',
      },
      {
        id: 'FR-AUDIO-002',
        backlog: 'AUDIO-002',
        evidence: 'CT-AUDIO-002',
        status: 'verified',
      },
      {
        id: 'FR-AUDIO-003',
        backlog: 'AUDIO-003',
        evidence: 'CT-AUDIO-003',
        status: 'planned',
      },
    ]);
  });

  it('accepts a complete matrix', () => {
    expect(validateTraceability(requirements, traceability)).toEqual({
      acceptedRequirementCount: 2,
      traceabilityEntryCount: 3,
      errors: [],
    });
  });

  it('reports missing, duplicate, extra, incomplete, and invalid entries', () => {
    const invalidRequirements = `${requirements}
| FR-AUDIO-001 | P0 | accepted | Duplicate |
| NFR-TEST-001 | P0 | accepted | Missing from matrix |
`;
    const invalidTraceability = `
## Initial matrix

| Requirement | Backlog | Planned automated evidence | Status |
| --- | --- | --- | --- |
| FR-AUDIO-001 | AUDIO-001 | CT-AUDIO-001 | planned |
| FR-AUDIO-001 | | | unknown |
| FR-AUDIO-002 | AUDIO-002 | CT-AUDIO-002 | verified |
| FR-AUDIO-999 | AUDIO-999 | CT-AUDIO-999 | planned |
| FR-AUDIO-004 | AUDIO-004 | CT-AUDIO-004 | planned |
`;

    expect(validateTraceability(invalidRequirements, invalidTraceability).errors).toEqual([
      'Duplicate accepted requirement: FR-AUDIO-001',
      'Duplicate traceability entry: FR-AUDIO-001',
      'Missing traceability entry: NFR-TEST-001',
      'Traceability entry has no backlog item: FR-AUDIO-001',
      'Traceability entry has no automated evidence ID: FR-AUDIO-001',
      'Traceability entry has invalid status "unknown": FR-AUDIO-001',
      'Traceability entry has no accepted requirement: FR-AUDIO-999',
      'Traceability entry has no accepted requirement: FR-AUDIO-004',
    ]);
  });

  it('returns no matrix entries when the required section is absent', () => {
    expect(
      traceabilityEntries(`
## Other matrix
| Requirement | Backlog | Planned automated evidence | Status |
| --- | --- | --- | --- |
| FR-AUDIO-001 | AUDIO-001 | CT-AUDIO-001 | planned |`),
    ).toEqual([]);
  });

  it('reads a final section that reaches end of file', () => {
    const finalSection = `
## Initial matrix
| Requirement | Backlog | Planned automated evidence | Status |
| --- | --- | --- | --- |
| FR-AUDIO-001 | AUDIO-001 | CT-AUDIO-001 | planned |`;

    expect(markdownSection(finalSection, 'Initial matrix')).toBe(`
| Requirement | Backlog | Planned automated evidence | Status |
| --- | --- | --- | --- |
| FR-AUDIO-001 | AUDIO-001 | CT-AUDIO-001 | planned |`);
    expect(traceabilityEntries(finalSection)).toHaveLength(1);
  });

  it('sorts multiple duplicate requirement errors deterministically', () => {
    const duplicateRequirements = `
| ID | Priority | Status |
| --- | --- | --- |
| NFR-TEST-002 | P0 | accepted |
| NFR-TEST-001 | P0 | accepted |
| NFR-TEST-002 | P0 | accepted |
| NFR-TEST-001 | P0 | accepted |
`;
    const duplicateTraceability = `
## Initial matrix
| Requirement | Backlog | Planned automated evidence | Status |
| --- | --- | --- | --- |
| NFR-TEST-001 | TOOL-001 | CI-001 | planned |
| NFR-TEST-002 | TOOL-001 | CI-002 | planned |
`;

    expect(
      validateTraceability(duplicateRequirements, duplicateTraceability).errors.slice(0, 2),
    ).toEqual([
      'Duplicate accepted requirement: NFR-TEST-001',
      'Duplicate accepted requirement: NFR-TEST-002',
    ]);
  });

  it('sorts multiple duplicate traceability errors deterministically', () => {
    const uniqueRequirements = `
| ID | Priority | Status |
| --- | --- | --- |
| NFR-TEST-001 | P0 | accepted |
| NFR-TEST-002 | P0 | accepted |
`;
    const duplicateTraceability = `
## Initial matrix
| Requirement | Backlog | Planned automated evidence | Status |
| --- | --- | --- | --- |
| NFR-TEST-002 | TOOL-001 | CI-002 | planned |
| NFR-TEST-001 | TOOL-001 | CI-001 | planned |
| NFR-TEST-002 | TOOL-001 | CI-002 | planned |
| NFR-TEST-001 | TOOL-001 | CI-001 | planned |
`;

    expect(
      validateTraceability(uniqueRequirements, duplicateTraceability).errors.slice(0, 2),
    ).toEqual([
      'Duplicate traceability entry: NFR-TEST-001',
      'Duplicate traceability entry: NFR-TEST-002',
    ]);
  });
});
