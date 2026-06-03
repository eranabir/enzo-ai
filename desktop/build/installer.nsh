; Custom NSIS hooks — append install dir to user PATH on install.
; Uses direct registry writes (no external plugins required).

!macro customInstall
  ; Read current user PATH and append install directory
  ReadRegStr $R0 HKCU "Environment" "Path"
  StrCmp $R0 "" 0 +2
    StrCpy $R0 "$INSTDIR"
  StrCpy $R0 "$R0;$INSTDIR"
  WriteRegExpandStr HKCU "Environment" "Path" "$R0"
  ; Notify open terminals of the PATH change
  SendMessage ${HWND_BROADCAST} ${WM_SETTINGCHANGE} 0 "STR:Environment" /TIMEOUT=5000
!macroend

!macro customUninstall
  ; Notify open terminals (PATH cleanup left to user on uninstall)
  SendMessage ${HWND_BROADCAST} ${WM_SETTINGCHANGE} 0 "STR:Environment" /TIMEOUT=5000
!macroend
