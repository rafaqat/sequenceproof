# frozen_string_literal: true

require "rails_helper"

RSpec.describe "SequenceProof engine eager loading" do
  it "inflects the package namespace as SequenceProof in a consumer application" do
    engine_controllers = SequenceProof::Rails::Engine.root.join("app/controllers")

    expect { Rails.autoloaders.main.eager_load_dir(engine_controllers) }.not_to raise_error
    expect(defined?(SequenceProof::Rails::V1::ProtocolController)).to eq("constant")
  end
end
