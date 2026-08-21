# Contributing

Run `bundle exec rspec`, `npm test`, `npm run check`, RuboCop, package smoke checks, and the relevant
SequenceProof campaign before submitting changes. Add behavioral tests and mutation evidence for every
critical guard.

`main` is protected by an active repository ruleset. Changes must use a pull request, resolve all
review threads, and pass every Ruby/Rails, Node, package, campaign, security, and CodeQL job against
the latest base. Force-pushes and deletion of `main` are blocked. The required checks are bound to
the GitHub Actions app; coordinate a ruleset update before renaming a required CI job.
