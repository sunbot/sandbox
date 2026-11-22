using NutriPlan.Api.Auth;
using NutriPlan.Application.Accounts;

namespace NutriPlan.Api.Endpoints;

public sealed record SessionDto(string State, string Message, AccountDto? User, string Subject);
public sealed record InviteRequest(string Email);
public sealed record SetActiveRequest(bool Active);

public static class AccountEndpoints
{
    /// <summary>Mapped outside the /api group's default policy: the session check must answer for signed-in but not invited accounts.</summary>
    public static void MapAccountEndpoints(this WebApplication app)
    {
        var g = app.MapGroup("/api/account").WithTags("Account");

        // Who am I, and do I have access? The subject is the caller's own Firebase user id (shown so the owner can be set up).
        g.MapGet("/session", async (HttpContext http, RequestAccount account, CancellationToken ct) =>
        {
            var result = await account.ResolveAsync(http.User, ct);
            var state = result.State.ToString();
            return new SessionDto(state, result.Allowed ? "Signed in." : AccessDeniedWriter.Message(state),
                result.User is { } u && result.Allowed ? AccountDto.From(u) : null, result.Subject);
        }).RequireAuthorization(AuthSetup.SignedIn);

        var admin = g.MapGroup("").RequireAuthorization(AuthSetup.Owner);
        admin.MapGet("/invitations", (RequestAccount me, AccountService s, CancellationToken ct) => s.ListInvitationsAsync(me.User, ct));
        admin.MapPost("/invitations", (InviteRequest r, RequestAccount me, AccountService s, CancellationToken ct) => s.InviteAsync(me.User, r.Email, ct));
        admin.MapDelete("/invitations/{id:guid}", async (Guid id, RequestAccount me, AccountService s, CancellationToken ct) =>
        {
            await s.RevokeInvitationAsync(me.User, id, ct);
            return Results.NoContent();
        });
        admin.MapGet("/users", (RequestAccount me, AccountService s, CancellationToken ct) => s.ListUsersAsync(me.User, ct));
        admin.MapPost("/users/{id:guid}/active", (Guid id, SetActiveRequest r, RequestAccount me, AccountService s, CancellationToken ct) =>
            s.SetActiveAsync(me.User, id, r.Active, ct));
    }
}
