# frozen_string_literal: true

require_relative "test_runner"

module SequenceProof
  module Rails
    # Explicit Minitest-facing wrappers around {TestRunner}.
    module Minitest
      module_function

      # Runs a generated model check and returns its structured result.
      def check(...) = TestRunner.check(...)
      # Runs a generated model check and raises unless it passes.
      def check!(...) = TestRunner.check!(...)
    end
  end
end
