type QueryValue = string | string[] | undefined;

function firstValue(value: QueryValue) {
  return Array.isArray(value) ? value[0] : value;
}

export function authCallbackMessageFromParams(params: {
  auth?: QueryValue;
  message?: QueryValue;
}) {
  const authStatus = firstValue(params.auth);
  if (!authStatus) return "";
  if (authStatus === "confirmed") return "Email verified. Cloud sync is ready.";
  if (authStatus === "missing-code") {
    return "Verification link was missing its login code. Request a fresh email.";
  }
  return firstValue(params.message) || "Verification failed. Request a fresh email and try again.";
}
