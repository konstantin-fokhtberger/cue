export class MacSigningPolicyError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'MacSigningPolicyError';
    this.code = code;
  }
}

export function parseCodeSigningIdentities(output) {
  const identities = [];
  const pattern = /^\s*\d+\)\s+([0-9A-F]{40})\s+"([^"]+)"\s*$/gm;
  let match;
  while ((match = pattern.exec(output)) !== null) {
    identities.push({ hash: match[1], name: match[2] });
  }
  return identities;
}

export function selectCodeSigningIdentity(identities, preferredIdentity) {
  if (typeof preferredIdentity === 'string' && preferredIdentity.length > 0) {
    const selected = identities.find(
      (identity) => identity.hash === preferredIdentity || identity.name === preferredIdentity,
    );
    if (!selected) {
      throw new MacSigningPolicyError(
        'identity-not-found',
        'The requested code-signing identity is not valid.',
      );
    }
    return selected;
  }

  const developmentIdentities = identities.filter((identity) =>
    identity.name.startsWith('Apple Development:'),
  );
  if (developmentIdentities.length === 0) {
    throw new MacSigningPolicyError(
      'development-identity-missing',
      'No valid Apple Development code-signing identity was found.',
    );
  }
  if (developmentIdentities.length !== 1) {
    throw new MacSigningPolicyError(
      'development-identity-ambiguous',
      'Several Apple Development identities are valid; set CUE_CODESIGN_IDENTITY explicitly.',
    );
  }
  return developmentIdentities[0];
}

export function parseCodesignDetails(output) {
  const lines = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .map((line) => (line.startsWith('# ') ? line.slice(2) : line));
  const value = (key) => {
    const prefix = `${key}=`;
    const line = lines.find((candidate) => candidate.startsWith(prefix));
    return line ? line.slice(prefix.length).trim() : null;
  };
  const teamIdentifier = value('TeamIdentifier');
  const infoPlistEntries = value('Info.plist entries');
  const signatureLine = lines.find(
    (line) => line.startsWith('Signature=') || line.startsWith('Signature '),
  );
  const signaturePrefixLength = 'Signature='.length;
  const requirementPrefix = 'designated => ';
  const requirementLine = lines.find((line) => line.startsWith(requirementPrefix));
  const normalizedTeamIdentifier = teamIdentifier === 'not set' ? null : teamIdentifier;

  return {
    identifier: value('Identifier'),
    teamIdentifier: normalizedTeamIdentifier,
    signature: signatureLine ? signatureLine.slice(signaturePrefixLength).trim() : null,
    authority: value('Authority'),
    infoPlistEntries: infoPlistEntries === null ? 0 : Number.parseInt(infoPlistEntries, 10),
    designatedRequirement: requirementLine
      ? requirementLine.slice(requirementPrefix.length).trim()
      : null,
  };
}

export function validateCodesignDetails(details, { expectedIdentifier, requireTeam }) {
  if (details.identifier !== expectedIdentifier) {
    throw new MacSigningPolicyError(
      'identifier-mismatch',
      'The CodeDirectory identifier does not match the bundle identifier.',
    );
  }
  if (requireTeam && !details.teamIdentifier) {
    throw new MacSigningPolicyError(
      'team-identifier-missing',
      'The local package has no TeamIdentifier.',
    );
  }
  if (requireTeam && (!details.signature || details.signature.toLowerCase() === 'adhoc')) {
    throw new MacSigningPolicyError(
      'team-signature-adhoc',
      'The local package is ad-hoc signed instead of team-backed.',
    );
  }
  if (!Number.isInteger(details.infoPlistEntries) || details.infoPlistEntries <= 0) {
    throw new MacSigningPolicyError(
      'info-plist-unbound',
      'Info.plist is not bound into the code signature.',
    );
  }
  const expectedRequirement = `identifier "${expectedIdentifier}"`;
  const hasStableLocalRequirement =
    details.designatedRequirement?.includes(expectedRequirement);
  const hasAdhocRequirement = Boolean(details.designatedRequirement);
  if (requireTeam ? !hasStableLocalRequirement : !hasAdhocRequirement) {
    throw new MacSigningPolicyError(
      'designated-requirement-mismatch',
      'The designated requirement is not stable for the expected application identity.',
    );
  }
  return details;
}

export function buildElectronBuilderSigningArgs(identity, timestamp) {
  if (typeof identity !== 'string' || identity.length === 0) {
    throw new MacSigningPolicyError(
      'packaging-identity-missing',
      'A code-signing identity is required for macOS packaging.',
    );
  }
  const args = ['--dir', `-c.mac.identity=${identity}`, '-c.mac.type=development'];
  if (timestamp !== undefined) {
    args.push(`-c.mac.timestamp=${timestamp}`);
  }
  return args;
}

export function buildAdhocBundleSigningArgs(appBundle) {
  if (typeof appBundle !== 'string' || appBundle.length === 0) {
    throw new MacSigningPolicyError(
      'app-bundle-missing',
      'An application bundle path is required for ad-hoc signing.',
    );
  }
  return ['--force', '--deep', '--sign', '-', appBundle];
}
