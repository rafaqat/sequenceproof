# frozen_string_literal: true

class OrdersController < ApplicationController
  before_action :require_user!

  def cancel
    order = current_user.orders.find_by(id: params.require(:id))
    return head :not_found unless order
    return render json: { code: "terminal_order" }, status: :conflict unless order.status == "open"

    order.product.with_lock { order.product.update!(stock: order.product.stock + order.quantity); order.update!(status: "cancelled") }
    AuditEvent.create!(tenant: current_user.tenant, action: "order.cancelled", reference: order.reference)
    render json: { status: 200 }
  end
end
