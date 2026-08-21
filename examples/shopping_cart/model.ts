import { assert, defineModel, gen, type JsonObject, type JsonValue } from "@sequenceproof/core";

type OrderState = { readonly ref: string; readonly quantity: number; readonly status: "open" | "cancelled" };
type AuditState = Readonly<Record<string, number>>;
type CartState = {
  readonly stock: number;
  readonly cart: number;
  readonly orders: readonly OrderState[];
  readonly idempotency: Readonly<Record<string, string>>;
  readonly audit: AuditState;
  readonly control_digest: string;
};

const quantity = gen.record({ quantity: gen.integer({ min: -1, max: 8 }) });
const noInput = gen.record({});
const checkoutInput = gen.record({
  idempotency_key: gen.map(gen.integer({ min: 0, max: 5 }), (value) => `key-${value}`, { description: "idempotency key" }),
});

function audit(model: CartState, action: string): AuditState {
  return { ...model.audit, [action]: (model.audit[action] ?? 0) + 1 };
}

function checkout(model: CartState, key: string): CartState {
  if (model.cart === 0 || model.idempotency[key] !== undefined) return model;
  const order: OrderState = { ref: key, quantity: model.cart, status: "open" };
  return {
    ...model,
    cart: 0,
    orders: [...model.orders, order].sort((left, right) => left.ref.localeCompare(right.ref)),
    idempotency: { ...model.idempotency, [key]: key },
    audit: audit(model, "order.created"),
  };
}

export default defineModel<CartState, CartState>()(({ command, invariant, postcondition }) => {
  const matches = postcondition<JsonObject, JsonValue>({
    name: "rails_matches_model",
    check: ({ nextModel, observation }) => assert.deepEqual(observation, nextModel),
  });

  return {
    name: "shopping_cart",
    version: 1,
    initial: ({ observation }) => observation,
    commands: {
      add_item: command<{ readonly quantity: number }>({
        input: quantity,
        actor: "customer",
        enabled: () => true,
        transition: ({ model }, input) => input.quantity > 0 && input.quantity <= model.stock
          ? { ...model, stock: model.stock - input.quantity, cart: model.cart + input.quantity, audit: audit(model, "cart.added") }
          : model,
        postconditions: [matches],
      }),
      remove_item: command<JsonObject>({
        input: noInput,
        actor: "customer",
        enabled: () => true,
        transition: ({ model }) => model.cart > 0
          ? { ...model, stock: model.stock + model.cart, cart: 0, audit: audit(model, "cart.removed") }
          : model,
        postconditions: [matches],
      }),
      checkout: command<{ readonly idempotency_key: string }>({
        input: checkoutInput,
        actor: "customer",
        enabled: () => true,
        transition: ({ model }, input) => checkout(model, input.idempotency_key),
        postconditions: [matches],
      }),
      retry_checkout: command<{ readonly idempotency_key: string }>({
        input: checkoutInput,
        actor: "customer",
        enabled: () => true,
        transition: ({ model }, input) => checkout(model, input.idempotency_key),
        postconditions: [matches],
      }),
      cancel_order: command<JsonObject>({
        input: noInput,
        actor: "customer",
        enabled: () => true,
        transition: ({ model }) => {
          const open = model.orders.find((order) => order.status === "open");
          if (open === undefined) return model;
          return {
            ...model,
            stock: model.stock + open.quantity,
            orders: model.orders.map((order) => order.ref === open.ref ? { ...order, status: "cancelled" as const } : order),
            audit: audit(model, "order.cancelled"),
          };
        },
        postconditions: [matches],
      }),
      restock: command<{ readonly quantity: number }>({
        input: quantity,
        actor: "admin",
        enabled: () => true,
        transition: ({ model }, input) => input.quantity > 0
          ? { ...model, stock: model.stock + input.quantity, audit: audit(model, "product.restocked") }
          : model,
        postconditions: [matches],
      }),
      restock_as_customer: command<{ readonly quantity: number }>({
        input: quantity,
        actor: "customer",
        enabled: () => true,
        transition: ({ model }) => model,
        postconditions: [matches],
      }),
      view_other_tenant_cart: command<JsonObject>({
        input: noInput,
        actor: "customer",
        enabled: () => true,
        transition: ({ model }) => model,
        postconditions: [matches],
      }),
    },
    invariants: [
      invariant({ name: "nonnegative", check: ({ model }) => assert.ok(model.stock >= 0 && model.cart >= 0) }),
      invariant({
        name: "one_order_per_idempotency_key",
        check: ({ model }) => assert.equal(new Set(Object.values(model.idempotency)).size, Object.values(model.idempotency).length),
      }),
      invariant({ name: "control_tenant_unchanged", check: ({ model }) => assert.equal(model.control_digest, "users=1;stock=7;audits=0") }),
    ],
  };
});

