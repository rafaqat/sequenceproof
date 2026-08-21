# SequenceProof contributor instructions

SequenceProof is one open-source product with two coordinated artifacts: the `sequenceproof-rails` gem and
the ESM-only `@sequenceproof/core` npm package. Implement and review both sides as a single protocol,
not as independent libraries or as a Rails wrapper around another testing tool.

Before changing behavior, read `docs/specification.md` completely. Treat these files as contracts:

- `docs/public-api.md` freezes public Ruby and TypeScript names and semantics.
- `schemas/*.schema.json` are the canonical Draft 2020-12 wire contracts consumed by both runtimes.
- `test-vectors/` contains shared canonicalization and protocol evidence.
- `docs/decisions.md` records explicit deviations or limits that must not be hidden in code.
- `docs/build-status.md` records observed evidence and must distinguish local, CI, published, and
  release status.

## Product invariants

- Keep `sequenceproof-rails` and `@sequenceproof/core` versions coordinated during 0.x; keep protocol
  compatibility independently versioned.
- Preserve the browser-neutral package root. Node-only filesystem, CLI, and process code belongs
  under `@sequenceproof/core/node`; HTTP protocol code belongs under `@sequenceproof/core/protocol`.
- Keep the Rails Engine test-only, authenticated on every route, bounded, schema-validated, and
  impossible to enable in production.
- Exercise applications through real Rails integration sessions. Do not replace application routes,
  sessions, Active Record, callbacks, or jobs with direct service calls or mocks in integration proof.
- Give every run its own driver, random stream, sessions, stored state, and declared isolation
  boundary. Steps within a run are serialized; only independent runs may execute concurrently.
- Determinism is a compatibility contract. Never use `Math.random`, current time, process ordering,
  or unreported randomness for generation, command selection, replay, or shrinking.
- Replay must validate model identity, manifest digest, reset state, actors, targets, outcomes,
  abstract model state, observations, and property results. A fixed failure is `passed`; changed
  behavior is `replay_diverged`; neither is a reproduced failure.
- Shrink only from a clean reset, accept only the same stable failure identity, preserve an original
  trace, and ensure failure step indices match the corresponding original/minimal trace.
- Treat traces as sensitive. Redact before reporter/artifact materialization, create artifacts
  exclusively with restrictive modes, never place bearer tokens in arguments, and never emit Rails
  object state, cookies, authorization headers, SQL, or backtraces.
- Reject unsafe YAML, unknown protocol/profile members, path traversal, shell interpolation,
  unsupported schema features, invalid identifiers, stale steps, and manifest drift before invoking
  application callbacks.

## Implementation workflow

Follow phases 0 through 6 and their gates in `docs/specification.md`; do not skip ahead because a
scaffold compiles. Preserve the three-generator workflow (`install`, `adapter`, `model`), both RSpec
and Minitest helpers, the reference shopping-cart application, mutation switch, CLI/rake lifecycle,
package smoke tests, and CI matrices.

For a behavior change:

1. Add a test that observes the real invariant, not a source-code proxy.
2. Mutation-check critical security, isolation, replay, schema, and artifact guards by proving the
   named test fails when the defect is restored.
3. Run the smallest relevant tests while iterating, then the aggregate gates below.
4. Update human/API/security/compatibility documentation when the contract or limitation changes.
5. Keep generated YARD and TypeDoc validation free of undocumented exported symbols.

Required local aggregate gates:

```sh
npm run check && npm run lint && npm test && npm run build && npm run docs && npm run package:smoke
bundle exec rspec && bundle exec rubocop --format simple
bundle exec rake docs && bundle exec rake package:smoke
bundle exec brakeman --rails8 -q -p spec/dummy
bundle exec bundler-audit check
npm audit --audit-level=high
```

The reference campaigns run from `spec/dummy` through the Rails lifecycle:

```sh
RAILS_ENV=test SEQUENCEPROOF_SEED=<reported-seed> bundle exec bin/rails 'sequenceproof:check[shopping_cart,smoke]'
RAILS_ENV=test SEQUENCEPROOF_SEED=<reported-seed> bundle exec bin/rails 'sequenceproof:check[shopping_cart,ci]'
RAILS_ENV=test SEQUENCEPROOF_SEED=<reported-seed> bundle exec bin/rails 'sequenceproof:check[shopping_cart,full]'
```

Do not report the `full` profile unless all 2,000 runs at 250 steps complete (500,000 transitions).
On any planted mutation, require exit 2, a smaller replay-confirmed trace, reproduction on mutated
code, and `passed` after restoration.

## Evidence and publication

Never claim a milestone from scaffold or proxy evidence. Mutation-check critical guards. Do not
describe local results as CI or release evidence. A matrix is not green until it ran on an immutable
commit, and a package is not published until the registry confirms it. Do not commit, publish, push,
tag, create an external repository, release, or deploy without explicit user authorization.
