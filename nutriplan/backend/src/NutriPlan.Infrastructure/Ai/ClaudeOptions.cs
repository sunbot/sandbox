namespace NutriPlan.Infrastructure.Ai;

/// <summary>
/// Settings for the optional Claude integration (appsettings "Claude" section or env vars Claude__ApiKey, ...).
/// Leave ApiKey empty to run fully offline with the rule-based parser.
/// </summary>
public sealed class ClaudeOptions
{
    public const string Section = "Claude";

    /// <summary>Anthropic API key from https://console.anthropic.com (separate from a Claude.ai subscription).</summary>
    public string? ApiKey { get; set; }

    /// <summary>
    /// Model for understanding chat/voice text. Default is Claude Opus 5.5; set "claude-haiku-5-5"
    /// for a much cheaper (≈40×) option that is usually good enough for food parsing.
    /// </summary>
    public string InterpreterModel { get; set; } = "claude-opus-5-5";

    /// <summary>Model for drafting recipe ideas.</summary>
    public string RecipeModel { get; set; } = "claude-opus-5-5";

    /// <summary>Re-serve a request on a fallback model if the primary declines it (only for models that support it).</summary>
    public bool UseServerSideFallback { get; set; } = true;

    public bool IsConfigured => !string.IsNullOrWhiteSpace(ApiKey);
}
