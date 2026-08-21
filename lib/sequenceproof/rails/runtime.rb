# frozen_string_literal: true

require "digest"

module SequenceProof
  module Rails
    # Serialized lifecycle and protocol semantics for one adapter run.
    # @api private
    class Runtime
      # Hard upper bound for monotonically numbered command steps.
      MAX_COMMANDS = 100_000

      # Opaque server-generated identifier for this run.
      attr_reader :run_id
      # Frozen adapter definition executed by this run.
      attr_reader :adapter
      # Monotonic timestamp used for TTL expiry.
      attr_reader :last_touched

      def initialize(run_id:, adapter:, seed:, metadata:)
        @run_id = run_id
        @adapter = adapter
        @context = RunContext.new(run_id:, seed:, metadata:)
        @executor = Executor.new(mode: adapter.isolation_mode, connection_classes: adapter.connection_classes)
        @operation_mutex = Mutex.new
        @authenticated = {}
        @completed_steps = {}
        @next_step = 0
        @disposed = false
        touch!
      end

      # Executes setup and returns the initial redacted snapshot.
      def start!
        with_operation do
          notify("sequenceproof.run.start", run_id:, adapter: adapter.name)
          executor_call { adapter.setup_callback.call(@context) }
          redact(executor_call { snapshot_inside })
        end
      rescue Exception => e # rubocop:disable Lint/RescueException
        begin
          dispose!
        rescue Exception # rubocop:disable Lint/RescueException
          nil
        end
        raise e
      end

      # Returns the current redacted observation and server assertions.
      def snapshot
        with_operation do
          touch!
          redact(executor_call { snapshot_inside })
        end
      end

      # Validates and atomically executes one idempotent command step.
      def execute(command_name:, actor:, input:, step:, manifest_digest:)
        with_operation do
          touch!
          validate_step!(step)
          manifest = Manifest.build(adapter, request_id: "digest")
          unless secure_equal?(manifest.fetch("digest"), manifest_digest)
            raise ProtocolError.new(:manifest_mismatch, "adapter manifest digest changed")
          end

          command = adapter.commands[command_name.to_s]
          raise UnknownCommandError.new(:unknown_command, "unknown command") unless command

          actor = actor.to_s
          raise UnknownActorError.new(:unknown_actor, "unknown actor") unless adapter.actors.key?(actor)
          unless command.actors.include?(actor)
            raise UnknownActorError.new(:actor_not_permitted, "actor is not permitted for this command")
          end

          input = Json.normalize(input)
          Schema.validate!(command.input_schema, input, label: "command input")
          fingerprint = command_fingerprint(command:, actor:, input:, manifest_digest:)
          return completed_response(step, fingerprint) if @completed_steps.key?(step)

          raise StepConflictError.new(:step_out_of_order, "expected step #{@next_step}") unless step == @next_step

          notify("sequenceproof.command.start", run_id:, command: command.name, actor:, step:)
          status = "error"
          response = executor_call(atomic: true) do
            authenticate!(actor)
            context = CommandContext.new(run: @context, actor:, step:)
            configuration.before_command.call(context)
            outcome = validate_outcome!(command, command.callback.call(context, input))
            configuration.after_command.call(context)
            snapshot_inside.merge("outcome" => outcome)
          end
          status = "ok"
          response = Json.deep_freeze(redact(response))
          @completed_steps[step] = { fingerprint:, response: }
          @next_step += 1
          response
        ensure
          if status
            notify("sequenceproof.command.finish", run_id:, command: command_name.to_s, actor: actor.to_s, step:,
                                                   status:)
          end
        end
      end

      # Restores isolation, resets sessions/state, and repeats setup.
      def reset!
        with_operation do
          touch!
          notify("sequenceproof.run.reset", run_id:, adapter: adapter.name)
          if adapter.isolation_mode == :callback
            executor_call do
              adapter.reset_callback.call(@context)
              @context.clear!
            end
          else
            begin
              executor_call { adapter.cleanup_callback&.call(@context) }
            ensure
              @executor.reset!
            end
            executor_call { @context.clear! }
          end
          @authenticated.clear
          @completed_steps.clear
          @next_step = 0
          executor_call { adapter.setup_callback.call(@context) }
          redact(executor_call { snapshot_inside })
        end
      end

      # Runs cleanup and permanently stops this run's executor.
      def dispose!
        with_operation(wait: true) do
          unless @disposed
            @disposed = true
            begin
              executor_call { adapter.cleanup_callback&.call(@context) }
            ensure
              @executor.stop!
              notify("sequenceproof.run.finish", run_id:, adapter: adapter.name)
            end
          end
        end
      end

      def expired?(ttl)
        monotonic_now - last_touched > ttl.to_f
      end

      private

      def configuration = SequenceProof::Rails.configuration
      def touch! = @last_touched = monotonic_now
      def monotonic_now = Process.clock_gettime(Process::CLOCK_MONOTONIC)

      def with_operation(wait: false)
        locked = wait ? @operation_mutex.lock : @operation_mutex.try_lock
        raise StepConflictError.new(:run_busy, "another operation is active for this run") unless locked

        yield
      ensure
        @operation_mutex.unlock if locked
      end

      def executor_call(atomic: false, &)
        @executor.call(timeout: configuration.request_timeout.to_f, atomic:, &)
      end

      def notify(name, payload)
        ::ActiveSupport::Notifications.instrument(name, payload)
      end

      def redact(value)
        Json.redact(value, pointers: adapter.redactions, callback: configuration.redact)
      end

      def validate_step!(step)
        return if step.is_a?(Integer) && step.between?(0, MAX_COMMANDS - 1)

        raise ProtocolError.new(:invalid_step, "step must be an integer from 0 to #{MAX_COMMANDS - 1}")
      end

      def command_fingerprint(command:, actor:, input:, manifest_digest:)
        Digest::SHA256.hexdigest(Json.canonical({ command: command.name, actor:, input:, manifest_digest: }))
      end

      def completed_response(step, fingerprint)
        completed = @completed_steps.fetch(step)
        unless secure_equal?(completed.fetch(:fingerprint), fingerprint)
          raise StepConflictError.new(:step_conflict, "step retry payload differs")
        end

        completed.fetch(:response)
      end

      def authenticate!(actor)
        return if @authenticated[actor]

        definition = adapter.actors.fetch(actor)
        definition.authenticate&.call(@context.session(actor), @context)
        @authenticated[actor] = true
      end

      def snapshot_inside
        observation = Json.normalize(adapter.observe_callback.call(@context))
        Schema.validate!(adapter.observation_schema, observation, label: "observation")
        assertions = adapter.invariants.keys.sort.map do |name|
          started = monotonic_now
          result = adapter.invariants.fetch(name).call(@context, observation)
          normalized = normalize_assertion(result, name)
          notify("sequenceproof.invariant.finish", id: name, status: normalized.fetch("pass"),
                                                   duration_ms: (monotonic_now - started) * 1000)
          { "name" => name, "result" => normalized }
        end
        { "run_id" => run_id, "observation" => observation, "assertions" => assertions }
      end

      def normalize_assertion(value, name)
        case value
        when true then { "pass" => true }
        when false then { "pass" => false, "message" => "server invariant #{name} failed" }
        when Hash
          result = Json.normalize(value)
          unless [true, false].include?(result["pass"])
            raise InvariantViolation.new(:invalid_invariant_result, "invariant #{name} returned an invalid result")
          end

          result
        else
          raise InvariantViolation.new(:invalid_invariant_result, "invariant #{name} must return boolean or assertion")
        end
      end

      def validate_outcome!(command, outcome)
        outcome = Json.normalize(outcome)
        unless outcome.is_a?(Hash) && %w[ok rejected].include?(outcome["status"])
          raise ProtocolError.new(:invalid_outcome, "command must return ok or rejected")
        end

        if outcome["status"] == "ok"
          unless outcome.keys.sort == %w[status value]
            raise ProtocolError.new(:invalid_outcome, "ok outcome requires exactly status and value")
          end
        else
          unless (outcome.keys - %w[status code value]).empty? && outcome.keys.sort.first(2) == %w[code status]
            raise ProtocolError.new(:invalid_outcome, "rejected outcome requires code and permits an optional value")
          end
          unless AdapterBuilder::IDENTIFIER.match?(outcome.fetch("code").to_s) && outcome["code"].is_a?(String)
            raise ProtocolError.new(:invalid_outcome, "rejected outcome code must be a SequenceProof identifier")
          end
        end
        Schema.validate!(command.output_schema, outcome["value"], label: "command output") if outcome.key?("value")
        outcome
      end

      def secure_equal?(left, right)
        left = left.to_s
        right = right.to_s
        return false unless left.bytesize == right.bytesize

        ::ActiveSupport::SecurityUtils.secure_compare(left, right)
      end
    end
  end
end
