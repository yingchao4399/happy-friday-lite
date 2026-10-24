$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Speech
$probeDirectory = Join-Path ([IO.Path]::GetTempPath()) ('friday-speech-probe-' + [guid]::NewGuid())
[IO.Directory]::CreateDirectory($probeDirectory) | Out-Null
$probeAudioPath = Join-Path $probeDirectory 'speech.wav'
$synthesizer = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
  $synthesizer.SelectVoiceByHints([System.Speech.Synthesis.VoiceGender]::NotSet, [System.Speech.Synthesis.VoiceAge]::NotSet, 0, [Globalization.CultureInfo]::GetCultureInfo('zh-CN'))
  $synthesizer.SetOutputToWaveFile($probeAudioPath)
  $synthesizer.Speak('今天我们学习如何保护环境。每天阅读可以增加知识。运动可以帮助我们保持健康。')
} finally { $synthesizer.Dispose() }
& (Join-Path $PSScriptRoot '../src-electron/rag/windows-transcribe.ps1') -MediaPath $probeAudioPath
Write-Output ('PROBE_AUDIO=' + $probeAudioPath)
