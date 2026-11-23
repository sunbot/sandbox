using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Protocols;
using Microsoft.IdentityModel.Protocols.OpenIdConnect;
using Microsoft.IdentityModel.Tokens;
using Npgsql;

namespace NutriPlan.Api.Tests;

/// <summary>Runs only when NUTRIPLAN_TEST_DB is set to a Postgres connection string with CREATEDB rights.</summary>
public sealed class PostgresFactAttribute : FactAttribute
{
    public PostgresFactAttribute()
    {
        if (string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable("NUTRIPLAN_TEST_DB")))
            Skip = "Set NUTRIPLAN_TEST_DB to run API tests against Postgres.";
    }
}

/// <summary>
/// The real API, signing in with tokens minted here by a locally generated RSA key that stands in for Google's Firebase
/// keys. No network and no real Google credentials: the API is given this key instead of fetching Google's.
/// </summary>
public sealed class ApiFixture : IAsyncLifetime
{
    public const string ProjectId = "intake-grid-test";
    public const string OwnerSubject = "owner-firebase-uid";
    public static string Issuer => $"https://securetoken.google.com/{ProjectId}";

    public RsaSecurityKey Key { get; } = new(RSA.Create(2048)) { KeyId = "test-key" };
    public RsaSecurityKey OtherKey { get; } = new(RSA.Create(2048)) { KeyId = "test-key" };
    public WebApplicationFactory<Program>? Factory { get; private set; }
    private string _database = "";
    private string _baseCs = "";

    public async Task InitializeAsync()
    {
        _baseCs = Environment.GetEnvironmentVariable("NUTRIPLAN_TEST_DB") ?? "";
        if (_baseCs.Length == 0) return;
        _database = $"nutriplan_api_test_{Guid.NewGuid():N}";
        await using (var conn = new NpgsqlConnection(_baseCs))
        {
            await conn.OpenAsync();
            await new NpgsqlCommand($"CREATE DATABASE {_database}", conn).ExecuteNonQueryAsync();
        }
        var cs = new NpgsqlConnectionStringBuilder(_baseCs) { Database = _database }.ConnectionString;
        // Real environment variables beat any local .env file, so the tests can never reach a real database.
        Environment.SetEnvironmentVariable("DATABASE_URL_UNPOOLED", cs);
        Environment.SetEnvironmentVariable("Auth__FirebaseProjectId", ProjectId);
        Environment.SetEnvironmentVariable("Auth__OwnerSubject", OwnerSubject);

        var config = new OpenIdConnectConfiguration { Issuer = Issuer };
        config.SigningKeys.Add(Key);
        Factory = new WebApplicationFactory<Program>().WithWebHostBuilder(b =>
        {
            b.UseEnvironment("Testing");
            b.ConfigureTestServices(s => s.PostConfigure<JwtBearerOptions>(JwtBearerDefaults.AuthenticationScheme, o =>
            {
                o.ConfigurationManager = new StaticConfigurationManager<OpenIdConnectConfiguration>(config);
            }));
        });
        _ = Factory.Server; // start (and migrate) now
    }

    public async Task DisposeAsync()
    {
        if (Factory is not null) await Factory.DisposeAsync();
        if (_database.Length == 0) return;
        NpgsqlConnection.ClearAllPools();
        await using var conn = new NpgsqlConnection(_baseCs);
        await conn.OpenAsync();
        await new NpgsqlCommand($"DROP DATABASE IF EXISTS {_database} WITH (FORCE)", conn).ExecuteNonQueryAsync();
    }

    public string Token(string sub, string? email = null, bool emailVerified = true, string provider = "google.com",
        string? issuer = null, string? audience = null, TimeSpan? expiresIn = null, SecurityKey? key = null)
    {
        var now = DateTime.UtcNow;
        var expires = now + (expiresIn ?? TimeSpan.FromMinutes(30));
        var claims = new Dictionary<string, object>
        {
            ["sub"] = sub,
            ["name"] = sub,
            ["firebase"] = new Dictionary<string, object> { ["sign_in_provider"] = provider },
        };
        if (email is not null) { claims["email"] = email; claims["email_verified"] = emailVerified; }
        return new JsonWebTokenHandler().CreateToken(new SecurityTokenDescriptor
        {
            Issuer = issuer ?? Issuer,
            Audience = audience ?? ProjectId,
            IssuedAt = expires.AddHours(-1),
            NotBefore = expires.AddHours(-1),
            Expires = expires,
            Claims = claims,
            SigningCredentials = new SigningCredentials(key ?? Key, SecurityAlgorithms.RsaSha256),
        });
    }

    public HttpClient Client(string? token)
    {
        var c = Factory!.CreateClient();
        if (token is not null) c.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return c;
    }
}

public sealed class AuthAndIsolationTests(ApiFixture api) : IClassFixture<ApiFixture>
{
    private static readonly DateOnly Day = new(2026, 11, 20);

    private HttpClient Owner() => api.Client(api.Token(ApiFixture.OwnerSubject, "owner@example.com"));

    /// <summary>The owner invites a fresh address; that Google account then signs in as a new member.</summary>
    private async Task<HttpClient> NewMember()
    {
        var id = Guid.NewGuid().ToString("N")[..10];
        var email = $"member-{id}@example.com";
        (await Owner().PostAsJsonAsync("/api/account/invitations", new { email })).EnsureSuccessStatusCode();
        var member = api.Client(api.Token($"uid-{id}", email.ToUpperInvariant()));
        var session = await member.GetFromJsonAsync<JsonObject>("/api/account/session");
        Assert.Equal("Active", (string?)session!["state"]);
        return member;
    }

    private static async Task<JsonObject> Json(HttpResponseMessage r)
    {
        Assert.True(r.IsSuccessStatusCode, $"{(int)r.StatusCode}: {await r.Content.ReadAsStringAsync()}");
        return (await r.Content.ReadFromJsonAsync<JsonObject>())!;
    }

    private static async Task<string?> Reason(HttpResponseMessage r) => (string?)(await r.Content.ReadFromJsonAsync<JsonObject>())?["reason"];

    // ── Authentication ───────────────────────────────────────────────────────────────────────────────

    [PostgresFact]
    public async Task Health_is_public_but_every_api_route_needs_a_token()
    {
        var anon = api.Client(null);
        Assert.Equal(HttpStatusCode.OK, (await anon.GetAsync("/health")).StatusCode);
        foreach (var path in new[] { "/api/diary/2026-11-20", "/api/recipes", "/api/pantry", "/api/targets", "/api/status", "/api/account/session", "/api/account/users" })
        {
            var r = await anon.GetAsync(path);
            Assert.Equal(HttpStatusCode.Unauthorized, r.StatusCode);
            Assert.Equal("SignInRequired", await Reason(r));
        }
    }

    [PostgresFact]
    public async Task Bad_tokens_are_rejected()
    {
        var bad = new[]
        {
            api.Token(ApiFixture.OwnerSubject, key: api.OtherKey),                      // signed by someone else
            api.Token(ApiFixture.OwnerSubject, issuer: "https://securetoken.google.com/other-project"),
            api.Token(ApiFixture.OwnerSubject, audience: "other-project"),
            api.Token(ApiFixture.OwnerSubject, provider: "anonymous"),                 // not a Google sign-in
            "not-a-jwt",
            UnsignedToken(),
        };
        foreach (var token in bad)
            Assert.Equal(HttpStatusCode.Unauthorized, (await api.Client(token).GetAsync("/api/targets")).StatusCode);

        var expired = await api.Client(api.Token(ApiFixture.OwnerSubject, expiresIn: TimeSpan.FromMinutes(-10))).GetAsync("/api/targets");
        Assert.Equal(HttpStatusCode.Unauthorized, expired.StatusCode);
        Assert.Equal("SessionExpired", await Reason(expired));
    }

    private static string UnsignedToken()
    {
        static string B64(string s) => Base64UrlEncoder.Encode(s);
        var exp = DateTimeOffset.UtcNow.AddMinutes(30).ToUnixTimeSeconds();
        return $"{B64("{\"alg\":\"none\",\"typ\":\"JWT\"}")}.{B64($"{{\"sub\":\"{ApiFixture.OwnerSubject}\",\"iss\":\"{ApiFixture.Issuer}\",\"aud\":\"{ApiFixture.ProjectId}\",\"exp\":{exp},\"firebase\":{{\"sign_in_provider\":\"google.com\"}}}}")}.";
    }

    [PostgresFact]
    public async Task A_valid_token_without_an_invitation_gets_no_access_and_cannot_claim_existing_data()
    {
        var stranger = api.Client(api.Token("stranger-uid", "stranger@example.com"));
        var r = await stranger.GetAsync("/api/targets");
        Assert.Equal(HttpStatusCode.Forbidden, r.StatusCode);
        Assert.Equal("NotInvited", await Reason(r));

        var session = await Json(await stranger.GetAsync("/api/account/session"));
        Assert.Equal("NotInvited", (string?)session["state"]);
        Assert.Equal("stranger-uid", (string?)session["subject"]);
        Assert.Null(session["user"]);
    }

    [PostgresFact]
    public async Task A_member_cannot_nest_see_or_learn_about_another_members_recipe()
    {
        var a = await NewMember();
        var b = await NewMember();
        var sauce = await Json(await a.PostAsJsonAsync("/api/recipes", new { name = "A's sauce", servings = 2, ingredients = new[] { "1 cup tomatoes" } }));
        var sauceId = (string)sauce["summary"]!["id"]!;
        var bowl = await Json(await b.PostAsJsonAsync("/api/recipes", new { name = "B's bowl", servings = 1, ingredients = new[] { "1 serving sauce" } }));
        var bowlId = (string)bowl["summary"]!["id"]!;

        // B can't use A's recipe as an ingredient: to B it doesn't exist (404, not 403, so nothing leaks).
        var nest = await b.PutAsJsonAsync($"/api/recipes/{bowlId}/ingredients/0", new { recipeId = sauceId, servings = 1 });
        Assert.Equal(HttpStatusCode.NotFound, nest.StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await b.GetAsync($"/api/recipes/{sauceId}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await b.PostAsJsonAsync("/api/diary/recipe", new { date = Day, meal = "Lunch", recipeId = sauceId, servings = 1 })).StatusCode);

        // A nests their own recipe; B's recipe list and A's "Used in" stay separate.
        var aBowl = await Json(await a.PostAsJsonAsync("/api/recipes", new { name = "A's bowl", servings = 1, ingredients = new[] { "1 serving sauce" } }));
        var aBowlId = (string)aBowl["summary"]!["id"]!;
        var nested = await Json(await a.PutAsJsonAsync($"/api/recipes/{aBowlId}/ingredients/0", new { recipeId = sauceId, servings = 1 }));
        Assert.Equal(sauceId, (string?)nested["ingredients"]![0]!["recipeId"]);
        var usedIn = (await Json(await a.GetAsync($"/api/recipes/{sauceId}")))["usedIn"]!.AsArray();
        Assert.Equal(["A's bowl"], usedIn.Select(u => (string)u!["name"]!));
        var bList = await b.GetFromJsonAsync<JsonArray>("/api/recipes");
        Assert.DoesNotContain(bList!, r => (string?)r!["id"] == sauceId || (string?)r!["id"] == aBowlId);
        // And B can't delete A's sauce (404), while A is told it's in use.
        Assert.Equal(HttpStatusCode.NotFound, (await b.DeleteAsync($"/api/recipes/{sauceId}")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await a.DeleteAsync($"/api/recipes/{sauceId}")).StatusCode);
    }

    [PostgresFact]
    public async Task Grocery_removals_belong_to_one_member_and_another_cannot_restore_or_see_them()
    {
        var a = await NewMember();
        var b = await NewMember();
        var recipe = await Json(await a.PostAsJsonAsync("/api/recipes", new { name = "A's stew", servings = 1, ingredients = new[] { "1 cup mystery stock" } }));
        (await a.PostAsJsonAsync("/api/plan/recipe", new { date = Day, meal = "Dinner", recipeId = (string)recipe["summary"]!["id"]!, servings = 1 })).EnsureSuccessStatusCode();
        var list = await Json(await a.GetAsync($"/api/plan/grocery?from={Day:yyyy-MM-dd}&to={Day:yyyy-MM-dd}"));
        var item = list["aisles"]!.AsArray().SelectMany(x => x!["items"]!.AsArray()).First()!;
        var key = (string)item["key"]!;

        Assert.Equal(HttpStatusCode.NoContent, (await a.PostAsJsonAsync("/api/plan/grocery/exclusions", new { key, name = (string)item["name"]! })).StatusCode);
        // B restoring "all" only touches B's own removals; B never sees A's.
        Assert.Equal(HttpStatusCode.NoContent, (await b.DeleteAsync("/api/plan/grocery/exclusions")).StatusCode);
        var bList = await Json(await b.GetAsync($"/api/plan/grocery?from={Day:yyyy-MM-dd}&to={Day:yyyy-MM-dd}"));
        Assert.Empty(bList["hiddenItems"]!.AsArray());
        Assert.Equal(0, (int)bList["itemCount"]!);

        var after = await Json(await a.GetAsync($"/api/plan/grocery?from={Day:yyyy-MM-dd}&to={Day:yyyy-MM-dd}"));
        Assert.Equal(key, (string?)after["hiddenItems"]!.AsArray().Single()!["key"]);
        Assert.DoesNotContain(after["aisles"]!.AsArray().SelectMany(x => x!["items"]!.AsArray()), i => (string?)i!["key"] == key);
        // Hiding the same key twice is harmless; a bad key is refused.
        Assert.Equal(HttpStatusCode.NoContent, (await a.PostAsJsonAsync("/api/plan/grocery/exclusions", new { key, name = "again" })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await a.PostAsJsonAsync("/api/plan/grocery/exclusions", new { key = "nonsense", name = "x" })).StatusCode);
    }

    [PostgresFact]
    public async Task The_configured_owner_claims_the_existing_data_and_can_administer()
    {
        var session = await Json(await Owner().GetAsync("/api/account/session"));
        Assert.Equal("Active", (string?)session["state"]);
        Assert.Equal("Owner", (string?)session["user"]!["role"]);
        Assert.Equal("00000000-0000-4000-8000-0000000000a1", (string?)session["user"]!["id"]); // the migrated data's owner
        Assert.Equal(HttpStatusCode.OK, (await Owner().GetAsync("/api/account/users")).StatusCode);
    }

    [PostgresFact]
    public async Task An_unverified_email_cannot_use_an_invitation()
    {
        (await Owner().PostAsJsonAsync("/api/account/invitations", new { email = "unverified@example.com" })).EnsureSuccessStatusCode();
        var r = await api.Client(api.Token("unverified-uid", "unverified@example.com", emailVerified: false)).GetAsync("/api/targets");
        Assert.Equal(HttpStatusCode.Forbidden, r.StatusCode);
        Assert.Equal("EmailNotVerified", await Reason(r));
    }

    [PostgresFact]
    public async Task Members_cannot_administer_and_a_revoked_member_loses_access()
    {
        var member = await NewMember();
        var r = await member.PostAsJsonAsync("/api/account/invitations", new { email = "friend@example.com" });
        Assert.Equal(HttpStatusCode.Forbidden, r.StatusCode);
        Assert.Equal("OwnerOnly", await Reason(r));
        Assert.Equal(HttpStatusCode.Forbidden, (await member.GetAsync("/api/account/users")).StatusCode);

        var me = await Json(await member.GetAsync("/api/account/session"));
        var id = (string)me["user"]!["id"]!;
        (await Owner().PostAsJsonAsync($"/api/account/users/{id}/active", new { active = false })).EnsureSuccessStatusCode();
        var after = await member.GetAsync("/api/targets");
        Assert.Equal(HttpStatusCode.Forbidden, after.StatusCode);
        Assert.Equal("Revoked", await Reason(after));
    }

    [PostgresFact]
    public async Task A_revoked_invitation_cannot_be_used()
    {
        var invite = await Json(await Owner().PostAsJsonAsync("/api/account/invitations", new { email = "revoked-invite@example.com" }));
        (await Owner().DeleteAsync($"/api/account/invitations/{invite["id"]}")).EnsureSuccessStatusCode();
        var r = await api.Client(api.Token("revoked-invite-uid", "revoked-invite@example.com")).GetAsync("/api/targets");
        Assert.Equal("NotInvited", await Reason(r));
    }

    // ── Isolation between two users ───────────────────────────────────────────────────────────────────

    [PostgresFact]
    public async Task Clear_meal_requires_auth_and_rejects_mixed_owners_without_partial_deletion()
    {
        var a = await NewMember();
        var b = await NewMember();
        var aEntry = await Json(await a.PostAsJsonAsync("/api/diary/quick", new { date = Day, meal = "Breakfast", name = "A breakfast", calories = 100 }));
        var bEntry = await Json(await b.PostAsJsonAsync("/api/diary/quick", new { date = Day, meal = "Breakfast", name = "B breakfast", calories = 200 }));
        var request = new { date = Day, meal = "Breakfast", entryIds = new[] { (string)bEntry["id"]!, (string)aEntry["id"]! } };

        Assert.Equal(HttpStatusCode.Unauthorized, (await api.Client(null).PostAsJsonAsync("/api/diary/clear-meal", request)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await b.PostAsJsonAsync("/api/diary/clear-meal", request)).StatusCode);
        Assert.Contains("A breakfast", await a.GetStringAsync($"/api/diary/{Day:yyyy-MM-dd}"));
        Assert.Contains("B breakfast", await b.GetStringAsync($"/api/diary/{Day:yyyy-MM-dd}"));
        Assert.Equal(HttpStatusCode.NoContent, (await b.PostAsJsonAsync("/api/diary/clear-meal", new { date = Day, meal = "Breakfast", entryIds = new[] { (string)bEntry["id"]! } })).StatusCode);
        Assert.Contains("A breakfast", await a.GetStringAsync($"/api/diary/{Day:yyyy-MM-dd}"));
        Assert.DoesNotContain("B breakfast", await b.GetStringAsync($"/api/diary/{Day:yyyy-MM-dd}"));
    }

    [PostgresFact]
    public async Task One_user_cannot_see_or_change_another_users_data()
    {
        var a = await NewMember();
        var b = await NewMember();

        // A's private label food, diary entry, plan entry, pantry item, recipe and targets.
        var food = await Json(await a.PostAsJsonAsync("/api/foods", new
        {
            name = "Zqxv private granola", brand = (string?)null, barcode = "0099887766554", servingGrams = 50.0, servingDescription = "1 bowl",
            nutrientsPerServing = new Dictionary<string, double> { ["1008"] = 200, ["1003"] = 6 },
        }));
        var foodId = (string)food["id"]!;
        var entry = await Json(await a.PostAsJsonAsync("/api/diary/food", new { date = Day, meal = "Breakfast", foodId, grams = 50.0 }));
        var plan = await Json(await a.PostAsJsonAsync("/api/plan/food", new { date = Day.AddDays(1), meal = "Lunch", foodId, grams = 50.0 }));
        var pantry = await Json(await a.PostAsJsonAsync("/api/pantry", new { name = "A's oats", foodId, grams = 500.0 }));
        var recipe = await Json(await a.PostAsJsonAsync("/api/recipes", new { name = "A's secret porridge", servings = 2.0, ingredients = new[] { "50 g oats" } }));
        var recipeId = (string)recipe["summary"]!["id"]!;
        (await a.PutAsJsonAsync("/api/targets", new { calories = 1777.0 })).EnsureSuccessStatusCode();

        // B sees none of it.
        var day = await Json(await b.GetAsync($"/api/diary/{Day:yyyy-MM-dd}"));
        Assert.DoesNotContain("Zqxv", day.ToJsonString());
        Assert.DoesNotContain("Zqxv", await b.GetStringAsync("/api/foods/search?q=Zqxv%20granola"));
        Assert.DoesNotContain("Zqxv", await b.GetStringAsync("/api/diary/quick-log"));
        Assert.DoesNotContain("A's oats", await b.GetStringAsync("/api/pantry"));
        Assert.DoesNotContain("secret porridge", await b.GetStringAsync("/api/recipes"));
        Assert.DoesNotContain("Zqxv", await b.GetStringAsync($"/api/plan/week?date={Day:yyyy-MM-dd}"));
        Assert.NotEqual(1777.0, (double)(await Json(await b.GetAsync("/api/targets")))["calories"]!);
        Assert.Equal(1777.0, (double)(await Json(await a.GetAsync("/api/targets")))["calories"]!);

        // Direct-ID attacks: reads, writes and deletes of A's ids all answer "not found" and change nothing.
        Assert.Equal(HttpStatusCode.NotFound, (await b.GetAsync($"/api/foods/{foodId}/quantity?amount=1")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await b.PostAsJsonAsync("/api/diary/food", new { date = Day, meal = "Lunch", foodId, grams = 10.0 })).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await b.PostAsync($"/api/foods/{foodId}/verify", null)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await b.PatchAsJsonAsync($"/api/diary/{entry["id"]}", new { scale = 3.0 })).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await b.DeleteAsync($"/api/diary/{entry["id"]}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await b.PostAsJsonAsync($"/api/diary/{entry["id"]}/relog", new { date = Day })).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await b.DeleteAsync($"/api/plan/{plan["id"]}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await b.PostAsJsonAsync($"/api/plan/{plan["id"]}/eaten", new { scale = 1.0 })).StatusCode);
        // Attaching a log to A's planned meal would take its "logged once" slot and block A: refused.
        var bFood = await Json(await b.PostAsJsonAsync("/api/foods", new
        {
            name = "B's yogurt", brand = (string?)null, barcode = (string?)null, servingGrams = 100.0, servingDescription = "1 cup",
            nutrientsPerServing = new Dictionary<string, double> { ["1008"] = 90 },
        }));
        Assert.Equal(HttpStatusCode.NotFound, (await b.PostAsJsonAsync("/api/diary/food", new { date = Day, meal = "Lunch", foodId = (string)bFood["id"]!, grams = 100.0, planEntryId = (string)plan["id"]! })).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await b.PutAsJsonAsync($"/api/pantry/{pantry["id"]}", new { name = "stolen" })).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await b.DeleteAsync($"/api/pantry/{pantry["id"]}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await b.GetAsync($"/api/recipes/{recipeId}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await b.GetAsync($"/api/recipes/{recipeId}/photo")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await b.PostAsJsonAsync($"/api/recipes/{recipeId}/favorite", new { favorite = true })).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await b.DeleteAsync($"/api/recipes/{recipeId}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await b.PostAsJsonAsync("/api/diary/recipe", new { date = Day, meal = "Dinner", recipeId, servings = 1.0 })).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await b.PostAsJsonAsync("/api/plan/recipe", new { date = Day, meal = "Dinner", recipeId, servings = 1.0 })).StatusCode);

        // A's data is untouched.
        var aDay = (await Json(await a.GetAsync($"/api/diary/{Day:yyyy-MM-dd}"))).ToJsonString();
        Assert.Contains("Zqxv", aDay);
        Assert.Contains("A's oats", await a.GetStringAsync("/api/pantry"));
        Assert.Contains("secret porridge", await a.GetStringAsync("/api/recipes"));
        Assert.Equal(HttpStatusCode.OK, (await a.GetAsync($"/api/recipes/{recipeId}")).StatusCode);

        // A can still log the planned meal.
        Assert.Equal(HttpStatusCode.OK, (await a.PostAsJsonAsync($"/api/plan/{plan["id"]}/eaten", new { scale = 1.0 })).StatusCode);
        Assert.DoesNotContain("B's yogurt", await a.GetStringAsync("/api/foods/search?q=yogurt"));

        // A's own frequent foods and times-logged count only A's history.
        Assert.Contains("Zqxv", await a.GetStringAsync("/api/diary/quick-log"));
    }

    [PostgresFact]
    public async Task Fill_the_gaps_only_uses_the_callers_own_pantry_foods_and_history()
    {
        var a = await NewMember();
        var b = await NewMember();
        var food = await Json(await a.PostAsJsonAsync("/api/foods", new
        {
            name = "Zqxv pantry yogurt", brand = (string?)null, barcode = (string?)null, servingGrams = 170.0, servingDescription = "1 container",
            nutrientsPerServing = new Dictionary<string, double> { ["1008"] = 100, ["1003"] = 17 },
        }));
        (await a.PostAsJsonAsync("/api/pantry", new { name = "Zqxv pantry yogurt", foodId = (string)food["id"]!, grams = 340.0 })).EnsureSuccessStatusCode();
        (await a.PostAsJsonAsync("/api/diary/food", new { date = Day.AddDays(-1), meal = "Snack", foodId = (string)food["id"]!, grams = 170.0 })).EnsureSuccessStatusCode();

        // A's own pantry feeds A's Pantry mode; the endpoint accepts the mode and meal.
        var mine = await Json(await a.GetAsync($"/api/plan/gaps?date={Day:yyyy-MM-dd}&mode=Pantry&meal=Snack"));
        Assert.Equal("Pantry", (string?)mine["mode"]);
        foreach (var item in mine["suggestions"]!.AsArray().SelectMany(s => s!["items"]!.AsArray()))
            Assert.StartsWith("Zqxv", (string)item!["name"]!);

        // B never sees any of it: not in suggestions, not in swaps or ideas, not in any mode.
        foreach (var mode in new[] { "BestMatch", "Pantry", "QuickSnack", "Meal", "SavedRecipes" })
        {
            var theirs = await Json(await b.GetAsync($"/api/plan/gaps?date={Day:yyyy-MM-dd}&mode={mode}"));
            Assert.DoesNotContain("Zqxv", theirs.ToJsonString());
        }
    }

    [PostgresFact]
    public async Task Amount_edits_and_food_measures_are_scoped_to_the_signed_in_user()
    {
        var a = await NewMember();
        var b = await NewMember();
        var food = await Json(await a.PostAsJsonAsync("/api/foods", new
        {
            name = "Qwzx private bar", brand = (string?)null, barcode = (string?)null, servingGrams = 40.0, servingDescription = "1 bar",
            nutrientsPerServing = new Dictionary<string, double> { ["1008"] = 180, ["1003"] = 10 },
        }));
        var foodId = (string)food["id"]!;
        var entry = await Json(await a.PostAsJsonAsync("/api/diary/food", new { date = Day, meal = "Snack", foodId, grams = 40.0 }));
        var plan = await Json(await a.PostAsJsonAsync("/api/plan/food", new { date = Day.AddDays(1), meal = "Snack", foodId, grams = 40.0 }));

        // The owner sees the food's measures and can change an amount in them.
        var mine = await Json(await a.GetAsync($"/api/foods/{foodId}"));
        Assert.Contains(mine["measures"]!.AsArray(), m => (string?)m!["unit"] == "g");
        var changed = await Json(await a.PatchAsJsonAsync($"/api/diary/{entry["id"]}", new { amount = 1.5, unit = "oz" }));
        Assert.Equal("oz", (string?)changed["item"]!["unit"]);

        // Another user can neither read the food nor change the entry or the planned item.
        Assert.Equal(HttpStatusCode.NotFound, (await b.GetAsync($"/api/foods/{foodId}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await b.PatchAsJsonAsync($"/api/diary/{entry["id"]}", new { amount = 99.0, unit = "g" })).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await b.PostAsJsonAsync($"/api/plan/{plan["id"]}/amount", new { amount = 99.0, unit = "g" })).StatusCode);
        var still = (await Json(await a.GetAsync($"/api/diary/{Day:yyyy-MM-dd}"))).ToJsonString();
        Assert.Contains("\"unit\":\"oz\"", still);
    }

    [PostgresFact]
    public async Task A_new_member_starts_with_default_targets_not_the_owners()
    {
        (await Owner().PutAsJsonAsync("/api/targets", new { calories = 1666.0 })).EnsureSuccessStatusCode();
        var member = await NewMember();
        Assert.NotEqual(1666.0, (double)(await Json(await member.GetAsync("/api/targets")))["calories"]!);
    }
}
