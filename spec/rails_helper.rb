# frozen_string_literal: true

ENV["RAILS_ENV"] = "test"
ENV["SEQUENCEPROOF_TOKEN"] = "test-token-#{'x' * 64}"

require_relative "dummy/config/environment"
require "rspec/rails"

database_file = File.expand_path("dummy/tmp/sequenceproof-dummy.sqlite3", __dir__)
FileUtils.mkdir_p(File.dirname(database_file))

ActiveRecord::Schema.define do
  create_table :tenants, force: true do |table|
    table.string :name, null: false
    table.timestamps
  end
  create_table :users, force: true do |table|
    table.references :tenant, null: false
    table.string :email, null: false
    table.string :role, null: false
    table.timestamps
  end
  add_index :users, :email, unique: true
  create_table :products, force: true do |table|
    table.references :tenant, null: false
    table.string :name, null: false
    table.integer :stock, null: false
    table.timestamps
  end
  create_table :cart_items, force: true do |table|
    table.references :user, null: false
    table.references :product, null: false
    table.integer :quantity, null: false, default: 0
    table.timestamps
  end
  add_index :cart_items, %i[user_id product_id], unique: true
  create_table :orders, force: true do |table|
    table.references :user, null: false
    table.references :product, null: false
    table.integer :quantity, null: false
    table.string :status, null: false
    table.string :idempotency_key, null: false
    table.string :payload_digest, null: false
    table.string :reference, null: false
    table.timestamps
  end
  add_index :orders, %i[user_id idempotency_key], unique: true
  add_index :orders, :reference, unique: true
  create_table :audit_events, force: true do |table|
    table.references :tenant, null: false
    table.string :action, null: false
    table.string :reference
    table.timestamps
  end
end

RSpec.configure do |config|
  config.include RSpec::Rails::RequestExampleGroup, type: :request
end
