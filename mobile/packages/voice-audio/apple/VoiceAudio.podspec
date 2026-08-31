require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'VoiceAudio'
  s.version        = package['version']
  s.summary        = package['description']
  s.description    = package['description']
  s.license        = package['license']
  s.author         = 'agent_tts'
  s.homepage       = 'https://github.com/Mvp2o-ai/agent_tts'
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = {
    git: 'https://github.com/Mvp2o-ai/agent_tts.git',
    tag: "v#{s.version}"
  }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
  s.source_files = '**/*.{h,m,mm,swift}'
end
