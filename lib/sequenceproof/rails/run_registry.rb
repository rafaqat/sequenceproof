# frozen_string_literal: true

require "securerandom"

module SequenceProof
  module Rails
    # Thread-safe, bounded registry of live protocol runs and expiry tombstones.
    class RunRegistry
      def initialize
        @mutex = Mutex.new
        @runs = {}
        @expired = []
      end

      # Creates, starts, and registers a fresh runtime.
      def create(adapter:, seed:, metadata:)
        cleanup_expired!
        runtime = nil
        @mutex.synchronize do
          if @runs.length >= SequenceProof::Rails.configuration.max_runs
            raise ProtocolError.new(:run_limit, "maximum active SequenceProof runs reached")
          end

          run_id = "run-#{SecureRandom.hex(16)}"
          runtime = Runtime.new(run_id:, adapter:, seed:, metadata:)
          @runs[run_id] = runtime
        end
        [runtime, runtime.start!]
      rescue Exception => e # rubocop:disable Lint/RescueException
        begin
          delete(runtime.run_id) if runtime
        rescue Exception # rubocop:disable Lint/RescueException
          nil
        end
        raise e
      end

      def fetch(run_id)
        cleanup_expired!
        key = run_id.to_s
        runtime, expired = @mutex.synchronize { [@runs[key], @expired.include?(key)] }
        return runtime if runtime
        raise RunExpiredError.new(:run_expired, "run expired") if expired

        raise RunNotFoundError.new(:run_not_found, "run not found")
      end

      # Idempotently removes and disposes a run.
      def delete(run_id)
        key = run_id.to_s
        runtime = @mutex.synchronize do
          @expired.delete(key)
          @runs.delete(key)
        end
        runtime&.dispose!
        true
      end

      # Disposes every live run and clears expiry tombstones.
      # @api private
      def clear
        runtimes = @mutex.synchronize do
          @expired.clear
          @runs.values.tap { @runs.clear }
        end
        error = nil
        runtimes.each do |runtime|
          runtime.dispose!
        rescue Exception => e # rubocop:disable Lint/RescueException
          error ||= e
        end
        raise error if error
      end

      # Returns the current number of active runs.
      def size = @mutex.synchronize { @runs.size }

      private

      def cleanup_expired!
        expired = @mutex.synchronize do
          @runs.values.select { |runtime| runtime.expired?(SequenceProof::Rails.configuration.run_ttl) }
               .tap do |runtimes|
                 runtimes.each do |runtime|
                   @runs.delete(runtime.run_id)
                   @expired << runtime.run_id
                 end
                 @expired.shift while @expired.length > 1024
               end
        end
        expired.each do |runtime|
          runtime.dispose!
        rescue Exception => e # rubocop:disable Lint/RescueException
          SequenceProof::Rails.configuration.logger&.error("SequenceProof expired run cleanup error: #{e.class}")
        end
      end
    end
  end
end
