Get-Content "$PSScriptRoot\..\.env.local" | Where-Object { $_ -match '^[A-Z_]+=' } | ForEach-Object {
  $k, $v = $_ -split '=', 2
  Set-Item "env:$k" $v
}
npx vercel dev --listen 3000
