package org.totr.app;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.security.interfaces.ECPublicKey;
import java.util.Map;

/**
 * Building one signed join request, the phone's version of the desktop app's joinclient.cjs
 * (buildRequest). The wire format is described in TOTRsrv/auth/join.py: {"payload": "<JSON text>",
 * "key": "<base64 public key>", "sig": "<base64 signature>"}; the signature covers
 * "totr-join-request\n" + the exact payload text. Here the key is an EC P-256 key from the phone's
 * key store: `key` is its uncompressed point (65 bytes) and `sig` a DER ECDSA signature over
 * SHA-256 (what the key store makes). The app makes up a one-time invite token itself and sends
 * only its SHA-256, so nothing secret crosses the network. Pure Java so JoinRequestTest runs on a
 * PC.
 */
final class JoinRequest {
  private JoinRequest() {}

  static final String PREFIX = "totr-join-request\n";

  /** Signs a message with the install's key (the key store's, on the phone). */
  interface Signer {
    byte[] sign(byte[] message) throws Exception;
  }

  /** The request as it goes on the wire, with the token the app keeps to itself. */
  static final class Built {
    final String body, token, inviteHash;

    Built(String body, String token, String inviteHash) {
      this.body = body;
      this.token = token;
      this.inviteHash = inviteHash;
    }
  }

  /**
   * A new random token: 32 bytes as URL-safe base64 without padding (43 characters), the shape the
   * server's invite links expect.
   */
  static String newToken(SecureRandom random) {
    byte[] b = new byte[32];
    random.nextBytes(b);
    return Pins.b64encode(b).replace('+', '-').replace('/', '_').replace("=", "");
  }

  static String sha256Hex(String text) throws Exception {
    byte[] h = MessageDigest.getInstance("SHA-256").digest(text.getBytes(StandardCharsets.UTF_8));
    StringBuilder sb = new StringBuilder();
    for (byte x : h) sb.append(String.format("%02x", x & 0xff));
    return sb.toString();
  }

  /** The 65-byte uncompressed point (0x04, X, Y) of a P-256 public key. */
  static byte[] uncompressedPoint(ECPublicKey key) {
    byte[] out = new byte[65];
    out[0] = 4;
    copyPadded(key.getW().getAffineX().toByteArray(), out, 1);
    copyPadded(key.getW().getAffineY().toByteArray(), out, 33);
    return out;
  }

  private static void copyPadded(
      byte[] number,
      byte[] out,
      int at) { // BigInteger bytes may carry a leading zero or be short: make exactly 32
    int len = number.length, skip = Math.max(0, len - 32);
    System.arraycopy(number, skip, out, at + 32 - (len - skip), len - skip);
  }

  /**
   * JSON string literal for plain text: quotes, backslash and control characters escaped,
   * everything else as is.
   */
  static String quote(String s) {
    StringBuilder sb = new StringBuilder("\"");
    for (int i = 0; i < s.length(); i++) {
      char c = s.charAt(i);
      if (c == '"') sb.append("\\\"");
      else if (c == '\\') sb.append("\\\\");
      else if (c < 0x20 || c == 0x7f || c == 0x2028 || c == 0x2029)
        sb.append(String.format("\\u%04x", (int) c));
      else sb.append(c);
    }
    return sb.append('"').toString();
  }

  /**
   * The request for this person's name and note. `history` holds only what the server reads:
   * "since" (a yyyy-mm-dd String) and plays / mixtapes / songs (Integer 0 to 1e9); anything else is
   * dropped. Returns null if there is no name.
   */
  static Built build(
      String name,
      String note,
      String platform,
      String appVersion,
      Map<String, Object> history,
      long nowMillis,
      SecureRandom random,
      byte[] publicPoint,
      Signer signer)
      throws Exception {
    String n = Discover.clean(name, 40);
    if (n.isEmpty()) return null;
    String token = newToken(random), inviteHash = sha256Hex(token);
    StringBuilder h = new StringBuilder();
    if (history != null) {
      Object since = history.get("since");
      if (since instanceof String && ((String) since).matches("\\d{4}-\\d{2}-\\d{2}"))
        h.append("\"since\":").append(quote((String) since));
      for (String k : new String[] {"plays", "mixtapes", "songs"}) {
        Object v = history.get(k);
        if (v instanceof Integer && (Integer) v >= 0 && (Integer) v <= 1_000_000_000)
          h.append(h.length() > 0 ? "," : "").append(quote(k)).append(':').append(v);
      }
    }
    String payload =
        "{\"v\":1,\"name\":"
            + quote(n)
            + ",\"note\":"
            + quote(Discover.clean(note, 300))
            + ",\"platform\":"
            + quote(Discover.clean(platform, 40))
            + ",\"app_version\":"
            + quote(Discover.clean(appVersion, 20))
            + ",\"history\":"
            + (h.length() > 0 ? "{" + h + "}" : "null")
            + ",\"invite_hash\":"
            + quote(inviteHash)
            + ",\"ts\":"
            + (nowMillis / 1000)
            + "}";
    byte[] sig = signer.sign((PREFIX + payload).getBytes(StandardCharsets.UTF_8));
    String body =
        "{\"payload\":"
            + quote(payload)
            + ",\"key\":"
            + quote(Pins.b64encode(publicPoint))
            + ",\"sig\":"
            + quote(Pins.b64encode(sig))
            + "}";
    return new Built(body, token, inviteHash);
  }
}
