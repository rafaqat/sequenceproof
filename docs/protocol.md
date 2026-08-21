# Protocol v1

SequenceProof protocol v1 is authenticated JSON over HTTP. The Rails task binds the server to loopback;
the client rejects non-loopback plain HTTP, endpoint credentials, query strings, fragments, redirects,
short tokens, malformed responses, and invalid manifest digests.

Every request uses `Authorization: Bearer TOKEN`. Every response includes `protocol`,
`protocol_version`, and `request_id`. Canonical schemas live in `schemas/` and are compiled into the
npm package; Ruby and TypeScript validate a shared fixture corpus.

| Method | Route | Purpose |
|---|---|---|
| `GET` | `/v1/health` | Authenticated readiness and version |
| `GET` | `/v1/adapters/:adapter/manifest` | Immutable allow-list and digest |
| `POST` | `/v1/adapters/:adapter/runs` | Create server-selected run ID and initial snapshot |
| `GET` | `/v1/runs/:run_id/observation` | Explicit observation |
| `POST` | `/v1/runs/:run_id/commands/:command_id` | Execute one monotonic step |
| `POST` | `/v1/runs/:run_id/reset` | Clean reset for shrink/replay |
| `DELETE` | `/v1/runs/:run_id` | Cleanup and dispose |

Manifest SHA-256 is computed over RFC 8785 canonical JSON after removing `request_id` and `digest`.
Commands, actors, and invariant identifiers are sorted first. An identical step retry returns the
cached atomic response; changed actor, input, command, or digest conflicts. Expired IDs return 410,
unknown IDs return 404, schema failures return 422, and unexpected callback failures return a
redacted RFC 9457-style problem.

Protocol major compatibility is independent of gem/npm package versions. Replay also verifies the
model identity and manifest digest. A mismatch is divergence, never a reproduced property failure.
