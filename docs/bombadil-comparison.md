# SequenceProof and Bombadil

SequenceProof exists at a different layer from Bombadil; it does not depend on, fork, embed, or wrap it.

| Concern | Bombadil | SequenceProof |
|---|---|---|
| View of the system | Black-box browser/terminal state | Explicit domain model plus Rails-selected observation |
| Actions | UI/terminal action templates | Schema-validated domain commands through real Rails requests |
| Oracle | Extracted properties and temporal formulas | Model/SUT agreement, postconditions, Rails invariants, authorization outcomes |
| Actors | Browser contexts | Named Rails actors with separate integration sessions |
| Reduction | UI trace replay/reduction | Reset-backed sequence and structured-input shrinking |
| Rails knowledge | None required | Engine, sessions, routes, persistence, jobs, notifications, generators |

The compelling SequenceProof case is a long sequence of legal and illegal business operations:
checkout retry, stale approval, cancellation, role change, cross-tenant access, audit preservation,
and job-driven transition. It can inspect stable persistence projections without exposing arbitrary
SQL or Ruby evaluation.

Bombadil remains better suited to exploratory UI/terminal behaviour, DOM state, and temporal user
journeys. A product can use both: fixed browser E2E for reachability, Bombadil for black-box
exploration, and SequenceProof for explicit stateful domain contracts. Any future bridge should be a
separate optional package so neither core API gains the other's framework types.

This comparison should be rechecked against Bombadil's current README, manual, and release notes
before publication because Bombadil is an active 0.x project.
