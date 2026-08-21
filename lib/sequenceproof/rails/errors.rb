# frozen_string_literal: true

module SequenceProof
  module Rails
    # Base error carrying a stable machine-readable code and optional details.
    class Error < StandardError
      attr_reader :code, :details

      def initialize(code, message, details: nil)
        super(message)
        @code = code.to_s
        @details = details
      end
    end

    # Invalid framework or adapter configuration.
    class ConfigurationError < Error; end
    # Attempt to register an existing adapter identifier.
    class DuplicateAdapterError < Error; end
    # Requested adapter is not registered.
    class UnknownAdapterError < Error; end
    # Requested command is not registered.
    class UnknownCommandError < Error; end
    # Actor is unknown or not permitted for a command.
    class UnknownActorError < Error; end
    # JSON Schema construction or validation failure.
    class SchemaError < Error; end
    # Missing or invalid protocol authentication.
    class AuthenticationError < Error; end
    # Requested run identifier was never registered.
    class RunNotFoundError < Error; end
    # Requested run was removed after exceeding its TTL.
    class RunExpiredError < Error; end
    # Concurrent, stale, reordered, or changed step request.
    class StepConflictError < Error; end
    # Unsafe or failed test-state isolation.
    class IsolationError < Error; end
    # Adapter assertion or invariant failure.
    class InvariantViolation < Error; end
    # Malformed or incompatible protocol operation.
    class ProtocolError < Error; end
  end
end
