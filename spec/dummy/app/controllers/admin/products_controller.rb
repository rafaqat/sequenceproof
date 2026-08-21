# frozen_string_literal: true

module Admin
  class ProductsController < ApplicationController
    before_action :require_admin!

    def restock
      product = current_user.tenant.products.find(params.require(:id))
      quantity = Integer(params.require(:quantity))
      return render json: { code: "invalid_quantity" }, status: :unprocessable_content unless quantity.positive?

      product.with_lock { product.update!(stock: product.stock + quantity) }
      AuditEvent.create!(tenant: current_user.tenant, action: "product.restocked")
      render json: { status: 200 }
    end
  end
end

