# frozen_string_literal: true

module SequenceProof
  module Rails
    # Validates configuration and mounts the Engine during Rails boot.
    class Railtie < ::Rails::Railtie
      initializer "sequenceproof.validate_configuration", after: :load_config_initializers do |app|
        configuration = SequenceProof::Rails.configuration
        configuration.logger ||= ::Rails.logger
        configuration.finalize!(environment: ::Rails.env) unless configuration.finalized?
        next unless configuration.enabled_for?(::Rails.env)

        mount_path = configuration.mount_path
        app.routes.append do
          mount SequenceProof::Rails::Engine => mount_path, as: :sequenceproof_rails
        end
      end
    end
  end
end
