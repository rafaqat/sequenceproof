# frozen_string_literal: true

RSpec.describe SequenceProof::Rails::Configuration do
  it "refuses production enablement" do
    configuration = described_class.new
    configuration.enabled_environments = %w[production]
    configuration.token = "x" * 64

    expect { configuration.finalize!(environment: "production") }
      .to raise_error(SequenceProof::Rails::ConfigurationError, /cannot be enabled in production/)
  end

  it "requires a strong token in enabled environments" do
    configuration = described_class.new
    configuration.token = "short"

    expect { configuration.finalize!(environment: "test") }
      .to raise_error(SequenceProof::Rails::ConfigurationError, /at least 32 bytes/)
  end

  it "permits a disabled environment without a token" do
    configuration = described_class.new
    configuration.token = nil

    expect { configuration.finalize!(environment: "development") }.not_to raise_error
  end
end
