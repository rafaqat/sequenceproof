# frozen_string_literal: true

RSpec.describe SequenceProof::Rails::Schema do
  it "creates deeply frozen JSON Schema fragments" do
    schema = described_class.object({ count: described_class.integer(minimum: 0) })

    expect(schema).to be_frozen
    expect(schema.fetch("properties")).to be_frozen
    expect(schema).to include("required" => ["count"], "additionalProperties" => false)
  end

  it "reports input paths without invoking application code" do
    schema = described_class.object({ count: described_class.integer(minimum: 0) })

    expect { described_class.validate!(schema, { count: -1 }) }
      .to raise_error(SequenceProof::Rails::SchemaError) { |error| expect(error.details.fetch(:errors).first.fetch("path")).to eq("/count") }
  end

  it "rejects unsupported keywords" do
    expect { described_class.raw(type: "string", madeUpKeyword: true) }
      .to raise_error(SequenceProof::Rails::SchemaError, /unsupported schema keyword/)
  end

  it "rejects invalid schema values, external references, and ignored formats" do
    expect { described_class.raw(type: "mystery") }
      .to raise_error(SequenceProof::Rails::SchemaError, /schema is invalid/)
    expect { described_class.raw("$ref" => "https://attacker.example/schema.json") }
      .to raise_error(SequenceProof::Rails::SchemaError) { |error| expect(error.code).to eq("external_schema_reference") }
    expect { described_class.string(format: "invented-format") }
      .to raise_error(SequenceProof::Rails::SchemaError) { |error| expect(error.code).to eq("unsupported_schema_format") }
  end

  it "allows JSON objects as literal and enum data rather than treating them as schemas" do
    literal = described_class.literal({ "secret" => "value" })
    enumeration = described_class.enum({ "kind" => "one" }, { "kind" => "two" })

    expect { described_class.validate!(literal, { "secret" => "value" }) }.not_to raise_error
    expect { described_class.validate!(enumeration, { "kind" => "two" }) }.not_to raise_error
  end
end
