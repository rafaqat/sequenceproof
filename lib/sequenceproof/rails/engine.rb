# frozen_string_literal: true

module SequenceProof
  module Rails
    # Isolated, test-only Rails Engine containing the versioned protocol.
    class Engine < ::Rails::Engine
      initializer "sequenceproof_rails.inflections" do
        # Zeitwerk otherwise maps the `sequenceproof/` directory to `Sequenceproof`, which makes a
        # consumer's `Rails.application.eager_load!` fail even though normal lazy loading succeeds.
        ActiveSupport::Inflector.inflections(:en) { |inflect| inflect.acronym "SequenceProof" }
      end

      isolate_namespace SequenceProof::Rails
    end
  end
end
