# frozen_string_literal: true

SequenceProofDummy::Application.configure do
  config.cache_classes = true
  config.eager_load = false
  config.public_file_server.enabled = false
  config.consider_all_requests_local = false
  config.action_controller.allow_forgery_protection = false
end
