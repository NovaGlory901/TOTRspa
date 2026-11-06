package org.totr.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import java.nio.charset.StandardCharsets;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.SecureRandom;
import java.security.Signature;
import java.security.interfaces.ECPublicKey;
import java.security.spec.ECGenParameterSpec;
import java.util.LinkedHashMap;
import java.util.Map;
import org.junit.Test;

public class JoinRequestTest {
  private static KeyPair pair() throws Exception {
    KeyPairGenerator g = KeyPairGenerator.getInstance("EC");
    g.initialize(new ECGenParameterSpec("secp256r1"));
    return g.generateKeyPair();
  }

  private static JoinRequest.Signer signer(KeyPair p, final StringBuilder seen) {
    return m -> {
      seen.append(new String(m, StandardCharsets.UTF_8));
      Signature s = Signature.getInstance("SHA256withECDSA");
      s.initSign(p.getPrivate());
      s.update(m);
      return s.sign();
    };
  }

  private static String field(
      String json, String name) { // the value of a top-level string field of the flat body
    int i = json.indexOf("\"" + name + "\":\"") + name.length() + 4;
    StringBuilder sb = new StringBuilder();
    for (int k = i; json.charAt(k) != '"'; k++) {
      if (json.charAt(k) == '\\') k++;
      sb.append(json.charAt(k));
    }
    return sb.toString();
  }

  @Test
  public void thePointIs65BytesStartingWith04ForEveryKey() throws Exception {
    for (int i = 0;
        i < 60;
        i++) { // BigInteger drops leading zero bytes: some keys are short, some carry a sign byte
      byte[] pt = JoinRequest.uncompressedPoint((ECPublicKey) pair().getPublic());
      assertEquals(65, pt.length);
      assertEquals(4, pt[0]);
    }
  }

  @Test
  public void thePointRoundTripsToTheSameKey() throws Exception {
    KeyPair p = pair();
    byte[] pt = JoinRequest.uncompressedPoint((ECPublicKey) p.getPublic());
    java.math.BigInteger x = new java.math.BigInteger(1, java.util.Arrays.copyOfRange(pt, 1, 33)),
        y = new java.math.BigInteger(1, java.util.Arrays.copyOfRange(pt, 33, 65));
    assertEquals(((ECPublicKey) p.getPublic()).getW().getAffineX(), x);
    assertEquals(((ECPublicKey) p.getPublic()).getW().getAffineY(), y);
  }

  @Test
  public void theRequestCarriesTheFieldsTheServerReads() throws Exception {
    KeyPair p = pair();
    StringBuilder seen = new StringBuilder();
    Map<String, Object> h = new LinkedHashMap<>();
    h.put("since", "2024-01-02");
    h.put("plays", 120);
    h.put("mixtapes", 3);
    h.put("songs", 900);
    h.put("evil", "x");
    JoinRequest.Built b =
        JoinRequest.build(
            "Pia",
            "hello",
            "android",
            "0.8.0",
            h,
            1_700_000_000_123L,
            new SecureRandom(),
            JoinRequest.uncompressedPoint((ECPublicKey) p.getPublic()),
            signer(p, seen));
    assertNotNull(b);
    String payload = seen.toString().substring(JoinRequest.PREFIX.length());
    assertTrue(
        payload,
        payload.startsWith(
            "{\"v\":1,\"name\":\"Pia\",\"note\":\"hello\",\"platform\":\"android\",\"app_version\":\"0.8.0\",\"history\":{\"since\":\"2024-01-02\",\"plays\":120,\"mixtapes\":3,\"songs\":900},"));
    assertFalse("unknown history keys are dropped", payload.contains("evil"));
    assertTrue(payload.contains("\"invite_hash\":\"" + b.inviteHash + "\""));
    assertTrue(payload.endsWith("\"ts\":1700000000}")); // seconds, not milliseconds
    assertEquals(64, b.inviteHash.length());
    assertEquals(JoinRequest.sha256Hex(b.token), b.inviteHash);
    assertEquals(43, b.token.length());
    assertTrue(b.token.matches("[A-Za-z0-9_-]{43}"));
    assertFalse("the token itself never goes on the wire", b.body.contains(b.token));
  }

  @Test
  public void theSignatureVerifiesOverThePrefixAndTheExactPayload() throws Exception {
    KeyPair p = pair();
    StringBuilder seen = new StringBuilder();
    JoinRequest.Built b =
        JoinRequest.build(
            "Pia",
            "",
            "android",
            "0.8.0",
            null,
            System.currentTimeMillis(),
            new SecureRandom(),
            JoinRequest.uncompressedPoint((ECPublicKey) p.getPublic()),
            signer(p, seen));
    String payloadOnWire = unescape(field(b.body, "payload"));
    assertEquals(
        JoinRequest.PREFIX + payloadOnWire,
        seen.toString()); // the signed text is the sent text, byte for byte
    Signature v = Signature.getInstance("SHA256withECDSA");
    v.initVerify(p.getPublic());
    v.update(seen.toString().getBytes(StandardCharsets.UTF_8));
    assertTrue(v.verify(Pins.b64decode(field(b.body, "sig"))));
    assertEquals(
        Pins.b64encode(JoinRequest.uncompressedPoint((ECPublicKey) p.getPublic())),
        field(b.body, "key"));
    assertTrue(seen.toString().contains("\"history\":null"));
  }

  private static String unescape(String s) {
    return s.replace("\\\"", "\"").replace("\\\\", "\\");
  }

  @Test
  public void eachRequestHasItsOwnToken() throws Exception {
    KeyPair p = pair();
    JoinRequest.Signer s = signer(p, new StringBuilder());
    byte[] pt = JoinRequest.uncompressedPoint((ECPublicKey) p.getPublic());
    SecureRandom r = new SecureRandom();
    assertFalse(
        JoinRequest.build("A", "", "android", "1", null, 0, r, pt, s)
            .token
            .equals(JoinRequest.build("A", "", "android", "1", null, 0, r, pt, s).token));
  }

  @Test
  public void noNameMeansNoRequest() throws Exception {
    KeyPair p = pair();
    for (String n : new String[] {"", "   ", null, "\n\u0000"})
      assertNull(
          String.valueOf(n),
          JoinRequest.build(
              n,
              "",
              "android",
              "1",
              null,
              0,
              new SecureRandom(),
              JoinRequest.uncompressedPoint((ECPublicKey) p.getPublic()),
              signer(p, new StringBuilder())));
  }

  @Test
  public void textIsCleanedAndCut() throws Exception {
    KeyPair p = pair();
    StringBuilder seen = new StringBuilder();
    JoinRequest.build(
        "N".repeat(60),
        "line1\nline2\t\"quoted\" \\ back",
        "an\u0000droid",
        "9".repeat(50),
        null,
        0,
        new SecureRandom(),
        JoinRequest.uncompressedPoint((ECPublicKey) p.getPublic()),
        signer(p, seen));
    String payload = seen.toString();
    assertTrue(payload.contains("\"name\":\"" + "N".repeat(40) + "\""));
    assertTrue(payload.contains("\"note\":\"line1 line2 \\\"quoted\\\" \\\\ back\""));
    assertTrue(payload.contains("\"platform\":\"an droid\""));
    assertTrue(payload.contains("\"app_version\":\"" + "9".repeat(20) + "\""));
  }

  @Test
  public void historyOnlyKeepsKnownCleanValues() throws Exception {
    KeyPair p = pair();
    byte[] pt = JoinRequest.uncompressedPoint((ECPublicKey) p.getPublic());
    Map<String, Object> h = new LinkedHashMap<>();
    h.put("since", "yesterday");
    h.put("plays", -1);
    h.put("mixtapes", 2_000_000_000);
    h.put("songs", "many");
    h.put("extra", 5);
    StringBuilder seen = new StringBuilder();
    JoinRequest.build("A", "", "android", "1", h, 0, new SecureRandom(), pt, signer(p, seen));
    assertTrue(seen.toString().contains("\"history\":null"));
    h.clear();
    h.put("plays", 0);
    seen.setLength(0);
    JoinRequest.build("A", "", "android", "1", h, 0, new SecureRandom(), pt, signer(p, seen));
    assertTrue(seen.toString().contains("\"history\":{\"plays\":0}"));
  }

  @Test
  public void quotingEscapesWhatBreaksJson() {
    assertEquals("\"a\\\"b\\\\c\\u000ad\\u0000\"", JoinRequest.quote("a\"b\\c\nd\u0000"));
    assertEquals("\"\\u2028\"", JoinRequest.quote("\u2028"));
    assertEquals("\"é日本\"", JoinRequest.quote("é日本"));
  }
}
