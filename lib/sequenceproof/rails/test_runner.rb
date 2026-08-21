# frozen_string_literal: true

require "open3"

module SequenceProof
  module Rails
    # Safe subprocess facade used by generated RSpec and Minitest tests.
    module TestRunner
      # Immutable subprocess result returned by {check}.
      Result = Data.define(:status, :stdout, :stderr, :exitstatus)

      module_function

      def check(model:, adapter:, profile: "smoke", env: {})
        model_path = File.expand_path(model.to_s)
        raise ConfigurationError.new(:missing_model, "SequenceProof model does not exist") unless File.file?(model_path)

        model_name = File.basename(model_path, File.extname(model_path))
        unless model_name.match?(AdapterBuilder::IDENTIFIER) && profile.to_s.match?(AdapterBuilder::IDENTIFIER)
          raise ConfigurationError.new(:invalid_identifier, "model and profile must be SequenceProof identifiers")
        end
        unless adapter.to_s == model_name
          raise ConfigurationError.new(:adapter_mismatch,
                                       "test helper requires adapter to match the model filename")
        end
        expected_path = ::Rails.root.join("sequenceproof/models/#{model_name}.ts").expand_path.to_s
        unless model_path == expected_path
          raise ConfigurationError.new(:model_path_mismatch,
                                       "test helper model must be #{expected_path}")
        end

        task = "sequenceproof:check[#{model_name},#{profile}]"
        stdout, stderr, process = Open3.capture3({ "RAILS_ENV" => "test" }.merge(env.transform_keys(&:to_s)),
                                                 ::Rails.root.join("bin/rails").to_s, task)
        status = if process.success?
                   :passed
                 else
                   process.exitstatus == 2 ? :failed : :errored
                 end
        Result.new(status, stdout, stderr, process.exitstatus)
      end

      # Runs {check} and raises a protocol error unless it passes.
      def check!(**)
        result = check(**)
        unless result.status == :passed
          raise ProtocolError.new(:check_failed, "SequenceProof check failed",
                                  details: { exitstatus: result.exitstatus })
        end

        result
      end
    end
  end
end
