# frozen_string_literal: true

require "fileutils"
require "open3"
require "rbconfig"
require "rubygems/package"
require "tmpdir"

ROOT = File.expand_path("..", __dir__)

Dir.mktmpdir("sequenceproof-gem-smoke-") do |directory|
  package = File.join(directory, "sequenceproof-rails.gem")
  stdout, stderr, status = Open3.capture3("gem", "build", "sequenceproof-rails.gemspec", "--output", package,
                                          chdir: ROOT)
  abort("gem build failed\n#{stdout}\n#{stderr}") unless status.success?

  files = Gem::Package.new(package).spec.files
  %w[README.md LICENSE.txt CHANGELOG.md config/routes.rb lib/sequenceproof/rails.rb
     schemas/protocol-v1.schema.json].each do |required|
    abort("packed gem is missing #{required}") unless files.include?(required)
  end
  forbidden = files.grep(%r{\A(?:spec|packages|node_modules|\.github)/})
  abort("packed gem contains development files: #{forbidden.join(', ')}") unless forbidden.empty?

  gem_home = File.join(directory, "gems")
  install = system("gem", "install", package, "--install-dir", gem_home, "--ignore-dependencies", "--no-document",
                   out: File::NULL)
  abort("gem install failed") unless install

  script = <<~RUBY
    require "rails"
    require "sequenceproof/rails"
    abort "wrong version" unless SequenceProof::Rails::VERSION == "0.1.0"
    class PackedSequenceProofApp < Rails::Application
      config.eager_load = false
      config.secret_key_base = "packed-sequenceproof-smoke-secret-key"
      config.logger = Logger.new(nil)
    end
    PackedSequenceProofApp.initialize!
    abort "engine did not initialize" unless SequenceProof::Rails.enabled?
  RUBY
  environment = {
    "BUNDLE_GEMFILE" => nil,
    "RUBYOPT" => nil,
    "RUBYLIB" => nil,
    "RAILS_ENV" => "test",
    "SEQUENCEPROOF_TOKEN" => "packed-gem-token-#{'x' * 48}",
    "GEM_HOME" => gem_home,
    "GEM_PATH" => ([gem_home] + Gem.path).uniq.join(File::PATH_SEPARATOR)
  }
  output, error, smoke = Open3.capture3(environment, RbConfig.ruby, "-e", script, chdir: directory)
  abort("packed gem boot failed\n#{output}\n#{error}") unless smoke.success?

  puts "gem package smoke passed for #{File.basename(package)}"
end
