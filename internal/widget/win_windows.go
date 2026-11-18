//go:build windows

package widget

import (
	"unsafe"

	"golang.org/x/sys/windows"
)

const (
	gwlStyle   = ^uintptr(15) // -16 (GWL_STYLE)
	gwlExStyle = ^uintptr(19) // -20 (GWL_EXSTYLE)

	wsCaption     = 0x00C00000
	wsSysMenu     = 0x00080000
	wsThickFrame  = 0x00040000
	wsMinimizeBox = 0x00020000
	wsMaximizeBox = 0x00010000

	wsExToolWindow = 0x00000080
	wsExAppWindow  = 0x00040000

	swpNoSize       = 0x0001
	swpNoMove       = 0x0002
	swpNoZOrder     = 0x0004
	swpNoActivate   = 0x0010
	swpFrameChanged = 0x0020

	dwmwaWindowCornerPreference = 33
	dwmwcpRound                 = 2

	monitorDefaultToNearest = 0x00000002
)

var (
	user32                = windows.NewLazySystemDLL("user32.dll")
	dwmapi                = windows.NewLazySystemDLL("dwmapi.dll")
	procFindWindowW       = user32.NewProc("FindWindowW")
	procGetWindowLongPtrW = user32.NewProc("GetWindowLongPtrW")
	procSetWindowLongPtrW = user32.NewProc("SetWindowLongPtrW")
	procSetWindowPos      = user32.NewProc("SetWindowPos")
	procGetWindowRect     = user32.NewProc("GetWindowRect")
	procMonitorFromWindow = user32.NewProc("MonitorFromWindow")
	procGetMonitorInfoW   = user32.NewProc("GetMonitorInfoW")
	procSystemParameters  = user32.NewProc("SystemParametersInfoW")
	procDwmSetWindowAttr  = dwmapi.NewProc("DwmSetWindowAttribute")
)

type rect struct {
	left   int32
	top    int32
	right  int32
	bottom int32
}

type monitorInfo struct {
	cbSize    uint32
	rcMonitor rect
	rcWork    rect
	dwFlags   uint32
}

// WorkArea represents the usable screen bounds (excluding taskbar).
type WorkArea struct {
	Left   int `json:"left"`
	Top    int `json:"top"`
	Right  int `json:"right"`
	Bottom int `json:"bottom"`
}

// WindowBounds represents the window position and dimensions on screen.
type WindowBounds struct {
	X      int `json:"x"`
	Y      int `json:"y"`
	Width  int `json:"width"`
	Height int `json:"height"`
}

func findWindowByTitle(title string) uintptr {
	p, err := windows.UTF16PtrFromString(title)
	if err != nil {
		return 0
	}
	hwnd, _, _ := procFindWindowW.Call(0, uintptr(unsafe.Pointer(p)))
	return hwnd
}

// ConfigureWidgetWindow strips native caption/sysmenu buttons and applies WS_EX_TOOLWINDOW
// so the floating widget stays hidden from taskbar/Alt-Tab without a native [x] button.
func ConfigureWidgetWindow(title string) {
	hwnd := findWindowByTitle(title)
	if hwnd == 0 {
		return
	}
	style, _, _ := procGetWindowLongPtrW.Call(hwnd, gwlStyle)
	newStyle := style &^ uintptr(wsCaption|wsSysMenu|wsThickFrame|wsMinimizeBox|wsMaximizeBox)
	_, _, _ = procSetWindowLongPtrW.Call(hwnd, gwlStyle, newStyle)

	exStyle, _, _ := procGetWindowLongPtrW.Call(hwnd, gwlExStyle)
	newExStyle := (exStyle | wsExToolWindow) &^ uintptr(wsExAppWindow)
	_, _, _ = procSetWindowLongPtrW.Call(hwnd, gwlExStyle, newExStyle)

	_, _, _ = procSetWindowPos.Call(hwnd, 0, 0, 0, 0, 0, swpNoMove|swpNoSize|swpNoZOrder|swpNoActivate|swpFrameChanged)

	cornerPref := uint32(dwmwcpRound)
	_, _, _ = procDwmSetWindowAttr.Call(
		hwnd,
		dwmwaWindowCornerPreference,
		uintptr(unsafe.Pointer(&cornerPref)),
		unsafe.Sizeof(cornerPref),
	)
}

// GetWorkArea returns the usable work area of the monitor containing the widget window (or primary monitor).
func GetWorkArea(title string) WorkArea {
	hwnd := findWindowByTitle(title)
	if hwnd != 0 {
		hMon, _, _ := procMonitorFromWindow.Call(hwnd, monitorDefaultToNearest)
		if hMon != 0 {
			var mi monitorInfo
			mi.cbSize = uint32(unsafe.Sizeof(mi))
			ret, _, _ := procGetMonitorInfoW.Call(hMon, uintptr(unsafe.Pointer(&mi)))
			if ret != 0 {
				return WorkArea{
					Left:   int(mi.rcWork.left),
					Top:    int(mi.rcWork.top),
					Right:  int(mi.rcWork.right),
					Bottom: int(mi.rcWork.bottom),
				}
			}
		}
	}

	var r rect
	// SPI_GETWORKAREA = 0x0030
	_, _, _ = procSystemParameters.Call(0x0030, 0, uintptr(unsafe.Pointer(&r)), 0)
	return WorkArea{
		Left:   int(r.left),
		Top:    int(r.top),
		Right:  int(r.right),
		Bottom: int(r.bottom),
	}
}

// GetWindowBounds returns the current screen bounds of the named window.
func GetWindowBounds(title string) (WindowBounds, bool) {
	hwnd := findWindowByTitle(title)
	if hwnd == 0 {
		return WindowBounds{}, false
	}
	var r rect
	ret, _, _ := procGetWindowRect.Call(hwnd, uintptr(unsafe.Pointer(&r)))
	if ret == 0 {
		return WindowBounds{}, false
	}
	return WindowBounds{
		X:      int(r.left),
		Y:      int(r.top),
		Width:  int(r.right - r.left),
		Height: int(r.bottom - r.top),
	}, true
}

// SetWindowBounds moves the named window to (x, y) without changing its size or activation.
func SetWindowBounds(title string, x, y int) {
	hwnd := findWindowByTitle(title)
	if hwnd == 0 {
		return
	}
	_, _, _ = procSetWindowPos.Call(hwnd, 0, uintptr(x), uintptr(y), 0, 0, swpNoSize|swpNoZOrder|swpNoActivate)
}
