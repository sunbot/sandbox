using System.Text.Json;
using Anthropic;
using Anthropic.Models.Beta.Messages;
using Microsoft.Extensions.Options;

namespace NutriPlan.Infrastructure.Ai;

public sealed class ClaudeRefusedException(string message) : Exception(message);

/// <summary>
/// Thin wrapper over the Anthropic SDK: one request in, one schema-validated JSON document out.
/// Uses structured outputs (output_config.format) so responses always match the schema, and the
/// server-side refusal fallback where the model supports it.
/// </summary>
public sealed class ClaudeJsonClient(IOptions<ClaudeOptions> options)
{
    private const string FallbackBeta = "server-side-fallback-2026-07-01";
    private static readonly HashSet<string> FallbackModels = ["claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5", "claude-fable-5-1", "claude-fable-5-2"];

    private readonly Lazy<AnthropicClient> _client = new(() => new AnthropicClient { ApiKey = options.Value.ApiKey });

    public bool IsConfigured => options.Value.IsConfigured;

    public async Task<JsonDocument> CompleteJsonAsync(
        string model,
        string system,
        string userText,
        IReadOnlyDictionary<string, JsonElement> schema,
        Effort effort,
        int maxTokens,
        CancellationToken ct)
    {
        if (!IsConfigured) throw new InvalidOperationException("Claude API key is not configured.");

        var useFallback = options.Value.UseServerSideFallback && FallbackModels.Contains(model);
        var parameters = new MessageCreateParams
        {
            Model = model,
            MaxTokens = maxTokens,
            System = system,
            Messages = [new BetaUserMessageParam { Content = userText }],
            OutputConfig = new BetaOutputConfig
            {
                Effort = effort,
                Format = new BetaJsonOutputFormat { Schema = schema.ToDictionary(kv => kv.Key, kv => kv.Value) },
            },
        };
        if (useFallback)
        {
            parameters = parameters with
            {
                Betas = [FallbackBeta],
                Fallbacks = new Default(),
            };
        }

        var response = await _client.Value.Beta.Messages.Create(parameters, ct);

        if (response.StopReason == BetaStopReason.Refusal)
            throw new ClaudeRefusedException("The model declined this request.");
        if (response.StopReason == BetaStopReason.MaxTokens)
            throw new InvalidOperationException("The model response was cut off (max_tokens).");

        var text = string.Concat(response.Content.Select(b => b.Value).OfType<BetaTextBlock>().Select(t => t.Text));
        return JsonDocument.Parse(text);
    }
}
