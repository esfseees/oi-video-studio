using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net.Sockets;
using System.Threading;
using System.Windows.Forms;

namespace OIVideoStudio
{
    static class Program
    {
        private static Process serverProc;
        private static NotifyIcon tray;
        private static readonly int Port = 5178;
        private static readonly string Url = "http://127.0.0.1:5178";

        [STAThread]
        static int Main(string[] args)
        {
            string baseDir = AppDomain.CurrentDomain.BaseDirectory;
            string runtimeDir = Path.Combine(baseDir, "runtime");
            string appDir = Path.Combine(baseDir, "app");
            string nodeExe = Path.Combine(runtimeDir, "node.exe");
            string ffmpegExe = Path.Combine(runtimeDir, "ffmpeg.exe");
            string startJs = Path.Combine(appDir, "scripts", "start.js");
            string serverJs = Path.Combine(appDir, "server.js");

            if (!File.Exists(nodeExe) || !File.Exists(ffmpegExe) || !File.Exists(startJs) || !File.Exists(serverJs))
            {
                MessageBox.Show(
                    "找不到核心运行文件：\r\n" +
                    "  • " + nodeExe + "\r\n" +
                    "  • " + ffmpegExe + "\r\n" +
                    "  • " + startJs + "\r\n\r\n" +
                    "请确保已将压缩包完整解压到文件夹后再运行，不要直接在压缩包内双击。",
                    "信奥讲解视频工坊 - 启动失败",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error
                );
                return 1;
            }

            string dataDir = Environment.GetEnvironmentVariable("OIVS_DATA_DIR");
            if (string.IsNullOrEmpty(dataDir))
                dataDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "OIVideoStudio");
            Directory.CreateDirectory(dataDir);

            bool isSelfTest = false;
            foreach (string a in args)
            {
                if (a == "--self-test") isSelfTest = true;
            }

            if (isSelfTest)
            {
                ProcessStartInfo psi = new ProcessStartInfo(nodeExe, "\"" + startJs + "\" --self-test");
                psi.WorkingDirectory = appDir;
                psi.UseShellExecute = false;
                psi.RedirectStandardOutput = true;
                psi.RedirectStandardError = true;
                psi.CreateNoWindow = true;
                psi.EnvironmentVariables["OIVS_DATA_DIR"] = dataDir;
                psi.EnvironmentVariables["OIVS_FFMPEG"] = ffmpegExe;
                Process p = Process.Start(psi);
                string stdout = p.StandardOutput.ReadToEnd();
                string stderr = p.StandardError.ReadToEnd();
                p.WaitForExit();
                Console.Write(stdout);
                if (!string.IsNullOrEmpty(stderr)) Console.Error.Write(stderr);
                return p.ExitCode;
            }

            if (IsPortOpen(Port))
            {
                Process.Start(new ProcessStartInfo(Url) { UseShellExecute = true });
                return 0;
            }

            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            string logFile = Path.Combine(dataDir, "app.log");
            try
            {
                ProcessStartInfo srvPsi = new ProcessStartInfo(nodeExe, "\"" + serverJs + "\"");
                srvPsi.WorkingDirectory = appDir;
                srvPsi.UseShellExecute = false;
                srvPsi.CreateNoWindow = true;
                srvPsi.RedirectStandardOutput = true;
                srvPsi.RedirectStandardError = true;
                srvPsi.EnvironmentVariables["OIVS_DATA_DIR"] = dataDir;
                srvPsi.EnvironmentVariables["OIVS_FFMPEG"] = ffmpegExe;

                serverProc = new Process();
                serverProc.StartInfo = srvPsi;
                StreamWriter logWriter = new StreamWriter(new FileStream(logFile, FileMode.Append, FileAccess.Write, FileShare.ReadWrite)) { AutoFlush = true };
                serverProc.OutputDataReceived += (s, e) => { if (e.Data != null) try { logWriter.WriteLine(e.Data); } catch {} };
                serverProc.ErrorDataReceived += (s, e) => { if (e.Data != null) try { logWriter.WriteLine(e.Data); } catch {} };
                serverProc.Start();
                serverProc.BeginOutputReadLine();
                serverProc.BeginErrorReadLine();
            }
            catch (Exception ex)
            {
                MessageBox.Show(
                    "启动后台服务失败：\r\n" + ex.Message,
                    "信奥讲解视频工坊 - 启动失败",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error
                );
                return 1;
            }

            ThreadPool.QueueUserWorkItem(_ =>
            {
                for (int i = 0; i < 50; i++)
                {
                    if (IsPortOpen(Port))
                    {
                        try { Process.Start(new ProcessStartInfo(Url) { UseShellExecute = true }); } catch {}
                        return;
                    }
                    if (serverProc != null && serverProc.HasExited)
                    {
                        MessageBox.Show(
                            "后台服务启动后异常退出，请查看日志文件：\r\n" + logFile,
                            "信奥讲解视频工坊 - 服务异常退出",
                            MessageBoxButtons.OK,
                            MessageBoxIcon.Error
                        );
                        return;
                    }
                    Thread.Sleep(200);
                }
            });

            ContextMenu menu = new ContextMenu();
            menu.MenuItems.Add("打开信奥讲解视频工坊 (http://127.0.0.1:5178)", (s, e) => {
                try { Process.Start(new ProcessStartInfo(Url) { UseShellExecute = true }); } catch {}
            });
            menu.MenuItems.Add("打开数据与视频目录", (s, e) => {
                try { Process.Start(new ProcessStartInfo(dataDir) { UseShellExecute = true }); } catch {}
            });
            menu.MenuItems.Add("-");
            menu.MenuItems.Add("退出信奥讲解视频工坊", (s, e) => {
                StopServer();
                tray.Visible = false;
                Application.Exit();
            });

            tray = new NotifyIcon();
            tray.Text = "信奥讲解视频工坊 (运行中)";
            try { tray.Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); }
            catch { tray.Icon = SystemIcons.Application; }
            tray.ContextMenu = menu;
            tray.DoubleClick += (s, e) => {
                try { Process.Start(new ProcessStartInfo(Url) { UseShellExecute = true }); } catch {}
            };
            tray.Visible = true;
            tray.ShowBalloonTip(3000, "信奥讲解视频工坊已启动", "浏览器已打开工作台，右下角托盘图标可随时打开或退出。", ToolTipIcon.Info);

            Application.ApplicationExit += (s, e) => StopServer();
            Application.Run();
            return 0;
        }

        private static bool IsPortOpen(int port)
        {
            try
            {
                using (TcpClient c = new TcpClient())
                {
                    IAsyncResult r = c.BeginConnect("127.0.0.1", port, null, null);
                    bool ok = r.AsyncWaitHandle.WaitOne(TimeSpan.FromMilliseconds(200));
                    if (!ok) return false;
                    c.EndConnect(r);
                    return true;
                }
            }
            catch { return false; }
        }

        private static void StopServer()
        {
            try
            {
                if (serverProc != null && !serverProc.HasExited)
                {
                    serverProc.Kill();
                    serverProc.WaitForExit(2000);
                }
            }
            catch {}
        }
    }
}
