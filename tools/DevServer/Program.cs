using System.Net;
using System.Text;

namespace FlubberForge.DevServer;

// Static file server for www/, so the player can be tested without installing
// a scripting runtime. Nothing here is needed to deploy the site - www/ is
// static and any host will serve it.
internal static class Program
{
    private static int Main(string[] args)
    {
        var root = DefaultRoot();
        var port = 8099;
        var open = false;

        for (var i = 0; i < args.Length; i++)
        {
            switch (args[i])
            {
                case "--root" when i + 1 < args.Length:
                    root = Path.GetFullPath(args[++i]);
                    break;
                case "--port" when i + 1 < args.Length:
                    if (!int.TryParse(args[++i], out port))
                    {
                        Console.Error.WriteLine("--port needs a number.");
                        return 2;
                    }
                    break;
                case "--open":
                    open = true;
                    break;
                case "-h":
                case "--help":
                    Console.WriteLine("devserver [--root <dir>] [--port <n>] [--open]");
                    return 0;
                default:
                    Console.Error.WriteLine("Unknown argument: " + args[i]);
                    return 2;
            }
        }

        if (!Directory.Exists(root))
        {
            Console.Error.WriteLine("No www folder at " + root);
            return 1;
        }

        var listener = new HttpListener();
        listener.Prefixes.Add("http://127.0.0.1:" + port + "/");
        try
        {
            listener.Start();
        }
        catch (HttpListenerException ex)
        {
            Console.Error.WriteLine("Could not listen on port " + port + ": " + ex.Message);
            return 1;
        }

        var url = "http://127.0.0.1:" + port + "/index.html";
        Console.WriteLine("Serving " + root);
        Console.WriteLine(url);
        Console.WriteLine("Ctrl+C to stop.");

        if (open)
            System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo(url) { UseShellExecute = true });

        Console.CancelKeyPress += (_, e) =>
        {
            e.Cancel = true;
            listener.Close();
        };

        while (listener.IsListening)
        {
            HttpListenerContext ctx;
            try
            {
                ctx = listener.GetContext();
            }
            catch (Exception)
            {
                break;
            }

            try
            {
                Respond(ctx, root);
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine(ex.Message);
            }
        }

        return 0;
    }

    private static string DefaultRoot()
    {
        // Walk up from the binary until a www/ shows up, so the server works
        // whether it is run from the repo root or from bin/.
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir != null)
        {
            var candidate = Path.Combine(dir.FullName, "www");
            if (Directory.Exists(candidate)) return candidate;
            dir = dir.Parent;
        }
        return Path.GetFullPath("www");
    }

    private static void Respond(HttpListenerContext ctx, string root)
    {
        var rel = Uri.UnescapeDataString(ctx.Request.Url?.AbsolutePath ?? "/").TrimStart('/');
        if (rel.Length == 0) rel = "index.html";

        var path = Path.GetFullPath(Path.Combine(root, rel.Replace('/', Path.DirectorySeparatorChar)));
        var inside = path.StartsWith(root + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase);

        if (!inside || !File.Exists(path))
        {
            var body = Encoding.UTF8.GetBytes("404 " + rel);
            ctx.Response.StatusCode = 404;
            ctx.Response.ContentType = "text/plain; charset=utf-8";
            ctx.Response.ContentLength64 = body.Length;
            ctx.Response.OutputStream.Write(body);
            ctx.Response.Close();
            Console.WriteLine("404 " + rel);
            return;
        }

        var bytes = File.ReadAllBytes(path);
        ctx.Response.StatusCode = 200;
        ctx.Response.ContentType = MimeOf(Path.GetExtension(path));
        // Themes and shaders change constantly while iterating.
        ctx.Response.Headers["Cache-Control"] = "no-store";
        ctx.Response.ContentLength64 = bytes.Length;
        ctx.Response.OutputStream.Write(bytes);
        ctx.Response.Close();
        Console.WriteLine("200 " + rel);
    }

    private static string MimeOf(string ext) => ext.ToLowerInvariant() switch
    {
        ".html" => "text/html; charset=utf-8",
        ".js" => "text/javascript; charset=utf-8",
        ".json" => "application/json; charset=utf-8",
        ".css" => "text/css; charset=utf-8",
        ".ini" or ".txt" => "text/plain; charset=utf-8",
        ".png" => "image/png",
        ".jpg" or ".jpeg" => "image/jpeg",
        ".ico" => "image/x-icon",
        ".wav" => "audio/wav",
        _ => "application/octet-stream",
    };
}
