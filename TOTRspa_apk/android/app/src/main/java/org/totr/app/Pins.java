package org.totr.app;

import java.io.ByteArrayInputStream;
import java.net.InetAddress;
import java.security.MessageDigest;
import java.security.cert.CertPath;
import java.security.cert.CertPathValidator;
import java.security.cert.CertificateFactory;
import java.security.cert.PKIXParameters;
import java.security.cert.TrustAnchor;
import java.security.cert.X509Certificate;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Collections;
import java.util.Date;
import java.util.List;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Friends' servers the person has chosen to trust, the phone's version of the desktop app's
 * pins.cjs. A friend's TOTR server has its own certificate authority; the phone learns it from the
 * invite (the admin's link carries the authority's fingerprint) and remembers it FOR THAT SERVER
 * ONLY. A server certificate is then accepted only if that authority signed it, in date, for that
 * very address. Nothing is installed into Android's own trust store, so no other app is affected.
 * Pure Java (no Android classes) so PinsTest runs on a PC. The stored form is one string, one line
 * per server: "origin base64-of-the-authority's-DER", kept in the app's preferences.
 */
final class Pins {
  private Pins() {}

  static final int MAX = 30, MAX_PEM = 16 * 1024;
  private static final Pattern PEM =
      Pattern.compile("-----BEGIN CERTIFICATE-----([A-Za-z0-9+/=\\s]+?)-----END CERTIFICATE-----");

  // Standard Base64 with padding, written out because java.util.Base64 needs Android 8 and this app
  // supports Android 7, and android.util.Base64 cannot run in the PC test.
  private static final String B64 =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

  static String b64encode(byte[] in) {
    StringBuilder sb = new StringBuilder();
    for (int i = 0; i < in.length; i += 3) {
      int n =
          (in[i] & 0xff) << 16
              | (i + 1 < in.length ? (in[i + 1] & 0xff) << 8 : 0)
              | (i + 2 < in.length ? in[i + 2] & 0xff : 0);
      sb.append(B64.charAt(n >> 18 & 63)).append(B64.charAt(n >> 12 & 63));
      sb.append(i + 1 < in.length ? B64.charAt(n >> 6 & 63) : '=')
          .append(i + 2 < in.length ? B64.charAt(n & 63) : '=');
    }
    return sb.toString();
  }

  /**
   * The bytes of strict Base64 text; throws IllegalArgumentException for a wrong length, a
   * character outside the alphabet or padding in the wrong place.
   */
  static byte[] b64decode(String in) {
    if (in.length() % 4 != 0) throw new IllegalArgumentException("length");
    int pad = in.endsWith("==") ? 2 : in.endsWith("=") ? 1 : 0;
    byte[] out = new byte[in.length() / 4 * 3 - pad];
    int o = 0;
    for (int i = 0; i < in.length(); i += 4) {
      int n = 0;
      for (int j = 0; j < 4; j++) {
        char c = in.charAt(i + j);
        int v = c == '=' && i + j >= in.length() - pad ? 0 : B64.indexOf(c);
        if (v < 0) throw new IllegalArgumentException("character");
        n = n << 6 | v;
      }
      if (o < out.length) out[o++] = (byte) (n >> 16);
      if (o < out.length) out[o++] = (byte) (n >> 8);
      if (o < out.length) out[o++] = (byte) n;
    }
    return out;
  }

  /**
   * The one certificate in this text, or null: more or fewer than one, a private key anywhere, or
   * damage.
   */
  static X509Certificate parse(String text) {
    if (text == null) return null;
    String s = text.length() > MAX_PEM ? text.substring(0, MAX_PEM) : text;
    if (s.contains("PRIVATE KEY")) return null;
    Matcher m = PEM.matcher(s);
    if (!m.find()) return null;
    String body = m.group(1).replaceAll("\\s+", "");
    if (m.find()) return null;
    try {
      return fromDer(b64decode(body));
    } catch (Exception e) {
      return null;
    }
  }

  private static X509Certificate fromDer(byte[] der) {
    try {
      return (X509Certificate)
          CertificateFactory.getInstance("X.509")
              .generateCertificate(new ByteArrayInputStream(der));
    } catch (Exception e) {
      return null;
    }
  }

  /**
   * The first 24 hex digits of the certificate's SHA-256 in six groups of four, the same text as
   * the server's tlsid.fingerprint ("9f3a-77c1-0be2-44d9-c05e-a1b7").
   */
  static String fingerprint(X509Certificate cert) {
    try {
      byte[] h = MessageDigest.getInstance("SHA-256").digest(cert.getEncoded());
      StringBuilder sb = new StringBuilder();
      for (int i = 0; i < 12; i++) {
        if (i > 0 && i % 2 == 0) sb.append('-');
        sb.append(String.format("%02x", h[i] & 0xff));
      }
      return sb.toString();
    } catch (Exception e) {
      return null;
    }
  }

  /**
   * Does this fingerprint text (as it came in an invite) say the same as the certificate's? Upper
   * case, spaces and missing dashes are forgiven; nothing else.
   */
  static boolean matches(X509Certificate cert, String code) {
    String want = fingerprint(cert);
    if (want == null || code == null || code.length() > 60) return false;
    String got = code.trim().toLowerCase(Locale.ROOT).replace("-", "").replace(" ", "");
    return got.length() == 24 && got.equals(want.replace("-", ""));
  }

  /**
   * May this certificate be remembered as an authority? It must be one (not an ordinary server
   * certificate) and in date.
   */
  static boolean usableAuthority(X509Certificate cert, long now) {
    if (cert == null || cert.getBasicConstraints() < 0)
      return false; // -1 = not a certificate authority
    try {
      cert.checkValidity(new Date(now));
      return true;
    } catch (Exception e) {
      return false;
    }
  }

  /**
   * Is this server certificate accepted for this host by the pinned authority? The platform's own
   * path check does the work with the pin as the ONLY trust anchor: signature and dates. It does
   * NOT apply the name restrictions written inside the authority (checked: it accepts a certificate
   * for a public name from a name-constrained anchor), so TOTR's rule is enforced here: every name
   * on the certificate must be a private address or end in .local or .lan. A leaked authority key
   * then still could not make a certificate for a real website that this phone would accept. Last,
   * the host must be one of the certificate's names.
   */
  static boolean accepted(X509Certificate authority, X509Certificate leaf, String host, long now) {
    try {
      if (!usableAuthority(authority, now) || leaf == null || host == null || host.isEmpty())
        return false;
      CertPath path =
          CertificateFactory.getInstance("X.509").generateCertPath(Collections.singletonList(leaf));
      PKIXParameters params =
          new PKIXParameters(Collections.singleton(new TrustAnchor(authority, null)));
      params.setRevocationEnabled(false); // there is no revocation service on a home network
      params.setDate(new Date(now));
      CertPathValidator.getInstance("PKIX").validate(path, params);
      return onlyPrivateNames(leaf) && nameMatches(leaf, host);
    } catch (Exception e) {
      return false;
    }
  }

  /**
   * Does every name on the certificate belong to a private network? (No name outside: 10/8,
   * 172.16/12, 192.168/16, *.local, *.lan.)
   */
  static boolean onlyPrivateNames(X509Certificate leaf) throws Exception {
    Collection<List<?>> names = leaf.getSubjectAlternativeNames();
    if (names == null) return false;
    for (List<?> n : names) {
      int type = (Integer) n.get(0);
      String value = String.valueOf(n.get(1));
      if (type == 7) {
        byte[] a =
            InetAddress.getByName(value).getAddress(); // a literal address: no name lookup happens
        int b0 = a[0] & 0xff, b1 = a.length > 1 ? a[1] & 0xff : 0;
        boolean v4 =
            a.length == 4
                && (b0 == 10 || (b0 == 172 && b1 >= 16 && b1 <= 31) || (b0 == 192 && b1 == 168));
        if (!v4) return false;
      } else if (type == 2) {
        String d = value.toLowerCase(Locale.ROOT);
        if (!d.endsWith(".local") && !d.endsWith(".lan")) return false;
      } else {
        return false; // an email, a URI or anything else is not something TOTR issues
      }
    }
    return true;
  }

  private static boolean looksLikeAddress(String host) {
    return host.contains(":") || host.matches("[0-9.]+");
  }

  private static boolean nameMatches(X509Certificate leaf, String host) throws Exception {
    Collection<List<?>> names = leaf.getSubjectAlternativeNames();
    if (names == null) return false;
    boolean isAddress = looksLikeAddress(host);
    InetAddress want =
        isAddress ? InetAddress.getByName(host) : null; // a literal address: no name lookup happens
    for (List<?> n : names) {
      int type = (Integer) n.get(0);
      String value = String.valueOf(n.get(1));
      if (isAddress && type == 7 && want.equals(InetAddress.getByName(value))) return true;
      if (!isAddress && type == 2 && value.equalsIgnoreCase(host)) return true;
    }
    return false;
  }

  // the saved pins: one string, "origin base64der" per line (pure: they give back a new string)

  /**
   * The pinned authorities in a stored string, in order, as origin -> certificate. Anything
   * damaged, repeated, over the limit or not a usable authority is left out.
   */
  static List<String[]> entries(String stored, long now) {
    List<String[]> out = new ArrayList<>();
    if (stored == null) return out;
    for (String line : stored.split("\n")) {
      String[] parts = line.trim().split(" ");
      if (parts.length != 2 || out.size() >= MAX) continue;
      if (!parts[0].equals(AccessList.originOf(parts[0]))) continue;
      boolean seen = false;
      for (String[] e : out) seen |= e[0].equals(parts[0]);
      if (seen) continue;
      try {
        X509Certificate c = fromDer(b64decode(parts[1]));
        if (usableAuthority(c, now)) out.add(parts);
      } catch (Exception e) {
        /* damaged: ignored */
      }
    }
    return out;
  }

  /** The authority pinned for this exact origin, or null. */
  static X509Certificate authorityFor(String stored, String origin, long now) {
    if (origin == null) return null;
    for (String[] e : entries(stored, now))
      if (e[0].equals(origin)) return fromDer(b64decode(e[1]));
    return null;
  }

  /**
   * The stored string with this authority pinned for this origin, or null when it must not be: the
   * origin is not an exact https origin, the certificate is not an authority in date, its
   * fingerprint is not the one the invite carried, or the list is full. An origin that is pinned
   * already is replaced.
   */
  static String add(
      String stored, String origin, X509Certificate authority, String inviteCode, long now) {
    if (origin == null || !origin.equals(AccessList.originOf(origin))) return null;
    if (!usableAuthority(authority, now) || !matches(authority, inviteCode)) return null;
    List<String[]> list = entries(stored, now);
    list.removeIf(e -> e[0].equals(origin));
    if (list.size() >= MAX) return null;
    try {
      list.add(new String[] {origin, b64encode(authority.getEncoded())});
    } catch (Exception e) {
      return null;
    }
    return serialize(list);
  }

  static String remove(String stored, String origin, long now) {
    List<String[]> list = entries(stored, now);
    list.removeIf(e -> e[0].equals(origin));
    return serialize(list);
  }

  private static String serialize(List<String[]> list) {
    StringBuilder sb = new StringBuilder();
    for (String[] e : list) sb.append(e[0]).append(' ').append(e[1]).append('\n');
    return sb.toString();
  }
}
