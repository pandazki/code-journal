@echo off
:: Windows wrapper for the Node-based code-journal CLI.
:: Mirrors the bash wrapper at ./code-journal.
setlocal
set "HERE=%~dp0"
set "BUNDLE=%HERE%code-journal.js"
if not exist "%BUNDLE%" (
  echo code-journal: %BUNDLE% missing -- run 'npm install' from the workspace root to build it 1>&2
  exit /b 1
)
:: CJ_NODE_BIN lets an embedder (Electron-bundled apps, or standalone
:: bun-binary `claude` distributions without system Node) substitute its
:: own Node-compatible interpreter. Defaults to `node` on PATH.
set "WM_NODE_LOCAL=%CJ_NODE_BIN%"
if "%WM_NODE_LOCAL%"=="" set "WM_NODE_LOCAL=node"
"%WM_NODE_LOCAL%" "%BUNDLE%" %*
