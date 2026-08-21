# frozen_string_literal: true

class User < ApplicationRecord
  belongs_to :tenant
  has_many :cart_items, dependent: :destroy
  has_many :orders, dependent: :destroy
end

