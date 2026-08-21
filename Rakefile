# frozen_string_literal: true

require "bundler/gem_tasks"
require "rspec/core/rake_task"
require "yard"

RSpec::Core::RakeTask.new(:spec)
desc "Build, inspect, install, and boot the local gem artifact"
task "package:smoke" do
  ruby "scripts/gem_smoke.rb"
end
YARD::Rake::YardocTask.new(:docs)
task default: :spec
