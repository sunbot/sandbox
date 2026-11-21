namespace NutriPlan.Domain.Users;

public enum UserRole { Member = 0, Owner = 1 }

/// <summary>
/// A person who uses the app. The app's own identity: data belongs to an AppUser, and sign-in providers are linked to
/// it through <see cref="ExternalIdentity"/>, so a provider can be added or changed without touching anyone's data.
/// </summary>
public sealed class AppUser
{
    /// <summary>Owns everything created before sign-in existed, until the owner's account claims it.</summary>
    public static readonly Guid LegacyOwnerId = Guid.Parse("00000000-0000-4000-8000-0000000000a1");

    private AppUser() { } // EF

    public AppUser(string displayName, string? email, UserRole role = UserRole.Member, Guid? id = null)
    {
        Id = id ?? Guid.NewGuid();
        DisplayName = string.IsNullOrWhiteSpace(displayName) ? "Intake Grid user" : displayName.Trim();
        Email = string.IsNullOrWhiteSpace(email) ? null : email.Trim();
        Role = role;
        IsActive = true;
        CreatedAt = UpdatedAt = DateTimeOffset.UtcNow;
    }

    public Guid Id { get; private set; }
    public string DisplayName { get; private set; } = "";
    /// <summary>For display and invitations only: never the identity key (emails change and can be reused).</summary>
    public string? Email { get; private set; }
    public UserRole Role { get; private set; }
    public bool IsActive { get; private set; }
    public DateTimeOffset CreatedAt { get; private set; }
    public DateTimeOffset UpdatedAt { get; private set; }
    public DateTimeOffset? LastLoginAt { get; private set; }

    public void SignedIn(string? displayName, string? email, DateTimeOffset at)
    {
        if (!string.IsNullOrWhiteSpace(displayName)) DisplayName = displayName.Trim();
        if (!string.IsNullOrWhiteSpace(email)) Email = email.Trim();
        LastLoginAt = at;
        UpdatedAt = at;
    }

    public void Deactivate() { IsActive = false; UpdatedAt = DateTimeOffset.UtcNow; }
    public void Reactivate() { IsActive = true; UpdatedAt = DateTimeOffset.UtcNow; }
}

/// <summary>A sign-in identity (provider + the provider's stable subject id) linked to one app user. Unique per provider and subject.</summary>
public sealed class ExternalIdentity
{
    private ExternalIdentity() { } // EF

    public ExternalIdentity(Guid userId, string provider, string subject)
    {
        if (string.IsNullOrWhiteSpace(provider) || string.IsNullOrWhiteSpace(subject)) throw new ArgumentException("Provider and subject are required.");
        Id = Guid.NewGuid();
        UserId = userId;
        Provider = provider;
        Subject = subject;
        CreatedAt = DateTimeOffset.UtcNow;
    }

    public Guid Id { get; private set; }
    public Guid UserId { get; private set; }
    public string Provider { get; private set; } = "";
    public string Subject { get; private set; } = "";
    public DateTimeOffset CreatedAt { get; private set; }
}

/// <summary>
/// Permission for one verified email address to create an account. Stored as a hash, used once, revocable, expiring.
/// Registration is closed unless an invitation exists.
/// </summary>
public sealed class Invitation
{
    private Invitation() { } // EF

    public Invitation(string emailHash, Guid invitedBy, DateTimeOffset expiresAt)
    {
        Id = Guid.NewGuid();
        EmailHash = emailHash;
        InvitedBy = invitedBy;
        CreatedAt = DateTimeOffset.UtcNow;
        ExpiresAt = expiresAt;
    }

    public Guid Id { get; private set; }
    public string EmailHash { get; private set; } = "";
    public Guid InvitedBy { get; private set; }
    public DateTimeOffset CreatedAt { get; private set; }
    public DateTimeOffset ExpiresAt { get; private set; }
    public Guid? AcceptedBy { get; private set; }
    public DateTimeOffset? AcceptedAt { get; private set; }
    public DateTimeOffset? RevokedAt { get; private set; }

    public bool IsOpen(DateTimeOffset now) => AcceptedBy is null && RevokedAt is null && now < ExpiresAt;
    public void Accept(Guid userId, DateTimeOffset at) { AcceptedBy = userId; AcceptedAt = at; }
    public void Revoke(DateTimeOffset at) => RevokedAt = at;

    /// <summary>Lower-cased, trimmed email → SHA-256 hex. The table never holds the address itself.</summary>
    public static string HashEmail(string email) =>
        Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(email.Trim().ToLowerInvariant())));
}
