Add-Type -AssemblyName System.Speech
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
$s.Rate = 0
$dir = Join-Path $PSScriptRoot "wav"
New-Item -ItemType Directory -Force $dir | Out-Null
$i = 0
foreach ($line in Get-Content (Join-Path $PSScriptRoot "script.txt")) {
  if (-not $line.Trim()) { continue }
  $f = Join-Path $dir ("{0:D3}.wav" -f $i)
  $fmt = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
  $s.SetOutputToWaveFile($f, $fmt)
  $s.Speak($line)
  $i++
}
$s.Dispose()
