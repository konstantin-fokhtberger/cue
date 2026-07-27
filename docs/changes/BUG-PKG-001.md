# Change specification: BUG-PKG-001 stable target-Mac package identity

## Control

| Field           | Value                                    |
| --------------- | ---------------------------------------- |
| Backlog ID      | BUG-PKG-001                              |
| Requirement IDs | NFR-SEC-003                              |
| Status          | done                                     |
| Owner           | project maintainer                       |
| Target revision | `spike/SPIKE-AUDIO-001-electron-capture` |

## Outcome

Каждая локальная target-Mac сборка cue должна получать воспроизводимую development signing
identity, пригодную для стабильного TCC grant. CI должен отдельно проверять правильный bundle
identifier на ad-hoc пакете без доступа к пользовательскому сертификату.

## Confirmed facts

- `Info.plist` содержит `CFBundleIdentifier=com.cue.overlay`.
- Обычный unsigned electron-builder output ранее имел CodeDirectory identifier `Electron`.
- Ручная ad-hoc переподпись исправила identifier, но оставила `TeamIdentifier` пустым.
- На target Mac доступна одна валидная Apple Development code-signing identity.
- Apple Development подпись предназначена для локальной разработки и не заменяет Developer
  ID Application, hardened runtime, notarization или Gatekeeper acceptance.

## Acceptance criteria

1. Локальный pack не хранит имя сертификата, email, hash или private key в репозитории.
2. При ровно одной Apple Development identity локальный pack выбирает ее автоматически.
3. При нуле или нескольких подходящих identity сборка завершается явной ошибкой, если
   `CUE_CODESIGN_IDENTITY` не разрешает неоднозначность.
4. Готовый bundle имеет `Identifier=com.cue.overlay`.
5. Локальный bundle имеет непустой `TeamIdentifier` и не является ad-hoc.
6. `codesign --verify --deep --strict` проходит.
7. Две последовательные локальные сборки имеют одинаковые Identifier, TeamIdentifier и
   designated requirement.
8. CI ad-hoc package имеет правильный identifier и валидную nested signature, но не
   заявляется как TCC-stable или distribution-ready.

## Test plan

| Level        | Test ID                   | Purpose                                      |
| ------------ | ------------------------- | -------------------------------------------- |
| Unit         | UT-MAC-SIGNING-POLICY-001 | Parse, select, and validate signing identity |
| Mutation     | MT-MAC-SIGNING-POLICY-001 | Assertion strength                           |
| Package CI   | PKG-ADHOC-IDENTITY-001    | Correct ad-hoc bundle identifier             |
| Target Mac   | PKG-TCC-IDENTITY-001      | Stable team-backed designated requirement    |
| Distribution | PKG-GATEKEEPER-001        | Deferred to PKG-001                          |

## Failure modes

- No valid development certificate - fail with remediation, do not fall back silently.
- More than one matching certificate - require explicit `CUE_CODESIGN_IDENTITY`.
- Identifier or TeamIdentifier mismatch - reject the package.
- Nested signature invalid - reject the package.
- CI accidentally claims team-backed identity - reject the claim and keep evidence ad-hoc.

## Rollback

- Restore the previous unsigned `npm run pack`.
- Existing local TCC entries may remain in macOS settings and are not deleted automatically.

## Verification evidence

- Unit/contract: 26 signing-policy tests pass.
- Coverage: full project scope remains at 100% statements, branches, functions, and lines.
- Mutation: 636/636 mutants killed after the final signing-policy revision.
- CI package: ad-hoc bundle passed `codesign --verify --deep --strict`, retained
  `Identifier=com.cue.overlay`, and reported `tccStable=false`.
- Target Mac: two consecutive Apple Development packages passed strict/deep verification and
  produced identical `Identifier`, non-empty `TeamIdentifier`, signature size, and SHA-256
  fingerprint of the complete designated requirement.
- TCC/UI: the packaged app enumerated HyperX SoloCast, built-in, iPhone, and Teams virtual
  inputs after media permission initialization; device selections remained available after
  a full application restart.

## Residual risks and follow-up

- Apple Development signing is valid only for local target-Mac testing. Developer ID,
  hardened-runtime distribution, notarization, and Gatekeeper acceptance remain `PKG-001`.
- Full designated requirement is never printed by the packaging tool because it embeds the
  certificate subject; only a SHA-256 fingerprint is emitted for equality comparison.
