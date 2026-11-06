package org.totr.app;

import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * "TOTR servers near you": the rules for what an announcement on the network may turn into, the
 * phone's version of the desktop app's discover.cjs (the server side is TOTRsrv/discovery.py,
 * service _totr._tcp). Everything that arrives is a packet from anyone on the network, so it is
 * treated as hostile: only the shape we asked for is read, sizes and counts are capped, text is
 * cleaned, and an announcement is ignored unless it points at a private or link-local address (this
 * is a LAN feature). The list is only a convenience: choosing a server still goes through the usual
 * trust check (Pins), and the fingerprint in an announcement is shown to compare, never trusted by
 * itself. Pure Java (no Android classes) so DiscoverTest runs on a PC; NearScan is the thin
 * NsdManager layer around it.
 */
final class Discover {
  private Discover() {}

  static final int MAX_SERVERS = 50, MAX_TXT = 600;
  private static final Pattern FP = Pattern.compile("[0-9a-f]{4}(-[0-9a-f]{4}){5}");
  private static final Pattern V4 =
      Pattern.compile("(\\d{1,3})\\.(\\d{1,3})\\.(\\d{1,3})\\.(\\d{1,3})");

  /** One usable server as the page sees it. */
  static final class Found {
    final String name, origin, address, fingerprint, instance;

    Found(String name, String origin, String address, String fingerprint, String instance) {
      this.name = name;
      this.origin = origin;
      this.address = address;
      this.fingerprint = fingerprint;
      this.instance = instance;
    }
  }

  /**
   * 10/8, 172.16/12, 192.168/16, 169.254/16 and 100.64/10 (the range VPNs such as Tailscale use).
   * IPv4 only; anything else is not a local address for our purposes.
   */
  static boolean isLocalV4(String ip) {
    if (ip == null) return false;
    java.util.regex.Matcher m = V4.matcher(ip);
    if (!m.matches()) return false;
    int[] p = new int[4];
    for (int i = 0; i < 4; i++) {
      p[i] = Integer.parseInt(m.group(i + 1));
      if (p[i] > 255) return false;
    }
    return p[0] == 10
        || (p[0] == 172 && p[1] >= 16 && p[1] <= 31)
        || (p[0] == 192 && p[1] == 168)
        || (p[0] == 169 && p[1] == 254)
        || (p[0] == 100 && p[1] >= 64 && p[1] <= 127);
  }

  /**
   * Printable text only: control, format, private-use and unpaired-surrogate characters become
   * spaces, runs of white space become one, cut to `max` characters.
   */
  static String clean(String v, int max) {
    if (v == null) return "";
    StringBuilder sb = new StringBuilder();
    for (int i = 0; i < v.length(); i++) {
      char c = v.charAt(i);
      int t = Character.getType(c);
      boolean bad =
          t == Character.CONTROL
              || t == Character.FORMAT
              || t == Character.PRIVATE_USE
              || t == Character.SURROGATE
              || t == Character.UNASSIGNED;
      sb.append(bad ? ' ' : c);
    }
    String s = sb.toString().replaceAll("\\s+", " ").trim();
    return s.length() > max ? s.substring(0, max).trim() : s;
  }

  /** A port number 1 to 65535 written in plain digits, otherwise 0. */
  static int port(String v) {
    if (v == null || !v.matches("\\d{1,5}")) return 0;
    int n = Integer.parseInt(v);
    return n >= 1 && n <= 65535 ? n : 0;
  }

  /**
   * "key=value" items of an announcement into a map: at most 20 items and 600 characters in all,
   * keys lower case.
   */
  static Map<String, String> parseTxt(List<String> items) {
    Map<String, String> out = new HashMap<>();
    if (items == null) return out;
    int total = 0;
    for (int n = 0; n < items.size() && n < 20; n++) {
      String text = items.get(n) == null ? "" : items.get(n);
      total += text.length();
      if (total > MAX_TXT) break;
      int i = text.indexOf('=');
      if (i > 0) out.put(text.substring(0, i).toLowerCase(Locale.ROOT), text.substring(i + 1));
    }
    return out;
  }

  /**
   * What one announcement looks like to the app, or null if it is not usable: version 1, taking
   * join requests, a local address, an https port, a name.
   */
  static Found describe(String label, Map<String, String> txt, List<String> addresses) {
    if (txt == null || !"1".equals(txt.get("v")) || !"1".equals(txt.get("join"))) return null;
    String address = null; // the first local address; a public one is never used
    if (addresses != null)
      for (String a : addresses)
        if (isLocalV4(a)) {
          address = a;
          break;
        }
    if (address == null) return null;
    int https = port(txt.get("https"));
    if (https == 0)
      return null; // this app refuses plain http, so a server with only http cannot be used from
    // here
    String name = clean(txt.get("n"), 40);
    if (name.isEmpty()) name = clean(label, 40);
    if (name.isEmpty()) return null;
    String fp = txt.get("fp") != null && FP.matcher(txt.get("fp")).matches() ? txt.get("fp") : "";
    return new Found(name, "https://" + address + ":" + https, address, fp, clean(label, 80));
  }
}
