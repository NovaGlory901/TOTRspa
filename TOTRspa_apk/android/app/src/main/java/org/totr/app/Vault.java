package org.totr.app;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * The sign-ins the app remembers, one per server (the phone's version of a built-in password
 * manager). Each belongs to ONE exact server address (AccessList.originOf) and is only ever used
 * for a page of that server; it is never handed to a page. Pure Java so VaultTest runs on a PC: the
 * encryption sits behind Crypter (the Android key store on the phone, plain AES in the tests). The
 * stored text is the whole vault sealed in one piece, so nothing readable (not even which servers)
 * is kept outside it. Rules: at most 30 accounts; a person who signed out by hand is not signed in
 * again until they sign in by hand; after 3 failed automatic sign-ins the saved password is not
 * tried again (a changed password is not hammered against the server); at most one automatic try
 * per server every 30 seconds; "never for this server" is remembered.
 */
final class Vault {
  static final int MAX = 30, MAX_FAILURES = 3, USER_MAX = 64, PASS_MAX = 128;
  static final long RETRY_MS = 30_000;

  /** Seals and opens bytes (AES-GCM with a key the app cannot export, on the phone). */
  interface Crypter {
    byte[] seal(byte[] plain) throws Exception;

    byte[] open(byte[] sealed) throws Exception;
  }

  static final class Entry {
    final String username, password;
    boolean signedOut, never;
    int failures;

    Entry(String username, String password) {
      this.username = username;
      this.password = password;
    }

    boolean hasLogin() {
      return !never && !username.isEmpty() && !password.isEmpty();
    }
  }

  private final Map<String, Entry> entries = new LinkedHashMap<>();
  private final Map<String, Long> lastTry =
      new HashMap<>(); // in memory only: the pause between automatic tries

  Vault() {}

  /**
   * The vault inside a stored text. Anything damaged, tampered with or sealed with another key
   * gives an empty vault, never an error.
   */
  static Vault open(String stored, Crypter crypter) {
    Vault v = new Vault();
    if (stored == null || stored.isEmpty() || crypter == null) return v;
    String text;
    try {
      text = new String(crypter.open(Pins.b64decode(stored)), StandardCharsets.UTF_8);
    } catch (Exception e) {
      return v;
    }
    for (String line : text.split("\n")) {
      try { // a damaged line costs only itself
        String[] p = line.split("\t", -1);
        if (p.length != 6 || v.entries.size() >= MAX) continue;
        String origin = p[0];
        if (!origin.equals(AccessList.originOf(origin)) || v.entries.containsKey(origin)) continue;
        Entry e =
            new Entry(
                new String(Pins.b64decode(p[1]), StandardCharsets.UTF_8),
                new String(Pins.b64decode(p[2]), StandardCharsets.UTF_8));
        e.signedOut = p[3].equals("1");
        e.failures = Math.max(0, Math.min(MAX_FAILURES, Integer.parseInt(p[4])));
        e.never = p[5].equals("1");
        v.entries.put(origin, e);
      } catch (Exception e) {
        /* skipped */
      }
    }
    return v;
  }

  /** The whole vault as one sealed text for the app's preferences. */
  String seal(Crypter crypter) throws Exception {
    StringBuilder sb = new StringBuilder();
    for (Map.Entry<String, Entry> m : entries.entrySet()) {
      Entry e = m.getValue();
      sb.append(m.getKey())
          .append('\t')
          .append(Pins.b64encode(e.username.getBytes(StandardCharsets.UTF_8)))
          .append('\t')
          .append(Pins.b64encode(e.password.getBytes(StandardCharsets.UTF_8)))
          .append('\t')
          .append(e.signedOut ? "1" : "0")
          .append('\t')
          .append(e.failures)
          .append('\t')
          .append(e.never ? "1" : "0")
          .append('\n');
    }
    return Pins.b64encode(crypter.seal(sb.toString().getBytes(StandardCharsets.UTF_8)));
  }

  private static boolean clean(String s, int max) {
    if (s == null || s.isEmpty() || s.length() > max) return false;
    for (int i = 0; i < s.length(); i++) if (Character.isISOControl(s.charAt(i))) return false;
    return true;
  }

  /**
   * Remembers a sign-in the person made by hand (or just created). False when it must not be kept:
   * not an exact https origin, odd text, the list is full, or "never" is set.
   */
  boolean put(String origin, String username, String password) {
    if (origin == null
        || !origin.equals(AccessList.originOf(origin))
        || !clean(username, USER_MAX)
        || !clean(password, PASS_MAX)) return false;
    Entry old = entries.get(origin);
    if (old != null && old.never) return false;
    if (old == null && entries.size() >= MAX) return false;
    entries.put(
        origin, new Entry(username, password)); // a fresh entry: not signed out, no failures
    lastTry.remove(origin);
    return true;
  }

  /**
   * Is there a saved sign-in for this server? (The entry, or null. "Never" entries count as none.)
   */
  Entry get(String origin) {
    Entry e = origin == null ? null : entries.get(origin);
    return e != null && e.hasLogin() ? e : null;
  }

  boolean isNever(String origin) {
    Entry e = origin == null ? null : entries.get(origin);
    return e != null && e.never;
  }

  /** "Never save a sign-in for this server" (kept until forget). */
  boolean markNever(String origin) {
    if (origin == null || !origin.equals(AccessList.originOf(origin))) return false;
    if (!entries.containsKey(origin) && entries.size() >= MAX) return false;
    Entry e = new Entry("", "");
    e.never = true;
    entries.put(origin, e);
    return true;
  }

  void forget(String origin) {
    entries.remove(origin);
    lastTry.remove(origin);
  }

  /** The person signed out by hand: no automatic sign-in until they sign in by hand again (put). */
  void markSignedOut(String origin) {
    Entry e = entries.get(origin);
    if (e != null) e.signedOut = true;
  }

  /**
   * The sign-in to try automatically now for this server, or null: none saved, signed out by hand,
   * three failures already, or tried less than 30 seconds ago. Asking counts as a try (the pause
   * starts now).
   */
  Entry nextAutoTry(String origin, long now) {
    Entry e = get(origin);
    if (e == null || e.signedOut || e.failures >= MAX_FAILURES) return null;
    Long last = lastTry.get(origin);
    if (last != null && now - last < RETRY_MS && now >= last) return null;
    lastTry.put(origin, now);
    return e;
  }

  /** The server refused the saved password. */
  void failed(String origin) {
    Entry e = entries.get(origin);
    if (e != null && e.failures < MAX_FAILURES) e.failures++;
  }

  void succeeded(String origin) {
    Entry e = entries.get(origin);
    if (e != null) e.failures = 0;
  }

  List<String> origins() {
    List<String> out = new ArrayList<>();
    for (Map.Entry<String, Entry> m : entries.entrySet())
      if (m.getValue().hasLogin()) out.add(m.getKey());
    return out;
  }

  /**
   * A strong random password for a new account: 24 characters from letters and digits (about 143
   * bits), no look-alikes, so it can be read out if it ever has to be.
   */
  static String newPassword(java.security.SecureRandom random) {
    String alphabet = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    StringBuilder sb = new StringBuilder();
    for (int i = 0; i < 24; i++) sb.append(alphabet.charAt(random.nextInt(alphabet.length())));
    return sb.toString();
  }
}
