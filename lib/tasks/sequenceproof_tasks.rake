# frozen_string_literal: true

require "net/http"
require "English"
require "rbconfig"
require "securerandom"
require "socket"

namespace :sequenceproof do
  task :ephemeral_token do
    ENV["SEQUENCEPROOF_TOKEN"] ||= SecureRandom.hex(32)
  end

  task doctor: :environment do
    configuration = SequenceProof::Rails.configuration
    abort "SequenceProof is not enabled in #{Rails.env}" unless SequenceProof::Rails.enabled?
    abort "SequenceProof token is missing" if configuration.resolved_token.empty?

    cli = Rails.root.join("node_modules/.bin/sequenceproof")
    abort "Missing local SequenceProof CLI at #{cli}; install @sequenceproof/core" unless cli.file? && cli.executable?

    puts "SequenceProof #{SequenceProof::Rails::VERSION}; protocol #{SequenceProof::Rails::PROTOCOL_VERSION}"
    puts "Adapters: #{SequenceProof::Rails.adapters.map { |adapter| adapter.fetch(:name) }.join(', ')}"
  end

  task :manifest, [:adapter] => :environment do |_task, arguments|
    adapter = arguments.fetch(:adapter) { abort "usage: bin/rails 'sequenceproof:manifest[adapter]'" }
    puts JSON.pretty_generate(SequenceProof::Rails::Manifest.build(SequenceProof::Rails.fetch_adapter(adapter),
                                                                   request_id: SecureRandom.hex(12)))
  end

  def with_sequenceproof_server
    abort "SequenceProof checks run only in RAILS_ENV=test" unless Rails.env.test?
    ActiveRecord::Tasks::DatabaseTasks.check_protected_environments! if defined?(ActiveRecord::Tasks::DatabaseTasks)
    token = SecureRandom.hex(32)
    server = TCPServer.new("127.0.0.1", 0)
    port = server.addr.fetch(1)
    server.close
    rails = Rails.root.join("bin/rails")
    abort "Missing executable #{rails}" unless rails.file? && rails.executable?

    environment = { "RAILS_ENV" => "test", "SEQUENCEPROOF_TOKEN" => token }
    server_arguments = [RbConfig.ruby, rails.to_s, "server", "-e", "test", "-b", "127.0.0.1", "-p", port.to_s]
    pid = Process.spawn(environment, *server_arguments, out: $stdout, err: $stderr, pgroup: true)
    previous_int = Signal.trap("INT") do
      Process.kill("TERM", -pid)
    rescue StandardError
      nil
    end
    previous_term = Signal.trap("TERM") do
      Process.kill("TERM", -pid)
    rescue StandardError
      nil
    end
    endpoint = "http://127.0.0.1:#{port}#{SequenceProof::Rails.configuration.mount_path}/"
    deadline = Process.clock_gettime(Process::CLOCK_MONOTONIC) + 20
    loop do
      begin
        request = Net::HTTP::Get.new(URI.join(endpoint, "v1/health"))
        request["Authorization"] = "Bearer #{token}"
        response = Net::HTTP.start("127.0.0.1", port, open_timeout: 1, read_timeout: 1) { |http| http.request(request) }
        break if response.is_a?(Net::HTTPSuccess)
      rescue Errno::ECONNREFUSED, Errno::ECONNRESET, Net::OpenTimeout, Net::ReadTimeout
        nil
      end
      if Process.clock_gettime(Process::CLOCK_MONOTONIC) >= deadline
        abort "SequenceProof test server did not become healthy"
      end
      sleep 0.05
    end
    yield endpoint, token
  ensure
    Signal.trap("INT", previous_int) if previous_int
    Signal.trap("TERM", previous_term) if previous_term
    if pid
      begin
        Process.kill("TERM", -pid)
      rescue StandardError
        nil
      end
      deadline = Process.clock_gettime(Process::CLOCK_MONOTONIC) + 5
      loop do
        waited = begin
          Process.waitpid(pid, Process::WNOHANG)
        rescue StandardError
          pid
        end
        break if waited

        if Process.clock_gettime(Process::CLOCK_MONOTONIC) >= deadline
          begin
            Process.kill("KILL", -pid)
          rescue StandardError
            nil
          end
          begin
            Process.waitpid(pid)
          rescue StandardError
            nil
          end
          break
        end
        sleep 0.05
      end
    end
  end

  task :check, %i[model profile] => %i[ephemeral_token environment] do |_task, arguments|
    model = arguments.fetch(:model) { abort "usage: bin/rails 'sequenceproof:check[model,profile]'" }
    profile = arguments[:profile] || "smoke"
    abort "Rake arguments may not contain commas" if [model, profile].any? { |value| value.include?(",") }
    SequenceProof::Rails::TaskSupport.validate_identifier!(model, label: "model")
    SequenceProof::Rails::TaskSupport.validate_identifier!(profile, label: "profile")
    cli = Rails.root.join("node_modules/.bin/sequenceproof")
    model_file = Rails.root.join("sequenceproof/models/#{model}.ts")
    profile_file = Rails.root.join("sequenceproof/profiles.yml")
    abort "Missing model #{model_file}" unless model_file.file?
    abort "Missing profiles #{profile_file}" unless profile_file.file?
    abort "Missing executable local CLI #{cli}" unless cli.file? && cli.executable?
    SequenceProof::Rails.fetch_adapter(model)
    profile_arguments = SequenceProof::Rails::TaskSupport.profile_arguments(profile_file, profile)

    with_sequenceproof_server do |endpoint, token|
      env = { "SEQUENCEPROOF_TOKEN" => token,
              "SEQUENCEPROOF_SEED" => ENV.fetch("SEQUENCEPROOF_SEED", SecureRandom.hex(16)) }
      success = system(env, cli.to_s, "check", model_file.to_s, "--endpoint", endpoint, "--adapter", model,
                       "--profile", "#{profile_file}:#{profile}", *profile_arguments,
                       "--output", Rails.root.join("sequenceproof/traces").to_s)
      status = $CHILD_STATUS&.exitstatus || (success ? 0 : 1)
      exit status unless status.zero?
    end
  end

  task :replay, %i[model trace] => %i[ephemeral_token environment] do |_task, arguments|
    model = arguments.fetch(:model) { abort "usage: bin/rails 'sequenceproof:replay[model,trace]'" }
    trace = arguments.fetch(:trace) { abort "usage: bin/rails 'sequenceproof:replay[model,trace]'" }
    abort "Rake arguments may not contain commas; use the direct CLI" if trace.include?(",")
    SequenceProof::Rails::TaskSupport.validate_identifier!(model, label: "model")
    cli = Rails.root.join("node_modules/.bin/sequenceproof")
    model_file = Rails.root.join("sequenceproof/models/#{model}.ts")
    trace_root = Rails.root.join("sequenceproof/traces").expand_path
    trace_file = Rails.root.join(trace).expand_path
    abort "Missing model #{model_file}" unless model_file.file?
    inside_trace_root = trace_file.to_s.start_with?("#{trace_root}#{File::SEPARATOR}")
    abort "Trace must be a JSON file under #{trace_root}" unless inside_trace_root && trace_file.extname == ".json"
    abort "Missing trace #{trace_file}" unless trace_file.file?
    abort "Missing executable local CLI #{cli}" unless cli.file? && cli.executable?
    SequenceProof::Rails.fetch_adapter(model)
    with_sequenceproof_server do |endpoint, token|
      success = system({ "SEQUENCEPROOF_TOKEN" => token }, cli.to_s, "replay", trace_file.to_s,
                       "--model", model_file.to_s, "--endpoint", endpoint, "--adapter", model)
      status = $CHILD_STATUS&.exitstatus || (success ? 0 : 1)
      exit status unless status.zero?
    end
  end
end
