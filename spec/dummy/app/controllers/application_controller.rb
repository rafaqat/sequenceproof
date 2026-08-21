# frozen_string_literal: true

class ApplicationController < ActionController::Base
  protect_from_forgery with: :exception

  private

  def current_user
    @current_user ||= User.find_by(id: session[:user_id])
  end

  def require_user!
    head :unauthorized unless current_user
  end

  def require_admin!
    return if current_user&.role == "admin"

    head :forbidden
  end
end
