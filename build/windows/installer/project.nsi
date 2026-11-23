Unicode true

####
## Please note: Template replacements don't work in this file. They are provided with default defines like
## mentioned underneath.
## If the keyword is not defined, "wails_tools.nsh" will populate them with the values from ProjectInfo.
## If they are defined here, "wails_tools.nsh" will not touch them. This allows to use this project.nsi manually
## from outside of Wails for debugging and development of the installer.
##
## For development first make a wails nsis build to populate the "wails_tools.nsh":
## > wails build --target windows/amd64 --nsis
## Then you can call makensis on this file with specifying the path to your binary:
## For a AMD64 only installer:
## > makensis -DARG_WAILS_AMD64_BINARY=..\..\bin\app.exe
## For a ARM64 only installer:
## > makensis -DARG_WAILS_ARM64_BINARY=..\..\bin\app.exe
## For a installer with both architectures:
## > makensis -DARG_WAILS_AMD64_BINARY=..\..\bin\app-amd64.exe -DARG_WAILS_ARM64_BINARY=..\..\bin\app-arm64.exe
####
## The following information is taken from the ProjectInfo file, but they can be overwritten here.
####
## !define INFO_PROJECTNAME    "MyProject" # Default "{{.Name}}"
## !define INFO_COMPANYNAME    "MyCompany" # Default "{{.Info.CompanyName}}"
## !define INFO_PRODUCTNAME    "MyProduct" # Default "{{.Info.ProductName}}"
## !define INFO_PRODUCTVERSION "1.0.0"     # Default "{{.Info.ProductVersion}}"
## !define INFO_COPYRIGHT      "Copyright" # Default "{{.Info.Copyright}}"
###
## !define PRODUCT_EXECUTABLE  "Application.exe"      # Default "${INFO_PROJECTNAME}.exe"
## !define UNINST_KEY_NAME     "UninstKeyInRegistry"  # Default "${INFO_COMPANYNAME}${INFO_PRODUCTNAME}"
####
## !define REQUEST_EXECUTION_LEVEL "admin"            # Default "admin"  see also https://nsis.sourceforge.io/Docs/Chapter4.html
####
## Include the wails tools
####
!include "wails_tools.nsh"

# The version information for this two must consist of 4 parts
VIProductVersion "${INFO_PRODUCTVERSION}.0"
VIFileVersion    "${INFO_PRODUCTVERSION}.0"

VIAddVersionKey "CompanyName"     "${INFO_COMPANYNAME}"
VIAddVersionKey "FileDescription" "${INFO_PRODUCTNAME} Installer"
VIAddVersionKey "ProductVersion"  "${INFO_PRODUCTVERSION}"
VIAddVersionKey "FileVersion"     "${INFO_PRODUCTVERSION}"
VIAddVersionKey "LegalCopyright"  "${INFO_COPYRIGHT}"
VIAddVersionKey "ProductName"     "${INFO_PRODUCTNAME}"

# Enable HiDPI support. https://nsis.sourceforge.io/Reference/ManifestDPIAware
ManifestDPIAware true

!include "MUI.nsh"
!include "LogicLib.nsh"

!define MUI_ICON "..\icon.ico"
!define MUI_UNICON "..\icon.ico"
# !define MUI_WELCOMEFINISHPAGE_BITMAP "resources\leftimage.bmp" #Include this to add a bitmap on the left side of the Welcome Page. Must be a size of 164x314
!define MUI_FINISHPAGE_NOAUTOCLOSE # Wait on the INSTFILES page so the user can take a look into the details of the installation steps
!define MUI_ABORTWARNING # This will warn the user if they exit from the installer.

Var DirPageTopText
!define MUI_DIRECTORYPAGE_TEXT_TOP "$DirPageTopText"

!insertmacro MUI_PAGE_WELCOME # Welcome to the installer page.
# !insertmacro MUI_PAGE_LICENSE "resources\eula.txt" # Adds a EULA page to the installer
!insertmacro MUI_PAGE_DIRECTORY # In which folder install page.
!insertmacro MUI_PAGE_INSTFILES # Installing page.
!insertmacro MUI_PAGE_FINISH # Finished installation page.

!insertmacro MUI_UNPAGE_INSTFILES # Uinstalling page

!insertmacro MUI_LANGUAGE "English" # Set the Language of the installer

## The following two statements can be used to sign the installer and the uninstaller. The path to the binaries are provided in %1
#!uninstfinalize 'signtool --file "%1"'
#!finalize 'signtool --file "%1"'

Name "${INFO_PRODUCTNAME}"
OutFile "..\..\bin\${INFO_PROJECTNAME}-${ARCH}-installer.exe" # Name of the installer's file.
# Do not hardcode InstallDir here: leaving $INSTDIR empty unless /D=... is passed on CLI
# lets .onInit detect and reuse an existing installation directory before falling back to default.
ShowInstDetails show # This will always show the installation details.

Function StripOuterQuotes
    Exch $0
    Push $1
    StrCpy $1 $0 1
    ${If} $1 == '"'
        StrCpy $0 $0 "" 1
    ${EndIf}
    StrCpy $1 $0 1 -1
    ${If} $1 == '"'
        StrCpy $0 $0 -1
    ${EndIf}
    Pop $1
    Exch $0
FunctionEnd

!macro DetectExistingDirFromRoot ROOT VIEW OUTVAR
    ${If} ${OUTVAR} == ""
        SetRegView ${VIEW}
        ReadRegStr $R0 ${ROOT} "${UNINST_KEY}" "InstallLocation"
        ${If} $R0 != ""
            Push $R0
            Call StripOuterQuotes
            Pop $R0
            ${If} ${FileExists} "$R0\*.*"
                StrCpy ${OUTVAR} $R0
            ${EndIf}
        ${EndIf}
    ${EndIf}
    ${If} ${OUTVAR} == ""
        SetRegView ${VIEW}
        ReadRegStr $R0 ${ROOT} "${UNINST_KEY}" "UninstallString"
        ${If} $R0 != ""
            Push $R0
            Call StripOuterQuotes
            Pop $R0
            ${GetParent} $R0 $R0
            ${If} $R0 != ""
            ${AndIf} ${FileExists} "$R0\*.*"
                StrCpy ${OUTVAR} $R0
            ${EndIf}
        ${EndIf}
    ${EndIf}
    ${If} ${OUTVAR} == ""
        SetRegView ${VIEW}
        ReadRegStr $R0 ${ROOT} "${UNINST_KEY}" "DisplayIcon"
        ${If} $R0 != ""
            Push $R0
            Call StripOuterQuotes
            Pop $R0
            ${GetParent} $R0 $R0
            ${If} $R0 != ""
            ${AndIf} ${FileExists} "$R0\*.*"
                StrCpy ${OUTVAR} $R0
            ${EndIf}
        ${EndIf}
    ${EndIf}
!macroend

Function .onInit
    !insertmacro wails.checkArchitecture

    StrCpy $DirPageTopText "Setup will install ${INFO_PRODUCTNAME} in the following folder. To install in a different folder, click Browse and select another folder. Click Install to start the installation."

    # Only probe registry when /D=<dir> was not explicitly supplied on the command line.
    ${If} $INSTDIR == ""
        Push $R0
        Push $R1
        StrCpy $R1 ""
        !insertmacro DetectExistingDirFromRoot HKLM 64 $R1
        !insertmacro DetectExistingDirFromRoot HKCU 64 $R1
        !insertmacro DetectExistingDirFromRoot HKLM 32 $R1
        !insertmacro DetectExistingDirFromRoot HKCU 32 $R1
        SetRegView 64
        ${If} $R1 != ""
            StrCpy $INSTDIR $R1
            StrCpy $DirPageTopText "An existing ${INFO_PRODUCTNAME} installation was detected and will be updated in the folder below. Click Install to update, or Browse to select a different folder."
        ${Else}
            !ifdef WAILS_INSTALL_SCOPE
              !if "${WAILS_INSTALL_SCOPE}" == "user"
                StrCpy $INSTDIR "$LOCALAPPDATA\Programs\${INFO_PRODUCTNAME}"
              !else
                StrCpy $INSTDIR "$PROGRAMFILES64\${INFO_COMPANYNAME}\${INFO_PRODUCTNAME}"
              !endif
            !else
              StrCpy $INSTDIR "$PROGRAMFILES64\${INFO_COMPANYNAME}\${INFO_PRODUCTNAME}"
            !endif
        ${EndIf}
        Pop $R1
        Pop $R0
    ${EndIf}
FunctionEnd

Section
    !insertmacro wails.setShellContext

    !insertmacro wails.webview2runtime

    SetOutPath $INSTDIR

    # If upgrading while Graviton is still running, rename the running binary aside
    # so the new executable can be written cleanly without a file-lock error.
    ${If} ${FileExists} "$INSTDIR\${PRODUCT_EXECUTABLE}"
        Delete "$INSTDIR\${PRODUCT_EXECUTABLE}.bak"
        ClearErrors
        Rename "$INSTDIR\${PRODUCT_EXECUTABLE}" "$INSTDIR\${PRODUCT_EXECUTABLE}.bak"
    ${EndIf}

    !insertmacro wails.files

    ${If} ${FileExists} "$INSTDIR\${PRODUCT_EXECUTABLE}.bak"
        Delete /REBOOTOK "$INSTDIR\${PRODUCT_EXECUTABLE}.bak"
        SetRebootFlag false
    ${EndIf}

    CreateShortcut "$SMPROGRAMS\${INFO_PRODUCTNAME}.lnk" "$INSTDIR\${PRODUCT_EXECUTABLE}"
    CreateShortCut "$DESKTOP\${INFO_PRODUCTNAME}.lnk" "$INSTDIR\${PRODUCT_EXECUTABLE}"

    !insertmacro wails.associateFiles
    !insertmacro wails.associateCustomProtocols

    !insertmacro wails.writeUninstaller

    SetRegView 64
    !ifdef WAILS_INSTALL_SCOPE
      !if "${WAILS_INSTALL_SCOPE}" == "user"
        WriteRegStr HKCU "${UNINST_KEY}" "InstallLocation" "$INSTDIR"
      !else
        WriteRegStr HKLM "${UNINST_KEY}" "InstallLocation" "$INSTDIR"
      !endif
    !else
      WriteRegStr HKLM "${UNINST_KEY}" "InstallLocation" "$INSTDIR"
    !endif
SectionEnd

Section "uninstall"
    !insertmacro wails.setShellContext

    RMDir /r "$AppData\${PRODUCT_EXECUTABLE}" # Remove the WebView2 DataPath

    RMDir /r $INSTDIR

    Delete "$SMPROGRAMS\${INFO_PRODUCTNAME}.lnk"
    Delete "$DESKTOP\${INFO_PRODUCTNAME}.lnk"

    !insertmacro wails.unassociateFiles
    !insertmacro wails.unassociateCustomProtocols

    !insertmacro wails.deleteUninstaller
SectionEnd
