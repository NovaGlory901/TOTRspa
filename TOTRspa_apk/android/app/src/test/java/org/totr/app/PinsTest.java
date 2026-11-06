package org.totr.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.security.cert.X509Certificate;
import org.junit.Test;

/**
 * Real certificates made by openssl (test/make-pin-fixtures.sh): two authorities shaped like TOTR's
 * own (name-constrained to private addresses and .local/.lan), and the server certificates they
 * signed. The expected fingerprint was computed by the server's own tlsid.fingerprint, so the phone
 * and the server agree on the text.
 */
public class PinsTest {
  private static final String HOME = "https://10.0.0.50:8443";
  private static final String CA_CODE =
      "ee9b-1496-ccdc-04ed-d672-2cea"; // TOTRsrv tlsid.fingerprint(ca.pem)
  private static final long NOW = System.currentTimeMillis(), DAY = 86400_000L;

  private static String text(String name) throws Exception {
    try (InputStream in = PinsTest.class.getResourceAsStream("/pins/" + name)) {
      return new String(in.readAllBytes(), StandardCharsets.US_ASCII);
    }
  }

  /**
   * When the certificate starts to be valid, so "not yet valid" does not depend on how old the
   * files are.
   */
  private static long startOf(String name) throws Exception {
    return Math.min(
        cert(name).getNotBefore().getTime(), cert("server.pem").getNotBefore().getTime());
  }

  private static X509Certificate cert(String name) throws Exception {
    return Pins.parse(text(name));
  }

  @Test
  public void ourBase64MatchesTheStandardOne() {
    java.util.Random r = new java.util.Random(7);
    for (int len = 0; len < 40; len++) {
      byte[] b = new byte[len];
      r.nextBytes(b);
      String want = java.util.Base64.getEncoder().encodeToString(b);
      assertEquals(want, Pins.b64encode(b));
      assertTrue(java.util.Arrays.equals(b, Pins.b64decode(want)));
    }
    for (String bad : new String[] {"A", "AB=", "AA=A", "A===", "@@@@", "AAA ", "AB\nC"}) {
      try {
        Pins.b64decode(bad);
        org.junit.Assert.fail("accepted " + bad);
      } catch (IllegalArgumentException expected) {
        /* refused */
      }
    }
  }

  @Test
  public void parseTakesExactlyOneCertificate() throws Exception {
    assertNotNull(Pins.parse(text("ca.pem")));
    assertNull(Pins.parse(text("ca.pem") + text("other-ca.pem")));
    assertNull(Pins.parse(""));
    assertNull(Pins.parse(null));
    assertNull(
        Pins.parse(
            "-----BEGIN CERTIFICATE-----\nnot base64 at all!!\n-----END CERTIFICATE-----\n"));
    assertNull(Pins.parse("-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----\n"));
  }

  @Test
  public void aTextWithAPrivateKeyIsRefusedWhateverElseIsInIt() throws Exception {
    assertNull(
        Pins.parse(
            text("ca.pem") + "-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----\n"));
    assertNull(
        Pins.parse(
            "-----BEGIN EC PRIVATE KEY-----\nAAAA\n-----END EC PRIVATE KEY-----\n"
                + text("ca.pem")));
  }

  @Test
  public void theFingerprintIsTheServersOwn() throws Exception {
    assertEquals(CA_CODE, Pins.fingerprint(cert("ca.pem")));
    assertFalse(CA_CODE.equals(Pins.fingerprint(cert("other-ca.pem"))));
  }

  @Test
  public void anInviteCodeMatchesOnlyTheRightCertificate() throws Exception {
    X509Certificate ca = cert("ca.pem");
    assertTrue(Pins.matches(ca, CA_CODE));
    assertTrue(Pins.matches(ca, " " + CA_CODE.toUpperCase() + " "));
    assertTrue(Pins.matches(ca, CA_CODE.replace("-", "")));
    assertFalse(Pins.matches(ca, Pins.fingerprint(cert("other-ca.pem"))));
    assertFalse(Pins.matches(ca, CA_CODE.substring(0, CA_CODE.length() - 1))); // one digit short
    assertFalse(Pins.matches(ca, CA_CODE + "0")); // one digit too many
    assertFalse(Pins.matches(ca, ""));
    assertFalse(Pins.matches(ca, null));
  }

  @Test
  public void onlyAnAuthorityInDateMayBeRemembered() throws Exception {
    assertTrue(Pins.usableAuthority(cert("ca.pem"), NOW));
    assertFalse(
        Pins.usableAuthority(
            cert("server.pem"), NOW)); // an ordinary server certificate offered as an authority
    assertFalse(
        Pins.usableAuthority(cert("ca.pem"), NOW + 37000 * DAY)); // the authority has run out
    assertFalse(Pins.usableAuthority(cert("ca.pem"), startOf("ca.pem") - DAY)); // ... or not begun
    assertFalse(Pins.usableAuthority(null, NOW));
  }

  @Test
  public void theRightAuthorityAcceptsItsServerForItsAddressAndName() throws Exception {
    assertTrue(Pins.accepted(cert("ca.pem"), cert("server.pem"), "10.0.0.50", NOW));
    assertTrue(Pins.accepted(cert("ca.pem"), cert("server.pem"), "box.local", NOW));
    assertTrue(Pins.accepted(cert("ca.pem"), cert("server.pem"), "BOX.local", NOW));
  }

  @Test
  public void aCertificateForAnotherHostIsRefused() throws Exception {
    assertFalse(Pins.accepted(cert("ca.pem"), cert("server.pem"), "10.0.0.51", NOW));
    assertFalse(Pins.accepted(cert("ca.pem"), cert("server.pem"), "other.local", NOW));
    assertFalse(Pins.accepted(cert("ca.pem"), cert("server.pem"), "", NOW));
    assertFalse(Pins.accepted(cert("ca.pem"), cert("server.pem"), null, NOW));
    assertFalse(Pins.accepted(cert("ca.pem"), cert("server.pem"), "10.0.0.50.evil.example", NOW));
  }

  @Test
  public void aCertificateFromAnotherAuthorityIsRefused() throws Exception {
    assertFalse(
        Pins.accepted(
            cert("ca.pem"), cert("server-other.pem"), "10.0.0.50", NOW)); // the man in the middle
    assertTrue(Pins.accepted(cert("other-ca.pem"), cert("server-other.pem"), "10.0.0.50", NOW));
  }

  @Test
  public void expiryIsEnforcedOnBothCertificates() throws Exception {
    assertFalse(
        Pins.accepted(
            cert("ca.pem"),
            cert("server.pem"),
            "10.0.0.50",
            NOW + 4000 * DAY)); // the server certificate ran out, the authority has not
    assertFalse(
        Pins.accepted(
            cert("ca.pem"), cert("server.pem"), "10.0.0.50", NOW + 37000 * DAY)); // both ran out
    assertFalse(
        Pins.accepted(
            cert("ca.pem"),
            cert("server.pem"),
            "10.0.0.50",
            startOf("ca.pem") - DAY)); // not yet valid
  }

  @Test
  public void anAuthorityThatBreaksItsOwnNameRulesIsRefused() throws Exception {
    // signed by the right authority but for a public address and name, which the authority is not
    // allowed to vouch for
    assertFalse(Pins.accepted(cert("ca.pem"), cert("server-public.pem"), "8.8.8.8", NOW));
    assertFalse(Pins.accepted(cert("ca.pem"), cert("server-public.pem"), "example.com", NOW));
  }

  @Test
  public void thePrivateRangesAreExactlyTheRightOnes() throws Exception {
    X509Certificate ca = cert("ca.pem");
    assertTrue(
        Pins.accepted(
            ca,
            cert("server-172in.pem"),
            "172.31.255.1",
            NOW)); // 172.16.0.0/12 reaches 172.31.255.255
    assertFalse(
        Pins.accepted(ca, cert("server-172out.pem"), "172.32.0.1", NOW)); // ... and not 172.32.x
    assertFalse(
        Pins.accepted(
            ca, cert("server-192out.pem"), "192.0.2.5", NOW)); // 192.x is private only as 192.168.x
    assertFalse(
        Pins.accepted(
            ca,
            cert("server-mixed.pem"),
            "10.0.0.50",
            NOW)); // one public name spoils the whole certificate
    assertTrue(Pins.accepted(ca, cert("server-lan.pem"), "nas.lan", NOW));
    assertFalse(
        Pins.accepted(
            ca,
            cert("server-email.pem"),
            "10.0.0.50",
            NOW)); // a kind of name TOTR never issues spoils it too
    assertFalse(
        Pins.accepted(
            ca, cert("server-bare.pem"), "local", NOW)); // a name must end in .local, not be it
  }

  @Test
  public void anOrdinaryServerCertificateCannotActAsTheAuthority() throws Exception {
    assertFalse(Pins.accepted(cert("server.pem"), cert("server.pem"), "10.0.0.50", NOW));
  }

  @Test
  public void addingNeedsTheRightCodeAndAUsableAuthority() throws Exception {
    String stored = Pins.add("", HOME, cert("ca.pem"), CA_CODE, NOW);
    assertNotNull(stored);
    assertNotNull(Pins.authorityFor(stored, HOME, NOW));
    assertEquals(CA_CODE, Pins.fingerprint(Pins.authorityFor(stored, HOME, NOW)));
    assertNull(
        Pins.add(
            "",
            HOME,
            cert("ca.pem"),
            Pins.fingerprint(cert("other-ca.pem")),
            NOW)); // a code that belongs to another authority
    assertNull(Pins.add("", HOME, cert("ca.pem"), "", NOW));
    assertNull(
        Pins.add(
            "",
            HOME,
            cert("server.pem"),
            Pins.fingerprint(cert("server.pem")),
            NOW)); // not an authority
    assertNull(Pins.add("", HOME, cert("ca.pem"), CA_CODE, NOW + 37000 * DAY)); // out of date
    assertNull(Pins.add("", HOME, null, CA_CODE, NOW));
  }

  @Test
  public void onlyAnExactHttpsOriginCanBePinned() throws Exception {
    for (String bad :
        new String[] {
          "http://10.0.0.50:8443",
          HOME + "/",
          HOME + "/invite/x",
          "10.0.0.50:8443",
          "",
          null,
          "https://10.0.0.50:8443 https://evil.example"
        }) assertNull(String.valueOf(bad), Pins.add("", bad, cert("ca.pem"), CA_CODE, NOW));
  }

  @Test
  public void aPinBelongsToThatOriginOnly() throws Exception {
    String stored = Pins.add("", HOME, cert("ca.pem"), CA_CODE, NOW);
    assertNull(Pins.authorityFor(stored, "https://10.0.0.50:9999", NOW));
    assertNull(Pins.authorityFor(stored, "https://10.0.0.51:8443", NOW));
    assertNull(Pins.authorityFor(stored, "", NOW));
    assertNull(Pins.authorityFor(stored, null, NOW));
    assertNull(Pins.authorityFor(null, HOME, NOW));
  }

  @Test
  public void pinningAgainReplacesAndRemovingWorks() throws Exception {
    String one = Pins.add("", HOME, cert("ca.pem"), CA_CODE, NOW);
    String two =
        Pins.add(one, HOME, cert("other-ca.pem"), Pins.fingerprint(cert("other-ca.pem")), NOW);
    assertEquals(1, Pins.entries(two, NOW).size());
    assertEquals(
        Pins.fingerprint(cert("other-ca.pem")),
        Pins.fingerprint(Pins.authorityFor(two, HOME, NOW)));
    assertNull(Pins.authorityFor(Pins.remove(two, HOME, NOW), HOME, NOW));
  }

  @Test
  public void damagedOrEditedStoredTextIsIgnoredNeverTrusted() throws Exception {
    String good = Pins.add("", HOME, cert("ca.pem"), CA_CODE, NOW);
    String der = good.trim().split(" ")[1];
    assertEquals(0, Pins.entries("garbage", NOW).size());
    assertEquals(0, Pins.entries(HOME + " not-base64!", NOW).size());
    assertEquals(
        0, Pins.entries(HOME + " " + der.substring(0, der.length() - 12), NOW).size()); // cut short
    assertEquals(
        0, Pins.entries("http://10.0.0.50:8443 " + der, NOW).size()); // not an https origin
    assertEquals(0, Pins.entries(HOME + "/ " + der, NOW).size());
    assertEquals(
        1, Pins.entries("junk\n" + good + good, NOW).size()); // junk skipped, repeats dropped
    // an edited certificate is a different certificate: it is only ever used if it is itself a
    // usable authority, and it is then never the one the invite named
    String serverDer =
        Pins.add("", HOME, cert("ca.pem"), CA_CODE, NOW)
            .replace(der, Pins.b64encode(cert("server.pem").getEncoded()));
    assertEquals(
        0, Pins.entries(serverDer, NOW).size()); // a server certificate in the authority's place
    assertEquals(
        0,
        Pins.entries(good, NOW + 37000 * DAY).size()); // an authority that has run out is dropped
  }

  @Test
  public void theListHasALimit() throws Exception {
    String stored = "";
    for (int i = 0; i < Pins.MAX; i++)
      stored = Pins.add(stored, "https://10.0.1." + i + ":8443", cert("ca.pem"), CA_CODE, NOW);
    assertEquals(Pins.MAX, Pins.entries(stored, NOW).size());
    assertNull(Pins.add(stored, "https://10.0.2.1:8443", cert("ca.pem"), CA_CODE, NOW));
    assertNotNull(
        Pins.add(
            stored,
            "https://10.0.1.3:8443",
            cert("ca.pem"),
            CA_CODE,
            NOW)); // replacing one that is there is fine
  }
}
