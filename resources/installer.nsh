!macro customCheckAppRunning
  ; Kill the entire process tree before install/upgrade.
  ; /T = kill child processes (node.exe, MCP servers), /F = force
  ; Only during install pass; uninstaller pass is a no-op.
  !ifndef BUILD_UNINSTALLER
  nsExec::Exec 'taskkill /T /F /IM "sophron cowork.exe"'
  Pop $R0
  nsExec::Exec 'taskkill /T /F /IM "九思助理.exe"'
  Pop $R0
  ; Kill orphaned node.exe from install directory via PowerShell (wmic deprecated on Win 11)
  ; $$ escapes dollar sign in NSIS so PowerShell receives $_ correctly
  nsExec::Exec 'powershell.exe -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $$_.Name -eq ''node.exe'' -and ($$_.ExecutablePath -like ''*sophron cowork*'' -or $$_.ExecutablePath -like ''*九思助理*'') } | ForEach-Object { Stop-Process -Id $$_.ProcessId -Force -ErrorAction SilentlyContinue }"'
  Pop $R0
  ; Wait for processes to exit and release file locks
  Sleep 3000
  !endif
!macroend
