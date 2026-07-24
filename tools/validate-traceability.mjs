import { readFile } from 'node:fs/promises';

import { validateTraceability } from './traceability.mjs';

const [requirementsMarkdown, traceabilityMarkdown] = await Promise.all([
  readFile(new URL('../docs/product/REQUIREMENTS.md', import.meta.url), 'utf8'),
  readFile(new URL('../docs/planning/TRACEABILITY.md', import.meta.url), 'utf8'),
]);

const result = validateTraceability(requirementsMarkdown, traceabilityMarkdown);

if (result.errors.length > 0) {
  for (const error of result.errors) {
    console.error(error);
  }
  process.exitCode = 1;
} else {
  console.log(
    `Traceability valid: ${result.acceptedRequirementCount} accepted P0/P1 requirements, ` +
      `${result.traceabilityEntryCount} matrix entries.`,
  );
}
