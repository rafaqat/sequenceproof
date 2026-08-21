# frozen_string_literal: true

class AuditEventJob < ApplicationJob
  def perform(tenant_id:, action:, reference: nil)
    AuditEvent.create!(tenant_id:, action:, reference:)
  end
end
