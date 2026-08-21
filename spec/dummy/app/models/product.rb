# frozen_string_literal: true

class Product < ApplicationRecord
  belongs_to :tenant
  has_many :cart_items, dependent: :destroy
  has_many :orders, dependent: :restrict_with_exception
end

