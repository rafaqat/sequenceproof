# frozen_string_literal: true

require "json_schemer"

module SequenceProof
  module Rails
    # Strict Draft 2020-12 JSON Schema builders and validators.
    module Schema
      # Supported schema vocabulary; unknown keywords fail closed.
      ALLOWED_KEYWORDS = %w[
        $schema $id $ref $defs type properties required additionalProperties items minItems maxItems
        minLength maxLength pattern format minimum maximum enum const oneOf anyOf allOf not description
      ].freeze

      module_function

      # Builds a string schema with optional length, pattern, and format limits.
      def string(min_length: nil, max_length: nil, pattern: nil, format: nil)
        raw({ type: "string", minLength: min_length, maxLength: max_length, pattern:, format: }.compact)
      end

      # Builds an integer schema.
      def integer(minimum: nil, maximum: nil) = raw({ type: "integer", minimum:, maximum: }.compact)
      # Builds a finite-number schema.
      def number(minimum: nil, maximum: nil) = raw({ type: "number", minimum:, maximum: }.compact)
      # Builds a boolean schema.
      def boolean = raw(type: "boolean")
      # Builds a null schema.
      def null = raw(type: "null")
      # Builds a schema accepting any JSON value.
      def any_json = raw({})
      # Builds a constant-value schema.
      def literal(value) = raw(const: value)
      # Builds an enumeration schema.
      def enum(*values) = raw(enum: values)

      # Builds an array schema for the supplied item schema.
      def array(items:, min_items: nil, max_items: nil)
        raw({ type: "array", items:, minItems: min_items, maxItems: max_items }.compact)
      end

      # Builds an object schema that is closed by default.
      def object(properties = {}, required: properties.keys, additional_properties: false)
        normalized = properties.to_h { |key, value| [key.to_s, value] }
        raw(type: "object", properties: normalized, required: required.map(&:to_s),
            additionalProperties: additional_properties)
      end

      # Builds an exclusive union schema.
      def one_of(*schemas) = raw(oneOf: schemas)
      # Builds a schema accepting the supplied value or null.
      def nullable(schema) = one_of(schema, null)

      # Validates and deeply freezes a raw supported schema fragment.
      def raw(hash)
        normalized = Json.normalize(hash)
        validate_keywords!(normalized)
        unless JSONSchemer.valid_schema?(normalized)
          errors = JSONSchemer.validate_schema(normalized).map do |error|
            { "path" => error.fetch("data_pointer", ""), "code" => "schema",
              "message" => error.fetch("type", "invalid") }
          end
          raise SchemaError.new(:invalid_schema, "schema is invalid", details: { errors: })
        end
        Json.deep_freeze(normalized)
      rescue SchemaError
        raise
      rescue StandardError => e
        raise SchemaError.new(:invalid_schema, "schema is invalid", details: { error: e.message })
      end

      def validate!(schema, value, label: "value")
        errors = JSONSchemer.schema(schema).validate(Json.normalize(value)).map do |error|
          { "path" => error.fetch("data_pointer", ""), "code" => "schema", "message" => error.fetch("type", "invalid") }
        end
        return if errors.empty?

        raise SchemaError.new(:schema_validation_failed, "#{label} does not match its schema", details: { errors: })
      end

      def validate_keywords!(value, path = "$")
        raise SchemaError.new(:invalid_schema, "schema at #{path} must be an object") unless value.is_a?(Hash)

        unknown = value.keys - ALLOWED_KEYWORDS
        unless unknown.empty?
          raise SchemaError.new(:unsupported_schema_keyword, "unsupported schema keyword #{unknown.first} at #{path}")
        end
        if value["$ref"] && !value["$ref"].to_s.start_with?("#")
          raise SchemaError.new(:external_schema_reference, "external schema references are forbidden at #{path}")
        end
        if value["format"] && !JSONSchemer::Draft202012::FORMATS.key?(value["format"])
          raise SchemaError.new(:unsupported_schema_format, "unsupported schema format #{value['format']} at #{path}")
        end

        %w[properties $defs].each do |keyword|
          next unless value[keyword].is_a?(Hash)

          value[keyword].each { |name, schema| validate_keywords!(schema, "#{path}/#{keyword}/#{name}") }
        end
        %w[items not].each do |keyword|
          validate_keywords!(value[keyword], "#{path}/#{keyword}") if value[keyword].is_a?(Hash)
        end
        if value["additionalProperties"].is_a?(Hash)
          validate_keywords!(value["additionalProperties"],
                             "#{path}/additionalProperties")
        end
        %w[oneOf anyOf allOf].each do |keyword|
          next unless value[keyword].is_a?(Array)

          value[keyword].each_with_index { |schema, index| validate_keywords!(schema, "#{path}/#{keyword}/#{index}") }
        end
      end
      private_class_method :validate_keywords!
    end
  end
end
