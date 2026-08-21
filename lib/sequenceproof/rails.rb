# frozen_string_literal: true

require "rails"
require "active_record"
require "action_dispatch"
require "action_controller/api"
require "active_support/security_utils"
require "active_support/notifications"
require "active_support/core_ext/numeric/time"
require "active_support/core_ext/numeric/bytes"

require_relative "rails/version"
require_relative "rails/errors"
require_relative "rails/json"
require_relative "rails/schema"
require_relative "rails/configuration"
require_relative "rails/definitions"
require_relative "rails/executor"
require_relative "rails/contexts"
require_relative "rails/manifest"
require_relative "rails/runtime"
require_relative "rails/run_registry"
require_relative "rails/task_support"
require_relative "rails/engine"
require File.expand_path("../../app/controllers/sequenceproof/rails/v1/protocol_controller", __dir__)
require_relative "rails/railtie"

## Deterministic model-based testing for stateful systems.
module SequenceProof
  ## Rails integration, adapter DSL, protocol engine, and test helpers.
  module Rails
    # Current major version of the SequenceProof wire protocol.
    PROTOCOL_VERSION = 1

    class << self
      def configure
        raise ConfigurationError.new(:configuration_finalized, "configuration is finalized") if configuration.finalized?

        yield configuration
      end

      # Returns the mutable configuration before Rails boot finalizes it.
      def configuration = @configuration ||= Configuration.new

      def adapter(name, version: 1, &block)
        raise ConfigurationError.new(:missing_callback, "adapter requires a block") unless block

        builder = AdapterBuilder.new(name, version)
        builder.instance_eval(&block)
        definition = builder.build
        registry_mutex.synchronize do
          if registry.key?(definition.name)
            raise DuplicateAdapterError.new(:duplicate_adapter,
                                            "adapter #{definition.name} is already registered")
          end

          registry[definition.name] = definition
          registry_sources[definition.name] = block.source_location&.first
        end
        definition.descriptor
      end

      # Finds a registered adapter by identifier.
      def fetch_adapter(name)
        registry_mutex.synchronize do
          registry[name.to_s]
        end || raise(UnknownAdapterError.new(:unknown_adapter, "unknown adapter"))
      end

      # Returns frozen public descriptors for all registered adapters.
      def adapters
        registry_mutex.synchronize { registry.values.sort_by(&:name).map(&:descriptor).freeze }
      end

      def enabled?
        defined?(::Rails) && configuration.enabled_for?(::Rails.env)
      end

      # Returns the process-local registry of active protocol runs.
      def run_registry = @run_registry ||= RunRegistry.new

      # Resets all framework state for isolated tests.
      # @api private
      def __reset_for_test!
        @run_registry&.clear
        @run_registry = nil
        registry_mutex.synchronize do
          registry.clear
          registry_sources.clear
        end
        @configuration = Configuration.new
      end

      # Clears adapters and active runs without replacing configuration.
      # @api private
      def __clear_adapters_for_test!
        @run_registry&.clear
        @run_registry = nil
        registry_mutex.synchronize do
          registry.clear
          registry_sources.clear
        end
      end

      # Reloads application-owned adapter files atomically.
      # @api private
      def __reload_app_adapters!(paths)
        paths = Array(paths).map { |path| File.expand_path(path) }.uniq.sort.freeze
        previous = registry_mutex.synchronize do
          registry.keys.filter_map do |name|
            next unless paths.include?(File.expand_path(registry_sources[name].to_s))

            [name, registry.delete(name), registry_sources.delete(name)]
          end
        end
        paths.each { |path| load path }
        true
      rescue Exception => e # rubocop:disable Lint/RescueException
        registry_mutex.synchronize do
          registry.each_key do |name|
            next unless paths.include?(File.expand_path(registry_sources[name].to_s))

            registry.delete(name)
            registry_sources.delete(name)
          end
          previous.each do |name, definition, source|
            registry[name] = definition
            registry_sources[name] = source
          end
        end
        raise e
      end

      private

      def registry = @registry ||= {}
      def registry_sources = @registry_sources ||= {}
      def registry_mutex = @registry_mutex ||= Mutex.new
    end
  end
end
