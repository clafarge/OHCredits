$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing
$size = 32
$bmp = New-Object System.Drawing.Bitmap $size, $size
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.Clear([System.Drawing.Color]::FromArgb(255, 17, 17, 17))

$topBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 30, 30, 30))
$path = New-Object System.Drawing.Drawing2D.GraphicsPath
$path.AddLine(4, 15, 28, 10)
$path.AddLine(28, 10, 28, 15)
$path.AddLine(28, 15, 4, 20)
$path.CloseFigure()
$g.FillPath($topBrush, $path)

$stripe = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 242, 242, 242))
for ($i = 0; $i -lt 6; $i++) {
  $x = 4 + [float]($i * 4.2)
  $g.FillRectangle($stripe, $x, 10.5, 2.2, 4.5)
}

$slate = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 37, 37, 37))
$penSlate = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(255, 90, 90, 90), 0.75)
$g.FillRectangle($slate, 5, 18, 22, 9)
$g.DrawRectangle($penSlate, 5, 18, 21.25, 8.25)

$penLine = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(255, 74, 74, 74), 0.5)
$g.DrawLine($penLine, 8, 21, 24, 21)
$g.DrawLine($penLine, 8, 23.5, 20, 23.5)

$penGold = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(230, 201, 162, 39), 1)
$g.DrawLine($penGold, 10, 17.5, 22, 17.5)

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$out = Join-Path $repoRoot "favicon.png"
$bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)

$g.Dispose()
$bmp.Dispose()
$topBrush.Dispose()
$slate.Dispose()
$stripe.Dispose()
$penSlate.Dispose()
$penLine.Dispose()
$penGold.Dispose()

Write-Output "Wrote $out"
