package main

import (
	"embed"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/windows"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	// Create an instance of the app structure
	app := NewApp()

	// Create application with options
	err := wails.Run(&options.App{
		Title:     "CodeTool",
		Width:     1000,
		Height:    720,
		MinWidth:  760,
		MinHeight: 520,
		Frameless: false,
		SingleInstanceLock: &options.SingleInstanceLock{
			UniqueId: "codetool-single-instance-lock-4b3eef5b",
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
