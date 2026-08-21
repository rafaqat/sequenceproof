# frozen_string_literal: true

require "rails_helper"
require "open3"
require "tmpdir"

RSpec.describe "SequenceProof security boundaries", type: :request do
  let(:token) { ENV.fetch("SEQUENCEPROOF_TOKEN") }
  let(:headers) { { "Authorization" => "Bearer #{token}", "Content-Type" => "application/json" } }

  def json = JSON.parse(response.body)

  it "loads defaults supported by the active Rails version" do
    expected_version = Rails.gem_version.segments.first(2).join(".").to_f

    expect(SequenceProofDummy::Application.config.loaded_config_version).to eq(expected_version)
  end

  it "does not weaken the host controller CSRF strategy" do
    expect(ApplicationController.forgery_protection_strategy)
      .to eq(ActionController::RequestForgeryProtection::ProtectionMethods::Exception)
  end

  it "prepares a fresh campaign database after bootstrapping an ephemeral token" do
    Dir.mktmpdir("sequenceproof-fresh-db-") do |directory|
      database_url = "sqlite3:#{File.join(directory, 'campaign.sqlite3')}"
      environment = { "RAILS_ENV" => "test", "DATABASE_URL" => database_url }
      output, status = Open3.capture2e(
        environment, RbConfig.ruby, "bin/rails", "sequenceproof:ephemeral_token", "db:prepare",
        chdir: File.expand_path("../dummy", __dir__)
      )

      expect(status).to be_success, output
      expect(File).to exist(File.join(directory, "campaign.sqlite3"))
    end
  end

  it "redacts canaries before responses and notifications are materialized" do
    canary = "SEQUENCEPROOF_SECRET_CANARY_7f31"
    SequenceProof::Rails.__clear_adapters_for_test!
    SequenceProof::Rails.adapter(:redaction) do
      isolation :transaction, connection_classes: [ApplicationRecord]
      setup { |run| run.store(:secret, canary) }
      actor(:guest) {}
      command :reveal,
              actors: [:guest],
              input: SequenceProof::Rails::Schema.object({ secret: SequenceProof::Rails::Schema.string }),
              output: SequenceProof::Rails::Schema.object({
                                                            secret: SequenceProof::Rails::Schema.string
                                                          }) do |command, input|
        command.ok(secret: input.fetch("secret"))
      end
      observe schema: SequenceProof::Rails::Schema.object({ secret: SequenceProof::Rails::Schema.string }) do |run|
        { secret: run.fetch(:secret) }
      end
      invariant(:canary) { |run, _observation| { pass: false, message: "redacted", actual: run.fetch(:secret) } }
      redact "/observation/secret", "/outcome/value/secret", "/assertions/0/result/actual"
    end

    payloads = []
    callback = ->(*arguments) { payloads << ActiveSupport::Notifications::Event.new(*arguments).payload }
    ActiveSupport::Notifications.subscribed(callback, /\Asequenceproof\./) do
      get "/__sequenceproof/v1/adapters/redaction/manifest", headers: headers
      digest = json.fetch("digest")
      post "/__sequenceproof/v1/adapters/redaction/runs",
           params: JSON.generate(seed: canary, metadata: { secret: canary }), headers: headers
      run_id = json.fetch("run_id")
      expect(response.body).not_to include(canary)
      post "/__sequenceproof/v1/runs/#{run_id}/commands/reveal",
           params: JSON.generate(actor: "guest", input: { secret: canary }, step: 0, manifest_digest: digest),
           headers: headers
      expect(response.body).not_to include(canary)
      expect(json.dig("outcome", "value", "secret")).to eq("[REDACTED]")
      delete "/__sequenceproof/v1/runs/#{run_id}", headers: headers
    end

    expect(JSON.generate(payloads)).not_to include(canary)
  end

  it "rejects unknown members, invalid resets, stale digests, and oversized bodies" do
    SequenceProof::Rails.__clear_adapters_for_test!
    SequenceProof::Rails.adapter(:guarded) do
      isolation :transaction, connection_classes: [ApplicationRecord]
      setup { |_run| }
      actor(:guest) {}
      command(:noop, actors: [:guest], input: SequenceProof::Rails::Schema.object({})) { |command, _| command.ok(nil) }
      observe(schema: SequenceProof::Rails::Schema.object({})) { |_run| {} }
    end

    post "/__sequenceproof/v1/adapters/guarded/runs",
         params: JSON.generate(seed: "seed", metadata: {}, surprise: true), headers: headers
    expect(json.fetch("code")).to eq("unknown_members")

    post "/__sequenceproof/v1/adapters/guarded/runs", params: JSON.generate(seed: "seed", metadata: {}),
                                                      headers: headers
    run_id = json.fetch("run_id")
    post "/__sequenceproof/v1/runs/#{run_id}/commands/noop",
         params: JSON.generate(actor: "guest", input: {}, step: 0, manifest_digest: "0" * 64), headers: headers
    expect(json.fetch("code")).to eq("manifest_mismatch")

    post "/__sequenceproof/v1/runs/#{run_id}/reset",
         params: JSON.generate(attempt: -1, reason: "anything"), headers: headers
    expect(json.fetch("code")).to eq("invalid_attempt")

    post "/__sequenceproof/v1/adapters/guarded/runs",
         params: JSON.generate(seed: "x" * (SequenceProof::Rails.configuration.max_request_bytes + 1), metadata: {}),
         headers: headers
    expect(json.fetch("code")).to eq("request_too_large")
  ensure
    delete "/__sequenceproof/v1/runs/#{run_id}", headers: headers if run_id
  end

  it "aborts a real production boot when the engine is enabled" do
    environment = {
      "RAILS_ENV" => "production",
      "SEQUENCEPROOF_ENABLE_PRODUCTION" => "1",
      "SEQUENCEPROOF_TOKEN" => "production-token".ljust(40, "x")
    }
    output, status = Open3.capture2e(environment, RbConfig.ruby, "spec/dummy/bin/rails", "runner", "puts :booted",
                                     chdir: File.expand_path("../..", __dir__))

    expect(status).not_to be_success
    expect(output).to include("SequenceProof cannot be enabled in production")
    expect(output).not_to include("booted")
  end
end
