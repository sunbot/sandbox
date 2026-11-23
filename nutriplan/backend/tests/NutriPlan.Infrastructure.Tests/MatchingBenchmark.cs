using System.Globalization;
using System.Text;
using Microsoft.EntityFrameworkCore;
using NutriPlan.Application.Foods;
using NutriPlan.Application.Recipes;
using NutriPlan.Domain.Nutrients;
using NutriPlan.Domain.Recipes;
using NutriPlan.Infrastructure.Persistence;

namespace NutriPlan.Infrastructure.Tests;

/// <summary>Runs only against an explicit audit database (a copy with real USDA data), never the test databases.</summary>
public sealed class AuditDbFactAttribute : FactAttribute
{
    public const string Variable = "NUTRIPLAN_AUDIT_DB";
    public AuditDbFactAttribute()
    {
        if (string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable(Variable)))
            Skip = $"Set {Variable} to a database with USDA data (see scripts/audit/README.md) to run the matching benchmark.";
    }
}

/// <summary>
/// Phase 2.5 matching benchmark: each line in scripts/audit/matching_benchmark.txt is matched by the app's own
/// RecipeService.MatchIngredientsAsync (nothing is saved), and a Markdown report is written to NUTRIPLAN_AUDIT_OUT.
/// </summary>
public class MatchingBenchmark
{
    private sealed class NoWeb : Application.Abstractions.IWebPageFetcher
    {
        public Task<string> GetHtmlAsync(Uri url, CancellationToken ct = default) => throw new NotSupportedException();
    }

    [AuditDbFact]
    public async Task Match_the_benchmark_lines_and_write_the_report()
    {
        var cs = Environment.GetEnvironmentVariable(AuditDbFactAttribute.Variable)!;
        var input = Environment.GetEnvironmentVariable("NUTRIPLAN_AUDIT_LINES")
            ?? Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "../../../../../../scripts/audit/matching_benchmark.txt"));
        var output = Environment.GetEnvironmentVariable("NUTRIPLAN_AUDIT_OUT") ?? Path.Combine(Path.GetTempPath(), "matching_benchmark.md");

        await using var db = new NutriPlanDbContext(new DbContextOptionsBuilder<NutriPlanDbContext>().UseNpgsql(cs).UseSnakeCaseNamingConvention().Options,
            new TestUser(Domain.Users.AppUser.LegacyOwnerId));
        await using var readOnly = await db.Database.BeginTransactionAsync(); // rolled back at the end: nothing is ever saved
        var foods = new FoodRepository(db);
        var service = new RecipeService(new RecipeRepository(db), foods, new FoodService(foods, [], db), new NoWeb(), db);

        var report = new StringBuilder();
        string Num(double? v, string f = "0") => v is null ? "–" : v.Value.ToString(f, CultureInfo.InvariantCulture);
        foreach (var (title, servings, lines) in Parse(await File.ReadAllLinesAsync(input)))
        {
            var recipe = new Recipe(title, servings);
            recipe.SetIngredientLines(lines);
            await service.MatchIngredientsAsync(recipe, onlyUnmatched: false, default);
            var map = await foods.GetManyAsync(recipe.Ingredients.Where(i => i.FoodId is not null).Select(i => i.FoodId!.Value));
            report.AppendLine($"### {title}").AppendLine()
                .AppendLine("| Line | Matched food | Source | Grams | kcal | P | C | F | Conf. | State | Note |")
                .AppendLine("|---|---|---|---|---|---|---|---|---|---|---|");
            foreach (var i in recipe.Ingredients)
            {
                var f = i.FoodId is { } id ? map.GetValueOrDefault(id) : null;
                NutrientProfile? n = f is not null && i.Grams is { } g ? f.NutrientsFor(g) : null;
                var state = i.Status == IngredientMatchStatus.Ignored ? "left out" : i.FoodId is null ? "UNMATCHED" : i.Grams is null || i.MatchConfidence < 0.5 ? "check" : "matched";
                report.AppendLine($"| {Esc(i.RawText)} | {Esc(f?.Name ?? "")} | {f?.Source} | {Num(i.Grams)} | {Num(n?.Calories)} | {Num(n?.Protein, "0.#")} | {Num(n?.Carbs, "0.#")} | {Num(n?.Fat, "0.#")} | {i.MatchConfidence:0.00} | {state} | {Esc(i.ResolutionNote ?? "")} |");
            }
            var nutrition = RecipeNutritionCalculator.Calculate(recipe, map);
            var ps = nutrition.PerServing;
            report.AppendLine().AppendLine($"**Per serving ({servings:0.#} servings):** {ps.Calories:0} kcal · P {ps.Protein:0.#} g · C {ps.Carbs:0.#} g · F {ps.Fat:0.#} g · coverage {nutrition.Coverage:P0}").AppendLine();
        }
        await readOnly.RollbackAsync();
        await File.WriteAllTextAsync(output, report.ToString());
        Assert.True(report.Length > 0);
    }

    private static string Esc(string s) => s.Replace("|", "\\|").Replace("\n", " ");

    private static IEnumerable<(string Title, double Servings, List<string> Lines)> Parse(string[] all)
    {
        string? title = null; double servings = 1; var lines = new List<string>();
        foreach (var raw in all.Select(l => l.Trim()).Where(l => l.Length > 0))
        {
            if (raw.StartsWith("## "))
            {
                if (title is not null) yield return (title, servings, lines);
                var parts = raw[3..].Split('|');
                (title, servings, lines) = (parts[0].Trim(), parts.Length > 1 ? double.Parse(parts[1], CultureInfo.InvariantCulture) : 1, []);
            }
            else if (!raw.StartsWith('#')) lines.Add(raw);
        }
        if (title is not null) yield return (title, servings, lines);
    }
}
