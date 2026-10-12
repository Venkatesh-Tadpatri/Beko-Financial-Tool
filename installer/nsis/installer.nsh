; Custom parts of the Financial Visualization Tool installer (included by electron-builder).
;  - a page to choose the desktop and Start menu shortcuts
;  - uninstall keeps all data unless the user confirms deletion twice

!include nsDialogs.nsh
!include LogicLib.nsh

!ifndef BUILD_UNINSTALLER

Var DesktopCheckbox
Var StartMenuCheckbox
Var WantDesktop
Var WantStartMenu

!macro customInit
  ; defaults (also used for silent installs): both shortcuts
  StrCpy $WantDesktop ${BST_CHECKED}
  StrCpy $WantStartMenu ${BST_CHECKED}
!macroend

; The page functions are defined inside this macro because electron-builder expands it where
; the wizard pages are declared, i.e. after MUI2 is loaded (MUI_HEADER_TEXT exists there).
!macro customPageAfterChangeDir
  Page custom ShortcutsPageCreate ShortcutsPageLeave

Function ShortcutsPageCreate
  !insertmacro MUI_HEADER_TEXT "Shortcuts" "Choose which shortcuts to create."
  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}
  ${NSD_CreateLabel} 0 0 100% 20u "Financial Visualization Tool can be started from these shortcuts:"
  Pop $0
  ${NSD_CreateCheckbox} 0 26u 100% 12u "Create a &desktop shortcut"
  Pop $DesktopCheckbox
  ${NSD_SetState} $DesktopCheckbox $WantDesktop
  ${NSD_CreateCheckbox} 0 44u 100% 12u "Create a &Start menu shortcut"
  Pop $StartMenuCheckbox
  ${NSD_SetState} $StartMenuCheckbox $WantStartMenu
  nsDialogs::Show
FunctionEnd

Function ShortcutsPageLeave
  ${NSD_GetState} $DesktopCheckbox $WantDesktop
  ${NSD_GetState} $StartMenuCheckbox $WantStartMenu
FunctionEnd
!macroend

!macro customInstall
  ${If} $WantDesktop == ${BST_CHECKED}
    CreateShortCut "$DESKTOP\${SHORTCUT_NAME}.lnk" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" "" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" 0
  ${Else}
    Delete "$DESKTOP\${SHORTCUT_NAME}.lnk"
  ${EndIf}
  ${If} $WantStartMenu == ${BST_CHECKED}
    CreateShortCut "$SMPROGRAMS\${SHORTCUT_NAME}.lnk" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" "" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" 0
  ${Else}
    Delete "$SMPROGRAMS\${SHORTCUT_NAME}.lnk"
  ${EndIf}
!macroend

!endif

!macro customUnInstall
  Delete "$DESKTOP\${SHORTCUT_NAME}.lnk"
  Delete "$SMPROGRAMS\${SHORTCUT_NAME}.lnk"

  ; Upgrades run the old uninstaller silently: never touch data then.
  ${ifNot} ${isUpdated}
  ${AndIfNot} ${Silent}
    MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 \
      "The application has been removed.$\r$\n$\r$\nYour financial data, backups, uploaded files and logs are kept in:$\r$\n%APPDATA%\FinancialVisualizationTool$\r$\n$\r$\nDo you also want to delete all of this data?$\r$\n(Choose No to keep it. This is recommended.)" \
      IDYES fvt_ask_delete
    Goto fvt_keep_data
    fvt_ask_delete:
      MessageBox MB_OKCANCEL|MB_ICONEXCLAMATION|MB_DEFBUTTON2 \
        "This permanently deletes all financial data and backups." \
        IDOK fvt_delete_data
      Goto fvt_keep_data
    fvt_delete_data:
      SetShellVarContext current
      RMDir /r "$APPDATA\FinancialVisualizationTool"
      SetShellVarContext all
    fvt_keep_data:
  ${endIf}
!macroend
