package org.totr.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.fail;

import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.security.cert.CertificateException;
import java.security.cert.X509Certificate;
import org.junit.Test;

/**
 * The trust decision on a real certificate chain (no network): with no platform trust, only the
 * pinned authority can vouch.
 */
public class PinnedTlsTest {
  private static final long NOW = System.currentTimeMillis();

  private static X509Certificate cert(String name) throws Exception {
    try (InputStream in = PinnedTlsTest.class.getResourceAsStream("/pins/" + name)) {
      return Pins.parse(new String(in.readAllBytes(), StandardCharsets.US_ASCII));
    }
  }

  private static boolean trusts(PinnedTls.Trust t, String leaf) throws Exception {
    try {
      t.checkServerTrusted(new X509Certificate[] {cert(leaf)}, "ECDSA");
      return true;
    } catch (CertificateException e) {
      return false;
    }
  }

  @Test
  public void thePinnedAuthorityVouchesForItsServerAtItsHost() throws Exception {
    assertEquals(
        true, trusts(new PinnedTls.Trust(null, cert("ca.pem"), "10.0.0.50", NOW), "server.pem"));
  }

  @Test
  public void withNoPinNothingIsTrusted() throws Exception {
    assertEquals(false, trusts(new PinnedTls.Trust(null, null, "10.0.0.50", NOW), "server.pem"));
  }

  @Test
  public void theWrongAuthoritysServerOrTheWrongHostIsNot() throws Exception {
    assertEquals(
        false,
        trusts(new PinnedTls.Trust(null, cert("ca.pem"), "10.0.0.50", NOW), "server-other.pem"));
    assertEquals(
        false, trusts(new PinnedTls.Trust(null, cert("ca.pem"), "10.0.0.99", NOW), "server.pem"));
    assertEquals(
        false,
        trusts(
            new PinnedTls.Trust(null, cert("ca.pem"), "10.0.0.50", NOW + 4000L * 86400_000L),
            "server.pem"));
  }

  @Test
  public void anEmptyChainIsRefused() throws Exception {
    try {
      new PinnedTls.Trust(null, cert("ca.pem"), "10.0.0.50", NOW)
          .checkServerTrusted(new X509Certificate[0], "ECDSA");
      fail("accepted an empty chain");
    } catch (CertificateException expected) {
      /* refused */
    }
    try {
      new PinnedTls.Trust(null, cert("ca.pem"), "10.0.0.50", NOW).checkServerTrusted(null, "ECDSA");
      fail("accepted no chain");
    } catch (CertificateException expected) {
      /* refused */
    }
  }

  @Test
  public void thePlatformsOwnTrustStillCounts() throws Exception {
    javax.net.ssl.X509TrustManager yes =
        new javax.net.ssl.X509TrustManager() {
          public void checkServerTrusted(X509Certificate[] c, String a) {}

          public void checkClientTrusted(X509Certificate[] c, String a) {}

          public X509Certificate[] getAcceptedIssuers() {
            return new X509Certificate[0];
          }
        };
    assertEquals(
        true,
        trusts(
            new PinnedTls.Trust(yes, null, "10.0.0.50", NOW),
            "server-public.pem")); // the system vouches: no pin needed
  }

  @Test
  public void noClientCertificatesAreEverAccepted() throws Exception {
    try {
      new PinnedTls.Trust(null, cert("ca.pem"), "10.0.0.50", NOW)
          .checkClientTrusted(new X509Certificate[] {cert("server.pem")}, "ECDSA");
      fail("accepted a client certificate");
    } catch (CertificateException expected) {
      /* refused */
    }
  }

  @Test
  public void openGivesAPlainConnectionWithoutAPinAndNothingForBadAddresses() throws Exception {
    assertNotNull(PinnedTls.open("https://10.0.0.50:8443/x", null));
    assertNotNull(PinnedTls.open("https://10.0.0.50:8443/x", ""));
    assertNull(PinnedTls.fetchAuthority("http://10.0.0.50:8443"));
    assertNull(PinnedTls.fetchAuthority("https://10.0.0.50:8443/path"));
    assertNull(PinnedTls.fetchAuthority(null));
  }
}
