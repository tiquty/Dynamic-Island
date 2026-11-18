; Последняя страница мастера установки: запуск программы и ярлык на рабочем столе по желанию.
; Имя exe совпадает с названием продукта (PRODUCT_FILENAME задаёт сам electron-builder).
!macro customFinishPage
  !define MUI_FINISHPAGE_RUN "$INSTDIR\${PRODUCT_FILENAME}.exe"
  !define MUI_FINISHPAGE_RUN_TEXT "Запустить Island Player"
  !define MUI_FINISHPAGE_SHOWREADME ""
  !define MUI_FINISHPAGE_SHOWREADME_NOTCHECKED
  !define MUI_FINISHPAGE_SHOWREADME_TEXT "Создать ярлык на рабочем столе"
  !define MUI_FINISHPAGE_SHOWREADME_FUNCTION IslandDesktopShortcut
  !insertmacro MUI_PAGE_FINISH
!macroend

!ifndef BUILD_UNINSTALLER
Function IslandDesktopShortcut
  CreateShortCut "$DESKTOP\${PRODUCT_FILENAME}.lnk" "$INSTDIR\${PRODUCT_FILENAME}.exe"
FunctionEnd
!endif

!macro customUnInstall
  Delete "$DESKTOP\${PRODUCT_FILENAME}.lnk"
!macroend
