# frozen_string_literal: true

require "json"
require "rails/generators"

module SequenceProof
  module Generators
    # Installs configuration, profiles, directories, scripts, and the npm dependency.
    class InstallGenerator < ::Rails::Generators::Base
      namespace "sequenceproof:install"

      # Shell-free argument vectors for supported package managers.
      PACKAGE_COMMANDS = {
        "npm" => %w[npm install --save-dev @sequenceproof/core],
        "pnpm" => %w[pnpm add --save-dev @sequenceproof/core],
        "yarn" => %w[yarn add --dev @sequenceproof/core],
        "bun" => %w[bun add --dev @sequenceproof/core]
      }.freeze
      # Shell-free argument vectors used when revoking an installation.
      PACKAGE_REMOVE_COMMANDS = {
        "npm" => %w[npm uninstall --save-dev @sequenceproof/core],
        "pnpm" => %w[pnpm remove --save-dev @sequenceproof/core],
        "yarn" => %w[yarn remove @sequenceproof/core],
        "bun" => %w[bun remove @sequenceproof/core]
      }.freeze
      # Package scripts owned by the install generator and removed on revoke.
      SEQUENCEPROOF_SCRIPTS = {
        "sequenceproof" => "sequenceproof",
        "sequenceproof:check" => "sequenceproof check",
        "sequenceproof:validate" => "sequenceproof validate"
      }.freeze

      source_root File.expand_path("templates", __dir__)
      class_option :package_manager, type: :string, default: "npm", enum: %w[npm pnpm yarn bun]
      class_option :test_framework, type: :string, default: "rspec", enum: %w[rspec minitest]
      class_option :mount_path, type: :string, default: "/__sequenceproof"
      class_option :skip_package_install, type: :boolean, default: false
      class_option :example, type: :boolean, default: false

      def validate_options
        return if options[:mount_path].to_s.match?(%r{\A/[a-zA-Z0-9/_-]*\z})

        raise ::Rails::Generators::Error, "mount path must contain only safe URL-path characters"
      end

      # Generates the Rails initializer.
      def create_initializer
        template "initializer.rb.tt", "config/initializers/sequenceproof.rb"
      end

      # Generates the SequenceProof app directories and configuration files.
      def create_directories
        unless behavior == :revoke
          empty_directory adapter_directory
          empty_directory "sequenceproof/models"
          empty_directory "sequenceproof/traces"
        end
        create_file "sequenceproof/traces/.gitkeep", ""
        template "profiles.yml", "sequenceproof/profiles.yml"
        template "tsconfig.json", "sequenceproof/tsconfig.json"
      end

      # Ignores sensitive traces while retaining the directory marker.
      def update_gitignore
        path = destination_root_path(".gitignore")
        current = File.exist?(path) ? File.read(path) : ""
        line = "sequenceproof/traces/**\n!sequenceproof/traces/.gitkeep\n"
        if behavior == :revoke
          return unless current.include?(line)

          restored = current.sub(line, "")
          restored.empty? ? File.delete(path) : File.write(path, restored)
          return
        end
        return if current.include?("sequenceproof/traces/**")

        File.exist?(path) ? append_to_file(".gitignore", line) : create_file(".gitignore", line)
      end

      # Adds idempotent SequenceProof scripts without deleting existing scripts.
      def update_package_json
        path = destination_root_path("package.json")
        package = File.exist?(path) ? JSON.parse(File.read(path)) : {}
        valid_sections = package.is_a?(Hash) && %w[scripts devDependencies].all? do |section|
          !package.key?(section) || package[section].is_a?(Hash)
        end
        unless valid_sections
          raise ::Rails::Generators::Error,
                "package.json must contain an object with optional scripts and devDependencies objects"
        end

        if behavior == :revoke
          SEQUENCEPROOF_SCRIPTS.each do |name, command|
            package.fetch("scripts", {}).delete(name) if package.dig("scripts", name) == command
          end
          package.fetch("devDependencies", {}).delete("@sequenceproof/core") if package["devDependencies"].is_a?(Hash)
          File.write(path, "#{JSON.pretty_generate(package)}\n") if File.exist?(path)
        else
          package["scripts"] ||= {}
          package["scripts"].merge!(SEQUENCEPROOF_SCRIPTS)
          create_file "package.json", "#{JSON.pretty_generate(package)}\n", force: true
        end
      end

      def install_package
        return if options[:skip_package_install]

        commands = behavior == :revoke ? PACKAGE_REMOVE_COMMANDS : PACKAGE_COMMANDS
        command = commands.fetch(options[:package_manager])
        raise ::Rails::Generators::Error, "package installation failed" unless Kernel.system(*command)
      end

      # Optionally invokes the model generator for an explicit smoke example.
      def create_example
        return unless options[:example]

        invoke "sequenceproof:model", %w[SequenceproofSmoke exercise_route],
               test_framework: options[:test_framework]
      end

      # Removes only directories left empty after generated files are revoked.
      def remove_empty_directories
        return unless behavior == :revoke

        directories = [adapter_directory, "sequenceproof/models", "sequenceproof/traces", "sequenceproof",
                       File.dirname(adapter_directory)]
        directories.each do |directory|
          path = destination_root_path(directory)
          Dir.rmdir(path) if Dir.exist?(path) && Dir.empty?(path)
        end
      end

      # Prints the required application-specific handoff.
      def print_next_steps
        if behavior == :revoke
          say "SequenceProof-generated application files and package entries removed."
        else
          say "SequenceProof installed but no application behavior is covered yet."
          say "Next: bin/rails generate sequenceproof:model ShoppingCart add_item remove_item"
          say "Then complete the generated adapter/model TODOs and run " \
              "bin/rails 'sequenceproof:check[shopping_cart,smoke]'."
        end
      end

      private

      def adapter_directory
        options[:test_framework] == "rspec" ? "spec/sequenceproof/adapters" : "test/sequenceproof/adapters"
      end

      def destination_root_path(path) = File.expand_path(path, destination_root)
    end
  end
end
