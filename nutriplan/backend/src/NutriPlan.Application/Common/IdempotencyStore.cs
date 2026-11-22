using System.Collections.Concurrent;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace NutriPlan.Application.Common;

/// <summary>
/// Makes a retried request safe. The app sends an Idempotency-Key with "Log all" / "Plan all"; if the same key arrives
/// again with the same body (a timeout after the server already saved, a double tap), the first result is returned and
/// nothing is saved twice. A different body under the same key is treated as a new request. Held in memory for a short
/// time: this app runs as a single instance, and the database's unique index still guards plan-linked logs.
/// </summary>
public sealed class IdempotencyStore(TimeProvider? time = null)
{
    private readonly TimeProvider _time = time ?? TimeProvider.System;
    private readonly ConcurrentDictionary<string, (DateTimeOffset At, object Result)> _done = new();
    private readonly SemaphoreSlim _gate = new(1, 1);
    public static readonly TimeSpan Window = TimeSpan.FromMinutes(15);

    /// <summary>Keys are per user: the same key from two people is two requests, and nobody can read another's result.</summary>
    public async Task<T> RunAsync<T>(Guid owner, string? key, object request, Func<Task<T>> action) where T : class
    {
        if (string.IsNullOrWhiteSpace(key) || key.Length > 100) return await action();
        var id = owner.ToString("N") + ":" + key + ":" + Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(request))));
        await _gate.WaitAsync();
        try
        {
            Purge();
            if (_done.TryGetValue(id, out var hit)) return (T)hit.Result;
            var result = await action(); // a failure is not remembered, so a retry runs again
            _done[id] = (_time.GetUtcNow(), result);
            return result;
        }
        finally { _gate.Release(); }
    }

    private void Purge()
    {
        var cutoff = _time.GetUtcNow() - Window;
        foreach (var (k, v) in _done) if (v.At < cutoff) _done.TryRemove(k, out _);
    }
}
