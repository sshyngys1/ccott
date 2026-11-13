# Captures the island window region: collapsed, hovered/expanded, after leave. Physical px (DPI-aware).
param([string]$OutDir)
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class U32 {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
}
"@
[U32]::SetProcessDPIAware() | Out-Null
$b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$g = [Math]::Round([System.Drawing.Graphics]::FromHwnd([IntPtr]::Zero).DpiX / 96, 2)
$winW = [int](800 * $g); $winH = [int](520 * $g)
$left = [int](($b.Width - $winW) / 2)

function Shot([string]$name) {
  $bmp = New-Object System.Drawing.Bitmap $winW, $winH
  $gr = [System.Drawing.Graphics]::FromImage($bmp)
  $gr.CopyFromScreen($left, 0, 0, 0, $bmp.Size)
  $bmp.Save((Join-Path $OutDir "$name.png"))
  $gr.Dispose(); $bmp.Dispose()
}

$fgBefore = [U32]::GetForegroundWindow()
[U32]::SetCursorPos([int]($b.Width / 2), [int](400 * $g)) | Out-Null
Start-Sleep -Milliseconds 800
Shot "w1-collapsed"
[U32]::SetCursorPos([int]($b.Width / 2), [int](26 * $g)) | Out-Null
Start-Sleep -Milliseconds 250
Shot "w1-hover-mid"
Start-Sleep -Milliseconds 1200
Shot "w1-expanded"
$fgAfter = [U32]::GetForegroundWindow()
[U32]::SetCursorPos([int]($b.Width / 2), [int](700 * $g)) | Out-Null
Start-Sleep -Milliseconds 1200
Shot "w1-after-leave"
"screen=$($b.Width)x$($b.Height) dpiScale=$g window=${winW}x${winH} left=$left"
"foreground unchanged: $($fgBefore -eq $fgAfter)"
