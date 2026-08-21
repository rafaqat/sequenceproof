# Troubleshooting

## The Engine returns 401

All routes require the same 32-byte-or-longer `SEQUENCEPROOF_TOKEN` in the server environment and CLI
token environment. Do not put the token in an endpoint URL or custom header override.

## `sequenceproof:doctor` cannot find the CLI

Run the selected package manager in the Rails application and confirm
`node_modules/.bin/sequenceproof` exists. The task deliberately never downloads through `npx`.

## A profile is rejected

Profiles use version 1, closed keys, bounded integers, and booleans. Aliases, custom YAML tags,
duplicate keys, and malformed profiles that were not selected are also rejected.

## Replay diverges

Confirm the exact model version, adapter manifest digest, seed, application revision, and reset
environment. Nondeterministic time, jobs, external services, database ordering, volatile IDs, and
incomplete callback cleanup are common causes. Divergence is not a reproduction.

## Concurrent runs fail but smoke passes

Look for application-global uniqueness constraints, shared fixture identifiers, shared cookie jars,
SQLite write contention, and callback reset that deletes another run's records. Every run needs
unique persistent records while observations normalize IDs to stable public handles.

## Transaction reset does not remove state

Declare every participating connection class. Writes performed by undeclared databases, other
threads, external workers, or services are outside the outer transaction; use callback isolation.

## Trace contains sensitive values

Reduce the observation first, then add adapter JSON pointers and a global redactor. Delete exposed
CI artifacts and rotate leaked credentials; redaction is not retroactive.
