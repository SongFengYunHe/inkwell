<#
.SYNOPSIS
  安全回滚到某个快照标签。回滚前会先把当前 HEAD 备份为 rescue/<时间>-<SHA> 标签，
  因此任何一次回滚都可以再「回退回来」，不会丢失工作。

.EXAMPLE
  powershell -File scripts/git-rollback.ps1 -Tag snapshot/20260927-120000-abc1234
  powershell -File scripts/git-rollback.ps1 -Tag snapshot/20260927-120000-abc1234 -Force

.NOTES
  查看可用快照： git tag -l "snapshot/*" --sort=-creatordate
  撤销回滚：     git reset --hard rescue/<时间>-<SHA>
#>
param(
  [Parameter(Mandatory = $true)][string]$Tag,
  [switch]$Force
)

$ErrorActionPreference = 'Stop'
$root = (git rev-parse --show-toplevel).Trim()
Set-Location $root

git rev-parse -q --verify "refs/tags/$Tag" | Out-Null
if ($LASTEXITCODE -ne 0) {
  Write-Host '[git-rollback] 可用快照：'
  git tag -l 'snapshot/*' --sort=-creatordate
  throw "找不到快照标签：$Tag"
}

# 安全垫：先备份当前状态，保证回滚动作本身可逆
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$current = (git rev-parse --short HEAD).Trim()
$rescue = "rescue/$stamp-$current"
git tag -a $rescue -m "rollback 到 $Tag 之前的自动备份"
Write-Host "[git-rollback] 当前状态已备份为 $rescue"

$dirty = git status --porcelain
if (-not [string]::IsNullOrWhiteSpace($dirty) -and -not $Force) {
  throw '工作区存在未提交改动，请先提交，或加 -Force 强制覆盖'
}

git reset --hard $Tag
Write-Host "[git-rollback] 已回滚到 $Tag"
Write-Host "[git-rollback] 撤销本次回滚： git reset --hard $rescue"