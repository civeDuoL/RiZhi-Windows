!include "FileFunc.nsh"
!include "LogicLib.nsh"
!include "nsDialogs.nsh"

!ifndef BUILD_UNINSTALLER
Var rizhiRootInput

!macro customInit
  ; electron-builder 在 .onInit 中把工作目录设为 $INSTDIR。
  ; 升级时父安装器若仍占用旧程序目录，旧卸载器就无法删除该目录。
  SetOutPath $TEMP
  ${If} ${Silent}
    Call normalizeRizhiRoot
    StrCpy $INSTDIR "$INSTDIR\rizhi"
  ${EndIf}
!macroend

!macro customPageAfterChangeDir
  Page custom showRizhiInstallDirectory leaveRizhiInstallDirectory
!macroend

Function normalizeRizhiRoot
  ; 注册表中的程序路径 ...\rizhi\rizhi 在页面中显示为 ...\rizhi。
  ${GetFileName} "$INSTDIR" $R0
  ${If} $R0 == "rizhi"
    ${GetParent} "$INSTDIR" $R1
    ${GetFileName} "$R1" $R2
    ${If} $R2 == "rizhi"
      StrCpy $INSTDIR "$R1"
    ${EndIf}
  ${Else}
    StrCpy $INSTDIR "$INSTDIR\rizhi"
  ${EndIf}
FunctionEnd

Function showRizhiInstallDirectory
  ${If} ${Silent}
    Abort
  ${EndIf}
  Call normalizeRizhiRoot
  nsDialogs::Create 1018
  Pop $R0
  ${If} $R0 == error
    Abort
  ${EndIf}
  ${NSD_CreateLabel} 0 0 100% 25u "日织文件夹（程序：rizhi；数据：memory）"
  Pop $R0
  ${NSD_CreateText} 0 32u 77% 13u "$INSTDIR"
  Pop $rizhiRootInput
  ${NSD_CreateBrowseButton} 79% 32u 21% 13u "浏览..."
  Pop $R0
  ${NSD_OnClick} $R0 browseRizhiInstallDirectory
  nsDialogs::Show
FunctionEnd

Function browseRizhiInstallDirectory
  Pop $R0
  ${NSD_GetText} $rizhiRootInput $R1
  nsDialogs::SelectFolderDialog "选择日织文件夹" "$R1"
  Pop $R1
  ${If} $R1 != error
    StrCpy $INSTDIR $R1
    Call normalizeRizhiRoot
    ${NSD_SetText} $rizhiRootInput $INSTDIR
  ${EndIf}
FunctionEnd

Function leaveRizhiInstallDirectory
  ${NSD_GetText} $rizhiRootInput $INSTDIR
  ${If} $INSTDIR == ""
    MessageBox MB_OK|MB_ICONEXCLAMATION "请选择日织文件夹。"
    Abort
  ${EndIf}
  Call normalizeRizhiRoot
  StrCpy $INSTDIR "$INSTDIR\rizhi"
  SetOutPath $TEMP
FunctionEnd
!endif

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
