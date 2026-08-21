# SequenceProof

SequenceProof checks stateful Rails business behaviour against a small TypeScript model. The model
generates deterministic command sequences; a test-only, authenticated Rails Engine executes only
the operations your adapter explicitly registers through real Rails request sessions.

SequenceProof is pre-release software. Neither `sequenceproof-rails` nor `@sequenceproof/core` has been
published. Use a local checkout until the package names and release process are cleared.

## A ten-minute first check

Add the gem only to test and install the package:

```ruby
# Gemfile
group :test do
  gem "sequenceproof-rails", path: "../sequenceproof"
end
```

```sh
bundle install
npm install --save-dev ../sequenceproof/packages/core
bin/rails generate sequenceproof:install --skip-package-install
bin/rails generate sequenceproof:model ShoppingCart add_item
```

Complete the generated TODOs. The two files describe different things and intentionally do not
duplicate one another:

```ts
// sequenceproof/models/shopping_cart.ts
import { assert, defineModel, gen } from "@sequenceproof/core";

type Cart = { stock: number; quantity: number };

export default defineModel<Cart, Cart>()(({ command, postcondition }) => ({
  name: "shopping_cart",
  version: 1,
  initial: ({ observation }) => observation,
  commands: {
    add_item: command<{ quantity: number }>({
      input: gen.record({ quantity: gen.integer({ min: 0, max: 5 }) }),
      actor: "customer",
      enabled: () => true,
      transition: ({ model }, input) => input.quantity > 0 && input.quantity <= model.stock
        ? { stock: model.stock - input.quantity, quantity: model.quantity + input.quantity }
        : model,
      postconditions: [postcondition({
        name: "rails_matches_model",
        check: ({ nextModel, observation }) => assert.deepEqual(observation, nextModel),
      })],
    }),
  },
}));
```

```ruby
# spec/sequenceproof/adapters/shopping_cart_adapter.rb
SequenceProof::Rails.adapter :shopping_cart do
  isolation :transaction, connection_classes: [ApplicationRecord]

  setup do |run|
    run.store(:customer, User.create!(email: "#{run.run_id}@example.test"))
    run.store(:product, Product.create!(name: "Widget", stock: 3))
  end

  actor :customer do
    authenticate do |session, run|
      session.post "/test/sign_in", params: { user_id: run.fetch(:customer).id }
      run.assert_response!(session, :no_content)
    end
  end

  command :add_item,
          actors: [:customer],
          input: SequenceProof::Rails::Schema.object({
            quantity: SequenceProof::Rails::Schema.integer(minimum: 0, maximum: 5)
          }) do |command, input|
    command.post "/cart/items", params: {
      product_id: command.run.fetch(:product).id,
      quantity: input.fetch("quantity")
    }
    command.response.status == 201 ? command.ok(status: 201) :
      command.rejected(code: "cart_refused", value: { status: command.response.status })
  end

  observe schema: SequenceProof::Rails::Schema.object({
    stock: SequenceProof::Rails::Schema.integer(minimum: 0),
    quantity: SequenceProof::Rails::Schema.integer(minimum: 0)
  }) do |run|
    { stock: run.fetch(:product).reload.stock,
      quantity: CartItem.where(user: run.fetch(:customer)).sum(:quantity) }
  end
end
```

Run the generated smoke profile:

```sh
SEQUENCEPROOF_SEED=cart-regression-1 bin/rails 'sequenceproof:check[shopping_cart,smoke]'
```

The task validates configuration, starts the Rails test server on loopback with an ephemeral bearer
token, runs the local CLI, writes mode-`0600` artifacts under `sequenceproof/traces/`, and always stops
the child server. Re-run a failure with:

```sh
bin/rails 'sequenceproof:replay[shopping_cart,sequenceproof/traces/shopping_cart/CAMPAIGN/minimal.trace.json]'
```

## Where it fits

Use SequenceProof when correctness depends on sequences: retries, cancellation, role changes,
cross-tenant access, stale operations, inventory conservation, audit history, or job-driven state.
Use ordinary request tests for fixed examples and system tests for rendering, navigation, and
browser behaviour. SequenceProof does not crawl the DOM and is not an Active Record state machine.

The processes are deliberately separated:

```text
TypeScript model and deterministic runner
    -> authenticated JSON protocol on loopback
    -> Rails Engine
    -> per-actor ActionDispatch session
    -> real route, controller, persistence, observation, invariants
```

`transaction` isolation is fast and safe only when all writes use the declared connections and stay
on the run executor thread. Use `callback` isolation for live-server, multiple-connection, external
worker, or browser-involved systems, and provide a reset that restores a genuinely fresh state.

Seeds reproduce generation, not nondeterministic applications. Replay refuses model/manifest drift
and reports divergence instead of presenting a false minimal proof. Traces may contain application
data; configure JSON-pointer and global redaction, restrict artifact access, and keep retention
short.

## CI

Pull requests should use an immutable commit-derived seed and upload traces even when the campaign
fails:

```yaml
- run: npm ci && npm run build
- run: npm ci --prefix spec/dummy
- working-directory: spec/dummy
  run: bundle exec bin/rails 'sequenceproof:check[shopping_cart,ci]'
  env:
    RAILS_ENV: test
    SEQUENCEPROOF_SEED: "${{ github.sha }}"
```

The repository also defines a scheduled/manual 500,000-transition `full` campaign. Exit `2` means a
property failure; exit `3` means replay divergence.

## Compatibility and contracts

The declared floor is Ruby 3.2, Rails 7.1–8.1, and Node 20+. See
[compatibility](docs/compatibility.md) for the declared CI matrix versus evidence actually observed.
The frozen public surface is in [public-api](docs/public-api.md), the wire contract in
[protocol](docs/protocol.md), and the threat model in [security](docs/security.md).

SequenceProof is not a Bombadil wrapper. Bombadil explores browser/terminal interfaces as a black box;
SequenceProof uses an explicit domain model and Rails-selected observations. They can be complementary.
See [the technical comparison](docs/bombadil-comparison.md).

## Development

```sh
bundle exec rspec
bundle exec rubocop
npm run check
npm run lint
npm test
npm run package:smoke
bundle exec rake package:smoke
```

See [CONTRIBUTING.md](CONTRIBUTING.md) and the current [build evidence](docs/build-status.md).
