# frozen_string_literal: true

class Tenant < ApplicationRecord
  has_many :users, dependent: :destroy
  has_many :products, dependent: :destroy
  has_many :audit_events, dependent: :destroy
end

