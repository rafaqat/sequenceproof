# Security and threat model

The Rails Engine is a privileged test backdoor. Adapter code has the same authority as the Rails
test process. Never mount it on a shared or production application.

| Threat | Control | Residual responsibility |
|---|---|---|
| Accidental production enablement | Production boot aborts; test-only defaults | Keep production config and secrets separate |
| Unauthenticated discovery/execution | Every endpoint, including health/manifest, requires a 32-byte bearer token compared in constant time | Protect process environment and CI logs |
| Malicious command input | Strict JSON bodies, size limits, closed schemas, identifiers, allow-listed callbacks | Adapter callbacks remain trusted code |
| Cross-run/session access | Random server run IDs, bounded registry, per-run runtime lock, per-actor cookie jars | Callback reset must scope records correctly |
| Stale or changed retry | Monotonic steps plus payload fingerprint and manifest digest | Application idempotency remains a domain property |
| Callback exception or timeout | Nested savepoint, dedicated executor, generic response, cleanup in ensure | External side effects cannot be rolled back automatically |
| Denial of service | Request/command timeouts, body/step/run bounds, TTL expiry | Do not expose the listener beyond loopback |
| Trace PII or secrets | Adapter JSON pointers, global redactor, token redaction, exclusive mode-0600 writes | Return only stable minimal observations; restrict CI artifacts |
| Unsafe profile/model loading | Safe YAML, bounded values, TS typecheck, no eval/constantize/client Ruby | Models and adapters are repository-trusted source |
| Compromised release | lockfiles, content smokes, audits, CodeQL, secret scan, manual validation workflow | Registry ownership, legal clearance, MFA, and trusted publishing are not configured yet |

The client permits `http://` only for `127.0.0.1`, `localhost`, and `::1`; remote endpoints require
TLS. Custom headers cannot override authorization. The controller logs exception classes only by
default, and notification payloads contain identifiers/status/duration—not inputs, observations,
cookies, SQL, or stored Ruby objects.

Use `redact "/path"` in adapters and configure a recursive global redactor for organization-wide
secrets. Test redaction with canaries in successful values and failures. Artifact directories are
sensitive test output even after redaction.

Report vulnerabilities privately as described in the root `SECURITY.md`. No public reporting or
package release should happen until a working private channel is established.
