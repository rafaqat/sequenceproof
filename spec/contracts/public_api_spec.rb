# frozen_string_literal: true

require "tempfile"

RSpec.describe SequenceProof::Rails do
  before { described_class.__clear_adapters_for_test! }

  it "exposes the coordinated versions" do
    expect(described_class::VERSION).to eq("0.1.0")
    expect(described_class::PROTOCOL_VERSION).to eq(1)
  end

  it "registers and freezes an explicit adapter descriptor" do
    descriptor = described_class.adapter(:counter, version: 2) do
      isolation :callback
      setup { |_run| }
      reset { |_run| }
      actor(:user) { authenticate { |_session, _run| } }
      command :increment, actors: [:user], input: SequenceProof::Rails::Schema.integer do |command, input|
        command.ok(input)
      end
      observe(schema: SequenceProof::Rails::Schema.integer) { |_run| 0 }
    end

    expect(descriptor).to include(name: "counter", version: 2, commands: ["increment"])
    expect(described_class.fetch_adapter(:counter)).to be_frozen
    expect(described_class.adapters).to be_frozen
  end

  it "rejects duplicate adapters" do
    registration = proc do
      described_class.adapter(:duplicate) do
        isolation :callback
        setup { |_run| }
        reset { |_run| }
        command(:noop, actors: [], input: SequenceProof::Rails::Schema.null) { |command, _input| command.ok }
        observe(schema: SequenceProof::Rails::Schema.null) { |_run| nil }
      end
    end

    registration.call
    expect { registration.call }.to raise_error(SequenceProof::Rails::DuplicateAdapterError)
  end

  it "rejects adapter versions that cannot be represented safely by the wire protocol" do
    [-1, 0, 1.5, "2", 9_007_199_254_740_992].each do |version|
      expect { described_class.adapter(:invalid_version, version:) {} }
        .to raise_error(SequenceProof::Rails::ConfigurationError) { |error| expect(error.code).to eq("invalid_version") }
    end
  end

  it "rejects command metadata that its manifest schema cannot represent" do
    expect do
      described_class.adapter(:invalid_metadata) do
        isolation :callback
        setup { |_run| }
        reset { |_run| }
        command(:noop, actors: [], input: SequenceProof::Rails::Schema.null,
                       metadata: "not-an-object") do |command, _input|
          command.ok(nil)
        end
        observe(schema: SequenceProof::Rails::Schema.null) { |_run| nil }
      end
    end.to raise_error(SequenceProof::Rails::ConfigurationError) { |error| expect(error.code).to eq("invalid_metadata") }
  end

  it "refuses transaction isolation with an invalid database connection class" do
    expect do
      described_class.adapter(:unsafe_default) do
        isolation :transaction, connection_classes: [Object]
        setup { |_run| }
        command(:noop, actors: [], input: SequenceProof::Rails::Schema.null) { |command, _input| command.ok(nil) }
        observe(schema: SequenceProof::Rails::Schema.null) { |_run| nil }
      end
    end.to raise_error(SequenceProof::Rails::IsolationError) { |error| expect(error.code).to eq("invalid_connection_class") }
  end

  it "validates redaction pointers in linear time without changing RFC 6901 escapes" do
    builder = SequenceProof::Rails::AdapterBuilder.new(:redaction_pointer, 1)
    valid = ["", "/", "/plain/path", "/escaped~0tilde/escaped~1slash", "/#{'/' * 100_000}"]
    invalid = ["missing-leading-slash", "/dangling~", "/invalid~2escape", "#{'/' * 100_000}~2"]

    expect { builder.redact(*valid) }.not_to raise_error
    invalid.each do |pointer|
      expect { builder.redact(pointer) }
        .to raise_error(SequenceProof::Rails::ConfigurationError) do |error|
          expect(error.code).to eq("invalid_redaction_pointer")
        end
    end
  end

  it "reloads app-owned adapter files without duplicates and restores the prior registry on failure" do
    file = Tempfile.new(["reloadable_adapter", ".rb"])
    source = <<~RUBY
      SequenceProof::Rails.adapter(:reloadable) do
        isolation :callback
        setup { |_run| }
        reset { |_run| }
        command(:noop, actors: [], input: SequenceProof::Rails::Schema.null) { |command, _input| command.ok(nil) }
        observe(schema: SequenceProof::Rails::Schema.null) { |_run| nil }
      end
    RUBY
    file.write(source)
    file.flush

    2.times { described_class.__reload_app_adapters!([file.path]) }
    original = described_class.fetch_adapter(:reloadable)
    expect(described_class.adapters.count { |adapter| adapter.fetch(:name) == "reloadable" }).to eq(1)

    file.rewind
    file.truncate(0)
    file.write("#{source}\nraise 'reload failed'\n")
    file.flush
    expect { described_class.__reload_app_adapters!([file.path]) }.to raise_error("reload failed")
    expect(described_class.fetch_adapter(:reloadable)).to equal(original)
  ensure
    file&.close!
  end
end
