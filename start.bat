@echo off
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js belum terpasang.
  echo Pasang dulu dari https://nodejs.org ^(pilih versi LTS^), lalu klik file ini lagi.
  start "" https://nodejs.org
  pause
  exit /b 1
)

if not exist node_modules (
  echo Pemasangan pertama kali, mohon tunggu 1-2 menit...
  call npm install
  if errorlevel 1 (
    echo Gagal memasang. Cek koneksi internet, lalu coba lagi.
    pause
    exit /b 1
  )
)

start "" http://localhost:3737
node server.mjs
pause
