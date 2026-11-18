; Последняя страница мастера установки: запуск программы и ярлык на рабочем столе по желанию.
!macro customFinishPage
  !define MUI_FINISHPAGE_RUN "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
  !define MUI_FINISHPAGE_RUN_TEXT "Запустить Island Player"
  !define MUI_FINISHPAGE_SHOWREADME ""
  !define MUI_FINISHPAGE_SHOWREADME_NOTCHECKED
  !define MUI_FINISHPAGE_SHOWREADME_TEXT "Создать ярлык на рабочем столе"
  !define MUI_FINISHPAGE_SHOWREADME_FUNCTION IslandDesktopShortcut
  !insertmacro MUI_PAGE_FINISH
!macroend

!ifndef BUILD_UNINSTALLER
Function IslandDesktopShortcut
  CreateShortCut "$DESKTOP\${PRODUCT_FILENAME}.lnk" "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
FunctionEnd
!endif

!macro customUnInstall
  Delete "$DESKTOP\${PRODUCT_FILENAME}.lnk"
!macroend
