# Туннель SSH к службам речи на отдельной машине: синтез (8179) и распознавание (8178).
# Пример:
#   powershell -ExecutionPolicy Bypass -File scripts\speech-tunnel.ps1 -HostName 192.168.0.150 -User liina
#   powershell -ExecutionPolicy Bypass -File scripts\speech-tunnel.ps1 -HostName 192.168.0.150 -User liina -Stt
# Без -Stt пробрасывается только синтез. С -Stt пробрасывается и распознавание: локальная служба
# распознавания должна быть выключена (поле «Программа распознавания» в разделе «Голос» пустое), иначе порт 8178 занят.
# Окно держать открытым: закрыли окно — туннель закрылся. При обрыве переподключается сам.
param(
  [Parameter(Mandatory = $true)][string]$HostName,
  [Parameter(Mandatory = $true)][string]$User,
  [string]$Key = (Join-Path $env:USERPROFILE '.ssh\tishka_speech'),
  [int]$Port = 22,
  [switch]$Stt
)
if (-not (Test-Path $Key)) { "Нет ключа $Key. Создайте его командой ssh-keygen из README."; exit 2 }
$forward = @('-L', '127.0.0.1:8179:127.0.0.1:8179')
if ($Stt) { $forward += @('-L', '127.0.0.1:8178:127.0.0.1:8178') }
"Туннель к $User@$HostName. Закрыть - Ctrl+C."
while ($true) {
  & ssh -i $Key -p $Port -o IdentitiesOnly=yes -o ExitOnForwardFailure=yes -o ServerAliveInterval=20 -o ServerAliveCountMax=3 -N @forward "$User@$HostName" 2>&1 |
    Where-Object { $_ -notmatch 'post-quantum|store now|pq.html' }
  "$(Get-Date -Format 'HH:mm:ss') туннель закрылся, повтор через 5 секунд"
  Start-Sleep -Seconds 5
}
