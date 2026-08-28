/** Isolate admin login from the chat `neo_session` cookie on the same host. */
if (!process.env.SESSION_COOKIE_NAME?.trim()) {
  process.env.SESSION_COOKIE_NAME = "neo_admin_session";
}
