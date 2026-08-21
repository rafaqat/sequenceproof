# frozen_string_literal: true

SequenceProof::Rails::Engine.routes.draw do
  scope :v1, defaults: { format: :json } do
    get "health", to: "v1/protocol#health"
    get "adapters/:adapter/manifest", to: "v1/protocol#manifest"
    post "adapters/:adapter/runs", to: "v1/protocol#create_run"
    get "runs/:run_id/observation", to: "v1/protocol#observation"
    post "runs/:run_id/commands/:command_id", to: "v1/protocol#command"
    post "runs/:run_id/reset", to: "v1/protocol#reset"
    delete "runs/:run_id", to: "v1/protocol#destroy"
  end
end
