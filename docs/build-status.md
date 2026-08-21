# Build status

Evidence below distinguishes local checks from the first immutable draft-PR run on 2026-08-21.
Neither category is merged, published, or release evidence. The corrected remediation commit has not
yet run in CI.

## Observed green

- Ruby: `bundle exec rspec` — 49 examples, 0 failures; request, security, executor, registry,
  generators, schema, shared protocol, reload, task, and test-helper behavior.
- Rails compatibility: the complete 49-example suite passes locally against Rails 7.1, 7.2, 8.0,
  and 8.1 under Ruby 3.3.9. The GitHub Ruby-version matrix remains the authoritative cross-Ruby
  evidence.
- Ruby style: `bundle exec rubocop --format simple` — 47 files, 0 offenses.
- TypeScript: `npm run check`, `npm run lint`, `npm test`, and `npm run build` — 9 test files and
  45 tests at the latest combined gate.
- Browser-neutral root: esbuild bundles the root entry for `platform: browser` without Node built-ins.
- Package artifacts: `npm run package:smoke` installs the real tarball in an empty fixture, imports
  root/protocol/node, rejects an internal subpath, checks executable/version/content; `bundle exec
  rake package:smoke` builds, inspects, installs, and boots the real gem from an isolated gem home.
  The observed renamed artifacts are `sequenceproof-core-0.1.0.tgz` and `sequenceproof-rails.gem`.
- Security: Brakeman 8.0.6 in forced Rails 8 mode reports 0 warnings on the intentionally
  Gemfile-less dummy. Its text report still displays the fallback label `Rails Version: 4.x`, but
  the command explicitly enables its Rails 8 parser; ruby-advisory-db at
  `2faad0ccdfa19c7c57f965b90af99dd774eb0085` reports no vulnerable gems; `npm audit
  --audit-level=high` reports 0 vulnerabilities; Gitleaks 8.30.1 scanned 4.88 MB of current source
  and found no leaks.
- Renamed smoke seed `shopping-cart-rename-smoke-v1`: correct code passed 10 runs, 25 steps each,
  for 250 transitions through the `sequenceproof:check` Rails task and `/__sequenceproof` Engine.
- Renamed mutation seed `shopping-cart-rename-regression-v1`: the planted overstock defect exited
  2, failed after 22 original steps, and shrank to 1 step in 9 attempts. The one-step trace replayed
  as `failed` with the mutation and `passed` after restoration; failure indices 21 and 0 match the
  original and minimal trace lengths. Its artifact directory is mode 0700 and files are mode 0600,
  with all three recorded artifact digests matching their observed SHA-256 values.
- Renamed CI seed `shopping-cart-rename-ci-v1`: 250 runs, 100 steps each, concurrency 2, and 25,000
  total transitions passed. Artifact directory
  `1787280979218-7eac61f2-4aa0-484d-a9ed-b8bb6372c8f8-shopping-cart-rename-ci-v1` is mode 0700;
  summary and JUnit are mode 0600, and the recorded JUnit digest matches the observed
  `31c41c7e16c0346005ea0118025989cc05c38be51ff8e138b749868dab9857d5`.
- Fresh-database remediation seed `pr-findings-fresh-db-v1`: a new SQLite database was prepared via
  `sequenceproof:ephemeral_token db:prepare`, after which 250 runs at 100 steps completed with
  25,000 transitions, 250 passed, and 0 failed. The same fresh database without preparation was
  independently reproduced as an HTTP 500 at step 0.
- Renamed full seed `shopping-cart-sequenceproof-full-v1`: 2,000 runs, 250 steps each, concurrency
  4, and 500,000 total transitions passed. Artifact directory
  `1787282737033-20f3d23a-66aa-48ff-af98-cf725b9de70b-shopping-cart-sequenceproof-full-v1` is mode
  0700; summary and JUnit are mode 0600. The summary records `sequenceproof_rails_version` 0.1.0,
  manifest digest `17ee94da52b275b45382d0d1980ba920c8f497d1b576a6d3c01f712ff3636b68`,
  profile digest `de90a452cd7a455a15db0727bba816f02d6df484338561c08c2889ba7412418d`,
  and a JUnit digest matching the observed
  `87400ca8a04cb9bea2f67625a35ac618d4525e3a28bd6c959a8830c76b6a0968`.
- TypeDoc completes with undocumented-export validation enabled; YARD reports 100% documented
  Ruby objects.

## Immutable draft-PR evidence

Draft PR #1 first ran at head `3851f74310e561543825079a7a4be1aa535c17b8`. Node 20, 22, and 24;
package/generator jobs on Ubuntu and macOS; dependency and secret security gates; and both configured
CodeQL language analyses passed. It was not a green run:

- Rails 7.1, 7.2, and 8.0 rejected the dummy's Rails 8.1 application defaults; Rails 8.1 reached the
  generator compile test but lacked npm-installed TypeScript. The schema and migration also used an
  8.1 format that a subsequent local Rails 7.1 run proved incompatible.
- The reference campaign had no prepared database and returned HTTP 500 at step 0.
- GitHub's CodeQL policy check reported an exponential-backtracking JSON Pointer regex and weakened
  CSRF protection in the dummy controller.

Those findings are fixed and locally verified in the working tree described above. They remain
unverified on an immutable corrected SHA until the PR reruns.

## Not yet observed

- A fully green GitHub matrix and CodeQL policy result on the corrected remediation SHA.
- npm is not authenticated on this machine, so control of the `@sequenceproof` scope is not proven.
- Private vulnerability reporting is currently disabled for the public repository, so the intended
  confidential Security Advisory intake is not yet available.
- No registry ownership, trademark/legal clearance, trusted publishing, tag, package publication,
  release, merge, or deployment has been performed.

The implementation is not release-signed-off until the exact committed artifact passes CI matrices
and the remaining release boundaries are resolved.
