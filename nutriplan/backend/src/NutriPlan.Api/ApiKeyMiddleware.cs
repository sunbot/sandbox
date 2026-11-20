using System.Security.Cryptography;
using System.Text;

namespace NutriPlan.Api;

/// <summary>
/// Single shared secret for a personal deployment: when <c>Api:Key</c> is set, every /api request must send
/// it in the <c>X-Api-Key</c> header. Leave it empty for local development on your own network.
/// Swap for real auth (e.g. Supabase / Entra / Auth0 JWTs) when this becomes multi-user.
/// </summary>
public sealed class ApiKeyMiddleware(RequestDelegate next, IConfiguration config)
{
    public const string Header = "X-Api-Key";
    private readonly byte[]? _key = string.IsNullOrWhiteSpace(config["Api:Key"]) ? null : Encoding.UTF8.GetBytes(config["Api:Key"]!);

    public async Task InvokeAsync(HttpContext context)
    {
        if (_key is not null && context.Request.Path.StartsWithSegments("/api"))
        {
            var provided = context.Request.Headers[Header].ToString();
            if (!CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(provided), _key))
            {
                context.Response.StatusCode = StatusCodes.Status401Unauthorized;
                await context.Response.WriteAsJsonAsync(new { title = "Missing or wrong API key" });
                return;
            }
        }
        await next(context);
    }
}
