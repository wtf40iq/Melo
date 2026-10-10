; Данные Melo (вход ВК, настройки) лежат в папке установки: $INSTDIR\data.
; При обновлении они сохраняются, при удалении — стираются только по галочке «Удалить данные приложения».
!macro NSIS_HOOK_POSTUNINSTALL
  ${If} $DeleteAppDataCheckboxState = 1
  ${AndIf} $UpdateMode <> 1
    RMDir /r "$INSTDIR\data"
    RMDir "$INSTDIR"
  ${EndIf}
!macroend
