package org.totr.app;

import android.content.Context;
import android.net.Uri;
import android.net.http.SslCertificate;
import android.net.http.SslError;
import android.os.Build;
import android.webkit.SslErrorHandler;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebViewClient;
import java.io.ByteArrayInputStream;
import java.security.cert.CertificateFactory;
import java.security.cert.X509Certificate;
import java.util.HashMap;

/**
 * The WebView's gatekeeper. It does two jobs: * serves the saved mixtapes' files to the offline
 * player (https://localhost/_offline/<name>), with byte ranges; * answers certificate errors: a
 * server whose certificate the system does not trust is accepted ONLY if the person pinned its
 * authority (Pins) and the certificate passes Pins.accepted for that very address; everything else
 * is cancelled, as before. Never a blanket proceed; * in OFFLINE MODE closes the app up: every
 * address except the app's own https://localhost is refused (page loads, images, audio, fetches),
 * so nothing on any network can reach into the app or be reached by it until the person switches
 * back online.
 */
final class GuardClient extends BridgeWebViewClient {
  /** Offline mode is on. Set by TotrBridge (and remembered across launches there). */
  static volatile boolean offline;

  private final OfflineStore store;

  GuardClient(Bridge bridge, OfflineStore store) {
    super(bridge);
    this.store = store;
  }

  private static boolean isOwn(Uri u) {
    return "https".equals(u.getScheme()) && "localhost".equalsIgnoreCase(u.getHost());
  }

  @Override
  public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
    if (!offline && pinnedAccepts(view.getContext(), error)) handler.proceed();
    else handler.cancel();
  }

  private static boolean pinnedAccepts(Context context, SslError error) {
    try {
      String url = error.getUrl();
      String origin = AccessList.originOf(url);
      if (origin == null) return false;
      long now = System.currentTimeMillis();
      X509Certificate authority = Pins.authorityFor(PinStore.get(context), origin, now);
      X509Certificate leaf = leafOf(error.getCertificate());
      return authority != null
          && leaf != null
          && Pins.accepted(authority, leaf, Uri.parse(url).getHost(), now);
    } catch (Exception e) {
      return false;
    }
  }

  /**
   * The server's own certificate from what the WebView reports (a direct call from Android 10;
   * before that through the saved state, which holds the DER bytes).
   */
  private static X509Certificate leafOf(SslCertificate c) throws Exception {
    if (c == null) return null;
    if (Build.VERSION.SDK_INT >= 29) return c.getX509Certificate();
    byte[] der = SslCertificate.saveState(c).getByteArray("x509-certificate");
    return der == null
        ? null
        : (X509Certificate)
            CertificateFactory.getInstance("X.509")
                .generateCertificate(new ByteArrayInputStream(der));
  }

  @Override
  public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
    if (offline && !isOwn(request.getUrl()))
      return true; // cancelled: not loaded, not opened in a browser either
    return super.shouldOverrideUrlLoading(view, request);
  }

  @Override
  public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
    Uri u = request.getUrl();
    if (isOwn(u)) {
      String p = u.getPath();
      if (p != null && p.startsWith("/_offline/"))
        return store.serve(p.substring("/_offline/".length()), request.getRequestHeaders());
      return super.shouldInterceptRequest(view, request);
    }
    if (offline)
      return new WebResourceResponse(
          "text/plain",
          "utf-8",
          403,
          "Offline mode",
          new HashMap<>(),
          new ByteArrayInputStream(new byte[0]));
    return super.shouldInterceptRequest(view, request);
  }
}
