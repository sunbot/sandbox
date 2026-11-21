using Microsoft.Extensions.DependencyInjection;
using NutriPlan.Application.Assistant;
using NutriPlan.Application.Diary;
using NutriPlan.Application.Foods;
using NutriPlan.Application.Insights;
using NutriPlan.Application.Pantry;
using NutriPlan.Application.Planning;
using NutriPlan.Application.Recipes;

namespace NutriPlan.Application;

public static class DependencyInjection
{
    public static IServiceCollection AddApplication(this IServiceCollection services)
    {
        services.AddScoped<FoodService>();
        services.AddScoped<BrandedFoodService>();
        services.AddSingleton<RemoteSearchCache>();
        services.AddScoped<DiaryService>();
        services.AddScoped<PlanService>();
        services.AddScoped<GapFillService>();
        services.AddScoped<GroceryService>();
        services.AddScoped<TargetsService>();
        services.AddScoped<RecipeService>();
        services.AddScoped<PantryService>();
        services.AddScoped<InsightsService>();
        services.AddScoped<AssistantService>();
        return services;
    }
}
