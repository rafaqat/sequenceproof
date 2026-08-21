# frozen_string_literal: true

module SequenceProof
  module Rails
    # Immutable command registration consumed by the runtime and manifest.
    CommandDefinition = Data.define(:name, :actors, :input_schema, :output_schema, :metadata, :callback)
    # Immutable actor registration and its optional authenticator.
    ActorDefinition = Data.define(:name, :authenticate)

    # Collects authentication behavior inside an actor DSL block.
    # @api private
    class ActorBuilder
      attr_reader :callback

      def authenticate(&block)
        raise ConfigurationError.new(:duplicate_authentication, "actor authentication is already defined") if @callback
        raise ConfigurationError.new(:missing_callback, "authenticate requires a block") unless block

        @callback = block
      end
    end

    # Frozen, executable representation of a registered Rails adapter.
    class AdapterDefinition
      attr_reader :name, :version, :isolation_mode, :connection_classes, :setup_callback,
                  :cleanup_callback, :reset_callback, :actors, :commands, :observation_schema,
                  :observe_callback, :invariants, :redactions

      def initialize(builder)
        @name = builder.name
        @version = builder.version
        @isolation_mode = builder.isolation_mode
        @connection_classes = builder.connection_classes.freeze
        @setup_callback = builder.setup_callback
        @cleanup_callback = builder.cleanup_callback
        @reset_callback = builder.reset_callback
        @actors = builder.actors.freeze
        @commands = builder.commands.freeze
        @observation_schema = builder.observation_schema
        @observe_callback = builder.observe_callback
        @invariants = builder.invariants.freeze
        @redactions = builder.redactions.freeze
        freeze
      end

      # Returns the stable public summary exposed by the registry.
      def descriptor
        { name:, version:, commands: commands.keys.sort.freeze, actors: actors.keys.sort.freeze,
          isolation: isolation_mode }.freeze
      end
    end

    # Evaluates and validates the public adapter registration DSL.
    class AdapterBuilder
      # Shared syntax for all wire-visible identifiers.
      IDENTIFIER = /\A[a-z0-9][a-z0-9_.-]{0,127}\z/
      JSON_POINTER_ESCAPES = %w[0 1].freeze
      private_constant :JSON_POINTER_ESCAPES
      attr_reader :name, :version, :isolation_mode, :connection_classes, :setup_callback,
                  :cleanup_callback, :reset_callback, :actors, :commands, :observation_schema,
                  :observe_callback, :invariants, :redactions

      def initialize(name, version)
        @name = identifier!(name)
        unless version.is_a?(Integer) && version.positive? && version <= 9_007_199_254_740_991
          raise ConfigurationError.new(:invalid_version, "adapter version must be a positive safe integer")
        end

        @version = version
        @actors = {}
        @commands = {}
        @invariants = {}
        @redactions = []
        @connection_classes = []
      end

      def isolation(mode, connection_classes: [])
        raise ConfigurationError.new(:duplicate_isolation, "isolation is already defined") if @isolation_mode

        mode = mode.to_sym
        raise IsolationError.new(:unsupported_isolation, "isolation must be transaction or callback") unless %i[
          transaction callback
        ].include?(mode)

        @isolation_mode = mode
        @connection_classes = Array(connection_classes).uniq
      end

      # Registers the required fresh-run setup callback.
      def setup(&block) = assign_once!(:setup_callback, block)

      # Registers best-effort resource cleanup.
      def cleanup(&block) = assign_once!(:cleanup_callback, block)

      # Registers the reset callback required by callback isolation.
      def reset(&block) = assign_once!(:reset_callback, block)

      def actor(name, &block)
        id = identifier!(name)
        raise ConfigurationError.new(:duplicate_actor, "duplicate actor #{id}") if actors.key?(id)

        builder = ActorBuilder.new
        builder.instance_eval(&block) if block
        actors[id] = ActorDefinition.new(id, builder.callback)
      end

      def command(name, actors:, input:, output: Schema.any_json, metadata: {}, &block)
        id = identifier!(name)
        raise ConfigurationError.new(:duplicate_command, "duplicate command #{id}") if commands.key?(id)
        raise ConfigurationError.new(:missing_callback, "command #{id} requires a block") unless block

        actor_ids = Array(actors).map { |actor| identifier!(actor) }.uniq.sort.freeze
        normalized_metadata = Json.deep_freeze(Json.normalize(metadata))
        unless normalized_metadata.is_a?(Hash)
          raise ConfigurationError.new(:invalid_metadata, "command metadata must be a JSON object")
        end

        commands[id] = CommandDefinition.new(
          id, actor_ids, Schema.raw(input), Schema.raw(output), normalized_metadata, block
        )
      end

      def observe(schema:, &block)
        raise ConfigurationError.new(:duplicate_observer, "observe is already defined") if @observe_callback
        raise ConfigurationError.new(:missing_callback, "observe requires a block") unless block

        @observation_schema = Schema.raw(schema)
        @observe_callback = block
      end

      def invariant(name, &block)
        id = identifier!(name)
        raise ConfigurationError.new(:duplicate_invariant, "duplicate invariant #{id}") if invariants.key?(id)
        raise ConfigurationError.new(:missing_callback, "invariant #{id} requires a block") unless block

        invariants[id] = block
      end

      # Adds RFC 6901 JSON pointers removed from protocol responses.
      def redact(*json_pointers)
        json_pointers.map(&:to_s).each do |pointer|
          unless valid_redaction_pointer?(pointer)
            raise ConfigurationError.new(:invalid_redaction_pointer, "invalid JSON pointer: #{pointer}")
          end

          redactions << pointer unless redactions.include?(pointer)
        end
      end

      def build
        @isolation_mode ||= :transaction
        if @isolation_mode == :transaction && @connection_classes.empty? && defined?(::ApplicationRecord)
          @connection_classes = [::ApplicationRecord]
        end
        if @isolation_mode == :transaction && @connection_classes.empty?
          raise IsolationError.new(:missing_connection_classes,
                                   "transaction isolation requires at least one connection class")
        end
        unless @connection_classes.all? { |connection_class| connection_class.respond_to?(:connection) }
          raise IsolationError.new(:invalid_connection_class,
                                   "connection classes must expose an Active Record connection")
        end
        raise ConfigurationError.new(:missing_setup, "adapter requires setup") unless setup_callback
        raise ConfigurationError.new(:missing_observer, "adapter requires observe") unless observe_callback
        raise ConfigurationError.new(:missing_command, "adapter requires at least one command") if commands.empty?
        if @isolation_mode == :callback && !reset_callback
          raise IsolationError.new(:missing_reset, "callback isolation requires reset")
        end

        unknown_actors = commands.values.flat_map(&:actors).uniq - actors.keys
        unless unknown_actors.empty?
          raise ConfigurationError.new(:unknown_actor,
                                       "commands reference unknown actors: #{unknown_actors.join(', ')}")
        end

        AdapterDefinition.new(self)
      end

      private

      def valid_redaction_pointer?(pointer)
        return true if pointer.empty?
        return false unless pointer.start_with?("/")

        index = pointer.index("~")
        while index
          escape = pointer[index + 1]
          return false unless JSON_POINTER_ESCAPES.include?(escape)

          index = pointer.index("~", index + 2)
        end
        true
      end

      def identifier!(value)
        candidate = value.to_s
        unless IDENTIFIER.match?(candidate)
          raise ConfigurationError.new(:invalid_identifier,
                                       "invalid SequenceProof identifier: #{candidate}")
        end

        candidate.freeze
      end

      def assign_once!(name, block)
        raise ConfigurationError.new(:missing_callback, "#{name} requires a block") unless block
        if instance_variable_get("@#{name}")
          raise ConfigurationError.new(:duplicate_callback,
                                       "#{name} is already defined")
        end

        instance_variable_set("@#{name}", block)
      end
    end
  end
end
