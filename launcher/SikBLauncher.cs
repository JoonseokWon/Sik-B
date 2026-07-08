using System;
using System.Diagnostics;
using System.IO;
using System.Windows.Forms;

namespace SikB
{
    internal static class SikBLauncher
    {
        [STAThread]
        private static void Main()
        {
            string basePath = AppDomain.CurrentDomain.BaseDirectory;
            string htmlPath = Path.Combine(basePath, "index.html");

            if (!File.Exists(htmlPath))
            {
                MessageBox.Show(
                    "index.html was not found. Please run Sik-B.exe from the project folder.",
                    "Sik-B",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error
                );
                return;
            }

            Process.Start(new ProcessStartInfo
            {
                FileName = htmlPath,
                UseShellExecute = true
            });
        }
    }
}
