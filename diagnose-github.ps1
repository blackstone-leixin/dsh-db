#Requires -Version 5.1
# Network diagnostics for pushing to GitHub.
# Run from the plugin directory: powershell -ExecutionPolicy Bypass -File .\diagnose-github.ps1
# It only reads configuration and makes short connection attempts; it changes nothing.

$ErrorActionPreference = 'Continue'

Write-Host '== git =='
git --version
Write-Host ''
Write-Host '== git proxy config =='
Write-Host ("http.proxy  = " + (git config --global --get http.proxy))
Write-Host ("https.proxy = " + (git config --global --get https.proxy))
Write-Host ''
Write-Host '== Windows proxy (WinHTTP) =='
netsh winhttp show proxy
Write-Host ''
Write-Host '== HTTPS https://github.com =='
curl.exe -sS -I -m 15 https://github.com 2>&1 | Select-Object -First 8
Write-Host ''
Write-Host '== SSH port 22 =='
if (Get-Command ssh -ErrorAction SilentlyContinue) {
  ssh -T -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=no git@github.com 2>&1
} else {
  Write-Host 'ssh not found'
}
Write-Host ''
Write-Host '== SSH port 443 =='
if (Get-Command ssh -ErrorAction SilentlyContinue) {
  ssh -T -p 443 -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=no git@ssh.github.com 2>&1
} else {
  Write-Host 'ssh not found'
}
Write-Host ''
Write-Host 'If HTTPS is reset but SSH 443 says "Permission denied (publickey)", GitHub SSH works: use an SSH key.'
Write-Host 'If both are reset, the network is blocking GitHub: use a proxy/VPN.'
Write-Host 'Copy everything above and send it back.'
