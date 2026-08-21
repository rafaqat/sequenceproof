# frozen_string_literal: true

Rails.application.config.after_initialize do
  SequenceProof::Rails.adapter :shopping_cart do
  isolation :callback

  setup do |run|
    tenant = Tenant.create!(name: "primary-#{run.run_id}")
    control = Tenant.create!(name: "control-#{run.run_id}")
    customer = User.create!(tenant:, email: "customer-#{run.run_id}@example.test", role: "customer")
    admin = User.create!(tenant:, email: "admin-#{run.run_id}@example.test", role: "admin")
    stranger = User.create!(tenant: control, email: "stranger-#{run.run_id}@example.test", role: "customer")
    product = Product.create!(tenant:, name: "Widget", stock: 5)
    Product.create!(tenant: control, name: "Control", stock: 7)
    run.store(:tenant, tenant)
    run.store(:control, control)
    run.store(:customer, customer)
    run.store(:admin, admin)
    run.store(:stranger, stranger)
    run.store(:product, product)
  end

  remove_run_records = lambda do |run|
    ids = %i[tenant control].filter_map { |key| run.fetch(key).id if run.key?(key) }
    Tenant.where(id: ids).find_each(&:destroy!)
  end
  cleanup(&remove_run_records)
  reset(&remove_run_records)

  actor :customer do
    authenticate do |session, run|
      session.post "/test/sign_in", params: { user_id: run.fetch(:customer).id }
      run.assert_response!(session, :no_content)
    end
  end

  actor :admin do
    authenticate do |session, run|
      session.post "/test/sign_in", params: { user_id: run.fetch(:admin).id }
      run.assert_response!(session, :no_content)
    end
  end

  actor :stranger do
    authenticate do |session, run|
      session.post "/test/sign_in", params: { user_id: run.fetch(:stranger).id }
      run.assert_response!(session, :no_content)
    end
  end

  quantity_schema = SequenceProof::Rails::Schema.object({ quantity: SequenceProof::Rails::Schema.integer(minimum: -1, maximum: 8) })

  command :add_item, actors: [:customer], input: quantity_schema do |command, input|
    command.post "/cart/items", params: { product_id: command.run.fetch(:product).id, quantity: input.fetch("quantity") }
    command.response.status == 201 ? command.ok(status: 201) : command.rejected(code: "cart_refused", value: { status: command.response.status })
  end

  command :remove_item, actors: [:customer], input: SequenceProof::Rails::Schema.object({}) do |command, _input|
    command.delete "/cart/items/#{command.run.fetch(:product).id}"
    command.ok(status: command.response.status)
  end

  checkout_schema = SequenceProof::Rails::Schema.object({ idempotency_key: SequenceProof::Rails::Schema.string(min_length: 1, max_length: 64) })
  %i[checkout retry_checkout].each do |name|
    command name, actors: [:customer], input: checkout_schema do |command, input|
      command.post "/checkout", params: { idempotency_key: input.fetch("idempotency_key") }
      if [200, 201].include?(command.response.status)
        command.ok(order_ref: input.fetch("idempotency_key"), status: command.response.status)
      else
        command.rejected(code: "checkout_refused", value: { status: command.response.status })
      end
    end
  end

  command :cancel_order, actors: [:customer], input: SequenceProof::Rails::Schema.object({}) do |command, _input|
    order = Order.where(user: command.run.fetch(:customer), status: "open").order(:reference).first
    command.post "/orders/#{order&.id || 'missing'}/cancel"
    command.response.status == 200 ? command.ok(status: 200) : command.rejected(code: "cancel_refused", value: { status: command.response.status })
  end

  command :restock, actors: [:admin], input: quantity_schema do |command, input|
    command.post "/admin/products/#{command.run.fetch(:product).id}/restock", params: { quantity: input.fetch("quantity") }
    command.response.status == 200 ? command.ok(status: 200) : command.rejected(code: "restock_refused", value: { status: command.response.status })
  end

  command :restock_as_customer, actors: [:customer], input: quantity_schema do |command, input|
    command.post "/admin/products/#{command.run.fetch(:product).id}/restock", params: { quantity: input.fetch("quantity") }
    command.rejected(code: "forbidden", value: { status: command.response.status })
  end

  command :view_other_tenant_cart, actors: [:customer], input: SequenceProof::Rails::Schema.object({}) do |command, _input|
    command.get "/tenants/#{command.run.fetch(:control).id}/cart"
    command.rejected(code: "cross_tenant_refused", value: { status: command.response.status })
  end

  observation_schema = SequenceProof::Rails::Schema.object({
    stock: SequenceProof::Rails::Schema.integer(minimum: 0),
    cart: SequenceProof::Rails::Schema.integer(minimum: 0),
    orders: SequenceProof::Rails::Schema.array(items: SequenceProof::Rails::Schema.object({
      ref: SequenceProof::Rails::Schema.string,
      quantity: SequenceProof::Rails::Schema.integer(minimum: 1),
      status: SequenceProof::Rails::Schema.enum("open", "cancelled")
    })),
    idempotency: SequenceProof::Rails::Schema.raw({ "type" => "object", "additionalProperties" => { "type" => "string" } }),
    audit: SequenceProof::Rails::Schema.raw({ "type" => "object", "additionalProperties" => { "type" => "integer", "minimum" => 0 } }),
    control_digest: SequenceProof::Rails::Schema.string
  })

  observe schema: observation_schema do |run|
    customer = run.fetch(:customer)
    tenant = run.fetch(:tenant)
    orders = Order.where(user: customer).order(:idempotency_key).map do |order|
      { ref: order.idempotency_key, quantity: order.quantity, status: order.status }
    end
    {
      stock: run.fetch(:product).reload.stock,
      cart: CartItem.where(user: customer).sum(:quantity),
      orders:,
      idempotency: Order.where(user: customer).order(:idempotency_key).to_h do |order|
        [order.idempotency_key, order.idempotency_key]
      end,
      audit: %w[cart.added cart.removed order.created order.cancelled product.restocked].to_h do |action|
        [action, AuditEvent.where(tenant:, action:).count]
      end,
      control_digest: "users=#{run.fetch(:control).users.count};stock=#{run.fetch(:control).products.sum(:stock)};audits=#{run.fetch(:control).audit_events.count}"
    }
  end

  invariant(:nonnegative) { |_run, observation| observation.fetch("stock") >= 0 && observation.fetch("cart") >= 0 }
  invariant(:idempotent_orders) do |_run, observation|
    observation.fetch("idempotency").values.uniq.length == observation.fetch("idempotency").values.length
  end
  invariant(:control_unchanged) { |_run, observation| observation.fetch("control_digest") == "users=1;stock=7;audits=0" }
  end
end
