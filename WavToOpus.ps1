# =============================================================================
# 将当前目录下所有 .wav 文件转换为 opus 编码的 .ogg 文件。
# 默认码率 96k，对于 "节拍器.wav" 设为 16k。
# 需要 PowerShell 7.0 或更高版本。
# =============================================================================
$ScriptDirectory = $PSScriptRoot
$wavFiles = Get-ChildItem -Path $ScriptDirectory -Filter "*.wav"
if ($wavFiles.Count -eq 0) {
    Write-Host "在脚本目录中未找到任何 .wav 文件。"
    exit
}
Write-Host "找到 $($wavFiles.Count) 个 .wav 文件，开始转换..."
$wavFiles | ForEach-Object -Parallel {
    $file = $_
    $inputPath = $file.FullName
    $outputPath = [System.IO.Path]::ChangeExtension($inputPath, ".ogg")
    if (Test-Path $outputPath) {
        Write-Host "已存在: $($file.Name) -> $($file.BaseName).ogg，已跳过。"
        return
    }
    $bitrate = "96k"
    if ($file.Name -eq "节拍器.wav") {
        $bitrate = "16k"
    }
    Write-Host "正在转换: $($file.Name)... (码率: $($bitrate))"
    ffmpeg -i "$inputPath" -c:a libopus -b:a $bitrate -v quiet "$outputPath"
    if ($LASTEXITCODE -eq 0) {
        Write-Host "完成: $($file.BaseName).ogg"
    }
    else {
        Write-Host "错误: $($file.Name) 转换失败。FFmpeg 退出代码: $LASTEXITCODE"
    }
}