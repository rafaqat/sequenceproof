# frozen_string_literal: true

require "yaml"

module SequenceProof
  module Rails
    # Safe parsing and validation shared by the Rails command-line tasks.
    # @api private
    module TaskSupport
      # Complete allow-list of generated profile keys.
      PROFILE_KEYS = %w[
        runs max_steps size concurrency command_timeout_ms shrink max_shrink_attempts
        max_shrink_time_ms stop_on_failure
      ].freeze
      # Required profile keys; command timeout remains optional.
      REQUIRED_PROFILE_KEYS = (PROFILE_KEYS - ["command_timeout_ms"]).freeze
      # Numeric safety bounds shared with the TypeScript CLI.
      LIMITS = {
        "runs" => (1..100_000), "max_steps" => (0..100_000), "size" => (0..100_000),
        "concurrency" => (1..64), "command_timeout_ms" => (1..600_000),
        "max_shrink_attempts" => (0..1_000_000), "max_shrink_time_ms" => (0..3_600_000)
      }.freeze

      module_function

      # Validates one command-line model/profile identifier.
      def validate_identifier!(value, label: "identifier")
        candidate = value.to_s
        unless AdapterBuilder::IDENTIFIER.match?(candidate)
          raise ConfigurationError.new(:invalid_identifier, "#{label} must be a SequenceProof identifier")
        end

        candidate
      end

      # Safe-loads all profiles and emits explicit CLI flags for one profile.
      def profile_arguments(file, selected_name)
        document = YAML.safe_load_file(file, permitted_classes: [], permitted_symbols: [], aliases: false)
        unless document.is_a?(Hash) && document.keys.sort == %w[profiles version] && document["version"] == 1
          raise ConfigurationError.new(:invalid_profile, "profile document must contain only version 1 and profiles")
        end

        profiles = document["profiles"]
        raise ConfigurationError.new(:invalid_profile, "profiles must be an object") unless profiles.is_a?(Hash)

        normalized = profiles.to_h { |name, values| [name.to_s, validate_profile!(name.to_s, values)] }
        profile = normalized[selected_name.to_s]
        raise ConfigurationError.new(:unknown_profile, "unknown profile #{selected_name}") unless profile

        arguments_for(profile)
      rescue Psych::Exception => e
        raise ConfigurationError.new(:invalid_profile, "profile YAML is unsafe or invalid",
                                     details: { error: e.class.name })
      end

      def validate_profile!(name, values)
        raise ConfigurationError.new(:invalid_profile, "profile #{name} must be an object") unless values.is_a?(Hash)

        keys = values.keys.map(&:to_s)
        unknown = keys - PROFILE_KEYS
        missing = REQUIRED_PROFILE_KEYS - keys
        unless unknown.empty?
          raise ConfigurationError.new(:invalid_profile,
                                       "profile #{name} has unknown keys: #{unknown.join(', ')}")
        end
        unless missing.empty?
          raise ConfigurationError.new(:invalid_profile,
                                       "profile #{name} is missing keys: #{missing.join(', ')}")
        end

        profile = values.transform_keys(&:to_s)
        LIMITS.each do |key, range|
          next unless profile.key?(key)

          value = profile[key]
          unless value.is_a?(Integer) && range.cover?(value)
            raise ConfigurationError.new(:invalid_profile, "profile #{name} #{key} is outside its allowed range")
          end
        end
        %w[shrink stop_on_failure].each do |key|
          unless [true, false].include?(profile[key])
            raise ConfigurationError.new(:invalid_profile, "profile #{name} #{key} must be boolean")
          end
        end
        profile.freeze
      end
      private_class_method :validate_profile!

      def arguments_for(profile)
        arguments = [
          "--runs", profile.fetch("runs").to_s,
          "--max-steps", profile.fetch("max_steps").to_s,
          "--size", profile.fetch("size").to_s,
          "--concurrency", profile.fetch("concurrency").to_s,
          "--max-shrink-attempts", profile.fetch("max_shrink_attempts").to_s,
          "--max-shrink-time-ms", profile.fetch("max_shrink_time_ms").to_s,
          profile.fetch("shrink") ? "--shrink" : "--no-shrink"
        ]
        if profile.key?("command_timeout_ms")
          arguments.push("--command-timeout-ms", profile.fetch("command_timeout_ms").to_s)
        end
        arguments << "--stop-on-failure" if profile.fetch("stop_on_failure")
        arguments.freeze
      end
      private_class_method :arguments_for
    end
  end
end
