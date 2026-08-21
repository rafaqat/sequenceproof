# frozen_string_literal: true

require "timeout"

module SequenceProof
  module Rails
    # Serializes one run on its own thread and owns its database boundaries.
    # @api private
    class Executor
      # Internal callback result transported across the executor queue.
      Result = Data.define(:value, :error)
      # Internal unit of work transported across the executor queue.
      Job = Data.define(:kind, :callback, :reply, :timeout, :atomic)

      def initialize(mode:, connection_classes:)
        @mode = mode
        @connection_classes = connection_classes
        @jobs = Queue.new
        @ready = Queue.new
        @thread = Thread.new { work }
        @thread.name = "sequenceproof-run-executor" if @thread.respond_to?(:name=)
        ready = @ready.pop
        raise ready if ready.is_a?(Exception)
      end

      def call(timeout: nil, atomic: false, &block)
        raise IsolationError.new(:executor_stopped, "run executor is stopped") unless @thread&.alive?

        reply = Queue.new
        @jobs << Job.new(:call, block, reply, timeout, atomic)
        result = reply.pop
        raise result.error if result.error

        result.value
      end

      # Rolls back the current outer transaction cycle and begins a fresh one.
      def reset!
        control!(:reset)
      end

      # Stops the executor after rolling back its active transaction cycle.
      def stop!
        return unless @thread

        control!(:stop) if @thread.alive?
        @thread.join(5)
        raise IsolationError.new(:executor_shutdown_timeout, "run executor did not stop") if @thread.alive?
      ensure
        @thread = nil
      end

      private

      def control!(kind)
        reply = Queue.new
        @jobs << Job.new(kind, nil, reply, nil, false)
        result = reply.pop
        raise result.error if result.error
      end

      def work
        loop do
          action = if @mode == :transaction
                     with_transactions(0) { process_cycle }
                   else
                     process_cycle
                   end
          break if action == :stop
        end
      rescue Exception => e # rubocop:disable Lint/RescueException
        @ready << e if @ready.empty?
        drain_with_error(e)
      end

      def with_transactions(index, &block)
        if index == @connection_classes.length
          @cycle_action = block.call
          return @cycle_action
        end

        @connection_classes.fetch(index).connection.transaction(requires_new: true) do
          with_transactions(index + 1, &block)
          raise ::ActiveRecord::Rollback
        end
        @cycle_action
      end

      def with_savepoints(index, &block)
        return block.call if index == @connection_classes.length

        @connection_classes.fetch(index).connection.transaction(requires_new: true) do
          with_savepoints(index + 1, &block)
        end
      end

      def process_cycle
        @ready << true if @ready.empty?
        loop do
          job = @jobs.pop
          case job.kind
          when :call
            begin
              callback = -> { job.atomic ? with_savepoints(0, &job.callback) : job.callback.call }
              value = job.timeout ? Timeout.timeout(job.timeout) { callback.call } : callback.call
              job.reply << Result.new(value, nil)
            rescue Timeout::Error
              job.reply << Result.new(nil, ProtocolError.new(:request_timeout, "SequenceProof operation timed out"))
            rescue Exception => e # rubocop:disable Lint/RescueException
              job.reply << Result.new(nil, e)
            end
          when :reset, :stop
            job.reply << Result.new(true, nil)
            return job.kind
          end
        end
      end

      def drain_with_error(error)
        loop do
          job = @jobs.pop(true)
          job.reply << Result.new(nil, error)
        rescue ThreadError
          break
        end
      end
    end
  end
end
