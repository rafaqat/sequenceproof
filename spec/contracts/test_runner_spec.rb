# frozen_string_literal: true

require "rails_helper"
require "sequenceproof/rails/test_runner"
require "sequenceproof/rails/rspec"
require "sequenceproof/rails/minitest"

RSpec.describe SequenceProof::Rails::TestRunner do
  it "rejects missing, mismatched, and delimiter-bearing inputs before spawning" do
    expect { described_class.check(model: "/missing/model.ts", adapter: "model") }
      .to raise_error(SequenceProof::Rails::ConfigurationError) { |error| expect(error.code).to eq("missing_model") }

    model = Rails.root.join("sequenceproof/models/shopping_cart.ts")
    expect { described_class.check(model:, adapter: "different") }
      .to raise_error(SequenceProof::Rails::ConfigurationError) { |error| expect(error.code).to eq("adapter_mismatch") }
    expect { described_class.check(model:, adapter: "shopping_cart", profile: "smoke,other") }
      .to raise_error(SequenceProof::Rails::ConfigurationError) { |error| expect(error.code).to eq("invalid_identifier") }
  end

  it "returns a structured result and raises only through check bang" do
    model = Rails.root.join("sequenceproof/models/shopping_cart.ts")
    process = instance_double(Process::Status, success?: false, exitstatus: 2)
    allow(Open3).to receive(:capture3).and_return(["stdout", "stderr", process])

    result = described_class.check(model:, adapter: "shopping_cart", profile: "smoke")
    expect(result.to_h).to eq(status: :failed, stdout: "stdout", stderr: "stderr", exitstatus: 2)
    expect { described_class.check!(model:, adapter: "shopping_cart", profile: "smoke") }
      .to raise_error(SequenceProof::Rails::ProtocolError) { |error| expect(error.code).to eq("check_failed") }
  end

  it "keeps the RSpec and Minitest helpers as explicit thin wrappers" do
    result = described_class::Result.new(status: :passed, stdout: "", stderr: "", exitstatus: 0)
    allow(described_class).to receive_messages(check: result, check!: result)

    expect(SequenceProof::Rails::RSpec.check(model: "model", adapter: "adapter")).to equal(result)
    expect(SequenceProof::Rails::Minitest.check!(model: "model", adapter: "adapter")).to equal(result)
  end
end
