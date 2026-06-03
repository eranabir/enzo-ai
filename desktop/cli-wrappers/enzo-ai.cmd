@echo off
:: Enzo AI CLI wrapper — runs the CLI bundle using the bundled Electron/Node binary.
:: ELECTRON_RUN_AS_NODE=1 makes Electron behave as plain Node.js.
set ELECTRON_RUN_AS_NODE=1
"%~dp0Enzo AI.exe" "%~dp0resources\cli\bundle\index.js" %*
