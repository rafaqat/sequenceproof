# frozen_string_literal: true

require "digest"

module SequenceProof
  module Rails
    # Builds the immutable adapter capability document and its canonical digest.
    module Manifest
      module_function

      # Builds a version-one manifest for an adapter.
      def build(adapter, request_id:)
        body = {
          "protocol" => "sequenceproof.protocol",
          "protocol_version" => PROTOCOL_VERSION,
          "request_id" => request_id,
          "sequenceproof_rails_version" => VERSION,
          "supported_protocol_versions" => [PROTOCOL_VERSION],
          "adapter" => { "name" => adapter.name, "version" => adapter.version },
          "commands" => adapter.commands.keys.sort.map do |name|
            command = adapter.commands.fetch(name)
            {
              "id" => name,
              "actors" => command.actors.sort,
              "input_schema" => command.input_schema,
              "output_schema" => command.output_schema,
              "metadata" => command.metadata
            }
          end,
          "observation_schema" => adapter.observation_schema,
          "server_invariants" => adapter.invariants.keys.sort,
          "isolation" => { "mode" => adapter.isolation_mode.to_s, "resettable" => true }
        }
        unsigned = body.except("request_id")
        body["digest"] = Digest::SHA256.hexdigest(Json.canonical(unsigned))
        Json.deep_freeze(body)
      end
    end
  end
end
