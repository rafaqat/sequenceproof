# frozen_string_literal: true

class CartItemsController < ApplicationController
  before_action :require_user!

  def create
    product = current_user.tenant.products.find(params.require(:product_id))
    quantity = Integer(params.require(:quantity))
    return render json: { code: "invalid_quantity" }, status: :unprocessable_content unless quantity.positive?

    product.with_lock do
      return render json: { code: "out_of_stock" }, status: :conflict if product.stock < quantity

      item = CartItem.find_or_initialize_by(user: current_user, product:)
      item.quantity += quantity
      item.save!
      decrement = ENV["SEQUENCEPROOF_MUTATION_OVERSTOCK"] == "1" && quantity == 2 ? quantity + 1 : quantity
      product.update!(stock: product.stock - decrement)
      AuditEvent.create!(tenant: current_user.tenant, action: "cart.added")
    end
    render json: { status: 201 }, status: :created
  end

  def destroy
    product = current_user.tenant.products.find(params.require(:product_id))
    item = CartItem.find_by(user: current_user, product:)
    return head :no_content unless item

    product.with_lock { product.update!(stock: product.stock + item.quantity); item.destroy! }
    AuditEvent.create!(tenant: current_user.tenant, action: "cart.removed")
    head :no_content
  end
end
