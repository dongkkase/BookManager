; BOOKMANAGER_PERSISTENT_PORTABLE
!include "common.nsh"
!include "WinMessages.nsh"
!include "LogicLib.nsh"

; Payload integrity is checked after the splash appears, only when extraction is needed.
CRCCheck off
WindowIcon off
AutoCloseWindow true
RequestExecutionLevel ${REQUEST_EXECUTION_LEVEL}
Caption "BookManager"
Page instfiles "" StartupPageShow
LoadLanguageFile "${NSISDIR}\Contrib\Language files\Korean.nlf"

Var RuntimeRoot
Var RuntimeDir
Var RuntimeId
Var RuntimeHash
Var RuntimeArch
Var RuntimeValid
Var StageDir
Var LaunchId
Var RuntimeLock
Var ChildProcess
Var ChildProcessToken
Var WaitTicks
Var SplashPage
Var SplashBitmap
Var SplashImage
Var SplashStatus
Var SplashProgress
Var SplashProgressTrack
Var SplashStage
Var SplashDismissed
Var SplashCancel
Var SplashFont
Var RuntimeSearch
Var RuntimeCandidate

!macro BM_CheckFile RELATIVE SIZE
    System::Call 'kernel32::GetFileAttributesExW(w "$INSTDIR\${RELATIVE}", i 0, p r9)i.r0'
    StrCmp $0 0 bm_invalid
    System::Call '*$9(i.r0, i, i, i, i, i, i, i.r1, i.r2)'
    IntOp $0 $0 & 0x410
    StrCmp $0 0 0 bm_invalid
    StrCmp $1 0 0 bm_invalid
    StrCmp $2 ${SIZE} 0 bm_invalid
!macroend

!macro BM_RoundWindow WINDOW WIDTH HEIGHT DIAMETER
    Push $8
    Push $9
    System::Call 'gdi32::CreateRoundRectRgn(i 0, i 0, i ${WIDTH}, i ${HEIGHT}, i ${DIAMETER}, i ${DIAMETER})p.r8'
    ${If} $8 != 0
        System::Call 'user32::SetWindowRgn(p ${WINDOW}, p r8, i 1)i.r9'
        ${If} $9 == 0
            ; Windows takes ownership only when SetWindowRgn succeeds.
            System::Call 'gdi32::DeleteObject(p r8)'
        ${EndIf}
    ${EndIf}
    Pop $9
    Pop $8
!macroend

Function .onInit
    SetSilent normal
    InitPluginsDir
    !insertmacro check64BitAndSetRegView
    System::Call 'kernel32::GetCurrentProcessId()i.r0'
    System::Call 'kernel32::GetTickCount()i.r1'
    StrCpy $LaunchId "$0-$1"
    StrCpy $RuntimeLock 0
    StrCpy $ChildProcess 0
    StrCpy $SplashStage 0
    StrCpy $SplashDismissed 0
    StrCpy $StageDir ""
    StrCpy $RuntimeRoot "$EXEDIR\BookManagerData\runtime"
    !ifdef APP_32
        StrCpy $RuntimeArch "32"
        StrCpy $RuntimeId "${BM_RUNTIME_ID_32}"
        StrCpy $RuntimeHash "${APP_32_HASH}"
    !endif
    !ifdef APP_64
        ${If} ${RunningX64}
        ${OrIf} ${IsNativeARM64}
            StrCpy $RuntimeArch "64"
            StrCpy $RuntimeId "${BM_RUNTIME_ID_64}"
            StrCpy $RuntimeHash "${APP_64_HASH}"
        ${EndIf}
    !endif
    !ifdef APP_ARM64
        ${If} ${IsNativeARM64}
            StrCpy $RuntimeArch "ARM64"
            StrCpy $RuntimeId "${BM_RUNTIME_ID_ARM64}"
            StrCpy $RuntimeHash "${APP_ARM64_HASH}"
        ${EndIf}
    !endif
    StrCmp $RuntimeId "" 0 +3
        MessageBox MB_OK|MB_ICONSTOP "이 Windows 환경에서 실행할 수 있는 BookManager 파일이 없습니다."
        Quit
    StrCpy $RuntimeDir "$RuntimeRoot\$RuntimeId"
FunctionEnd

Function .onGUIInit
    File /oname=$PLUGINSDIR\splash.bmp "${SPLASH_IMAGE}"
    ; The native splash appears before Electron starts; artwork pixels stay unchanged.
    System::Call 'user32::SetWindowLongW(p $HWNDPARENT, i -16, i 0x90000000)i.r0'
    System::Call 'user32::GetSystemMetrics(i 0)i.r0'
    System::Call 'user32::GetSystemMetrics(i 1)i.r1'
    IntOp $0 $0 - 700
    IntOp $0 $0 / 2
    IntOp $1 $1 - 364
    IntOp $1 $1 / 2
    System::Call 'user32::SetWindowPos(p $HWNDPARENT, p 0, i r0, i r1, i 700, i 364, i 0x34)'
    !insertmacro BM_RoundWindow $HWNDPARENT 700 364 40
    SetCtlColors $HWNDPARENT E5ECEC 0D1B2B
    GetDlgItem $0 $HWNDPARENT 1
    ShowWindow $0 ${SW_HIDE}
    GetDlgItem $0 $HWNDPARENT 3
    ShowWindow $0 ${SW_HIDE}
    GetDlgItem $0 $HWNDPARENT 1028
    ShowWindow $0 ${SW_HIDE}
    GetDlgItem $0 $HWNDPARENT 1035
    ShowWindow $0 ${SW_HIDE}
    GetDlgItem $SplashCancel $HWNDPARENT 2
    ShowWindow $SplashCancel ${SW_HIDE}
FunctionEnd

Function StartupPageShow
    FindWindow $SplashPage "#32770" "" $HWNDPARENT
    System::Call 'user32::MoveWindow(p $SplashPage, i 0, i 0, i 700, i 364, i 1)'
    SetCtlColors $SplashPage E5ECEC 0D1B2B
    GetDlgItem $0 $SplashPage 1006
    ShowWindow $0 ${SW_HIDE}
    GetDlgItem $0 $SplashPage 1016
    ShowWindow $0 ${SW_HIDE}
    GetDlgItem $0 $SplashPage 1027
    ShowWindow $0 ${SW_HIDE}
    ; NSIS updates its own progress after every instruction. Keep stage progress independent.
    GetDlgItem $0 $SplashPage 1004
    ShowWindow $0 ${SW_HIDE}
    System::Call 'user32::CreateWindowExW(i 0, w "STATIC", w "", i 0x50000000, i 24, i 341, i 652, i 6, p $SplashPage, p 0, p 0, p 0)p.s'
    Pop $SplashProgressTrack
    SetCtlColors $SplashProgressTrack 1E2B3A 1E2B3A
    !insertmacro BM_RoundWindow $SplashProgressTrack 652 6 6
    System::Call 'user32::CreateWindowExW(i 0, w "STATIC", w "", i 0x40000000, i 24, i 341, i 0, i 6, p $SplashPage, p 0, p 0, p 0)p.s'
    Pop $SplashProgress
    SetCtlColors $SplashProgress 93DBC6 93DBC6
    System::Call 'user32::CreateWindowExW(i 0, w "STATIC", w "", i 0x5000000E, i 0, i 0, i 700, i 300, p $SplashPage, p 0, p 0, p 0)p.s'
    Pop $SplashImage
    System::Call 'user32::LoadImageW(p 0, w "$PLUGINSDIR\splash.bmp", i 0, i 700, i 300, i 0x10)p.s'
    Pop $SplashBitmap
    SendMessage $SplashImage ${STM_SETIMAGE} 0 $SplashBitmap
    System::Call 'user32::CreateWindowExW(i 0, w "STATIC", w "실행 파일을 확인하는 중...", i 0x50000000, i 24, i 311, i 652, i 22, p $SplashPage, p 0, p 0, p 0)p.s'
    Pop $SplashStatus
    CreateFont $SplashFont "Segoe UI" 10 400
    SendMessage $SplashStatus ${WM_SETFONT} $SplashFont 1
    SetCtlColors $SplashStatus E5ECEC 0D1B2B
    System::Call 'user32::UpdateWindow(p $HWNDPARENT)'
FunctionEnd

Function UpdateSplashProgress
    Push $0
    IntOp $0 $SplashStage * 163
    System::Call 'user32::SetWindowPos(p $SplashProgress, p 0, i 24, i 341, i r0, i 6, i 0x50)'
    !insertmacro BM_RoundWindow $SplashProgress $0 6 6
    System::Call 'user32::UpdateWindow(p $SplashProgress)'
    Pop $0
FunctionEnd

Function .onInstSuccess
    ; NSIS calls this on the window's UI thread, which AnimateWindow requires.
    ; Its completed page can restore the standard buttons before this callback.
    GetDlgItem $0 $HWNDPARENT 1
    ShowWindow $0 ${SW_HIDE}
    GetDlgItem $0 $HWNDPARENT 3
    ShowWindow $0 ${SW_HIDE}
    ShowWindow $SplashCancel ${SW_HIDE}
    StrCmp $SplashDismissed 1 splash_close_now
    ClearErrors
    FileOpen $0 "$PLUGINSDIR\BookManager-startup.ready" r
    IfErrors splash_close_now
    StrCpy $1 ""
    StrCpy $2 ""
    FileRead $0 $1
    FileRead $0 $2
    FileClose $0
    StrCmpS $1 "ready$\r$\n" splash_check_motion
    StrCmpS $1 "ready$\n" splash_check_motion splash_close_now
    splash_check_motion:
        ; Electron resolves the app and OS motion settings before writing this flag.
        StrCmpS $2 "animate$\r$\n" splash_fade_out
        StrCmpS $2 "animate$\n" splash_fade_out
        StrCmpS $2 "animate" splash_fade_out splash_close_now
    splash_fade_out:
        System::Call 'user32::AnimateWindow(p $HWNDPARENT, i 200, i 0x90000)i.r0'
    splash_close_now:
        ; This also closes the splash if the animation is unavailable or fails.
        HideWindow
FunctionEnd

Function .onUserAbort
    ; Closing the splash never cancels extraction or deletes another process's files.
    StrCpy $SplashDismissed 1
    HideWindow
    Abort
FunctionEnd

Function ReleaseRuntimeLock
    ${If} $RuntimeLock != 0
    ${AndIf} $RuntimeLock != -1
        System::Call 'kernel32::CloseHandle(p $RuntimeLock)'
        StrCpy $RuntimeLock 0
    ${EndIf}
FunctionEnd

Function DecodeChildProcessHandle
    ; StdUtils returns hProc:XXXXXXXX, not a numeric Windows handle.
    StrCpy $ChildProcess 0
    StrLen $0 $ChildProcessToken
    IntCmp $0 14 0 process_handle_done process_handle_done
    StrCpy $0 $ChildProcessToken 6
    StrCmpS $0 "hProc:" 0 process_handle_done
    StrCpy $1 6
    process_handle_next_digit:
        StrCpy $0 $ChildProcessToken 1 $1
        StrCpy $2 0
    process_handle_match_digit:
        StrCpy $3 "0123456789ABCDEF" 1 $2
        StrCmp $0 $3 process_handle_digit_valid
        IntOp $2 $2 + 1
        IntCmp $2 16 process_handle_done process_handle_match_digit process_handle_done
    process_handle_digit_valid:
        IntOp $1 $1 + 1
        IntCmp $1 14 process_handle_convert process_handle_next_digit process_handle_done
    process_handle_convert:
        StrCpy $0 $ChildProcessToken "" 6
        IntOp $ChildProcess "0x$0" + 0
        ${If} $ChildProcess == -1
            StrCpy $ChildProcess 0
        ${EndIf}
    process_handle_done:
FunctionEnd

Function .onGUIEnd
    Call ReleaseRuntimeLock
    ${If} $ChildProcess != 0
        System::Call 'kernel32::CloseHandle(p $ChildProcess)'
    ${EndIf}
    ${If} $SplashBitmap != 0
        System::Call 'gdi32::DeleteObject(p $SplashBitmap)'
    ${EndIf}
    ${If} $SplashFont != 0
        System::Call 'gdi32::DeleteObject(p $SplashFont)'
    ${EndIf}
    ; Only this invocation's unfinished stage may be removed. Published runtimes survive.
    ${If} $StageDir != ""
        SetOutPath $EXEDIR
        RMDir /r "$StageDir"
    ${EndIf}
FunctionEnd

Function ValidateRuntime
    StrCpy $RuntimeValid 0
    System::Alloc 36
    Pop $9
    StrCmp $9 0 bm_validation_done
    ${If} $RuntimeArch == "64"
        !ifdef APP_64
            !insertmacro BM_Validate_64
        !endif
    ${ElseIf} $RuntimeArch == "ARM64"
        !ifdef APP_ARM64
            !insertmacro BM_Validate_ARM64
        !endif
    ${Else}
        !ifdef APP_32
            !insertmacro BM_Validate_32
        !endif
    ${EndIf}
    StrCpy $RuntimeValid 1
    bm_invalid:
    System::Free $9
    bm_validation_done:
FunctionEnd

Function CheckPublishedRuntime
    StrCpy $RuntimeValid 0
    StrCpy $INSTDIR $RuntimeDir
    ClearErrors
    FileOpen $0 "$RuntimeDir\.complete" r
    IfErrors published_check_done
    FileRead $0 $1
    FileClose $0
    StrCmp $1 $RuntimeHash 0 published_check_done
    Call ValidateRuntime
    published_check_done:
FunctionEnd

Section
    ; This root lock also serializes migration before BookManagerData exists.
    ; A kernel-owned lock is released even after a crash, unlike a stale lock directory.
    StrCpy $WaitTicks 0
    lock_retry:
        System::Call 'kernel32::CreateFileW(w "$EXEDIR\.BookManager-runtime.lock", i 0xC0000000, i 0, p 0, i 4, i 0x04000000, p 0)p.r0 ?e'
        Pop $1
        StrCpy $RuntimeLock $0
        StrCmp $RuntimeLock -1 0 lock_acquired
        StrCmp $1 32 0 startup_directory_error
        SendMessage $SplashStatus ${WM_SETTEXT} 0 "STR:다른 실행에서 파일을 준비하고 있습니다..."
        Sleep 100
        IntOp $WaitTicks $WaitTicks + 1
        IntCmp $WaitTicks 1200 startup_lock_timeout lock_retry startup_lock_timeout
    lock_acquired:
    ; Preserve the existing legacy migration before creating the runtime container.
    System::Call 'kernel32::GetFileAttributesW(w "$EXEDIR\BookManagerData")i.r0 ?e'
    Pop $1
    StrCmp $0 -1 0 data_directory_exists
    StrCmp $1 2 check_legacy_data
    StrCmp $1 3 check_legacy_data startup_directory_error
    check_legacy_data:
    System::Call 'kernel32::GetFileAttributesW(w "$EXEDIR\data")i.r0 ?e'
    Pop $1
    ${If} $0 == -1
        StrCmp $1 2 create_runtime_root
        StrCmp $1 3 create_runtime_root startup_directory_error
    ${EndIf}
    IntOp $0 $0 & 0x10
    StrCmp $0 0 startup_directory_error
    ClearErrors
    Rename "$EXEDIR\data" "$EXEDIR\BookManagerData"
    IfErrors startup_migration_error
    Goto create_runtime_root
    data_directory_exists:
    IntOp $0 $0 & 0x10
    StrCmp $0 0 startup_directory_error
    create_runtime_root:
    ClearErrors
    CreateDirectory "$RuntimeRoot"
    IfErrors startup_directory_error
    StrCpy $SplashStage 1
    Call UpdateSplashProgress
    SendMessage $SplashStatus ${WM_SETTEXT} 0 "STR:실행 파일을 확인하는 중..."
    Call CheckPublishedRuntime
    StrCmp $RuntimeValid 1 runtime_ready
    ; Repairs use new generations. Never move a published folder used by an existing app.
    FindFirst $RuntimeSearch $RuntimeCandidate "$RuntimeRoot\$RuntimeId-*"
    find_repaired_runtime:
        StrCmp $RuntimeCandidate "" no_repaired_runtime
        StrCpy $RuntimeDir "$RuntimeRoot\$RuntimeCandidate"
        Call CheckPublishedRuntime
        StrCmp $RuntimeValid 1 repaired_runtime_found
        FindNext $RuntimeSearch $RuntimeCandidate
        Goto find_repaired_runtime
    repaired_runtime_found:
        FindClose $RuntimeSearch
        Goto runtime_ready
    no_repaired_runtime:
        FindClose $RuntimeSearch
        StrCpy $RuntimeDir "$RuntimeRoot\$RuntimeId"
        IfFileExists "$RuntimeDir" 0 extract_runtime
        StrCpy $RuntimeDir "$RuntimeRoot\$RuntimeId-$LaunchId"

    extract_runtime:
    StrCpy $StageDir "$RuntimeRoot\.$RuntimeId-$LaunchId.partial"
    StrCpy $INSTDIR $StageDir
    ClearErrors
    SetOutPath "$StageDir"
    IfErrors startup_directory_error
    SendMessage $SplashStatus ${WM_SETTEXT} 0 "STR:처음 실행할 파일을 준비하는 중..."
    SetCompress off
    ${If} $RuntimeArch == "64"
        !ifdef APP_64
            File /oname=$PLUGINSDIR\app.7z "${APP_64}"
        !endif
    ${ElseIf} $RuntimeArch == "ARM64"
        !ifdef APP_ARM64
            File /oname=$PLUGINSDIR\app.7z "${APP_ARM64}"
        !endif
    ${Else}
        !ifdef APP_32
            File /oname=$PLUGINSDIR\app.7z "${APP_32}"
        !endif
    ${EndIf}
    !ifdef COMPRESS
        SetCompress "${COMPRESS}"
    !endif
    SendMessage $SplashStatus ${WM_SETTEXT} 0 "STR:실행 파일의 무결성을 확인하는 중..."
    ${StdUtils.HashFile} $0 "SHA2-512" "$PLUGINSDIR\app.7z"
    StrCmp $0 $RuntimeHash 0 startup_extract_error
    SendMessage $SplashStatus ${WM_SETTEXT} 0 "STR:실행 파일 압축을 푸는 중..."
    Nsis7z::Extract "$PLUGINSDIR\app.7z"
    Call ValidateRuntime
    StrCmp $RuntimeValid 1 0 startup_extract_error
    ClearErrors
    FileOpen $0 "$StageDir\.complete" w
    IfErrors startup_extract_error
    FileWrite $0 "$RuntimeHash"
    FileClose $0
    IfErrors startup_extract_error
    SetOutPath $EXEDIR
    ClearErrors
    Rename "$StageDir" "$RuntimeDir"
    IfErrors startup_extract_error
    StrCpy $StageDir ""

    runtime_ready:
    Call ReleaseRuntimeLock
    StrCpy $INSTDIR $RuntimeDir
    SetOutPath $EXEDIR
    StrCpy $SplashStage 2
    Call UpdateSplashProgress
    SendMessage $SplashStatus ${WM_SETTEXT} 0 "STR:실행 파일 준비 완료 · 북매니저를 여는 중..."
    System::Call 'kernel32::SetEnvironmentVariableW(w "PORTABLE_EXECUTABLE_DIR", w "$EXEDIR")'
    System::Call 'kernel32::SetEnvironmentVariableW(w "PORTABLE_EXECUTABLE_FILE", w "$EXEPATH")'
    System::Call 'kernel32::SetEnvironmentVariableW(w "PORTABLE_EXECUTABLE_APP_FILENAME", w "${APP_FILENAME}")'
    System::Call 'kernel32::SetEnvironmentVariableW(w "BOOKMANAGER_STARTUP_READY_FILE", w "$PLUGINSDIR\BookManager-startup.ready")'
    ${StdUtils.GetAllParameters} $R0 0
    ${StdUtils.ExecShellWaitEx} $0 $ChildProcessToken "$INSTDIR\${APP_EXECUTABLE_FILENAME}" "open" "$R0"
    StrCmp $0 "no_wait" launch_started
    StrCmp $0 "ok" 0 startup_launch_error
    Call DecodeChildProcessHandle
    launch_started:
    StrCpy $SplashStage 3
    Call UpdateSplashProgress
    StrCpy $WaitTicks 0
    wait_for_window:
        IfFileExists "$PLUGINSDIR\BookManager-startup.ready" 0 check_child_process
        ClearErrors
        FileOpen $0 "$PLUGINSDIR\BookManager-startup.ready" r
        IfErrors check_child_process
        StrCpy $1 ""
        FileRead $0 $1
        FileClose $0
        ; Creation can become visible before Electron writes the ready line.
        StrCmpS $1 "ready$\r$\n" startup_complete
        StrCmpS $1 "ready$\n" startup_complete
        StrCmpS $1 "ready" startup_complete
    check_child_process:
        ${If} $ChildProcess != 0
            System::Call 'kernel32::WaitForSingleObject(p $ChildProcess, i 0)i.r0'
            StrCmp $0 0 child_exited
            StrCmp $0 258 wait_for_window_tick
            ; A monitoring failure must not report an already launched app as failed.
            System::Call 'kernel32::CloseHandle(p $ChildProcess)'
            StrCpy $ChildProcess 0
        ${EndIf}
    wait_for_window_tick:
        Sleep 100
        IntOp $WaitTicks $WaitTicks + 1
        IntCmp $WaitTicks 1200 startup_window_timeout wait_for_window startup_window_timeout
    child_exited:
        System::Call 'kernel32::GetExitCodeProcess(p $ChildProcess, *i.r0)'
        SetErrorLevel $0
        HideWindow
        Quit
    startup_complete:
        StrCpy $SplashStage 4
        Call UpdateSplashProgress
        SetErrorLevel 0
        ; Normal completion reaches .onInstSuccess on the UI thread.
        Goto startup_finished
    startup_directory_error:
        HideWindow
        MessageBox MB_OK|MB_ICONSTOP "BookManagerData 폴더에 실행 파일을 저장할 수 없습니다.$\r$\n실행 파일이 있는 폴더의 쓰기 권한과 디스크 여유 공간을 확인해 주세요."
        Goto startup_failed
    startup_lock_timeout:
        HideWindow
        MessageBox MB_OK|MB_ICONSTOP "다른 BookManager 실행에서 파일을 준비하고 있습니다.$\r$\n잠시 후 다시 실행해 주세요."
        Goto startup_failed
    startup_migration_error:
        HideWindow
        MessageBox MB_OK|MB_ICONSTOP "기존 data 폴더를 BookManagerData로 옮기지 못했습니다.$\r$\nBookManager를 모두 종료하고 폴더의 쓰기 권한을 확인한 뒤 다시 실행해 주세요.$\r$\n기존 data 폴더는 그대로 보존됩니다."
        Goto startup_failed
    startup_extract_error:
        HideWindow
        MessageBox MB_OK|MB_ICONSTOP "BookManager 실행 파일을 준비하지 못했습니다.$\r$\n디스크 여유 공간을 확인하고 다시 실행해 주세요. 문제가 계속되면 실행 파일을 다시 받아 주세요."
        Goto startup_failed
    startup_launch_error:
        HideWindow
        MessageBox MB_OK|MB_ICONSTOP "BookManager를 실행하지 못했습니다.$\r$\n다시 실행해 주세요."
        Goto startup_failed
    startup_window_timeout:
        HideWindow
        MessageBox MB_OK|MB_ICONEXCLAMATION "BookManager 시작이 지연되고 있습니다.$\r$\n프로그램은 계속 실행 중입니다. 창이 나타나지 않으면 작업 관리자에서 상태를 확인해 주세요."
    startup_failed:
        SetErrorLevel 1
        Quit
    startup_finished:
SectionEnd
