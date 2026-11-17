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
  ; 更新只删除程序目录。若旧版曾把数据放在目录内，停止而不移动或删除它。
  IfFileExists "$INSTDIR\memory" 0 removeProgram
    MessageBox MB_OK|MB_ICONSTOP "程序目录中存在 memory 数据文件夹。为保护数据，已停止卸载；请先单独备份并迁移该文件夹。"
    SetErrorLevel 2
    Abort
  removeProgram:
    SetOutPath $TEMP
    RMDir /r "$INSTDIR"
    ; Windows 可能暂时保留空目录；只在确有文件残留时报告失败。
    ClearErrors
    FindFirst $R0 $R1 "$INSTDIR\*"
    IfErrors removalDone
  checkRemaining:
    StrCmp $R1 "." nextEntry
    StrCmp $R1 ".." nextEntry
    FindClose $R0
    MessageBox MB_OK|MB_ICONSTOP "程序文件未能全部删除，卸载未完成。请关闭日织及占用文件后重试。"
    SetErrorLevel 2
    Abort
  nextEntry:
    ClearErrors
    FindNext $R0 $R1
    IfErrors 0 checkRemaining
    FindClose $R0
  removalDone:
!macroend
