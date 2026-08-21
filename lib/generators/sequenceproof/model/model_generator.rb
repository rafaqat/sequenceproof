# frozen_string_literal: true

require "rails/generators/named_base"
require_relative "../adapter/adapter_generator"

## Generator namespace following Rails' command lookup convention.
module SequenceProof
  ## SequenceProof install, adapter, and TypeScript model generators.
  module Generators
    # Generates a typed model and its paired Rails adapter/test.
    class ModelGenerator < ::Rails::Generators::NamedBase
      namespace "sequenceproof:model"

      argument :commands, type: :array, default: []
      class_option :test_framework, type: :string, default: "rspec", enum: %w[rspec minitest]

      def validate_names!
        raise ::Rails::Generators::Error, "model name cannot contain a path" if name.to_s.match?(%r{[\\/]})

        identifier!(file_name)
        raise ::Rails::Generators::Error, "model requires at least one command" if commands.empty?

        normalized = commands.map { |command| identifier!(command) }
        return if normalized.uniq.length == normalized.length

        raise ::Rails::Generators::Error,
              "command names must be unique"
      end

      # Writes a compiling TypeScript model scaffold.
      def create_model
        create_file "sequenceproof/models/#{file_name}.ts", model_source
      end

      # Invokes the paired Rails adapter generator.
      def create_adapter
        invoke "sequenceproof:adapter", [name, *commands], test_framework: options[:test_framework]
      end

      private

      def identifier!(value)
        candidate = value.to_s.underscore
        unless candidate.match?(/\A[a-z0-9][a-z0-9_.-]{0,127}\z/)
          raise ::Rails::Generators::Error,
                "invalid SequenceProof identifier #{value}"
        end

        candidate
      end

      def normalized_commands = commands.map { |command| identifier!(command) }

      def model_source
        definitions = normalized_commands.map do |command|
          <<~TS.indent(4)
            #{command}: command<JsonObject>({
              input: gen.record({}),
              actor: "actor",
              enabled: () => true,
              transition: ({ model }) => {
                // TODO: return the expected next abstract model state for #{command}.
                return model;
              },
            }),
          TS
        end.join
        <<~TS
          import { defineModel, gen, type JsonObject } from "@sequenceproof/core";

          type ModelState = { readonly step: number };
          type Observation = { readonly step: number };

          export default defineModel<ModelState, Observation>()(({ command }) => ({
            name: "#{file_name}",
            version: 1,
            initial: ({ observation }) => ({ step: observation.step }),
            commands: {
          #{definitions.rstrip}
            },
          }));
        TS
      end
    end
  end
end
