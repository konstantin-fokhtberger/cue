import { describe, expect, it } from 'vitest';

import {
  MacSigningPolicyError,
  buildElectronBuilderSigningArgs,
  parseCodeSigningIdentities,
  parseCodesignDetails,
  selectCodeSigningIdentity,
  validateCodesignDetails,
} from '../src/core/macos-signing-policy.mjs';

const IDENTITY_OUTPUT = `
  1) AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA "Apple Development: Developer One (TEAMONE123)"
  2) BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB "Developer ID Application: Company (TEAMTWO456)"
     2 valid identities found
`;

describe('macOS signing policy', () => {
  it('parses valid code-signing identities without retaining summary noise', () => {
    expect(parseCodeSigningIdentities(IDENTITY_OUTPUT)).toEqual([
      {
        hash: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        name: 'Apple Development: Developer One (TEAMONE123)',
      },
      {
        hash: 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
        name: 'Developer ID Application: Company (TEAMTWO456)',
      },
    ]);
  });

  it('requires the complete security identity line grammar', () => {
    const output = `
noise 1) CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC "Apple Development: Prefixed"
  12) DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD   "Apple Development: Double Digit"
  3)   EEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE     "Apple Development: Spaced"
  4) FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF "Apple Development: Trailing" junk
  5) 1111111111111111111111111111111111111111 "Apple Development: Attached"junk
`;
    expect(parseCodeSigningIdentities(output)).toEqual([
      {
        hash: 'DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD',
        name: 'Apple Development: Double Digit',
      },
      {
        hash: 'EEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE',
        name: 'Apple Development: Spaced',
      },
    ]);
  });

  it('selects the only Apple Development identity automatically', () => {
    expect(selectCodeSigningIdentity(parseCodeSigningIdentities(IDENTITY_OUTPUT))).toEqual({
      hash: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      name: 'Apple Development: Developer One (TEAMONE123)',
    });
    expect(selectCodeSigningIdentity(parseCodeSigningIdentities(IDENTITY_OUTPUT), '')).toEqual({
      hash: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      name: 'Apple Development: Developer One (TEAMONE123)',
    });
  });

  it('honors an explicit identity by exact hash or exact name', () => {
    const identities = parseCodeSigningIdentities(IDENTITY_OUTPUT);
    expect(
      selectCodeSigningIdentity(identities, 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB'),
    ).toEqual(identities[1]);
    expect(
      selectCodeSigningIdentity(identities, 'Developer ID Application: Company (TEAMTWO456)'),
    ).toEqual(identities[1]);
  });

  it('rejects a missing explicit identity', () => {
    expect(() =>
      selectCodeSigningIdentity(parseCodeSigningIdentities(IDENTITY_OUTPUT), 'missing'),
    ).toThrow(
      new MacSigningPolicyError(
        'identity-not-found',
        'The requested code-signing identity is not valid.',
      ),
    );
  });

  it('rejects zero automatic development identities', () => {
    const identities = parseCodeSigningIdentities(`
      1) BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB "Developer ID Application: Company"
    `);
    expect(() => selectCodeSigningIdentity(identities)).toThrow(
      new MacSigningPolicyError(
        'development-identity-missing',
        'No valid Apple Development code-signing identity was found.',
      ),
    );
  });

  it('rejects ambiguous automatic development identities', () => {
    const identities = parseCodeSigningIdentities(`
      1) AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA "Apple Development: One"
      2) BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB "Apple Development: Two"
    `);
    expect(() => selectCodeSigningIdentity(identities)).toThrow(
      new MacSigningPolicyError(
        'development-identity-ambiguous',
        'Several Apple Development identities are valid; set CUE_CODESIGN_IDENTITY explicitly.',
      ),
    );
  });

  it('parses signing metadata and the designated requirement', () => {
    expect(
      parseCodesignDetails(`
Executable=/tmp/cue.app/Contents/MacOS/cue
Identifier=com.cue.overlay
Signature size=4785
Authority=Apple Development: Developer One (TEAMONE123)
TeamIdentifier=TEAMONE123
Info.plist entries=33
designated => identifier "com.cue.overlay" and anchor apple generic and certificate leaf[subject.OU] = TEAMONE123
      `),
    ).toEqual({
      identifier: 'com.cue.overlay',
      teamIdentifier: 'TEAMONE123',
      signature: 'size=4785',
      authority: 'Apple Development: Developer One (TEAMONE123)',
      infoPlistEntries: 33,
      designatedRequirement:
        'identifier "com.cue.overlay" and anchor apple generic and certificate leaf[subject.OU] = TEAMONE123',
    });
  });

  it('trims exact metadata fields and ignores similarly named lines', () => {
    expect(
      parseCodesignDetails(`
NotSignature size=9999
Identifier=  com.cue.overlay
Signature   size=4785
TeamIdentifier=  TEAMONE123
Info.plist entries=  33
not designated => identifier "wrong"
   # designated =>    identifier "com.cue.overlay" and certificate leaf[subject.OU] = TEAMONE123
      `),
    ).toEqual({
      identifier: 'com.cue.overlay',
      teamIdentifier: 'TEAMONE123',
      signature: 'size=4785',
      authority: null,
      infoPlistEntries: 33,
      designatedRequirement:
        'identifier "com.cue.overlay" and certificate leaf[subject.OU] = TEAMONE123',
    });
  });

  it('normalizes missing and ad-hoc signing metadata', () => {
    expect(
      parseCodesignDetails(`
Identifier=com.cue.overlay
Signature=adhoc
TeamIdentifier=not set
      `),
    ).toEqual({
      identifier: 'com.cue.overlay',
      teamIdentifier: null,
      signature: 'adhoc',
      authority: null,
      infoPlistEntries: 0,
      designatedRequirement: null,
    });
    expect(parseCodesignDetails('')).toEqual({
      identifier: null,
      teamIdentifier: null,
      signature: null,
      authority: null,
      infoPlistEntries: 0,
      designatedRequirement: null,
    });
  });

  it('accepts a team-backed local package with the expected identity', () => {
    const details = {
      identifier: 'com.cue.overlay',
      teamIdentifier: 'TEAMONE123',
      signature: 'size=4785',
      authority: 'Apple Development: Developer One',
      infoPlistEntries: 33,
      designatedRequirement:
        'identifier "com.cue.overlay" and certificate leaf[subject.OU] = TEAMONE123',
    };
    expect(
      validateCodesignDetails(details, {
        expectedIdentifier: 'com.cue.overlay',
        requireTeam: true,
      }),
    ).toEqual(details);
  });

  it('accepts an ad-hoc CI package only when team identity is not required', () => {
    const details = {
      identifier: 'com.cue.overlay',
      teamIdentifier: null,
      signature: 'adhoc',
      authority: null,
      infoPlistEntries: 33,
      designatedRequirement: 'cdhash H"0123456789ABCDEF"',
    };
    expect(
      validateCodesignDetails(details, {
        expectedIdentifier: 'com.cue.overlay',
        requireTeam: false,
      }),
    ).toEqual(details);
  });

  it.each([
    [
      {
        identifier: 'Electron',
        teamIdentifier: 'TEAM',
        signature: 'size=1',
        infoPlistEntries: 1,
      },
      'identifier-mismatch',
      'The CodeDirectory identifier does not match the bundle identifier.',
    ],
    [
      {
        identifier: 'com.cue.overlay',
        teamIdentifier: null,
        signature: 'size=1',
        infoPlistEntries: 1,
      },
      'team-identifier-missing',
      'The local package has no TeamIdentifier.',
    ],
    [
      {
        identifier: 'com.cue.overlay',
        teamIdentifier: 'TEAM',
        signature: 'adhoc',
        infoPlistEntries: 1,
      },
      'team-signature-adhoc',
      'The local package is ad-hoc signed instead of team-backed.',
    ],
    [
      {
        identifier: 'com.cue.overlay',
        teamIdentifier: 'TEAM',
        signature: 'size=1',
        infoPlistEntries: 0,
      },
      'info-plist-unbound',
      'Info.plist is not bound into the code signature.',
    ],
    [
      {
        identifier: 'com.cue.overlay',
        teamIdentifier: 'TEAM',
        signature: 'size=1',
        infoPlistEntries: 1,
        designatedRequirement: 'identifier "other.app"',
      },
      'designated-requirement-mismatch',
      'The designated requirement is not stable for the expected application identity.',
    ],
    [
      {
        identifier: 'com.cue.overlay',
        teamIdentifier: 'TEAM',
        signature: 'size=1',
        infoPlistEntries: 1,
        designatedRequirement: null,
      },
      'designated-requirement-mismatch',
      'The designated requirement is not stable for the expected application identity.',
    ],
  ])('rejects invalid signing metadata with %s', (details, code, message) => {
    let error = null;
    try {
      validateCodesignDetails(details, {
        expectedIdentifier: 'com.cue.overlay',
        requireTeam: true,
      });
    } catch (caught) {
      error = caught;
    }
    expect(error).toEqual(new MacSigningPolicyError(code, message));
    expect(error?.name).toBe('MacSigningPolicyError');
  });

  it('requires a designated requirement for an ad-hoc CI package', () => {
    expect(() =>
      validateCodesignDetails(
        {
          identifier: 'com.cue.overlay',
          teamIdentifier: null,
          signature: 'adhoc',
          infoPlistEntries: 1,
          designatedRequirement: null,
        },
        { expectedIdentifier: 'com.cue.overlay', requireTeam: false },
      ),
    ).toThrow(
      new MacSigningPolicyError(
        'designated-requirement-mismatch',
        'The designated requirement is not stable for the expected application identity.',
      ),
    );
  });

  it('parses the hash-prefixed designated requirement emitted for ad-hoc signing', () => {
    expect(parseCodesignDetails('# designated => cdhash H"0123456789ABCDEF"')).toMatchObject({
      designatedRequirement: 'cdhash H"0123456789ABCDEF"',
    });
  });

  it('requires the expected bundle identifier even when the team requirement is present', () => {
    expect(() =>
      validateCodesignDetails(
        {
          identifier: 'com.cue.overlay',
          teamIdentifier: 'TEAM',
          signature: 'size=1',
          infoPlistEntries: 1,
          designatedRequirement: 'anchor apple generic and certificate leaf[subject.OU] = TEAM',
        },
        { expectedIdentifier: 'com.cue.overlay', requireTeam: true },
      ),
    ).toThrow(
      new MacSigningPolicyError(
        'designated-requirement-mismatch',
        'The designated requirement is not stable for the expected application identity.',
      ),
    );
  });

  it('builds an argument-safe Electron packaging plan for team and ad-hoc identities', () => {
    expect(
      buildElectronBuilderSigningArgs('Apple Development: Developer One (TEAMONE123)', 'none'),
    ).toEqual([
      '--dir',
      '-c.mac.identity=Apple Development: Developer One (TEAMONE123)',
      '-c.mac.type=development',
      '-c.mac.timestamp=none',
    ]);
    expect(buildElectronBuilderSigningArgs('-')).toEqual([
      '--dir',
      '-c.mac.identity=-',
      '-c.mac.type=development',
    ]);
  });

  it.each([undefined, null, '', 42])('rejects invalid packaging identity %j', (identity) => {
    expect(() => buildElectronBuilderSigningArgs(identity)).toThrow(
      new MacSigningPolicyError(
        'packaging-identity-missing',
        'A code-signing identity is required for macOS packaging.',
      ),
    );
  });
});
