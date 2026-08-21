# frozen_string_literal: true

require "rails/generators/named_base"

module SequenceProof
  module Generators
    # Generates a Rails adapter and framework-specific starter test.
    class AdapterGenerator < ::Rails::Generators::NamedBase
      namespace "sequenceproof:adapter"

      argument :commands, type: :array, default: []
      class_option :test_framework, type: :string, default: "rspec", enum: %w[rspec minitest]

      def validate_names!
        raise ::Rails::Generators::Error, "adapter name cannot contain a path" if name.to_s.match?(%r{[\\/]})

        identifier!(file_name)
        raise ::Rails::Generators::Error, "adapter requires at least one command" if commands.empty?

        normalized = commands.map { |command| identifier!(command) }
        return if normalized.uniq.length == normalized.length

        raise ::Rails::Generators::Error,
              "command names must be unique"
      end

      # Writes the adapter into the selected test framework tree.
      def create_adapter
        create_file adapter_path, adapter_source
      end

      # Writes an explicit pending/skip starter test.
      def create_test
        create_file test_path, test_source
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

      def adapter_path = "#{test_root}/sequenceproof/adapters/#{file_name}_adapter.rb"

      def test_path
        suffix = options[:test_framework] == "rspec" ? "spec" : "test"
        "#{test_root}/sequenceproof/#{file_name}_#{suffix}.rb"
      end

      def test_root = options[:test_framework] == "rspec" ? "spec" : "test"

      def adapter_source
        command_blocks = normalized_commands.map do |command|
          <<~RUBY.indent(2)
            command :#{command}, actors: [:actor], input: SequenceProof::Rails::Schema.object({}) do |_command, _input|
              # TODO: exercise a real application route and return command.ok or command.rejected.
              raise NotImplementedError, "implement #{command}"
            end
          RUBY
        end.join("\n")
        <<~RUBY
          # frozen_string_literal: true

          SequenceProof::Rails.adapter :#{file_name} do
            isolation :transaction, connection_classes: [ApplicationRecord]

            setup do |_run|
              # TODO: create and store the application records required by this run.
              raise NotImplementedError, "implement setup"
            end

            actor :actor do
              authenticate do |_session, _run|
                # TODO: authenticate through a test-only application route.
                raise NotImplementedError, "implement authentication"
              end
            end

          #{command_blocks.rstrip}

            observe schema: SequenceProof::Rails::Schema.object({}) do |_run|
              # TODO: return a stable JSON projection of application state.
              raise NotImplementedError, "implement observation"
            end
          end
        RUBY
      end

      def test_source
        if options[:test_framework] == "rspec"
          <<~RUBY
            # frozen_string_literal: true

            require "rails_helper"
            RSpec.describe "#{class_name} SequenceProof adapter" do
              it "registers the expected command contract" do
                adapter = SequenceProof::Rails.fetch_adapter(:#{file_name})
                expect(adapter.commands.keys.sort).to eq(#{normalized_commands.sort.inspect})
              end

              it "has completed application-specific TODOs" do
                pending "complete the generated adapter and model TODOs before enabling this suite"
                raise "generated SequenceProof suite is incomplete"
              end
            end
          RUBY
        else
          <<~RUBY
            # frozen_string_literal: true

            require "test_helper"
            class #{class_name}SequenceProofAdapterTest < ActiveSupport::TestCase
              test "registers the expected command contract" do
                assert_equal #{normalized_commands.sort.inspect}, SequenceProof::Rails.fetch_adapter(:#{file_name}).commands.keys.sort
              end

              test "has completed application-specific TODOs" do
                skip "complete the generated adapter and model TODOs before enabling this suite"
              end
            end
          RUBY
        end
      end
    end
  end
end
