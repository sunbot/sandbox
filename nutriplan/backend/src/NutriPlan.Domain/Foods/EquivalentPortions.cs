using System.Text.RegularExpressions;
using NutriPlan.Domain.Units;

namespace NutriPlan.Domain.Foods;

/// <summary>
/// Which of a USDA SR Legacy food's measured portions can be used for a USDA Foundation food that has none.
/// Foundation foods are lab-analysed and often come with no household measures; many continue an SR Legacy food and carry
/// its NDB number (Foundation "Nuts, almonds, whole, raw" and SR Legacy "Nuts, almonds" are both NDB 12061). That shared
/// number is USDA's own link, but on its own it isn't proof the two are the same physical food (NDB 9504 links Honeycrisp
/// to Golden Delicious apples, 11266 raw portabella to grilled), so this also requires:
///   • every word of the SR name appears in the Foundation name, and the Foundation name adds only "raw", "whole",
///     "halves" or "kernels" — no other variety, state, cut, salt or brand;
///   • when the Foundation name adds a cut the SR name doesn't have ("whole", "halves"), a portion that names a cut must
///     name that one, and a plain cup or spoon isn't used (a cup of whole almonds isn't a cup of sliced ones).
/// Nothing is ever estimated: the borrowed portions are USDA's own measurements, with <see cref="FoodPortion.Origin"/>
/// saying where they came from.
/// </summary>
public static partial class EquivalentPortions
{
    /// <summary>Words a Foundation name may add to the SR name without describing a different food.</summary>
    private static readonly HashSet<string> NeutralExtras = ["raw", "whole", "halve", "halves", "half", "kernel"];

    /// <summary>Words that say how a food is cut or broken up.</summary>
    private static readonly HashSet<string> CutWords =
    [
        "whole", "halve", "halves", "half", "halved", "sliced", "slice", "slivered", "chopped", "diced", "ground", "crushed", "shredded",
        "grated", "minced", "piece", "cubed", "cube", "mashed", "pureed", "strip", "chunk", "flaked", "crumbled", "julienned", "quartered",
    ];

    /// <summary>Cuts that still leave the food in items you can count ("23 whole kernels", "19 halves").</summary>
    private static readonly HashSet<string> CountableCuts = ["whole", "halve", "halves", "half", "halved"];

    private static readonly HashSet<string> Ignored = ["and", "or", "of", "with", "the", "in", "for", "a", "an"];

    /// <summary>
    /// The donor's portions that apply to the target, each marked with <paramref name="origin"/>; empty when the foods
    /// can't be shown to be the same physical food. The caller must already know the two share a USDA NDB number.
    /// </summary>
    public static IReadOnlyList<FoodPortion> Borrowable(string targetName, string donorName, IEnumerable<FoodPortion> donorPortions, string origin)
    {
        if (!SameFood(targetName, donorName)) return [];
        // A cut the SR food itself is named for ("Tomatoes, crushed") is already what all of its portions measure.
        var targetCuts = Tokens(targetName).Where(CutWords.Contains).Except(Tokens(donorName)).ToHashSet();
        var onlyCountableCuts = targetCuts.All(CountableCuts.Contains);
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var result = new List<FoodPortion>();
        foreach (var p in donorPortions)
        {
            if (p.GramWeight <= 0 || !seen.Add(p.Description)) continue;
            var cuts = Tokens(p.Description, keepParentheses: true).Where(CutWords.Contains).ToHashSet();
            var isVolume = QuantityResolver.LeadingVolumeUnit(p.Description) is not null;
            var fits = targetCuts.Count == 0
                || (cuts.Count > 0 ? cuts.IsSubsetOf(targetCuts) : !isVolume && onlyCountableCuts);
            if (fits) result.Add(p with { Origin = origin });
        }
        return result;
    }

    /// <summary>Every word of the donor's name is in the target's, and the target adds only neutral words.</summary>
    public static bool SameFood(string targetName, string donorName)
    {
        var target = Tokens(targetName).ToHashSet();
        var donor = Tokens(donorName).ToHashSet();
        return donor.Count > 0 && donor.IsSubsetOf(target) && target.Except(donor).All(NeutralExtras.Contains);
    }

    private static IEnumerable<string> Tokens(string text, bool keepParentheses = false)
    {
        var t = (keepParentheses ? text : Paren().Replace(text, " ")).ToLowerInvariant();
        // Numbers count too: "90% lean / 10% fat" isn't "80% lean / 20% fat".
        return WordSplit().Split(t).Where(w => w.Length > 0 && !Ignored.Contains(w)).Select(Singular);
    }

    private static string Singular(string w) =>
        w is "halves" ? "halve" :
        w.EndsWith("ies") && w.Length > 4 ? w[..^3] + "y" :
        w.EndsWith("ches") || w.EndsWith("shes") ? w[..^2] :
        w.EndsWith('s') && !w.EndsWith("ss") && w.Length > 3 ? w[..^1] : w;

    [GeneratedRegex(@"\([^)]*\)")] private static partial Regex Paren();
    [GeneratedRegex(@"[^a-z0-9]+")] private static partial Regex WordSplit();
}
