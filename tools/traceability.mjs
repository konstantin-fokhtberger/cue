const requirementIdPattern = /^(?:FR|NFR)-[A-Z]+-\d{3}$/;
const acceptedPriorities = new Set(['P0', 'P1']);
const traceabilityStatuses = new Set(['planned', 'verified']);

export function parseMarkdownTableRows(markdown) {
  return markdown
    .split('\n')
    .filter((line) => line.trim().startsWith('|'))
    .map((line) => {
      const trimmedLine = line.trim();
      const row = trimmedLine.endsWith('|') ? trimmedLine.slice(1, -1) : trimmedLine.slice(1);
      return row.split('|').map((cell) => cell.trim());
    });
}

export function markdownSection(markdown, heading) {
  const startMarker = `## ${heading}`;
  const start = markdown.indexOf(startMarker);
  if (start === -1) {
    return '';
  }

  const contentStart = start + startMarker.length;
  const nextHeading = markdown.indexOf('\n## ', contentStart);
  return markdown.slice(contentStart, nextHeading === -1 ? undefined : nextHeading);
}

function findDuplicates(values) {
  const seen = new Set();
  const duplicates = new Set();
  for (const value of values) {
    if (seen.has(value)) {
      duplicates.add(value);
    }
    seen.add(value);
  }
  return [...duplicates].sort();
}

export function acceptedRequirementIds(requirementsMarkdown) {
  return parseMarkdownTableRows(requirementsMarkdown)
    .filter(
      ([id, priority, status]) =>
        requirementIdPattern.test(id) && acceptedPriorities.has(priority) && status === 'accepted',
    )
    .map(([id]) => id)
    .sort();
}

function allAcceptedRequirementIds(requirementsMarkdown) {
  return parseMarkdownTableRows(requirementsMarkdown)
    .filter(([id, _priority, status]) => requirementIdPattern.test(id) && status === 'accepted')
    .map(([id]) => id);
}

export function traceabilityEntries(traceabilityMarkdown) {
  return parseMarkdownTableRows(markdownSection(traceabilityMarkdown, 'Initial matrix'))
    .filter(([id]) => requirementIdPattern.test(id))
    .map(([id, backlog, evidence, status]) => ({ id, backlog, evidence, status }));
}

export function validateTraceability(requirementsMarkdown, traceabilityMarkdown) {
  const requirements = acceptedRequirementIds(requirementsMarkdown);
  const allAcceptedRequirements = allAcceptedRequirementIds(requirementsMarkdown);
  const entries = traceabilityEntries(traceabilityMarkdown);
  const traceabilityIds = entries.map(({ id }) => id);
  const acceptedRequirementSet = new Set(allAcceptedRequirements);
  const traceabilitySet = new Set(traceabilityIds);
  const errors = [];

  for (const id of findDuplicates(requirements)) {
    errors.push(`Duplicate accepted requirement: ${id}`);
  }
  for (const id of findDuplicates(traceabilityIds)) {
    errors.push(`Duplicate traceability entry: ${id}`);
  }
  for (const id of requirements) {
    if (!traceabilitySet.has(id)) {
      errors.push(`Missing traceability entry: ${id}`);
    }
  }
  for (const { id, backlog, evidence, status } of entries) {
    if (!acceptedRequirementSet.has(id)) {
      errors.push(`Traceability entry has no accepted requirement: ${id}`);
    }
    if (!backlog) {
      errors.push(`Traceability entry has no backlog item: ${id}`);
    }
    if (!evidence) {
      errors.push(`Traceability entry has no automated evidence ID: ${id}`);
    }
    if (!traceabilityStatuses.has(status)) {
      errors.push(`Traceability entry has invalid status "${status}": ${id}`);
    }
  }

  return {
    acceptedRequirementCount: requirements.length,
    traceabilityEntryCount: entries.length,
    errors,
  };
}
