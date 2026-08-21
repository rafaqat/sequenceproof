# frozen_string_literal: true

require "json_schemer"

RSpec.describe "shared SequenceProof wire contracts" do
  let(:root) { Pathname(__dir__).join("../..").expand_path }
  let(:corpus) { JSON.parse(root.join("test-vectors/protocol-fixtures.json").read) }

  it "matches every fixture using the checked-in Draft 2020-12 schemas" do
    results = corpus.fetch("fixtures").to_h do |fixture|
      schema = JSON.parse(root.join("schemas", fixture.fetch("schema")).read)
      valid = JSONSchemer.schema(schema).valid?(fixture.fetch("value"))
      [fixture.fetch("name"), valid]
    end

    expected = corpus.fetch("fixtures").to_h { |fixture| [fixture.fetch("name"), fixture.fetch("valid")] }
    expect(results).to eq(expected)
  end

  it "uses RFC 8785 canonical JSON semantics" do
    vectors = JSON.parse(root.join("test-vectors/canonical-json-vectors.json").read).fetch("vectors")

    expect(vectors.map { |vector| SequenceProof::Rails::Json.canonical(vector.fetch("value")) })
      .to eq(vectors.map { |vector| vector.fetch("canonical") })
  end
end
