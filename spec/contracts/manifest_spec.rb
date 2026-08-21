# frozen_string_literal: true

RSpec.describe SequenceProof::Rails::Manifest do
  before do
    SequenceProof::Rails.__clear_adapters_for_test!
    SequenceProof::Rails.adapter(:manifested) do
      isolation :callback
      setup { |_run| }
      reset { |_run| }
      actor(:user) { authenticate { |_session, _run| } }
      command(:noop, actors: [:user], input: SequenceProof::Rails::Schema.null) { |command, _input| command.ok }
      observe(schema: SequenceProof::Rails::Schema.null) { |_run| nil }
      invariant(:always) { |_run, _observation| true }
    end
  end

  it "keeps the digest stable across request IDs" do
    adapter = SequenceProof::Rails.fetch_adapter(:manifested)

    first = described_class.build(adapter, request_id: "one")
    second = described_class.build(adapter, request_id: "two")

    expect(first.fetch("digest")).to eq(second.fetch("digest"))
    expect(first.fetch("request_id")).not_to eq(second.fetch("request_id"))
    expect(first.fetch("digest")).to match(/\A[a-f0-9]{64}\z/)
  end
end
