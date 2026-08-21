# frozen_string_literal: true

require "tmpdir"
require "open3"
require "fileutils"
require "yaml"
require "rails/generators"
require "generators/sequenceproof/install/install_generator"
require "generators/sequenceproof/model/model_generator"
require "generators/sequenceproof/adapter/adapter_generator"

RSpec.describe "SequenceProof generators" do
  around do |example|
    temporary_root = File.expand_path("../../tmp", __dir__)
    FileUtils.mkdir_p(temporary_root)
    Dir.mktmpdir("generator-app-", temporary_root) do |directory|
      @destination = directory
      File.write(File.join(directory, "package.json"), "{\"private\":true,\"scripts\":{\"test\":\"existing\"}}\n")
      example.run
    end
  end

  it "installs idempotently without erasing package scripts" do
    arguments = ["--skip-package-install", "--test-framework=rspec"]
    2.times { SequenceProof::Generators::InstallGenerator.start(arguments, destination_root: @destination) }

    package = JSON.parse(File.read(File.join(@destination, "package.json")))
    expect(package.fetch("scripts")).to include("test" => "existing", "sequenceproof" => "sequenceproof")
    expect(File.read(File.join(@destination, ".gitignore")).scan("sequenceproof/traces/**").length).to eq(1)
    expect(YAML.safe_load_file(File.join(@destination, "sequenceproof/profiles.yml"),
                               aliases: false)).to include("version" => 1)
  end

  it "generates an initializer that is inert when the dev/test-only gem is absent" do
    SequenceProof::Generators::InstallGenerator.start(
      ["--skip-package-install", "--test-framework=rspec"], destination_root: @destination
    )
    initializer = File.join(@destination, "config/initializers/sequenceproof.rb")

    output, status = Open3.capture2e(RbConfig.ruby, initializer)

    expect(status).to be_success, output
    expect(File.read(initializer)).to include("SequenceProof::Rails.respond_to?(:configure)")
  end

  it "revokes generated files and package entries without deleting existing package content" do
    install_arguments = ["--skip-package-install", "--test-framework=rspec"]
    model_arguments = ["ShoppingCart", "add_item", "--test-framework=rspec"]
    SequenceProof::Generators::InstallGenerator.start(install_arguments, destination_root: @destination)
    SequenceProof::Generators::ModelGenerator.start(model_arguments, destination_root: @destination)
    package_path = File.join(@destination, "package.json")
    package = JSON.parse(File.read(package_path))
    package["devDependencies"] = { "@sequenceproof/core" => "^0.1.0", "typescript" => "^5.9.0" }
    File.write(package_path, "#{JSON.pretty_generate(package)}\n")
    custom_adapter = File.join(@destination, "spec/sequenceproof/adapters/custom_adapter.rb")
    File.write(custom_adapter, "# user-owned\n")

    SequenceProof::Generators::ModelGenerator.start(
      model_arguments, destination_root: @destination, behavior: :revoke
    )
    SequenceProof::Generators::InstallGenerator.start(
      install_arguments, destination_root: @destination, behavior: :revoke
    )

    restored = JSON.parse(File.read(package_path))
    expect(restored.fetch("scripts")).to eq("test" => "existing")
    expect(restored.fetch("devDependencies")).to eq("typescript" => "^5.9.0")
    expect(File).not_to exist(File.join(@destination, "config/initializers/sequenceproof.rb"))
    expect(File).not_to exist(File.join(@destination, "sequenceproof/models/shopping_cart.ts"))
    expect(File).not_to exist(File.join(@destination, "spec/sequenceproof/adapters/shopping_cart_adapter.rb"))
    expect(File.read(custom_adapter)).to eq("# user-owned\n")
    expect(File).not_to exist(File.join(@destination, ".gitignore"))
  end

  it "generates compiling TypeScript and syntactically valid Ruby" do
    SequenceProof::Generators::ModelGenerator.start(
      ["ShoppingCart", "add_item", "remove_item", "--test-framework=rspec"],
      destination_root: @destination
    )

    model = File.join(@destination, "sequenceproof/models/shopping_cart.ts")
    adapter = File.join(@destination, "spec/sequenceproof/adapters/shopping_cart_adapter.rb")
    ruby_output, ruby_status = Open3.capture2e(RbConfig.ruby, "-c", adapter)
    expect(ruby_status).to be_success, ruby_output
    type_output, type_status = Open3.capture2e(
      File.expand_path("../../node_modules/.bin/tsc", __dir__), "--noEmit", "--strict", "--target", "ES2022",
      "--module", "NodeNext", "--moduleResolution", "NodeNext", "--skipLibCheck", model
    )
    expect(type_status).to be_success, type_output
  end

  it "generates the Minitest adapter and test in the Minitest tree" do
    SequenceProof::Generators::ModelGenerator.start(
      ["ShoppingCart", "add_item", "--test-framework=minitest"],
      destination_root: @destination
    )

    adapter = File.join(@destination, "test/sequenceproof/adapters/shopping_cart_adapter.rb")
    test = File.join(@destination, "test/sequenceproof/shopping_cart_test.rb")
    expect(File).to exist(adapter)
    expect(File).to exist(test)
    [adapter, test].each do |file|
      output, status = Open3.capture2e(RbConfig.ruby, "-c", file)
      expect(status).to be_success, output
    end
  end

  it "creates the smoke example only when explicitly requested" do
    SequenceProof::Generators::InstallGenerator.start(
      ["--skip-package-install", "--test-framework=rspec"], destination_root: @destination
    )
    expect(File).not_to exist(File.join(@destination, "sequenceproof/models/sequenceproof_smoke.ts"))

    SequenceProof::Generators::InstallGenerator.start(
      ["--skip-package-install", "--test-framework=rspec", "--example"], destination_root: @destination
    )
    expect(File).to exist(File.join(@destination, "sequenceproof/models/sequenceproof_smoke.ts"))
    expect(File).to exist(File.join(@destination, "spec/sequenceproof/adapters/sequenceproof_smoke_adapter.rb"))
  end

  it "uses direct non-shell package-manager commands for every supported manifest" do
    allow(Kernel).to receive(:system).and_return(true)
    SequenceProof::Generators::InstallGenerator::PACKAGE_COMMANDS.each do |manager, command|
      SequenceProof::Generators::InstallGenerator.start(
        ["--package-manager=#{manager}", "--test-framework=rspec"], destination_root: @destination
      )
      package = JSON.parse(File.read(File.join(@destination, "package.json")))
      expect(package.fetch("scripts")).to include("sequenceproof:check" => "sequenceproof check")
      expect(Kernel).to have_received(:system).with(*command).once
      SequenceProof::Generators::InstallGenerator.start(
        ["--package-manager=#{manager}", "--test-framework=rspec"],
        destination_root: @destination, behavior: :revoke
      )
      remove_command = SequenceProof::Generators::InstallGenerator::PACKAGE_REMOVE_COMMANDS.fetch(manager)
      expect(Kernel).to have_received(:system).with(*remove_command).once
    end
  end

  it "rejects path traversal and duplicate command names" do
    expect do
      SequenceProof::Generators::ModelGenerator.new(["../Escape", "go"], {},
                                                    destination_root: @destination).validate_names!
    end.to raise_error(Rails::Generators::Error)

    expect do
      SequenceProof::Generators::AdapterGenerator.new(%w[Safe go go], {},
                                                      destination_root: @destination).validate_names!
    end.to raise_error(Rails::Generators::Error, /unique/)

    expect do
      SequenceProof::Generators::InstallGenerator.new([], { mount_path: '/safe"; raise "injected' },
                                                      destination_root: @destination).validate_options
    end.to raise_error(Rails::Generators::Error, /mount path/)
  end
end
