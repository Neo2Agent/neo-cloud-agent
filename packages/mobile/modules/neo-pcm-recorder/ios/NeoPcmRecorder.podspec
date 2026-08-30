Pod::Spec.new do |s|
  s.name           = 'NeoPcmRecorder'
  s.version        = '0.1.0'
  s.summary        = '16 kHz PCM capture for Neo voice'
  s.description    = 'Records mono 16-bit PCM for iFlytek IAT'
  s.author         = 'neo'
  s.homepage       = 'https://neorun.cloud'
  s.license        = 'MIT'
  s.platform       = :ios, '15.1'
  s.source         = { git: '' }
  s.static_framework = true
  s.source_files   = '*.{h,m,mm,swift}'
  s.dependency 'ExpoModulesCore'
end
