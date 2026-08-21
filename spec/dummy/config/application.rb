# frozen_string_literal: true

require "rails/all"
require "sequenceproof/rails"

if ENV["SEQUENCEPROOF_ENABLE_PRODUCTION"] == "1"
  SequenceProof::Rails.configure { |configuration| configuration.enabled_environments = %w[production] }
end

if ENV["SEQUENCEPROOF_DEBUG_ERRORS"] == "1"
  SequenceProof::Rails.configure do |configuration|
    configuration.debug_errors = true
    configuration.logger = Logger.new($stderr)
  end
end

module SequenceProofDummy
  class Application < ::Rails::Application
    config.load_defaults Rails.gem_version.segments.first(2).join(".").to_f
    config.root = File.expand_path("..", __dir__)
    config.eager_load = false
    config.secret_key_base = "sequenceproof-dummy-secret-key-base-which-is-test-only"
    config.consider_all_requests_local = true
    config.action_dispatch.show_exceptions = :none
    config.active_job.queue_adapter = :inline
    config.hosts.clear
    config.session_store :cookie_store, key: "_sequenceproof_dummy_session"
    config.logger = Logger.new(nil)
  end
end
