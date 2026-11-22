using System.Security.Claims;
using System.Text.Json;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Authorization.Policy;
using Microsoft.IdentityModel.Protocols.OpenIdConnect;
using Microsoft.IdentityModel.Tokens;
using NutriPlan.Application.Abstractions;
using NutriPlan.Application.Accounts;
using NutriPlan.Application.Common;
using NutriPlan.Domain.Users;

namespace NutriPlan.Api.Auth;

/// <summary>
/// Sign-in is Google through Firebase Authentication. The app sends the Firebase ID token as a bearer token; the API
/// checks its signature against Google's published keys (fetched and rotated by the OpenID Connect discovery document),
/// its issuer, audience and lifetime, then maps its subject to an app user. Every endpoint requires an active app user
/// unless it says otherwise, so a newly added endpoint is closed by default.
/// </summary>
public static class AuthSetup
{
    public const string Provider = "firebase";
    /// <summary>A valid token is enough: used only to tell the app whether this account has access.</summary>
    public const string SignedIn = "SignedIn";
    /// <summary>Invitations and user management.</summary>
    public const string Owner = "Owner";

    public static void AddIntakeGridAuth(this WebApplicationBuilder builder)
    {
        var section = builder.Configuration.GetSection(AuthOptions.Section);
        builder.Services.Configure<AuthOptions>(section);
        var projectId = section[nameof(AuthOptions.FirebaseProjectId)]?.Trim();

        // Fail closed: outside local development the API refuses to start without knowing whose tokens to accept.
        if (string.IsNullOrEmpty(projectId) && !builder.Environment.IsDevelopment())
            throw new InvalidOperationException("Auth:FirebaseProjectId must be set (Render: Auth__FirebaseProjectId). The API won't start without sign-in configured.");

        builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme).AddJwtBearer(o =>
        {
            o.MapInboundClaims = false;
            o.IncludeErrorDetails = false;
            if (string.IsNullOrEmpty(projectId))
            {
                // Development without a project: no signing keys, so every token is rejected.
                o.Configuration = new OpenIdConnectConfiguration();
            }
            else
            {
                o.Authority = $"https://securetoken.google.com/{projectId}";
                o.RequireHttpsMetadata = true;
            }
            o.TokenValidationParameters = new TokenValidationParameters
            {
                ValidIssuer = $"https://securetoken.google.com/{projectId}",
                ValidAudience = projectId,
                ValidateIssuer = true,
                ValidateAudience = true,
                ValidateLifetime = true,
                ValidateIssuerSigningKey = true,
                RequireSignedTokens = true,
                RequireExpirationTime = true,
                ValidAlgorithms = [SecurityAlgorithms.RsaSha256],
                ClockSkew = TimeSpan.FromMinutes(1),
                NameClaimType = "sub",
            };
            o.Events = new JwtBearerEvents
            {
                OnTokenValidated = ctx =>
                {
                    // Only Google sign-ins: a Firebase project can also issue anonymous or other-provider tokens.
                    var sub = ctx.Principal?.FindFirst("sub")?.Value;
                    if (string.IsNullOrWhiteSpace(sub) || sub.Length > 128 || SignInProvider(ctx.Principal!) != "google.com")
                        ctx.Fail("Unsupported sign-in.");
                    return Task.CompletedTask;
                },
                OnChallenge = async ctx =>
                {
                    ctx.HandleResponse();
                    var expired = ctx.AuthenticateFailure is SecurityTokenExpiredException;
                    ctx.Response.StatusCode = StatusCodes.Status401Unauthorized;
                    await ctx.Response.WriteAsJsonAsync(new
                    {
                        title = expired ? "Your session expired. Sign in again." : "Sign in to continue.",
                        reason = expired ? "SessionExpired" : "SignInRequired",
                    });
                },
            };
        });

        var active = new AuthorizationPolicyBuilder(JwtBearerDefaults.AuthenticationScheme)
            .RequireAuthenticatedUser().AddRequirements(new ActiveUserRequirement(ownerOnly: false)).Build();
        builder.Services.AddAuthorizationBuilder()
            .SetDefaultPolicy(active)
            .SetFallbackPolicy(active)
            .AddPolicy(SignedIn, p => p.AddAuthenticationSchemes(JwtBearerDefaults.AuthenticationScheme).RequireAuthenticatedUser())
            .AddPolicy(Owner, p => p.AddAuthenticationSchemes(JwtBearerDefaults.AuthenticationScheme).RequireAuthenticatedUser()
                .AddRequirements(new ActiveUserRequirement(ownerOnly: true)));
        builder.Services.AddScoped<IAuthorizationHandler, ActiveUserHandler>();
        builder.Services.AddSingleton<IAuthorizationMiddlewareResultHandler, AccessDeniedWriter>();
        builder.Services.AddScoped<RequestAccount>();
        builder.Services.AddScoped<ICurrentUser, HttpCurrentUser>();
    }

    private static string? SignInProvider(ClaimsPrincipal principal)
    {
        var firebase = principal.FindFirst("firebase")?.Value;
        if (string.IsNullOrEmpty(firebase)) return null;
        try
        {
            using var doc = JsonDocument.Parse(firebase);
            return doc.RootElement.TryGetProperty("sign_in_provider", out var p) && p.ValueKind == JsonValueKind.String ? p.GetString() : null;
        }
        catch (JsonException) { return null; }
    }

    /// <summary>The verified facts of a validated token.</summary>
    public static VerifiedPrincipal ToVerified(ClaimsPrincipal user) => new(
        Provider,
        user.FindFirst("sub")!.Value,
        user.FindFirst("email")?.Value,
        string.Equals(user.FindFirst("email_verified")?.Value, "true", StringComparison.OrdinalIgnoreCase),
        user.FindFirst("name")?.Value);
}

/// <summary>Resolves the signed-in app user once per request, from the validated token only.</summary>
public sealed class RequestAccount(IServiceProvider services)
{
    private AccessResult? _result;
    public AccessResult? Result => _result;

    public async Task<AccessResult> ResolveAsync(ClaimsPrincipal principal, CancellationToken ct)
    {
        if (_result is not null) return _result;
        var accounts = services.GetRequiredService<AccountService>();
        return _result = await accounts.ResolveAsync(AuthSetup.ToVerified(principal), ct);
    }

    /// <summary>The active app user making this request (authorization has already required one).</summary>
    public AppUser User => _result is { Allowed: true, User: { } u } ? u : throw new NotAuthenticatedException();
}

public sealed class HttpCurrentUser(RequestAccount account) : ICurrentUser
{
    public bool IsAuthenticated => account.Result is { Allowed: true };
    public Guid Id => account.User.Id;
}

public sealed class ActiveUserRequirement(bool ownerOnly) : IAuthorizationRequirement
{
    public bool OwnerOnly { get; } = ownerOnly;
}

public sealed class ActiveUserHandler(RequestAccount account) : AuthorizationHandler<ActiveUserRequirement>
{
    protected override async Task HandleRequirementAsync(AuthorizationHandlerContext context, ActiveUserRequirement requirement)
    {
        if (context.User.Identity?.IsAuthenticated != true || context.User.FindFirst("sub") is null) return;
        var ct = (context.Resource as HttpContext)?.RequestAborted ?? CancellationToken.None;
        var result = await account.ResolveAsync(context.User, ct);
        if (!result.Allowed) { context.Fail(new AuthorizationFailureReason(this, result.State.ToString())); return; }
        if (requirement.OwnerOnly && result.User!.Role != UserRole.Owner) { context.Fail(new AuthorizationFailureReason(this, "OwnerOnly")); return; }
        context.Succeed(requirement);
    }
}

/// <summary>401/403 as short JSON the app can act on; never echoes token or account details.</summary>
public sealed class AccessDeniedWriter : IAuthorizationMiddlewareResultHandler
{
    private readonly AuthorizationMiddlewareResultHandler _default = new();

    public async Task HandleAsync(RequestDelegate next, HttpContext context, AuthorizationPolicy policy, PolicyAuthorizationResult result)
    {
        if (result.Forbidden)
        {
            var reason = result.AuthorizationFailure?.FailureReasons.Select(r => r.Message).FirstOrDefault() ?? "Forbidden";
            context.Response.StatusCode = StatusCodes.Status403Forbidden;
            await context.Response.WriteAsJsonAsync(new { title = Message(reason), reason });
            return;
        }
        await _default.HandleAsync(next, context, policy, result);
    }

    public static string Message(string reason) => reason switch
    {
        nameof(AccessState.NotInvited) => "This Google account hasn't been invited to Intake Grid.",
        nameof(AccessState.Revoked) => "This account's access has been turned off.",
        nameof(AccessState.EmailNotVerified) => "Verify this Google account's email address, then sign in again.",
        "OwnerOnly" => "Only the account owner can do that.",
        _ => "You don't have access to that.",
    };
}
