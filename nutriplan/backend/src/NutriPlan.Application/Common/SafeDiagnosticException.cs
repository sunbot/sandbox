namespace NutriPlan.Application.Common;

/// <summary>
/// An exception whose message is written to be shown to the user (for example "Anthropic returned 400: credit balance is
/// too low"). Never put secrets, keys or request bodies in it. Any other exception is reported by type name only.
/// </summary>
public class SafeDiagnosticException(string message, Exception? inner = null) : Exception(message, inner);
