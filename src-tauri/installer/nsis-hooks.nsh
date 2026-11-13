; NSIS uninstaller hooks for CCOTT.
; Removes HKCU Run and StartupApproved\Run entries created by tauri-plugin-autostart (auto-launch).
; User data (%APPDATA%\dev.islandwin.app) is intentionally preserved on uninstall.

!macro NSIS_HOOK_POSTUNINSTALL
  ${If} $UpdateMode <> 1
    ; Current productName ("CCOTT" = ${PRODUCTNAME}, matching app.package_info().name in tauri-plugin-autostart)
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "${PRODUCTNAME}"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "${PRODUCTNAME}"
    ; Legacy pre-rebrand entry ("island-win")
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "island-win"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "island-win"
  ${EndIf}
!macroend
