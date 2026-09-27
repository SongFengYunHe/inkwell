<#
.SYNOPSIS
  每轮自动提交 + 快照标签。提交成功后自动打一个 snapshot/<时间>-<短SHA> 标签，作为可回滚锚点。

.EXAMPLE
  powershell -File scripts/git-round.ps1 -Message "M0: 脚手架与数据层落地"
  powershell -File scripts/git-round.ps1 -Message "M1: 单章生成闭环" -Push

.NOTES
  回滚见 scripts/git-rollback.ps1。若配置了远程仓库，-Push 会连同标签一起推送。
#>
param(
  [Parameter(Mandatory = $true)][string]$Message,
  [switch]$Push
)

$ErrorActionPreference = 'Stop'
$root = (git rev-parse --show-toplevel).Trim()
Set-Location $root

git add -A

$staged = git diff --cached --name-only
if ([string]::IsNullOrWhiteSpace($staged)) {
  Write-Host '[git-round] 工作区无改动，跳过提交'
  return
}

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'

git commit -m $Message
$sha = (git rev-parse --short HEAD).Trim()
$tag = "snapshot/$stamp-$sha"
git tag -a $tag -m $Message

Write-Host "[git-round] 已提交 $sha"
Write-Host "[git-round] 快照锚点：$tag"
Write-Host "[git-round] 回滚本轮： powershell -File scripts/git-rollback.ps1 -Tag $tag"

if ($Push) {
  $remote = git remote
  if ([string]::IsNullOrWhiteSpace($remote)) {
    Write-Warning '[git-round] 未配置远程仓库，跳过推送'
  } else {
    git push --follow-tags
  }
}