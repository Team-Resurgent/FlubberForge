using System.Net;
using System.Text.Json;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace BootAnimWeb;

internal static class Program
{
    [STAThread]
    private static void Main(string[] args)
    {
        ApplicationConfiguration.Initialize();
        Application.Run(new HostForm(args));
    }
}

internal sealed class HostForm : Form
{
    private readonly string? _iniPath;
    private readonly WebView2 _web = new() { Dock = DockStyle.Fill };

    public HostForm(string[] args)
    {
        _iniPath = args.Length > 0 ? args[0] : null;
        Text = "Flubber Forge";
        // Reuse the icon already embedded in the executable rather than
        // shipping a loose .ico beside it.
        var exe = Environment.ProcessPath;
        if (exe != null)
        {
            try { Icon = Icon.ExtractAssociatedIcon(exe); }
            catch (Exception) { /* keep the default icon */ }
        }
        ClientSize = new Size(1280, 800);
        StartPosition = FormStartPosition.CenterScreen;
        BackColor = Color.Black;
        Controls.Add(_web);
        Load += async (_, _) => await StartAsync();
    }

    private async Task StartAsync()
    {
        var www = Path.Combine(AppContext.BaseDirectory, "www");
        if (!Directory.Exists(www))
        {
            MessageBox.Show(this, "Missing www folder next to the app.", Text, MessageBoxButtons.OK, MessageBoxIcon.Error);
            Close();
            return;
        }

        try
        {
            var env = await CoreWebView2Environment.CreateAsync();
            await _web.EnsureCoreWebView2Async(env);
            _web.CoreWebView2.SetVirtualHostNameToFolderMapping(
                "bootanim.local",
                www,
                CoreWebView2HostResourceAccessKind.Allow);
            _web.CoreWebView2.NavigationCompleted += async (_, e) =>
            {
                if (!e.IsSuccess || string.IsNullOrEmpty(_iniPath) || !File.Exists(_iniPath))
                    return;
                var json = JsonSerializer.Serialize(await File.ReadAllTextAsync(_iniPath));
                await _web.CoreWebView2.ExecuteScriptAsync("window.applyIniText(" + json + ")");
            };
            _web.Source = new Uri("https://bootanim.local/index.html");
        }
        catch (Exception ex)
        {
            _web.Visible = false;
            var url = BrowserHost.Start(www);
            MessageBox.Show(
                this,
                "WebView2 is not available (" + ex.Message + "). Opening " + url + " in the browser instead.",
                Text,
                MessageBoxButtons.OK,
                MessageBoxIcon.Information);
            Close();
        }
    }
}

internal static class BrowserHost
{
    public static string Start(string www)
    {
        HttpListener? listener = null;
        for (var port = 8765; port < 8780; port++)
        {
            var candidate = new HttpListener();
            candidate.Prefixes.Add("http://127.0.0.1:" + port + "/");
            try
            {
                candidate.Start();
                listener = candidate;
                break;
            }
            catch (HttpListenerException)
            {
                candidate.Close();
            }
        }

        if (listener == null)
            throw new InvalidOperationException("No free localhost port for the preview.");

        var prefix = listener.Prefixes.First();
        _ = Task.Run(() => Serve(listener, www));
        var url = prefix + "index.html";
        System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo(url) { UseShellExecute = true });
        return url;
    }

    private static async Task Serve(HttpListener listener, string www)
    {
        while (listener.IsListening)
        {
            HttpListenerContext ctx;
            try
            {
                ctx = await listener.GetContextAsync();
            }
            catch
            {
                return;
            }

            var rel = ctx.Request.Url?.AbsolutePath.TrimStart('/') ?? "index.html";
            if (string.IsNullOrEmpty(rel)) rel = "index.html";
            var path = Path.GetFullPath(Path.Combine(www, rel.Replace('/', Path.DirectorySeparatorChar)));
            if (!path.StartsWith(Path.GetFullPath(www), StringComparison.OrdinalIgnoreCase) || !File.Exists(path))
            {
                ctx.Response.StatusCode = 404;
                ctx.Response.Close();
                continue;
            }

            var ext = Path.GetExtension(path).ToLowerInvariant();
            ctx.Response.ContentType = ext switch
            {
                ".html" => "text/html; charset=utf-8",
                ".js" => "text/javascript; charset=utf-8",
                ".ini" => "text/plain; charset=utf-8",
                ".css" => "text/css; charset=utf-8",
                _ => "application/octet-stream",
            };
            var bytes = await File.ReadAllBytesAsync(path);
            ctx.Response.ContentLength64 = bytes.Length;
            await ctx.Response.OutputStream.WriteAsync(bytes);
            ctx.Response.Close();
        }
    }
}
