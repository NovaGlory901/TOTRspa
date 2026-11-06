package org.totr.app;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.security.SecureRandom;
import java.security.cert.CertificateException;
import java.security.cert.X509Certificate;
import javax.net.ssl.HostnameVerifier;
import javax.net.ssl.HttpsURLConnection;
import javax.net.ssl.SSLContext;
import javax.net.ssl.TrustManager;
import javax.net.ssl.TrustManagerFactory;
import javax.net.ssl.X509TrustManager;

/**
 * Connections the phone's own Java code makes to a server (probing, saving mixtapes, sending songs,
 * joining). A server whose certificate the system already trusts works as before; a friend's server
 * works only if the person pinned its authority (Pins) and the certificate passes Pins.accepted for
 * that very host. No Android classes, so PinnedTlsTest runs on a PC. Never a blanket "trust
 * everything", with one exception, fetchAuthority below, which says why.
 */
final class PinnedTls {
  private PinnedTls() {}

  /** The trust check for one connection: the platform's own first, then the pin for this host. */
  static final class Trust implements X509TrustManager {
    private final X509TrustManager platform; // null = nothing but the pin (tests)
    private final X509Certificate authority; // the pinned authority for this server, or null
    private final String host;
    private final long now;

    Trust(X509TrustManager platform, X509Certificate authority, String host, long now) {
      this.platform = platform;
      this.authority = authority;
      this.host = host;
      this.now = now;
    }

    @Override
    public void checkServerTrusted(X509Certificate[] chain, String authType)
        throws CertificateException {
      if (chain == null || chain.length == 0) throw new CertificateException("no certificate");
      try {
        if (platform == null) throw new CertificateException("not in the platform's trust");
        platform.checkServerTrusted(chain, authType);
      } catch (CertificateException notTrusted) {
        if (authority == null || !Pins.accepted(authority, chain[0], host, now)) throw notTrusted;
      }
    }

    @Override
    public void checkClientTrusted(X509Certificate[] chain, String authType)
        throws CertificateException {
      throw new CertificateException("this app has no client certificates");
    }

    @Override
    public X509Certificate[] getAcceptedIssuers() {
      return platform == null ? new X509Certificate[0] : platform.getAcceptedIssuers();
    }
  }

  private static X509TrustManager platformTrust() throws Exception {
    TrustManagerFactory f =
        TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm());
    f.init((KeyStore) null);
    for (TrustManager t : f.getTrustManagers())
      if (t instanceof X509TrustManager) return (X509TrustManager) t;
    throw new IllegalStateException("no platform trust manager");
  }

  /**
   * Opens a connection to this address; an https one also accepts the authority pinned for it (the
   * stored pins string, or null). Not connected yet.
   */
  static HttpURLConnection open(String address, String pins) throws Exception {
    URL url = new URL(address);
    HttpURLConnection c = (HttpURLConnection) url.openConnection();
    if (c instanceof HttpsURLConnection && pins != null) {
      long now = System.currentTimeMillis();
      X509Certificate authority = Pins.authorityFor(pins, AccessList.originOf(address), now);
      if (authority != null) {
        SSLContext ctx = SSLContext.getInstance("TLS");
        ctx.init(
            null,
            new TrustManager[] {new Trust(platformTrust(), authority, url.getHost(), now)},
            new SecureRandom());
        ((HttpsURLConnection) c).setSSLSocketFactory(ctx.getSocketFactory());
      }
    }
    return c;
  }

  /**
   * Fetches a server's PUBLIC authority certificate (/.well-known/totr-ca.pem) from a server this
   * phone has no reason to trust yet. This is the one request that skips certificate checking, and
   * it is safe because of what is done with the answer: it is only a certificate, read as text (at
   * most 16 KB, no redirects, nothing sent but the request line), and Pins.matches must find the
   * fingerprint from the invite in it before it is used for anything. A false answer cannot pass
   * that. Returns the certificate text, or null.
   */
  static String fetchAuthority(String origin) {
    if (origin == null || !origin.equals(AccessList.originOf(origin))) return null;
    try {
      HttpsURLConnection c =
          (HttpsURLConnection) new URL(origin + "/.well-known/totr-ca.pem").openConnection();
      SSLContext ctx = SSLContext.getInstance("TLS");
      ctx.init(
          null,
          new TrustManager[] {
            new X509TrustManager() {
              @Override
              public void checkServerTrusted(X509Certificate[] chain, String authType) {
                /* deliberately not checked: see above */
              }

              @Override
              public void checkClientTrusted(X509Certificate[] chain, String authType)
                  throws CertificateException {
                throw new CertificateException("none");
              }

              @Override
              public X509Certificate[] getAcceptedIssuers() {
                return new X509Certificate[0];
              }
            }
          },
          new SecureRandom());
      c.setSSLSocketFactory(ctx.getSocketFactory());
      c.setHostnameVerifier((HostnameVerifier) (h, s) -> true);
      c.setInstanceFollowRedirects(false);
      c.setConnectTimeout(5000);
      c.setReadTimeout(5000);
      if (c.getResponseCode() != 200) {
        c.disconnect();
        return null;
      }
      try (InputStream in = c.getInputStream()) {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buf = new byte[2048];
        int n;
        while ((n = in.read(buf)) > 0) {
          out.write(buf, 0, n);
          if (out.size() > Pins.MAX_PEM) return null;
        }
        return new String(out.toByteArray(), StandardCharsets.US_ASCII);
      } finally {
        c.disconnect();
      }
    } catch (Exception e) {
      return null;
    }
  }
}
