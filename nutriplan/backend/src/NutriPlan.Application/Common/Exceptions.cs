namespace NutriPlan.Application.Common;

/// <summary>No signed-in user where one is required. Mapped to 401.</summary>
public sealed class NotAuthenticatedException() : Exception("Sign in to continue.");

/// <summary>Signed in, but not allowed (not the owner, not your record). Mapped to 403 with a safe message.</summary>
public sealed class ForbiddenException(string message) : Exception(message);
