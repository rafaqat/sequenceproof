# frozen_string_literal: true

class AuditEvent < ApplicationRecord
  belongs_to :tenant
end

