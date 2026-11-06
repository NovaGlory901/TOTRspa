package org.totr.app;

import java.util.ArrayList;
import java.util.Collection;
import java.util.List;

/**
 * Which servers' pages may use the phone's controls (switch servers, look at addresses on the
 * network, offer saved songs, install an update). Playing music needs none of them. Same idea as
 * the desktop app's shellaccess.cjs. The list is kept in the app's preferences as one string of
 * origins separated by spaces; anything in it that is not an origin in its exact form is ignored.
 * Pure functions on strings, so they are tested without a phone (AccessListTest).
 */
final class AccessList {
  private AccessList() {}

  static final int MAX = 50;

  /** The app's own pages (the launcher and the offline player). They always may. */
  static final String OWN_ORIGIN = "https://localhost";

  /**
   * "https://host[:port]" for an address, or null if it is not an https address. The port is left
   * out when it is 443.
   */
  static String originOf(String address) {
    try {
      java.net.URI u = new java.net.URI(address == null ? "" : address.trim());
      if (!"https".equalsIgnoreCase(u.getScheme()) || u.getHost() == null || u.getHost().isEmpty())
        return null;
      return "https://"
          + u.getHost().toLowerCase()
          + (u.getPort() > 0 && u.getPort() != 443 ? ":" + u.getPort() : "");
    } catch (Exception e) {
      return null;
    }
  }

  static boolean isOwnPage(String origin) {
    return OWN_ORIGIN.equals(origin);
  }

  /**
   * May this "servers near you" call raise the Allow question? Only a call the person's own tap
   * causes (start, ask, cancel, finish). The ones a page sends by itself on a timer or as it closes
   * (list, refresh, stop) never do: after Finish the window already shows the other server while
   * the old page's last calls are still arriving, and those would otherwise make that server's page
   * ask for the controls at once. Anything unknown is treated as background.
   */
  static boolean mayAsk(String op) {
    return "start".equals(op) || "ask".equals(op) || "cancel".equals(op) || "finish".equals(op);
  }

  /**
   * The origins in a stored string: only exact origins, no repeats, at most MAX. Missing or damaged
   * text gives an empty list.
   */
  static List<String> parse(String stored) {
    List<String> out = new ArrayList<>();
    if (stored == null) return out;
    for (String token : stored.trim().split("\\s+")) {
      if (token.isEmpty() || out.size() >= MAX || out.contains(token)) continue;
      if (token.equals(originOf(token))) out.add(token);
    }
    return out;
  }

  static String serialize(List<String> origins) {
    return String.join(" ", origins);
  }

  /** Is this origin on the stored list? The empty origin (no page, or not https) never is. */
  static boolean has(String stored, String origin) {
    return origin != null && !origin.isEmpty() && parse(stored).contains(origin);
  }

  /**
   * The stored string with this origin added (unchanged when it is there already, or the list is
   * full).
   */
  static String grant(String stored, String origin) {
    List<String> list = parse(stored);
    if (origin == null
        || !origin.equals(originOf(origin))
        || list.contains(origin)
        || list.size() >= MAX) return serialize(list);
    list.add(origin);
    return serialize(list);
  }

  /** The stored string without this origin. */
  static String revoke(String stored, String origin) {
    List<String> list = parse(stored);
    list.remove(origin);
    return serialize(list);
  }

  /**
   * An install from before this existed has no stored list (null). The servers it already knew were
   * chosen by the person, so they keep the controls; anything added later is asked about. Returns
   * the string to save, or null when there is nothing to do (a list is already stored, or no server
   * is known).
   */
  static String inherit(String stored, Collection<String> knownAddresses) {
    if (stored != null) return null;
    List<String> list = new ArrayList<>();
    for (String a : knownAddresses) {
      String o = originOf(a);
      if (o != null && !list.contains(o) && list.size() < MAX) list.add(o);
    }
    return list.isEmpty() ? null : serialize(list);
  }
}
