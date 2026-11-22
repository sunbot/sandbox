using NutriPlan.Domain.Users;

namespace NutriPlan.Application.Abstractions;

/// <summary>
/// The signed-in app user for this request, resolved on the server from a verified token. Every user-owned read and
/// write is scoped to <see cref="Id"/>; nothing takes a user id from request data.
/// </summary>
public interface ICurrentUser
{
    bool IsAuthenticated { get; }
    /// <summary>Throws <see cref="Common.NotAuthenticatedException"/> when no user is signed in.</summary>
    Guid Id { get; }
}

/// <summary>A verified sign-in token's facts. Built only from a validated JWT.</summary>
public sealed record VerifiedPrincipal(string Provider, string Subject, string? Email, bool EmailVerified, string? Name);

/// <summary>Users, their sign-in identities and invitations. Not scoped to the current user: account resolution and admin only.</summary>
public interface IUserDirectory
{
    Task<AppUser?> FindByIdentityAsync(string provider, string subject, CancellationToken ct = default);
    Task<AppUser?> GetAsync(Guid userId, CancellationToken ct = default);
    Task<bool> HasIdentityAsync(Guid userId, CancellationToken ct = default);
    Task<IReadOnlyList<AppUser>> ListAsync(CancellationToken ct = default);
    void Add(AppUser user);
    void Add(ExternalIdentity identity);
    Task<Invitation?> FindOpenInvitationAsync(string emailHash, DateTimeOffset now, CancellationToken ct = default);
    Task<Invitation?> GetInvitationAsync(Guid id, CancellationToken ct = default);
    Task<IReadOnlyList<Invitation>> ListInvitationsAsync(CancellationToken ct = default);
    void Add(Invitation invitation);
}
