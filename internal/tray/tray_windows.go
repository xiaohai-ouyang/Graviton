//go:build windows

package tray

import (
	"os"
	"runtime"
	"sync"
	"syscall"
	"unsafe"

	"golang.org/x/sys/windows"
)

const (
	wmDestroy    = 0x0002
	wmCommand    = 0x0111
	wmUser       = 0x0400
	wmTrayIcon   = wmUser + 1
	wmLButtonUp  = 0x0202
	wmLButtonDbl = 0x0203
	wmRButtonUp  = 0x0205

	nimAdd    = 0x00000000
	nimDelete = 0x00000002

	nifMessage = 0x00000001
	nifIcon    = 0x00000002
	nifTip     = 0x00000004

	mfString    = 0x00000000
	mfSeparator = 0x00000800

	tpmRightButton = 0x0002
	tpmBottomAlign = 0x0020

	cmdShowMain     = 1001
	cmdToggleWidget = 1002
	cmdRefreshAll   = 1003
	cmdQuit         = 1004
)

var (
	user32   = windows.NewLazySystemDLL("user32.dll")
	shell32  = windows.NewLazySystemDLL("shell32.dll")
	kernel32 = windows.NewLazySystemDLL("kernel32.dll")

	procRegisterClassExW   = user32.NewProc("RegisterClassExW")
	procCreateWindowExW    = user32.NewProc("CreateWindowExW")
	procDestroyWindow      = user32.NewProc("DestroyWindow")
	procDefWindowProcW     = user32.NewProc("DefWindowProcW")
	procGetMessageW        = user32.NewProc("GetMessageW")
	procTranslateMessage   = user32.NewProc("TranslateMessage")
	procDispatchMessageW   = user32.NewProc("DispatchMessageW")
	procPostQuitMessage    = user32.NewProc("PostQuitMessage")
	procPostMessageW       = user32.NewProc("PostMessageW")
	procLoadIconW          = user32.NewProc("LoadIconW")
	procCreatePopupMenu    = user32.NewProc("CreatePopupMenu")
	procAppendMenuW        = user32.NewProc("AppendMenuW")
	procTrackPopupMenu     = user32.NewProc("TrackPopupMenu")
	procDestroyMenu        = user32.NewProc("DestroyMenu")
	procSetForegroundWin   = user32.NewProc("SetForegroundWindow")
	procGetCursorPos       = user32.NewProc("GetCursorPos")
	procGetModuleHandleW   = kernel32.NewProc("GetModuleHandleW")
	procShellNotifyIconW   = shell32.NewProc("Shell_NotifyIconW")
	procExtractIconW       = shell32.NewProc("ExtractIconW")
)

type wndClassExW struct {
	cbSize        uint32
	style         uint32
	lpfnWndProc   uintptr
	cbClsExtra    int32
	cbWndExtra    int32
	hInstance     uintptr
	hIcon         uintptr
	hCursor       uintptr
	hbrBackground uintptr
	lpszMenuName  *uint16
	lpszClassName *uint16
	hIconSm       uintptr
}

type point struct {
	x int32
	y int32
}

type msg struct {
	hwnd    uintptr
	message uint32
	wParam  uintptr
	lParam  uintptr
	time    uint32
	pt      point
}

type notifyIconDataW struct {
	cbSize           uint32
	hWnd             uintptr
	uID              uint32
	uFlags           uint32
	uCallbackMessage uint32
	hIcon            uintptr
	szTip            [128]uint16
	dwState          uint32
	dwStateMask      uint32
	szInfo           [256]uint16
	uVersion         uint32
	szInfoTitle      [64]uint16
	dwInfoFlags      uint32
	guidItem         windows.GUID
	hBalloonIcon     uintptr
}

// Callbacks defines actions triggered from the Windows system tray.
type Callbacks struct {
	OnShowMain     func()
	OnToggleWidget func()
	OnRefreshAll   func()
	OnQuit         func()
}

// Tray manages the Windows system tray icon and context menu.
type Tray struct {
	mu       sync.Mutex
	hwnd     uintptr
	hIcon    uintptr
	cb       Callbacks
	closed   bool
	ready    chan struct{}
}

// Start initializes and runs the system tray icon on a dedicated OS thread.
func Start(cb Callbacks) *Tray {
	t := &Tray{
		cb:    cb,
		ready: make(chan struct{}),
	}
	go t.run()
	<-t.ready
	return t
}

// Close removes the tray icon and terminates the message loop.
func (t *Tray) Close() {
	t.mu.Lock()
	if t.closed {
		t.mu.Unlock()
		return
	}
	t.closed = true
	hwnd := t.hwnd
	t.mu.Unlock()

	if hwnd != 0 {
		nid := notifyIconDataW{
			cbSize: uint32(unsafe.Sizeof(notifyIconDataW{})),
			hWnd:   hwnd,
			uID:    1,
		}
		_, _, _ = procShellNotifyIconW.Call(nimDelete, uintptr(unsafe.Pointer(&nid)))
		_, _, _ = procPostMessageW.Call(hwnd, wmDestroy, 0, 0)
	}
}

func (t *Tray) run() {
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()

	hInst, _, _ := procGetModuleHandleW.Call(0)
	className, _ := windows.UTF16PtrFromString("GravitonTrayWindowClass")
	winTitle, _ := windows.UTF16PtrFromString("GravitonTray")

	wndProc := syscall.NewCallback(func(hwnd uintptr, uMsg uint32, wParam, lParam uintptr) uintptr {
		switch uMsg {
		case wmTrayIcon:
			switch uint32(lParam) {
			case wmLButtonDbl, wmLButtonUp:
				if t.cb.OnShowMain != nil {
					go t.cb.OnShowMain()
				}
			case wmRButtonUp:
				t.showContextMenu(hwnd)
			}
			return 0
		case wmCommand:
			switch int(wParam & 0xFFFF) {
			case cmdShowMain:
				if t.cb.OnShowMain != nil {
					go t.cb.OnShowMain()
				}
			case cmdToggleWidget:
				if t.cb.OnToggleWidget != nil {
					go t.cb.OnToggleWidget()
				}
			case cmdRefreshAll:
				if t.cb.OnRefreshAll != nil {
					go t.cb.OnRefreshAll()
				}
			case cmdQuit:
				if t.cb.OnQuit != nil {
					go t.cb.OnQuit()
				}
			}
			return 0
		case wmDestroy:
			_, _, _ = procPostQuitMessage.Call(0)
			return 0
		}
		ret, _, _ := procDefWindowProcW.Call(hwnd, uintptr(uMsg), wParam, lParam)
		return ret
	})

	wc := wndClassExW{
		cbSize:        uint32(unsafe.Sizeof(wndClassExW{})),
		lpfnWndProc:   wndProc,
		hInstance:     hInst,
		lpszClassName: className,
	}
	_, _, _ = procRegisterClassExW.Call(uintptr(unsafe.Pointer(&wc)))

	hwnd, _, _ := procCreateWindowExW.Call(
		0,
		uintptr(unsafe.Pointer(className)),
		uintptr(unsafe.Pointer(winTitle)),
		0, 0, 0, 0, 0,
		0, 0, hInst, 0,
	)

	hIcon := loadAppIcon(hInst)

	t.mu.Lock()
	t.hwnd = hwnd
	t.hIcon = hIcon
	t.mu.Unlock()

	if hwnd != 0 {
		nid := notifyIconDataW{
			cbSize:           uint32(unsafe.Sizeof(notifyIconDataW{})),
			hWnd:             hwnd,
			uID:              1,
			uFlags:           nifMessage | nifIcon | nifTip,
			uCallbackMessage: wmTrayIcon,
			hIcon:            hIcon,
		}
		tipUTF16, _ := windows.UTF16FromString("Graviton - Antigravity 额度管理")
		copy(nid.szTip[:], tipUTF16)
		_, _, _ = procShellNotifyIconW.Call(nimAdd, uintptr(unsafe.Pointer(&nid)))
	}

	close(t.ready)

	var m msg
	for {
		ret, _, _ := procGetMessageW.Call(uintptr(unsafe.Pointer(&m)), 0, 0, 0)
		if int32(ret) <= 0 {
			break
		}
		_, _, _ = procTranslateMessage.Call(uintptr(unsafe.Pointer(&m)))
		_, _, _ = procDispatchMessageW.Call(uintptr(unsafe.Pointer(&m)))
	}
}

func (t *Tray) showContextMenu(hwnd uintptr) {
	hMenu, _, _ := procCreatePopupMenu.Call()
	if hMenu == 0 {
		return
	}
	defer procDestroyMenu.Call(hMenu)

	appendMenuItem(hMenu, mfString, cmdShowMain, "显示主窗口")
	appendMenuItem(hMenu, mfString, cmdToggleWidget, "显示 / 隐藏悬浮窗")
	appendMenuItem(hMenu, mfString, cmdRefreshAll, "刷新全部额度")
	appendMenuItem(hMenu, mfSeparator, 0, "")
	appendMenuItem(hMenu, mfString, cmdQuit, "退出 Graviton")

	var pt point
	_, _, _ = procGetCursorPos.Call(uintptr(unsafe.Pointer(&pt)))
	_, _, _ = procSetForegroundWin.Call(hwnd)
	_, _, _ = procTrackPopupMenu.Call(hMenu, tpmRightButton|tpmBottomAlign, uintptr(pt.x), uintptr(pt.y), 0, hwnd, 0)
}

func appendMenuItem(hMenu uintptr, flags uint32, id uintptr, text string) {
	if text == "" {
		_, _, _ = procAppendMenuW.Call(hMenu, uintptr(flags), id, 0)
		return
	}
	p, _ := windows.UTF16PtrFromString(text)
	_, _, _ = procAppendMenuW.Call(hMenu, uintptr(flags), id, uintptr(unsafe.Pointer(p)))
}

func loadAppIcon(hInst uintptr) uintptr {
	if exePath, err := os.Executable(); err == nil {
		if p, err := windows.UTF16PtrFromString(exePath); err == nil {
			hIcon, _, _ := procExtractIconW.Call(hInst, uintptr(unsafe.Pointer(p)), 0)
			if hIcon > 1 {
				return hIcon
			}
		}
	}
	// Fallback to standard application icon (IDI_APPLICATION = 32512)
	hIcon, _, _ := procLoadIconW.Call(0, 32512)
	return hIcon
}
