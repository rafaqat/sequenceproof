# Compatibility

Declared support for 0.1:

- Ruby 3.2 and newer;
- Rails 7.1, 7.2, 8.0, and 8.1 (`< 9.0`);
- Node 20 and newer;
- ESM package consumers;
- Linux and macOS development/generator/package workflows.

The CI matrix declares Ruby 3.2/Rails 7.1, Ruby 3.3/Rails 7.2, Ruby 3.4/Rails 8.0 and 8.1, and Ruby
4.0/Rails 8.1. Node runs on 20, 22, and 24. Package and generator smokes run on Ubuntu and macOS.

Current local evidence is narrower: Ruby 3.3.9, Rails 8.1.3.1, Node 25.2.1, npm 11.6.2, and macOS.
The declared matrix is not confirmed until GitHub CI runs on an immutable commit. Windows is not a
declared 0.1 generator/runtime target, although the npm API avoids unnecessary POSIX assumptions.

Transaction isolation requires connection APIs available in the supported Active Record versions.
SQLite is used by the reference application; adapters using multiple databases, external workers,
or cross-thread writes should use callback isolation and prove their own reset semantics.
