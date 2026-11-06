package org.totr.app;

import java.net.URI;
import java.util.Locale;
import java.util.regex.Pattern;

/**
 * An invite as it reaches the phone: the admin's invite link with the server's authority
 * fingerprint after a "#" (a browser never sends that part to the server):
 * https://friend.example:8443/invite/<token>#fp=1522-0d9c-dfd2-6c9d-87a4-6a0f also as
 * totr://friend.example:8443/invite/<token>#fp=... (what a link that opens the app uses), or just
 * an address with the fingerprint (https://friend.example:8443#fp=...) for someone who only has the
 * address. Pure Java so JoinLinkTest runs on a PC. Anything that is not exactly one of these shapes
 * is refused.
 */
final class JoinLink {
  final String origin; // https://host[:port], exact form
  final String token; // the one-time invite token, or "" when the link had none
  final String code; // the fingerprint, lower case, six groups of four

  private JoinLink(String origin, String token, String code) {
    this.origin = origin;
    this.token = token;
    this.code = code;
  }

  private static final Pattern TOKEN = Pattern.compile("[A-Za-z0-9_-]{16,128}");
  private static final Pattern CODE = Pattern.compile("(?:[0-9a-f]{4}-){5}[0-9a-f]{4}");

  /** The parsed link, or null. */
  static JoinLink parse(String link) {
    if (link == null) return null;
    String s = link.trim();
    if (s.length() > 400) return null;
    try {
      URI u = new URI(s);
      String scheme = u.getScheme() == null ? "" : u.getScheme().toLowerCase(Locale.ROOT);
      if (!scheme.equals("https") && !scheme.equals("totr")) return null;
      if (u.getRawUserInfo() != null
          || u.getRawQuery() != null
          || u.getHost() == null
          || u.getHost().isEmpty()
          || u.getPort() > 65535) return null;
      String frag = u.getRawFragment();
      if (frag == null || !frag.startsWith("fp=")) return null;
      String code = frag.substring(3).toLowerCase(Locale.ROOT);
      if (!CODE.matcher(code).matches()) return null;
      String path = u.getRawPath() == null ? "" : u.getRawPath(), token = "";
      if (path.startsWith("/invite/")) {
        token = path.substring("/invite/".length());
        if (!TOKEN.matcher(token).matches()) return null;
      } else if (!path.isEmpty() && !path.equals("/")) {
        return null;
      }
      String origin = AccessList.originOf("https://" + u.getRawAuthority());
      return origin == null ? null : new JoinLink(origin, token, code);
    } catch (Exception e) {
      return null;
    }
  }
}
