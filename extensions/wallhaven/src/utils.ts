import { environment } from "@raycast/api";
import { runAppleScript, runPowerShellScript } from "@raycast/utils";
import { writeFile } from "fs/promises";
import { join } from "path";

export async function downloadImage(
  url: string,
  destPath: string,
): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download image: ${response.status}`);
  }
  const buffer = await response.arrayBuffer();
  await writeFile(destPath, Buffer.from(buffer));
}

export async function setDesktopWallpaper(
  imagePath: string,
  allDesktops: boolean = true,
): Promise<void> {
  if (process.platform === "darwin") {
    const escapedImagePath = imagePath
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"');

    let appleScript = ""
    if (allDesktops) {
        appleScript = `
        tell application "System Events"
            tell every desktop
            set picture to "${escapedImagePath}"
            end tell
        end tell
        `;
    } else {
        appleScript = `
        tell application "System Events"
            set picture of current desktop to "${escapedImagePath}"
        end tell
        `;
    }
    await runAppleScript(appleScript);
  }
  if (process.platform === "win32") {
    const escapedImagePath = imagePath
      .replace(/"/g, '\\"');

    let pwshScript = `
function Initialize-NativeWallpaperApi {
	if ("Wallpaper.NativeMethods" -as [type]) {
		return
	}

	Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

namespace Wallpaper {
	[StructLayout(LayoutKind.Sequential)]
	public struct RECT {
		public int Left;
		public int Top;
		public int Right;
		public int Bottom;
	}

	[StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
	public struct MONITORINFOEX {
		public int cbSize;
		public RECT rcMonitor;
		public RECT rcWork;
		public uint dwFlags;

		[MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)]
		public string szDevice;
	}

	public enum DESKTOP_WALLPAPER_POSITION {
		DWPOS_CENTER = 0,
		DWPOS_TILE = 1,
		DWPOS_STRETCH = 2,
		DWPOS_FIT = 3,
		DWPOS_FILL = 4,
		DWPOS_SPAN = 5
	}

	[ComImport]
	[Guid("B92B56A9-8B55-4E14-9A89-0199BBB6F93B")]
	[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
	public interface IDesktopWallpaper {
		void SetWallpaper([MarshalAs(UnmanagedType.LPWStr)] string monitorID, [MarshalAs(UnmanagedType.LPWStr)] string wallpaper);
		void GetWallpaper([MarshalAs(UnmanagedType.LPWStr)] string monitorID, [MarshalAs(UnmanagedType.LPWStr)] out string wallpaper);
		void GetMonitorDevicePathAt(uint monitorIndex, [MarshalAs(UnmanagedType.LPWStr)] out string monitorID);
		void GetMonitorDevicePathCount(out uint count);
		void GetMonitorRECT([MarshalAs(UnmanagedType.LPWStr)] string monitorID, out Wallpaper.RECT displayRect);
		void SetBackgroundColor(uint color);
		void GetBackgroundColor(out uint color);
		void SetPosition(Wallpaper.DESKTOP_WALLPAPER_POSITION position);
		void GetPosition(out Wallpaper.DESKTOP_WALLPAPER_POSITION position);
		void SetSlideshow(IntPtr items);
		void GetSlideshow(out IntPtr items);
		void SetSlideshowOptions(uint options, uint slideshowTick);
		void GetSlideshowOptions(out uint options, out uint slideshowTick);
		void AdvanceSlideshow([MarshalAs(UnmanagedType.LPWStr)] string monitorID, uint direction);
		void GetStatus(out uint state);
		void Enable([MarshalAs(UnmanagedType.Bool)] bool enable);
	}

	[ComImport]
	[Guid("C2CF3110-460E-4FC1-B9D0-8A1C0C9CC4BD")]
	public class DesktopWallpaperClass {
	}

	public class DesktopWallpaperClient {
		private readonly IDesktopWallpaper _desktopWallpaper;

		public DesktopWallpaperClient() {
			_desktopWallpaper = (IDesktopWallpaper)new DesktopWallpaperClass();
		}

		public void SetWallpaper(string monitorId, string wallpaper) {
			_desktopWallpaper.SetWallpaper(monitorId, wallpaper);
		}

		public uint GetMonitorDevicePathCount() {
			uint count;
			_desktopWallpaper.GetMonitorDevicePathCount(out count);
			return count;
		}

		public string GetMonitorDevicePathAt(uint monitorIndex) {
			string monitorId;
			_desktopWallpaper.GetMonitorDevicePathAt(monitorIndex, out monitorId);
			return monitorId;
		}

		public RECT GetMonitorRECT(string monitorId) {
			RECT monitorRect;
			_desktopWallpaper.GetMonitorRECT(monitorId, out monitorRect);
			return monitorRect;
		}
	}

	public static class NativeMethods {
		public const uint MONITOR_DEFAULTTONEAREST = 2;

		[DllImport("user32.dll")]
		public static extern IntPtr GetForegroundWindow();

		[DllImport("user32.dll")]
		public static extern IntPtr MonitorFromWindow(IntPtr hwnd, uint dwFlags);

		[DllImport("user32.dll", CharSet = CharSet.Unicode)]
		[return: MarshalAs(UnmanagedType.Bool)]
		public static extern bool GetMonitorInfo(IntPtr hMonitor, ref MONITORINFOEX lpmi);
	}
}
"@
}

function Get-DesktopWallpaperComObject {
	Initialize-NativeWallpaperApi

	return New-Object Wallpaper.DesktopWallpaperClient
}

function Resolve-WallpaperPath {
	param(
		[Parameter(Mandatory = $true)]
		[string] $Path
	)

	$resolvedPath = Resolve-Path -Path $Path -ErrorAction Stop
	$item = Get-Item -LiteralPath $resolvedPath.ProviderPath -ErrorAction Stop

	if (-not $item.PSIsContainer) {
		return $item.FullName
	}

	throw "Path must point to an image file: $Path"
}

function Test-RectEquals {
	param(
		[Parameter(Mandatory = $true)]
		[Wallpaper.RECT] $Left,

		[Parameter(Mandatory = $true)]
		[Wallpaper.RECT] $Right
	)

	return $Left.Left -eq $Right.Left -and
		$Left.Top -eq $Right.Top -and
		$Left.Right -eq $Right.Right -and
		$Left.Bottom -eq $Right.Bottom
}

function Get-ActiveMonitorWallpaperId {
	Initialize-NativeWallpaperApi

	$foregroundWindow = [Wallpaper.NativeMethods]::GetForegroundWindow()
	if ($foregroundWindow -eq [IntPtr]::Zero) {
		throw "Unable to get the active window handle."
	}

	$monitorHandle = [Wallpaper.NativeMethods]::MonitorFromWindow(
		$foregroundWindow,
		[Wallpaper.NativeMethods]::MONITOR_DEFAULTTONEAREST
	)

	if ($monitorHandle -eq [IntPtr]::Zero) {
		throw "Unable to determine the monitor for the active window."
	}

	$monitorInfo = New-Object Wallpaper.MONITORINFOEX
	$monitorInfo.cbSize = [Runtime.InteropServices.Marshal]::SizeOf([type] [Wallpaper.MONITORINFOEX])

	if (-not [Wallpaper.NativeMethods]::GetMonitorInfo($monitorHandle, [ref] $monitorInfo)) {
		throw "GetMonitorInfo failed for the active monitor."
	}

	$desktopWallpaper = Get-DesktopWallpaperComObject
	$monitorCount = $desktopWallpaper.GetMonitorDevicePathCount()

	for ($index = 0; $index -lt $monitorCount; $index++) {
		$monitorId = $desktopWallpaper.GetMonitorDevicePathAt([uint32] $index)
		$monitorRect = $desktopWallpaper.GetMonitorRECT($monitorId)

		if (Test-RectEquals -Left $monitorInfo.rcMonitor -Right $monitorRect) {
			return $monitorId
		}
	}

	throw "Unable to map the active monitor to a desktop wallpaper target."
}

function Set-WallpaperOnAllDisplays {
	[CmdletBinding()]
	param(
		[Parameter(Mandatory = $true, Position = 0)]
		[string] $Path
	)

	$fullPath = Resolve-WallpaperPath -Path $Path
	$desktopWallpaper = Get-DesktopWallpaperComObject
	$desktopWallpaper.SetWallpaper($null, $fullPath)
}

function Set-WallpaperOnActiveDisplay {
	[CmdletBinding()]
	param(
		[Parameter(Mandatory = $true, Position = 0)]
		[string] $Path
	)

	$fullPath = Resolve-WallpaperPath -Path $Path
	$monitorId = Get-ActiveMonitorWallpaperId
	$desktopWallpaper = Get-DesktopWallpaperComObject
	$desktopWallpaper.SetWallpaper($monitorId, $fullPath)
}
`
    if (allDesktops) {
        pwshScript += `
        Set-WallpaperOnAllDisplays -Path "${escapedImagePath}"
        `;
    } else {
        pwshScript += `
        Set-WallpaperOnActiveDisplay -Path "${escapedImagePath}"
        `;
    }
    await runPowerShellScript(pwshScript);
  }
}

export function getTempFilePath(filename: string): string {
  return join(environment.supportPath, filename);
}

export function getFileExtension(url: string): string {
  const match = url.match(/\.(\w+)(?:\?|$)/);
  return match ? match[1] : "jpg";
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function purityColor(purity: string): string {
  switch (purity) {
    case "sfw":
      return "#4CAF50";
    case "sketchy":
      return "#FF9800";
    case "nsfw":
      return "#F44336";
    default:
      return "#999999";
  }
}
