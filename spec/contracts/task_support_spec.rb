# frozen_string_literal: true

require "tempfile"

RSpec.describe SequenceProof::Rails::TaskSupport do
  it "rejects path-like model and profile identifiers" do
    expect { described_class.validate_identifier!("../escape", label: "model") }
      .to raise_error(SequenceProof::Rails::ConfigurationError) { |error| expect(error.code).to eq("invalid_identifier") }
    expect(described_class.validate_identifier!("shopping_cart", label: "model")).to eq("shopping_cart")
  end

  def profile_file(source)
    Tempfile.create(["sequenceproof-profiles", ".yml"]).tap do |file|
      file.write(source)
      file.flush
    end
  end

  it "validates a profile and emits explicit CLI arguments" do
    file = profile_file(<<~YAML)
      version: 1
      profiles:
        smoke:
          runs: 2
          max_steps: 3
          size: 4
          concurrency: 1
          shrink: false
          max_shrink_attempts: 5
          max_shrink_time_ms: 6
          stop_on_failure: true
    YAML

    expect(described_class.profile_arguments(file.path, "smoke"))
      .to include("--runs", "2", "--max-steps", "3", "--no-shrink", "--stop-on-failure")
  ensure
    file&.close
    FileUtils.rm_f(file&.path)
  end

  it "rejects aliases and unknown keys before starting a server" do
    aliased = profile_file("version: 1\nprofiles:\n  smoke: &base { runs: 1 }\n  ci: *base\n")
    unknown = profile_file(<<~YAML)
      version: 1
      profiles:
        smoke:
          runs: 1
          max_steps: 1
          size: 1
          concurrency: 1
          shrink: true
          max_shrink_attempts: 1
          max_shrink_time_ms: 1
          stop_on_failure: true
          typo: 1
    YAML

    expect { described_class.profile_arguments(aliased.path, "smoke") }
      .to raise_error(SequenceProof::Rails::ConfigurationError, /unsafe or invalid/)
    expect { described_class.profile_arguments(unknown.path, "smoke") }
      .to raise_error(SequenceProof::Rails::ConfigurationError, /unknown keys/)
  ensure
    aliased&.close
    unknown&.close
    FileUtils.rm_f(aliased&.path)
    FileUtils.rm_f(unknown&.path)
  end
end
