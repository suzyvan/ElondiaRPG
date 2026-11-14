# ElondiaRPG local launcher (Windows).
# Serves the "game" folder at http://localhost:8473/ and opens the browser.
# Saves live in the browser and belong to this address, so the port stays fixed.
# Close this window to stop the server.
# Also relays AI requests for services without CORS (the game's "經本機版轉送" option):
#   /proxy/<http|https>/<host[:port]>/<path>?<query>  ->  <scheme>://<host>/<path>?<query>
# Requests go from this computer straight to the service. Only the game page itself can use it:
# requests must carry X-Elondia-Proxy: 1 and, when the browser sends an Origin, it must be this page.

$ErrorActionPreference = 'Stop'
$port = 8473
$url = "http://localhost:$port/"
$root = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot 'game')).TrimEnd('\') + '\'
if (-not (Test-Path -LiteralPath (Join-Path $root 'index.html'))) {
  Write-Host "Cannot find game\index.html next to this script. Please unzip the whole folder first."
  Read-Host 'Press Enter to close'
  exit 1
}

$mime = @{
  '.html' = 'text/html; charset=utf-8'; '.js' = 'text/javascript; charset=utf-8'; '.mjs' = 'text/javascript; charset=utf-8'
  '.css' = 'text/css; charset=utf-8'; '.json' = 'application/json; charset=utf-8'; '.txt' = 'text/plain; charset=utf-8'
  '.map' = 'application/json'; '.svg' = 'image/svg+xml'; '.png' = 'image/png'; '.jpg' = 'image/jpeg'; '.jpeg' = 'image/jpeg'
  '.gif' = 'image/gif'; '.webp' = 'image/webp'; '.ico' = 'image/x-icon'; '.woff' = 'font/woff'; '.woff2' = 'font/woff2'
  '.ttf' = 'font/ttf'; '.otf' = 'font/otf'; '.wasm' = 'application/wasm'; '.mp3' = 'audio/mpeg'; '.ogg' = 'audio/ogg'
  '.wav' = 'audio/wav'; '.mp4' = 'video/mp4'; '.webm' = 'video/webm'
}

# ---- AI relay (runs on background threads so streaming does not block the game files) ----
Add-Type -AssemblyName System.Net.Http
try { [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12 } catch {}
try { [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls13 } catch {}
$origins = @("http://localhost:$port", "http://127.0.0.1:$port")
$relay = {
  param($ctx, $origins)
  $req = $ctx.Request
  $res = $ctx.Response
  function Send-Json([int]$status, $obj) {
    $bytes = [System.Text.Encoding]::UTF8.GetBytes(($obj | ConvertTo-Json -Depth 5 -Compress))
    $res.StatusCode = $status
    $res.ContentType = 'application/json; charset=utf-8'
    $res.ContentLength64 = $bytes.Length
    $res.OutputStream.Write($bytes, 0, $bytes.Length)
  }
  function Send-Error([int]$status, [string]$message) {
    Send-Json $status @{ error = @{ message = $message; type = 'local_proxy_error' } }
  }
  try {
    $origin = $req.Headers['Origin']
    if ($req.Headers['X-Elondia-Proxy'] -ne '1' -or ($origin -and ($origins -notcontains $origin))) {
      Send-Error 403 '本機轉送只接受遊戲自己送出的請求'
      return
    }
    $raw = $req.RawUrl
    if ($raw -eq '/proxy/ping' -or $raw.StartsWith('/proxy/ping?')) {
      Send-Json 200 @{ elondiaProxy = $true }
      return
    }
    $m = [regex]::Match($raw, '^/proxy/(https?)/([^/?#]+)(.*)$')
    if (-not $m.Success) {
      Send-Error 400 '轉送的網址格式不對'
      return
    }
    $hostName = $m.Groups[2].Value
    $target = $m.Groups[1].Value + '://' + $hostName + $m.Groups[3].Value
    $handler = [System.Net.Http.HttpClientHandler]::new()
    $handler.AutomaticDecompression = [System.Net.DecompressionMethods]::None
    $handler.UseCookies = $false
    $client = [System.Net.Http.HttpClient]::new($handler)
    $client.Timeout = [TimeSpan]::FromMinutes(10)
    $msg = [System.Net.Http.HttpRequestMessage]::new([System.Net.Http.HttpMethod]::new($req.HttpMethod), $target)
    if ($req.HasEntityBody) {
      $ms = [System.IO.MemoryStream]::new()
      $req.InputStream.CopyTo($ms)
      $content = [System.Net.Http.ByteArrayContent]::new($ms.ToArray())
      if ($req.ContentType) { [void]$content.Headers.TryAddWithoutValidation('Content-Type', $req.ContentType) }
      $msg.Content = $content
    }
    $skip = @('host', 'origin', 'referer', 'cookie', 'connection', 'keep-alive', 'proxy-connection', 'proxy-authorization', 'te', 'trailer',
      'transfer-encoding', 'upgrade', 'content-length', 'content-type', 'accept-encoding', 'x-elondia-proxy', 'expect')
    foreach ($k in $req.Headers.AllKeys) {
      $lk = $k.ToLowerInvariant()
      if ($skip -contains $lk -or $lk.StartsWith('sec-')) { continue }
      [void]$msg.Headers.TryAddWithoutValidation($k, $req.Headers[$k])
    }
    [void]$msg.Headers.TryAddWithoutValidation('Accept-Encoding', 'identity')
    try {
      $resp = $client.SendAsync($msg, [System.Net.Http.HttpCompletionOption]::ResponseHeadersRead).GetAwaiter().GetResult()
    } catch {
      $e = $_.Exception
      while ($e.InnerException) { $e = $e.InnerException }
      Send-Error 502 ('本機轉送連不上 ' + $hostName + '：' + $e.Message)
      return
    }
    $res.StatusCode = [int]$resp.StatusCode
    $skipRes = @('connection', 'keep-alive', 'transfer-encoding', 'content-length', 'content-encoding', 'trailer', 'upgrade', 'set-cookie', 'server', 'date')
    foreach ($h in (@($resp.Headers) + @($resp.Content.Headers))) {
      $lk = $h.Key.ToLowerInvariant()
      if ($skipRes -contains $lk) { continue }
      $v = [string]::Join(', ', [string[]]@($h.Value))
      if ($lk -eq 'content-type') { $res.ContentType = $v; continue }
      try { $res.AddHeader($h.Key, $v) } catch {}
    }
    $res.SendChunked = $true
    if ($req.HttpMethod -ne 'HEAD') {
      # Pass the answer on as it arrives (narration is streamed token by token)
      $stream = $resp.Content.ReadAsStreamAsync().GetAwaiter().GetResult()
      $buf = New-Object byte[] 8192
      while (($n = $stream.Read($buf, 0, $buf.Length)) -gt 0) {
        $res.OutputStream.Write($buf, 0, $n)
        $res.OutputStream.Flush()
      }
    }
  } catch {
    # The game cancelled the request, or the connection dropped; nothing more to send.
  } finally {
    try { $res.Close() } catch {}
  }
}
$pool = [RunspaceFactory]::CreateRunspacePool(1, 16)
$pool.Open()
$jobs = New-Object System.Collections.ArrayList

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add($url)
try {
  $listener.Start()
} catch {
  # Usually the game is already running in another window: just open it.
  Write-Host "Port $port is busy (the game may already be running). Opening $url"
  Start-Process $url
  Start-Sleep -Seconds 2
  exit 0
}

Write-Host "ElondiaRPG is running at $url"
Write-Host 'Keep this window open while playing. Close it to stop the game server.'
Start-Process $url

try {
  while ($listener.IsListening) {
    $ctx = $listener.GetContext()
    # Tidy up relays that have finished
    for ($i = $jobs.Count - 1; $i -ge 0; $i--) {
      $j = $jobs[$i]
      if ($j.Handle.IsCompleted) {
        try { [void]$j.PS.EndInvoke($j.Handle) } catch {}
        $j.PS.Dispose()
        $jobs.RemoveAt($i)
      }
    }
    if ($ctx.Request.Url.AbsolutePath.StartsWith('/proxy/')) {
      $ps = [PowerShell]::Create()
      $ps.RunspacePool = $pool
      [void]$ps.AddScript($relay.ToString()).AddArgument($ctx).AddArgument($origins)
      [void]$jobs.Add([pscustomobject]@{ PS = $ps; Handle = $ps.BeginInvoke() })
      continue
    }
    $res = $ctx.Response
    try {
      $rel = [System.Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath).TrimStart('/')
      if ($rel -eq '' -or $rel.EndsWith('/')) { $rel = $rel + 'index.html' }
      $path = [System.IO.Path]::GetFullPath((Join-Path $root $rel))
      if (-not $path.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase) -or -not (Test-Path -LiteralPath $path -PathType Leaf)) {
        $res.StatusCode = 404
        $bytes = [System.Text.Encoding]::UTF8.GetBytes('Not found')
      } else {
        $ext = [System.IO.Path]::GetExtension($path).ToLowerInvariant()
        $type = $mime[$ext]
        if (-not $type) { $type = 'application/octet-stream' }
        $res.ContentType = $type
        $res.AddHeader('Cache-Control', 'no-cache')
        $bytes = [System.IO.File]::ReadAllBytes($path)
      }
      if ($ctx.Request.HttpMethod -ne 'HEAD') {
        $res.ContentLength64 = $bytes.Length
        $res.OutputStream.Write($bytes, 0, $bytes.Length)
      }
    } catch {
      # The browser closed the connection early; ignore.
    } finally {
      try { $res.Close() } catch {}
    }
  }
} finally {
  $listener.Stop()
  $pool.Close()
}
