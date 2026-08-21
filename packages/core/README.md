# `@sequenceproof/core`

Environment-neutral deterministic model runner for SequenceProof. The root import provides models,
generators, assertions, running, checking, replay, traces, and reporters. HTTP protocol support is
under `@sequenceproof/core/protocol`; filesystem and trace-file helpers are under
`@sequenceproof/core/node`.

```ts
import { assert, defineModel, gen, run } from "@sequenceproof/core";
```

The package is ESM-only, requires Node 20 or newer for Node-specific subpaths, and keeps the root
entrypoint browser-bundleable. It has not yet been published. See the repository README and
`docs/public-api.md` for the coordinated Rails workflow and frozen 0.1 API.
