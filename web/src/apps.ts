/**
 * Connector app registry.
 *
 * Each app has a stable `id` that drives everything: its OAuth callback path
 * (`/api/apps/{id}/callback`), its API namespace, and how the backend dispatch
 * switch routes the callback. Add a new app here and the id flows through the UI.
 */
export interface AppDef {
  id: string;
  name: string;
  description: string;
}

export const APPS = {
  googleCalendar: {
    id: "google-calendar",
    name: "Google Calendar",
    description: "Read, create & update events from chat",
  },
  gmail: {
    id: "google-gmail",
    name: "Gmail",
    description: "Search & read your email from chat",
  },
} satisfies Record<string, AppDef>;

/**
 * Build the OAuth callback URL the user registers with the provider. Uses
 * the browser's actual origin rather than a hardcoded prod port, so the
 * instructions shown are correct in dev (5310) too — matching the backend's
 * own redirect_uri computation (calendar.controller.ts's getRedirectBase).
 */
export function appCallbackUrl(appId: string): string {
  return `${window.location.origin}/api/apps/${appId}/callback`;
}
