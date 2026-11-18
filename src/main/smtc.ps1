# Читает и управляет мультимедиа Windows (SMTC): то, что играет в браузере, Яндекс Музыке и других плеерах.
# Каждую секунду печатает одну строку JSON. Команды приходят через файл, путь к нему передан аргументом.
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false
Add-Type -AssemblyName System.Runtime.WindowsRuntime

$null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
$null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties, Windows.Media.Control, ContentType = WindowsRuntime]
$null = [Windows.Storage.Streams.IRandomAccessStreamWithContentType, Windows.Storage.Streams, ContentType = WindowsRuntime]

$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
})[0]

function Await($op, $type) {
    $task = $asTask.MakeGenericMethod($type).Invoke($null, @($op))
    $null = $task.Wait(-1)
    $task.Result
}

$cmdFile = $args[0]
$mgr = Await ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])
$script:lastKey = ''
$script:thumb = $null

# Выбираем играющую сессию, при этом пропускаем сам Island Player
function Pick {
    $all = @($mgr.GetSessions()) | Where-Object { $_.SourceAppUserModelId -notmatch 'island|electron' }
    $playing = $all | Where-Object { $_.GetPlaybackInfo().PlaybackStatus.ToString() -eq 'Playing' } | Select-Object -First 1
    if ($playing) { return $playing }
    $cur = $mgr.GetCurrentSession()
    if ($cur -and $cur.SourceAppUserModelId -notmatch 'island|electron') { return $cur }
    return ($all | Select-Object -First 1)
}

function Get-Thumb($props) {
    try {
        $ref = $props.Thumbnail
        if (-not $ref) { return $null }
        $stream = Await ($ref.OpenReadAsync()) ([Windows.Storage.Streams.IRandomAccessStreamWithContentType])
        $net = [System.IO.WindowsRuntimeStreamExtensions]::AsStreamForRead($stream)
        $ms = New-Object System.IO.MemoryStream
        $net.CopyTo($ms)
        $mime = if ($stream.ContentType) { $stream.ContentType } else { 'image/jpeg' }
        return "data:$mime;base64," + [Convert]::ToBase64String($ms.ToArray())
    } catch { return $null }
}

function Emit {
    $s = Pick
    if (-not $s) { [Console]::Out.WriteLine('{"active":false}'); return }
    $p = Await ($s.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
    if (-not $p -or (-not $p.Title -and -not $p.Artist)) { [Console]::Out.WriteLine('{"active":false}'); return }
    $info = $s.GetPlaybackInfo()
    $tl = $s.GetTimelineProperties()
    $key = "$($s.SourceAppUserModelId)|$($p.Title)|$($p.Artist)"
    $changed = $key -ne $script:lastKey
    if ($changed) { $script:lastKey = $key; $script:thumb = Get-Thumb $p }
    $o = [ordered]@{
        active  = $true
        app     = $s.SourceAppUserModelId
        title   = $p.Title
        artist  = $p.Artist
        playing = ($info.PlaybackStatus.ToString() -eq 'Playing')
        pos     = [int64]$tl.Position.TotalMilliseconds
        dur     = [int64]($tl.EndTime.TotalMilliseconds - $tl.StartTime.TotalMilliseconds)
    }
    if ($changed) { $o['thumb'] = $script:thumb }
    [Console]::Out.WriteLine(($o | ConvertTo-Json -Compress))
}

function Run-Command($line) {
    $s = Pick
    if (-not $s) { return }
    $c = $line.Trim().Split(' ')
    switch ($c[0]) {
        'toggle' { $null = Await ($s.TryTogglePlayPauseAsync()) ([bool]) }
        'pause'  { $null = Await ($s.TryPauseAsync()) ([bool]) }
        'next'   { $null = Await ($s.TrySkipNextAsync()) ([bool]) }
        'prev'   { $null = Await ($s.TrySkipPreviousAsync()) ([bool]) }
        'seek'   { $null = Await ($s.TryChangePlaybackPositionAsync([long]([double]$c[1] * 10000))) ([bool]) }
    }
}

$tick = 0
while ($true) {
    if (Test-Path $cmdFile) {
        $line = Get-Content $cmdFile -Raw
        Remove-Item $cmdFile -Force
        if ($line) { Run-Command $line }
        $tick = 0
    }
    if ($tick -le 0) {
        try { Emit } catch { [Console]::Out.WriteLine('{"active":false}') }
        $tick = 4
    }
    Start-Sleep -Milliseconds 250
    $tick--
}
