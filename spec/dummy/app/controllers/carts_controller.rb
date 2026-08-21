# frozen_string_literal: true

class CartsController < ApplicationController
  before_action :require_user!

  def show
    return head :not_found unless current_user.tenant_id == params.require(:tenant_id).to_i

    render json: { quantity: current_user.cart_items.sum(:quantity) }
  end
end

