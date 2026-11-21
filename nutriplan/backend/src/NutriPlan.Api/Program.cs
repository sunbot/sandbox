using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Diagnostics;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using NutriPlan.Api;
using NutriPlan.Api.Endpoints;
using NutriPlan.Application;
using NutriPlan.Application.Common;
using NutriPlan.Infrastructure;
using NutriPlan.Infrastructure.Configuration;
using NutriPlan.Infrastructure.Persistence;
using NutriPlan.Infrastructure.Usda;

var builder = WebApplication.CreateBuilder(args);

// Paprika exports embed every recipe photo; a real library is easily past Kestrel's 30 MB default.
const long MaxUploadBytes = 300L * 1024 * 1024;
builder.WebHost.ConfigureKestrel(k => k.Limits.MaxRequestBodySize = MaxUploadBytes);
builder.Services.Configure<Microsoft.AspNetCore.Http.Features.FormOptions>(o => o.MultipartBodyLengthLimit = MaxUploadBytes);

// Local development: pick up DATABASE_URL etc. from .env.local / .env (e.g. written by `neon deploy`).
// Real environment variables, user-secrets and appsettings take precedence over these files.
builder.Configuration.AddDotEnvFiles();

// Hosts like Render/Railway/Fly pass the port to listen on in $PORT.
if (Environment.GetEnvironmentVariable("PORT") is { Length: > 0 } port)
    builder.WebHost.UseUrls($"http://0.0.0.0:{port}");

builder.Services.AddApplication();
builder.Services.AddInfrastructure(builder.Configuration);
builder.Services.AddProblemDetails();
builder.Services.AddSingleton<NutriPlan.Application.Common.IdempotencyStore>();
builder.Services.AddOpenApi();
builder.Services.ConfigureHttpJsonOptions(o =>
{
    o.SerializerOptions.Converters.Add(new JsonStringEnumConverter());
    o.SerializerOptions.Converters.Add(new NutrientProfileJsonConverter());
});
builder.Services.AddCors(o => o.AddDefaultPolicy(p => p.AllowAnyOrigin().AllowAnyHeader().AllowAnyMethod()));

// Routes that call external food databases: a bounded number per minute, so a runaway client can't exhaust the
// USDA key's hourly allowance (1,000 requests/hour) or get the key blocked.
builder.Services.AddRateLimiter(o =>
{
    o.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    o.AddFixedWindowLimiter("external-food", w => { w.PermitLimit = 60; w.Window = TimeSpan.FromMinutes(1); w.QueueLimit = 0; });
    o.OnRejected = async (ctx, ct) => await ctx.HttpContext.Response.WriteAsJsonAsync(new { title = "Too many searches in a short time. Wait a moment and try again.", reason = "RateLimited" }, ct);
});

var app = builder.Build();
app.Logger.LogInformation("Ask interpreter: {Mode}", app.Services.GetRequiredService<NutriPlan.Application.Abstractions.ILanguageInterpreter>().IsAvailable ? "Claude (with built-in rules as fallback)" : "built-in rules only (no Claude key configured)");

// ── CLI: `dotnet run -- import-usda <folder> [<folder> ...]` loads USDA CSV downloads, then exits. ──
if (args.Length > 0 && args[0] == "import-usda")
{
    using var scope = app.Services.CreateScope();
    await scope.ServiceProvider.GetRequiredService<NutriPlanDbContext>().Database.MigrateAsync();
    var importer = scope.ServiceProvider.GetRequiredService<UsdaImporter>();
    foreach (var folder in args.Skip(1))
    {
        var result = await importer.ImportAsync(folder);
        Console.WriteLine($"{result.Dataset}: read {result.Read}, imported {result.Imported}, skipped {result.Skipped}");
    }
    return;
}

// Apply database migrations on startup (single-user app; keeps setup to "run it").
using (var scope = app.Services.CreateScope())
    await scope.ServiceProvider.GetRequiredService<NutriPlanDbContext>().Database.MigrateAsync();

app.UseExceptionHandler(errorApp => errorApp.Run(async context =>
{
    var error = context.Features.Get<IExceptionHandlerFeature>()?.Error;
    var (status, title) = error switch
    {
        NotFoundException => (StatusCodes.Status404NotFound, "Not found"),
        NutriPlan.Application.Foods.ProviderUnavailableException => (StatusCodes.Status503ServiceUnavailable, "The food database didn't answer. Try again in a moment."),
        ValidationException or ArgumentException => (StatusCodes.Status400BadRequest, "Invalid request"),
        // The unique index that allows a planned meal to be logged only once.
        Microsoft.EntityFrameworkCore.DbUpdateException { InnerException: Npgsql.PostgresException { SqlState: "23505" } } =>
            (StatusCodes.Status409Conflict, "Already saved"),
        _ => (StatusCodes.Status500InternalServerError, "Something went wrong"),
    };
    context.Response.StatusCode = status;
    await Results.Problem(
        title: title,
        detail: status == StatusCodes.Status409Conflict ? "That meal is already logged." : status == 503 ? null : status == 500 && !app.Environment.IsDevelopment() ? null : error?.Message,
        statusCode: status).ExecuteAsync(context);
}));

app.UseCors();
app.UseMiddleware<ApiKeyMiddleware>();
app.UseRateLimiter();
if (app.Environment.IsDevelopment()) app.MapOpenApi();

app.MapGet("/health", () => Results.Ok(new { status = "ok" }));

// Serve the web build of the app (mobile/dist, copied to wwwroot in the Docker image) from the same origin.
// Any non-API path falls back to index.html so the app's own router handles it.
if (Directory.Exists(Path.Combine(app.Environment.ContentRootPath, "wwwroot")))
{
    app.UseDefaultFiles();
    app.UseStaticFiles();
    app.MapFallback("/api/{**rest}", () => Results.NotFound(new { title = "Unknown API route" }));
    app.MapFallbackToFile("index.html");
}
var api = app.MapGroup("/api");
api.MapFoodEndpoints();
api.MapDiaryEndpoints();
api.MapPlanEndpoints();
api.MapRecipeEndpoints();
api.MapPantryEndpoints();
api.MapInsightEndpoints();
api.MapAssistantEndpoints();

app.Run();

/// <summary>Exposed for WebApplicationFactory in integration tests.</summary>
public partial class Program;
