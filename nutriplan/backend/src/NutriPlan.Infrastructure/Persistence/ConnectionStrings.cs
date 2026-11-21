using Npgsql;

namespace NutriPlan.Infrastructure.Persistence;

/// <summary>
/// Hosts (Render, Railway, Neon, Supabase, Heroku-style) hand out a URL like
/// postgres://user:pass@host:5432/db?sslmode=require. Npgsql wants key=value pairs; this converts.
/// </summary>
public static class ConnectionStrings
{
    public static string FromUrlOrRaw(string value)
    {
        if (!value.StartsWith("postgres://", StringComparison.OrdinalIgnoreCase) &&
            !value.StartsWith("postgresql://", StringComparison.OrdinalIgnoreCase))
            return value;

        var uri = new Uri(value);
        var userInfo = uri.UserInfo.Split(':', 2);
        var builder = new NpgsqlConnectionStringBuilder
        {
            Host = uri.Host,
            Port = uri.Port > 0 ? uri.Port : 5432,
            Database = Uri.UnescapeDataString(uri.AbsolutePath.TrimStart('/')),
            Username = Uri.UnescapeDataString(userInfo[0]),
            Password = userInfo.Length > 1 ? Uri.UnescapeDataString(userInfo[1]) : null,
            // Hosted databases require TLS; "Prefer" still works for a plain local server.
            SslMode = SslMode.Prefer,
        };

        foreach (var pair in uri.Query.TrimStart('?').Split('&', StringSplitOptions.RemoveEmptyEntries))
        {
            var kv = pair.Split('=', 2);
            if (kv.Length != 2) continue;
            if (kv[0].Equals("sslmode", StringComparison.OrdinalIgnoreCase) &&
                Enum.TryParse<SslMode>(kv[1].Replace("-", ""), ignoreCase: true, out var mode))
                builder.SslMode = mode;
            else if (kv[0].Equals("channel_binding", StringComparison.OrdinalIgnoreCase) &&
                     Enum.TryParse<ChannelBinding>(kv[1], ignoreCase: true, out var binding))
                builder.ChannelBinding = binding;
        }
        return builder.ConnectionString;
    }
}
