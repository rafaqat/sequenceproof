# frozen_string_literal: true

class CreateSequenceProofDummySchema < ActiveRecord::Migration[7.1]
  def change
    create_table :tenants do |table|
      table.string :name, null: false
      table.timestamps
    end
    create_table :users do |table|
      table.references :tenant, null: false
      table.string :email, null: false, index: { unique: true }
      table.string :role, null: false
      table.timestamps
    end
    create_table :products do |table|
      table.references :tenant, null: false
      table.string :name, null: false
      table.integer :stock, null: false
      table.timestamps
    end
    create_table :cart_items do |table|
      table.references :user, null: false
      table.references :product, null: false
      table.integer :quantity, null: false, default: 0
      table.timestamps
      table.index %i[user_id product_id], unique: true
    end
    create_table :orders do |table|
      table.references :user, null: false
      table.references :product, null: false
      table.integer :quantity, null: false
      table.string :status, null: false
      table.string :idempotency_key, null: false
      table.string :payload_digest, null: false
      table.string :reference, null: false, index: { unique: true }
      table.timestamps
      table.index %i[user_id idempotency_key], unique: true
    end
    create_table :audit_events do |table|
      table.references :tenant, null: false
      table.string :action, null: false
      table.string :reference
      table.timestamps
    end
  end
end
