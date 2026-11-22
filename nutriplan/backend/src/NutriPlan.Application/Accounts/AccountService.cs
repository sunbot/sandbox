using NutriPlan.Application.Abstractions;
using NutriPlan.Application.Common;
using NutriPlan.Domain.Users;

namespace NutriPlan.Application.Accounts;

public sealed class AuthOptions
{
    public const string Section = "Auth";
    /// <summary>Firebase project id: the token issuer is https://securetoken.google.com/{id} and the audience is the id.</summary>
    public string? FirebaseProjectId { get; set; }
    /// <summary>
    /// The Firebase user id (token subject) allowed to claim the data that existed before sign-in. Set by the operator
    /// after their first sign-in; not a secret, and never an email address.
    /// </summary>
    public string? OwnerSubject { get; set; }
}

public enum AccessState { Active, NotInvited, Revoked, EmailNotVerified }

/// <summary>The outcome of signing in: the app user, or why access is refused (with the subject, so the owner can be set up).</summary>
public sealed record AccessResult(AccessState State, AppUser? User, string Subject)
{
    public bool Allowed => State == AccessState.Active && User is not null;
}

public sealed record AccountDto(Guid Id, string DisplayName, string? Email, string Role, bool IsActive, DateTimeOffset CreatedAt, DateTimeOffset? LastLoginAt)
{
    public static AccountDto From(AppUser u) => new(u.Id, u.DisplayName, u.Email, u.Role.ToString(), u.IsActive, u.CreatedAt, u.LastLoginAt);
}

public sealed record InvitationDto(Guid Id, DateTimeOffset CreatedAt, DateTimeOffset ExpiresAt, bool Accepted, bool Revoked);

/// <summary>
/// Turns a verified sign-in into an app user. Registration is closed: a new identity gets an account only through an
/// open invitation for its verified email, or, once, by being the configured owner subject that claims the legacy data.
/// Nothing here is decided by request data: only by the validated token and server configuration.
/// </summary>
public sealed class AccountService(IUserDirectory users, IUnitOfWork uow, Microsoft.Extensions.Options.IOptions<AuthOptions> options, TimeProvider? time = null)
{
    private readonly TimeProvider _time = time ?? TimeProvider.System;
    public static readonly TimeSpan InvitationLifetime = TimeSpan.FromDays(14);

    public async Task<AccessResult> ResolveAsync(VerifiedPrincipal p, CancellationToken ct = default)
    {
        var now = _time.GetUtcNow();
        var existing = await users.FindByIdentityAsync(p.Provider, p.Subject, ct);
        if (existing is not null)
        {
            if (!existing.IsActive) return new(AccessState.Revoked, null, p.Subject);
            // Last-login is bookkeeping: written at most hourly so ordinary requests don't write.
            if (existing.LastLoginAt is null || now - existing.LastLoginAt > TimeSpan.FromHours(1))
            {
                existing.SignedIn(p.Name, p.EmailVerified ? p.Email : null, now);
                await uow.SaveChangesAsync(ct);
            }
            return new(AccessState.Active, existing, p.Subject);
        }

        // The owner's first sign-in claims the data that existed before accounts: only the configured subject, only once.
        var owner = options.Value.OwnerSubject;
        if (!string.IsNullOrWhiteSpace(owner) && string.Equals(owner.Trim(), p.Subject, StringComparison.Ordinal)
            && !await users.HasIdentityAsync(AppUser.LegacyOwnerId, ct)
            && await users.GetAsync(AppUser.LegacyOwnerId, ct) is { IsActive: true } legacy)
        {
            users.Add(new ExternalIdentity(legacy.Id, p.Provider, p.Subject));
            legacy.SignedIn(p.Name, p.EmailVerified ? p.Email : null, now);
            await uow.SaveChangesAsync(ct);
            return new(AccessState.Active, legacy, p.Subject);
        }

        if (string.IsNullOrWhiteSpace(p.Email)) return new(AccessState.NotInvited, null, p.Subject);
        if (!p.EmailVerified) return new(AccessState.EmailNotVerified, null, p.Subject);
        var invite = await users.FindOpenInvitationAsync(Invitation.HashEmail(p.Email), now, ct);
        if (invite is null) return new(AccessState.NotInvited, null, p.Subject);

        var user = new AppUser(p.Name ?? p.Email, p.Email, UserRole.Member);
        user.SignedIn(p.Name, p.Email, now);
        users.Add(user);
        users.Add(new ExternalIdentity(user.Id, p.Provider, p.Subject));
        invite.Accept(user.Id, now);
        await uow.SaveChangesAsync(ct);
        return new(AccessState.Active, user, p.Subject);
    }

    // ── Owner-only administration ──────────────────────────────────────────────

    public async Task<InvitationDto> InviteAsync(AppUser by, string email, CancellationToken ct = default)
    {
        RequireOwner(by);
        var e = (email ?? "").Trim();
        if (e.Length is < 3 or > 254 || !e.Contains('@')) throw new ValidationException("Enter the email address of the Google account to invite.");
        var now = _time.GetUtcNow();
        var invite = new Invitation(Invitation.HashEmail(e), by.Id, now + InvitationLifetime);
        users.Add(invite);
        await uow.SaveChangesAsync(ct);
        return ToDto(invite);
    }

    public async Task<IReadOnlyList<InvitationDto>> ListInvitationsAsync(AppUser by, CancellationToken ct = default)
    {
        RequireOwner(by);
        return (await users.ListInvitationsAsync(ct)).Select(ToDto).ToList();
    }

    public async Task RevokeInvitationAsync(AppUser by, Guid id, CancellationToken ct = default)
    {
        RequireOwner(by);
        var invite = await users.GetInvitationAsync(id, ct) ?? throw new NotFoundException("Invitation not found.");
        invite.Revoke(_time.GetUtcNow());
        await uow.SaveChangesAsync(ct);
    }

    public async Task<IReadOnlyList<AccountDto>> ListUsersAsync(AppUser by, CancellationToken ct = default)
    {
        RequireOwner(by);
        return (await users.ListAsync(ct)).Select(AccountDto.From).ToList();
    }

    public async Task<AccountDto> SetActiveAsync(AppUser by, Guid userId, bool active, CancellationToken ct = default)
    {
        RequireOwner(by);
        if (userId == by.Id) throw new ValidationException("You can't deactivate your own account.");
        var user = await users.GetAsync(userId, ct) ?? throw new NotFoundException("User not found.");
        if (active) user.Reactivate(); else user.Deactivate();
        await uow.SaveChangesAsync(ct);
        return AccountDto.From(user);
    }

    private static void RequireOwner(AppUser by)
    {
        if (by.Role != UserRole.Owner) throw new ForbiddenException("Only the account owner can do that.");
    }

    private static InvitationDto ToDto(Invitation i) => new(i.Id, i.CreatedAt, i.ExpiresAt, i.AcceptedBy is not null, i.RevokedAt is not null);
}
