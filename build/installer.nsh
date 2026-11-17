!include "FileFunc.nsh"
!include "LogicLib.nsh"

!macro customPageAfterChangeDir
  Page custom normalizeRizhiInstallDirectory
!macroend

Function normalizeRizhiInstallDirectory
  ; 安装向导所选的是上层目录。最终始终使用 <位置>\rizhi\rizhi。
  ; 若用户已输入完整程序路径，则保持不变。
  ${GetFileName} "$INSTDIR" $R0
  ${If} $R0 == "rizhi"
    ${GetParent} "$INSTDIR" $R1
    ${GetFileName} "$R1" $R2
    ${If} $R2 != "rizhi"
      StrCpy $INSTDIR "$INSTDIR\rizhi"
    ${EndIf}
  ${Else}
    StrCpy $INSTDIR "$INSTDIR\rizhi\rizhi"
  ${EndIf}
  Abort ; 只归一化路径，不额外显示一页。
FunctionEnd

!macro customUnInstall
  ; 卸载和自动更新均保留用户数据。旧版 AppData 也不由卸载器删除。
!macroend

!macro customRemoveFiles
  ; 旧版可能把 memory 放在程序目录中。若有数据，先转移到兄弟目录。
  IfFileExists "$INSTDIR\memory\*.*" 0 removeProgram
  IfFileExists "$INSTDIR\..\memory" 0 moveLegacyMemory
    MessageBox MB_OK|MB_ICONSTOP "检测到旧版程序目录和新数据目录中都有 memory。为避免覆盖记录，已停止卸载。请先备份并合并数据。"
    Abort
  moveLegacyMemory:
    Rename "$INSTDIR\memory" "$INSTDIR\..\memory"
    IfErrors 0 removeProgram
      MessageBox MB_OK|MB_ICONSTOP "无法安全移动旧版 memory，已停止卸载。请先备份数据。"
      Abort
  removeProgram:
    SetOutPath $TEMP
    RMDir /r "$INSTDIR"
    IfFileExists "$INSTDIR" 0 +3
      MessageBox MB_OK|MB_ICONSTOP "程序目录未能删除，卸载未完成。请关闭日织及占用文件后重试。"
      Abort
!macroend
