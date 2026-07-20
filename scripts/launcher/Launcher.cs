// Understudy launcher: double-click to run the app in its own native window.
// It simply starts the Python desktop entry point (backend/desktop.py) with the
// windowless interpreter (pythonw.exe); that single process owns both the
// FastAPI server and the WebView2 window, so closing the window stops
// everything. Compiled by scripts/build_launcher.ps1 with the .NET Framework
// csc.exe bundled with Windows — no extra toolchain required.
using System;
using System.Diagnostics;
using System.IO;
using System.Windows.Forms;

class Launcher
{
    [STAThread]
    static void Main()
    {
        string root = AppDomain.CurrentDomain.BaseDirectory;
        string pyw = Path.Combine(root, ".venv", "Scripts", "pythonw.exe");
        string py = Path.Combine(root, ".venv", "Scripts", "python.exe");
        string backend = Path.Combine(root, "backend");
        string desktop = Path.Combine(backend, "desktop.py");
        string dist = Path.Combine(root, "frontend", "dist", "index.html");

        string interpreter = File.Exists(pyw) ? pyw : py;

        if (!File.Exists(interpreter) || !File.Exists(desktop) || !File.Exists(dist))
        {
            MessageBox.Show(
                "未找到运行环境，请先在 PowerShell 中运行 scripts\\setup.ps1 完成安装。\n\n" +
                "Runtime not found. Please run scripts\\setup.ps1 in PowerShell first.",
                "Understudy", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            return;
        }

        var psi = new ProcessStartInfo
        {
            FileName = interpreter,
            Arguments = "\"" + desktop + "\"",
            WorkingDirectory = backend,
            UseShellExecute = false,
            CreateNoWindow = true,
        };
        Process.Start(psi);
        // The Python process now owns the window; the launcher can exit.
    }
}
