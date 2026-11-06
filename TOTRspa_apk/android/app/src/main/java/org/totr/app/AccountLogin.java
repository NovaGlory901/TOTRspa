package org.totr.app;

import java.util.List;
import java.util.Locale;

/**
 * Signing in to a server from the app itself, with a sign-in the person saved (Vault). The page
 * never sees the password: the app posts to /api/auth/login the way a browser would (same JSON, no
 * Origin header, which the server's cross-site rule lets through) and hands the WebView only the
 * session cookie the server answers with. The pure parts live here so AccountLoginTest runs on a
 * PC; AccountStore does the network and the cookie jar.
 */
final class AccountLogin {
  private AccountLogin() {}

  static final String COOKIE = "totr_session";

  enum Result {
    OK,
    REFUSED,
    THROTTLED,
    UNREACHABLE
  }

  /**
   * What the server's answer means for the saved sign-in. Only a refusal says the password is
   * wrong; a busy or absent server must not use up the three tries.
   */
  static Result classify(int httpCode) {
    if (httpCode == 200) return Result.OK;
    if (httpCode == 401 || httpCode == 403 || httpCode == 422) return Result.REFUSED;
    if (httpCode == 429) return Result.THROTTLED;
    return Result.UNREACHABLE;
  }

  static String body(String username, String password) {
    return "{\"username\":"
        + JoinRequest.quote(username)
        + ",\"password\":"
        + JoinRequest.quote(password)
        + "}";
  }

  /**
   * The session cookie out of the Set-Cookie lines of a login answer, or null. Only the server's
   * own session cookie is taken (nothing else it might set), and a cookie that names another domain
   * is refused, so a server cannot plant a cookie for somewhere else. The text is handed to
   * CookieManager as it came (it knows the attributes).
   */
  static String sessionCookie(List<String> setCookieLines) {
    if (setCookieLines == null) return null;
    for (String line : setCookieLines) {
      if (line == null || line.length() > 2000) continue;
      String l = line.trim();
      if (!l.startsWith(COOKIE + "=")) continue; // cookie names are case-sensitive
      String value = l.substring(COOKIE.length() + 1);
      int end = value.indexOf(';');
      if (end < 0) end = value.length();
      if (end == 0) continue; // an empty value is a deleted cookie, not a session
      for (String part : l.split(";"))
        if (part.trim().toLowerCase(Locale.ROOT).startsWith("domain=")) return null;
      return l;
    }
    return null;
  }
}
