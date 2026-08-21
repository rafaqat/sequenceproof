# frozen_string_literal: true

module SequenceProof
  module Rails
    module V1
      class ProtocolController < ::ActionController::API
        IDENTIFIER = /\A[a-z0-9][a-z0-9_.-]{0,127}\z/

        # This JSON API deliberately accepts no cookie or session authentication. Every route,
        # including health, requires the explicit bearer token below, so a browser-originated
        # cross-site request cannot authenticate by ambient authority.
        before_action :authenticate!
        before_action :enforce_request_size!

        rescue_from StandardError, with: :render_internal_error
        rescue_from JSON::ParserError, with: :render_invalid_json
        rescue_from SequenceProof::Rails::Error, with: :render_sequenceproof_error

        def health
          render json: envelope("status" => "ok", "version" => VERSION)
        end

        def manifest
          adapter = identifier_param!(:adapter)
          render json: safe_json(Manifest.build(SequenceProof::Rails.fetch_adapter(adapter), request_id: request_id))
        end

        def create_run
          body = body!(required: %w[seed metadata], allowed: %w[seed metadata])
          raise ProtocolError.new(:invalid_seed, "seed must be a string") unless body["seed"].is_a?(String)
          raise ProtocolError.new(:invalid_metadata, "metadata must be an object") unless body["metadata"].is_a?(Hash)

          runtime, snapshot = SequenceProof::Rails.run_registry.create(
            adapter: SequenceProof::Rails.fetch_adapter(identifier_param!(:adapter)),
            seed: body.fetch("seed"),
            metadata: body.fetch("metadata")
          )
          render json: envelope(snapshot.merge("run_id" => runtime.run_id)), status: :created
        end

        def observation
          render json: envelope(SequenceProof::Rails.run_registry.fetch(identifier_param!(:run_id)).snapshot)
        end

        def command
          body = body!(required: %w[actor input step manifest_digest], allowed: %w[actor input step manifest_digest])
          raise ProtocolError.new(:invalid_actor, "actor must be a string") unless body["actor"].is_a?(String)
          unless body["step"].is_a?(Integer) && body["step"] >= 0
            raise ProtocolError.new(:invalid_step,
                                    "step must be a non-negative integer")
          end
          unless body["manifest_digest"].is_a?(String)
            raise ProtocolError.new(:invalid_manifest_digest,
                                    "manifest_digest must be a string")
          end

          result = SequenceProof::Rails.run_registry.fetch(identifier_param!(:run_id)).execute(
            command_name: identifier_param!(:command_id), actor: body.fetch("actor"), input: body.fetch("input"),
            step: body.fetch("step"), manifest_digest: body.fetch("manifest_digest")
          )
          render json: envelope(result)
        end

        def reset
          body = body!(required: %w[attempt reason], allowed: %w[attempt reason])
          unless body["attempt"].is_a?(Integer) && body["attempt"].between?(0, 1_000_000)
            raise ProtocolError.new(:invalid_attempt, "attempt must be a bounded non-negative integer")
          end
          unless %w[shrink replay manual].include?(body["reason"])
            raise ProtocolError.new(:invalid_reset_reason, "reset reason is invalid")
          end

          render json: envelope(SequenceProof::Rails.run_registry.fetch(identifier_param!(:run_id)).reset!)
        end

        def destroy
          SequenceProof::Rails.run_registry.delete(identifier_param!(:run_id))
          render json: envelope("deleted" => true)
        end

        private

        def request_id = request.request_id.presence || SecureRandom.hex(12)

        def envelope(payload)
          { "protocol" => "sequenceproof.protocol", "protocol_version" => PROTOCOL_VERSION,
            "request_id" => request_id }.merge(payload)
        end

        def safe_json(value)
          Json.redact(value, pointers: [], callback: SequenceProof::Rails.configuration.redact)
        end

        def identifier_param!(name)
          value = params.fetch(name).to_s
          raise ProtocolError.new(:invalid_identifier, "invalid #{name}") unless IDENTIFIER.match?(value)

          value
        end

        def authenticate!
          expected = SequenceProof::Rails.configuration.resolved_token
          header = request.authorization.to_s
          actual = header.start_with?("Bearer ") ? header.delete_prefix("Bearer ") : ""
          valid = expected.bytesize == actual.bytesize && ::ActiveSupport::SecurityUtils.secure_compare(expected,
                                                                                                        actual)
          raise AuthenticationError.new(:unauthorized, "authentication required") unless valid
        end

        def enforce_request_size!
          length = request.content_length.to_i
          return if length <= SequenceProof::Rails.configuration.max_request_bytes

          raise ProtocolError.new(:request_too_large, "request body is too large")
        end

        def body!(required:, allowed:)
          unless request.media_type == "application/json"
            raise ProtocolError.new(:invalid_content_type,
                                    "Content-Type must be application/json")
          end

          raw = request.raw_post
          if raw.bytesize > SequenceProof::Rails.configuration.max_request_bytes
            raise ProtocolError.new(:request_too_large, "request body is too large")
          end

          value = JSON.parse(raw)
          raise ProtocolError.new(:invalid_body, "request body must be an object") unless value.is_a?(Hash)

          unknown = value.keys - allowed
          missing = required - value.keys
          unless unknown.empty?
            raise ProtocolError.new(:unknown_members,
                                    "unknown request members: #{unknown.join(', ')}")
          end
          unless missing.empty?
            raise ProtocolError.new(:missing_members,
                                    "missing request members: #{missing.join(', ')}")
          end

          value
        end

        def render_sequenceproof_error(error)
          status = case error
                   when AuthenticationError then :unauthorized
                   when RunNotFoundError, UnknownAdapterError, UnknownCommandError then :not_found
                   when RunExpiredError then :gone
                   when StepConflictError then :conflict
                   when SchemaError then :unprocessable_content
                   when UnknownActorError then :forbidden
                   else :bad_request
                   end
          notify_protocol_error(error.code, status)
          render_problem(error.code, error.class.name.demodulize, status, safe_detail(error.message), error.details)
        end

        def render_invalid_json(_error)
          notify_protocol_error(:invalid_json, :bad_request)
          render_problem(:invalid_json, "Invalid JSON", :bad_request, "request body is not valid JSON")
        end

        def render_internal_error(error)
          SequenceProof::Rails.configuration.logger&.error("SequenceProof protocol error: #{error.class}")
          notify_protocol_error(:internal_error, :internal_server_error)
          detail = if SequenceProof::Rails.configuration.debug_errors
                     safe_detail(error.message)
                   else
                     "command execution failed"
                   end
          render_problem(:internal_error, "Internal error", :internal_server_error, detail)
        end

        def safe_detail(detail)
          safe_json({ "detail" => detail.to_s }).fetch("detail").to_s
        end

        def notify_protocol_error(code, status)
          numeric = ::Rack::Utils::SYMBOL_TO_STATUS_CODE.fetch(status)
          ::ActiveSupport::Notifications.instrument("sequenceproof.protocol.error", code: code.to_s, status: numeric,
                                                                                    request_id: request_id)
        end

        def render_problem(code, title, status, detail, details = nil)
          numeric = ::Rack::Utils::SYMBOL_TO_STATUS_CODE.fetch(status)
          errors = details.is_a?(Hash) ? details[:errors] || details["errors"] : nil
          payload = { "type" => "urn:sequenceproof:problem:#{code}", "title" => title, "status" => numeric,
                      "code" => code.to_s, "detail" => detail, "request_id" => request_id }
          payload["errors"] = errors if errors
          render json: safe_json(payload), status:
        end
      end
    end
  end
end
