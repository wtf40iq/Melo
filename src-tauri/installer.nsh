; Данные Melo (вход ВК, настройки) лежат в папке установки: $INSTDIR\data.
; При обновлении они сохраняются, при удалении — стираются только по галочке «Удалить данные приложения».
!macro NSIS_HOOK_POSTUNINSTALL
  ${If} $DeleteAppDataCheckboxState = 1
  ${AndIf} $UpdateMode <> 1
    RMDir /r "$INSTDIR\data"
    RMDir "$INSTDIR"
  ${EndIf}
!macroend

; Перед установкой закрываем любой запущенный Melo — где бы ни лежал его exe
; (например, Melo.exe без установки или копия, свёрнутая в трей). Иначе файл занят,
; а при запуске новой версии открывается старое окно, и кажется, что ничего не обновилось.
!macro NSIS_HOOK_PREINSTALL
  nsExec::Exec 'taskkill /F /T /IM melo.exe'
  Pop $0
  Sleep 800
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  nsExec::Exec 'taskkill /F /T /IM melo.exe'
  Pop $0
  Sleep 800
!macroend
