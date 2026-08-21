# frozen_string_literal: true

module SequenceProof
  module Rails
    # Per-run trusted state and isolated actor sessions available to adapters.
    class RunContext
      attr_reader :run_id, :seed, :metadata

      def initialize(run_id:, seed:, metadata:)
        @run_id = run_id
        @seed = seed
        @metadata = Json.deep_freeze(Json.normalize(metadata))
        @store = {}
        @sessions = {}
      end

      # Stores an application object under a symbolic handle for this run.
      def store(key, value)
        @store[key.to_sym] = value
        value
      end

      # Fetches a previously stored run handle.
      def fetch(key) = @store.fetch(key.to_sym)
      def key?(key) = @store.key?(key.to_sym)

      # Returns the isolated Rails integration session for an actor.
      def session(actor)
        @sessions[actor.to_s] ||= ::ActionDispatch::Integration::Session.new(::Rails.application)
      end

      # Clears all stored handles and actor sessions.
      # @api private
      def clear!
        @store.clear
        @sessions.clear
      end

      def assert!(condition, message, details: nil)
        raise InvariantViolation.new(:assertion_failed, message, details:) unless condition

        true
      end

      # Raises an invariant violation unless a session has the expected status.
      def assert_response!(session, expected)
        expected_status = if expected.is_a?(Symbol)
                            ::Rack::Utils::SYMBOL_TO_STATUS_CODE.fetch(expected)
                          else
                            Integer(expected)
                          end
        assert!(session.response.status == expected_status,
                "expected HTTP #{expected_status}, got #{session.response.status}")
      end

      # Emits a namespaced notification with an allow-listed JSON payload.
      def instrument(name, payload = {}, &)
        safe_payload = Json.normalize(payload).slice("id", "status", "duration_ms")
        ::ActiveSupport::Notifications.instrument("sequenceproof.adapter.#{name}", safe_payload, &)
      end
    end

    # Trusted command callback facade for real Rails request dispatch.
    class CommandContext
      attr_reader :run, :actor, :step

      def initialize(run:, actor:, step:)
        @run = run
        @actor = actor.to_s
        @step = step
      end

      # Returns the current actor's isolated integration session.
      def session = run.session(actor)

      # Returns the most recent application response for the actor.
      def response = session.response

      %i[get post put patch delete].each do |method|
        define_method(method) do |path, **options|
          session.public_send(method, path, **options)
        end
      end

      # Follows the current actor session's redirect.
      def follow_redirect!(**) = session.follow_redirect!(**)

      # Parses the current application response as JSON.
      def parsed_json
        JSON.parse(response.body)
      rescue JSON::ParserError
        raise ProtocolError.new(:invalid_json_response, "application response is not valid JSON")
      end

      # Builds a successful command outcome.
      def ok(value = nil) = { "status" => "ok", "value" => Json.normalize(value) }

      # Builds an expected application-rejection outcome.
      def rejected(code:, value: nil)
        result = { "status" => "rejected", "code" => code.to_s }
        result["value"] = Json.normalize(value) unless value.nil?
        result
      end

      # Delegates an adapter assertion to the owning run context.
      def assert!(...) = run.assert!(...)
    end
  end
end
