# frozen_string_literal: true

class TestSessionsController < ApplicationController
  def create
    user = User.find(params.require(:user_id))
    session[:user_id] = user.id
    head :no_content
  end


  def show
    user = User.find(session.fetch(:user_id))
    render json: { email: user.email, role: user.role }
  end
end
