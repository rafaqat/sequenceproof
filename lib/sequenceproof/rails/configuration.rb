# frozen_string_literal: true

module SequenceProof
  module Rails
    # Boot-time settings for the test-only engine and adapter callbacks.
    class Configuration
      # Names of supported configuration attributes.
      ATTRIBUTES = %i[
        enabled_environments mount_path token request_timeout max_request_bytes run_ttl max_runs
        debug_errors logger redact before_command after_command
      ].freeze

      attr_accessor :enabled_environments, :mount_path, :token, :request_timeout, :max_request_bytes,
                    :run_ttl, :max_runs, :debug_errors, :logger, :redact, :before_command, :after_command

      def initialize
        @enabled_environments = %w[test]
        @mount_path = "/__sequenceproof"
        @token = -> { ENV.fetch("SEQUENCEPROOF_TOKEN", nil) }
        @request_timeout = 10.seconds
        @max_request_bytes = 1.megabyte
        @run_ttl = 15.minutes
        @max_runs = 4
        @debug_errors = false
        @logger = nil
        @redact = ->(value) { value }
        @before_command = ->(_context) {}
        @after_command = ->(_context) {}
        @finalized = false
      end

      def finalize!(environment:)
        raise ConfigurationError.new(:configuration_finalized, "configuration is already finalized") if @finalized

        @enabled_environments = Array(@enabled_environments).map(&:to_s).freeze
        if environment.to_s == "production" && enabled_for?(environment)
          raise ConfigurationError.new(:production_forbidden,
                                       "SequenceProof cannot be enabled in production")
        end

        if enabled_for?(environment)
          current_token = resolved_token
          if current_token.strip.empty?
            raise ConfigurationError.new(:missing_token,
                                         "SEQUENCEPROOF_TOKEN is required when SequenceProof is enabled")
          end
          if current_token.bytesize < 32
            raise ConfigurationError.new(:weak_token,
                                         "SequenceProof token must contain at least 32 bytes")
          end
        end
        unless @mount_path.match?(%r{\A/[a-zA-Z0-9/_-]*\z})
          raise ConfigurationError.new(:invalid_mount_path,
                                       "mount_path must start with one slash")
        end
        unless positive_duration?(@request_timeout)
          raise ConfigurationError.new(:invalid_request_timeout,
                                       "request_timeout must be positive")
        end
        unless @max_request_bytes.is_a?(Integer) && @max_request_bytes.positive?
          raise ConfigurationError.new(:invalid_max_request_bytes,
                                       "max_request_bytes must be a positive integer")
        end
        unless positive_duration?(@run_ttl)
          raise ConfigurationError.new(:invalid_run_ttl,
                                       "run_ttl must be positive")
        end
        unless @max_runs.is_a?(Integer) && @max_runs.positive?
          raise ConfigurationError.new(:invalid_max_runs,
                                       "max_runs must be a positive integer")
        end
        unless @redact.respond_to?(:call) && @before_command.respond_to?(:call) && @after_command.respond_to?(:call)
          raise ConfigurationError.new(:invalid_callback,
                                       "redact and command hooks must be callable")
        end

        @finalized = true
        freeze
      end

      def finalized? = @finalized
      def enabled_for?(environment) = @enabled_environments.include?(environment.to_s)
      # Resolves a static or callable bearer-token setting.
      def resolved_token = (@token.respond_to?(:call) ? @token.call : @token).to_s

      private

      def positive_duration?(value)
        value.respond_to?(:to_f) && value.to_f.positive? && value.to_f.finite?
      end
    end
  end
end
