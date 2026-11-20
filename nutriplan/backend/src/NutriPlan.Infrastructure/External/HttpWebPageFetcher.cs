using System.Net;
using System.Net.Sockets;
using NutriPlan.Application.Abstractions;
using NutriPlan.Application.Common;

namespace NutriPlan.Infrastructure.External;

/// <summary>
/// Downloads a recipe page. Caps size and refuses private/loopback addresses so a link can't be used to
/// probe your home network. The check runs both up front and on every connection (covers redirects).
/// </summary>
public sealed class HttpWebPageFetcher(HttpClient http) : IWebPageFetcher
{
    /// <summary>Primary handler whose connections can only reach public IP addresses.</summary>
    public static SocketsHttpHandler CreatePublicOnlyHandler() => new()
    {
        AllowAutoRedirect = true,
        MaxAutomaticRedirections = 5,
        ConnectCallback = async (context, ct) =>
        {
            var addresses = await Dns.GetHostAddressesAsync(context.DnsEndPoint.Host, ct);
            var target = addresses.FirstOrDefault(a => !IsPrivate(a))
                         ?? throw new HttpRequestException($"Blocked non-public address for {context.DnsEndPoint.Host}.");
            if (addresses.Any(IsPrivate)) throw new HttpRequestException($"Blocked non-public address for {context.DnsEndPoint.Host}.");
            var socket = new Socket(target.AddressFamily, SocketType.Stream, ProtocolType.Tcp) { NoDelay = true };
            try
            {
                await socket.ConnectAsync(new IPEndPoint(target, context.DnsEndPoint.Port), ct);
                return new NetworkStream(socket, ownsSocket: true);
            }
            catch
            {
                socket.Dispose();
                throw;
            }
        },
    };

    private const int MaxBytes = 5 * 1024 * 1024;

    public async Task<string> GetHtmlAsync(Uri url, CancellationToken ct = default)
    {
        await EnsurePublicHostAsync(url, ct);
        using var response = await http.GetAsync(url, HttpCompletionOption.ResponseHeadersRead, ct);
        if (!response.IsSuccessStatusCode)
            throw new ValidationException($"The site returned {(int)response.StatusCode} {response.ReasonPhrase}.");
        if (response.Content.Headers.ContentLength > MaxBytes) throw new ValidationException("That page is too large to import.");

        await using var stream = await response.Content.ReadAsStreamAsync(ct);
        using var limited = new MemoryStream();
        var buffer = new byte[81920];
        int read;
        while ((read = await stream.ReadAsync(buffer, ct)) > 0)
        {
            limited.Write(buffer, 0, read);
            if (limited.Length > MaxBytes) throw new ValidationException("That page is too large to import.");
        }
        return System.Text.Encoding.UTF8.GetString(limited.ToArray());
    }

    private static async Task EnsurePublicHostAsync(Uri url, CancellationToken ct)
    {
        var addresses = IPAddress.TryParse(url.Host, out var literal) ? [literal] : await Dns.GetHostAddressesAsync(url.Host, ct);
        if (addresses.Length == 0 || addresses.Any(IsPrivate))
            throw new ValidationException("That address isn't a public website.");
    }

    public static bool IsPrivate(IPAddress ip)
    {
        if (IPAddress.IsLoopback(ip)) return true;
        if (ip.IsIPv4MappedToIPv6) ip = ip.MapToIPv4();
        if (ip.AddressFamily == AddressFamily.InterNetworkV6)
            return ip.IsIPv6LinkLocal || ip.IsIPv6SiteLocal || ip.IsIPv6UniqueLocal;
        var b = ip.GetAddressBytes();
        return b[0] == 10 || b[0] == 127 || b[0] == 0 ||
               (b[0] == 172 && b[1] >= 16 && b[1] <= 31) ||
               (b[0] == 192 && b[1] == 168) ||
               (b[0] == 169 && b[1] == 254) ||
               (b[0] == 100 && b[1] >= 64 && b[1] <= 127);
    }
}
