package main

import (
	"embed"
	"os"
	"strconv"
	"strings"

	"graviton/internal/widget"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/windows"
)

//go:embed all:frontend/dist
var assets embed.FS

func parseWidgetArgs(args []string) (isWidget bool, port int, token string) {
	for _, arg := range args {
		switch {
		case arg == "--widget":
			isWidget = true
		case strings.HasPrefix(arg, "--port="):
			p, err := strconv.Atoi(strings.TrimPrefix(arg, "--port="))
			if err == nil {
				port = p
			}
		case strings.HasPrefix(arg, "--token="):
			token = strings.TrimPrefix(arg, "--token=")
		}
	}
	return isWidget, port, token
}

func main() {
	if isWidget, port, token := parseWidgetArgs(os.Args[1:]); isWidget {
		widgetApp := NewWidgetApp(port, token)
		err := wails.Run(&options.App{
			Title:         widget.WidgetWindowTitle,
			Width:         340,
			Height:        200,
			MinWidth:      300,
			MinHeight:     140,
			Frameless:     true,
			AlwaysOnTop:   false,
			DisableResize: true,
			AssetServer: &assetserver.Options{
				Assets: assets,
			},
			BackgroundColour: &options.RGBA{R: 0, G: 0, B: 0, A: 0},
			OnStartup:        widgetApp.startup,
			OnDomReady:       widgetApp.domReady,
			Bind: []interface{}{
				widgetApp,
			},
			Windows: &windows.Options{
				WebviewIsTransparent: true,
				WindowIsTranslucent:  true,
				DisableWindowIcon:    true,
				Theme:                windows.SystemDefault,
			},
		})
		if err != nil {
			println("Widget Error:", err.Error())
		}
		return
	}

	// Create an instance of the app structure
	app := NewApp()
	windowTitle := app.GetAppInfo().WindowTitle("Graviton")

	// Create application with options
	err := wails.Run(&options.App{
		Title:             windowTitle,
		Width:             1000,
		Height:            720,
		MinWidth:          760,
		MinHeight:         520,
		Frameless:         false,
		HideWindowOnClose: true,
		SingleInstanceLock: &options.SingleInstanceLock{
			UniqueId: "graviton-single-instance-lock-4b3eef5b",
			OnSecondInstanceLaunch: func(data options.SecondInstanceData) {
				app.onSecondInstanceLaunch(optionsSecondInstanceData{
					Args:             data.Args,
					WorkingDirectory: data.WorkingDirectory,
				})
			},
		},
		AssetServer: &assetserver.Options{
			Assets: assets,
		},
		BackgroundColour: &options.RGBA{R: 250, G: 250, B: 250, A: 1},
		OnStartup:        app.startup,
		OnDomReady:       app.domReady,
		OnBeforeClose:    app.onBeforeClose,
		OnShutdown:       app.shutdown,
		Bind: []interface{}{
			app,
		},
		Windows: &windows.Options{
			WebviewIsTransparent: false,
			WindowIsTranslucent:  false,
			DisableWindowIcon:    false,
			Theme:                windows.SystemDefault,
		},
	})

	if err != nil {
		println("Error:", err.Error())
	}
}
