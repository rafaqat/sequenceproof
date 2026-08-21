# frozen_string_literal: true

class CartItem < ApplicationRecord
  belongs_to :user
  belongs_to :product
end

