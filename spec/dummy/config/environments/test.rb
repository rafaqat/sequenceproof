# frozen_string_literal: true

SequenceProofDummy::Application.configure do
  config.cache_classes = true
  config.eager_load = false
  config.public_file_server.enabled = false
  config.action_controller.allow_forgery_protection = false
end
