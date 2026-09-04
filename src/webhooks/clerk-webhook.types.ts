/** Minimal shape of the Clerk `user.created` event payload we actually read. */
export interface ClerkEmailAddress {
  id: string;
  email_address: string;
}

export interface ClerkUserData {
  id: string;
  email_addresses: ClerkEmailAddress[];
  primary_email_address_id: string | null;
  first_name: string | null;
  last_name: string | null;
  public_metadata?: Record<string, unknown>;
  unsafe_metadata?: Record<string, unknown>;
}

export interface ClerkWebhookEvent {
  type: string;
  data: ClerkUserData;
}
