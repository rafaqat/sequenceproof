# frozen_string_literal: true

require_relative "lib/sequenceproof/rails/version"

Gem::Specification.new do |spec|
  spec.name = "sequenceproof-rails"
  spec.version = SequenceProof::Rails::VERSION
  spec.authors = ["SequenceProof contributors"]
  spec.email = ["174465+rafaqat@users.noreply.github.com"]
  spec.summary = "Rails adapter and test-only engine for SequenceProof model-based testing"
  spec.description = "Exercise stateful Rails behavior through explicit, schema-validated test adapters."
  spec.homepage = "https://github.com/rafaqat/sequenceproof"
  spec.license = "MIT"
  spec.required_ruby_version = ">= 3.2"
  spec.files = Dir.chdir(__dir__) do
    files = `git ls-files --cached --others --exclude-standard -z`.split("\x0")
    files.grep(/\A(?:app|config|lib|schemas|README|LICENSE|CHANGELOG)/)
  end
  spec.require_paths = ["lib"]
  spec.metadata = {
    "homepage_uri" => spec.homepage,
    "source_code_uri" => spec.homepage,
    "changelog_uri" => "#{spec.homepage}/blob/main/CHANGELOG.md",
    "bug_tracker_uri" => "#{spec.homepage}/issues",
    "documentation_uri" => "#{spec.homepage}/tree/main/docs",
    "rubygems_mfa_required" => "true"
  }
  spec.add_dependency "json-canonicalization", "~> 1.0"
  spec.add_dependency "json_schemer", ">= 2.4", "< 3.0"
  spec.add_dependency "rails", ">= 7.1", "< 9.0"
end
