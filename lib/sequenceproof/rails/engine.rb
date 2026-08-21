# frozen_string_literal: true

module SequenceProof
  module Rails
    # Isolated, test-only Rails Engine containing the versioned protocol.
    class Engine < ::Rails::Engine
      isolate_namespace SequenceProof::Rails
    end
  end
end
