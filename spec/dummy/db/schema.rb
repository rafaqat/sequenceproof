# This file is auto-generated from the current state of the database. Instead
# of editing this file, please use the migrations feature of Active Record to
# incrementally modify your database, and then regenerate this schema definition.
#
# This file is the source Rails uses to define your schema when running `bin/rails
# db:schema:load`. When creating a new database, `bin/rails db:schema:load` tends to
# be faster and is potentially less error prone than running all of your
# migrations from scratch. Old migrations may fail to apply correctly if those
# migrations use external dependencies or application code.
#
# It's strongly recommended that you check this file into your version control system.

ActiveRecord::Schema[7.1].define(version: 2026_08_20_000000) do
  create_table "audit_events", force: :cascade do |t|
    t.string "action", null: false
    t.datetime "created_at", null: false
    t.string "reference"
    t.integer "tenant_id", null: false
    t.datetime "updated_at", null: false
    t.index ["tenant_id"], name: "index_audit_events_on_tenant_id"
  end

  create_table "cart_items", force: :cascade do |t|
    t.datetime "created_at", null: false
    t.integer "product_id", null: false
    t.integer "quantity", default: 0, null: false
    t.datetime "updated_at", null: false
    t.integer "user_id", null: false
    t.index ["product_id"], name: "index_cart_items_on_product_id"
    t.index ["user_id", "product_id"], name: "index_cart_items_on_user_id_and_product_id", unique: true
    t.index ["user_id"], name: "index_cart_items_on_user_id"
  end

  create_table "orders", force: :cascade do |t|
    t.datetime "created_at", null: false
    t.string "idempotency_key", null: false
    t.string "payload_digest", null: false
    t.integer "product_id", null: false
    t.integer "quantity", null: false
    t.string "reference", null: false
    t.string "status", null: false
    t.datetime "updated_at", null: false
    t.integer "user_id", null: false
    t.index ["product_id"], name: "index_orders_on_product_id"
    t.index ["reference"], name: "index_orders_on_reference", unique: true
    t.index ["user_id", "idempotency_key"], name: "index_orders_on_user_id_and_idempotency_key", unique: true
    t.index ["user_id"], name: "index_orders_on_user_id"
  end

  create_table "products", force: :cascade do |t|
    t.datetime "created_at", null: false
    t.string "name", null: false
    t.integer "stock", null: false
    t.integer "tenant_id", null: false
    t.datetime "updated_at", null: false
    t.index ["tenant_id"], name: "index_products_on_tenant_id"
  end

  create_table "tenants", force: :cascade do |t|
    t.datetime "created_at", null: false
    t.string "name", null: false
    t.datetime "updated_at", null: false
  end

  create_table "users", force: :cascade do |t|
    t.datetime "created_at", null: false
    t.string "email", null: false
    t.string "role", null: false
    t.integer "tenant_id", null: false
    t.datetime "updated_at", null: false
    t.index ["email"], name: "index_users_on_email", unique: true
    t.index ["tenant_id"], name: "index_users_on_tenant_id"
  end
end
