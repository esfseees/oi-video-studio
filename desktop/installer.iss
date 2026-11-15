#ifndef MyAppVersion
  #define MyAppVersion "0.2.0"
#endif

[Setup]
AppId={{8E6B3A92-54F1-4D87-A2C6-7D910E4B2F18}
AppName=信奥讲解视频工坊
AppVersion={#MyAppVersion}
AppPublisher=小图灵信奥工坊
DefaultDirName={autopf}\OIVideoStudio
DefaultGroupName=信奥讲解视频工坊
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
OutputDir=..\dist
OutputBaseFilename=信奥讲解视频工坊-v{#MyAppVersion}-windows-x64-setup
SetupIconFile=icon.ico
UninstallDisplayIcon={app}\信奥讲解视频工坊.exe
Compression=lzma2/fast
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible

[Languages]
Name: "chinesesimplified"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "创建桌面快捷方式(&D)"; GroupDescription: "附加图标:"

[Files]
Source: "..\dist\OIVideoStudio\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\信奥讲解视频工坊"; Filename: "{app}\信奥讲解视频工坊.exe"
Name: "{group}\卸载信奥讲解视频工坊"; Filename: "{uninstallexe}"
Name: "{autodesktop}\信奥讲解视频工坊"; Filename: "{app}\信奥讲解视频工坊.exe"; Tasks: desktopicon

[Run]
Filename: "{app}\信奥讲解视频工坊.exe"; Description: "立即启动信奥讲解视频工坊"; Flags: nowait postinstall skipifsilent
