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
    description: "Read your schedule in agents",
  },
} satisfies Record<string, AppDef>;

/** Base origin of the Enzo server that receives OAuth redirects. */
export const SERVER_ORIGIN = "http://localhost:1616";

/** Build the OAuth callback URL the user registers with the provider. */
export function appCallbackUrl(appId: string): string {
  return `${SERVER_ORIGIN}/api/apps/${appId}/callback`;
}
