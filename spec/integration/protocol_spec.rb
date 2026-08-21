# frozen_string_literal: true

require "rails_helper"

RSpec.describe "SequenceProof protocol", type: :request do
  let(:headers) do
    { "Authorization" => "Bearer #{ENV.fetch('SEQUENCEPROOF_TOKEN')}", "Content-Type" => "application/json" }
  end

  before do
    SequenceProof::Rails.__clear_adapters_for_test!
    SequenceProof::Rails.adapter(:shopping_cart) do
      isolation :transaction, connection_classes: [ApplicationRecord]
      setup do |run|
        tenant = Tenant.create!(name: "tenant-#{run.run_id}")
        user = User.create!(tenant:, email: "#{run.run_id}@example.test", role: "customer")
        admin = User.create!(tenant:, email: "admin-#{run.run_id}@example.test", role: "admin")
        product = Product.create!(tenant:, name: "Widget", stock: 3)
        run.store(:tenant, tenant)
        run.store(:user, user)
        run.store(:admin, admin)
        run.store(:product, product)
      end
      actor :customer do
        authenticate do |session, run|
          session.post "/test/sign_in", params: { user_id: run.fetch(:user).id }
          run.assert_response!(session, :no_content)
        end
      end
      actor :admin do
        authenticate do |session, run|
          session.post "/test/sign_in", params: { user_id: run.fetch(:admin).id }
          run.assert_response!(session, :no_content)
        end
      end
      command :add_item,
              actors: [:customer],
              input: SequenceProof::Rails::Schema.object({
                                                           quantity: SequenceProof::Rails::Schema.integer(minimum: 1,
                                                                                                          maximum: 3)
                                                         }),
              output: SequenceProof::Rails::Schema.object({
                                                            status: SequenceProof::Rails::Schema.integer(minimum: 100,
                                                                                                         maximum: 599)
                                                          }) do |command, input|
        command.post "/cart/items",
                     params: { product_id: command.run.fetch(:product).id, quantity: input.fetch("quantity") }
        if command.response.status == 201
          command.ok(status: 201)
        else
          command.rejected(code: "cart_refused", value: { status: command.response.status })
        end
      end
      command :identity,
              actors: %i[customer admin],
              input: SequenceProof::Rails::Schema.object({}),
              output: SequenceProof::Rails::Schema.object({
                                                            email: SequenceProof::Rails::Schema.string,
                                                            role: SequenceProof::Rails::Schema.string
                                                          }) do |command, _input|
        command.get "/test/session"
        command.ok(command.parsed_json)
      end
      command :explode, actors: [:customer], input: SequenceProof::Rails::Schema.object({}) do |command, _input|
        CartItem.create!(user: command.run.fetch(:user), product: command.run.fetch(:product), quantity: 1)
        raise "deliberate callback failure"
      end
      command :invalid_rejection, actors: [:customer],
                                  input: SequenceProof::Rails::Schema.object({}) do |_command, _input|
        { status: "rejected", code: "NOT A PROTOCOL IDENTIFIER" }
      end
      command :invalid_shape, actors: [:customer], input: SequenceProof::Rails::Schema.object({}) do |_command, _input|
        { status: "ok", value: nil, extra: true }
      end
      observe schema: SequenceProof::Rails::Schema.object({
                                                            quantity: SequenceProof::Rails::Schema.integer(minimum: 0),
                                                            stock: SequenceProof::Rails::Schema.integer(minimum: 0)
                                                          }) do |run|
        { quantity: CartItem.where(user: run.fetch(:user)).sum(:quantity), stock: run.fetch(:product).reload.stock }
      end
      invariant(:conserved) { |_run, observation| observation.fetch("quantity") + observation.fetch("stock") == 3 }
    end
  end

  def json = JSON.parse(response.body)

  def manifest
    get "/__sequenceproof/v1/adapters/shopping_cart/manifest", headers: headers
    expect(response).to have_http_status(:ok)
    json
  end

  def create_run
    post "/__sequenceproof/v1/adapters/shopping_cart/runs", params: JSON.generate(seed: "spec", metadata: {}),
                                                            headers: headers
    expect(response).to have_http_status(:created)
    json
  end

  it "authenticates every engine endpoint including health and manifest" do
    endpoints = [
      [:get, "/__sequenceproof/v1/health"],
      [:get, "/__sequenceproof/v1/adapters/shopping_cart/manifest"],
      [:post, "/__sequenceproof/v1/adapters/shopping_cart/runs"],
      [:get, "/__sequenceproof/v1/runs/run-unknown/observation"],
      [:post, "/__sequenceproof/v1/runs/run-unknown/commands/add_item"],
      [:post, "/__sequenceproof/v1/runs/run-unknown/reset"],
      [:delete, "/__sequenceproof/v1/runs/run-unknown"]
    ]
    endpoints.each do |method, path|
      public_send(method, path, params: "{}", headers: { "Content-Type" => "application/json" })
      expect(response).to have_http_status(:unauthorized), "expected #{method.upcase} #{path} to require authentication"
    end

    get "/__sequenceproof/v1/health", headers: headers
    expect(response).to have_http_status(:ok)
    expect(json).to include("protocol_version" => 1, "status" => "ok")
  end

  it "keeps actor cookie jars isolated across alternating commands" do
    adapter_manifest = manifest
    run = create_run
    path = ->(_step) { "/__sequenceproof/v1/runs/#{run.fetch('run_id')}/commands/identity" }
    identities = [%w[customer customer], %w[admin admin],
                  %w[customer customer]].each_with_index.map do |(actor, role), step|
      post path.call(step), params: JSON.generate(actor:, input: {}, step:,
                                                  manifest_digest: adapter_manifest.fetch("digest")), headers: headers
      expect(response).to have_http_status(:ok)
      [json.dig("outcome", "value", "role"), role]
    end

    expect(identities).to all(satisfy { |actual, expected| actual == expected })
  ensure
    delete "/__sequenceproof/v1/runs/#{run['run_id']}", headers: headers if run
  end

  it "rolls back a callback's database writes when the callback raises" do
    adapter_manifest = manifest
    run = create_run
    post "/__sequenceproof/v1/runs/#{run.fetch('run_id')}/commands/explode",
         params: JSON.generate(actor: "customer", input: {}, step: 0,
                               manifest_digest: adapter_manifest.fetch("digest")), headers: headers
    expect(response).to have_http_status(:internal_server_error)
    expect(json.fetch("detail")).to eq("command execution failed")

    get "/__sequenceproof/v1/runs/#{run.fetch('run_id')}/observation", headers: headers
    expect(json.fetch("observation")).to include("quantity" => 0, "stock" => 3)
  ensure
    delete "/__sequenceproof/v1/runs/#{run['run_id']}", headers: headers if run
  end

  it "executes commands through a real actor session and returns an atomic observation" do
    adapter_manifest = manifest
    run = create_run

    post "/__sequenceproof/v1/runs/#{run.fetch('run_id')}/commands/add_item",
         params: JSON.generate(actor: "customer", input: { quantity: 2 }, step: 0,
                               manifest_digest: adapter_manifest.fetch("digest")), headers: headers

    expect(response).to have_http_status(:ok)
    expect(json.fetch("outcome")).to eq("status" => "ok", "value" => { "status" => 201 })
    expect(json.fetch("observation")).to eq("quantity" => 2, "stock" => 1)
    expect(json.fetch("assertions")).to eq([{ "name" => "conserved", "result" => { "pass" => true } }])
  ensure
    delete "/__sequenceproof/v1/runs/#{run['run_id']}", headers: headers if run
  end

  it "returns an identical result for an identical retry and conflicts on changed input" do
    adapter_manifest = manifest
    run = create_run
    path = "/__sequenceproof/v1/runs/#{run.fetch('run_id')}/commands/add_item"
    body = { actor: "customer", input: { quantity: 1 }, step: 0, manifest_digest: adapter_manifest.fetch("digest") }

    post path, params: JSON.generate(body), headers: headers
    first = json.slice("run_id", "observation", "assertions", "outcome")
    post path, params: JSON.generate(body), headers: headers
    expect(json.slice("run_id", "observation", "assertions", "outcome")).to eq(first)

    post path, params: JSON.generate(body.merge(input: { quantity: 2 })), headers: headers
    expect(response).to have_http_status(:conflict)
    expect(json.fetch("code")).to eq("step_conflict")
  ensure
    delete "/__sequenceproof/v1/runs/#{run['run_id']}", headers: headers if run
  end

  it "rejects invalid input before the command mutates state" do
    adapter_manifest = manifest
    run = create_run

    post "/__sequenceproof/v1/runs/#{run.fetch('run_id')}/commands/add_item",
         params: JSON.generate(actor: "customer", input: { quantity: 99 }, step: 0,
                               manifest_digest: adapter_manifest.fetch("digest")), headers: headers
    expect(response).to have_http_status(:unprocessable_content)

    get "/__sequenceproof/v1/runs/#{run.fetch('run_id')}/observation", headers: headers
    expect(json.fetch("observation")).to eq("quantity" => 0, "stock" => 3)
  ensure
    delete "/__sequenceproof/v1/runs/#{run['run_id']}", headers: headers if run
  end

  it "rejects outcomes that cannot satisfy the shared protocol schema" do
    adapter_manifest = manifest
    run = create_run
    %w[invalid_rejection invalid_shape].each do |command|
      post "/__sequenceproof/v1/runs/#{run.fetch('run_id')}/commands/#{command}",
           params: JSON.generate(actor: "customer", input: {}, step: 0,
                                 manifest_digest: adapter_manifest.fetch("digest")), headers: headers
      expect(response).to have_http_status(:bad_request)
      expect(json.fetch("code")).to eq("invalid_outcome")
    end
  ensure
    delete "/__sequenceproof/v1/runs/#{run['run_id']}", headers: headers if run
  end

  it "rolls transaction state back before reset setup" do
    adapter_manifest = manifest
    run = create_run
    post "/__sequenceproof/v1/runs/#{run.fetch('run_id')}/commands/add_item",
         params: JSON.generate(actor: "customer", input: { quantity: 2 }, step: 0,
                               manifest_digest: adapter_manifest.fetch("digest")), headers: headers

    post "/__sequenceproof/v1/runs/#{run.fetch('run_id')}/reset",
         params: JSON.generate(attempt: 1, reason: "shrink"), headers: headers
    expect(response).to have_http_status(:ok)
    expect(json.fetch("observation")).to eq("quantity" => 0, "stock" => 3)
  ensure
    delete "/__sequenceproof/v1/runs/#{run['run_id']}", headers: headers if run
  end
end
