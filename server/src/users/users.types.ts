export interface UserRow {
  id: string;
  username: string;
  display_name: string;
  password_hash: string;
  pin_hash: string | null;
  about: string | null;
  assistant_style: string | null;
  created_at: number;
}

/** A user as exposed to the client — never includes secrets. */
export interface PublicUser {
  id: string;
  username: string;
  displayName: string;
  about: string | null;
  assistantStyle: string | null;
  hasPin: boolean;
}

/** Minimal info for the login profile picker (shown before auth). */
export interface ProfileSummary {
  id: string;
  username: string;
  displayName: string;
  hasPin: boolean;
}

export interface CreateUserInput {
  username: string;
  password: string;
  displayName: string;
  about?: string;
  assistantStyle?: string;
  pin?: string;
}
