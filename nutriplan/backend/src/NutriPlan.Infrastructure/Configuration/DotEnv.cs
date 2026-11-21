using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Configuration.Memory;

namespace NutriPlan.Infrastructure.Configuration;

/// <summary>
/// Reads <c>.env.local</c> / <c>.env</c> files (what `neon deploy` / `neon env pull` write) so local runs pick up
/// DATABASE_URL and friends. Real environment variables and appsettings still win, because this source is added first.
/// The files are searched from the working directory upward (the API runs deep inside backend/, the files sit in the project root).
/// </summary>
public static class DotEnv
{
    public static readonly string[] FileNames = [".env.local", ".env"]; // earlier = higher priority

    public static IDictionary<string, string?> Parse(string content)
    {
        var result = new Dictionary<string, string?>(StringComparer.OrdinalIgnoreCase);
        foreach (var raw in content.Replace("\r\n", "\n").Split('\n'))
        {
            var line = raw.Trim();
            if (line.Length == 0 || line[0] == '#') continue;
            if (line.StartsWith("export ", StringComparison.Ordinal)) line = line[7..].TrimStart();
            var eq = line.IndexOf('=');
            if (eq <= 0) continue;

            var key = line[..eq].Trim();
            var value = line[(eq + 1)..].Trim();
            if (value.Length >= 2 && (value[0] == '"' && value[^1] == '"' || value[0] == '\'' && value[^1] == '\''))
                value = value[1..^1];
            else if (value.IndexOf(" #", StringComparison.Ordinal) is var hash and >= 0)
                value = value[..hash].TrimEnd(); // inline comment on an unquoted value
            // "__" is how .NET writes ":" in env var names; keep that convention working in files too.
            result[key.Replace("__", ":")] = value;
        }
        return result;
    }

    /// <summary>Loads the nearest <c>.env.local</c> / <c>.env</c> (searching up to 6 parent folders).</summary>
    public static IConfigurationBuilder AddDotEnvFiles(this IConfigurationBuilder builder, string? startDirectory = null)
    {
        var merged = new Dictionary<string, string?>(StringComparer.OrdinalIgnoreCase);
        var dir = new DirectoryInfo(startDirectory ?? Directory.GetCurrentDirectory());
        for (var depth = 0; dir is not null && depth <= 6; depth++, dir = dir.Parent)
        {
            // Walk the file names from lowest to highest priority so later writes win.
            foreach (var name in FileNames.Reverse())
            {
                var path = Path.Combine(dir.FullName, name);
                if (!File.Exists(path)) continue;
                foreach (var (k, v) in Parse(File.ReadAllText(path))) merged[k] = v;
            }
            if (merged.Count > 0) break; // nearest folder that has any env file wins
        }
        if (merged.Count > 0) builder.Sources.Insert(0, new MemoryConfigurationSource { InitialData = merged });
        return builder;
    }
}
