# frozen_string_literal: true

require "digest"

class CheckoutsController < ApplicationController
  before_action :require_user!

  def create
    key = params.require(:idempotency_key)
    existing = Order.find_by(user: current_user, idempotency_key: key)
    if existing
      return render json: { order_ref: existing.reference, status: 200 }, status: :ok
    end
    item = CartItem.find_by(user: current_user)
    return render json: { code: "empty_cart" }, status: :unprocessable_content unless item

    payload_digest = Digest::SHA256.hexdigest("#{item.product_id}:#{item.quantity}")

    reference = "#{current_user.id}-#{key}"
    order = Order.create!(user: current_user, product: item.product, quantity: item.quantity, status: "open",
                          idempotency_key: key, payload_digest:, reference:)
    item.destroy!
    AuditEventJob.perform_later(tenant_id: current_user.tenant_id, action: "order.created", reference: order.reference)
    render json: { order_ref: order.reference, status: 201 }, status: :created
  end
end
