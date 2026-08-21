# frozen_string_literal: true

RSpec.describe SequenceProof::Rails::Executor do
  it "times out work on its owning executor thread and remains usable" do
    executor = described_class.new(mode: :callback, connection_classes: [])

    expect { executor.call(timeout: 0.01) { sleep 0.1 } }
      .to raise_error(SequenceProof::Rails::ProtocolError) { |error| expect(error.code).to eq("request_timeout") }
    expect(executor.call(timeout: 1) { :still_running }).to eq(:still_running)
  ensure
    executor&.stop!
  end
end
