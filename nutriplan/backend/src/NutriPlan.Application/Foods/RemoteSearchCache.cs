using System.Collections.Concurrent;

namespace NutriPlan.Application.Foods;

/// <summary>
/// Remembers recent remote search results for a short time and shares one in-flight request per query, so repeated
/// searches (and two screens asking at once) cost one call to the provider. Failures are not remembered. Bounded in size.
/// Singleton: this app runs as a single instance.
/// </summary>
public sealed class RemoteSearchCache(TimeProvider? time = null)
{
    public static readonly TimeSpan Lifetime = TimeSpan.FromMinutes(30);
    public const int MaxEntries = 500;

    private readonly TimeProvider _time = time ?? TimeProvider.System;
    private readonly ConcurrentDictionary<string, (DateTimeOffset At, object Value)> _done = new();
    private readonly ConcurrentDictionary<string, Lazy<Task<object>>> _running = new();

    public async Task<T> GetOrRunAsync<T>(string key, Func<Task<T>> run, Func<T, bool> cacheable) where T : class
    {
        if (_done.TryGetValue(key, out var hit) && _time.GetUtcNow() - hit.At < Lifetime) return (T)hit.Value;
        var lazy = _running.GetOrAdd(key, _ => new Lazy<Task<object>>(async () => await run()));
        try
        {
            var value = (T)await lazy.Value;
            if (cacheable(value))
            {
                if (_done.Count >= MaxEntries) Trim();
                _done[key] = (_time.GetUtcNow(), value);
            }
            return value;
        }
        finally
        {
            _running.TryRemove(key, out _);
        }
    }

    private void Trim()
    {
        var now = _time.GetUtcNow();
        foreach (var (k, v) in _done) if (now - v.At >= Lifetime) _done.TryRemove(k, out _);
        if (_done.Count >= MaxEntries)
            foreach (var k in _done.OrderBy(kv => kv.Value.At).Take(_done.Count / 4).Select(kv => kv.Key)) _done.TryRemove(k, out _);
    }
}
