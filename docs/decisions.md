# Architecture decisions

The core decisions in section 3 of `specification.md` are frozen for 0.1.

## 2026-08-21 — pre-release identity renamed to SequenceProof

The unpublished StateForge working identity collided with several active software products,
including tools in the state-machine category. Before any commit, remote, or registry publication,
the product was renamed atomically to SequenceProof: gem `sequenceproof-rails`, npm package
`@sequenceproof/core`, Ruby namespace `SequenceProof`, and CLI/task/environment prefix
`sequenceproof`/`SEQUENCEPROOF_*`.

Because protocol version 1 was still unpublished, its version metadata and schemas were renamed as
well. Pre-rename traces remain local historical evidence and are not compatible release artifacts.
Read-only registry checks found no exact package or GitHub identity, but this is neither reservation
nor legal clearance; npm scope control and name clearance remain release gates.

## 2026-08-20 — implementation-only command generic

The displayed specification shortens `StateModel` and runner functions to model/observation type
parameters. The implementation carries a third inferred `Commands` generic so each command retains
its input/output types internally. This adds no runtime export and requires no caller annotation.

## 2026-08-20 — schema comparison limit

The frozen TypeScript model API contains generators and decoders but no command or observation JSON
Schema fields. Therefore the core can preflight command targets and statically selected actors
against the Rails manifest, but cannot truthfully compare input/output/observation schemas before a
run. Rails validates inputs and outputs at the protocol boundary. Adding model-side schemas would be
a future public-API decision; 0.1 documentation does not claim this impossible preflight.

## 2026-08-20 — mapped-generator shrinking

`gen.map` has no inverse in the frozen API. Retaining sampled origins inside a shared generator made
shrinking schedule-dependent under concurrent checks, especially for non-injective mappings.
Mapped values therefore do not perform generic input shrinking in 0.1; sequence shrinking still
applies. Domain models should prefer primitive or structured generators, or map inside a command,
when minimal input shrinking matters. A future inverse/shrinker option requires an API decision.

## 2026-08-20 — callback isolation for concurrent reference app

The live-server reference suite uses callback isolation because separate HTTP runs and SQLite
connections cannot share one transaction. Every run owns unique tenant records and cleanup deletes
only those records. Application-visible order references are globally unique; the adapter normalizes
them to stable idempotency handles so replay does not depend on database IDs.

## 2026-08-20 — explicit insecure-HTTP protocol option

The security requirements mandate a CLI `--allow-insecure-http` escape hatch, while the frozen
`ProtocolDriverOptions` listing omitted the corresponding driver capability. The protocol subpath
therefore adds optional `allowInsecureHttp`; it defaults false and affects only non-loopback HTTP.
Credentials, query strings, fragments, and redirects remain forbidden.
