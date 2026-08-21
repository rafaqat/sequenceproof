# frozen_string_literal: true

require "json"
require "json/canonicalization"

module SequenceProof
  module Rails
    # JSON normalization, canonicalization, freezing, and redaction helpers.
    module Json
      module_function

      # Round-trips a value through strict JSON-compatible Ruby structures.
      def normalize(value)
        JSON.parse(JSON.generate(value))
      rescue JSON::GeneratorError, TypeError => e
        raise SchemaError.new(:invalid_json, "value is not JSON-compatible", details: { error: e.class.name })
      end

      # Recursively freezes a JSON value in place.
      def deep_freeze(value)
        case value
        when Hash
          value.each do |key, child|
            key.freeze
            deep_freeze(child)
          end
        when Array
          value.each { |child| deep_freeze(child) }
        end
        value.freeze
      end

      # Returns RFC 8785 canonical JSON.
      def canonical(value)
        normalize(value).to_json_c14n
      end

      # Applies JSON-pointer replacements followed by the global redactor.
      def redact(value, pointers:, callback:)
        redacted = normalize(value)
        replacement = pointers.reduce(redacted) { |current, pointer| redact_pointer!(current, pointer) }
        normalize(callback.call(replacement))
      rescue SchemaError
        raise
      rescue StandardError => e
        raise ProtocolError.new(:redaction_failed, "configured redaction failed", details: { error: e.class.name })
      end

      def redact_pointer!(value, pointer)
        return "[REDACTED]" if pointer.empty?

        tokens = pointer.delete_prefix("/").split("/").map { |token| token.gsub("~1", "/").gsub("~0", "~") }
        parent = tokens[0...-1].reduce(value) do |current, token|
          case current
          when Hash then current[token]
          when Array then token.match?(/\A(?:0|[1-9]\d*)\z/) ? current[token.to_i] : nil
          end
        end
        key = tokens.last
        case parent
        when Hash
          parent[key] = "[REDACTED]" if parent.key?(key)
        when Array
          parent[key.to_i] = "[REDACTED]" if key&.match?(/\A(?:0|[1-9]\d*)\z/) && key.to_i < parent.length
        end
        value
      end
      private_class_method :redact_pointer!
    end
  end
end
