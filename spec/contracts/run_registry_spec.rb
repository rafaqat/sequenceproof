# frozen_string_literal: true

require "spec_helper"

RSpec.describe SequenceProof::Rails::RunRegistry do
  let(:fake_runtime_class) do
    Class.new(Struct.new(:run_id, :expired, :disposed, keyword_init: true)) do
      def start! = { "run_id" => run_id }
      def expired?(_ttl) = expired
      def dispose! = self.disposed = true
    end
  end

  before { SequenceProof::Rails.__reset_for_test! }
  after { SequenceProof::Rails.__reset_for_test! }

  it "enforces the configured active-run bound" do
    SequenceProof::Rails.configuration.max_runs = 1
    allow(SequenceProof::Rails::Runtime).to receive(:new) do |run_id:, **|
      fake_runtime_class.new(run_id:, expired: false, disposed: false)
    end
    registry = described_class.new

    registry.create(adapter: Object.new, seed: "seed", metadata: {})

    expect do
      registry.create(adapter: Object.new, seed: "other", metadata: {})
    end.to raise_error(SequenceProof::Rails::ProtocolError) { |error| expect(error.code).to eq("run_limit") }
    expect(registry.size).to eq(1)
  end

  it "disposes expired runs and distinguishes them from unknown run IDs" do
    runtime = nil
    allow(SequenceProof::Rails::Runtime).to receive(:new) do |run_id:, **|
      runtime = fake_runtime_class.new(run_id:, expired: false, disposed: false)
    end
    registry = described_class.new
    created, = registry.create(adapter: Object.new, seed: "seed", metadata: {})
    runtime.expired = true

    expect { registry.fetch(created.run_id) }
      .to raise_error(SequenceProof::Rails::RunExpiredError) { |error| expect(error.code).to eq("run_expired") }
    expect(runtime.disposed).to be(true)
    expect(registry.size).to eq(0)
    expect { registry.fetch("run-never-created") }
      .to raise_error(SequenceProof::Rails::RunNotFoundError) { |error| expect(error.code).to eq("run_not_found") }
  end
end
