export type UserRole = "admin" | "user";

export interface UserRow {
  id: string;
  username: string;
  display_name: string;
  first_name: string | null;
  last_name: string | null;
  nickname: string | null;
  super_powers: string | null;
  password_hash: string;
  pin_hash: string | null;
  about: string | null;
  assistant_style: string | null;
  role: UserRole;
  created_at: number;
}

export interface PublicUser {
  id: string;
  username: string;
  displayName: string;
  firstName: string | null;
  lastName: string | null;
  nickname: string | null;
  superPowers: string | null;
  about: string | null;
  assistantStyle: string | null;
  hasPin: boolean;
  role: UserRole;
  isAdmin: boolean;
}

export interface ProfileSummary {
  id: string;
  username: string;
  displayName: string;
  hasPin: boolean;
  role: UserRole;
}

export interface CreateUserInput {
  username: string;
  password: string;
  displayName: string;
  firstName?: string;
  lastName?: string;
  nickname?: string;
  superPowers?: string;
  about?: string;
  assistantStyle?: string;
  pin?: string;
}
