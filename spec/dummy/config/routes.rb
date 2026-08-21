# frozen_string_literal: true

SequenceProofDummy::Application.routes.draw do
  post "/test/sign_in", to: "test_sessions#create"
  get "/test/session", to: "test_sessions#show"
  post "/cart/items", to: "cart_items#create"
  delete "/cart/items/:product_id", to: "cart_items#destroy"
  post "/checkout", to: "checkouts#create"
  post "/orders/:id/cancel", to: "orders#cancel"
  post "/admin/products/:id/restock", to: "admin/products#restock"
  get "/tenants/:tenant_id/cart", to: "carts#show"
end
