param([Parameter(Mandatory=$true)][string]$MediaPath)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Speech
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$recognizerInfo = [System.Speech.Recognition.SpeechRecognitionEngine]::InstalledRecognizers() | Where-Object { $_.Culture.Name -eq [System.Globalization.CultureInfo]::CurrentUICulture.Name } | Select-Object -First 1
if ($null -eq $recognizerInfo) { $recognizerInfo = [System.Speech.Recognition.SpeechRecognitionEngine]::InstalledRecognizers() | Select-Object -First 1 }
if ($null -eq $recognizerInfo) { throw 'Windows speech recognition language pack unavailable' }
$temporaryWav = $null
$audioStream = $null
$recognizer = New-Object System.Speech.Recognition.SpeechRecognitionEngine($recognizerInfo)
try {
  $grammar = New-Object System.Speech.Recognition.DictationGrammar
  $recognizer.LoadGrammar($grammar)
  $inputPath = $MediaPath
  if ([System.IO.Path]::GetExtension($MediaPath).ToLowerInvariant() -ne '.wav') {
    [Windows.Storage.StorageFile, Windows.Storage, ContentType=WindowsRuntime] | Out-Null
    [Windows.Media.Transcoding.MediaTranscoder, Windows.Media.Transcoding, ContentType=WindowsRuntime] | Out-Null
    [Windows.Media.MediaProperties.MediaEncodingProfile, Windows.Media.MediaProperties, ContentType=WindowsRuntime] | Out-Null
    function Await-WinRt($Operation, [Type]$ResultType) {
      $method = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' } | Select-Object -First 1
      $task = $method.MakeGenericMethod($ResultType).Invoke($null, @($Operation))
      $task.GetAwaiter().GetResult()
    }
    $temporaryWav = Join-Path ([System.IO.Path]::GetTempPath()) (([guid]::NewGuid().ToString()) + '.wav')
    [System.IO.File]::WriteAllBytes($temporaryWav, [byte[]]@())
    $source = Await-WinRt ([Windows.Storage.StorageFile]::GetFileFromPathAsync($MediaPath)) ([Windows.Storage.StorageFile])
    $destination = Await-WinRt ([Windows.Storage.StorageFile]::GetFileFromPathAsync($temporaryWav)) ([Windows.Storage.StorageFile])
    $profile = [Windows.Media.MediaProperties.MediaEncodingProfile]::CreateWav([Windows.Media.MediaProperties.AudioEncodingQuality]::Low)
    $profile.Audio.SampleRate = 16000
    $profile.Audio.ChannelCount = 1
    $profile.Audio.BitsPerSample = 16
    $transcoder = New-Object Windows.Media.Transcoding.MediaTranscoder
    $prepared = Await-WinRt ($transcoder.PrepareFileTranscodeAsync($source, $destination, $profile)) ([Windows.Media.Transcoding.PrepareTranscodeResult])
    if (!$prepared.CanTranscode) { throw ('Windows media codec unavailable: ' + $prepared.FailureReason) }
    $operation = $prepared.TranscodeAsync()
    $method = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncActionWithProgress`1' } | Select-Object -First 1
    $task = $method.MakeGenericMethod([double]).Invoke($null, @($operation))
    $task.GetAwaiter().GetResult() | Out-Null
    $task = $null
    $operation = $null
    $prepared = $null
    $transcoder = $null
    $destination = $null
    $source = $null
    [GC]::Collect()
    [GC]::WaitForPendingFinalizers()
    $inputPath = $temporaryWav
  }
  # MediaTranscoder emits valid RIFF with optional JUNK/fmt extensions, which
  # SAPI's legacy SetInputToWaveFile reader rejects. Supply the actual PCM
  # payload and its declared format instead of assuming a 44-byte WAV header.
  if ((Get-Item -LiteralPath $inputPath).Length -gt 268435456) { throw 'Decoded audio exceeds 256 MB; split it into shorter clips' }
  $bytes = [System.IO.File]::ReadAllBytes($inputPath)
  if ($bytes.Length -lt 12 -or [System.Text.Encoding]::ASCII.GetString($bytes,0,4) -ne 'RIFF' -or [System.Text.Encoding]::ASCII.GetString($bytes,8,4) -ne 'WAVE') { throw 'Invalid WAV header' }
  $formatOffset = -1
  $dataOffset = -1
  $dataLength = 0
  for ($offset = 12; $offset + 8 -le $bytes.Length;) {
    $name = [System.Text.Encoding]::ASCII.GetString($bytes,$offset,4)
    $length = [BitConverter]::ToUInt32($bytes,$offset + 4)
    if ($offset + 8 + $length -gt $bytes.Length) { throw 'Truncated WAV chunk' }
    if ($name -eq 'fmt ') { $formatOffset = $offset + 8 }
    if ($name -eq 'data') { $dataOffset = $offset + 8; $dataLength = $length }
    $offset += 8 + $length + ($length % 2)
  }
  if ($formatOffset -lt 0 -or $dataOffset -lt 0 -or [BitConverter]::ToUInt16($bytes,$formatOffset) -ne 1) { throw 'WAV must contain PCM audio' }
  $channels = [BitConverter]::ToInt16($bytes,$formatOffset + 2)
  $rate = [BitConverter]::ToInt32($bytes,$formatOffset + 4)
  $average = [BitConverter]::ToInt32($bytes,$formatOffset + 8)
  $alignment = [BitConverter]::ToInt16($bytes,$formatOffset + 12)
  $bits = [BitConverter]::ToInt16($bytes,$formatOffset + 14)
  $format = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo -ArgumentList @([System.Speech.AudioFormat.EncodingFormat]::Pcm,$rate,$bits,$channels,$average,$alignment,$null)
  $audioStream = New-Object System.IO.MemoryStream -ArgumentList @($bytes,$dataOffset,$dataLength)
  $recognizer.SetInputToAudioStream($audioStream,$format)
  Add-Type -ReferencedAssemblies ([System.Speech.Recognition.SpeechRecognitionEngine].Assembly.Location) -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Threading;
using System.Speech.Recognition;
public static class FridaySpeechReader {
  public static object[] ReadAll(SpeechRecognitionEngine engine) {
      var lines = new List<object>();
    Exception error = null;
    using (var done = new ManualResetEvent(false)) {
      EventHandler<SpeechRecognizedEventArgs> recognized = (s,e) => { if (!String.IsNullOrWhiteSpace(e.Result.Text)) lines.Add(new { start = e.Result.Audio.AudioPosition.TotalSeconds, end = (e.Result.Audio.AudioPosition + e.Result.Audio.Duration).TotalSeconds, text = e.Result.Text, confidence = e.Result.Confidence }); };
      EventHandler<RecognizeCompletedEventArgs> completed = (s,e) => { error = e.Error; done.Set(); };
      engine.SpeechRecognized += recognized;
      engine.RecognizeCompleted += completed;
      try {
        engine.RecognizeAsync(RecognizeMode.Multiple);
        if (!done.WaitOne(180000)) { engine.RecognizeAsyncCancel(); done.WaitOne(2000); throw new TimeoutException("Audio recognition timed out; split the file into shorter clips"); }
        if (error != null) throw error;
        return lines.ToArray();
      } finally { engine.SpeechRecognized -= recognized; engine.RecognizeCompleted -= completed; }
    }
  }
}
'@
  $lines = [FridaySpeechReader]::ReadAll($recognizer)
  $segments = @($lines)
  @{ text=(($segments | ForEach-Object { $_.text }) -join "`n"); segments=$segments; duration=($dataLength / [double]$average); language=$recognizerInfo.Culture.Name; engine='windows-speech' } | ConvertTo-Json -Compress -Depth 5
} finally {
  $recognizer.SetInputToNull()
  $recognizer.Dispose()
  if ($audioStream) { $audioStream.Dispose() }
  if ($temporaryWav -and [System.IO.File]::Exists($temporaryWav)) {
    try { [System.IO.File]::Delete($temporaryWav) } catch { [Console]::Error.WriteLine('Temporary transcription audio remains locked until process exit') }
  }
}
